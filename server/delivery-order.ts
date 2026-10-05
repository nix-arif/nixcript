"use server";

import { db } from "@/db";
import {
  deliveryOrder,
  deliveryOrderItem,
  deliveryOrderCustomerItem,
  deliveryOrderCounter,
  customer,
  user,
  salesOrder,
  salesOrderItem,
  customerPurchaseOrder,
  invoice,
  quotation,
  purchaseOrder,
  purchaseOrderItem,
  stockLevel,
  stockMovement,
  product as productTable,
  organizationProfile,
  member,
  assetUnit,
  consignEvent,
  deliveryOrderReturn,
} from "@/db/schema";
import { buildCustomerSnapshot } from "@/server/customer";
import { getOrganizationProfile } from "@/server/organization-profile";
import { getCachedSession } from "@/lib/auth/cached-session";
import { revalidatePath } from "next/cache";
import { nanoid } from "nanoid";
import { eq, and, desc, asc, inArray, isNotNull, isNull, notExists, ne, sql, or, count, like } from "drizzle-orm";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";
import { getNumberingConfig } from "@/server/document-numbering";
import { buildDocumentNo } from "@/lib/document-numbering";
import { nextFreeDocNo, isDocNoTakenInGroup } from "@/lib/document-number-group";
import { createApprovedMovement, adjustReservation } from "@/lib/inventory/create-movement";
import { LOAN_PURPOSE, MOVEMENT_TYPE, REF_TYPE, isLendable } from "@/lib/inventory/constants";
import { cleanCustomerView, type CustomerView } from "@/lib/delivery/customer-view";
import { pricedWithoutMda, pricedWithoutMdaMessage } from "@/lib/mda/priced-without-mda";
import { bumpLevel, consignedLineForUnit, consumeConsigned, consignedHeldByRep, getConsumeOrder, missingPairTerms, recordMachineUse, reverseConsumption, reverseMachineUse } from "@/lib/consignment/engine";
import { isConsignmentLocation } from "@/lib/consignment/labels";
import { autoSettlePerUse } from "@/lib/consignment/settle";
import { draftDoNo, isDraftDoNo } from "@/lib/delivery/draft-no";
import { isOrgMember } from "@/lib/inventory/field-holder";

async function getSession() {
  const session = await getCachedSession();
  if (!session) throw new Error("You must be signed in to continue");
  const orgId = session.session.activeOrganizationId;
  if (!orgId) throw new Error("No active organization");
  return { session, orgId, userId: session.user.id };
}

async function requireAccess(permission: string) {
  const { session, orgId, userId } = await getSession();
  const perms = await getUserPermissions(userId, orgId);
  if (!hasAccess(perms, permission)) throw new Error("You don't have permission to do this");
  return { session, orgId, userId };
}

// For actions restricted to the organization owner regardless of any
// individually granted permission — e.g. correcting the DO number.
async function requireOwner() {
  const { session, orgId, userId } = await getSession();
  const [m] = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.organizationId, orgId)))
    .limit(1);
  if (!m || m.role !== "owner") throw new Error("Only the organization owner can do this");
  return { session, orgId, userId };
}


// The org's actual configured warehouse — a caller-supplied "Default"
// fallback silently diverges from this the moment an org sets up a real
// warehouse label (e.g. "Main Warehouse"), since no stock is ever tracked
// under the literal string "Default" for that org. Same resolution as
// getMainWarehouseLabelInternal in server/field-stock.ts, duplicated here so
// this file doesn't need to import a private helper from another module.
async function resolveMainWarehouseLabel(orgId: string): Promise<string> {
  const [profile] = await db
    .select({ warehouseAddresses: organizationProfile.warehouseAddresses })
    .from(organizationProfile)
    .where(eq(organizationProfile.organizationId, orgId))
    .limit(1);
  const addresses = (profile?.warehouseAddresses as { label?: string }[] | null) ?? [];
  return addresses.find((w) => w.label?.trim())?.label ?? "Default";
}

// Every org owned by the same owner as currentOrgId — same "owner org group"
// concept duplicated across server/inventory.ts, server/field-stock.ts,
// lib/inventory/create-movement.ts etc. Needed below because a Case DO's
// application specialist is sometimes a person whose real field stock for
// the case's products was transferred to them under a SIBLING org (e.g. the
// org that's actually responsible for that product category), not
// necessarily the org the DO itself is being filed under.
async function getOwnerOrgIdsInternal(currentOrgId: string): Promise<string[]> {
  const [ownerMember] = await db
    .select({ userId: member.userId })
    .from(member)
    .where(and(eq(member.organizationId, currentOrgId), eq(member.role, "owner"), isNull(member.deletedAt)))
    .limit(1);
  if (!ownerMember) return [currentOrgId];

  const ownedOrgs = await db
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(and(eq(member.userId, ownerMember.userId), eq(member.role, "owner"), isNull(member.deletedAt)));

  const ids = ownedOrgs.map((o) => o.organizationId);
  return ids.length ? ids : [currentOrgId];
}

// A Case DO deducts from the application specialist's OWN field stock, which
// may have been transferred to them under a different sibling org than the
// one this DO is filed under (e.g. laser stock lives under Smart Innosys's
// ledger even when the case is invoiced through Affirma). Prefer the DO's
// own org when it already holds a positive balance there (the common,
// single-org case — no behavior change); otherwise route the deduction to
// whichever sibling org actually holds this rep's stock for this product, so
// the org that's invoicing and the org whose inventory physically moved can
// legitimately differ.
async function resolveFieldStockOrg(preferredOrgId: string, productId: string, warehouseLabel: string): Promise<string> {
  const ownerOrgIds = await getOwnerOrgIdsInternal(preferredOrgId);
  if (ownerOrgIds.length === 1) return preferredOrgId;

  const rows = await db
    .select({ organizationId: stockLevel.organizationId, quantity: stockLevel.quantity })
    .from(stockLevel)
    .where(and(
      inArray(stockLevel.organizationId, ownerOrgIds),
      eq(stockLevel.productId, productId),
      eq(stockLevel.warehouseLabel, warehouseLabel),
    ));

  const inPreferredOrg = rows.find((r) => r.organizationId === preferredOrgId);
  if (inPreferredOrg && parseFloat(inPreferredOrg.quantity) > 0) return preferredOrgId;

  const elsewhere = rows.find((r) => parseFloat(r.quantity) > 0);
  return elsewhere?.organizationId ?? preferredOrgId;
}

async function generateDoNo(orgId: string): Promise<string> {
  const cfg = await getNumberingConfig(orgId, "do");
  const year = new Date().getFullYear();
  const existing = await db
    .select()
    .from(deliveryOrderCounter)
    .where(eq(deliveryOrderCounter.organizationId, orgId))
    .limit(1);
  let nextNo: number;
  if (existing.length === 0) {
    await db.insert(deliveryOrderCounter).values({ id: nanoid(), organizationId: orgId, year, lastNumber: 1 });
    nextNo = 1;
  } else {
    const counter = existing[0];
    nextNo = counter.year === year ? counter.lastNumber + 1 : 1;
  }
  // Unique across the owner's companies, not just this one — skip any number
  // a sibling company already used, and move the counter past it.
  const { seq, docNo } = await nextFreeDocNo(DO_NUMBERED, orgId, nextNo, (n) => buildDocumentNo(cfg, year, n));
  await db.update(deliveryOrderCounter).set({ year, lastNumber: seq }).where(eq(deliveryOrderCounter.organizationId, orgId));
  return docNo;
}

const DO_NUMBERED = { table: deliveryOrder, id: deliveryOrder.id, organizationId: deliveryOrder.organizationId, number: deliveryOrder.doNo };

export type DeliveryOrderRow = typeof deliveryOrder.$inferSelect;
export type DeliveryOrderItem = typeof deliveryOrderItem.$inferSelect;
export type DeliveryOrderCustomerItem = typeof deliveryOrderCustomerItem.$inferSelect;
export type DeliveryOrderWithItems = DeliveryOrderRow & {
  items: DeliveryOrderItem[];
  // Case DO (two-step): what the customer copy shows and the invoice bills
  customerItems: DeliveryOrderCustomerItem[];
  createdByName: string | null; invoiceId: string | null; invoiceNo: string | null;
  invoiceStatus?: string | null;
  // Normal DO: goods the customer sent back (all or part), with who / when / why
  returns?: (typeof deliveryOrderReturn.$inferSelect)[];
};
export type DeliveryOrderListRow = DeliveryOrderRow & { createdByName: string | null; invoiceId: string | null; invoiceNo: string | null };

export type DoForInvoice = {
  id: string;
  doNo: string;
  salesOrderId: string | null;
  salesOrderNo: string | null;
  customerPoId: string | null;
  customerPoNo: string | null;
  customerId: string | null;
  customerSnapshot: { title?: string; name: string; organizationName?: string; organizationAddress?: string; email?: string; contactNo?: string } | null;
  // From linked SO (when available)
  salesPersonId: string | null;
  salesPersonName: string | null;
  associateSalesPersons: { id: string; name: string }[] | null;
  quotationId: string | null;
  quotationNo: string | null;
  // From linked quotation (via SO)
  paymentTerm: string | null;
  paymentTermDays: number | null;
  dueDate: Date | null;
  // From linked purchase order (via SO)
  supplierId: string | null;
  deliveryDate: Date | null;
  deliveryAddress: string | null;
  items: Array<{
    rowNo: number;
    productId: string | null;
    productCode: string | null;
    description: string | null;
    qty: string | null;
    uom: string | null;
    unitPrice: string | null;
    discountPct: string | null;
    costUnitPrice: string | null;
    lineType: string | null;
    rentalDuration: string | null;
    rentalUnit: string | null;
    setGroupId: string | null;
    setGroupLabel: string | null;
    setQty: string | null;
  }>;
};

const EDITABLE_STATUSES = new Set(["draft"]);

// ── Fulfillment helpers ────────────────────────────────────────────────────

export type SoItemRemaining = {
  soItemId: string;
  rowNo: number;
  productId: string | null;
  productCode: string | null;
  description: string | null;
  uom: string | null;
  sourceCustomerPoId: string | null;
  originalQty: string;
  deliveredQty: string;
  remainingQty: string;
};

// Called after creating a DO — if every SO item is fully covered, closes the SO.
async function checkAndFulfillSo(soId: string, orgId: string): Promise<void> {
  const soItems = await db
    .select({ id: salesOrderItem.id, qty: salesOrderItem.qty })
    .from(salesOrderItem)
    .where(eq(salesOrderItem.salesOrderId, soId));

  if (soItems.length === 0) return;

  const itemIds = soItems.map((i) => i.id);

  const deliveredRows = await db
    .select({
      soItemId: deliveryOrderItem.soItemId,
      total: sql<string>`coalesce(sum(${deliveryOrderItem.qty}::numeric), 0)::text`,
    })
    .from(deliveryOrderItem)
    .innerJoin(deliveryOrder, eq(deliveryOrderItem.deliveryOrderId, deliveryOrder.id))
    .where(and(
      eq(deliveryOrder.salesOrderId, soId),
      eq(deliveryOrder.organizationId, orgId),
      ne(deliveryOrder.status, "cancelled"),
      inArray(deliveryOrderItem.soItemId as any, itemIds),
    ))
    .groupBy(deliveryOrderItem.soItemId);

  const deliveredMap = new Map(deliveredRows.map((r) => [r.soItemId as string, parseFloat(r.total)]));

  const allFulfilled = soItems.every((item) => {
    const delivered = deliveredMap.get(item.id) ?? 0;
    return delivered >= parseFloat(item.qty ?? "0");
  });

  if (allFulfilled) {
    await db
      .update(salesOrder)
      .set({ status: "fulfilled", updatedAt: new Date() })
      .where(and(eq(salesOrder.id, soId), eq(salesOrder.organizationId, orgId)));
  }
}

// Returns per-item remaining quantities for the create-DO form.
export async function getSoRemainingItems(soId: string): Promise<SoItemRemaining[]> {
  const { orgId } = await requireAccess("delivery-order:read");

  const items = await db
    .select({
      id: salesOrderItem.id,
      rowNo: salesOrderItem.rowNo,
      productId: salesOrderItem.productId,
      productCode: salesOrderItem.productCode,
      description: salesOrderItem.description,
      qty: salesOrderItem.qty,
      uom: salesOrderItem.uom,
      sourceCustomerPoId: salesOrderItem.sourceCustomerPoId,
    })
    .from(salesOrderItem)
    .innerJoin(salesOrder, eq(salesOrder.id, salesOrderItem.salesOrderId))
    .where(and(eq(salesOrderItem.salesOrderId, soId), eq(salesOrder.organizationId, orgId)))
    .orderBy(asc(salesOrderItem.rowNo));

  if (items.length === 0) return [];

  const itemIds = items.map((i) => i.id);

  const deliveredRows = await db
    .select({
      soItemId: deliveryOrderItem.soItemId,
      total: sql<string>`coalesce(sum(${deliveryOrderItem.qty}::numeric), 0)::text`,
    })
    .from(deliveryOrderItem)
    .innerJoin(deliveryOrder, eq(deliveryOrderItem.deliveryOrderId, deliveryOrder.id))
    .where(and(
      eq(deliveryOrder.salesOrderId, soId),
      eq(deliveryOrder.organizationId, orgId),
      ne(deliveryOrder.status, "cancelled"),
      inArray(deliveryOrderItem.soItemId as any, itemIds),
    ))
    .groupBy(deliveryOrderItem.soItemId);

  const deliveredMap = new Map(deliveredRows.map((r) => [r.soItemId as string, parseFloat(r.total)]));

  return items.map((item) => {
    const originalQty = parseFloat(item.qty ?? "0");
    const deliveredQty = deliveredMap.get(item.id) ?? 0;
    const remainingQty = Math.max(0, originalQty - deliveredQty);
    return {
      soItemId: item.id,
      rowNo: item.rowNo,
      productId: item.productId,
      productCode: item.productCode,
      description: item.description,
      uom: item.uom,
      sourceCustomerPoId: item.sourceCustomerPoId,
      originalQty: originalQty.toFixed(item.qty?.includes(".") ? 2 : 0),
      deliveredQty: deliveredQty.toFixed(item.qty?.includes(".") ? 2 : 0),
      remainingQty: remainingQty.toFixed(item.qty?.includes(".") ? 2 : 0),
    };
  });
}

// Returns a map of soItemId → delivered qty, used in the SO detail page.
export async function getSoItemDeliveredQtys(soId: string): Promise<Record<string, number>> {
  const { orgId } = await requireAccess("delivery-order:read");

  const rows = await db
    .select({
      soItemId: deliveryOrderItem.soItemId,
      total: sql<string>`coalesce(sum(${deliveryOrderItem.qty}::numeric), 0)::text`,
    })
    .from(deliveryOrderItem)
    .innerJoin(deliveryOrder, eq(deliveryOrderItem.deliveryOrderId, deliveryOrder.id))
    .where(and(
      eq(deliveryOrder.salesOrderId, soId),
      eq(deliveryOrder.organizationId, orgId),
      ne(deliveryOrder.status, "cancelled"),
      isNotNull(deliveryOrderItem.soItemId),
    ))
    .groupBy(deliveryOrderItem.soItemId);

  return Object.fromEntries(rows.map((r) => [r.soItemId as string, parseFloat(r.total)]));
}

export interface DeliveryOrderItemInput extends CustomerView {
  rowNo: number;
  soItemId?: string;
  productId?: string;
  productCode?: string;
  description?: string;
  qty?: string;
  uom?: string;
  setGroupId?: string;
  setGroupLabel?: string;
  setQty?: string;
  loanOut?: boolean;
  // Which specific asset_unit this line represents (serial-tracked products
  // only). When present, its fixed intendedUse (SALE/RENTAL) — set when the
  // unit entered inventory — determines loanOut server-side; the client's
  // own loanOut is ignored so the person creating the DO can't override it.
  unitId?: string;
  // Loan-out (machine) lines: back with the specialist after the case, or
  // left at the hospital until returned from the DO page (default "stays");
  // and the per-case usage fee charged to the hospital, if any.
  loanReturnMode?: "same_day" | "stays";
  usageFee?: string;
  loanPurpose?: "RENTAL" | "LOAN" | "DEMO";
  unitPrice?: string; // Case DO itemized selling price per unit
}

