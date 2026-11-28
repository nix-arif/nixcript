"use server";

import { cpoCategories, mapCategoriesToOrg, prCategories, resolveCategories, soCategories } from "@/lib/document-category/inherit";
import { fillPurchaseOrderItemCustomers } from "@/lib/trace/item-customer";
import { db } from "@/db";
import {
  purchaseOrder,
  purchaseOrderItem,
  purchaseOrderCounter,
  purchaseRequisitionCounter,
  invoice,
  deliveryOrder,
  documentCategory,
  purchaseOrderCustomerPo,
  customerPurchaseOrder,
  purchaseRequisition,
  purchaseRequisitionItem,
  salesOrder,
  salesOrderItem,
  product,
  supplier,
  user,
  organization,
  organizationProfile,
  goodsReceipt,
  goodsReceiptItem,
  packingList,
  packingListItem,
  customer,
  customerCompany,
  customerOrganization,
  member,
} from "@/db/schema";
import { nanoid } from "nanoid";
import { newDraftRef, isDraftRef } from "@/lib/draft-ref";
import { soLineQty, soLineQtyText } from "@/lib/sales-order/set-qty";
import { eq, and, ne, desc, asc, inArray, notInArray, sql, ilike, isNotNull, isNull } from "drizzle-orm";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";
import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getNumberingConfig } from "@/server/document-numbering";
import { buildDocumentNo } from "@/lib/document-numbering";
import { nextFreeDocNo, isDocNoTakenInGroup } from "@/lib/document-number-group";
import { revalidatePath } from "next/cache";
import { createApprovedMovement } from "@/lib/inventory/create-movement";
import { MOVEMENT_TYPE, REF_TYPE } from "@/lib/inventory/constants";
import { createNotification, getPoApprovers } from "@/server/notifications";
import { assertSelfActionAllowed } from "@/lib/approvals/guard";
import { maybeCreateIntercompanySalesOrder, intercompanySoCancelBlockers, cancelIntercompanySalesOrdersForPo } from "@/server/sales-order";
import { nextIntercompanyPoNo } from "@/lib/intercompany/icpo-number";
import { assertSupplierAllowed } from "@/server/supplier-restrictions";
import { routeRestrictedSupplier, joinNotes } from "@/lib/org/supplier-routing";
import { priceIntercompanyLines, intercompanyPricingNote, sumTotals, stripPricingNote } from "@/lib/intercompany/pricing";

import { getSession, requireAccess } from "@/lib/auth/require-access";
import { getOwnerOrgIds } from "@/lib/org/owner-orgs";
import { todayKL, toBusinessDate } from "@/lib/org/handling-periods";
// ── R2 supplier-quotation bucket ───────────────────────────────────────────
const s3 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT!,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

const SUPPLIER_QUOTATION_BUCKET = process.env.R2_SUPPLIER_QUOTATION_BUCKET!;

export async function getPoSupplierQuotationUploadUrl(
  filename: string,
): Promise<{ key: string; uploadUrl: string }> {
  await requireAccess("purchase-order:create");
  const key = `supplier-quotations/po/${nanoid()}-${filename}`;
  const cmd = new PutObjectCommand({
    Bucket: SUPPLIER_QUOTATION_BUCKET,
    Key: key,
    ContentType: "application/pdf",
  });
  const uploadUrl = await getSignedUrl(s3, cmd, { expiresIn: 3600 });
  return { key, uploadUrl };
}

export async function getPoSupplierQuotationDownloadUrl(key: string): Promise<string> {
  const cmd = new GetObjectCommand({ Bucket: SUPPLIER_QUOTATION_BUCKET, Key: key });
  return getSignedUrl(s3, cmd, { expiresIn: 3600 });
}

// ── R2 procurement item images (PO/PR attachments — isolated from product catalog) ──
const PROCUREMENT_DOCS_BUCKET = process.env.R2_PROCUREMENT_IMAGES_BUCKET!;

export async function getPoItemImageUploadUrl(
  filename: string,
): Promise<{ key: string; uploadUrl: string }> {
  await requireAccess("purchase-order:create");
  const key = `po-item-images/${nanoid()}-${filename}`;
  const cmd = new PutObjectCommand({ Bucket: PROCUREMENT_DOCS_BUCKET, Key: key });
  const uploadUrl = await getSignedUrl(s3, cmd, { expiresIn: 3600 });
  return { key, uploadUrl };
}

export async function getPoItemImageDownloadUrl(key: string): Promise<string> {
  const cmd = new GetObjectCommand({ Bucket: PROCUREMENT_DOCS_BUCKET, Key: key });
  return getSignedUrl(s3, cmd, { expiresIn: 3600 });
}

export async function deleteProcurementImages(keys: string[]): Promise<void> {
  if (!keys.length) return;
  await requireAccess("purchase-order:create");
  await Promise.allSettled(
    keys.map((key) => s3.send(new DeleteObjectCommand({ Bucket: PROCUREMENT_DOCS_BUCKET, Key: key }))),
  );
}

async function deleteFile(bucket: string, key: string | null | undefined) {
  if (!key) return;
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

// ── Auth helpers ───────────────────────────────────────────────────────────



// For actions restricted to the organization owner regardless of any
// individually granted permission — e.g. deleting a Supplier PO.
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


// ── Running numbers ────────────────────────────────────────────────────────

async function generatePrNo(orgId: string): Promise<string> {
  const cfg = await getNumberingConfig(orgId, "pr");
  const year = new Date().getFullYear();
  const existing = await db
    .select()
    .from(purchaseRequisitionCounter)
    .where(eq(purchaseRequisitionCounter.organizationId, orgId))
    .limit(1);
  let nextNo: number;
  if (existing.length === 0) {
    await db.insert(purchaseRequisitionCounter).values({ id: nanoid(), organizationId: orgId, year, lastNumber: 1 });
    nextNo = 1;
  } else {
    const counter = existing[0];
    nextNo = counter.year === year ? counter.lastNumber + 1 : 1;
    await db
      .update(purchaseRequisitionCounter)
      .set({ year, lastNumber: nextNo })
      .where(eq(purchaseRequisitionCounter.organizationId, orgId));
  }
  return buildDocumentNo(cfg, year, nextNo);
}

const PO_NUMBERED = { table: purchaseOrder, id: purchaseOrder.id, organizationId: purchaseOrder.organizationId, number: purchaseOrder.poNo };

async function generatePoNo(orgId: string): Promise<string> {
  const cfg = await getNumberingConfig(orgId, "po");
  const year = new Date().getFullYear();

  const existing = await db
    .select()
    .from(purchaseOrderCounter)
    .where(eq(purchaseOrderCounter.organizationId, orgId))
    .limit(1);

  let nextNo: number;

  if (existing.length === 0) {
    await db.insert(purchaseOrderCounter).values({ id: nanoid(), organizationId: orgId, year, lastNumber: 1 });
    nextNo = 1;
  } else {
    const counter = existing[0];
    nextNo = counter.year === year ? counter.lastNumber + 1 : 1;
  }

  // Unique across the owner's companies — skip numbers a sibling already used
  const { seq, docNo } = await nextFreeDocNo(PO_NUMBERED, orgId, nextNo, (n) => buildDocumentNo(cfg, year, n));
  await db
    .update(purchaseOrderCounter)
    .set({ year, lastNumber: seq })
    .where(eq(purchaseOrderCounter.organizationId, orgId));

  return docNo;
}


// Auto-raises a value-only intercompany PO when a Case DO invoice is tagged
// with this org's own "Laser" category — the business rule (per discussion):
// Affirma keeps 30% of a laser case's invoiced amount and owes the remaining
// 70% to Smart Innosys, regardless of which org's stock ledger the case's
// CASE_USE deduction actually landed in (see resolveFieldStockOrg in
// server/delivery-order.ts — that's a physical-inventory-accuracy concern,
// separate from who economically owns/bills for the stock).
//
// Deliberately NOT wired through the normal PR→PO→GR→stock-in flow: the
// physical stock already left the building when the case consumed it, so
// this PO carries a single non-stock line (no productId) representing value
// only, and is created already "confirmed" so maybeCreateIntercompanySalesOrder
// fires immediately — no goods receipt should ever happen against it.
//
// Never blocks invoice creation from succeeding — same defensive shape as
// maybeCreateIntercompanySalesOrder, which this ultimately calls into.
export async function maybeCreateIntercompanyPoForCaseInvoice(invoiceId: string): Promise<void> {
  try {
    const [inv] = await db.select().from(invoice).where(eq(invoice.id, invoiceId)).limit(1);
    if (!inv || !inv.deliveryOrderId) return;

    const [do_] = await db
      .select({ isCaseDo: deliveryOrder.isCaseDo })
      .from(deliveryOrder)
      .where(eq(deliveryOrder.id, inv.deliveryOrderId))
      .limit(1);
    if (!do_?.isCaseDo) return;

    if (!inv.categoryIds || inv.categoryIds.length === 0) return;

    // Categories are org-scoped rows (not shared across orgs — see
    // server/document-category.ts), and the intercompany rule is opt-in per
    // category (set via Document Categories in the org settings nav). Take
    // the first rule-bearing category in this org's own display order when
    // an invoice happens to carry more than one — there's no defined
    // semantics yet for combining multiple rules on one invoice.
    const ruleCategories = await db
      .select({ id: documentCategory.id, name: documentCategory.name, intercompanyOrgId: documentCategory.intercompanyOrgId, intercompanySharePercent: documentCategory.intercompanySharePercent })
      .from(documentCategory)
      .where(and(
        eq(documentCategory.organizationId, inv.organizationId),
        inArray(documentCategory.id, inv.categoryIds),
        isNotNull(documentCategory.intercompanyOrgId),
      ))
      .orderBy(asc(documentCategory.position));
    const rule = ruleCategories[0];
    if (!rule?.intercompanyOrgId || !rule.intercompanySharePercent) return;

    // Idempotency — a re-saved/reopened invoice must never raise this twice.
    const [already] = await db.select({ id: purchaseOrder.id }).from(purchaseOrder).where(eq(purchaseOrder.sourceInvoiceId, invoiceId)).limit(1);
    if (already) return;

    const [sup] = await db
      .select({ id: supplier.id })
      .from(supplier)
      .where(and(eq(supplier.organizationId, inv.organizationId), eq(supplier.linkedOrganizationId, rule.intercompanyOrgId)))
      .limit(1);
    // No supplier record links this org to the category's configured
    // target yet — needs a person to set one up (Procurement → Suppliers)
    // before this rule can actually fire.
    if (!sup) return;
    const supplierId = sup.id;

    const grandTotal = parseFloat(inv.grandTotal) || 0;
    if (grandTotal <= 0) return;
    const pct = parseFloat(rule.intercompanySharePercent);
    const share = Math.round(grandTotal * (pct / 100) * 100) / 100;
    if (share <= 0) return;

    const poNo = await nextIntercompanyPoNo(inv.organizationId);
    const poId = nanoid();
    const now = new Date();

    await db.insert(purchaseOrder).values({
      id: poId,
      organizationId: inv.organizationId,
      poNo,
      supplierId,
      sourceInvoiceId: invoiceId,
      categoryIds: inv.categoryIds ?? [],
      subtotal: share.toFixed(2),
      grandTotal: share.toFixed(2),
      currency: "MYR", // invoice carries no currency field of its own — this app is MYR-only throughout
      status: "confirmed",
      notes: `Auto-raised — ${pct}% share of ${rule.name} invoice ${inv.invoiceNo}`,
      createdBy: inv.createdBy,
      approvedBy: inv.createdBy,
      approvedAt: now,
    });

    await db.insert(purchaseOrderItem).values({
      id: nanoid(),
      purchaseOrderId: poId,
      rowNo: 1,
      description: `${rule.name} case usage — Invoice ${inv.invoiceNo} (${pct}% share)`,
      qty: "1",
      unitPrice: share.toFixed(2),
      totalPrice: share.toFixed(2),
      currency: "MYR", // invoice carries no currency field of its own — this app is MYR-only throughout
    });
    await fillPurchaseOrderItemCustomers(poId);

    await maybeCreateIntercompanySalesOrder(poId);

    revalidatePath("/dashboard/procurement/purchase-order");
  } catch (e) {
    console.error("maybeCreateIntercompanyPoForCaseInvoice failed:", e);
  }
}

// ── Types ──────────────────────────────────────────────────────────────────

export type PurchaseOrderRow = typeof purchaseOrder.$inferSelect;
export type PurchaseOrderItem = typeof purchaseOrderItem.$inferSelect;
export type PurchaseOrderItemEnriched = PurchaseOrderItem & { imageUrl: string | null; acceptedQty: number };

export interface PurchaseOrderItemInput {
  rowNo: number;
  productId?: string;
  productCode?: string;
  description?: string;
  qty?: string;
  uom?: string;
  unitPrice?: string;
  currency?: string;
  totalPrice?: string;
  imageKey?: string;
  descriptionSource?: string;
  isAdditional?: boolean;
  editedBy?: string;
  setGroupId?: string;
  setGroupLabel?: string;
  setQty?: string;
  customerId?: string;
  customerOrganizationId?: string;
  customerName?: string;
  customerOrganization?: string;
  customerPoNo?: string;
  sourcingType?: string;
  designBrandName?: string;
  designBrandCode?: string;
  privateLabelCode?: string;
  designBrandSource?: string;
  privateLabelSource?: string;
  oemEditedBy?: string;
}

export interface CreatePurchaseOrderInput {
  /** Save as a draft (the create form auto-saves): no PO number yet, nothing linked or sent on. confirmPurchaseOrder issues it. */
  asDraft?: boolean;
  purchaseRequisitionId?: string; // when set, PO is auto-confirmed (PR approval = authorization)
  salesOrderId?: string;
  supplierId: string;
  supplierQuotationKey?: string;
  customerPoIds?: string[];
  currency?: string;
  sst?: string;
  sstPct?: string;
  subtotal?: string;
  grandTotal?: string;
  notes?: string;
  expectedDeliveryDate?: Date;
  deliveryAddress?: string;
  // Overrides the auto-generated PO number — for backfilling a PO that was
  // already manually issued to the supplier under its own number.
  manualPoNo?: string;
  // The date the PO is made out (YYYY-MM-DD, not after today). Decides which organization handles a restricted
  // supplier: a PO dated before a handover follows the organization that handled the supplier on that date.
  // Left out = today.
  poDate?: string;
  // Only used when the supplier is one of the owner's other organizations: how the lines are priced.
  // Left out, the default rule applies (see lib/intercompany/pricing.ts).
  pricingMethod?: string;
  pricingMarginPct?: string;
  /** Document categories; undefined: its PR's / sales order's / customer POs' (on create) or unchanged (on update) */
  categoryIds?: string[];
  items: PurchaseOrderItemInput[];
}

// ── PR → PO conversion helper ─────────────────────────────────────────────

export type PrForPoConversion = {
  id: string;
  prNo: string;
  salesOrderId: string | null;
  salesOrderNo: string | null;
  soDeliveryDate: Date | null;
  soDeliveryAddress: string | null;
  notes: string | null;
  cpoNos: string[]; // all unique CPO numbers across items
  items: Array<{
    id: string;
    rowNo: number;
    productId: string | null;
    productCode: string | null;
    description: string | null;
    qty: string;
    uom: string | null;
    estimatedUnitCost: string;
    currency: string;
    preferredSupplierId: string | null;
    preferredSupplierName: string | null;
    imageKey: string | null;
    imageUrl: string | null;
    cpoNo: string | null;
    cpoId: string | null;
    customerName: string | null;
    customerOrganization: string | null;
    isAdditional: boolean;
    editedBy: string | null;
  }>;
};

export async function getPrForPoConversion(prId: string): Promise<PrForPoConversion | null> {
  const { orgId } = await requireAccess("purchase-order:create");
  const [pr] = await db
    .select()
    .from(purchaseRequisition)
    .where(and(eq(purchaseRequisition.id, prId), eq(purchaseRequisition.organizationId, orgId)));
  if (!pr) return null;
  if (pr.status !== "approved" && pr.status !== "partially_ordered") return null;

  const [items, cpos, soRow] = await Promise.all([
    db.select().from(purchaseRequisitionItem)
      .where(eq(purchaseRequisitionItem.purchaseRequisitionId, prId))
      .orderBy(asc(purchaseRequisitionItem.rowNo)),
    // Load CPOs linked to the SO so we can resolve cpoNo → cpoId
    pr.salesOrderId
      ? db.select({ id: customerPurchaseOrder.id, customerPoNo: customerPurchaseOrder.customerPoNo })
          .from(customerPurchaseOrder)
          .where(and(eq(customerPurchaseOrder.salesOrderId, pr.salesOrderId), eq(customerPurchaseOrder.organizationId, orgId)))
      : Promise.resolve([]),
    // Load SO delivery fields
    pr.salesOrderId
      ? db.select({ deliveryDate: salesOrder.deliveryDate, deliveryAddress: salesOrder.deliveryAddress })
          .from(salesOrder)
          .where(and(eq(salesOrder.id, pr.salesOrderId), eq(salesOrder.organizationId, orgId)))
          .limit(1)
      : Promise.resolve([]),
  ]);

  // Map cpoNo → cpoId for quick lookup
  const cpoIdByNo = new Map(cpos.map((c) => [c.customerPoNo, c.id]));

  const enrichedItems = await Promise.all(
    items.map(async (i) => {
      let imageUrl: string | null = null;
      if (i.imageKey) {
        try {
          const cmd = new GetObjectCommand({ Bucket: PROCUREMENT_DOCS_BUCKET, Key: i.imageKey });
          imageUrl = await getSignedUrl(s3, cmd, { expiresIn: 7200 });
        } catch {}
      }
      return {
        id: i.id,
        rowNo: i.rowNo,
        productId: i.productId ?? null,
        productCode: i.productCode ?? null,
        description: i.description ?? null,
        qty: soLineQtyText(i), // a PR line in a set is for one set: order for every set
        uom: i.uom ?? null,
        estimatedUnitCost: i.estimatedUnitCost ?? "0",
        currency: i.currency ?? "MYR",
        preferredSupplierId: i.preferredSupplierId ?? null,
        preferredSupplierName: i.preferredSupplierName ?? null,
        imageKey: i.imageKey ?? null,
        imageUrl,
        cpoNo: i.cpoNo ?? null,
        cpoId: i.cpoNo ? (cpoIdByNo.get(i.cpoNo) ?? null) : null,
        customerName: i.customerName ?? null,
        customerOrganization: i.customerOrganization ?? null,
        isAdditional: i.isAdditional ?? false,
        editedBy: i.editedBy ?? null,
      };
    }),
  );

  const cpoNos = [...new Set(enrichedItems.map((i) => i.cpoNo).filter(Boolean) as string[])];

  return {
    id: pr.id,
    prNo: pr.prNo,
    salesOrderId: pr.salesOrderId,
    salesOrderNo: pr.salesOrderNo,
    soDeliveryDate: soRow[0]?.deliveryDate ?? null,
    soDeliveryAddress: soRow[0]?.deliveryAddress ?? null,
    notes: pr.notes,
    cpoNos,
    items: enrichedItems,
  };
}

export interface UpdatePurchaseOrderInput extends Omit<CreatePurchaseOrderInput, "items"> {
  id: string;
  status?: string;
  items: PurchaseOrderItemInput[];
}

// ── Reference data fetchers for PO forms ──────────────────────────────────


// Search the shared customer directory for the PO item "destined-for"
// picker. Scoped the same way the customer directory itself is (shared
// across every org the same owner runs) so a customer created under a
// sibling org still shows up here. Returns EVERY customerOrganization each
// matched customer belongs to (a customer can belong to more than one) so
// the picker can show them all rather than silently guessing which one
// applies to this line.
export async function searchCustomersForPo(query: string): Promise<{
  id: string;
  name: string;
  title: string | null;
  memberships: { customerOrganizationId: string; orgName: string; isPrimary: boolean }[];
}[]> {
  const { orgId } = await requireAccess("purchase-order:create");
  if (!query.trim()) return [];
  const ownerOrgIds = await getOwnerOrgIds(orgId);

  const customers = await db
    .select({ id: customer.id, name: customer.name, title: customer.title })
    .from(customer)
    .where(and(inArray(customer.organizationId, ownerOrgIds), ilike(customer.name, `%${query.trim()}%`)))
    .orderBy(asc(customer.name))
    .limit(20);
  if (customers.length === 0) return [];

  const memberships = await db
    .select({
      customerId: customerCompany.customerId,
      customerOrganizationId: customerCompany.customerOrganizationId,
      orgName: customerOrganization.name,
      isPrimary: customerCompany.isPrimary,
    })
    .from(customerCompany)
    .innerJoin(customerOrganization, eq(customerOrganization.id, customerCompany.customerOrganizationId))
    .where(inArray(customerCompany.customerId, customers.map((c) => c.id)))
    .orderBy(desc(customerCompany.isPrimary), asc(customerOrganization.name));

  const membershipsByCustomer = new Map<string, typeof memberships>();
  for (const m of memberships) {
    if (!membershipsByCustomer.has(m.customerId)) membershipsByCustomer.set(m.customerId, []);
    membershipsByCustomer.get(m.customerId)!.push(m);
  }

  return customers.map((c) => ({
    ...c,
    memberships: (membershipsByCustomer.get(c.id) ?? []).map((m) => ({
      customerOrganizationId: m.customerOrganizationId!,
      orgName: m.orgName,
      isPrimary: m.isPrimary,
    })),
  }));
}

export async function getApprovedSalesOrders(): Promise<{ id: string; soNo: string; customerName: string | null }[]> {
  const { orgId } = await requireAccess("purchase-order:read");

  const rows = await db
    .select({
      id: salesOrder.id,
      soNo: salesOrder.soNo,
      customerSnapshot: salesOrder.customerSnapshot,
    })
    .from(salesOrder)
    .where(
      and(
        eq(salesOrder.organizationId, orgId),
        eq(salesOrder.status, "confirmed"),
      ),
    )
    .orderBy(desc(salesOrder.createdAt));

  if (rows.length === 0) return [];
  const soIds = rows.map((r) => r.id);

  // Same "already covered" logic as getSalesOrderItemsForPo: an item is
  // covered once its productCode appears on an active (non-cancelled) PO
  // already linked to that SO. A SO with zero uncovered items is fully
  // "done" — every item it has is already on order — so there's nothing
  // left a new PO from this picker could add, and it's filtered out here
  // rather than only surfacing that fact after the user's already picked it.
  const allItems = await db
    .select({ salesOrderId: salesOrderItem.salesOrderId, productCode: salesOrderItem.productCode })
    .from(salesOrderItem)
    .where(inArray(salesOrderItem.salesOrderId, soIds));

  const activePOs = await db
    .select({ id: purchaseOrder.id, salesOrderId: purchaseOrder.salesOrderId })
    .from(purchaseOrder)
    .where(and(inArray(purchaseOrder.salesOrderId, soIds), sql`${purchaseOrder.status} != 'cancelled'`));
  const poIdToSoId = new Map(activePOs.map((p) => [p.id, p.salesOrderId]));

  const orderedCodesBySo = new Map<string, Set<string>>();
  if (activePOs.length > 0) {
    const orderedItems = await db
      .select({ purchaseOrderId: purchaseOrderItem.purchaseOrderId, productCode: purchaseOrderItem.productCode })
      .from(purchaseOrderItem)
      .where(inArray(purchaseOrderItem.purchaseOrderId, activePOs.map((p) => p.id)));
    for (const item of orderedItems) {
      const soId = poIdToSoId.get(item.purchaseOrderId);
      if (!soId || !item.productCode) continue;
      if (!orderedCodesBySo.has(soId)) orderedCodesBySo.set(soId, new Set());
      orderedCodesBySo.get(soId)!.add(item.productCode);
    }
  }

  const hasUncoveredItems = new Set<string>();
  for (const item of allItems) {
    const ordered = orderedCodesBySo.get(item.salesOrderId);
    if (!item.productCode || !ordered?.has(item.productCode)) hasUncoveredItems.add(item.salesOrderId);
  }

  return rows
    .filter((r) => hasUncoveredItems.has(r.id))
    .map((r) => {
      const snap = r.customerSnapshot as any;
      return { id: r.id, soNo: r.soNo, customerName: snap?.name ?? null };
    });
}

export async function getActiveCustomerPos(): Promise<{ id: string; customerPoNo: string; customerName: string | null; amount: string }[]> {
  const { orgId } = await requireAccess("purchase-order:read");
  const rows = await db
    .select({
      id: customerPurchaseOrder.id,
      customerPoNo: customerPurchaseOrder.customerPoNo,
      customerSnapshot: customerPurchaseOrder.customerSnapshot,
      amount: customerPurchaseOrder.amount,
    })
    .from(customerPurchaseOrder)
    .where(and(eq(customerPurchaseOrder.organizationId, orgId), inArray(customerPurchaseOrder.status, ["received", "acknowledged"])))
    .orderBy(desc(customerPurchaseOrder.createdAt));

  if (rows.length === 0) return [];

  // A CPO has no partial/remaining-items concept the way a SO does — it's
  // fulfilled by a single PO — so "done" here means it already has at least
  // one active (non-cancelled) PO linked to it via purchaseOrderCustomerPo.
  const cpoIds = rows.map((r) => r.id);
  const linked = await db
    .select({ customerPoId: purchaseOrderCustomerPo.customerPoId })
    .from(purchaseOrderCustomerPo)
    .innerJoin(purchaseOrder, eq(purchaseOrder.id, purchaseOrderCustomerPo.purchaseOrderId))
    .where(and(inArray(purchaseOrderCustomerPo.customerPoId, cpoIds), sql`${purchaseOrder.status} != 'cancelled'`));
  const linkedSet = new Set(linked.map((l) => l.customerPoId));

  return rows
    .filter((r) => !linkedSet.has(r.id))
    .map((r) => {
      const snap = r.customerSnapshot as any;
      return { id: r.id, customerPoNo: r.customerPoNo, customerName: snap?.name ?? null, amount: r.amount };
    });
}

export async function getDefaultDeliveryAddress(): Promise<string> {
  const { orgId } = await requireAccess("purchase-order:read");
  const [profile] = await db
    .select({ warehouseAddresses: organizationProfile.warehouseAddresses })
    .from(organizationProfile)
    .where(eq(organizationProfile.organizationId, orgId))
    .limit(1);
  const addresses = (profile?.warehouseAddresses as { label: string; address: string }[] | null) ?? [];
  return addresses[0]?.address ?? "";
}

export interface SoItemForPo {
  rowNo: number;
  productId: string | null;
  productCode: string | null;
  description: string | null;
  qty: string;
  uom: string | null;
  unitPrice: string | null;
  currency: string | null;
  totalPrice: string | null;
  imageKey: string | null;
}

export interface SoItemsForPoResult {
  items: SoItemForPo[];
  orderedProductCodes: string[];
  orderedSupplierIds: string[];
}

export async function getSalesOrderItemsForPo(soId: string): Promise<SoItemsForPoResult> {
  const { orgId } = await requireAccess("purchase-order:read");

  // Find active (non-cancelled) POs already linked to this SO
  const activePOs = await db
    .select({ id: purchaseOrder.id, supplierId: purchaseOrder.supplierId })
    .from(purchaseOrder)
    .where(
      and(
        eq(purchaseOrder.salesOrderId, soId),
        eq(purchaseOrder.organizationId, orgId),
        sql`${purchaseOrder.status} != 'cancelled'`,
      ),
    );

  const orderedSupplierIds = [...new Set(
    activePOs.map((p) => p.supplierId).filter((id): id is string => !!id),
  )];

  let orderedProductCodes: string[] = [];
  if (activePOs.length > 0) {
    const poIds = activePOs.map((p) => p.id);
    const orderedItems = await db
      .select({ productCode: purchaseOrderItem.productCode })
      .from(purchaseOrderItem)
      .where(inArray(purchaseOrderItem.purchaseOrderId, poIds));
    orderedProductCodes = [...new Set(
      orderedItems.map((i) => i.productCode).filter((c): c is string => !!c),
    )];
  }

  const allItems = await db
    .select({
      rowNo: salesOrderItem.rowNo,
      productId: salesOrderItem.productId,
      productCode: salesOrderItem.productCode,
      description: salesOrderItem.description,
      qty: salesOrderItem.qty,
      uom: salesOrderItem.uom,
      setGroupId: salesOrderItem.setGroupId,
      setQty: salesOrderItem.setQty,
    })
    .from(salesOrderItem)
    .innerJoin(salesOrder, eq(salesOrder.id, salesOrderItem.salesOrderId))
    .where(and(eq(salesOrderItem.salesOrderId, soId), eq(salesOrder.organizationId, orgId)))
    .orderBy(asc(salesOrderItem.rowNo));

  if (allItems.length === 0) return { items: [], orderedProductCodes, orderedSupplierIds };

  // Exclude items whose productCode is already covered by an active PO for this SO
  const orderedSet = new Set(orderedProductCodes);
  const unorderedItems = allItems.filter((i) => !i.productCode || !orderedSet.has(i.productCode));

  const codes = unorderedItems.map((i) => i.productCode).filter((c): c is string => !!c);
  const imageMap: Record<string, string | null> = {};
  const costMap: Record<string, string | null> = {};
  const currencyMap: Record<string, string | null> = {};

  if (codes.length > 0) {
    const prods = await db
      .select({ productCode: product.productCode, imageKey: product.imageKey, costUnitPrice: product.costUnitPrice, costPriceCurrency: product.costPriceCurrency })
      .from(product)
      .where(and(inArray(product.productCode, codes), eq(product.organizationId, orgId)));
    for (const p of prods) {
      imageMap[p.productCode] = p.imageKey ?? null;
      costMap[p.productCode] = p.costUnitPrice ?? null;
      currencyMap[p.productCode] = p.costPriceCurrency ?? null;
    }
  }

  const items = unorderedItems.map((i) => {
    const cost = i.productCode ? (costMap[i.productCode] ?? null) : null;
    const unitPrice = cost ?? "0";
    // the SO line is for one set: order for every set
    const qty = soLineQty(i);
    const price = parseFloat(unitPrice);
    return {
      rowNo: i.rowNo,
      productId: i.productId ?? null,
      productCode: i.productCode ?? null,
      description: i.description ?? null,
      qty: soLineQtyText(i),
      uom: i.uom ?? null,
      unitPrice,
      currency: i.productCode ? (currencyMap[i.productCode] ?? null) : null,
      totalPrice: (qty * price).toFixed(2),
      imageKey: i.productCode ? (imageMap[i.productCode] ?? null) : null,
    };
  });

  return { items, orderedProductCodes, orderedSupplierIds };
}

export type PurchaseOrderCustomerPoRow = typeof purchaseOrderCustomerPo.$inferSelect;
export type GoodsReceiptSummary = { id: string; grNo: string; receivedDate: Date; createdAt: Date; status: string };
export type PurchaseOrderWithItems = PurchaseOrderRow & {
  items: PurchaseOrderItemEnriched[];
  createdByName: string | null;
  salesOrderNo: string | null;
  customerPos: PurchaseOrderCustomerPoRow[];
  goodsReceipts: GoodsReceiptSummary[];
  pendingReturnQty: number;
  pendingRepairQty: number;
};
export type PurchaseOrderListRow = PurchaseOrderRow & {
  createdByName: string | null;
  customerPoNos: string[];
  itemCustomers: { name: string; organization: string | null }[];
  setGroupLabels: string[];
  pendingReturnQty: number;
  pendingRepairQty: number;
  /** 0–100: accepted quantity received so far ÷ total ordered quantity */
  receivedPct: number;
  /** Packing lists (not cancelled) that carry lines of this PO */
  packingLists: { id: string; packingListNo: string; supplierRefNo: string | null; status: string }[];
};

// The end-customer(s) a PO's lines are ultimately destined for (e.g. a
// drop-ship OEM order allocated per hospital/doctor) — set per item, not on
// the PO itself, so this collects the distinct (name, organization) pairs
// across all of a PO's items for the list card badge. customerName already
// carries the customer's title prefixed (see CustomerPickerCell), so no
// further lookup against the customer table is needed here.
//
// Also collects each PO's distinct set-group labels (also per-item, not on
// the PO itself) in the same pass, so the centralized Supplier PO list can
// search by set name without a second round trip.
async function getItemCustomersByPo(poIds: string[]): Promise<{
  customers: Map<string, { name: string; organization: string | null }[]>;
  setGroupLabels: Map<string, string[]>;
}> {
  const customers = new Map<string, { name: string; organization: string | null }[]>();
  const setGroupLabels = new Map<string, string[]>();
  if (poIds.length === 0) return { customers, setGroupLabels };

  const rows = await db
    .select({
      purchaseOrderId: purchaseOrderItem.purchaseOrderId,
      customerName: purchaseOrderItem.customerName,
      customerOrganization: purchaseOrderItem.customerOrganization,
      setGroupLabel: purchaseOrderItem.setGroupLabel,
    })
    .from(purchaseOrderItem)
    .where(inArray(purchaseOrderItem.purchaseOrderId, poIds))
    .orderBy(asc(purchaseOrderItem.rowNo));

  // (customer, set) pairs in line order, to order the set titles by customer below
  const pairsByPo = new Map<string, { customer: string | null; set: string }[]>();
  for (const r of rows) {
    const name = r.customerName?.trim();
    if (name) {
      const organization = r.customerOrganization?.trim() || null;
      const list = customers.get(r.purchaseOrderId) ?? [];
      if (!list.some((c) => c.name === name && c.organization === organization)) {
        list.push({ name, organization });
      }
      customers.set(r.purchaseOrderId, list);
    }

    const setLabel = r.setGroupLabel?.trim();
    if (setLabel) {
      const list = setGroupLabels.get(r.purchaseOrderId) ?? [];
      if (!list.includes(setLabel)) list.push(setLabel);
      setGroupLabels.set(r.purchaseOrderId, list);
      const pairs = pairsByPo.get(r.purchaseOrderId) ?? [];
      pairs.push({ customer: name ? `${name}|${r.customerOrganization?.trim() || ""}` : null, set: setLabel });
      pairsByPo.set(r.purchaseOrderId, pairs);
    }
  }

  // Set titles follow the order of the customers shown above them: each
  // customer's sets in turn, then sets that belong to no customer
  for (const [poId, pairs] of pairsByPo) {
    const ordered: string[] = [];
    const add = (label: string) => { if (!ordered.includes(label)) ordered.push(label); };
    for (const c of customers.get(poId) ?? []) {
      const key = `${c.name}|${c.organization ?? ""}`;
      for (const pair of pairs) if (pair.customer === key) add(pair.set);
    }
    for (const pair of pairs) add(pair.set);
    setGroupLabels.set(poId, ordered);
  }
  return { customers, setGroupLabels };
}

// How much of each PO has been received, as a 0–100 percentage of ordered
// quantity. "Received" means accepted quantity — qtyGood, falling back to
// qtyReceived for the plain direct-GR flow — from confirmed (non-recalled)
// goods receipts, the same rule maybeAutoFulfill uses. Each line is capped at
// its ordered qty so over-receiving one line can't mask a shortfall on another.
// The packing lists raised for each PO (a PO's lines are linked through
// packing_list_item; one packing list can span several POs). Cancelled lists
// are left out. supplierRefNo is the number the supplier printed themselves.
async function getPackingListsByPo(poIds: string[]): Promise<Map<string, PurchaseOrderListRow["packingLists"]>> {
  const map = new Map<string, PurchaseOrderListRow["packingLists"]>();
  if (poIds.length === 0) return map;
  const rows = await db
    .selectDistinct({
      purchaseOrderId: packingListItem.purchaseOrderId,
      id: packingList.id,
      packingListNo: packingList.packingListNo,
      supplierRefNo: packingList.supplierRefNo,
      status: packingList.status,
      createdAt: packingList.createdAt,
    })
    .from(packingListItem)
    .innerJoin(packingList, eq(packingListItem.packingListId, packingList.id))
    .where(and(inArray(packingListItem.purchaseOrderId, poIds), ne(packingList.status, "cancelled"), isNull(packingListItem.removedAt)))
    .orderBy(asc(packingList.createdAt));
  for (const r of rows) {
    const arr = map.get(r.purchaseOrderId) ?? [];
    arr.push({ id: r.id, packingListNo: r.packingListNo, supplierRefNo: r.supplierRefNo, status: r.status });
    map.set(r.purchaseOrderId, arr);
  }
  return map;
}

async function getReceivedPctByPo(poIds: string[]): Promise<Map<string, number>> {
  const pctMap = new Map<string, number>();
  if (poIds.length === 0) return pctMap;

  const [poItems, grItems] = await Promise.all([
    db.select({ id: purchaseOrderItem.id, purchaseOrderId: purchaseOrderItem.purchaseOrderId, qty: purchaseOrderItem.qty })
      .from(purchaseOrderItem)
      .where(inArray(purchaseOrderItem.purchaseOrderId, poIds)),
    db.select({ purchaseOrderItemId: goodsReceiptItem.purchaseOrderItemId, qtyGood: goodsReceiptItem.qtyGood, qtyReceived: goodsReceiptItem.qtyReceived })
      .from(goodsReceiptItem)
      .innerJoin(goodsReceipt, eq(goodsReceiptItem.goodsReceiptId, goodsReceipt.id))
      .where(and(inArray(goodsReceipt.purchaseOrderId, poIds), ne(goodsReceipt.status, "recalled"))),
  ]);

  const acceptedByItem = new Map<string, number>();
  for (const g of grItems) {
    if (!g.purchaseOrderItemId) continue;
    const accepted = parseFloat(g.qtyGood ?? g.qtyReceived ?? "0") || 0;
    acceptedByItem.set(g.purchaseOrderItemId, (acceptedByItem.get(g.purchaseOrderItemId) ?? 0) + accepted);
  }

  const totals = new Map<string, { ordered: number; received: number }>();
  for (const it of poItems) {
    const ordered = parseFloat(it.qty ?? "0") || 0;
    const t = totals.get(it.purchaseOrderId) ?? { ordered: 0, received: 0 };
    t.ordered += ordered;
    t.received += Math.min(acceptedByItem.get(it.id) ?? 0, ordered);
    totals.set(it.purchaseOrderId, t);
  }
  for (const [poId, t] of totals) {
    pctMap.set(poId, t.ordered > 0 ? Math.round((t.received / t.ordered) * 100) : 0);
  }
  return pctMap;
}

// "Fulfilled" only ever tracks physical receipt (see maybeAutoFulfill in
// server/goods-receipt.ts) — it says nothing about whether what arrived was
// actually accepted. This is the other half: how much received quantity is
// still sitting in "return to supplier" or "in-house repair" limbo,
// unresolved. Summed once per distinct PO, not per row.
async function getPendingReturnRepairByPo(poIds: string[]): Promise<Map<string, { pendingReturnQty: number; pendingRepairQty: number }>> {
  const map = new Map<string, { pendingReturnQty: number; pendingRepairQty: number }>();
  if (poIds.length === 0) return map;

  const rows = await db
    .select({
      purchaseOrderId: goodsReceipt.purchaseOrderId,
      qtyReturn: goodsReceiptItem.qtyReturn,
      returnStatus: goodsReceiptItem.returnStatus,
      qtyRepair: goodsReceiptItem.qtyRepair,
      repairStatus: goodsReceiptItem.repairStatus,
    })
    .from(goodsReceiptItem)
    .innerJoin(goodsReceipt, eq(goodsReceiptItem.goodsReceiptId, goodsReceipt.id))
    .where(and(inArray(goodsReceipt.purchaseOrderId, poIds), ne(goodsReceipt.status, "recalled")));

  for (const r of rows) {
    const bucket = map.get(r.purchaseOrderId) ?? { pendingReturnQty: 0, pendingRepairQty: 0 };
    if (r.returnStatus === "pending") bucket.pendingReturnQty += parseFloat(r.qtyReturn ?? "0") || 0;
    if (r.repairStatus === "pending") bucket.pendingRepairQty += parseFloat(r.qtyRepair ?? "0") || 0;
    map.set(r.purchaseOrderId, bucket);
  }
  return map;
}
// qtyGood, not qtyReceived — a line sent back to the supplier was never
// actually kept, so it shouldn't count toward how much of the line is
// genuinely accepted. Falls back to qtyReceived for the plain direct-GR flow
// (no inspection split, qtyGood is null there). Recalled GRs are excluded —
// a reversed receipt was never really accepted either. Mirrors the identical
// pattern in getPackableItemsForSupplier (server/packing-list.ts) and
// syncPoFulfillmentStatus (server/goods-receipt.ts).
async function getAcceptedQtyByPoItem(poItemIds: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (poItemIds.length === 0) return map;

  const rows = await db
    .select({
      purchaseOrderItemId: goodsReceiptItem.purchaseOrderItemId,
      qtyGood: goodsReceiptItem.qtyGood,
      qtyReceived: goodsReceiptItem.qtyReceived,
    })
    .from(goodsReceiptItem)
    .innerJoin(goodsReceipt, eq(goodsReceiptItem.goodsReceiptId, goodsReceipt.id))
    .where(and(inArray(goodsReceiptItem.purchaseOrderItemId, poItemIds), ne(goodsReceipt.status, "recalled")));

  for (const r of rows) {
    if (!r.purchaseOrderItemId) continue;
    const accepted = parseFloat(r.qtyGood ?? r.qtyReceived ?? "0") || 0;
    map.set(r.purchaseOrderItemId, (map.get(r.purchaseOrderItemId) ?? 0) + accepted);
  }
  return map;
}

// canEdit: true for the creator, anyone holding purchase-order:update in the
// PO's own organization, or anyone holding purchase-order:update:centralized
// — everyone else gets view-only access in the centralized view.
export type CentralizedPurchaseOrder = PurchaseOrderListRow & { organizationName: string; canEdit: boolean };
export type CentralizedPurchaseOrderWithItems = PurchaseOrderWithItems & { organizationName: string; canEdit: boolean; businessType: string };

const EDITABLE_STATUSES = new Set(["draft"]);
const DELETABLE_STATUSES = new Set(["draft", "cancelled"]);

// ── Queries ────────────────────────────────────────────────────────────────

export type PendingPrRow = {
  id: string;
  prNo: string;
  status: string;
  salesOrderNo: string | null;
  customerPoNos: string[];
  requestedByName: string | null;
  itemCount: number;
  createdAt: Date;
};

export async function getPendingPrsForPoConversion(): Promise<PendingPrRow[]> {
  const { orgId } = await requireAccess("purchase-order:read");

  const rows = await db
    .select()
    .from(purchaseRequisition)
    .where(
      and(
        eq(purchaseRequisition.organizationId, orgId),
        inArray(purchaseRequisition.status, ["approved", "partially_ordered"]),
      ),
    )
    .orderBy(desc(purchaseRequisition.createdAt));

  if (rows.length === 0) return [];

  const userIds = [...new Set(rows.map((r) => r.requestedBy))];
  const users = await db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, userIds));
  const nameOf = (id: string) => users.find((u) => u.id === id)?.name ?? null;

  const prIds = rows.map((r) => r.id);
  const items = await db
    .select({
      purchaseRequisitionId: purchaseRequisitionItem.purchaseRequisitionId,
      cpoNo: purchaseRequisitionItem.cpoNo,
    })
    .from(purchaseRequisitionItem)
    .where(inArray(purchaseRequisitionItem.purchaseRequisitionId, prIds));

  const countMap = new Map<string, number>();
  const cpoMap = new Map<string, Set<string>>();
  for (const i of items) {
    countMap.set(i.purchaseRequisitionId, (countMap.get(i.purchaseRequisitionId) ?? 0) + 1);
    if (i.cpoNo) {
      const set = cpoMap.get(i.purchaseRequisitionId) ?? new Set();
      set.add(i.cpoNo);
      cpoMap.set(i.purchaseRequisitionId, set);
    }
  }

  return rows.map((r) => {
    // Collect from items; fall back to the PR-level customerPoNo for old records
    const fromItems = [...(cpoMap.get(r.id) ?? [])];
    const customerPoNos = fromItems.length > 0
      ? fromItems
      : r.customerPoNo ? [r.customerPoNo] : [];
    return {
      id: r.id,
      prNo: r.prNo,
      status: r.status,
      salesOrderNo: r.salesOrderNo ?? null,
      customerPoNos,
      requestedByName: nameOf(r.requestedBy),
      itemCount: countMap.get(r.id) ?? 0,
      createdAt: r.createdAt,
    };
  });
}