export interface CaseCustomerItemInput {
  productId?: string | null; productCode?: string | null; description?: string | null;
  qty: string; uom?: string | null; unitPrice?: string | null;
}

export interface CreateDeliveryOrderInput {
  // Case DO (two-step): the customer items (customer copy + invoice). The
  // actual items (`items`) may be empty — recorded after the case.
  customerItems?: CaseCustomerItemInput[];
  // Case DO selling price: a price per line, or one total for the case
  priceMode?: "itemized" | "total";
  casePrice?: string;
  customerId?: string;
  customerOrgMemberId?: string;
  salesOrderId?: string;
  salesOrderNo?: string;
  customerPoId?: string;
  customerPoNo?: string;
  deliveredTo?: string;
  deliveryAddress?: string;
  deliveryDate?: Date;
  notes?: string;
  items: DeliveryOrderItemInput[];
  // Case DO fields
  isCaseDo?: boolean;
  salesPersonId?: string;
  salesPersonName?: string;
  applicationSpecialistId?: string;
  applicationSpecialistName?: string;
  caseDate?: Date;
  mrnNo?: string;
  categoryIds?: string[];
  caseDescription?: string;
  caseTemplateId?: string;
}

export interface UpdateDeliveryOrderInput extends Omit<CreateDeliveryOrderInput, "items"> {
  id: string;
  status?: string;
  items: DeliveryOrderItemInput[];
}

export async function getDeliveryOrdersBySoId(
  soId: string,
): Promise<{ id: string; doNo: string; customerPoId: string | null; customerPoNo: string | null; status: string }[]> {
  const { orgId } = await requireAccess("delivery-order:read");
  return db
    .select({
      id: deliveryOrder.id,
      doNo: deliveryOrder.doNo,
      customerPoId: deliveryOrder.customerPoId,
      customerPoNo: deliveryOrder.customerPoNo,
      status: deliveryOrder.status,
    })
    .from(deliveryOrder)
    .where(and(eq(deliveryOrder.salesOrderId, soId), eq(deliveryOrder.organizationId, orgId)))
    .orderBy(asc(deliveryOrder.createdAt));
}

const DO_PAGE_SIZE = 50;

export type DeliveryOrderListResult = {
  rows: DeliveryOrderListRow[];
  total: number;
  page: number;
  pageSize: number;
};

export async function getDeliveryOrders(opts: {
  page?: number;
  search?: string;
  status?: string;
} = {}): Promise<DeliveryOrderListResult> {
  const { orgId } = await requireAccess("delivery-order:read");
  const page     = Math.max(1, opts.page ?? 1);
  const pageSize = DO_PAGE_SIZE;
  const offset   = (page - 1) * pageSize;

  const conditions: any[] = [eq(deliveryOrder.organizationId, orgId)];
  if (opts.status) conditions.push(eq(deliveryOrder.status, opts.status));
  if (opts.search?.trim()) {
    const q = `%${opts.search.trim()}%`;
    conditions.push(or(
      sql`${deliveryOrder.doNo} ILIKE ${q}`,
      sql`${deliveryOrder.salesOrderNo} ILIKE ${q}`,
      sql`${deliveryOrder.customerPoNo} ILIKE ${q}`,
      sql`${deliveryOrder.deliveredTo} ILIKE ${q}`,
      sql`${deliveryOrder.status} ILIKE ${q}`,
      sql`(${deliveryOrder.customerSnapshot}->>'name') ILIKE ${q}`,
      sql`(${deliveryOrder.customerSnapshot}->>'organizationName') ILIKE ${q}`,
    ));
  }

  const where = and(...conditions);

  const [rows, [{ total }]] = await Promise.all([
    db.select().from(deliveryOrder).where(where)
      .orderBy(desc(deliveryOrder.doNo))
      .limit(pageSize).offset(offset),
    db.select({ total: count() }).from(deliveryOrder).where(where),
  ]);

  if (rows.length === 0) return { rows: [], total: Number(total), page, pageSize };

  const deliveredIds = rows.filter((r) => r.status === "delivered").map((r) => r.id);
  const [users, invoiceRows] = await Promise.all([
    db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, [...new Set(rows.map((r) => r.createdBy))])),
    deliveredIds.length > 0
      ? db.select({ deliveryOrderId: invoice.deliveryOrderId, id: invoice.id, invoiceNo: invoice.invoiceNo })
          .from(invoice)
          .where(and(inArray(invoice.deliveryOrderId as any, deliveredIds), eq(invoice.organizationId, orgId), ne(invoice.status, "cancelled")))
      : Promise.resolve([]),
  ]);
  const nameOf = (id: string) => users.find((u) => u.id === id)?.name ?? null;
  const invByDo = new Map(invoiceRows.map((i) => [i.deliveryOrderId, { id: i.id, no: i.invoiceNo }]));

  return {
    rows: rows.map((r) => ({
      ...r,
      createdByName: nameOf(r.createdBy),
      invoiceId: invByDo.get(r.id)?.id ?? null,
      invoiceNo: invByDo.get(r.id)?.no ?? null,
    })),
    total: Number(total),
    page,
    pageSize,
  };
}

export async function getDeliveryOrderDetail(id: string): Promise<DeliveryOrderWithItems | null> {
  const { orgId } = await requireAccess("delivery-order:read");
  const [do_] = await db
    .select()
    .from(deliveryOrder)
    .where(and(eq(deliveryOrder.id, id), eq(deliveryOrder.organizationId, orgId)));
  if (!do_) return null;
  const [items, customerItems, users, invoiceRows, returns] = await Promise.all([
    db.select().from(deliveryOrderItem).where(eq(deliveryOrderItem.deliveryOrderId, id)).orderBy(asc(deliveryOrderItem.rowNo)),
    db.select().from(deliveryOrderCustomerItem).where(eq(deliveryOrderCustomerItem.deliveryOrderId, id)).orderBy(asc(deliveryOrderCustomerItem.rowNo)),
    db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, [do_.createdBy])),
    db.select({ id: invoice.id, invoiceNo: invoice.invoiceNo, status: invoice.status })
      .from(invoice)
      .where(and(eq(invoice.deliveryOrderId, id), eq(invoice.organizationId, orgId)))
      // the live invoice first; a cancelled one only if there is nothing else
      .orderBy(sql`${invoice.status} = 'cancelled'`, desc(invoice.createdAt))
      .limit(1),
    db.select().from(deliveryOrderReturn).where(eq(deliveryOrderReturn.deliveryOrderId, id)).orderBy(asc(deliveryOrderReturn.createdAt)),
  ]);
  const nameOf = (uid: string | null) => users.find((u) => u.id === uid)?.name ?? null;
  return {
    ...do_,
    items,
    customerItems,
    createdByName: nameOf(do_.createdBy),
    invoiceId: invoiceRows[0]?.id ?? null,
    invoiceNo: invoiceRows[0]?.invoiceNo ?? null,
    invoiceStatus: invoiceRows[0]?.status ?? null,
    returns,
  };
}

export type DoForPdfItem = DeliveryOrderItem & {
  unitPrice: string | null;
  totalPrice: string | null;
  // Case DO copies: the product's MDA registration (customer copy lists only
  // items with a valid one), and the machine's serial number
  mdaRegNo: string | null;
  mdaExpiredOn: string | null;
  mdaValid: boolean;
  serialNo: string | null;
  // custShow "product": the MDA of the product printed instead
  custMda: { mdaRegNo: string | null; mdaExpiredOn: string | null; mdaValid: boolean } | null;
};

export type DoForPdfResult = {
  order: DeliveryOrderRow;
  items: DoForPdfItem[];
  // Two-step Case DO: the customer copy prints these (null = an older Case DO,
  // whose customer copy is made from its actual items)
  customerItems: DoForPdfItem[] | null;
  ownerOrgIds: string[];
  caseInfo: { categories: string[]; specialist: string | null } | null;
  org: {
    companyName: string;
    companyAddress: string | null;
    taxNo: string | null;
    brandColor: string | null;
    phone: string | null;
    email: string | null;
    website: string | null;
    oldSsmNo: string | null;
    newSsmNo: string | null;
    mdaEstablishmentNo: string | null;
    mofNo: string | null;
    headerLayout: string | null;
    orgNameSize: string | null;
    orgNameBold: number | null;
    orgNameUppercase: number | null;
    // boxes after the item table (customer-facing copies)
    doFooterNotes: string | null;
    doShowBank: boolean;
    doShowReceivedBy: boolean;
    bank: { bankName: string; accountHolder: string; accountNo: string; branchName: string; swiftCode: string } | null;
  };
};

// Delivery order items carry no pricing of their own — only an optional
// soItemId link back to the sales order line it fulfils. Pricing here is
// sourced by joining through that link; items without one (e.g. the
// case-tracking-sync-generated DOs) simply have no price to show.
export async function getDoForPdf(id: string): Promise<DoForPdfResult | null> {
  const { orgId } = await requireAccess("delivery-order:read");
  const [do_] = await db
    .select()
    .from(deliveryOrder)
    .where(and(eq(deliveryOrder.id, id), eq(deliveryOrder.organizationId, orgId)));
  if (!do_) return null;

  const [items, custRows, orgProfile] = await Promise.all([
    db.select().from(deliveryOrderItem).where(eq(deliveryOrderItem.deliveryOrderId, id)).orderBy(asc(deliveryOrderItem.rowNo)),
    db.select().from(deliveryOrderCustomerItem).where(eq(deliveryOrderCustomerItem.deliveryOrderId, id)).orderBy(asc(deliveryOrderCustomerItem.rowNo)),
    getOrganizationProfile(),
  ]);

  const soItemIds = items.map((i) => i.soItemId).filter((v): v is string => !!v);
  const soItems = soItemIds.length
    ? await db.select({ id: salesOrderItem.id, unitPrice: salesOrderItem.unitPrice, totalPrice: salesOrderItem.totalPrice, discountPct: salesOrderItem.discountPct })
        .from(salesOrderItem)
        .where(inArray(salesOrderItem.id, soItemIds))
    : [];
  const priceBySoItemId = new Map(soItems.map((s) => [s.id, s]));

  // Case-tracking-sync-generated DOs have a single item with no soItemId
  // link (they were never built from a real sales order). Their price is
  // still known — it's the total on the invoice already raised against
  // this exact DO — so fall back to that for the one-item case.
  let fallbackPrice: string | null = null;
  if (items.length === 1 && !items[0].soItemId) {
    const [linkedInvoice] = await db
      .select({ grandTotal: invoice.grandTotal })
      .from(invoice)
      .where(and(eq(invoice.deliveryOrderId, id), eq(invoice.organizationId, orgId)))
      .limit(1);
    fallbackPrice = linkedInvoice?.grandTotal ?? null;
  }

  // MDA registration per product (by id, else by code in the owner group) + serial numbers
  const ownerOrgIds = await getOwnerOrgIdsInternal(orgId);
  const prodIds = [...new Set([...items.flatMap((i) => [i.productId, i.custShow === "product" ? i.custProductId : null]), ...custRows.map((c) => c.productId)].filter(Boolean) as string[])];
  const codes = [...new Set([...items.flatMap((i) => [i.productCode, i.custShow === "product" ? i.custCode : null]), ...custRows.map((c) => c.productCode)].filter(Boolean) as string[])];
  const mdaRows = prodIds.length || codes.length ? await db.select({ id: productTable.id, code: productTable.productCode, reg: productTable.mdaRegistrationNo, exp: productTable.mdaExpiredOn })
    .from(productTable).where(and(inArray(productTable.organizationId, ownerOrgIds), or(
      prodIds.length ? inArray(productTable.id, prodIds) : sql`false`, codes.length ? inArray(productTable.productCode, codes) : sql`false`,
    ))) : [];
  const unitIds = items.map((i) => i.unitId).filter(Boolean) as string[];
  const serials = new Map((unitIds.length ? await db.select({ id: assetUnit.id, sn: assetUnit.serialNo }).from(assetUnit).where(inArray(assetUnit.id, unitIds)) : []).map((u) => [u.id, u.sn]));
  const onDate = do_.caseDate ?? do_.createdAt;
  const mdaFor = (i: { productId: string | null; productCode: string | null }) => {
    const own = mdaRows.find((m) => m.id === i.productId && m.reg);
    const any = own ?? mdaRows.find((m) => m.code === i.productCode && m.reg);
    const reg = any?.reg?.trim() || null;
    const exp = any?.exp ?? null;
    return { mdaRegNo: reg, mdaExpiredOn: exp, mdaValid: !!reg && (!exp || new Date(exp) >= new Date(new Date(onDate).toDateString())) };
  };
  // Price per DO line ("with price" PDF):
  //  • from a sales order: this DO's qty × the SO unit price, less its discount
  //    (not the SO line total — a DO may deliver only part of it)
  //  • Case DO: the line's own selling price, or a lent machine's usage fee
  //    (+ its sale price if the hospital kept it); a total-priced case prices
  //    the case as a whole (package line added in the PDF), items "included"
  //  • otherwise a one-line DO takes its invoice total
  const money = (v: string | null | undefined) => (v !== null && v !== undefined && v !== "" && !isNaN(Number(v)) ? Number(v) : null);
  const linePrice = (item: typeof items[number]): { unitPrice: string | null; totalPrice: string | null } => {
    const qty = money(item.qty) ?? 0;
    if (do_.isCaseDo) {
      const fee = money(item.usageFee), sale = money(item.salePrice);
      if (fee !== null || sale !== null) return { unitPrice: (fee ?? sale)!.toFixed(2), totalPrice: ((fee ?? 0) + (sale ?? 0)).toFixed(2) };
      if (do_.priceMode === "total") return { unitPrice: null, totalPrice: null };
      const up = money(item.unitPrice);
      return up === null ? { unitPrice: null, totalPrice: null } : { unitPrice: up.toFixed(2), totalPrice: (up * qty).toFixed(2) };
    }
    const so = item.soItemId ? priceBySoItemId.get(item.soItemId) : undefined;
    if (so) {
      const up = money(so.unitPrice) ?? 0;
      const disc = money(so.discountPct) ?? 0;
      return { unitPrice: up.toFixed(2), totalPrice: (up * qty * (1 - disc / 100)).toFixed(2) };
    }
    return { unitPrice: fallbackPrice, totalPrice: fallbackPrice };
  };

  let caseInfo: DoForPdfResult["caseInfo"] = null;
  if (do_.isCaseDo) {
    const { documentCategory } = await import("@/db/schema");
    const cats = do_.categoryIds?.length ? await db.select({ name: documentCategory.name }).from(documentCategory).where(inArray(documentCategory.id, do_.categoryIds)) : [];
    caseInfo = { categories: cats.map((c) => c.name), specialist: do_.applicationSpecialistName ?? null };
  }

  // Customer items as printable lines. A machine line takes the serial no. and
  // loan of the unit recorded as actually used (same product), and — when it
  // has no price of its own — that unit's usage fee
  const customerItems: DoForPdfItem[] | null = custRows.length ? custRows.map((c) => {
    const used = items.filter((i) => i.productId && i.productId === c.productId);
    const machine = used.find((i) => i.unitId);
    const fee = used.reduce((a, i) => a + (money(i.usageFee) ?? 0), 0);
    const qty = money(c.qty) ?? 0;
    const up = do_.priceMode === "total" ? null : money(c.unitPrice) ?? (fee > 0 ? fee / Math.max(qty, 1) : null);
    const base = items[0] ?? ({} as typeof items[number]);
    return {
      ...base, id: c.id, deliveryOrderId: id, rowNo: c.rowNo, soItemId: null, productId: c.productId, productCode: c.productCode,
      description: c.description, qty: c.qty, uom: c.uom, setGroupId: null, setGroupLabel: null, setQty: null,
      unitId: machine?.unitId ?? null, loanReturnMode: machine?.loanReturnMode ?? null, usageFee: null, loanPurpose: machine?.loanPurpose ?? null,
      salePrice: null, custShow: null, custProductId: null, custCode: null, custDescription: null, custQty: null, custUom: null, custReason: null,
      unitPrice: up === null ? null : up.toFixed(2), totalPrice: up === null ? null : (up * qty).toFixed(2),
      // a free-text line (no catalogue product, e.g. a package name) prints as written
      ...(c.productId || c.productCode ? mdaFor({ productId: c.productId, productCode: c.productCode }) : { mdaRegNo: null, mdaExpiredOn: null, mdaValid: true }),
      serialNo: used.map((i) => (i.unitId ? serials.get(i.unitId) : null)).filter(Boolean).join(", ") || null,
      custMda: null,
    } as DoForPdfItem;
  }) : null;

  return {
    order: do_,
    ownerOrgIds,
    caseInfo,
    customerItems,
    items: items.map((item) => ({
      ...item,
      ...linePrice(item),
      ...mdaFor(item),
      serialNo: item.unitId ? serials.get(item.unitId) ?? null : null,
      // the product shown instead on the customer copy, with its own MDA
      custMda: item.custShow === "product" ? mdaFor({ productId: item.custProductId, productCode: item.custCode }) : null,
    })),
    org: {
      companyName:        orgProfile.companyName ?? "Company",
      companyAddress:     orgProfile.companyAddress ?? null,
      taxNo:              orgProfile.taxNo ?? null,
      brandColor:         orgProfile.brandColor ?? null,
      phone:              orgProfile.phone ?? null,
      email:              orgProfile.email ?? null,
      website:            orgProfile.website ?? null,
      oldSsmNo:           orgProfile.oldSsmNo ?? null,
      newSsmNo:           orgProfile.newSsmNo ?? null,
      mdaEstablishmentNo: orgProfile.mdaEstablishmentNo ?? null,
      mofNo:              orgProfile.mofNo ?? null,
      headerLayout:       orgProfile.headerLayout ?? null,
      orgNameSize:        orgProfile.orgNameSize ?? null,
      orgNameBold:        orgProfile.orgNameBold ?? null,
      orgNameUppercase:   orgProfile.orgNameUppercase ?? null,
      doFooterNotes:      orgProfile.doFooterNotes ?? null,
      doShowBank:         (orgProfile.doShowBank ?? 1) === 1,
      doShowReceivedBy:   (orgProfile.doShowReceivedBy ?? 1) === 1,
      // the primary bank account (else the first) for "payment details"
      bank: (() => {
        const list = (orgProfile.bankingInfo ?? []) as { bankName: string; accountHolder: string; accountNo: string; branchName: string; swiftCode: string; isPrimary: boolean }[];
        const b = list.find((x) => x.isPrimary) ?? list[0];
        return b && b.accountNo ? { bankName: b.bankName ?? "", accountHolder: b.accountHolder ?? "", accountNo: b.accountNo, branchName: b.branchName ?? "", swiftCode: b.swiftCode ?? "" } : null;
      })(),
    },
  };
}