export async function getPurchaseOrders(): Promise<PurchaseOrderListRow[]> {
  const { orgId } = await requireAccess("purchase-order:read");

  const rows = await db
    .select()
    .from(purchaseOrder)
    .where(eq(purchaseOrder.organizationId, orgId))
    .orderBy(desc(purchaseOrder.createdAt));

  if (rows.length === 0) return [];

  const poIds = rows.map((r) => r.id);
  const [users, cpoLinks] = await Promise.all([
    db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, [...new Set(rows.map((r) => r.createdBy))])),
    db.select({ purchaseOrderId: purchaseOrderCustomerPo.purchaseOrderId, customerPoNo: purchaseOrderCustomerPo.customerPoNo })
      .from(purchaseOrderCustomerPo)
      .where(inArray(purchaseOrderCustomerPo.purchaseOrderId, poIds)),
  ]);

  const nameOf = (id: string) => users.find((u) => u.id === id)?.name ?? null;
  const cpoMap = new Map<string, string[]>();
  for (const link of cpoLinks) {
    const arr = cpoMap.get(link.purchaseOrderId) ?? [];
    arr.push(link.customerPoNo);
    cpoMap.set(link.purchaseOrderId, arr);
  }
  const [pendingByPo, receivedPctByPo, packingListsByPo, { customers: itemCustomersByPo, setGroupLabels: setGroupLabelsByPo }] = await Promise.all([
    getPendingReturnRepairByPo(poIds),
    getReceivedPctByPo(poIds),
    getPackingListsByPo(poIds),
    getItemCustomersByPo(poIds),
  ]);

  return rows.map((r) => ({
    ...r,
    createdByName: nameOf(r.createdBy),
    customerPoNos: cpoMap.get(r.id) ?? [],
    itemCustomers: itemCustomersByPo.get(r.id) ?? [],
    setGroupLabels: setGroupLabelsByPo.get(r.id) ?? [],
    pendingReturnQty: pendingByPo.get(r.id)?.pendingReturnQty ?? 0,
    pendingRepairQty: pendingByPo.get(r.id)?.pendingRepairQty ?? 0,
    receivedPct: receivedPctByPo.get(r.id) ?? 0,
    packingLists: packingListsByPo.get(r.id) ?? [],
  }));
}

export async function getPurchaseOrderDetail(id: string): Promise<PurchaseOrderWithItems | null> {
  const { orgId } = await requireAccess("purchase-order:read");

  const [po] = await db
    .select()
    .from(purchaseOrder)
    .where(and(eq(purchaseOrder.id, id), eq(purchaseOrder.organizationId, orgId)));

  if (!po) return null;

  const [items, users, customerPos, soRows, grs] = await Promise.all([
    db.select().from(purchaseOrderItem).where(eq(purchaseOrderItem.purchaseOrderId, id)).orderBy(asc(purchaseOrderItem.rowNo)),
    db.select({ id: user.id, name: user.name }).from(user).where(eq(user.id, po.createdBy)),
    db.select().from(purchaseOrderCustomerPo).where(eq(purchaseOrderCustomerPo.purchaseOrderId, id)),
    po.salesOrderId
      ? db.select({ id: salesOrder.id, soNo: salesOrder.soNo }).from(salesOrder).where(eq(salesOrder.id, po.salesOrderId))
      : Promise.resolve([]),
    db.select({ id: goodsReceipt.id, grNo: goodsReceipt.grNo, receivedDate: goodsReceipt.receivedDate, createdAt: goodsReceipt.createdAt, status: goodsReceipt.status })
      .from(goodsReceipt)
      .where(eq(goodsReceipt.purchaseOrderId, id))
      .orderBy(desc(goodsReceipt.createdAt)),
  ]);

  const acceptedByItem = await getAcceptedQtyByPoItem(items.map((i) => i.id));
  const enrichedItems: PurchaseOrderItemEnriched[] = await Promise.all(
    items.map(async (i) => {
      let imageUrl: string | null = null;
      if (i.imageKey) {
        try {
          const cmd = new GetObjectCommand({ Bucket: PROCUREMENT_DOCS_BUCKET, Key: i.imageKey });
          imageUrl = await getSignedUrl(s3, cmd, { expiresIn: 7200 });
        } catch {}
      }
      return { ...i, imageUrl, acceptedQty: acceptedByItem.get(i.id) ?? 0 };
    }),
  );

  const pendingByPo = await getPendingReturnRepairByPo([id]);

  return {
    ...po,
    items: enrichedItems,
    createdByName: users[0]?.name ?? null,
    salesOrderNo: soRows[0]?.soNo ?? null,
    customerPos,
    goodsReceipts: grs,
    pendingReturnQty: pendingByPo.get(id)?.pendingReturnQty ?? 0,
    pendingRepairQty: pendingByPo.get(id)?.pendingRepairQty ?? 0,
  };
}

// Whether userId can edit a PO belonging to poOrgId: the creator always can;
// otherwise either purchase-order:update:centralized (any org), or
// purchase-order:update evaluated specifically in the PO's own org (covers
// both a direct member of that org and getUserPermissions' own sibling-org
// fallback for owners/shared-directory staff).
async function canEditPoAcrossOrgs(
  userId: string,
  poOrgId: string,
  createdBy: string,
  callerOrgId: string,
  callerPerms: string[],
): Promise<boolean> {
  if (createdBy === userId) return true;
  if (hasAccess(callerPerms, "purchase-order:update:centralized")) return true;
  const orgPerms = poOrgId === callerOrgId ? callerPerms : await getUserPermissions(userId, poOrgId);
  return hasAccess(orgPerms, "purchase-order:update");
}

// Cross-org view for members explicitly granted purchase-order:read:centralized
// — every Supplier PO recorded under any org the same owner controls, not
// just the caller's own active org. Mirrors the identical Customer PO pattern
// in server/customer-purchase-order.ts.
export async function getPurchaseOrdersCentralized(): Promise<CentralizedPurchaseOrder[]> {
  const { orgId, userId } = await requireAccess("purchase-order:read:centralized");
  const ownerOrgIds = await getOwnerOrgIds(orgId);

  const rows = await db
    .select({ po: purchaseOrder, organizationName: organization.name })
    .from(purchaseOrder)
    .innerJoin(organization, eq(organization.id, purchaseOrder.organizationId))
    .where(inArray(purchaseOrder.organizationId, ownerOrgIds))
    .orderBy(desc(purchaseOrder.createdAt));

  if (rows.length === 0) return [];

  const poIds = rows.map((r) => r.po.id);
  const [users, cpoLinks] = await Promise.all([
    db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, [...new Set(rows.map((r) => r.po.createdBy))])),
    db.select({ purchaseOrderId: purchaseOrderCustomerPo.purchaseOrderId, customerPoNo: purchaseOrderCustomerPo.customerPoNo })
      .from(purchaseOrderCustomerPo)
      .where(inArray(purchaseOrderCustomerPo.purchaseOrderId, poIds)),
  ]);
  const nameOf = (id: string) => users.find((u) => u.id === id)?.name ?? null;
  const cpoMap = new Map<string, string[]>();
  for (const link of cpoLinks) {
    const arr = cpoMap.get(link.purchaseOrderId) ?? [];
    arr.push(link.customerPoNo);
    cpoMap.set(link.purchaseOrderId, arr);
  }

  // Resolve edit rights once per distinct org among the results (not once
  // per row) to avoid N+1 permission fetches.
  const callerPerms = await getUserPermissions(userId, orgId);
  const distinctOtherOrgIds = [...new Set(rows.map((r) => r.po.organizationId))].filter((id) => id !== orgId);
  const otherOrgPermsEntries = await Promise.all(
    distinctOtherOrgIds.map(async (id) => [id, await getUserPermissions(userId, id)] as const),
  );
  const orgPermsMap = new Map<string, string[]>([[orgId, callerPerms], ...otherOrgPermsEntries]);
  const hasCentralizedUpdate = hasAccess(callerPerms, "purchase-order:update:centralized");
  const [pendingByPo, receivedPctByPo, packingListsByPo, { customers: itemCustomersByPo, setGroupLabels: setGroupLabelsByPo }] = await Promise.all([
    getPendingReturnRepairByPo(poIds),
    getReceivedPctByPo(poIds),
    getPackingListsByPo(poIds),
    getItemCustomersByPo(poIds),
  ]);

  return rows.map(({ po, organizationName }) => ({
    ...po,
    createdByName: nameOf(po.createdBy),
    customerPoNos: cpoMap.get(po.id) ?? [],
    itemCustomers: itemCustomersByPo.get(po.id) ?? [],
    setGroupLabels: setGroupLabelsByPo.get(po.id) ?? [],
    organizationName,
    canEdit: po.createdBy === userId || hasCentralizedUpdate || hasAccess(orgPermsMap.get(po.organizationId) ?? [], "purchase-order:update"),
    pendingReturnQty: pendingByPo.get(po.id)?.pendingReturnQty ?? 0,
    pendingRepairQty: pendingByPo.get(po.id)?.pendingRepairQty ?? 0,
    receivedPct: receivedPctByPo.get(po.id) ?? 0,
    packingLists: packingListsByPo.get(po.id) ?? [],
  }));
}