export async function getDoForInvoice(id: string): Promise<DoForInvoice | null> {
  const { orgId } = await requireAccess("invoice:create");
  const [do_] = await db
    .select()
    .from(deliveryOrder)
    .where(and(eq(deliveryOrder.id, id), eq(deliveryOrder.organizationId, orgId)));
  // Invoiced only once delivered — a draft has no DO number yet for the
  // invoice to refer to (a cancelled Case DO is never invoiced)
  if (!do_ || do_.status !== "delivered") return null;

  const items = await db
    .select()
    .from(deliveryOrderItem)
    .where(eq(deliveryOrderItem.deliveryOrderId, id))
    .orderBy(asc(deliveryOrderItem.rowNo));
  // Two-step Case DO: the hospital is billed for its customer items
  const custRows = do_.isCaseDo
    ? await db.select().from(deliveryOrderCustomerItem).where(eq(deliveryOrderCustomerItem.deliveryOrderId, id)).orderBy(asc(deliveryOrderCustomerItem.rowNo))
    : [];

  // Walk the chain: DO → SO → CPO → Quotation to inherit all document links
  let salesPersonId: string | null = null;
  let salesPersonName: string | null = null;
  let associateSalesPersons: { id: string; name: string }[] | null = null;
  let quotationId: string | null = null;
  let quotationNo: string | null = null;
  let paymentTerm: string | null = null;
  let paymentTermDays: number | null = null;
  let dueDate: Date | null = null;
  let supplierId: string | null = null;
  // Effective CPO: DO may not store it, fall back to SO's CPO
  let effectiveCpoId: string | null = do_.customerPoId ?? null;
  let effectiveCpoNo: string | null = do_.customerPoNo ?? null;
  const soItemPriceMap = new Map<string, { unitPrice: string; discountPct: string; lineType: string; rentalDuration: string | null; rentalUnit: string | null; setGroupId: string | null; setGroupLabel: string | null; setQty: string | null }>();
  const poItemCostMap = new Map<string, string>(); // productCode → costUnitPrice

  if (do_.salesOrderId) {
    const [so] = await db
      .select({
        salesPersonId: salesOrder.salesPersonId,
        salesPersonName: salesOrder.salesPersonName,
        associateSalesPersons: salesOrder.associateSalesPersons,
        quotationId: salesOrder.quotationId,
        quotationNo: salesOrder.quotationNo,
        customerPoId: salesOrder.customerPoId,
        customerPoNo: salesOrder.customerPoNo,
      })
      .from(salesOrder)
      .where(and(eq(salesOrder.id, do_.salesOrderId), eq(salesOrder.organizationId, orgId)));
    if (so) {
      salesPersonId = so.salesPersonId;
      salesPersonName = so.salesPersonName;
      associateSalesPersons = (so.associateSalesPersons as { id: string; name: string }[] | null) ?? null;
      quotationId = so.quotationId;
      quotationNo = so.quotationNo;
      // Fall back to SO's CPO if the DO didn't store it
      if (!effectiveCpoId && so.customerPoId) {
        effectiveCpoId = so.customerPoId;
        effectiveCpoNo = so.customerPoNo ?? null;
      }
    }

    // If SO has no direct quotation link, check via the effective CPO
    if (!quotationId && effectiveCpoId) {
      const [cpo] = await db
        .select({ quotationId: customerPurchaseOrder.quotationId, quotationNo: customerPurchaseOrder.quotationNo })
        .from(customerPurchaseOrder)
        .where(eq(customerPurchaseOrder.id, effectiveCpoId));
      if (cpo?.quotationId) {
        quotationId = cpo.quotationId;
        quotationNo = cpo.quotationNo ?? null;
      }
    }

    // Fetch quotation's paymentTerm; also use its salesperson if SO didn't set one
    if (quotationId) {
      const [q] = await db
        .select({
          paymentTerm: quotation.paymentTerm,
          qSalesPersonId: quotation.salesPersonId,
          qSalesPersonName: quotation.salesPersonName,
        })
        .from(quotation)
        .where(eq(quotation.id, quotationId));
      if (q) {
        paymentTerm = q.paymentTerm;
        if (!salesPersonId && q.qSalesPersonId) {
          salesPersonId = q.qSalesPersonId;
          salesPersonName = q.qSalesPersonName;
        }
        // Parse payment term days (e.g. "30 days", "Net 30", "30 DAYS")
        const match = q.paymentTerm?.match(/\b(\d+)\b/);
        if (match) {
          paymentTermDays = parseInt(match[1], 10);
          const d = new Date();
          d.setDate(d.getDate() + paymentTermDays);
          dueDate = d;
        }
      }
    }

    // Fetch first linked PO for supplierId + cost pricing per productCode
    const [po] = await db
      .select({ id: purchaseOrder.id, supplierId: purchaseOrder.supplierId })
      .from(purchaseOrder)
      .where(and(eq(purchaseOrder.salesOrderId, do_.salesOrderId), eq(purchaseOrder.organizationId, orgId)))
      .limit(1);
    if (po) {
      supplierId = po.supplierId;
      // Fetch PO items to get cost unit prices keyed by productCode
      const poItems = await db
        .select({ productCode: purchaseOrderItem.productCode, unitPrice: purchaseOrderItem.unitPrice })
        .from(purchaseOrderItem)
        .where(eq(purchaseOrderItem.purchaseOrderId, po.id));
      for (const pi of poItems) {
        if (pi.productCode) poItemCostMap.set(pi.productCode, pi.unitPrice ?? "0");
      }
    }

    // Fetch SO items — pricing + tags; build multiple lookup maps for fallback matching
    const soItems = await db
      .select({
        id: salesOrderItem.id,
        rowNo: salesOrderItem.rowNo,
        productCode: salesOrderItem.productCode,
        unitPrice: salesOrderItem.unitPrice,
        discountPct: salesOrderItem.discountPct,
        lineType: salesOrderItem.lineType,
        rentalDuration: salesOrderItem.rentalDuration,
        rentalUnit: salesOrderItem.rentalUnit,
        setGroupId: salesOrderItem.setGroupId,
        setGroupLabel: salesOrderItem.setGroupLabel,
        setQty: salesOrderItem.setQty,
      })
      .from(salesOrderItem)
      .where(eq(salesOrderItem.salesOrderId, do_.salesOrderId))
      .orderBy(asc(salesOrderItem.rowNo));
    for (const si of soItems) {
      const data = {
        unitPrice: si.unitPrice ?? "0",
        discountPct: si.discountPct ?? "0",
        lineType: si.lineType ?? "sell",
        rentalDuration: si.rentalDuration ?? null,
        rentalUnit: si.rentalUnit ?? null,
        setGroupId: si.setGroupId ?? null,
        setGroupLabel: si.setGroupLabel ?? null,
        setQty: si.setQty ?? null,
      };
      soItemPriceMap.set(si.id, data);
      if (si.productCode) soItemPriceMap.set(`pc:${si.productCode}`, data);
      soItemPriceMap.set(`row:${si.rowNo}`, data);
    }
  }

  const feeBilled = new Set<string>(); // products whose usage fee is on a customer line
  // Total-priced Case DO: the package line is named after the case
  let packageName = do_.caseDescription?.trim() || "";
  if (!packageName && do_.isCaseDo && do_.caseTemplateId) {
    const { caseTemplate } = await import("@/db/schema");
    const [t] = await db.select({ name: caseTemplate.name }).from(caseTemplate).where(eq(caseTemplate.id, do_.caseTemplateId)).limit(1);
    packageName = t?.name ?? "";
  }
  if (!packageName) packageName = do_.applicationSpecialistName ? `case by ${do_.applicationSpecialistName}` : "case";

  return {
    id: do_.id,
    doNo: do_.doNo,
    salesOrderId: do_.salesOrderId,
    salesOrderNo: do_.salesOrderNo,
    customerPoId: effectiveCpoId,
    customerPoNo: effectiveCpoNo,
    customerId: do_.customerId,
    customerSnapshot: do_.customerSnapshot as DoForInvoice["customerSnapshot"],
    salesPersonId,
    salesPersonName,
    associateSalesPersons,
    quotationId,
    quotationNo,
    paymentTerm,
    paymentTermDays,
    dueDate,
    supplierId,
    deliveryDate: do_.deliveryDate,
    deliveryAddress: do_.deliveryAddress,
    items: [
      // customer items (two-step Case DO) — priced per item, or "included" in a total
      ...custRows.map((c) => {
        // a machine line without its own price is charged the usage fee of the
        // unit actually lent for it (that fee line is then not repeated below)
        const fee = !c.unitPrice && c.productId ? items.filter((i) => i.productId === c.productId && i.usageFee).reduce((a, i) => a + Number(i.usageFee), 0) : 0;
        // a machine on the customer copy is billed there (its price, or its fee) — never again below
        if (c.productId) feeBilled.add(c.productId);
        return {
          rowNo: c.rowNo, productId: c.productId, productCode: c.productCode,
          description: fee > 0 ? `${c.description ?? c.productCode ?? "Machine"} — usage fee (per case)`
            : do_.priceMode === "total" ? `${c.description ?? c.productCode ?? ""} (included)` : c.description,
          qty: c.qty, uom: c.uom,
          unitPrice: fee > 0 ? (fee / Math.max(Number(c.qty) || 1, 1)).toFixed(2) : do_.priceMode === "total" ? "0" : c.unitPrice,
          discountPct: "0", costUnitPrice: null,
          lineType: null, rentalDuration: null, rentalUnit: null, setGroupId: null, setGroupLabel: null, setQty: null,
        };
      }),
      ...items.flatMap((i) => {
      // with customer items, actual items only add machine usage fees / sales
      // not already billed on a customer line
      if (custRows.length && !i.salePrice && (!i.usageFee || (i.productId && feeBilled.has(i.productId)))) return [];
      // Look up SO item data: by soItemId first, then productCode, then rowNo
      const soData =
        (i.soItemId ? soItemPriceMap.get(i.soItemId) : undefined) ??
        (i.productCode ? soItemPriceMap.get(`pc:${i.productCode}`) : undefined) ??
        soItemPriceMap.get(`row:${i.rowNo}`);
      // Partly returned: bill only what the customer kept
      const kept = i.returnedQty ? parseFloat(i.qty ?? "1") - parseFloat(i.returnedQty) : null;
      if (kept !== null && kept <= 1e-9) return [];
      const line = {
        rowNo: i.rowNo,
        productId: i.productId ?? null,
        productCode: i.productCode ?? null,
        description: i.description ?? null,
        qty: kept !== null ? String(kept) : (i.qty ?? null),
        uom: i.uom ?? null,
        // A Case DO machine's per-case usage fee is what the hospital pays for it
        ...(i.usageFee ? { description: `${i.description ?? i.productCode ?? "Machine"} — usage fee (per case)` } : {}),
        ...(!i.usageFee && do_.isCaseDo && do_.priceMode === "total" && do_.casePrice ? { description: `${i.description ?? i.productCode ?? ""} (included)` } : {}),
        // Case DO: its usage fee, else the itemized price; a total-priced case
        // charges the package line below, so its items are "included" at 0
        unitPrice: i.usageFee ?? (do_.isCaseDo ? (do_.priceMode === "total" ? "0" : i.unitPrice ?? null) : null) ?? soData?.unitPrice ?? null,
        discountPct: soData?.discountPct ?? null,
        costUnitPrice: i.productCode ? (poItemCostMap.get(i.productCode) ?? null) : null,
        lineType: soData?.lineType ?? null,
        rentalDuration: soData?.rentalDuration ?? null,
        rentalUnit: soData?.rentalUnit ?? null,
        setGroupId: soData?.setGroupId ?? null,
        setGroupLabel: soData?.setGroupLabel ?? null,
        setQty: soData?.setQty ?? null,
      };

      // A lent machine the hospital kept: the sale is its own line, beside any usage fee
      if (i.salePrice) {
        const sale = { ...line, description: `${i.description ?? i.productCode ?? "Machine"} — sold`, unitPrice: i.salePrice, discountPct: "0" };
        return i.usageFee && !(i.productId && feeBilled.has(i.productId)) ? [line, sale] : [sale];
      }
      return [line];
    })].flatMap((l, idx) => (
      // Total-priced Case DO: one priced package line first, items after it at 0
      idx === 0 && do_.isCaseDo && do_.priceMode === "total" && do_.casePrice
        ? [{ ...l, productId: null, productCode: null, description: `Case package — ${packageName}${do_.caseDate ? ` (${new Date(do_.caseDate).toLocaleDateString("en-GB")})` : ""}`,
            qty: "1", uom: "case", unitPrice: do_.casePrice, discountPct: "0", costUnitPrice: null, lineType: null, setGroupId: null, setGroupLabel: null, setQty: null }, l]
        : [l]
    )).map((l, idx) => ({ ...l, rowNo: idx + 1 })),
  };
}

/**
 * Take a Case DO's actual items out of the specialist's field stock: own and
 * consigned stock (per the consume order), machines lent or sold (with loan
 * purpose, return mode, usage fee), same-day returns, and per-use consignment
 * settlement. Used when the DO is created with its actual items, and when they
 * are recorded after the case (recordCaseActuals). restoreDoStock undoes it.
 */