// Same detail as getPurchaseOrderDetail, but resolvable across every org the
// caller's owner controls — for members explicitly granted
// purchase-order:read:centralized.
export async function getPurchaseOrderDetailCentralized(id: string): Promise<CentralizedPurchaseOrderWithItems | null> {
  const { orgId, userId } = await requireAccess("purchase-order:read:centralized");
  const ownerOrgIds = await getOwnerOrgIds(orgId);

  const [row] = await db
    .select({ po: purchaseOrder, organizationName: organization.name, businessType: organizationProfile.businessType })
    .from(purchaseOrder)
    .innerJoin(organization, eq(organization.id, purchaseOrder.organizationId))
    .leftJoin(organizationProfile, eq(organizationProfile.organizationId, purchaseOrder.organizationId))
    .where(and(eq(purchaseOrder.id, id), inArray(purchaseOrder.organizationId, ownerOrgIds)));
  if (!row) return null;
  const { po, organizationName, businessType } = row;

  const [items, users, customerPos, soRows, grs] = await Promise.all([
    db.select().from(purchaseOrderItem).where(eq(purchaseOrderItem.purchaseOrderId, id)).orderBy(asc(purchaseOrderItem.rowNo)),
    db.select({ id: user.id, name: user.name }).from(user).where(eq(user.id, po.createdBy)),
    db.select().from(purchaseOrderCustomerPo).where(eq(purchaseOrderCustomerPo.purchaseOrderId, id)),
    po.salesOrderId
      ? db.select({ id: salesOrder.id, soNo: salesOrder.soNo }).from(salesOrder).where(eq(salesOrder.id, po.salesOrderId))
      : Promise.resolve([]),
    db.select({ id: goodsReceipt.id, grNo: goodsReceipt.grNo, receivedDate: goodsReceipt.receivedDate, createdAt: goodsReceipt.createdAt, status: goodsReceipt.status })
      .from(goodsReceipt)
      .where(eq(goodsReceipt.purchaseOrderId, id))
      .orderBy(desc(goodsReceipt.createdAt)),
  ]);

  const acceptedByItem = await getAcceptedQtyByPoItem(items.map((i) => i.id));
  const enrichedItems: PurchaseOrderItemEnriched[] = await Promise.all(
    items.map(async (i) => {
      let imageUrl: string | null = null;
      if (i.imageKey) {
        try {
          const cmd = new GetObjectCommand({ Bucket: PROCUREMENT_DOCS_BUCKET, Key: i.imageKey });
          imageUrl = await getSignedUrl(s3, cmd, { expiresIn: 7200 });
        } catch {}
      }
      return { ...i, imageUrl, acceptedQty: acceptedByItem.get(i.id) ?? 0 };
    }),
  );

  const callerPerms = await getUserPermissions(userId, orgId);
  const canEdit = await canEditPoAcrossOrgs(userId, po.organizationId, po.createdBy, orgId, callerPerms);
  const pendingByPo = await getPendingReturnRepairByPo([id]);

  return {
    ...po,
    items: enrichedItems,
    createdByName: users[0]?.name ?? null,
    salesOrderNo: soRows[0]?.soNo ?? null,
    customerPos,
    goodsReceipts: grs,
    organizationName,
    canEdit,
    businessType: businessType ?? "trading",
    pendingReturnQty: pendingByPo.get(id)?.pendingReturnQty ?? 0,
    pendingRepairQty: pendingByPo.get(id)?.pendingRepairQty ?? 0,
  };
}

export async function getPoForPrint(id: string) {
  const { orgId } = await requireAccess("purchase-order:read");

  const [po] = await db
    .select()
    .from(purchaseOrder)
    .where(and(eq(purchaseOrder.id, id), eq(purchaseOrder.organizationId, orgId)));

  if (!po) return null;

  const [items, userRows, orgRows, soRows] = await Promise.all([
    db.select().from(purchaseOrderItem).where(eq(purchaseOrderItem.purchaseOrderId, id)).orderBy(asc(purchaseOrderItem.rowNo)),
    db.select({ id: user.id, name: user.name }).from(user).where(eq(user.id, po.createdBy)),
    db.select({
      name: organization.name,
      logo: organization.logo,
      logoKey: organizationProfile.logoKey,
      brandColor: organizationProfile.brandColor,
      companyName: organizationProfile.companyName,
      companyAddress: organizationProfile.companyAddress,
      taxNo: organizationProfile.taxNo,
      phone: organizationProfile.phone,
      email: organizationProfile.email,
      website: organizationProfile.website,
      oldSsmNo: organizationProfile.oldSsmNo,
      newSsmNo: organizationProfile.newSsmNo,
      mdaEstablishmentNo: organizationProfile.mdaEstablishmentNo,
      bankingInfo: organizationProfile.bankingInfo,
      pdfTemplate: organizationProfile.pdfTemplate,
      headerLayout: organizationProfile.headerLayout,
      tableRowStyle: organizationProfile.tableRowStyle,
      tableFontSize: organizationProfile.tableFontSize,
      orgNameSize: organizationProfile.orgNameSize,
    })
    .from(organization)
    .leftJoin(organizationProfile, eq(organizationProfile.organizationId, organization.id))
    .where(eq(organization.id, orgId))
    .limit(1),
    po.salesOrderId
      ? db.select({ id: salesOrder.id, soNo: salesOrder.soNo }).from(salesOrder).where(eq(salesOrder.id, po.salesOrderId))
      : Promise.resolve([]),
  ]);

  const r2Public = process.env.R2_PUBLIC_URL ?? "";
  const org = orgRows[0];
  const orgLogoUrl = org?.logoKey ? `${r2Public}/${org.logoKey}` : (org?.logo ?? null);

  return {
    order: po,
    items,
    createdByName: userRows[0]?.name ?? null,
    salesOrderNo: soRows[0]?.soNo ?? null,
    orgName: org?.name ?? "",
    orgLogoUrl,
    orgBrandColor: org?.brandColor ?? null,
    orgCompanyName: org?.companyName ?? null,
    orgCompanyAddress: org?.companyAddress ?? null,
    orgTaxNo: org?.taxNo ?? null,
    orgPhone: org?.phone ?? null,
    orgEmail: org?.email ?? null,
    orgWebsite: org?.website ?? null,
    orgOldSsmNo: org?.oldSsmNo ?? null,
    orgNewSsmNo: org?.newSsmNo ?? null,
    orgMdaEstablishmentNo: org?.mdaEstablishmentNo ?? null,
    orgBankingInfo: (org?.bankingInfo ?? []) as any[],
    orgPdfTemplate:  org?.pdfTemplate  ?? "affirma",
    orgHeaderLayout: org?.headerLayout ?? "standard",
    orgTableRowStyle: org?.tableRowStyle ?? "default",
    orgTableFontSize: org?.tableFontSize ?? "normal",
    orgNameSize: org?.orgNameSize ?? "medium",
  };
}

// ── Mutations ──────────────────────────────────────────────────────────────

export async function getExistingDraftPo(): Promise<{ id: string; docNo: string } | null> {
  const { orgId } = await requireAccess("purchase-order:read");
  const [row] = await db
    .select({ id: purchaseOrder.id, prNo: purchaseOrder.prNo, poNo: purchaseOrder.poNo })
    .from(purchaseOrder)
    .where(and(eq(purchaseOrder.organizationId, orgId), eq(purchaseOrder.status, "draft")))
    .limit(1);
  if (!row) return null;
  return { id: row.id, docNo: row.prNo ?? row.poNo ?? row.id };
}

// The lists a supplier PO shows in, refreshed after it's saved (a draft too: auto-saves included), so
// going Back to a list shows it at once instead of only after a reload
function revalidatePoLists() {
  revalidatePath("/dashboard/procurement/purchase-order");
  revalidatePath("/dashboard/procurement/purchase-order/centralized");
  revalidatePath("/dashboard/procurement/requisition"); // its PR's status and "pending PO" list
}

export async function createPurchaseOrder(input: CreatePurchaseOrderInput): Promise<PurchaseOrderRow> {
  const { orgId, userId } = await requireAccess("purchase-order:create");

  if (!input.supplierId) throw new Error("Supplier is required");

  const today = todayKL();
  const poDate = input.poDate?.trim() || today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(poDate) || Number.isNaN(Date.parse(poDate))) throw new Error("Enter a valid PO date");
  if (poDate > today) throw new Error("The PO date cannot be after today");

  let supplierId = input.supplierId;
  let [sup] = await db.select().from(supplier).where(eq(supplier.id, supplierId));
  // a supplier that only a sibling organization may deal with on the PO's date: issue the PO to that organization instead
  const route = await routeRestrictedSupplier(orgId, sup?.name, userId, { asOf: poDate });
  if (route) {
    supplierId = route.supplierId;
    [sup] = await db.select().from(supplier).where(eq(supplier.id, supplierId));
  }
  let notes = joinNotes(stripPricingNote(input.notes), route?.note);
  await assertSupplierAllowed(orgId, sup?.name, poDate);

  // A sibling organization as the supplier: price the lines by the chosen method (or the default rule)
  let poItems = input.items;
  let totals = { subtotal: input.subtotal ?? "0", sst: input.sst ?? "0", grandTotal: input.grandTotal ?? "0" };
  let pricing: { method: string; marginPct: string | null } | null = null;
  if (sup?.linkedOrganizationId && (await getOwnerOrgIds(orgId)).includes(sup.linkedOrganizationId)) {
    const priced = await priceIntercompanyLines(sup.linkedOrganizationId, orgId, input.items, { method: input.pricingMethod, marginPct: input.pricingMarginPct }, input.customerPoIds ?? [], route?.originalName);
    pricing = { method: priced.method, marginPct: priced.marginPct };
    if (priced.method !== "manual") {
      poItems = priced.lines;
      totals = sumTotals(poItems, input.sstPct);
      notes = joinNotes(notes, intercompanyPricingNote(priced.method, priced.marginPct, priced.source, priced.kept, route?.originalName));
    }
  }
  const supplierSnapshot: PurchaseOrderRow["supplierSnapshot"] = sup ? {
    name: sup.name,
    registrationNo: sup.registrationNo ?? undefined,
    address: sup.address ?? undefined,
    contactPerson: sup.contactPerson ?? undefined,
    contactNo: sup.contactNo ?? undefined,
    email: sup.email ?? undefined,
  } : null;

  const fromPr = !!input.purchaseRequisitionId;

  // One draft per PR and supplier: opening the form again for them (another tab, coming back to it)
  // carries on with the draft already started instead of auto-saving a second one
  if (input.asDraft && fromPr) {
    const [open] = await db
      .select()
      .from(purchaseOrder)
      .where(and(
        eq(purchaseOrder.organizationId, orgId),
        eq(purchaseOrder.purchaseRequisitionId, input.purchaseRequisitionId!),
        inArray(purchaseOrder.supplierId, [...new Set([input.supplierId, supplierId])]),
        eq(purchaseOrder.status, "draft"),
        eq(purchaseOrder.createdBy, userId),
      ))
      .orderBy(desc(purchaseOrder.updatedAt))
      .limit(1);
    if (open) return applyPurchaseOrderUpdate(open, { ...input, id: open.id });
  }

  // A PO is created confirmed, with its number. A draft (auto-saved from the create form) gets a
  // draft reference instead, and its number when it's confirmed (confirmPurchaseOrder).
  const prNo = null;
  const manualPoNo = input.asDraft ? undefined : input.manualPoNo?.trim();
  let poNo: string;
  if (input.asDraft) {
    poNo = newDraftRef();
  } else if (manualPoNo) {
    const [clash] = await db
      .select({ id: purchaseOrder.id })
      .from(purchaseOrder)
      .where(and(eq(purchaseOrder.organizationId, orgId), eq(purchaseOrder.poNo, manualPoNo)))
      .limit(1);
    if (clash) throw new Error(`PO number "${manualPoNo}" is already in use`);
    poNo = manualPoNo;
  } else {
    poNo = await generatePoNo(orgId);
  }
  const status = input.asDraft ? "draft" : "confirmed";

  const categoryIds = await resolveCategories(orgId, input.categoryIds, async () => {
    const fromPr = await prCategories(input.purchaseRequisitionId);
    if (fromPr.length > 0) return fromPr;
    const fromSo = await soCategories(input.salesOrderId);
    return fromSo.length > 0 ? fromSo : cpoCategories(input.customerPoIds ?? []);
  });

  const [row] = await db
    .insert(purchaseOrder)
    .values({
      id: nanoid(),
      organizationId: orgId,
      categoryIds,
      purchaseRequisitionId: input.purchaseRequisitionId ?? null,
      prNo,
      poNo,
      salesOrderId: input.salesOrderId ?? null,
      supplierId,
      supplierSnapshot: supplierSnapshot ?? null,
      supplierQuotationKey: input.supplierQuotationKey ?? null,
      currency: input.currency ?? "MYR",
      subtotal: totals.subtotal,
      sst: totals.sst,
      sstPct: input.sstPct ?? "0",
      grandTotal: totals.grandTotal,
      pricingMethod: pricing?.method ?? null,
      pricingMarginPct: pricing?.marginPct ?? null,
      originalSupplierName: route?.originalName ?? null,
      poDate,
      notes: notes || null,
      expectedDeliveryDate: input.expectedDeliveryDate ?? null,
      deliveryAddress: input.deliveryAddress ?? null,
      status,
      createdBy: userId,
      ...(fromPr && !input.asDraft ? { approvedBy: userId, approvedAt: new Date() } : {}),
    })
    .returning();

  if (poItems.length > 0) {
    await db.insert(purchaseOrderItem).values(
      poItems.map((item) => ({
        id: nanoid(),
        purchaseOrderId: row.id,
        rowNo: item.rowNo,
        productId: item.productId ?? null,
        productCode: item.productCode ?? null,
        description: item.description ?? null,
        qty: item.qty ?? "1",
        uom: item.uom ?? null,
        unitPrice: item.unitPrice ?? "0",
        currency: item.currency ?? "MYR",
        totalPrice: item.totalPrice ?? "0",
        imageKey: item.imageKey ?? null,
        descriptionSource: item.descriptionSource ?? null,
        isAdditional: item.isAdditional ?? false,
        editedBy: item.editedBy ?? null,
        setGroupId: item.setGroupId ?? null,
        setGroupLabel: item.setGroupLabel ?? null,
        setQty: item.setQty ?? null,
        customerId: item.customerId ?? null,
        customerOrganizationId: item.customerOrganizationId ?? null,
        customerName: item.customerName ?? null,
        customerOrganization: item.customerOrganization ?? null,
        customerPoNo: item.customerPoNo ?? null,
        sourcingType: item.sourcingType ?? null,
        designBrandName: item.designBrandName ?? null,
        designBrandCode: item.designBrandCode ?? null,
        privateLabelCode: item.privateLabelCode ?? null,
        designBrandSource: item.designBrandSource ?? null,
        privateLabelSource: item.privateLabelSource ?? null,
        oemEditedBy: item.oemEditedBy ?? null,
      })),
    );
    await fillPurchaseOrderItemCustomers(row.id);
  }

  if (input.customerPoIds && input.customerPoIds.length > 0) {
    const cpoRows = await db
      .select({ id: customerPurchaseOrder.id, customerPoNo: customerPurchaseOrder.customerPoNo })
      .from(customerPurchaseOrder)
      .where(inArray(customerPurchaseOrder.id, input.customerPoIds));
    if (cpoRows.length > 0) {
      await db.insert(purchaseOrderCustomerPo).values(
        cpoRows.map((cpo) => ({
          id: nanoid(),
          purchaseOrderId: row.id,
          customerPoId: cpo.id,
          customerPoNo: cpo.customerPoNo,
        })),
      );
    }
  }

  // When converting from a PR, link PR items to this PO and update the PR's status (a draft: on confirm)
  if (fromPr && poNo && !input.asDraft) {
    await linkPrItemsToPo(orgId, input.purchaseRequisitionId!, row.id, poNo, input.items.map((i) => i.productCode));
  }

  // Every PO is created already confirmed (see status above) — if the
  // supplier is linked to a sibling org, this fires the matching SO there.
  await maybeCreateIntercompanySalesOrder(row.id);

  revalidatePoLists();
  return row;
}

// Links the PR's lines to a confirmed PO (by product code, lines not on another PO yet) and sets the
// PR's status from how much of it is ordered now.
async function linkPrItemsToPo(orgId: string, prId: string, poId: string, poNo: string, productCodes: (string | null | undefined)[]): Promise<void> {
  // Confirm the referenced PR actually belongs to this org before touching
  // its items/status — prId is client-supplied.
  const [prOwned] = await db
    .select({ id: purchaseRequisition.id })
    .from(purchaseRequisition)
    .where(and(eq(purchaseRequisition.id, prId), eq(purchaseRequisition.organizationId, orgId)))
    .limit(1);
  if (!prOwned) throw new Error("Purchase requisition not found");

  const poProductCodes = new Set(productCodes.filter(Boolean));

  const prItemsFull = await db
    .select({
      id: purchaseRequisitionItem.id,
      productCode: purchaseRequisitionItem.productCode,
      purchaseOrderId: purchaseRequisitionItem.purchaseOrderId,
    })
    .from(purchaseRequisitionItem)
    .where(eq(purchaseRequisitionItem.purchaseRequisitionId, prId));

  // Link PR items whose productCode appears in this PO and aren't already linked to another PO
  const unlinked = prItemsFull.filter(
    (pi) => pi.productCode && poProductCodes.has(pi.productCode) && !pi.purchaseOrderId,
  );

  if (unlinked.length > 0) {
    await Promise.all(
      unlinked.map((pi) =>
        db.update(purchaseRequisitionItem)
          .set({ purchaseOrderId: poId, purchaseOrderNo: poNo })
          .where(eq(purchaseRequisitionItem.id, pi.id)),
      ),
    );
  }

  // Re-check coverage after linking and update PR status
  const updatedItems = prItemsFull.map((pi) =>
    unlinked.find((u) => u.id === pi.id) ? { ...pi, purchaseOrderId: poId } : pi,
  );
  const allLinked = updatedItems.every((i) => !!i.purchaseOrderId);
  const anyLinked = updatedItems.some((i) => !!i.purchaseOrderId);
  const newPrStatus = allLinked ? "ordered" : anyLinked ? "partially_ordered" : "approved";

  await db.update(purchaseRequisition)
    .set({ status: newPrStatus })
    .where(eq(purchaseRequisition.id, prId));

  revalidatePath(`/dashboard/procurement/requisition/${prId}`);
  revalidatePath("/dashboard/procurement/requisition");
}

// Issues a draft PO (auto-saved from the create form): it gets its PO number and is confirmed, the
// PR's lines are linked to it, and a sibling company as the supplier gets its sales order.
export async function confirmPurchaseOrder(id: string, manualPoNo?: string): Promise<PurchaseOrderRow> {
  const { orgId, userId } = await requireAccess("purchase-order:create");
  const [po] = await db.select().from(purchaseOrder).where(and(eq(purchaseOrder.id, id), eq(purchaseOrder.organizationId, orgId)));
  if (!po) throw new Error("Purchase order not found");
  if (po.createdBy !== userId) throw new Error("Only the creator can issue this purchase order");
  if (po.status !== "draft" || !isDraftRef(po.poNo)) throw new Error("This purchase order has already been issued");

  const manual = manualPoNo?.trim();
  let poNo: string;
  if (manual) {
    const [clash] = await db
      .select({ id: purchaseOrder.id })
      .from(purchaseOrder)
      .where(and(eq(purchaseOrder.organizationId, orgId), eq(purchaseOrder.poNo, manual)))
      .limit(1);
    if (clash) throw new Error(`PO number "${manual}" is already in use`);
    poNo = manual;
  } else {
    poNo = await generatePoNo(orgId);
  }

  const [row] = await db
    .update(purchaseOrder)
    .set({ status: "confirmed", poNo, ...(po.purchaseRequisitionId ? { approvedBy: userId, approvedAt: new Date() } : {}) })
    .where(eq(purchaseOrder.id, id))
    .returning();

  if (po.purchaseRequisitionId) {
    const items = await db.select({ productCode: purchaseOrderItem.productCode }).from(purchaseOrderItem).where(eq(purchaseOrderItem.purchaseOrderId, id));
    await linkPrItemsToPo(orgId, po.purchaseRequisitionId, id, poNo, items.map((i) => i.productCode));
  }
  await maybeCreateIntercompanySalesOrder(id);

  revalidatePath(`/dashboard/procurement/purchase-order/${id}`);
  revalidatePath("/dashboard/procurement/purchase-order");
  return row;
}

export async function updatePurchaseOrder(input: UpdatePurchaseOrderInput): Promise<PurchaseOrderRow> {
  const { orgId, userId } = await requireAccess("purchase-order:update");

  const [existing] = await db
    .select()
    .from(purchaseOrder)
    .where(and(eq(purchaseOrder.id, input.id), eq(purchaseOrder.organizationId, orgId)));

  if (!existing) throw new Error("Purchase order not found");
  if (existing.createdBy !== userId) throw new Error("Only the creator can edit this purchase order");
  if (!EDITABLE_STATUSES.has(existing.status)) throw new Error("Only draft purchase orders can be edited");

  return applyPurchaseOrderUpdate(existing, input);
}

// Same update, but resolvable across every org the caller's owner controls —
// for the Edit flow reached from the centralized view. Editing is allowed
// for the creator, anyone holding purchase-order:update in the PO's own
// org, or anyone holding purchase-order:update:centralized — everyone else
// is rejected here even though they can view the PO. The draft-only
// restriction still applies either way.
export async function updatePurchaseOrderCentralized(input: UpdatePurchaseOrderInput): Promise<PurchaseOrderRow> {
  const { orgId, userId } = await requireAccess("purchase-order:read:centralized");
  const ownerOrgIds = await getOwnerOrgIds(orgId);

  const [existing] = await db
    .select()
    .from(purchaseOrder)
    .where(and(eq(purchaseOrder.id, input.id), inArray(purchaseOrder.organizationId, ownerOrgIds)));
  if (!existing) throw new Error("Purchase order not found");

  const callerPerms = await getUserPermissions(userId, orgId);
  const canEdit = await canEditPoAcrossOrgs(userId, existing.organizationId, existing.createdBy, orgId, callerPerms);
  if (!canEdit) throw new Error("You don't have permission to do this");
  if (!EDITABLE_STATUSES.has(existing.status)) throw new Error("Only draft purchase orders can be edited");

  return applyPurchaseOrderUpdate(existing, input);
}

async function applyPurchaseOrderUpdate(existing: PurchaseOrderRow, input: UpdatePurchaseOrderInput): Promise<PurchaseOrderRow> {
  if (
    input.supplierQuotationKey !== undefined &&
    existing.supplierQuotationKey &&
    existing.supplierQuotationKey !== input.supplierQuotationKey
  ) {
    await deleteFile(SUPPLIER_QUOTATION_BUCKET, existing.supplierQuotationKey);
  }

  // Rebuild supplier snapshot if supplier changed
  let supplierSnapshot = existing.supplierSnapshot;
  let supplierId = input.supplierId;
  let notes = input.notes ?? null;
  let originalSupplierName = existing.originalSupplierName ?? null; // kept while the supplier stays the same
  if (input.supplierId && input.supplierId !== existing.supplierId) {
    originalSupplierName = null;
    let [sup] = await db.select().from(supplier).where(eq(supplier.id, input.supplierId));
    // a supplier that only a sibling organization may deal with: issue the PO to that organization instead
    const poAsOf = existing.poDate ?? toBusinessDate(existing.createdAt); // the date of the PO is fixed when it is made
    const route = await routeRestrictedSupplier(existing.organizationId, sup?.name, existing.createdBy, { asOf: poAsOf });
    if (route) {
      supplierId = route.supplierId;
      originalSupplierName = route.originalName;
      notes = joinNotes(input.notes, route.note) || null;
      [sup] = await db.select().from(supplier).where(eq(supplier.id, supplierId));
    }
    await assertSupplierAllowed(existing.organizationId, sup?.name, poAsOf);
    if (sup) {
      supplierSnapshot = {
        name: sup.name,
        registrationNo: sup.registrationNo ?? undefined,
        address: sup.address ?? undefined,
        contactPerson: sup.contactPerson ?? undefined,
        contactNo: sup.contactNo ?? undefined,
        email: sup.email ?? undefined,
      };
    }
  }

  // A sibling organization as the supplier: price the lines by the chosen method (or the one already on the PO)
  let poItems = input.items;
  let totals = { subtotal: input.subtotal ?? existing.subtotal, sst: input.sst ?? existing.sst, grandTotal: input.grandTotal ?? existing.grandTotal };
  let pricing: { method: string; marginPct: string | null } | null = null;
  notes = stripPricingNote(notes) || null;
  if (supplierId) {
    const [pricedSup] = await db.select({ linkedOrganizationId: supplier.linkedOrganizationId }).from(supplier).where(eq(supplier.id, supplierId));
    if (pricedSup?.linkedOrganizationId && (await getOwnerOrgIds(existing.organizationId)).includes(pricedSup.linkedOrganizationId)) {
      const sameSupplier = supplierId === existing.supplierId;
      const priced = await priceIntercompanyLines(pricedSup.linkedOrganizationId, existing.organizationId, input.items, {
        method: input.pricingMethod ?? (sameSupplier ? existing.pricingMethod : undefined),
        marginPct: input.pricingMarginPct ?? (sameSupplier ? existing.pricingMarginPct : undefined),
      }, input.customerPoIds ?? [], originalSupplierName);
      pricing = { method: priced.method, marginPct: priced.marginPct };
      if (priced.method !== "manual") {
        poItems = priced.lines;
        totals = sumTotals(poItems, input.sstPct ?? existing.sstPct);
        notes = joinNotes(notes, intercompanyPricingNote(priced.method, priced.marginPct, priced.source, priced.kept, originalSupplierName)) || null;
      }
    }
  }

  // categories: as chosen; else, when it had none yet, its PR's / sales order's; else unchanged
  const oldCategories = (existing.categoryIds ?? []) as string[];
  const categoryIds = input.categoryIds !== undefined
    ? await mapCategoriesToOrg(input.categoryIds, existing.organizationId)
    : oldCategories.length > 0 ? oldCategories
    : await resolveCategories(existing.organizationId, undefined, async () => {
        const fromPr = await prCategories(existing.purchaseRequisitionId);
        return fromPr.length > 0 ? fromPr : soCategories(input.salesOrderId ?? existing.salesOrderId);
      });

  const [row] = await db
    .update(purchaseOrder)
    .set({
      categoryIds,
      salesOrderId: input.salesOrderId ?? null,
      supplierId,
      supplierSnapshot,
      supplierQuotationKey: input.supplierQuotationKey !== undefined
        ? input.supplierQuotationKey
        : existing.supplierQuotationKey,
      currency: input.currency ?? existing.currency,
      subtotal: totals.subtotal,
      sst: totals.sst,
      sstPct: input.sstPct ?? existing.sstPct,
      grandTotal: totals.grandTotal,
      pricingMethod: pricing?.method ?? null,
      pricingMarginPct: pricing?.marginPct ?? null,
      originalSupplierName,
      notes,
      expectedDeliveryDate: input.expectedDeliveryDate ?? null,
      deliveryAddress: input.deliveryAddress ?? null,
      status: input.status ?? existing.status,
    })
    .where(eq(purchaseOrder.id, input.id))
    .returning();

  // Replace items (clean up old image keys)
  const oldItems = await db
    .select({ imageKey: purchaseOrderItem.imageKey })
    .from(purchaseOrderItem)
    .where(eq(purchaseOrderItem.purchaseOrderId, input.id));

  const newImageKeys = new Set(poItems.map((i) => i.imageKey).filter(Boolean));
  for (const old of oldItems) {
    if (old.imageKey && !newImageKeys.has(old.imageKey)) {
      await deleteFile(PROCUREMENT_DOCS_BUCKET, old.imageKey);
    }
  }

  await db.delete(purchaseOrderItem).where(eq(purchaseOrderItem.purchaseOrderId, input.id));

  if (poItems.length > 0) {
    await db.insert(purchaseOrderItem).values(
      poItems.map((item) => ({
        id: nanoid(),
        purchaseOrderId: input.id,
        rowNo: item.rowNo,
        productId: item.productId ?? null,
        productCode: item.productCode ?? null,
        description: item.description ?? null,
        qty: item.qty ?? "1",
        uom: item.uom ?? null,
        unitPrice: item.unitPrice ?? "0",
        currency: item.currency ?? "MYR",
        totalPrice: item.totalPrice ?? "0",
        imageKey: item.imageKey ?? null,
        descriptionSource: item.descriptionSource ?? null,
        isAdditional: item.isAdditional ?? false,
        editedBy: item.editedBy ?? null,
        setGroupId: item.setGroupId ?? null,
        setGroupLabel: item.setGroupLabel ?? null,
        setQty: item.setQty ?? null,
        customerId: item.customerId ?? null,
        customerOrganizationId: item.customerOrganizationId ?? null,
        customerName: item.customerName ?? null,
        customerOrganization: item.customerOrganization ?? null,
        customerPoNo: item.customerPoNo ?? null,
        sourcingType: item.sourcingType ?? null,
        designBrandName: item.designBrandName ?? null,
        designBrandCode: item.designBrandCode ?? null,
        privateLabelCode: item.privateLabelCode ?? null,
        designBrandSource: item.designBrandSource ?? null,
        privateLabelSource: item.privateLabelSource ?? null,
        oemEditedBy: item.oemEditedBy ?? null,
      })),
    );
    await fillPurchaseOrderItemCustomers(input.id);
  }

  // Sync customer PO junction
  await db.delete(purchaseOrderCustomerPo).where(eq(purchaseOrderCustomerPo.purchaseOrderId, input.id));
  if (input.customerPoIds && input.customerPoIds.length > 0) {
    const cpoRows = await db
      .select({ id: customerPurchaseOrder.id, customerPoNo: customerPurchaseOrder.customerPoNo })
      .from(customerPurchaseOrder)
      .where(inArray(customerPurchaseOrder.id, input.customerPoIds));
    if (cpoRows.length > 0) {
      await db.insert(purchaseOrderCustomerPo).values(
        cpoRows.map((cpo) => ({
          id: nanoid(),
          purchaseOrderId: input.id,
          customerPoId: cpo.id,
          customerPoNo: cpo.customerPoNo,
        })),
      );
    }
  }

  revalidatePoLists();
  return row;
}