async function deductCaseItems(p: {
  orgId: string; userId: string; doId: string; doNo: string;
  specialistId: string; customerId: string | null | undefined;
  items: DeliveryOrderItemInput[];
}) {
  const { orgId, userId } = p;
  const { fieldWarehouseLabel, consignedFieldWarehouseLabel, MOVEMENT_TYPE: MT, REF_TYPE: RT } = await import("@/lib/inventory/constants");
  const fieldLabel = fieldWarehouseLabel(p.specialistId);
  const now = new Date();
  // Consignment module: which stock this (agent) company uses first
  const consumeOrder = await getConsumeOrder(orgId);
  const consumeSource = { type: "CASE_DO" as const, id: p.doId, no: p.doNo };
  // Machines that came back with the specialist the same day
  const sameDayReturns: string[] = [];

  for (const item of p.items) {
    if (!item.productId) continue;
    const qty = parseFloat(item.qty ?? "1");
    if (qty <= 0) continue;

    const [prod] = await db.select({ productCode: productTable.productCode, isRental: productTable.isRental })
      .from(productTable).where(eq(productTable.id, item.productId)).limit(1);
    if (!prod) continue;

    const stockOrgId = await resolveFieldStockOrg(orgId, item.productId, fieldLabel);

    // Serial-tracked line: the unit's own fixed intendedUse decides
    // CASE_USE vs LOAN_OUT — the client's loanOut is ignored so the DO
    // creator can't set it themselves (they only pick which unit was used).
    let loanOut = !!item.loanOut;
    let unit: typeof assetUnit.$inferSelect | null = null;
    if (item.unitId) {
      const ownerOrgIds = await getOwnerOrgIdsInternal(orgId);
      [unit] = await db.select().from(assetUnit)
        .where(and(eq(assetUnit.id, item.unitId), inArray(assetUnit.organizationId, ownerOrgIds)))
        .limit(1);
      if (!unit) throw new Error(`Unit not found for ${prod.productCode}`);
      if (unit.status !== "WITH_REP" || unit.currentHolderUserId !== p.specialistId) {
        throw new Error(`Unit ${unit.serialNo} (${prod.productCode}) is no longer held by this application specialist`);
      }
      loanOut = isLendable(unit.intendedUse); // rental / loan / demo machines are lent, not sold
    }

    // ── Consigned stock (another company's, held by this specialist) ──
    // Consumed through the Consignment module: stock leaves the owner's
    // books at the specialist's consignment location and becomes a
    // billable consumption for settlement with the owner.
    const sameDay = loanOut && item.loanReturnMode === "same_day";
    const fee = parseFloat(item.usageFee ?? "") > 0 ? parseFloat(item.usageFee!) : null;
    // A consigned unit is used only under consignment terms between its owner and this company
    if (unit && isConsignmentLocation(unit.currentWarehouseLabel ?? "")) {
      const noTerms = await missingPairTerms(unit.currentOrgId ?? unit.organizationId, orgId);
      if (noTerms) throw new Error(`${prod.productCode} SN ${unit.serialNo}: ${noTerms}`);
    }
    if (unit && isConsignmentLocation(unit.currentWarehouseLabel ?? "") && loanOut) {
      // A consigned machine is used on the case, never consumed: it stays
      // the owner's, the use is recorded on its consignment (charged per
      // the owner's machine setting) and it is loaned out from there.
      const cl = await consignedLineForUnit(unit.id);
      if (!cl) throw new Error(`Unit ${unit.serialNo} (${prod.productCode}) is not on an open consignment`);
      await recordMachineUse({ header: cl.header, line: cl.line, qty: 1, source: consumeSource, userId, hospitalFee: fee, endCustomerId: p.customerId ?? null, purpose: item.loanPurpose ?? null });
      const label = unit.currentWarehouseLabel!;
      const bal = await bumpLevel(cl.header.organizationId, item.productId, label, -1, cl.line.unitCost);
      const mvId = nanoid();
      await db.insert(stockMovement).values({
        id: mvId, organizationId: cl.header.organizationId, productId: item.productId,
        productCode: prod.productCode, warehouseLabel: label, warehouseTo: null,
        movementType: MT.LOAN_OUT, quantity: "-1.0000", balanceAfter: bal.toFixed(4),
        referenceType: RT.CASE, referenceId: p.doId, referenceNo: p.doNo,
        notes: `Loan out — ${p.doNo} (consigned machine, ${cl.header.consignmentNo})`,
        unitId: unit.id, serialNo: unit.serialNo,
        status: "APPROVED", reviewedBy: userId, reviewedAt: now, createdBy: userId, createdAt: now,
      });
      await db.update(assetUnit).set({ status: "ON_LOAN", currentCustomerId: p.customerId ?? null }).where(eq(assetUnit.id, unit.id));
      if (sameDay) sameDayReturns.push(mvId);
      continue;
    }
    if (unit && isConsignmentLocation(unit.currentWarehouseLabel ?? "")) {
      const used = await consumeConsigned({
        ownerOrgId: unit.currentOrgId ?? unit.organizationId, locationLabel: unit.currentWarehouseLabel!,
        productId: item.productId, qty: 1, unitId: unit.id, source: consumeSource, userId,
      });
      if (used < 1) throw new Error(`Unit ${unit.serialNo} (${prod.productCode}) is not on an open consignment`);
      await db.update(assetUnit).set({ status: "SOLD", currentHolderUserId: null, currentCustomerId: p.customerId ?? null })
        .where(eq(assetUnit.id, unit.id));
      continue;
    }
    let ownQty = qty;
    if (!item.unitId && !loanOut) {
      const held = await consignedHeldByRep(orgId, p.specialistId, item.productId);
      // Only owners that set consignment terms for this company can have their stock used
      const blocked: { qty: number; why: string }[] = [];
      const usable: typeof held.owners = [];
      for (const o of held.owners) {
        const why = await missingPairTerms(o.ownerOrgId, orgId);
        if (why) blocked.push({ qty: o.qty, why }); else usable.push(o);
      }
      held.owners = usable;
      const consignedTotal = held.owners.reduce((s, o) => s + o.qty, 0);
      if (consignedTotal > 0) {
        let want: number;
        if (consumeOrder === "consigned_first") {
          want = Math.min(consignedTotal, qty);
        } else {
          const [own] = await db.select({ q: stockLevel.quantity }).from(stockLevel)
            .where(and(eq(stockLevel.organizationId, stockOrgId), eq(stockLevel.productId, item.productId), eq(stockLevel.warehouseLabel, fieldLabel))).limit(1);
          want = Math.min(consignedTotal, Math.max(0, qty - (parseFloat(own?.q ?? "0") || 0)));
        }
        let consumed = 0;
        for (const o of held.owners) {
          if (consumed >= want - 1e-9) break;
          consumed += await consumeConsigned({
            ownerOrgId: o.ownerOrgId, locationLabel: held.label, productId: item.productId,
            qty: Math.min(o.qty, want - consumed), source: consumeSource, userId,
          });
        }
        ownQty = qty - consumed;
      }
      // What's left must come from the specialist's own stock — never silently
      // from consigned stock the company has no terms for
      if (blocked.length && ownQty > 1e-9) {
        const [own] = await db.select({ q: stockLevel.quantity }).from(stockLevel)
          .where(and(eq(stockLevel.organizationId, stockOrgId), eq(stockLevel.productId, item.productId), eq(stockLevel.warehouseLabel, fieldLabel))).limit(1);
        const ownHave = parseFloat(own?.q ?? "0") || 0;
        if (ownHave + 1e-9 < ownQty) {
          throw new Error(`${prod.productCode}: ${ownQty} needed but only ${ownHave} is the specialist's own stock; the other ${blocked.reduce((a, b) => a + b.qty, 0)} held is consigned — ${blocked[0].why}`);
        }
      }
    }
    if (ownQty <= 1e-9) continue;

    const movementType = loanOut ? MT.LOAN_OUT : MT.CASE_USE;
    // A note only when the case's own org doesn't match where the stock
    // actually lives — the common single-org case reads exactly as before.
    const crossOrgNote = stockOrgId !== orgId ? ` (stock: sibling org)` : "";
    const baseNotes = (loanOut ? `Loan out — ${p.doNo}` : `Case usage — ${p.doNo}`) + crossOrgNote;

    if (item.unitId) {
      // Serial-tracked line — the specific unit already fully identifies
      // where this qty (always 1) comes from; no bucket depletion needed.
      const [fieldLevel] = await db.select()
        .from(stockLevel)
        .where(and(
          eq(stockLevel.organizationId, stockOrgId),
          eq(stockLevel.productId, item.productId),
          eq(stockLevel.warehouseLabel, fieldLabel),
        )).limit(1);

      const currentQty = parseFloat(fieldLevel?.quantity ?? "0");
      const newQty = Math.max(0, currentQty - qty);

      if (fieldLevel) {
        await db.update(stockLevel).set({ quantity: newQty.toFixed(4), updatedAt: now })
          .where(eq(stockLevel.id, fieldLevel.id));
      }

      const mvId = nanoid();
      if (sameDay) sameDayReturns.push(mvId);
      await db.insert(stockMovement).values({
        id: mvId, organizationId: stockOrgId, productId: item.productId,
        productCode: prod.productCode, warehouseLabel: fieldLabel, warehouseTo: null,
        movementType,
        quantity: (-qty).toFixed(4), balanceAfter: newQty.toFixed(4),
        referenceType: RT.CASE, referenceId: p.doId, referenceNo: p.doNo,
        notes: baseNotes,
        unitId: item.unitId,
        status: "APPROVED", reviewedBy: userId, reviewedAt: now, createdBy: userId, createdAt: now,
      });
    } else {
      // Bulk (non-serialized) line — deplete any consigned buckets held at
      // this rep before touching their own owned field stock, so
      // borrowed-from-a-sibling-org stock gets used (and settled) first.
      // See lib/inventory/constants.ts for the label convention.
      const ownerOrgIds = await getOwnerOrgIdsInternal(stockOrgId);
      const candidateLabels = [
        ...ownerOrgIds.map((x) => consignedFieldWarehouseLabel(p.specialistId!, x)),
        fieldLabel,
      ];

      let remaining = ownQty;
      for (const label of candidateLabels) {
        if (remaining <= 0) break;
        const isLast = label === fieldLabel;

        const [level] = await db.select()
          .from(stockLevel)
          .where(and(
            eq(stockLevel.organizationId, stockOrgId),
            eq(stockLevel.productId, item.productId),
            eq(stockLevel.warehouseLabel, label),
          )).limit(1);

        const available = parseFloat(level?.quantity ?? "0");
        if (available <= 0 && !isLast) continue; // nothing in this bucket, try the next
        // On the final (owned) bucket, take whatever remains even if it
        // exceeds what's on hand — matches the original behavior of never
        // blocking a Case DO for insufficient stock, just clamping at 0.
        const take = isLast ? remaining : Math.min(available, remaining);
        const newQty = Math.max(0, available - take);

        if (level) {
          await db.update(stockLevel).set({ quantity: newQty.toFixed(4), updatedAt: now })
            .where(eq(stockLevel.id, level.id));
        }

        const mvId = nanoid();
        if (sameDay) sameDayReturns.push(mvId);
        await db.insert(stockMovement).values({
          id: mvId, organizationId: stockOrgId, productId: item.productId,
          productCode: prod.productCode, warehouseLabel: label, warehouseTo: null,
          movementType,
          quantity: (-take).toFixed(4), balanceAfter: newQty.toFixed(4),
          referenceType: RT.CASE, referenceId: p.doId, referenceNo: p.doNo,
          notes: isLast ? baseNotes : `${baseNotes} (consigned stock)`,
          unitId: null,
          status: "APPROVED", reviewedBy: userId, reviewedAt: now, createdBy: userId, createdAt: now,
        });

        remaining -= take;
      }
    }

    if (unit) {
      await db.update(assetUnit).set({
        status: loanOut ? "ON_LOAN" : "SOLD",
        currentCustomerId: p.customerId ?? null,
      }).where(eq(assetUnit.id, unit.id));
    }
  }

  // Same-day machines: loaned out and back in one go, so the history shows
  // the case while the machine stays with the specialist
  for (const mvId of sameDayReturns) {
    await applyLoanReturn({ movementId: mvId, qty: Infinity, doId: p.doId, doNo: p.doNo, userId, note: `Returned same day — ${p.doNo}` });
  }

  revalidatePath("/dashboard/inventory/field-stock");
  revalidatePath("/dashboard/inventory");

  // Consignment: settle this DO's consumption right away where the owner
  // chose automatic, per-use settlement. Never fails the DO — anything not
  // settled here stays unsettled and is picked up by a manual settlement.
  // A draft has no DO number yet: it is settled when marked as delivered.
  if (isDraftDoNo(p.doNo)) return;
  try {
    await autoSettlePerUse({ agentOrgId: orgId, sourceId: p.doId, sourceNo: p.doNo, userId });
  } catch (e) {
    console.error("Consignment auto-settlement failed:", e);
  }
}

/**
 * Customer-copy settings of Case DO lines, checked: complete, and any product
 * shown instead is one of the group's. Returns per-row values to store.
 */
async function customerViews(orgId: string, items: DeliveryOrderItemInput[], isCase: boolean) {
  const out = new Map<number, Required<CustomerView>>();
  if (!isCase) return out;
  const ids = [...new Set(items.map((i) => (i.custShow === "product" ? i.custProductId : null)).filter(Boolean) as string[])];
  const ok = new Set(ids.length ? (await db.select({ id: productTable.id }).from(productTable)
    .where(and(inArray(productTable.id, ids), inArray(productTable.organizationId, await getOwnerOrgIdsInternal(orgId))))).map((p) => p.id) : []);
  for (const i of items) {
    if (!i.custShow) continue;
    const c = cleanCustomerView(i, true);
    if ("error" in c) throw new Error(`${i.productCode || i.description || `Row ${i.rowNo}`}: ${c.error}`);
    if (c.view.custShow === "product" && !ok.has(c.view.custProductId!)) throw new Error(`${i.productCode}: the product to show on the customer copy wasn't found`);
    out.set(i.rowNo, c.view);
  }
  return out;
}

export async function createDeliveryOrder(input: CreateDeliveryOrderInput): Promise<DeliveryOrderRow> {
  const { orgId, userId } = await requireAccess("delivery-order:create");

  const customerSnapshot: DeliveryOrderRow["customerSnapshot"] = input.customerId
    // the customer may be on a sister company's list (shared across the group)
    ? await buildCustomerSnapshot(input.customerId, await getOwnerOrgIdsInternal(orgId), input.customerOrgMemberId)
    : null;

  const custViews = await customerViews(orgId, input.items, !!input.isCaseDo);
  if (input.isCaseDo && input.customerItems?.length && input.priceMode !== "total") {
    const bad = await pricedWithoutMda(input.customerItems);
    if (bad.length) throw new Error(pricedWithoutMdaMessage(bad));
  }
  // The specialist whose field stock a Case DO uses is one of this company's own people
  if (input.isCaseDo && input.applicationSpecialistId && !(await isOrgMember(orgId, input.applicationSpecialistId))) {
    throw new Error(`${input.applicationSpecialistName ?? "The application specialist"} isn't a member of this company — choose one of your own people`);
  }
  // No number yet: a draft carries a temporary reference until it is delivered
  const newId = nanoid();
  const doNo = draftDoNo(newId);
  const [row] = await db
    .insert(deliveryOrder)
    .values({
      id: newId,
      organizationId: orgId,
      doNo,
      salesOrderId: input.salesOrderId ?? null,
      salesOrderNo: input.salesOrderNo ?? null,
      customerPoId: input.customerPoId ?? null,
      customerPoNo: input.customerPoNo ?? null,
      customerId: input.customerId ?? null,
      customerSnapshot,
      deliveredTo: input.deliveredTo ?? null,
      deliveryAddress: input.deliveryAddress ?? null,
      deliveryDate: input.deliveryDate ?? null,
      notes: input.notes ?? null,
      status: "draft",
      isCaseDo: input.isCaseDo ?? false,
      salesPersonId: input.salesPersonId ?? null,
      salesPersonName: input.salesPersonName ?? null,
      applicationSpecialistId: input.applicationSpecialistId ?? null,
      applicationSpecialistName: input.applicationSpecialistName ?? null,
      caseDate: input.caseDate ?? null,
      mrnNo: input.mrnNo ?? null,
      caseDescription: input.caseDescription ?? null,
      caseTemplateId: input.caseTemplateId ?? null,
      priceMode: input.isCaseDo ? (input.priceMode === "total" ? "total" : "itemized") : null,
      ...(input.isCaseDo && input.customerItems
        ? { actualStatus: input.items.length ? "recorded" : "pending", actualRecordedAt: input.items.length ? new Date() : null, actualRecordedBy: input.items.length ? userId : null }
        : {}),
      casePrice: input.isCaseDo && input.priceMode === "total" && parseFloat(input.casePrice ?? "") >= 0 ? parseFloat(input.casePrice!).toFixed(2) : null,
      categoryIds: input.categoryIds ?? [],
      createdBy: userId,
    })
    .returning();

  if (input.items.length > 0) {
    await db.insert(deliveryOrderItem).values(
      input.items.map((i) => ({
        id: nanoid(),
        deliveryOrderId: row.id,
        soItemId: i.soItemId ?? null,
        rowNo: i.rowNo,
        productId: i.productId ?? null,
        productCode: i.productCode ?? null,
        description: i.description ?? null,
        qty: i.qty ?? "1",
        uom: i.uom ?? null,
        setGroupId: i.setGroupId ?? null,
        setGroupLabel: i.setGroupLabel ?? null,
        setQty: i.setQty ?? null,
        unitId: i.unitId ?? null,
        loanReturnMode: input.isCaseDo && i.loanOut !== false && i.loanReturnMode ? i.loanReturnMode : null,
        usageFee: input.isCaseDo && parseFloat(i.usageFee ?? "") > 0 ? parseFloat(i.usageFee!).toFixed(2) : null,
        loanPurpose: input.isCaseDo && i.loanOut !== false && i.loanPurpose && i.loanPurpose in LOAN_PURPOSE ? i.loanPurpose : null,
        ...(custViews.get(i.rowNo) ?? {}),
        unitPrice: input.isCaseDo && input.priceMode !== "total" && i.unitPrice !== undefined && i.unitPrice !== "" && parseFloat(i.unitPrice) >= 0 ? parseFloat(i.unitPrice).toFixed(2) : null,
      })),
    );
  }

  if (input.isCaseDo && input.customerItems?.length) {
    await insertCustomerItems(row.id, input.customerItems, input.priceMode === "total");
  }

  // Case DO with its actual items: take them out of the specialist's field stock
  if (input.isCaseDo && input.applicationSpecialistId && input.items.length > 0) {
    try {
      await deductCaseItems({ orgId, userId, doId: row.id, doNo, specialistId: input.applicationSpecialistId, customerId: input.customerId, items: input.items });
    } catch (e) {
      // Nothing half-done: put back what was taken and drop the DO
      await restoreDoStock({ doId: row.id, doNo, activeOrgId: orgId, userId, notes: (code) => `Case DO not created — stock put back: ${code}` }).catch(() => {});
      // The DO never existed: its out-and-back entries (all netting to zero) go with it
      await db.delete(consignEvent).where(eq(consignEvent.sourceId, row.id));
      await db.delete(stockMovement).where(or(eq(stockMovement.referenceId, row.id), like(stockMovement.notes, `%${doNo}%`)));
      await db.delete(deliveryOrder).where(eq(deliveryOrder.id, row.id));
      throw e;
    }
  }

  if (input.salesOrderId) {
    await checkAndFulfillSo(input.salesOrderId, orgId);
  }
  revalidatePath("/dashboard/fulfillment/delivery");
  revalidatePath("/dashboard");
  if (input.salesOrderId) {
    revalidatePath(`/dashboard/sales/order/${input.salesOrderId}`);
    revalidatePath("/dashboard/sales/order");
  }
  return row;
}

export async function updateDeliveryOrder(input: UpdateDeliveryOrderInput): Promise<DeliveryOrderRow> {
  const { orgId } = await requireAccess("delivery-order:update");
  const [existing] = await db
    .select()
    .from(deliveryOrder)
    .where(and(eq(deliveryOrder.id, input.id), eq(deliveryOrder.organizationId, orgId)));
  if (!existing) throw new Error("Delivery order not found");
  if (!EDITABLE_STATUSES.has(existing.status)) throw new Error("Only draft delivery orders can be edited");

  const [row] = await db
    .update(deliveryOrder)
    .set({
      salesOrderId: input.salesOrderId ?? null,
      salesOrderNo: input.salesOrderNo ?? null,
      customerId: input.customerId ?? null,
      customerPoId: input.customerPoId ?? null,
      customerPoNo: input.customerPoNo ?? null,
      deliveredTo: input.deliveredTo ?? null,
      deliveryAddress: input.deliveryAddress ?? null,
      deliveryDate: input.deliveryDate ?? null,
      notes: input.notes ?? null,
      status: input.status ?? existing.status,
      isCaseDo: input.isCaseDo ?? existing.isCaseDo,
      salesPersonId: input.salesPersonId ?? null,
      salesPersonName: input.salesPersonName ?? null,
      applicationSpecialistId: input.applicationSpecialistId ?? null,
      applicationSpecialistName: input.applicationSpecialistName ?? null,
      caseDate: input.caseDate ?? null,
      mrnNo: input.mrnNo ?? null,
      categoryIds: input.categoryIds ?? existing.categoryIds,
    })
    .where(eq(deliveryOrder.id, input.id))
    .returning();

  await db.delete(deliveryOrderItem).where(eq(deliveryOrderItem.deliveryOrderId, input.id));
  if (input.items.length > 0) {
    await db.insert(deliveryOrderItem).values(
      input.items.map((i) => ({
        id: nanoid(),
        deliveryOrderId: input.id,
        rowNo: i.rowNo,
        productId: i.productId ?? null,
        productCode: i.productCode ?? null,
        description: i.description ?? null,
        qty: i.qty ?? "1",
        uom: i.uom ?? null,
        setGroupId: i.setGroupId ?? null,
        setGroupLabel: i.setGroupLabel ?? null,
        setQty: i.setQty ?? null,
        unitId: i.unitId ?? null,
      })),
    );
  }
  return row;
}

/**
 * Change how one Case DO line is printed on the customer copy (any status —
 * it changes no stock: the line's actual item stays what was deducted).
 * Kits are named per line; lines with the same kit name print as one.
 */