// Why this PO can't be deleted, or null. approvedAt alone doesn't protect a
// PO that went out: it's only set on the PR-conversion path, so a PO created
// directly as confirmed and then recalled or cancelled still has it null.
// Inactive records block too: goods receipts would be deleted along with the
// PO (cascade) — losing the receipt history behind their stock movements —
// and packing lists / invoices make the database refuse.
async function purchaseOrderDeleteBlocker(orgId: string, poId: string, docRef: string): Promise<string | null> {
  const downstream = await activePurchaseOrderDownstream(orgId, poId);
  if (downstream.length > 0) return `Can't delete ${docRef} — documents raised from it are still active: ${downstream.join(", ")}. Cancel or recall those first.`;

  const [hasGr] = await db.select({ id: goodsReceipt.id }).from(goodsReceipt).where(eq(goodsReceipt.purchaseOrderId, poId)).limit(1);
  const [hasPl] = await db.select({ id: packingListItem.id }).from(packingListItem).where(eq(packingListItem.purchaseOrderId, poId)).limit(1);
  const [hasInv] = await db.select({ id: invoice.id }).from(invoice).where(eq(invoice.purchaseOrderId, poId)).limit(1);
  if (hasGr || hasPl || hasInv) {
    const kinds = [hasGr && "goods receipts", hasPl && "packing lists", hasInv && "invoices"].filter(Boolean).join(", ");
    return `Can't delete ${docRef} — it has ${kinds} on record (even if recalled or cancelled). Keep it cancelled instead.`;
  }
  return null;
}

// Read-only: why this PO can't be deleted, or null. The detail page hides
// Delete when it's set; deletePurchaseOrder re-checks anyway.
export async function getPurchaseOrderDeleteBlocker(poId: string): Promise<string | null> {
  const { orgId } = await requireAccess("purchase-order:read");
  const [po] = await db.select({ poNo: purchaseOrder.poNo, prNo: purchaseOrder.prNo }).from(purchaseOrder).where(and(eq(purchaseOrder.id, poId), eq(purchaseOrder.organizationId, orgId)));
  if (!po) return null;
  return purchaseOrderDeleteBlocker(orgId, poId, po.poNo ?? po.prNo ?? poId);
}

// Problems come back as a readable message, not a thrown error (those are
// hidden in production). Every check runs before any file or row is removed.
export async function deletePurchaseOrder(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { orgId, userId } = await getSession();

  const [existing] = await db
    .select()
    .from(purchaseOrder)
    .where(and(eq(purchaseOrder.id, id), eq(purchaseOrder.organizationId, orgId)));

  if (!existing) return { ok: false, error: "Purchase order not found" };
  // the owner deletes any draft or cancelled PO; its creator may discard a draft that was never issued
  const ownDraft = existing.createdBy === userId && existing.status === "draft" && isDraftRef(existing.poNo);
  if (!ownDraft) {
    try { await requireOwner(); } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Only the organization owner can do this" }; }
  }
  if (existing.approvedAt) return { ok: false, error: "Approved purchase orders cannot be deleted" };
  if (!DELETABLE_STATUSES.has(existing.status)) return { ok: false, error: "Only draft or cancelled purchase orders can be deleted" };

  const blocker = await purchaseOrderDeleteBlocker(orgId, id, existing.poNo ?? existing.prNo ?? id);
  if (blocker) return { ok: false, error: blocker };

  if (existing.supplierQuotationKey) {
    await deleteFile(SUPPLIER_QUOTATION_BUCKET, existing.supplierQuotationKey);
  }

  // Clean up item images
  const items = await db
    .select({ imageKey: purchaseOrderItem.imageKey })
    .from(purchaseOrderItem)
    .where(eq(purchaseOrderItem.purchaseOrderId, id));

  for (const item of items) {
    if (item.imageKey) await deleteFile(PROCUREMENT_DOCS_BUCKET, item.imageKey);
  }

  await db.delete(purchaseOrder).where(eq(purchaseOrder.id, id));
  return { ok: true };
}

// Owner-only — the PO number is otherwise fixed once auto-generated (or
// manually set) at creation, but a typo or a need to match the supplier's
// own numbering sometimes has to be corrected after the fact. Checks the
// same uniqueness the DB itself enforces (purchase_order_no_org_uidx) up
// front so a collision surfaces as a clean message instead of a raw
// constraint violation. Resolvable across every org the caller's owner
// controls — for the centralized view — same cross-org lookup pattern as
// updatePurchaseOrderCentralized; uniqueness is checked against the PO's own
// org, not necessarily the caller's currently active one.
export async function updatePurchaseOrderNumber(id: string, poNo: string): Promise<void> {
  const { orgId } = await requireOwner();
  const ownerOrgIds = await getOwnerOrgIds(orgId);

  const trimmed = poNo.trim();
  if (!trimmed) throw new Error("PO number can't be empty");

  const [existing] = await db
    .select({ id: purchaseOrder.id, organizationId: purchaseOrder.organizationId })
    .from(purchaseOrder)
    .where(and(eq(purchaseOrder.id, id), inArray(purchaseOrder.organizationId, ownerOrgIds)));
  if (!existing) throw new Error("Purchase order not found");

  // Checked across every company with the same owner, not just this one
  if (await isDocNoTakenInGroup(PO_NUMBERED, existing.organizationId, trimmed, id)) {
    throw new Error(`PO number "${trimmed}" is already in use`);
  }

  await db.update(purchaseOrder).set({ poNo: trimmed }).where(eq(purchaseOrder.id, id));

  revalidatePath("/dashboard/procurement/purchase-order");
  revalidatePath(`/dashboard/procurement/purchase-order/${id}`);
  revalidatePath("/dashboard/procurement/purchase-order/centralized");
  revalidatePath(`/dashboard/procurement/purchase-order/centralized/${id}`);
}

// ── Workflow actions ───────────────────────────────────────────────────────

async function getPoForWorkflow(id: string, orgId: string) {
  const [po] = await db
    .select({ id: purchaseOrder.id, prNo: purchaseOrder.prNo, poNo: purchaseOrder.poNo, status: purchaseOrder.status, createdBy: purchaseOrder.createdBy, purchaseRequisitionId: purchaseOrder.purchaseRequisitionId })
    .from(purchaseOrder)
    .where(and(eq(purchaseOrder.id, id), eq(purchaseOrder.organizationId, orgId)));
  if (!po) throw new Error("Purchase order not found");
  return po;
}

export async function submitPurchaseOrder(id: string): Promise<void> {
  const { orgId, userId, session } = await requireAccess("purchase-order:update");
  const po = await getPoForWorkflow(id, orgId);
  if (po.status !== "draft") throw new Error("Only draft purchase orders can be submitted");
  await db.update(purchaseOrder).set({ status: "submitted" }).where(eq(purchaseOrder.id, id));

  revalidatePath(`/dashboard/procurement/purchase-order/${id}`);
  revalidatePath("/dashboard/procurement/purchase-order");

  const actorName = session.user.name;
  const docRef = po.prNo ?? po.poNo ?? id;
  getPoApprovers(orgId).then((approverIds) => {
    const targets = approverIds.filter((uid) => uid !== userId);
    if (targets.length === 0) return;
    Promise.all(
      targets.map((recipientId) =>
        createNotification({
          organizationId: orgId,
          userId: recipientId,
          type: "po:submitted",
          title: `PR ${docRef} pending approval`,
          body: `${actorName} submitted requisition ${docRef} for approval.`,
          link: `/dashboard/procurement/purchase-order/${po.id}`,
        }),
      ),
    );
  }).catch(console.error);
}

export async function approvePurchaseOrder(id: string): Promise<void> {
  const { orgId, userId, session } = await requireAccess("purchase-order:approve");
  const po = await getPoForWorkflow(id, orgId);
  if (po.status !== "submitted") throw new Error("Only submitted purchase orders can be approved");
  await assertSelfActionAllowed(orgId, "purchase-order:approve", po.createdBy, userId, "approve");

  // Generate PO number at approval — this is when the PR becomes a Supplier PO
  const poNo = po.poNo && !isDraftRef(po.poNo) ? po.poNo : await generatePoNo(orgId);

  await db.update(purchaseOrder).set({ status: "confirmed", poNo, approvedBy: userId, approvedAt: new Date() }).where(eq(purchaseOrder.id, id));
  await maybeCreateIntercompanySalesOrder(id);

  revalidatePath(`/dashboard/procurement/purchase-order/${id}`);
  revalidatePath("/dashboard/procurement/purchase-order");

  const docRef = po.prNo ?? poNo;
  createNotification({
    organizationId: orgId,
    userId: po.createdBy,
    type: "po:approved",
    title: `PR ${docRef} approved — PO ${poNo} issued`,
    body: `Your requisition ${docRef} was approved by ${session.user.name}. PO ${poNo} has been issued.`,
    link: `/dashboard/procurement/purchase-order/${po.id}`,
  }).catch(console.error);
}

export async function rejectPurchaseOrder(id: string): Promise<void> {
  const { orgId, userId, session } = await requireAccess("purchase-order:approve");
  const po = await getPoForWorkflow(id, orgId);
  if (po.status !== "submitted") throw new Error("Only submitted purchase orders can be rejected");
  await assertSelfActionAllowed(orgId, "purchase-order:approve", po.createdBy, userId, "reject");
  await db.update(purchaseOrder).set({ status: "draft" }).where(eq(purchaseOrder.id, id));

  revalidatePath(`/dashboard/procurement/purchase-order/${id}`);
  revalidatePath("/dashboard/procurement/purchase-order");

  const docRef = po.prNo ?? po.poNo ?? id;
  createNotification({
    organizationId: orgId,
    userId: po.createdBy,
    type: "po:rejected",
    title: `PR ${docRef} returned for revision`,
    body: `Your requisition ${docRef} was returned for revision by ${session.user.name}.`,
    link: `/dashboard/procurement/purchase-order/${po.id}`,
  }).catch(console.error);
}

// Documents raised from this PO that are still live — including the Sales
// Order auto-created in a sibling org by maybeCreateIntercompanySalesOrder,
// which nothing updates or cancels when this PO is recalled.
// includeSibling: false leaves the sibling SOs out — cancel handles those
// itself (cancelling them along with the PO where it safely can).
async function activePurchaseOrderDownstream(orgId: string, poId: string, includeSibling = true): Promise<string[]> {
  const siblingSos = includeSibling
    ? await db
        .select({ soNo: salesOrder.soNo, orgName: organization.name })
        .from(salesOrder)
        .leftJoin(organization, eq(organization.id, salesOrder.organizationId))
        .where(and(eq(salesOrder.sourcePurchaseOrderId, poId), ne(salesOrder.status, "cancelled")))
    : [];

  const grs = await db
    .select({ grNo: goodsReceipt.grNo })
    .from(goodsReceipt)
    .where(and(eq(goodsReceipt.purchaseOrderId, poId), eq(goodsReceipt.organizationId, orgId), ne(goodsReceipt.status, "recalled")));

  const pls = await db
    .selectDistinct({ packingListNo: packingList.packingListNo })
    .from(packingListItem)
    .innerJoin(packingList, eq(packingList.id, packingListItem.packingListId))
    .where(and(eq(packingListItem.purchaseOrderId, poId), eq(packingList.organizationId, orgId), ne(packingList.status, "cancelled")));

  const invs = await db
    .select({ invoiceNo: invoice.invoiceNo })
    .from(invoice)
    .where(and(eq(invoice.purchaseOrderId, poId), eq(invoice.organizationId, orgId), ne(invoice.status, "cancelled")));

  return [
    ...siblingSos.map((s) => `SO ${s.soNo}${s.orgName ? ` in ${s.orgName}` : ""}`),
    ...grs.map((g) => `GR ${g.grNo}`),
    ...pls.map((p) => `Packing List ${p.packingListNo}`),
    ...invs.map((i) => `Invoice ${i.invoiceNo}`),
  ];
}

// Read-only: what would stop this PO being recalled. The detail page hides
// the Recall button when this isn't empty; recallPurchaseOrder re-checks anyway.
export async function getPurchaseOrderRecallBlockers(poId: string): Promise<string[]> {
  const { orgId } = await requireAccess("purchase-order:read");
  const [po] = await db.select({ id: purchaseOrder.id }).from(purchaseOrder).where(and(eq(purchaseOrder.id, poId), eq(purchaseOrder.organizationId, orgId)));
  if (!po) return [];
  return activePurchaseOrderDownstream(orgId, poId);
}