export async function setDoItemCustomerView(doId: string, itemId: string, view: CustomerView): Promise<{ ok: true } | { ok: false; title: string }> {
  try {
    const { orgId } = await requireAccess("delivery-order:update");
    const [do_] = await db.select({ id: deliveryOrder.id, isCaseDo: deliveryOrder.isCaseDo }).from(deliveryOrder)
      .where(and(eq(deliveryOrder.id, doId), eq(deliveryOrder.organizationId, orgId))).limit(1);
    if (!do_) return { ok: false, title: "Delivery order not found" };
    if (!do_.isCaseDo) return { ok: false, title: "Customer copy settings are for Case DOs" };
    const [st] = await db.select({ status: deliveryOrder.status }).from(deliveryOrder).where(eq(deliveryOrder.id, doId)).limit(1);
    if (st?.status === "cancelled") return { ok: false, title: "This DO is cancelled — it can't be changed" };
    const [item] = await db.select().from(deliveryOrderItem).where(and(eq(deliveryOrderItem.id, itemId), eq(deliveryOrderItem.deliveryOrderId, doId))).limit(1);
    if (!item) return { ok: false, title: "Line not found" };
    const views = await customerViews(orgId, [{ ...view, rowNo: item.rowNo, productCode: item.productCode ?? undefined, description: item.description ?? undefined, custShow: view.custShow ?? null }], true);
    const v = views.get(item.rowNo) ?? { custShow: null, custProductId: null, custCode: null, custDescription: null, custQty: null, custUom: null, custReason: null };
    await db.update(deliveryOrderItem).set(v).where(eq(deliveryOrderItem.id, itemId));
    revalidatePath(`/dashboard/fulfillment/delivery/${doId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, title: e instanceof Error ? e.message : "Couldn't save" };
  }
}

// ── Case DO in two steps: customer items now, actual items after the case ──

const money2 = (v?: string | null) => (v !== undefined && v !== null && String(v).trim() !== "" && parseFloat(String(v)) >= 0 ? parseFloat(String(v)).toFixed(2) : null);

/** Replace a Case DO's customer items (what the customer copy shows and the invoice bills). */
async function insertCustomerItems(doId: string, items: CaseCustomerItemInput[], totalPriced: boolean) {
  const rows = items
    .filter((i) => (i.productCode?.trim() || i.description?.trim()) && parseFloat(i.qty) > 0)
    .map((i, idx) => ({
      id: nanoid(), deliveryOrderId: doId, rowNo: idx + 1,
      productId: i.productId || null, productCode: i.productCode?.trim() || null, description: i.description?.trim() || null,
      qty: String(parseFloat(i.qty)), uom: i.uom?.trim() || null, unitPrice: totalPriced ? null : money2(i.unitPrice),
    }));
  await db.delete(deliveryOrderCustomerItem).where(eq(deliveryOrderCustomerItem.deliveryOrderId, doId));
  if (rows.length) await db.insert(deliveryOrderCustomerItem).values(rows);
}

async function loadCaseDo(doId: string, orgId: string): Promise<{ error: string } | { do_: DeliveryOrderRow }> {
  const [d] = await db.select().from(deliveryOrder).where(and(eq(deliveryOrder.id, doId), eq(deliveryOrder.organizationId, orgId))).limit(1);
  if (!d) return { error: "Delivery order not found" };
  if (!d.isCaseDo) return { error: "This is not a Case DO" };
  if (d.status === "cancelled") return { error: `${d.doNo} is cancelled — nothing can be changed on it` };
  return { do_: d };
}

/** The DO's invoice unless it was cancelled — a live invoice must be cancelled before the DO is undone. */
async function activeInvoiceOf(doId: string, orgId: string) {
  const [inv] = await db.select({ invoiceNo: invoice.invoiceNo }).from(invoice)
    .where(and(eq(invoice.deliveryOrderId, doId), eq(invoice.organizationId, orgId), ne(invoice.status, "cancelled"))).limit(1);
  return inv ?? null;
}

async function invoiceOf(doId: string, orgId: string) {
  const [inv] = await db.select({ invoiceNo: invoice.invoiceNo }).from(invoice)
    .where(and(eq(invoice.deliveryOrderId, doId), eq(invoice.organizationId, orgId))).limit(1);
  return inv ?? null;
}

/** Change a Case DO's customer items and selling price — until it is invoiced. */
export async function saveCaseCustomerItems(doId: string, input: { items: CaseCustomerItemInput[]; priceMode: "itemized" | "total"; casePrice?: string | null }): Promise<{ ok: true } | { ok: false; title: string }> {
  try {
    const { orgId } = await requireAccess("delivery-order:update");
    const r = await loadCaseDo(doId, orgId);
    if ("error" in r) return { ok: false, title: r.error };
    const inv = await invoiceOf(doId, orgId);
    if (inv) return { ok: false, title: `Already invoiced (${inv.invoiceNo}) — the customer items can't change any more` };
    const total = input.priceMode === "total";
    if (total && money2(input.casePrice) === null) return { ok: false, title: "Enter the total price for the case, or choose itemized pricing" };
    if (!input.items.some((i) => (i.productCode?.trim() || i.description?.trim()) && parseFloat(i.qty) > 0)) return { ok: false, title: "Add at least one item for the customer copy" };
    if (!total) {
      const bad = await pricedWithoutMda(input.items);
      if (bad.length) return { ok: false, title: pricedWithoutMdaMessage(bad) };
    }
    await insertCustomerItems(doId, input.items, total);
    // (touching the DO also tells open pages to refresh)
    await db.update(deliveryOrder).set({ priceMode: total ? "total" : "itemized", casePrice: total ? money2(input.casePrice) : null, updatedAt: new Date() })
      .where(eq(deliveryOrder.id, doId));
    revalidatePath(`/dashboard/fulfillment/delivery/${doId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, title: e instanceof Error ? e.message : "Couldn't save the customer items" };
  }
}

/**
 * After the case: record what was actually used from the specialist's field
 * stock (own / consigned items, the machine units with their loan choices).
 * Stock is deducted now, and the internal copy becomes available.
 */
export async function recordCaseActuals(doId: string, items: Omit<DeliveryOrderItemInput, "rowNo">[]): Promise<{ ok: true } | { ok: false; title: string }> {
  try {
    const { orgId, userId } = await requireAccess("delivery-order:update");
    const r = await loadCaseDo(doId, orgId);
    if ("error" in r) return { ok: false, title: r.error };
    const d = r.do_;
    if (d.actualStatus === "recorded" || (d.actualStatus === null)) return { ok: false, title: "The actual items of this DO are already recorded — undo them first to record again" };
    if (!d.applicationSpecialistId) return { ok: false, title: "This DO has no application specialist — whose field stock was used?" };
    const rows: DeliveryOrderItemInput[] = items.filter((i) => i.productCode || i.description).map((i, idx) => ({ ...i, rowNo: idx + 1 }));
    if (!rows.length) return { ok: false, title: "Select at least one item used" };
    await db.insert(deliveryOrderItem).values(rows.map((i) => ({
      id: nanoid(), deliveryOrderId: doId, rowNo: i.rowNo,
      productId: i.productId ?? null, productCode: i.productCode ?? null, description: i.description ?? null,
      qty: i.qty ?? "1", uom: i.uom ?? null, unitId: i.unitId ?? null,
      loanReturnMode: i.loanOut !== false && i.loanReturnMode ? i.loanReturnMode : null,
      usageFee: parseFloat(i.usageFee ?? "") > 0 ? parseFloat(i.usageFee!).toFixed(2) : null,
      loanPurpose: i.loanOut !== false && i.loanPurpose && i.loanPurpose in LOAN_PURPOSE ? i.loanPurpose : null,
    })));
    try {
      await deductCaseItems({ orgId, userId, doId, doNo: d.doNo, specialistId: d.applicationSpecialistId, customerId: d.customerId, items: rows });
    } catch (e) {
      // Put back whatever was taken before the problem, and drop the lines
      await restoreDoStock({ doId, doNo: d.doNo, activeOrgId: orgId, userId, notes: (code) => `Actual items not recorded — stock put back: ${code}` }).catch(() => {});
      await db.delete(deliveryOrderItem).where(eq(deliveryOrderItem.deliveryOrderId, doId));
      return { ok: false, title: e instanceof Error ? e.message : "Couldn't take the items out of field stock" };
    }
    await db.update(deliveryOrder).set({ actualStatus: "recorded", actualRecordedAt: new Date(), actualRecordedBy: userId, updatedAt: new Date() }).where(eq(deliveryOrder.id, doId));
    revalidatePath(`/dashboard/fulfillment/delivery/${doId}`);
    revalidatePath("/dashboard/fulfillment/delivery");
    return { ok: true };
  } catch (e) {
    return { ok: false, title: e instanceof Error ? e.message : "Couldn't record the actual items" };
  }
}

/** Undo the recorded actual items: stock goes back to the specialist, ready to record again. */
export async function undoCaseActuals(doId: string): Promise<{ ok: true } | { ok: false; title: string }> {
  try {
    const { orgId, userId } = await requireAccess("delivery-order:update");
    const r = await loadCaseDo(doId, orgId);
    if ("error" in r) return { ok: false, title: r.error };
    const d = r.do_;
    if (d.actualStatus !== "recorded") return { ok: false, title: "There are no recorded actual items to undo" };
    await restoreDoStock({ doId, doNo: d.doNo, activeOrgId: orgId, userId, notes: (code) => `Actual items undone — stock returned: ${code}` });
    await db.delete(deliveryOrderItem).where(eq(deliveryOrderItem.deliveryOrderId, doId));
    await db.update(deliveryOrder).set({ actualStatus: "pending", actualRecordedAt: null, actualRecordedBy: null, updatedAt: new Date() }).where(eq(deliveryOrder.id, doId));
    revalidatePath(`/dashboard/fulfillment/delivery/${doId}`);
    revalidatePath("/dashboard/inventory/field-stock");
    return { ok: true };
  } catch (e) {
    return { ok: false, title: e instanceof Error ? e.message : "Couldn't undo the actual items" };
  }
}

/**
 * Cancel (void) a Case DO. Unlike deleting, the DO stays on record — status
 * "cancelled", with who, when and why — so the number sequence and the
 * movement history still explain themselves. All stock it took (own,
 * consigned, machines) comes back through reversing movements. Refused while
 * an invoice is linked (cancel / credit that first) or when consigned use on
 * it is already settled. Needs the "Cancel Case DO" permission.
 */
/**
 * Cancel a DO that should not have happened. It stays on record (its number
 * is kept) marked Cancelled with who, when and why, and all stock it still
 * holds goes back where it came from. A Case DO can be cancelled at any stage;
 * a normal DO once delivered (a draft has no number — delete it instead), and
 * its sales order goes back to awaiting delivery.
 */
export async function cancelDeliveryOrder(doId: string, reason: string): Promise<{ ok: true } | { ok: false; title: string }> {
  try {
    const { orgId, userId } = await requireAccess("delivery-order:cancel");
    const why = reason.trim();
    if (why.length < 3) return { ok: false, title: "Give the reason for cancelling" };
    const [d] = await db.select().from(deliveryOrder).where(and(eq(deliveryOrder.id, doId), eq(deliveryOrder.organizationId, orgId))).limit(1);
    if (!d) return { ok: false, title: "Delivery order not found" };
    if (d.status === "cancelled") return { ok: false, title: `${d.doNo} is already cancelled` };
    if (!d.isCaseDo && d.status === "draft") return { ok: false, title: `${d.doNo} is still a draft — delete it instead` };
    const inv = await activeInvoiceOf(doId, orgId);
    if (inv) return { ok: false, title: `Invoice ${inv.invoiceNo} is linked to ${d.doNo} — cancel the invoice first` };
    // Put back whatever stock the DO still holds (refused — nothing changed —
    // if consigned use on it is already settled)
    await restoreDoStock({ doId, doNo: d.doNo, activeOrgId: orgId, userId, notes: (code) => `DO cancelled — stock returned: ${code}` });
    // A delivered normal DO closed its sales order and released its reservation: undo both
    if (!d.isCaseDo && d.salesOrderId && d.status !== "draft") await reopenSalesOrder(d.salesOrderId, doId, orgId);
    const [me] = await db.select({ name: user.name }).from(user).where(eq(user.id, userId)).limit(1);
    await db.update(deliveryOrder).set({
      status: "cancelled", cancelledAt: new Date(), cancelledBy: userId, cancelledByName: me?.name ?? null, cancelReason: why, updatedAt: new Date(),
    }).where(eq(deliveryOrder.id, doId));
    revalidatePath(`/dashboard/fulfillment/delivery/${doId}`);
    revalidatePath("/dashboard/fulfillment/delivery");
    revalidatePath("/dashboard/inventory/field-stock");
    return { ok: true };
  } catch (e) {
    return { ok: false, title: e instanceof Error ? e.message : "Couldn't cancel the DO" };
  }
}

/** Catalogue search for the customer-copy "show as" product (owner group). */
export async function searchCustomerViewProducts(query: string) {
  const { orgId } = await requireAccess("delivery-order:read");
  const q = query.trim();
  if (q.length < 2) return [];
  return db.select({ id: productTable.id, productCode: productTable.productCode, description: productTable.description, uom: productTable.uom, mdaRegNo: productTable.mdaRegistrationNo })
    .from(productTable)
    .where(and(inArray(productTable.organizationId, await getOwnerOrgIdsInternal(orgId)),
      or(sql`${productTable.productCode} ILIKE ${`%${q}%`}`, sql`${productTable.description} ILIKE ${`%${q}%`}`)))
    .orderBy(asc(productTable.productCode)).limit(20);
}

export interface UpdateDeliveryOrderCaseInfoInput {
  id: string;
  customerPoId?: string | null;
  customerPoNo?: string | null;
  mrnNo?: string | null;
  caseDate?: Date | null;
}

// Narrow, status-independent update for case DOs only. Unlike
// updateDeliveryOrder (draft-only, rewrites items), this touches nothing
// but the CPO link and case MRN/date — the fields that legitimately change
// after a case is already delivered/invoiced, once the hospital issues its
// CPO and the case needs to be resubmitted to their purchasing dept.
export async function updateDeliveryOrderCaseInfo(input: UpdateDeliveryOrderCaseInfoInput): Promise<DeliveryOrderRow> {
  const { orgId } = await requireAccess("delivery-order:update");
  const [existing] = await db
    .select()
    .from(deliveryOrder)
    .where(and(eq(deliveryOrder.id, input.id), eq(deliveryOrder.organizationId, orgId)));
  if (!existing) throw new Error("Delivery order not found");
  if (!existing.isCaseDo) throw new Error("This action is only available for case delivery orders");
  if (existing.status === "cancelled") throw new Error(`${existing.doNo} is cancelled — it can't be changed`);

  const [row] = await db
    .update(deliveryOrder)
    .set({
      customerPoId: input.customerPoId ?? null,
      customerPoNo: input.customerPoNo ?? null,
      mrnNo: input.mrnNo ?? null,
      caseDate: input.caseDate ?? null,
    })
    .where(eq(deliveryOrder.id, input.id))
    .returning();

  revalidatePath("/dashboard/fulfillment/delivery");
  revalidatePath(`/dashboard/fulfillment/delivery/${input.id}`);
  return row;
}

// Owner-only — the DO number is otherwise fixed once auto-generated at
// creation, but a typo or a need to match an external reference sometimes
// has to be corrected after the fact. Checks the same uniqueness the DB
// itself enforces (delivery_order_no_org_uidx) up front so a collision
// surfaces as a clean message instead of a raw constraint violation.
// Resolvable across every org the caller's owner controls, same as
// updatePurchaseOrderNumber — uniqueness is checked against the DO's own
// org, not necessarily the caller's currently active one.
export async function updateDeliveryOrderNumber(id: string, doNoInput: string): Promise<void> {
  const { orgId } = await requireOwner();
  const ownerOrgIds = await getOwnerOrgIdsInternal(orgId);

  const trimmed = doNoInput.trim();
  if (!trimmed) throw new Error("DO number can't be empty");

  const [existing] = await db
    .select({ id: deliveryOrder.id, organizationId: deliveryOrder.organizationId, doNo: deliveryOrder.doNo })
    .from(deliveryOrder)
    .where(and(eq(deliveryOrder.id, id), inArray(deliveryOrder.organizationId, ownerOrgIds)));
  if (!existing) throw new Error("Delivery order not found");
  if (isDraftDoNo(existing.doNo)) throw new Error("A draft has no DO number yet — it is given when the DO is marked as delivered");

  // Checked across every company with the same owner, not just this one
  if (await isDocNoTakenInGroup(DO_NUMBERED, existing.organizationId, trimmed, id)) {
    throw new Error(`DO number "${trimmed}" is already in use`);
  }

  await db.update(deliveryOrder).set({ doNo: trimmed }).where(eq(deliveryOrder.id, id));

  revalidatePath("/dashboard/fulfillment/delivery");
  revalidatePath(`/dashboard/fulfillment/delivery/${id}`);
}

// Put back whatever stock a DO still has out, exactly where it came from.
// Nets every movement recorded against this DO (outs AND any earlier
// returns) per org + product + warehouse, and credits back only what's still
// outstanding — so it never double-counts and is safe to call again.
//
// Looks across the whole owner-org group, not just the active org: a Case DO
// can take its items from a sibling company's field stock (see
// resolveFieldStockOrg), and those movements live under THAT company. The
// return is written back into each movement's own org and warehouse bucket
// (e.g. the rep's field stock), never the active org's main warehouse.
async function restoreDoStock(opts: {
  doId: string;
  doNo: string;
  activeOrgId: string;
  userId: string;
  notes: (productCode: string) => string;
}): Promise<void> {
  // Consigned stock this DO consumed goes back to its consignment location
  // (and stops being billable) — refused if it was already settled. Machine
  // uses on consigned machines are undone the same way (checked first, so a
  // refusal leaves everything untouched).
  const reason = opts.notes("").replace(/[:\s]+$/, "");
  await reverseMachineUse({ sourceType: "CASE_DO", sourceId: opts.doId, reason });
  await reverseConsumption({ sourceType: "CASE_DO", sourceId: opts.doId, userId: opts.userId, reason });
  const groupOrgIds = await getOwnerOrgIdsInternal(opts.activeOrgId);
  const movements = await db
    .select({
      organizationId: stockMovement.organizationId,
      productId: stockMovement.productId,
      productCode: stockMovement.productCode,
      warehouseLabel: stockMovement.warehouseLabel,
      quantity: stockMovement.quantity,
    })
    .from(stockMovement)
    .where(and(
      inArray(stockMovement.organizationId, groupOrgIds),
      eq(stockMovement.referenceId, opts.doId),
      inArray(stockMovement.movementType, [
        MOVEMENT_TYPE.STOCK_OUT, MOVEMENT_TYPE.CASE_USE, MOVEMENT_TYPE.LOAN_OUT,
        MOVEMENT_TYPE.RETURN, MOVEMENT_TYPE.LOAN_RETURN,
      ]),
    ));

  const net = new Map<string, { orgId: string; productId: string; productCode: string; warehouseLabel: string; qty: number }>();
  for (const mv of movements) {
    const key = `${mv.organizationId}::${mv.productId}::${mv.warehouseLabel}`;
    const e = net.get(key) ?? { orgId: mv.organizationId, productId: mv.productId, productCode: mv.productCode, warehouseLabel: mv.warehouseLabel, qty: 0 };
    e.qty += parseFloat(mv.quantity);
    net.set(key, e);
  }

  for (const e of net.values()) {
    if (e.qty >= 0) continue;
    await createApprovedMovement({
      orgId: e.orgId,
      userId: opts.userId,
      productId: e.productId,
      warehouseLabel: e.warehouseLabel,
      movementType: MOVEMENT_TYPE.RETURN,
      quantity: Math.abs(e.qty),
      referenceType: REF_TYPE.DELIVERY_ORDER,
      referenceId: opts.doId,
      referenceNo: opts.doNo,
      notes: opts.notes(e.productCode ?? "").trim(),
    });
  }

  // Serial units this DO used or lent go back to the specialist they came from
  const unitMoves = await db.select({ unitId: stockMovement.unitId, orgId: stockMovement.organizationId, label: stockMovement.warehouseLabel })
    .from(stockMovement)
    .where(and(
      inArray(stockMovement.organizationId, groupOrgIds), eq(stockMovement.referenceId, opts.doId),
      inArray(stockMovement.movementType, [MOVEMENT_TYPE.CASE_USE, MOVEMENT_TYPE.LOAN_OUT]), isNotNull(stockMovement.unitId),
    ));
  if (unitMoves.length) {
    const [do_] = await db.select({ rep: deliveryOrder.applicationSpecialistId }).from(deliveryOrder).where(eq(deliveryOrder.id, opts.doId)).limit(1);
    for (const m of unitMoves) {
      // A machine the hospital kept goes back to being rental / loan / demo
      const [kept] = await db.select({ use: stockMovement.intendedUse }).from(stockMovement).where(and(
        eq(stockMovement.referenceId, opts.doId), eq(stockMovement.movementType, MOVEMENT_TYPE.LOAN_RETURN),
        eq(stockMovement.unitId, m.unitId!), isNotNull(stockMovement.intendedUse),
      )).limit(1);
      await db.update(assetUnit).set({
        status: "WITH_REP", currentOrgId: m.orgId, currentWarehouseLabel: m.label,
        currentHolderUserId: do_?.rep ?? null, currentCustomerId: null,
        ...(kept?.use ? { intendedUse: kept.use } : {}),
      }).where(and(eq(assetUnit.id, m.unitId!), or(
        inArray(assetUnit.status, ["ON_LOAN", "SOLD"]),
        // a consigned machine the hospital kept is already back at its location — only its use needs restoring
        kept?.use ? and(eq(assetUnit.status, "WITH_REP"), eq(assetUnit.currentWarehouseLabel, m.label)) : sql`false`,
      )));
    }
  }
}

export async function deleteDeliveryOrder(id: string): Promise<void> {
  const { orgId, userId } = await requireAccess("delivery-order:delete");
  const [existing] = await db.select().from(deliveryOrder).where(and(eq(deliveryOrder.id, id), eq(deliveryOrder.organizationId, orgId)));
  if (!existing) throw new Error("Delivery order not found");
  // Only a draft is deleted. Once delivered a DO has its number and has moved
  // stock: it is cancelled instead (kept on record with the reason), so the
  // DO numbering never has an unexplained gap.
  if (existing.status !== "draft") {
    throw new Error(`${existing.doNo} is ${existing.status} — cancel it instead (needs the "Cancel Delivery Order" permission); a cancelled DO stays on record with the reason`);
  }
  // A Case DO is deleted only while nothing has happened (made by mistake):
  // once its actual items took stock, it is cancelled instead — it stays on
  // record with the reason, and the DO number sequence has no unexplained gap
  if (existing.isCaseDo && existing.actualStatus !== "pending") {
    throw new Error(`${existing.doNo} has already taken stock — cancel it instead (needs the "Cancel Delivery Order" permission); a cancelled DO stays on record with the reason`);
  }

  // Deleting a DO an invoice already references would orphan that invoice's
  // link — block it rather than leave a dangling deliveryOrderId.
  const [linkedInvoice] = await db
    .select({ id: invoice.id, invoiceNo: invoice.invoiceNo })
    .from(invoice)
    .where(eq(invoice.deliveryOrderId, id))
    .limit(1);
  if (linkedInvoice) {
    throw new Error(`Cannot delete — invoice ${linkedInvoice.invoiceNo} is linked to this delivery order`);
  }

  // Reverse whatever stock this DO actually moved, based on its real
  // movement history rather than trusting `status` — a plain (SO-based) DO
  // only takes stock out once marked "delivered", but a Case DO deducts the
  // rep's field stock immediately at creation via a completely different
  // movement type (CASE_USE/LOAN_OUT against a Field: warehouse) and its own
  // `status` column stays "draft" forever, so a status-only check misses it
  // entirely. Netting every movement this DO has ever recorded (out AND any
  // prior partial return) per product+warehouse and crediting back only
  // what's still net-outstanding also makes this safe to call on a DO
  // that's already been partially or fully returned — nothing double-counts.
  await restoreDoStock({
    doId: id,
    doNo: existing.doNo,
    activeOrgId: orgId,
    userId,
    notes: (code) => `DO deleted — stock returned: ${code}`,
  });

  await db.delete(deliveryOrder).where(eq(deliveryOrder.id, id));
  revalidatePath("/dashboard/fulfillment/delivery");
  revalidatePath("/dashboard");
}

// Returned as data, not thrown: Next.js replaces a thrown server-action
// error's message with a generic one in production builds, so the user would
// never see *why* delivery was refused.
export type DeliverResult =
  | { ok: true }
  | { ok: false; title: string; details?: string[] };

export async function deliverDeliveryOrder(id: string): Promise<DeliverResult> {
  try {
    return await deliverDeliveryOrderInner(id);
  } catch (e) {
    return { ok: false, title: e instanceof Error ? e.message : "Could not mark as delivered" };
  }
}

async function deliverDeliveryOrderInner(id: string): Promise<DeliverResult> {
  const { orgId, userId } = await requireAccess("delivery-order:update");
  const [existing] = await db.select().from(deliveryOrder).where(and(eq(deliveryOrder.id, id), eq(deliveryOrder.organizationId, orgId)));
  if (!existing) return { ok: false, title: "Delivery order not found" };
  if (existing.status !== "draft") {
    return { ok: false, title: `${existing.doNo} is already ${existing.status} — only draft delivery orders can be marked as delivered` };
  }
  // Two-step Case DO: delivered means the case is done — what was actually used must be known
  if (existing.isCaseDo && existing.actualStatus === "pending") {
    return { ok: false, title: "Record the actual items used first — the DO is marked as delivered once the case is done" };
  }

  const warehouseLabel = await resolveMainWarehouseLabel(orgId);

  // Resolve the stock-out step before flipping status, so a genuinely
  // insufficient balance blocks the whole delivery instead of leaving the DO
  // marked "delivered" with its stock/SO-reservation side effects half done.
  const items = await db
    .select()
    .from(deliveryOrderItem)
    .where(eq(deliveryOrderItem.deliveryOrderId, id));

  const itemsWithProduct = items.filter((i) => i.productId);

  // Case DOs already took their stock at creation (CASE_USE / LOAN_OUT from
  // the application specialist's field stock — see createDeliveryOrder).
  // Delivering one is a status change only: a STOCK_OUT here would deduct
  // the same items a second time, and from the active org's main warehouse,
  // which typically doesn't hold field/consignment items at all (→ a
  // spurious "Insufficient stock" that blocked delivery).
  const stockOutItems = existing.isCaseDo ? [] : itemsWithProduct;

  // Check every line BEFORE moving any stock. The stock-outs below run per
  // line, so failing on the first short line used to leave the lines before
  // it already deducted while the DO stayed "draft" — and the user only ever
  // heard about one shortage at a time.
  if (stockOutItems.length > 0) {
    const needByProduct = new Map<string, { code: string; need: number }>();
    for (const i of stockOutItems) {
      const e = needByProduct.get(i.productId!) ?? { code: i.productCode ?? i.productId!, need: 0 };
      e.need += parseFloat(i.qty ?? "1");
      needByProduct.set(i.productId!, e);
    }
    const levels = await db
      .select({ productId: stockLevel.productId, quantity: stockLevel.quantity })
      .from(stockLevel)
      .where(and(
        eq(stockLevel.organizationId, orgId),
        eq(stockLevel.warehouseLabel, warehouseLabel),
        inArray(stockLevel.productId, [...needByProduct.keys()]),
      ));
    const have = new Map(levels.map((l) => [l.productId, parseFloat(l.quantity)]));
    const fmtQty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));
    const short = [...needByProduct.entries()]
      .map(([pid, e]) => ({ ...e, have: have.get(pid) ?? 0 }))
      .filter((e) => e.have < e.need);
    if (short.length > 0) {
      return {
        ok: false,
        title: `Not enough stock in ${warehouseLabel} to deliver ${existing.doNo}`,
        details: short.map((e) => `${e.code}: need ${fmtQty(e.need)}, only ${fmtQty(e.have)} available`),
      };
    }
  }

  // The DO gets its real number now (a draft only carried a temporary reference)
  const doNo = isDraftDoNo(existing.doNo) ? await assignDoNumber(existing) : existing.doNo;

  // STOCK_OUT for each item that has a productId
  await Promise.all(
    stockOutItems.map((i) =>
      createApprovedMovement({
        orgId,
        userId,
        productId: i.productId!,
        warehouseLabel,
        movementType: MOVEMENT_TYPE.STOCK_OUT,
        quantity: parseFloat(i.qty ?? "1"),
        referenceType: REF_TYPE.DELIVERY_ORDER,
        referenceId: id,
        referenceNo: doNo,
        notes: `DO delivery: ${i.productCode ?? ""}`.trim(),
      }),
    ),
  );

  await db.update(deliveryOrder).set({ status: "delivered" }).where(eq(deliveryOrder.id, id));

  // Release SO reservation and close the SO
  if (existing.salesOrderId) {
    await Promise.all([
      ...itemsWithProduct.map((i) =>
        adjustReservation({
          orgId,
          productId: i.productId!,
          warehouseLabel,
          delta: -parseFloat(i.qty ?? "1"),
        }),
      ),
      db
        .update(salesOrder)
        .set({ status: "fulfilled" })
        .where(and(eq(salesOrder.id, existing.salesOrderId), eq(salesOrder.organizationId, orgId))),
    ]);
    revalidatePath(`/dashboard/sales/order/${existing.salesOrderId}`);
    revalidatePath("/dashboard/sales/order");
  }
  // Consigned stock used on a Case DO: per-use settlement waited for the DO number
  if (existing.isCaseDo) {
    try { await autoSettlePerUse({ agentOrgId: orgId, sourceId: id, sourceNo: doNo, userId }); } catch (e) { console.error("Consignment auto-settlement failed:", e); }
  }
  revalidatePath("/dashboard/fulfillment/delivery");
  revalidatePath(`/dashboard/fulfillment/delivery/${id}`);
  revalidatePath("/dashboard/fulfillment/invoice");
  revalidatePath("/dashboard");
  return { ok: true };
}

/**
 * Give a draft its real DO number (on delivery) and carry it onto everything
 * recorded under the temporary reference: the DO's own stock movements (case
 * usage, loans), consignment uses (event source and movement notes) and any
 * invoice snapshot.
 */
async function assignDoNumber(d: { id: string; organizationId: string; doNo: string }): Promise<string> {
  const doNo = await generateDoNo(d.organizationId);
  const old = d.doNo;
  await db.update(deliveryOrder).set({ doNo, updatedAt: new Date() }).where(eq(deliveryOrder.id, d.id));
  await db.update(stockMovement).set({ referenceNo: doNo }).where(and(eq(stockMovement.referenceId, d.id), eq(stockMovement.referenceNo, old)));
  await db.update(stockMovement).set({ notes: sql`replace(${stockMovement.notes}, ${old}, ${doNo})` })
    .where(like(stockMovement.notes, `%${old}%`));
  await db.update(consignEvent).set({ sourceNo: doNo }).where(eq(consignEvent.sourceId, d.id));
  await db.update(invoice).set({ deliveryOrderNo: doNo }).where(eq(invoice.deliveryOrderId, d.id));
  return doNo;
}

export type ReturnResult = { ok: true; full: boolean } | { ok: false; title: string };

/**
 * Goods the customer sent back after a normal DO was delivered — all of it or
 * only some lines / quantities, possibly in several returns. Each quantity goes
 * back into the warehouse it left (a RETURN movement) and the return is kept
 * with who, when and why. Refused while a live invoice is linked (cancel the
 * invoice first, then invoice what the customer kept). Once everything is
 * back the DO is "Returned". A Case DO isn't returned — cancel it instead.
 */
export async function returnDeliveryOrder(id: string, input: { reason: string; items: { itemId: string; qty: number }[] }): Promise<ReturnResult> {
  try {
    const { orgId, userId } = await requireAccess("delivery-order:update");
    const why = input.reason.trim();
    if (why.length < 3) return { ok: false, title: "Give the reason for the return" };
    const [existing] = await db.select().from(deliveryOrder).where(and(eq(deliveryOrder.id, id), eq(deliveryOrder.organizationId, orgId)));
    if (!existing) return { ok: false, title: "Delivery order not found" };
    if (existing.isCaseDo) return { ok: false, title: "A Case DO isn't returned — cancel it instead (machines go back through the Machines box)" };
    if (existing.status !== "delivered") return { ok: false, title: `Only a delivered DO can take a return — ${existing.doNo} is ${existing.status}` };
    const inv = await activeInvoiceOf(id, orgId);
    if (inv) return { ok: false, title: `Invoice ${inv.invoiceNo} is linked to ${existing.doNo} — cancel the invoice first, then invoice what the customer kept` };

    const items = await db.select().from(deliveryOrderItem).where(eq(deliveryOrderItem.deliveryOrderId, id));
    const byId = new Map(items.map((i) => [i.id, i]));
    const wanted = input.items.filter((r) => r.qty > 0);
    if (!wanted.length) return { ok: false, title: "Enter the quantity returned for at least one item" };
    for (const r of wanted) {
      const it = byId.get(r.itemId);
      if (!it) return { ok: false, title: "An item isn't on this DO" };
      const left = parseFloat(it.qty ?? "1") - parseFloat(it.returnedQty ?? "0");
      if (r.qty > left + 1e-9) return { ok: false, title: `${it.productCode ?? it.description ?? "Item"}: only ${left} left to return` };
    }

    // Each product goes back to the warehouse its delivery took it from
    const outs = await db.select({ productId: stockMovement.productId, label: stockMovement.warehouseLabel }).from(stockMovement)
      .where(and(eq(stockMovement.referenceId, id), eq(stockMovement.organizationId, orgId), eq(stockMovement.movementType, MOVEMENT_TYPE.STOCK_OUT)));
    const labelOf = new Map(outs.map((o) => [o.productId, o.label]));
    const fallback = await resolveMainWarehouseLabel(orgId);

    for (const r of wanted) {
      const it = byId.get(r.itemId)!;
      if (it.productId) {
        await createApprovedMovement({
          orgId, userId, productId: it.productId,
          warehouseLabel: labelOf.get(it.productId) ?? fallback,
          movementType: MOVEMENT_TYPE.RETURN, quantity: r.qty,
          referenceType: REF_TYPE.DELIVERY_ORDER, referenceId: id, referenceNo: existing.doNo,
          notes: `DO return: ${it.productCode ?? ""} — ${why}`,
        });
      }
      await db.update(deliveryOrderItem).set({ returnedQty: (parseFloat(it.returnedQty ?? "0") + r.qty).toFixed(4) }).where(eq(deliveryOrderItem.id, it.id));
      it.returnedQty = (parseFloat(it.returnedQty ?? "0") + r.qty).toFixed(4);
    }
    const [me] = await db.select({ name: user.name }).from(user).where(eq(user.id, userId)).limit(1);
    await db.insert(deliveryOrderReturn).values({
      id: nanoid(), deliveryOrderId: id, organizationId: orgId, reason: why, createdBy: userId, createdByName: me?.name ?? null,
      items: wanted.map((r) => { const it = byId.get(r.itemId)!; return { itemId: it.id, productCode: it.productCode, description: it.description, qty: r.qty, uom: it.uom }; }),
    });
    const full = items.every((i) => parseFloat(i.qty ?? "1") - parseFloat(i.returnedQty ?? "0") <= 1e-9);
    await db.update(deliveryOrder).set({ ...(full ? { status: "returned" } : {}), updatedAt: new Date() }).where(eq(deliveryOrder.id, id));

    revalidatePath("/dashboard/fulfillment/delivery");
    revalidatePath(`/dashboard/fulfillment/delivery/${id}`);
    revalidatePath("/dashboard/inventory");
    revalidatePath("/dashboard");
    return { ok: true, full };
  } catch (e) {
    return { ok: false, title: e instanceof Error ? e.message : "Couldn't record the return" };
  }
}

/** A cancelled delivery: its sales order is awaiting delivery again, with its stock reserved as before delivery. */
async function reopenSalesOrder(soId: string, doId: string, orgId: string) {
  const [so] = await db.select({ status: salesOrder.status, reserved: salesOrder.stockReservationStatus }).from(salesOrder)
    .where(and(eq(salesOrder.id, soId), eq(salesOrder.organizationId, orgId))).limit(1);
  if (!so || so.status !== "fulfilled") return;
  await db.update(salesOrder).set({ status: "confirmed" }).where(eq(salesOrder.id, soId));
  if (so.reserved === "reserved") {
    const warehouseLabel = await resolveMainWarehouseLabel(orgId);
    const items = await db.select().from(deliveryOrderItem).where(eq(deliveryOrderItem.deliveryOrderId, doId));
    for (const i of items.filter((x) => x.productId)) {
      await adjustReservation({ orgId, productId: i.productId!, warehouseLabel, delta: parseFloat(i.qty ?? "1") });
    }
  }
  revalidatePath(`/dashboard/sales/order/${soId}`);
  revalidatePath("/dashboard/sales/order");
}

export type PendingSoForDoRow = {
  id: string;
  soNo: string;
  customers: { name: string; organizationName: string | null }[];
  customerPoNos: string[];
  grandTotal: string;
  createdAt: Date;
};

export async function getPendingSosForDo(): Promise<PendingSoForDoRow[]> {
  const { orgId } = await requireAccess("delivery-order:read");

  // Confirmed+reserved SOs that are not yet fulfilled.
  // 'fulfilled' status is set automatically when all item quantities are delivered.
  // Partially-delivered SOs remain 'confirmed' and continue to show here.
  const rows = await db
    .select({
      id: salesOrder.id,
      soNo: salesOrder.soNo,
      customerPoId: salesOrder.customerPoId,
      customerPoNo: salesOrder.customerPoNo,
      customerPoLinks: salesOrder.customerPoLinks,
      grandTotal: salesOrder.grandTotal,
      createdAt: salesOrder.createdAt,
    })
    .from(salesOrder)
    .where(and(
      eq(salesOrder.organizationId, orgId),
      eq(salesOrder.status, "confirmed"),
      eq(salesOrder.stockReservationStatus, "reserved"),
    ))
    .orderBy(desc(salesOrder.createdAt));

  const pendingRows = rows;
  if (pendingRows.length === 0) return [];

  // Fetch CPO customer snapshots for display
  type CpoLink = { customerPoId: string; customerPoNo: string };
  const allCpoIds = [
    ...new Set(
      pendingRows.flatMap((r) => {
        const links = (r.customerPoLinks as CpoLink[] | null) ?? [];
        return links.length > 0
          ? links.map((l) => l.customerPoId)
          : r.customerPoId ? [r.customerPoId] : [];
      }),
    ),
  ];

  const cpoSnapshotMap = new Map<string, { name?: string; organizationName?: string }>();
  if (allCpoIds.length > 0) {
    const cpos = await db
      .select({ id: customerPurchaseOrder.id, customerSnapshot: customerPurchaseOrder.customerSnapshot })
      .from(customerPurchaseOrder)
      .where(inArray(customerPurchaseOrder.id, allCpoIds));
    for (const cpo of cpos) {
      if (cpo.customerSnapshot) cpoSnapshotMap.set(cpo.id, cpo.customerSnapshot as { name?: string; organizationName?: string });
    }
  }

  return pendingRows.map((r) => {
    const links = (r.customerPoLinks as CpoLink[] | null) ?? [];
    const cpoIds = links.length > 0
      ? links.map((l) => l.customerPoId)
      : r.customerPoId ? [r.customerPoId] : [];

    const customerPoNos = links.length > 0
      ? [...new Set(links.map((l) => l.customerPoNo).filter(Boolean))]
      : r.customerPoNo ? [r.customerPoNo] : [];

    const seen = new Set<string>();
    const customers: { name: string; organizationName: string | null }[] = [];
    for (const cpoId of cpoIds) {
      const s = cpoSnapshotMap.get(cpoId);
      const name = s?.name?.trim();
      if (!name) continue;
      const orgName = s?.organizationName?.trim() || null;
      const key = `${name}||${orgName ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      customers.push({ name, organizationName: orgName });
    }

    return { id: r.id, soNo: r.soNo, customers, customerPoNos, grandTotal: r.grandTotal, createdAt: r.createdAt };
  });
}

export type PendingDoForInvoiceRow = {
  id: string;
  doNo: string;
  salesOrderNo: string | null;
  customerPoNo: string | null;
  customerName: string | null;
  customerOrg: string | null;
  createdAt: Date;
};

export async function getPendingDosForInvoice(): Promise<PendingDoForInvoiceRow[]> {
  const { orgId } = await requireAccess("invoice:read");

  // Delivered DOs with no invoice linked (NOT EXISTS avoids nullable-column issues).
  const rows = await db
    .select({
      id: deliveryOrder.id,
      doNo: deliveryOrder.doNo,
      salesOrderNo: deliveryOrder.salesOrderNo,
      customerPoNo: deliveryOrder.customerPoNo,
      customerSnapshot: deliveryOrder.customerSnapshot,
      createdAt: deliveryOrder.createdAt,
    })
    .from(deliveryOrder)
    .where(and(
      eq(deliveryOrder.organizationId, orgId),
      eq(deliveryOrder.status, "delivered"),
      notExists(
        db.select({ _: invoice.id }).from(invoice)
          .where(and(
            eq(invoice.organizationId, orgId),
            eq(invoice.deliveryOrderId, deliveryOrder.id),
            ne(invoice.status, "cancelled"),
          )),
      ),
    ))
    .orderBy(desc(deliveryOrder.doNo));

  return rows.map((r) => {
    const snap = r.customerSnapshot as any;
    const name = snap ? [snap.title, snap.name].filter(Boolean).join(" ") || null : null;
    const org = snap?.organizationName ?? null;
    return {
      id: r.id,
      doNo: r.doNo,
      salesOrderNo: r.salesOrderNo,
      customerPoNo: r.customerPoNo,
      customerName: name,
      customerOrg: org,
      createdAt: r.createdAt,
    };
  });
}

export async function returnRentalItems(
  doId: string,
  returns: { movementId: string; returnQty: number }[],
): Promise<void> {
  const { orgId, userId } = await requireAccess("delivery-order:update");

  const [do_] = await db
    .select({ doNo: deliveryOrder.doNo })
    .from(deliveryOrder)
    .where(and(eq(deliveryOrder.id, doId), eq(deliveryOrder.organizationId, orgId)))
    .limit(1);
  if (!do_) throw new Error("Delivery order not found");

  // The original LOAN_OUT may have posted under a sibling org (see
  // resolveFieldStockOrg above) or, for a consigned machine, under its owner
  // — so the lookup searches the owner group, and the return is written back
  // into the loan movement's own org and warehouse.
  const ownerOrgIds = await getOwnerOrgIdsInternal(orgId);
  for (const { movementId, returnQty } of returns) {
    if (returnQty <= 0) continue;
    await applyLoanReturn({ movementId, qty: returnQty, doId, doNo: do_.doNo, userId, scopeOrgIds: ownerOrgIds });
  }

  revalidatePath("/dashboard/inventory");
  revalidatePath("/dashboard/inventory/movements");
  revalidatePath(`/dashboard/fulfillment/delivery/${doId}`);
}

// Bring a loaned-out item back to where it was lent from (the specialist's
// field stock, or the consignment location for a consigned machine). Caps at
// what is still out on that loan, so it can never return more than was lent.
async function applyLoanReturn(p: { movementId: string; qty: number; doId: string; doNo: string; userId: string; note?: string; scopeOrgIds?: string[] }) {
  const { MOVEMENT_TYPE: MT, REF_TYPE: RT } = await import("@/lib/inventory/constants");
  const [loanMovement] = await db.select().from(stockMovement)
    .where(and(
      eq(stockMovement.id, p.movementId), eq(stockMovement.movementType, MT.LOAN_OUT),
      ...(p.scopeOrgIds ? [inArray(stockMovement.organizationId, p.scopeOrgIds)] : []),
    )).limit(1);
  if (!loanMovement) return;

  // Already returned on this loan (same DO, product, warehouse, unit)
  const returned = await db.select({ q: stockMovement.quantity }).from(stockMovement).where(and(
    eq(stockMovement.referenceId, p.doId), eq(stockMovement.movementType, MT.LOAN_RETURN),
    eq(stockMovement.organizationId, loanMovement.organizationId), eq(stockMovement.productId, loanMovement.productId),
    eq(stockMovement.warehouseLabel, loanMovement.warehouseLabel),
    loanMovement.unitId ? eq(stockMovement.unitId, loanMovement.unitId) : isNull(stockMovement.unitId),
  ));
  const lent = Math.abs(parseFloat(loanMovement.quantity));
  const returnedQty = returned.reduce((s, r) => s + parseFloat(r.q), 0);
  let outstanding = lent - returnedQty;
  if (!loanMovement.unitId) {
    // Bulk: several loans of the same product share one bucket — cap by what the whole DO still has out
    const allLent = await db.select({ q: stockMovement.quantity }).from(stockMovement).where(and(
      eq(stockMovement.referenceId, p.doId), eq(stockMovement.movementType, MT.LOAN_OUT),
      eq(stockMovement.organizationId, loanMovement.organizationId), eq(stockMovement.productId, loanMovement.productId),
      eq(stockMovement.warehouseLabel, loanMovement.warehouseLabel), isNull(stockMovement.unitId),
    ));
    outstanding = Math.min(lent, allLent.reduce((s, r) => s + Math.abs(parseFloat(r.q)), 0) - returnedQty);
  }
  const qty = Math.min(p.qty, outstanding);
  if (qty <= 1e-9) return;

  const movementOrgId = loanMovement.organizationId;
  const now = new Date();
  const [sl] = await db.select().from(stockLevel).where(and(
    eq(stockLevel.organizationId, movementOrgId), eq(stockLevel.productId, loanMovement.productId),
    eq(stockLevel.warehouseLabel, loanMovement.warehouseLabel),
  )).limit(1);
  const newQty = parseFloat(sl?.quantity ?? "0") + qty;
  if (sl) {
    await db.update(stockLevel).set({ quantity: newQty.toFixed(4), updatedAt: now }).where(eq(stockLevel.id, sl.id));
  } else {
    await db.insert(stockLevel).values({
      id: nanoid(), organizationId: movementOrgId, productId: loanMovement.productId,
      warehouseLabel: loanMovement.warehouseLabel, quantity: newQty.toFixed(4),
      reorderPoint: null, maxStock: null, unitCost: null, updatedAt: now,
    });
  }

  await db.insert(stockMovement).values({
    id: nanoid(), organizationId: movementOrgId,
    productId: loanMovement.productId, productCode: loanMovement.productCode,
    warehouseLabel: loanMovement.warehouseLabel, warehouseTo: null,
    movementType: MT.LOAN_RETURN,
    quantity: qty.toFixed(4), balanceAfter: newQty.toFixed(4),
    referenceType: RT.CASE, referenceId: p.doId, referenceNo: p.doNo,
    notes: p.note ?? `Loan return — ${p.doNo}`,
    unitId: loanMovement.unitId ?? null, serialNo: loanMovement.serialNo ?? null,
    status: "APPROVED", reviewedBy: p.userId, reviewedAt: now, createdBy: p.userId, createdAt: now,
  });

  // Serial-tracked unit: back with the rep, ready to be used again.
  if (loanMovement.unitId) {
    await db.update(assetUnit).set({
      status: "WITH_REP",
      currentOrgId: movementOrgId,
      currentWarehouseLabel: loanMovement.warehouseLabel,
      currentCustomerId: null,
    }).where(eq(assetUnit.id, loanMovement.unitId));
  }
}


// ── Case DO machines (loan-out lines) ────────────────────────────────────────

export interface CaseMachine {
  movementId: string;
  productCode: string;
  description: string | null;
  serialNo: string | null;
  qty: number;
  returnedQty: number;
  returnMode: "same_day" | "stays" | "sold" | null;
  purpose: string | null; // RENTAL | LOAN | DEMO
  usageFee: string | null;
  salePrice: string | null; // the hospital kept (bought) it
  returnedAt: Date | null;
  consigned: boolean;
}

/** Machines lent out on a Case DO — and whether each is back with the specialist. */
export async function getCaseMachines(doId: string): Promise<CaseMachine[]> {
  const { orgId } = await requireAccess("delivery-order:read");
  const [do_] = await db.select({ id: deliveryOrder.id }).from(deliveryOrder)
    .where(and(eq(deliveryOrder.id, doId), eq(deliveryOrder.organizationId, orgId))).limit(1);
  if (!do_) return [];
  const groupOrgIds = await getOwnerOrgIdsInternal(orgId);
  const moves = await db.select().from(stockMovement).where(and(
    eq(stockMovement.referenceId, doId), inArray(stockMovement.organizationId, groupOrgIds),
    inArray(stockMovement.movementType, [MOVEMENT_TYPE.LOAN_OUT, MOVEMENT_TYPE.LOAN_RETURN]),
  )).orderBy(asc(stockMovement.createdAt));
  const items = await db.select().from(deliveryOrderItem).where(eq(deliveryOrderItem.deliveryOrderId, doId));
  const outs = moves.filter((m) => m.movementType === MOVEMENT_TYPE.LOAN_OUT);
  // the loan movement only carries a serial for consigned machines — look the rest up
  const outUnitIds = outs.map((o) => o.unitId).filter(Boolean) as string[];
  const unitSerial = new Map((outUnitIds.length ? await db.select({ id: assetUnit.id, sn: assetUnit.serialNo }).from(assetUnit).where(inArray(assetUnit.id, outUnitIds)) : []).map((u) => [u.id, u.sn]));
  const backs = moves.filter((m) => m.movementType === MOVEMENT_TYPE.LOAN_RETURN);
  // Hand each return to the loan it belongs to (same unit, or the same product bucket, oldest loan first)
  const left = new Map(backs.map((b) => [b.id, parseFloat(b.quantity)]));
  return outs.map((o) => {
    const lent = Math.abs(parseFloat(o.quantity));
    let returned = 0; let returnedAt: Date | null = null;
    for (const b of backs) {
      const same = b.organizationId === o.organizationId && b.productId === o.productId && b.warehouseLabel === o.warehouseLabel && (b.unitId ?? null) === (o.unitId ?? null);
      const avail = left.get(b.id) ?? 0;
      if (!same || avail <= 1e-9 || returned >= lent - 1e-9) continue;
      const take = Math.min(avail, lent - returned);
      left.set(b.id, avail - take); returned += take; returnedAt = b.createdAt;
    }
    const item = items.find((i) => (o.unitId ? i.unitId === o.unitId : i.productId === o.productId && !i.unitId && i.loanReturnMode));
    return {
      movementId: o.id, productCode: o.productCode, description: item?.description ?? null, serialNo: o.serialNo ?? (o.unitId ? unitSerial.get(o.unitId) ?? null : null),
      qty: lent, returnedQty: returned, returnMode: (item?.loanReturnMode ?? null) as CaseMachine["returnMode"],
      usageFee: item?.usageFee ?? null, salePrice: item?.salePrice ?? null, purpose: item?.loanPurpose ?? null, returnedAt, consigned: o.warehouseLabel.startsWith("CS:"),
    };
  });
}

/** Bring a machine left at the hospital back to the specialist. Returned as data (see DeliverResult). */
export async function returnCaseMachine(doId: string, movementId: string): Promise<DeliverResult> {
  try {
    const { orgId } = await requireAccess("delivery-order:update");
    const [d] = await db.select({ status: deliveryOrder.status, doNo: deliveryOrder.doNo }).from(deliveryOrder).where(and(eq(deliveryOrder.id, doId), eq(deliveryOrder.organizationId, orgId))).limit(1);
    if (d?.status === "cancelled") return { ok: false, title: `${d.doNo} is cancelled — its machines were already returned` };
    await returnRentalItems(doId, [{ movementId, returnQty: Infinity }]);
    return { ok: true };
  } catch (e) {
    return { ok: false, title: e instanceof Error ? e.message : "Couldn't return the machine" };
  }
}


/**
 * The hospital keeps a machine that was lent on this Case DO and buys it.
 * Recorded as "back from loan, then used up on this case", so the history
 * reads right and deleting the DO still undoes everything. A consigned
 * machine becomes a billable sale to its owner (at the transfer price).
 */
export async function sellCaseMachine(doId: string, movementId: string, price: string): Promise<DeliverResult & { invoiced?: string }> {
  try {
    const { orgId, userId } = await requireAccess("delivery-order:update");
    const amount = parseFloat(price);
    if (!(amount > 0)) return { ok: false, title: "Enter the selling price" };
    const [do_] = await db.select().from(deliveryOrder).where(and(eq(deliveryOrder.id, doId), eq(deliveryOrder.organizationId, orgId))).limit(1);
    if (!do_?.isCaseDo) return { ok: false, title: "Case DO not found" };
    if (do_.status === "cancelled") return { ok: false, title: `${do_.doNo} is cancelled` };
    const machine = (await getCaseMachines(doId)).find((m) => m.movementId === movementId);
    if (!machine) return { ok: false, title: "Machine not found on this DO" };
    if (machine.returnMode === "sold") return { ok: false, title: "This machine is already sold" };
    const qty = machine.qty - machine.returnedQty;
    if (qty <= 1e-9) return { ok: false, title: "This machine is already back with the specialist — sell it on a new DO instead" };

    const [loan] = await db.select().from(stockMovement).where(eq(stockMovement.id, movementId)).limit(1);
    // 1. Back from loan…
    await applyLoanReturn({ movementId, qty, doId, doNo: do_.doNo, userId, note: `Kept by the hospital — sold on ${do_.doNo}` });
    // 2. …and used up on this case
    if (loan.warehouseLabel.startsWith("CS:")) {
      const used = await consumeConsigned({
        ownerOrgId: loan.organizationId, locationLabel: loan.warehouseLabel, productId: loan.productId, qty,
        unitId: loan.unitId, source: { type: "CASE_DO", id: doId, no: do_.doNo }, userId,
      });
      if (used + 1e-9 < qty) throw new Error("The consigned machine could not be recorded as sold");
    } else {
      const now = new Date();
      const bal = await bumpLevel(loan.organizationId, loan.productId, loan.warehouseLabel, -qty, null);
      await db.insert(stockMovement).values({
        id: nanoid(), organizationId: loan.organizationId, productId: loan.productId, productCode: loan.productCode,
        warehouseLabel: loan.warehouseLabel, warehouseTo: null, movementType: MOVEMENT_TYPE.CASE_USE,
        quantity: (-qty).toFixed(4), balanceAfter: bal.toFixed(4),
        referenceType: REF_TYPE.CASE, referenceId: doId, referenceNo: do_.doNo,
        notes: `Machine sold to the hospital — ${do_.doNo}`, unitId: loan.unitId, serialNo: loan.serialNo,
        status: "APPROVED", reviewedBy: userId, reviewedAt: now, createdBy: userId, createdAt: now,
      });
    }
    if (loan.unitId) {
      // Remember what it was (rental / loan / demo) on the "kept" return, so deleting the DO restores it
      const [unit] = await db.select({ use: assetUnit.intendedUse }).from(assetUnit).where(eq(assetUnit.id, loan.unitId)).limit(1);
      await db.update(stockMovement).set({ intendedUse: unit?.use ?? null }).where(and(
        eq(stockMovement.referenceId, doId), eq(stockMovement.movementType, MOVEMENT_TYPE.LOAN_RETURN), eq(stockMovement.unitId, loan.unitId),
      ));
      await db.update(assetUnit).set({ status: "SOLD", intendedUse: "SALE", currentHolderUserId: null, currentCustomerId: do_.customerId ?? null })
        .where(eq(assetUnit.id, loan.unitId));
    }
    const [item] = await db.select().from(deliveryOrderItem).where(and(
      eq(deliveryOrderItem.deliveryOrderId, doId),
      loan.unitId ? eq(deliveryOrderItem.unitId, loan.unitId) : and(eq(deliveryOrderItem.productId, loan.productId), isNotNull(deliveryOrderItem.loanReturnMode)),
    )).limit(1);
    if (item) await db.update(deliveryOrderItem).set({ loanReturnMode: "sold", salePrice: amount.toFixed(2) }).where(eq(deliveryOrderItem.id, item.id));

    if (!isDraftDoNo(do_.doNo)) {
      try { await autoSettlePerUse({ agentOrgId: orgId, sourceId: doId, sourceNo: do_.doNo, userId }); } catch (e) { console.error("Consignment auto-settlement failed:", e); }
    }
    const [inv] = await db.select({ invoiceNo: invoice.invoiceNo }).from(invoice).where(eq(invoice.deliveryOrderId, doId)).limit(1);
    revalidatePath(`/dashboard/fulfillment/delivery/${doId}`);
    revalidatePath("/dashboard/inventory");
    return { ok: true, invoiced: inv?.invoiceNo };
  } catch (e) {
    return { ok: false, title: e instanceof Error ? e.message : "Couldn't record the sale" };
  }
}