// Problems come back as a readable message, not a thrown error (those are
// hidden in production).
export async function recallPurchaseOrder(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { orgId, userId, session } = await requireAccess("purchase-order:approve");
  const po = await getPoForWorkflow(id, orgId);
  if (po.status !== "confirmed") return { ok: false, error: "Only confirmed purchase orders can be recalled" };
  try {
    await assertSelfActionAllowed(orgId, "purchase-order:approve", po.createdBy, userId, "recall");
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "You can't recall this document" };
  }

  const downstream = await activePurchaseOrderDownstream(orgId, id);
  if (downstream.length > 0) {
    const docRef = po.poNo ?? po.prNo ?? id;
    return {
      ok: false,
      error: `Can't recall ${docRef} — documents raised from it are still active: ${downstream.join(", ")}. Cancel or recall those first.`,
    };
  }

  await db.update(purchaseOrder).set({ status: "draft" }).where(eq(purchaseOrder.id, id));

  revalidatePath(`/dashboard/procurement/purchase-order/${id}`);
  revalidatePath("/dashboard/procurement/purchase-order");

  const docRef = po.poNo ?? po.prNo ?? id;
  createNotification({
    organizationId: orgId,
    userId: po.createdBy,
    type: "po:recalled",
    title: `PO ${docRef} recalled`,
    body: `Purchase order ${docRef} has been recalled by ${session.user.name}.`,
    link: `/dashboard/procurement/purchase-order/${po.id}`,
  }).catch(console.error);

  return { ok: true };
}

export async function reconfirmPurchaseOrder(id: string): Promise<void> {
  const { orgId, userId, session } = await requireAccess("purchase-order:approve");
  const po = await getPoForWorkflow(id, orgId);
  if (po.status !== "draft") throw new Error("Only draft purchase orders can be re-confirmed");
  await assertSelfActionAllowed(orgId, "purchase-order:approve", po.createdBy, userId, "re-confirm");
  await db.update(purchaseOrder).set({ status: "confirmed" }).where(eq(purchaseOrder.id, id));
  await maybeCreateIntercompanySalesOrder(id);

  revalidatePath(`/dashboard/procurement/purchase-order/${id}`);
  revalidatePath("/dashboard/procurement/purchase-order");

  const docRef = po.poNo ?? po.prNo ?? id;
  createNotification({
    organizationId: orgId,
    userId: po.createdBy,
    type: "po:approved",
    title: `PO ${docRef} re-confirmed`,
    body: `Purchase order ${docRef} has been re-confirmed by ${session.user.name}.`,
    link: `/dashboard/procurement/purchase-order/${po.id}`,
  }).catch(console.error);
}

export async function fulfillPurchaseOrder(id: string, warehouseLabel = "Default"): Promise<void> {
  const { orgId, userId } = await requireAccess("purchase-order:update");
  const po = await getPoForWorkflow(id, orgId);
  if (po.status !== "confirmed") throw new Error("Purchase order must be confirmed (supplier PO) before marking as fulfilled");

  await db.update(purchaseOrder).set({ status: "fulfilled" }).where(eq(purchaseOrder.id, id));

  // Auto-create approved STOCK_IN for every item that has a linked productId
  const items = await db
    .select()
    .from(purchaseOrderItem)
    .where(eq(purchaseOrderItem.purchaseOrderId, id));

  await Promise.all(
    items
      .filter((item) => item.productId)
      .map(async (item) => {
        await createApprovedMovement({
          orgId,
          userId,
          productId: item.productId!,
          warehouseLabel,
          movementType: MOVEMENT_TYPE.STOCK_IN,
          quantity: parseFloat(item.qty ?? "1"),
          unitCost: item.unitPrice ?? undefined,
          referenceType: REF_TYPE.PURCHASE_ORDER,
          referenceId: id,
          referenceNo: po.poNo ?? po.prNo ?? id,
          notes: `PO receipt: ${item.productCode ?? ""}`.trim(),
        });
        // Write PO price back to product cost fields
        if (item.unitPrice) {
          await db
            .update(product)
            .set({
              costUnitPrice: item.unitPrice,
              ...(item.currency ? { costPriceCurrency: item.currency } : {}),
            })
            .where(eq(product.id, item.productId!));
        }
      }),
  );
}

// Why this PO can't be cancelled, or null: its own live goods receipts,
// packing lists or invoices, or a sibling org's SO from it that the sibling
// has already acted on. A sibling SO nobody has acted on doesn't block — it's
// cancelled along with the PO.
async function purchaseOrderCancelBlocker(orgId: string, poId: string, docRef: string): Promise<string | null> {
  const own = await activePurchaseOrderDownstream(orgId, poId, false);
  const sibling = await intercompanySoCancelBlockers(poId);
  const all = [...sibling, ...own];
  return all.length > 0 ? `Can't cancel ${docRef} — documents raised from it are still active: ${all.join(", ")}. Cancel or recall those first.` : null;
}

// Read-only, for the PO detail page: hides Cancel when this is set.
export async function getPurchaseOrderCancelBlocker(poId: string): Promise<string | null> {
  const { orgId } = await requireAccess("purchase-order:read");
  const [po] = await db.select({ poNo: purchaseOrder.poNo, prNo: purchaseOrder.prNo }).from(purchaseOrder).where(and(eq(purchaseOrder.id, poId), eq(purchaseOrder.organizationId, orgId)));
  return po ? purchaseOrderCancelBlocker(orgId, poId, po.poNo ?? po.prNo ?? poId) : null;
}

// Problems come back as a readable message, not a thrown error (those are
// hidden in production). Blocked by purchaseOrderCancelBlocker; a sibling
// org's SO nobody there has acted on is cancelled with the PO (and that org
// notified). Once cancelled, the PR items this PO covered are released
// and the PR's status recomputed (ordered → partially_ordered / approved),
// so a replacement PO can be raised from it or it can be cancelled.
export async function cancelPurchaseOrder(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { orgId } = await requireAccess("purchase-order:update");
  const po = await getPoForWorkflow(id, orgId);
  if (po.status === "fulfilled" || po.status === "cancelled") return { ok: false, error: "Cannot cancel a fulfilled or already cancelled purchase order" };

  const blocker = await purchaseOrderCancelBlocker(orgId, id, po.poNo ?? po.prNo ?? id);
  if (blocker) return { ok: false, error: blocker };

  await db.update(purchaseOrder).set({ status: "cancelled" }).where(eq(purchaseOrder.id, id));
  await cancelIntercompanySalesOrdersForPo(id);

  // Release the requisition items this PO covered, then recompute each
  // affected PR's status the same way PO creation sets it.
  const covered = await db
    .select({ purchaseRequisitionId: purchaseRequisitionItem.purchaseRequisitionId })
    .from(purchaseRequisitionItem)
    .where(eq(purchaseRequisitionItem.purchaseOrderId, id));
  const prIds = [...new Set([...covered.map((c) => c.purchaseRequisitionId), ...(po.purchaseRequisitionId ? [po.purchaseRequisitionId] : [])])];
  if (covered.length > 0) {
    await db.update(purchaseRequisitionItem).set({ purchaseOrderId: null, purchaseOrderNo: null }).where(eq(purchaseRequisitionItem.purchaseOrderId, id));
  }
  for (const prId of prIds) {
    const [pr] = await db
      .select({ status: purchaseRequisition.status })
      .from(purchaseRequisition)
      .where(and(eq(purchaseRequisition.id, prId), eq(purchaseRequisition.organizationId, orgId)));
    if (!pr || (pr.status !== "ordered" && pr.status !== "partially_ordered")) continue;
    const items = await db
      .select({ purchaseOrderId: purchaseRequisitionItem.purchaseOrderId })
      .from(purchaseRequisitionItem)
      .where(eq(purchaseRequisitionItem.purchaseRequisitionId, prId));
    const allLinked = items.length > 0 && items.every((i) => !!i.purchaseOrderId);
    const anyLinked = items.some((i) => !!i.purchaseOrderId);
    const next = allLinked ? "ordered" : anyLinked ? "partially_ordered" : "approved";
    if (next !== pr.status) await db.update(purchaseRequisition).set({ status: next }).where(eq(purchaseRequisition.id, prId));
    revalidatePath(`/dashboard/procurement/requisition/${prId}`);
  }
  if (prIds.length > 0) revalidatePath("/dashboard/procurement/requisition");

  revalidatePath(`/dashboard/procurement/purchase-order/${id}`);
  revalidatePath("/dashboard/procurement/purchase-order");
  return { ok: true };
}

// ── Hover history (list cards) ──────────────────────────────────────────────

export type PurchaseOrderHistory = {
  po: {
    poNo: string | null; prNo: string | null; status: string; grandTotal: string; currency: string;
    supplierName: string | null; createdAt: Date; createdByName: string | null;
    approvedAt: Date | null; approvedByName: string | null; updatedAt: Date;
  };
  cpos: { customerPoNo: string; receivedDate: Date | null; createdAt: Date }[];
  so: { soNo: string; status: string; createdAt: Date } | null;
  pr: { prNo: string; status: string; createdAt: Date } | null;
  /** The sibling company's SO raised from this PO (intercompany) */
  intercompanySos: { soNo: string; status: string; createdAt: Date; orgName: string | null }[];
  packingLists: { packingListNo: string; status: string; createdAt: Date; expectedDate: Date | null }[];
  goodsReceipts: { grNo: string; status: string; receivedDate: Date; createdAt: Date }[];
};

export async function getPurchaseOrderHistory(poId: string): Promise<PurchaseOrderHistory | null> {
  const { orgId } = await requireAccess("purchase-order:read");
  return purchaseOrderHistoryIn([orgId], poId);
}

// Same, for the centralized PO list: any org the caller's owner holds.
export async function getPurchaseOrderHistoryCentralized(poId: string): Promise<PurchaseOrderHistory | null> {
  const { orgId } = await requireAccess("purchase-order:read:centralized");
  return purchaseOrderHistoryIn(await getOwnerOrgIds(orgId), poId);
}

// The PO must belong to one of `allowedOrgIds`; everything else is read from the PO's own org
// (except the intercompany SO, which lives in the sibling company).
async function purchaseOrderHistoryIn(allowedOrgIds: string[], poId: string): Promise<PurchaseOrderHistory | null> {
  const [po] = await db.select().from(purchaseOrder).where(and(eq(purchaseOrder.id, poId), inArray(purchaseOrder.organizationId, allowedOrgIds)));
  if (!po) return null;
  const orgId = po.organizationId;

  const userIds = [po.createdBy, po.approvedBy].filter((v): v is string => !!v);
  const [users, cpos, pr, icSos, pls, grs] = await Promise.all([
    db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, userIds)),
    db.select({ customerPoNo: customerPurchaseOrder.customerPoNo, receivedDate: customerPurchaseOrder.receivedDate, createdAt: customerPurchaseOrder.createdAt })
      .from(purchaseOrderCustomerPo)
      .innerJoin(customerPurchaseOrder, eq(customerPurchaseOrder.id, purchaseOrderCustomerPo.customerPoId))
      .where(eq(purchaseOrderCustomerPo.purchaseOrderId, poId)),
    po.purchaseRequisitionId
      ? db.select({ prNo: purchaseRequisition.prNo, status: purchaseRequisition.status, createdAt: purchaseRequisition.createdAt, salesOrderId: purchaseRequisition.salesOrderId })
          .from(purchaseRequisition)
          .where(and(eq(purchaseRequisition.id, po.purchaseRequisitionId), eq(purchaseRequisition.organizationId, orgId)))
          .then((r) => r[0] ?? null)
      : Promise.resolve(null),
    db.select({ soNo: salesOrder.soNo, status: salesOrder.status, createdAt: salesOrder.createdAt, orgName: organization.name })
      .from(salesOrder)
      .leftJoin(organization, eq(organization.id, salesOrder.organizationId))
      .where(eq(salesOrder.sourcePurchaseOrderId, poId)),
    db.selectDistinct({ id: packingList.id, packingListNo: packingList.packingListNo, status: packingList.status, createdAt: packingList.createdAt, expectedDate: packingList.expectedDate })
      .from(packingListItem)
      .innerJoin(packingList, eq(packingList.id, packingListItem.packingListId))
      .where(and(eq(packingListItem.purchaseOrderId, poId), eq(packingList.organizationId, orgId))),
    db.select({ grNo: goodsReceipt.grNo, status: goodsReceipt.status, receivedDate: goodsReceipt.receivedDate, createdAt: goodsReceipt.createdAt })
      .from(goodsReceipt)
      .where(and(eq(goodsReceipt.purchaseOrderId, poId), eq(goodsReceipt.organizationId, orgId))),
  ]);
  const nameOf = (id: string | null) => users.find((u) => u.id === id)?.name ?? null;

  // The PO's own SO, else its PR's (an older edit could drop the PO's link)
  const soId = po.salesOrderId ?? pr?.salesOrderId ?? null;
  const so = soId
    ? await db.select({ soNo: salesOrder.soNo, status: salesOrder.status, createdAt: salesOrder.createdAt })
        .from(salesOrder).where(and(eq(salesOrder.id, soId), eq(salesOrder.organizationId, orgId))).then((r) => r[0] ?? null)
    : null;

  return {
    po: {
      poNo: po.poNo, prNo: po.prNo, status: po.status, grandTotal: po.grandTotal, currency: po.currency,
      supplierName: po.supplierSnapshot?.name ?? null,
      createdAt: po.createdAt, createdByName: nameOf(po.createdBy),
      approvedAt: po.approvedAt, approvedByName: nameOf(po.approvedBy),
      updatedAt: po.updatedAt,
    },
    cpos,
    so,
    pr: pr ? { prNo: pr.prNo, status: pr.status, createdAt: pr.createdAt } : null,
    intercompanySos: icSos,
    packingLists: pls.map(({ packingListNo, status, createdAt, expectedDate }) => ({ packingListNo, status, createdAt, expectedDate })),
    goodsReceipts: grs,
  };
}
