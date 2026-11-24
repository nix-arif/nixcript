"use server";

import { db } from "@/db";
import {
  salesOrder,
  salesOrderItem,
  salesOrderCounter,
  purchaseOrder,
  purchaseOrderItem,
  supplier,
  deliveryOrder,
  customer,
  customerPurchaseOrder,
  quotation,
  organization,
  organizationProfile,
  user,
  invoice,
  consignment,
  consignHeader,
  member,
  purchaseRequisition,
  product,
} from "@/db/schema";
import { buildCustomerSnapshot } from "@/server/customer";
import { nanoid } from "nanoid";
import { uniqueCpoNoFor } from "@/lib/customer-po/unique-no";
import { eq, and, ne, desc, asc, inArray, sql, or, ilike } from "drizzle-orm";
import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getNumberingConfig } from "@/server/document-numbering";
import { buildDocumentNo } from "@/lib/document-numbering";
import { nextFreeDocNo } from "@/lib/document-number-group";
import { revalidatePath } from "next/cache";
import { adjustReservation } from "@/lib/inventory/create-movement";
import { checkAndTriggerReplenishment } from "@/server/purchase-requisition";
import { performStockCheckAndReserve } from "@/server/stock-reservation";
import { soStockStatusFor } from "@/lib/inventory/so-stock-status";
import { Resend } from "resend";
import { testingSubject } from "@/lib/testing-mode";
import { createNotification, getSoApprovers } from "@/server/notifications";
import { assertSelfActionAllowed } from "@/lib/approvals/guard";
import SoNotificationEmail from "@/components/emails/so-notification";

import { requireAccess } from "@/lib/auth/require-access";
const resend = new Resend(process.env.RESEND_API_KEY as string);
const baseUrl = process.env.NODE_ENV === "production"
  ? process.env.APP_DOMAIN!
  : (process.env.BETTER_AUTH_URL ?? "http://localhost:3000");

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

export async function getSupplierQuotationUploadUrl(
  filename: string,
): Promise<{ key: string; uploadUrl: string }> {
  await requireAccess("sales-order:create");
  const key = `supplier-quotations/so/${nanoid()}-${filename}`;
  const cmd = new PutObjectCommand({
    Bucket: SUPPLIER_QUOTATION_BUCKET,
    Key: key,
    ContentType: "application/pdf",
  });
  const uploadUrl = await getSignedUrl(s3, cmd, { expiresIn: 3600 });
  return { key, uploadUrl };
}

export async function getSupplierQuotationDownloadUrl(key: string): Promise<string> {
  const cmd = new GetObjectCommand({ Bucket: SUPPLIER_QUOTATION_BUCKET, Key: key });
  return getSignedUrl(s3, cmd, { expiresIn: 3600 });
}

async function deleteSupplierQuotationFile(key: string | null | undefined) {
  if (!key) return;
  await s3.send(new DeleteObjectCommand({ Bucket: SUPPLIER_QUOTATION_BUCKET, Key: key }));
}

// ── Auth helpers ───────────────────────────────────────────────────────────



// Returns every org owned by the same owner as the caller's active org (the
// caller need not be a member of those other orgs themselves — only the
// owner is, by design; see the identical pattern in server/quotation.ts and
// server/customer-purchase-order.ts).
async function getAllOwnerOrgIds(userId: string, currentOrgId: string): Promise<string[]> {
  const [ownerMember] = await db
    .select({ userId: member.userId })
    .from(member)
    .where(and(eq(member.organizationId, currentOrgId), eq(member.role, "owner")))
    .limit(1);
  if (!ownerMember) return [currentOrgId];

  const ownedOrgs = await db
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(and(eq(member.userId, ownerMember.userId), eq(member.role, "owner")));

  const ids = [...new Set(ownedOrgs.map((o) => o.organizationId))];
  return ids.length > 0 ? ids : [currentOrgId];
}

// ── Running number ─────────────────────────────────────────────────────────

async function generateSoNo(orgId: string): Promise<string> {
  const cfg = await getNumberingConfig(orgId, "so");
  const year = new Date().getFullYear();

  const existing = await db
    .select()
    .from(salesOrderCounter)
    .where(eq(salesOrderCounter.organizationId, orgId))
    .limit(1);

  let nextNo: number;

  if (existing.length === 0) {
    await db.insert(salesOrderCounter).values({ id: nanoid(), organizationId: orgId, year, lastNumber: 1 });
    nextNo = 1;
  } else {
    const counter = existing[0];
    nextNo = counter.year === year ? counter.lastNumber + 1 : 1;
  }
  // Unique across the owner's companies — skip numbers a sibling already used
  const free = await nextFreeDocNo(
    { table: salesOrder, id: salesOrder.id, organizationId: salesOrder.organizationId, number: salesOrder.soNo },
    orgId, nextNo, (n) => buildDocumentNo(cfg, year, n),
  );
  nextNo = free.seq;
  await db
    .update(salesOrderCounter)
    .set({ year, lastNumber: nextNo })
    .where(eq(salesOrderCounter.organizationId, orgId));

  return buildDocumentNo(cfg, year, nextNo);
}

// Returns the next CASH-SALE-XX number for this organisation.
// Scans existing SO customerPoNo fields; safe to call concurrently since the
// number is only a preview — the SO is created separately and race conditions
// are highly unlikely in a small-team ERP.
// ── Types ──────────────────────────────────────────────────────────────────

export type SalesOrderRow = typeof salesOrder.$inferSelect;
export type SalesOrderItem = typeof salesOrderItem.$inferSelect;

export type SalesOrderMeta = {
  createdByName: string | null;
  submittedByName: string | null;
  approvedByName: string | null;
};

export type CpoCustomer = {
  customerPoId: string;
  customerPoNo: string;
  customerId: string | null;
  customerSnapshot: { title?: string; name: string; organizationName?: string; organizationAddress?: string } | null;
  deliveryDate: Date | null;
  salesPersonName: string | null;     // original from CPO table
  soSalesPersonName: string | null;   // SO-level override (from customerPoLinks)
  externalPersons: { id: string; name: string }[];
};

export type SalesOrderListRow = SalesOrderRow & {
  createdByName: string | null;
  cpoCustomers: CpoCustomer[];
};

export interface SalesOrderItemInput {
  rowNo: number;
  productId?: string;
  productCode?: string;
  description?: string;
  qty?: string;
  uom?: string;
  unitPrice?: string;
  discountPct?: string;
  discountAmt?: string;
  totalPrice?: string;
  lineType?: string;
  rentalDuration?: string;
  rentalUnit?: string;
  sourcingType?: "trading" | "oem" | null;
  designBrandName?: string | null;
  designBrandCode?: string | null;
  privateLabelCode?: string | null;
  designBrandSource?: "catalog" | "user" | null;
  privateLabelSource?: "auto" | "user" | null;
  setGroupId?: string;
  setGroupLabel?: string;
  setQty?: string;
  cpoDescription?: string;
  setCpoTitle?: string;
  sourceQuotationId?: string;
  sourceCustomerPoId?: string;
  sourceCustomerPoNo?: string;
  customerId?: string;
  customerOrganizationId?: string;
  customerName?: string;
  customerOrganization?: string;
  descriptionSource?: Array<"quote" | "catalog" | "user" | "cpo" | "so"> | null;
  codeSource?: Array<"cpo" | "quotation" | "user" | "so"> | null;
  qtySource?: Array<"cpo" | "quotation" | "user" | "so"> | null;
  uomSource?: string | null;
  unitPriceSource?: string | null;
  discountSource?: string | null;
  editedBy?: string | null;
  soEditedBy?: string | null;
  isAdditional?: boolean;
}

export interface CreateSalesOrderInput {
  customerId?: string;
  customerOrgMemberId?: string;
  customerPoId?: string;
  customerPoNo?: string;
  customerPoLinks?: { customerPoId: string; customerPoNo: string; deliveryDate?: string; salesPersonName?: string | null; externalPersons?: { id: string; name: string }[] }[];
  quotationId?: string;
  quotationNo?: string;
  linkedQuotations?: { id: string; quotationNo: string; customerId?: string | null; customerSnapshot?: { title?: string; name: string; organizationName?: string; organizationAddress?: string; email?: string; contactNo?: string } | null; salesPersonName?: string | null; deliveryDate?: string | null; deliveryAddress?: string | null }[];
  salesPersonId?: string;
  salesPersonName?: string;
  associateSalesPersons?: { id: string; name: string }[];
  sets?: number;
  subtotal?: string;
  overallDiscountPct?: string;
  overallDiscountAmt?: string;
  sst?: string;
  sstPct?: string;
  grandTotal?: string;
  notes?: string;
  deliveryDate?: Date;
  deliveryAddress?: string;
  supplierQuotationKey?: string;
  soType?: "standard" | "proforma" | "urgent";
  proformaReason?: "sample" | "warranty" | "replacement";
  originalSoId?: string;
  originalSoNo?: string;
  urgentAuthType?: "verbal" | "email" | "loi" | "internal";
  urgentAuthBy?: string;
  urgentAuthDate?: string;
  urgentPoExpectedBy?: string;
  urgentAuthNotes?: string;
  // Traceability only, set solely by the internal intercompany trigger (see
  // server/intercompany.ts) — never accepted from the client. Marks this SO
  // as auto-created because a sibling org confirmed a PO against a supplier
  // linked to this org.
  sourceOrganizationId?: string;
  sourcePurchaseOrderId?: string;
  items: SalesOrderItemInput[];
}

export interface UpdateSalesOrderInput extends Omit<CreateSalesOrderInput, "items"> {
  id: string;
  status?: string;
  items: SalesOrderItemInput[];
}

export type SalesOrderWithItems = SalesOrderRow & SalesOrderMeta & { items: SalesOrderItem[]; cpoCustomers: CpoCustomer[] };

// ── Queries ────────────────────────────────────────────────────────────────

export async function getExistingDraftSo(): Promise<{ id: string; soNo: string } | null> {
  const { orgId } = await requireAccess("sales-order:read");
  const [row] = await db
    .select({ id: salesOrder.id, soNo: salesOrder.soNo })
    .from(salesOrder)
    .where(and(eq(salesOrder.organizationId, orgId), eq(salesOrder.status, "draft")))
    .limit(1);
  return row ?? null;
}

export async function searchConfirmedSalesOrders(
  query: string,
  opts?: { includeStatuses?: string[] },
): Promise<
  { id: string; soNo: string; soType: string; proformaReason: string | null; customerSnapshot: SalesOrderRow["customerSnapshot"] }[]
> {
  const { orgId } = await requireAccess("delivery-order:create");
  const statuses = opts?.includeStatuses ?? ["confirmed"];
  const q = `%${query.trim()}%`;
  const rows = await db
    .select({
      id: salesOrder.id,
      soNo: salesOrder.soNo,
      soType: salesOrder.soType,
      proformaReason: salesOrder.proformaReason,
      customerSnapshot: salesOrder.customerSnapshot,
    })
    .from(salesOrder)
    .where(
      and(
        eq(salesOrder.organizationId, orgId),
        inArray(salesOrder.status, statuses),
        eq(salesOrder.stockReservationStatus, "reserved"),
        query.trim().length >= 1
          ? ilike(salesOrder.soNo, q)
          : undefined,
      ),
    )
    .orderBy(desc(salesOrder.createdAt))
    .limit(10);
  return rows;
}

export async function getSalesOrders(): Promise<SalesOrderListRow[]> {
  const { orgId } = await requireAccess("sales-order:read");

  const rows = await db
    .select()
    .from(salesOrder)
    .where(eq(salesOrder.organizationId, orgId))
    .orderBy(desc(salesOrder.createdAt));

  return enrichSalesOrderRows(rows);
}

export type CentralizedSalesOrder = SalesOrderListRow & { organizationName: string };

// Cross-org view for members explicitly granted sales-order:read:centralized
// — every Sales Order recorded under any org the same owner controls, not
// just the caller's own active org.
export async function getSalesOrdersCentralized(): Promise<CentralizedSalesOrder[]> {
  const { orgId, userId } = await requireAccess("sales-order:read:centralized");
  const ownerOrgIds = await getAllOwnerOrgIds(userId, orgId);

  const rows = await db
    .select({ so: salesOrder, organizationName: organization.name })
    .from(salesOrder)
    .innerJoin(organization, eq(organization.id, salesOrder.organizationId))
    .where(inArray(salesOrder.organizationId, ownerOrgIds))
    .orderBy(desc(salesOrder.createdAt));

  const orgNameById = new Map(rows.map((r) => [r.so.id, r.organizationName]));
  const enriched = await enrichSalesOrderRows(rows.map((r) => r.so));
  return enriched.map((r) => ({ ...r, organizationName: orgNameById.get(r.id)! }));
}

async function enrichSalesOrderRows(rows: SalesOrderRow[]): Promise<SalesOrderListRow[]> {
  if (rows.length === 0) return [];

  const creatorIds = [...new Set(rows.map((r) => r.createdBy))];

  const allCpoIds = [
    ...new Set(
      rows.flatMap((r) => {
        const links = r.customerPoLinks as { customerPoId: string }[] | null;
        return links?.map((l) => l.customerPoId) ?? [];
      }),
    ),
  ];

  const [users, cpoRows] = await Promise.all([
    db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, creatorIds)),
    allCpoIds.length > 0
      ? db
          .select({ id: customerPurchaseOrder.id, customerId: customerPurchaseOrder.customerId, customerSnapshot: customerPurchaseOrder.customerSnapshot, deliveryDate: customerPurchaseOrder.deliveryDate, salesPersonName: customerPurchaseOrder.salesPersonName })
          .from(customerPurchaseOrder)
          .where(inArray(customerPurchaseOrder.id, allCpoIds))
      : Promise.resolve([]),
  ]);

  const nameOf = (id: string) => users.find((u) => u.id === id)?.name ?? null;
  const cpoMap = new Map(cpoRows.map((c) => [c.id, c]));

  return rows.map((r) => {
    const links = r.customerPoLinks as { customerPoId: string; customerPoNo: string; salesPersonName?: string | null; externalPersons?: { id: string; name: string }[] }[] | null;
    const cpoCustomers: CpoCustomer[] = (links ?? []).map((l) => {
      const cpo = cpoMap.get(l.customerPoId);
      return {
        customerPoId: l.customerPoId,
        customerPoNo: l.customerPoNo,
        customerId: cpo?.customerId ?? null,
        customerSnapshot: (cpo?.customerSnapshot as CpoCustomer["customerSnapshot"]) ?? null,
        deliveryDate: cpo?.deliveryDate ?? null,
        salesPersonName: cpo?.salesPersonName ?? null,
        soSalesPersonName: l.salesPersonName ?? null,
        externalPersons: l.externalPersons ?? [],
      };
    });
    return { ...r, createdByName: nameOf(r.createdBy), cpoCustomers };
  });
}

export async function getSalesOrderDetail(id: string): Promise<SalesOrderWithItems | null> {
  const { orgId } = await requireAccess("sales-order:read");

  const [so] = await db
    .select()
    .from(salesOrder)
    .where(and(eq(salesOrder.id, id), eq(salesOrder.organizationId, orgId)));

  if (!so) return null;
  return fetchSalesOrderWithItems(so);
}

// Same detail, but resolvable across every org the caller's owner controls —
// for members explicitly granted sales-order:read:centralized.
export async function getSalesOrderDetailCentralized(
  id: string,
): Promise<(SalesOrderWithItems & { organizationName: string }) | null> {
  const { orgId, userId } = await requireAccess("sales-order:read:centralized");
  const ownerOrgIds = await getAllOwnerOrgIds(userId, orgId);

  const [row] = await db
    .select({ so: salesOrder, organizationName: organization.name })
    .from(salesOrder)
    .innerJoin(organization, eq(organization.id, salesOrder.organizationId))
    .where(and(eq(salesOrder.id, id), inArray(salesOrder.organizationId, ownerOrgIds)));

  if (!row) return null;
  const detail = await fetchSalesOrderWithItems(row.so);
  return { ...detail, organizationName: row.organizationName };
}

async function fetchSalesOrderWithItems(so: SalesOrderRow): Promise<SalesOrderWithItems> {
  const id = so.id;
  const cpoIds = [
    ...new Set(
      ((so.customerPoLinks as { customerPoId: string }[] | null) ?? []).map((l) => l.customerPoId),
    ),
  ];

  const [items, cpoRows] = await Promise.all([
    db
      .select()
      .from(salesOrderItem)
      .where(eq(salesOrderItem.salesOrderId, id))
      .orderBy(asc(salesOrderItem.rowNo)),
    cpoIds.length > 0
      ? db
          .select({ id: customerPurchaseOrder.id, customerId: customerPurchaseOrder.customerId, customerSnapshot: customerPurchaseOrder.customerSnapshot, deliveryDate: customerPurchaseOrder.deliveryDate, salesPersonName: customerPurchaseOrder.salesPersonName })
          .from(customerPurchaseOrder)
          .where(inArray(customerPurchaseOrder.id, cpoIds))
      : Promise.resolve([]),
  ]);

  const rejectorIds = items.map((i) => i.approvalRejectedBy).filter((x): x is string => !!x);
  const userIds = [...new Set([so.createdBy, so.submittedBy, so.approvedBy, ...rejectorIds].filter((x): x is string => !!x))];
  const users = userIds.length > 0
    ? await db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, userIds))
    : [];

  const nameOf = (uid: string | null) => users.find((u) => u.id === uid)?.name ?? null;
  const cpoMap = new Map(cpoRows.map((c) => [c.id, c]));

  const links = (so.customerPoLinks as { customerPoId: string; customerPoNo: string; salesPersonName?: string | null; externalPersons?: { id: string; name: string }[] }[] | null) ?? [];
  const cpoCustomers: CpoCustomer[] = links.map((l) => {
    const cpo = cpoMap.get(l.customerPoId);
    return {
      customerPoId: l.customerPoId,
      customerPoNo: l.customerPoNo,
      customerId: cpo?.customerId ?? null,
      customerSnapshot: (cpo?.customerSnapshot as CpoCustomer["customerSnapshot"]) ?? null,
      deliveryDate: cpo?.deliveryDate ?? null,
      salesPersonName: cpo?.salesPersonName ?? null,
      soSalesPersonName: l.salesPersonName ?? null,
      externalPersons: l.externalPersons ?? [],
    };
  });

  return {
    ...so,
    createdByName: nameOf(so.createdBy),
    submittedByName: nameOf(so.submittedBy ?? null),
    approvedByName: nameOf(so.approvedBy ?? null),
    items: items.map((i) => ({ ...i, approvalRejectedByName: nameOf(i.approvalRejectedBy) })),
    cpoCustomers,
  };
}

export async function getSalesOrderForPrint(id: string) {
  const { orgId } = await requireAccess("sales-order:read");

  const [so] = await db
    .select()
    .from(salesOrder)
    .where(and(eq(salesOrder.id, id), eq(salesOrder.organizationId, orgId)));

  if (!so) return null;

  const cpoIds = [
    ...new Set(
      ((so.customerPoLinks as { customerPoId: string }[] | null) ?? []).map((l) => l.customerPoId),
    ),
  ];

  const [items, userRows, orgRows, cpoRows] = await Promise.all([
    db.select().from(salesOrderItem).where(eq(salesOrderItem.salesOrderId, id)).orderBy(asc(salesOrderItem.rowNo)),
    db.select({ id: user.id, name: user.name }).from(user).where(
      inArray(user.id, [so.createdBy, so.submittedBy, so.approvedBy].filter((x): x is string => !!x)),
    ),
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
    })
    .from(organization)
    .leftJoin(organizationProfile, eq(organizationProfile.organizationId, organization.id))
    .where(eq(organization.id, orgId))
    .limit(1),
    cpoIds.length > 0
      ? db
          .select({
            id: customerPurchaseOrder.id,
            customerId: customerPurchaseOrder.customerId,
            customerSnapshot: customerPurchaseOrder.customerSnapshot,
            deliveryDate: customerPurchaseOrder.deliveryDate,
            salesPersonName: customerPurchaseOrder.salesPersonName,
          })
          .from(customerPurchaseOrder)
          .where(inArray(customerPurchaseOrder.id, cpoIds))
      : Promise.resolve([]),
  ]);

  const r2Public = process.env.R2_PUBLIC_URL ?? "";
  const org     = orgRows[0];
  const orgLogoUrl = org?.logoKey ? `${r2Public}/${org.logoKey}` : (org?.logo ?? null);
  const nameOf  = (uid: string | null) => userRows.find((u) => u.id === uid)?.name ?? null;
  const cpoMap  = new Map(cpoRows.map((c) => [c.id, c]));

  const links = (so.customerPoLinks as { customerPoId: string; customerPoNo: string; salesPersonName?: string | null; externalPersons?: { id: string; name: string }[] }[] | null) ?? [];
  const cpoCustomers: CpoCustomer[] = links.map((l) => {
    const cpo = cpoMap.get(l.customerPoId);
    return {
      customerPoId:    l.customerPoId,
      customerPoNo:    l.customerPoNo,
      customerId:      cpo?.customerId ?? null,
      customerSnapshot: (cpo?.customerSnapshot as CpoCustomer["customerSnapshot"]) ?? null,
      deliveryDate:    cpo?.deliveryDate ?? null,
      salesPersonName: cpo?.salesPersonName ?? null,
      soSalesPersonName: l.salesPersonName ?? null,
      externalPersons: l.externalPersons ?? [],
    };
  });

  return {
    order: so,
    items,
    cpoCustomers,
    createdByName: nameOf(so.createdBy),
    submittedByName: nameOf(so.submittedBy ?? null),
    approvedByName: nameOf(so.approvedBy ?? null),
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
  };
}

// ── Mutations ──────────────────────────────────────────────────────────────

export async function createSalesOrder(input: CreateSalesOrderInput): Promise<SalesOrderRow> {
  const { orgId, userId } = await requireAccess("sales-order:create");
  return applyCreateSalesOrder(orgId, userId, input);
}

// Shared by the public createSalesOrder above (which authorizes the caller
// against their own active org first) and maybeCreateIntercompanySalesOrder
// in server/intercompany.ts (which writes into a *different* org — the
// supplier's linked sibling — after already verifying that org is owned by
// the same owner as the confirming PO). Deliberately not exported: this
// file has "use server" at the top, so an exported async function becomes a
// client-callable server action automatically: this one must stay an
// internal implementation detail, reachable only from trusted server code
// that has already done its own authorization.
async function applyCreateSalesOrder(orgId: string, userId: string, input: CreateSalesOrderInput): Promise<SalesOrderRow> {
  // Build customer snapshot
  const customerSnapshot: SalesOrderRow["customerSnapshot"] = input.customerId
    ? await buildCustomerSnapshot(input.customerId, orgId, input.customerOrgMemberId)
    : null;

  const soNo = await generateSoNo(orgId);

  const [row] = await db
    .insert(salesOrder)
    .values({
      id: nanoid(),
      organizationId: orgId,
      soNo,
      quotationId: input.linkedQuotations?.[0]?.id ?? input.quotationId ?? null,
      quotationNo: input.linkedQuotations?.[0]?.quotationNo ?? input.quotationNo ?? null,
      linkedQuotations: input.linkedQuotations ?? null,
      customerPoId: input.customerPoLinks?.[0]?.customerPoId ?? input.customerPoId ?? null,
      customerPoNo: input.customerPoLinks?.[0]?.customerPoNo ?? input.customerPoNo ?? null,
      customerPoLinks: input.customerPoLinks && input.customerPoLinks.length > 0 ? input.customerPoLinks : null,
      customerId: input.customerId ?? null,
      customerSnapshot: customerSnapshot ?? null,
      supplierQuotationKey: input.supplierQuotationKey ?? null,
      salesPersonId: input.salesPersonId ?? null,
      salesPersonName: input.salesPersonName ?? null,
      associateSalesPersons: input.associateSalesPersons ?? null,
      sets: input.sets ?? 1,
      subtotal: input.subtotal ?? "0",
      overallDiscountPct: input.overallDiscountPct ?? "0",
      overallDiscountAmt: input.overallDiscountAmt ?? "0",
      sst: input.sst ?? "0",
      sstPct: input.sstPct ?? "0",
      grandTotal: input.grandTotal ?? "0",
      notes: input.notes ?? null,
      deliveryDate: input.deliveryDate ?? null,
      deliveryAddress: input.deliveryAddress ?? null,
      soType: input.soType ?? "standard",
      proformaReason: input.proformaReason ?? null,
      originalSoId: input.originalSoId ?? null,
      originalSoNo: input.originalSoNo ?? null,
      urgentAuthType: input.urgentAuthType ?? null,
      urgentAuthBy: input.urgentAuthBy ?? null,
      urgentAuthDate: input.urgentAuthDate ?? null,
      urgentPoExpectedBy: input.urgentPoExpectedBy ?? null,
      urgentAuthNotes: input.urgentAuthNotes ?? null,
      sourceOrganizationId: input.sourceOrganizationId ?? null,
      sourcePurchaseOrderId: input.sourcePurchaseOrderId ?? null,
      status: "pending-do",
      createdBy: userId,
    })
    .returning();

  if (input.items.length > 0) {
    await db.insert(salesOrderItem).values(
      input.items.map((item) => ({
        id: nanoid(),
        salesOrderId: row.id,
        rowNo: item.rowNo,
        productId: item.productId ?? null,
        productCode: item.productCode ?? null,
        description: item.description ?? null,
        qty: item.qty ?? "1",
        uom: item.uom ?? null,
        unitPrice: item.unitPrice ?? "0",
        discountPct: item.discountPct ?? "0",
        discountAmt: item.discountAmt ?? "0",
        totalPrice: item.totalPrice ?? "0",
        lineType: item.lineType ?? "sell",
        rentalDuration: item.rentalDuration ?? null,
        rentalUnit: item.rentalUnit ?? null,
        sourcingType: item.sourcingType ?? null,
        designBrandName: item.designBrandName ?? null,
        designBrandCode: item.designBrandCode ?? null,
        privateLabelCode: item.privateLabelCode ?? null,
        designBrandSource: item.designBrandSource ?? null,
        privateLabelSource: item.privateLabelSource ?? null,
        setGroupId: item.setGroupId ?? null,
        setGroupLabel: item.setGroupLabel ?? null,
        setQty: item.setQty ?? null,
        cpoDescription: item.cpoDescription?.trim() || null,
        setCpoTitle: item.setCpoTitle?.trim() || null,
        sourceQuotationId: item.sourceQuotationId || null,
        sourceCustomerPoId: item.sourceCustomerPoId || null,
        sourceCustomerPoNo: item.sourceCustomerPoNo || null,
        customerId: item.customerId || null,
        customerOrganizationId: item.customerOrganizationId || null,
        customerName: item.customerName || null,
        customerOrganization: item.customerOrganization || null,
        descriptionSource: item.descriptionSource ?? null,
        codeSource: item.codeSource ?? null,
        qtySource: item.qtySource ?? null,
        uomSource: item.uomSource ?? null,
        unitPriceSource: item.unitPriceSource ?? null,
        discountSource: item.discountSource ?? null,
        editedBy: item.editedBy ?? null,
        soEditedBy: item.soEditedBy ?? null,
        isAdditional: item.isAdditional ?? false,
      })),
    );
  }

  // Determine correct initial status now that items are in the DB (product code
  // resolution requires a DB lookup against this org's catalog). Not
  // getSoStockStatus: that requires orgId to be the caller's active org, which
  // the intercompany path (SO created in the receiving org) never is — it threw,
  // and the CPO back-link below never ran. Both callers authorize orgId first.
  const soStatus = await soStockStatusFor(orgId, row.id);
  if (soStatus !== "pending-do") {
    await db.update(salesOrder).set({ status: soStatus }).where(eq(salesOrder.id, row.id));
    row.status = soStatus;
  }

  // Back-link: update all linked Customer POs so they point to this new SO
  const cpoLinks = input.customerPoLinks ?? (input.customerPoId ? [{ customerPoId: input.customerPoId, customerPoNo: input.customerPoNo ?? "" }] : []);
  for (const link of cpoLinks) {
    await db
      .update(customerPurchaseOrder)
      .set({ salesOrderId: row.id, salesOrderNo: row.soNo })
      .where(eq(customerPurchaseOrder.id, link.customerPoId));
    revalidatePath(`/dashboard/sales/customer-po/${link.customerPoId}`);
  }

  revalidatePath("/dashboard/sales/order");
  return row;
}

// Called (fire-and-forget-safe — never throws) right after a PO transitions
// to "confirmed" in server/purchase-order.ts. If that PO's supplier is
// linked to a sibling organization (supplier.linkedOrganizationId — same
// owner), auto-creates a matching Sales Order there, pre-filled from the
// PO's items. One-shot only: nothing here keeps the two documents in sync
// afterward, and the idempotency check below means calling this again for
// the same PO (e.g. recall + reconfirm) is always safe.
//
// Exported (required to reach applyCreateSalesOrder, which is private to
// this file) but deliberately takes only a poId rather than trusting any
// caller-supplied org/customer/item data — everything else is re-derived
// and re-verified server-side, since an exported function in a "use server"
// file is a public, directly client-callable action regardless of who it
// was written for. Authorization is scoped to the PO's own org: the caller
// must hold at least purchase-order:read there, and the PO itself must
// belong to the caller's own active org (PO confirm actions are never
// cross-org today — see createPurchaseOrder/approvePurchaseOrder/
// reconfirmPurchaseOrder in server/purchase-order.ts, all scoped to the
// caller's own active org only).
export async function maybeCreateIntercompanySalesOrder(poId: string): Promise<void> {
  try {
    const { orgId: callerOrgId, userId } = await requireAccess("purchase-order:read");

    const [po] = await db.select().from(purchaseOrder).where(eq(purchaseOrder.id, poId));
    if (!po || po.organizationId !== callerOrgId || po.status !== "confirmed" || !po.supplierId) return;

    const [sup] = await db.select({ linkedOrganizationId: supplier.linkedOrganizationId }).from(supplier).where(eq(supplier.id, po.supplierId));
    if (!sup?.linkedOrganizationId) return; // the common case — not a linked supplier, nothing to do

    // Idempotency guard — prevents a duplicate SO if this PO is later
    // recalled and reconfirmed (this function runs from that path too).
    const [existingSo] = await db.select({ id: salesOrder.id }).from(salesOrder).where(eq(salesOrder.sourcePurchaseOrderId, poId)).limit(1);
    if (existingSo) return;

    // Re-verify the link is still valid — ownership could have changed
    // since it was set on the supplier record.
    const ownerOrgIds = await getAllOwnerOrgIds(userId, callerOrgId);
    if (!ownerOrgIds.includes(sup.linkedOrganizationId)) return;
    const targetOrgId = sup.linkedOrganizationId;

    // Find (or provision) the customer record in the target org that
    // represents this source org, so repeat POs against the same linked
    // supplier reuse the same customer instead of creating a new one each time.
    // customer.linkedOrganizationId being set is also what marks this — and
    // any Customer PO created against it — as intercompany rather than a
    // real external customer, everywhere else that needs to tell them apart
    // (the centralized Customer PO list, the per-org revenue summary).
    let [cust] = await db
      .select({ id: customer.id, name: customer.name })
      .from(customer)
      .where(and(eq(customer.organizationId, targetOrgId), eq(customer.linkedOrganizationId, callerOrgId)));
    if (!cust) {
      const [sourceOrg] = await db.select({ name: organization.name }).from(organization).where(eq(organization.id, callerOrgId));
      const name = sourceOrg?.name ?? "Unknown organization";
      const [created] = await db
        .insert(customer)
        .values({
          id: nanoid(),
          organizationId: targetOrgId,
          name,
          organizationName: name,
          linkedOrganizationId: callerOrgId,
          createdBy: userId,
        })
        .returning({ id: customer.id, name: customer.name });
      cust = created;
    }

    const poItems = await db
      .select()
      .from(purchaseOrderItem)
      .where(eq(purchaseOrderItem.purchaseOrderId, poId))
      .orderBy(asc(purchaseOrderItem.rowNo));
    if (poItems.length === 0) return;

    // The PO lines' productId points into the *sending* org's catalog — wrong
    // for an SO in the receiving org (its stock check would never match).
    // Re-resolve each line by product code against the receiving org's own
    // catalog; a code it doesn't carry stays unlinked, which the stock check
    // treats as needing purchase (pending-pr).
    const codes = [...new Set(poItems.map((i) => i.productCode?.trim()).filter((c): c is string => !!c))];
    const targetProducts = codes.length > 0
      ? await db
          .select({ id: product.id, productCode: product.productCode })
          .from(product)
          .where(and(eq(product.organizationId, targetOrgId), inArray(product.productCode, codes)))
      : [];
    const targetProductId = new Map(targetProducts.map((p) => [p.productCode, p.id]));

    // The sending org's PO number *is* the receiving org's Customer PO
    // reference — customerPurchaseOrder.customerPoNo is defined as exactly
    // that ("the PO number on customer's document"). Creating this keeps
    // the auto-created SO inside the normal CPO → SO → PR → SPO → Packing
    // List → GR traceability chain instead of skipping it.
    // (the number must be unique in the receiving org, so a clash with one of its own CPOs gets a -2, -3 … suffix)
    const cpoNoForTarget = await uniqueCpoNoFor(targetOrgId, po.poNo ?? po.id);
    const [cpo] = await db
      .insert(customerPurchaseOrder)
      .values({
        id: nanoid(),
        organizationId: targetOrgId,
        customerPoNo: cpoNoForTarget,
        customerId: cust.id,
        customerSnapshot: { name: cust.name },
        items: poItems.map((item) => ({
          rowNo: item.rowNo,
          productCode: item.productCode ?? "",
          description: item.description ?? "",
          qty: item.qty ?? "1",
          uom: item.uom ?? "",
          unitPrice: item.unitPrice ?? "0",
          discountPct: "0",
          totalPrice: item.totalPrice ?? "0",
          lineType: "sell",
          setGroupId: item.setGroupId ?? undefined,
          setGroupLabel: item.setGroupLabel ?? undefined,
          setQty: item.setQty ?? undefined,
        })),
        amount: po.grandTotal ?? "0",
        currency: po.currency ?? "MYR",
        receivedDate: new Date(),
        deliveryDate: po.expectedDeliveryDate ?? null,
        deliveryAddress: po.deliveryAddress ?? null,
        status: "received",
        createdBy: userId,
      })
      .returning();

    await applyCreateSalesOrder(targetOrgId, userId, {
      customerId: cust.id,
      customerPoId: cpo.id,
      customerPoNo: cpo.customerPoNo,
      deliveryDate: po.expectedDeliveryDate ?? undefined,
      deliveryAddress: po.deliveryAddress ?? undefined,
      sourceOrganizationId: callerOrgId,
      sourcePurchaseOrderId: poId,
      items: poItems.map((item) => ({
        rowNo: item.rowNo,
        productId: (item.productCode && targetProductId.get(item.productCode.trim())) || undefined,
        productCode: item.productCode ?? undefined,
        description: item.description ?? undefined,
        qty: item.qty ?? undefined,
        uom: item.uom ?? undefined,
        unitPrice: item.unitPrice ?? undefined,
        totalPrice: item.totalPrice ?? undefined,
        setGroupId: item.setGroupId ?? undefined,
        setGroupLabel: item.setGroupLabel ?? undefined,
        setQty: item.setQty ?? undefined,
        sourcingType: item.sourcingType === "trading" || item.sourcingType === "oem" ? item.sourcingType : undefined,
        designBrandName: item.designBrandName ?? undefined,
        designBrandCode: item.designBrandCode ?? undefined,
        privateLabelCode: item.privateLabelCode ?? undefined,
        designBrandSource: item.designBrandSource === "catalog" || item.designBrandSource === "user" ? item.designBrandSource : undefined,
        privateLabelSource: item.privateLabelSource === "auto" || item.privateLabelSource === "user" ? item.privateLabelSource : undefined,
        isAdditional: item.isAdditional ?? undefined,
        editedBy: item.editedBy ?? undefined,
      })),
    });

    revalidatePath("/dashboard/sales/order");
    revalidatePath("/dashboard/sales/customer-po");
  } catch (e) {
    // Must never block the PO confirmation itself from succeeding.
    console.error("maybeCreateIntercompanySalesOrder failed:", e);
  }
}

export async function updateSalesOrder(input: UpdateSalesOrderInput): Promise<SalesOrderRow> {
  const { orgId, userId } = await requireAccess("sales-order:update");

  const [existing] = await db
    .select()
    .from(salesOrder)
    .where(and(eq(salesOrder.id, input.id), eq(salesOrder.organizationId, orgId)));

  if (!existing) throw new Error("Sales order not found");
  const ownerOrgIds = await getAllOwnerOrgIds(userId, orgId);
  return applySalesOrderUpdate(existing, input, userId, ownerOrgIds);
}

// Same update, but resolvable across every org the caller's owner controls —
// for the Edit flow reached from the centralized view.
export async function updateSalesOrderCentralized(input: UpdateSalesOrderInput): Promise<SalesOrderRow> {
  const { orgId, userId } = await requireAccess("sales-order:update:centralized");
  const ownerOrgIds = await getAllOwnerOrgIds(userId, orgId);

  const [existing] = await db
    .select()
    .from(salesOrder)
    .where(and(eq(salesOrder.id, input.id), inArray(salesOrder.organizationId, ownerOrgIds)));

  if (!existing) throw new Error("Sales order not found");
  return applySalesOrderUpdate(existing, input, userId, ownerOrgIds);
}

async function applySalesOrderUpdate(
  existing: SalesOrderRow,
  input: UpdateSalesOrderInput,
  userId: string,
  ownerOrgIds: string[],
): Promise<SalesOrderRow> {
  if (existing.createdBy !== userId) throw new Error("Only the creator can edit this sales order");
  if (existing.status === "submitted" || existing.status === "confirmed")
    throw new Error("Cannot edit a submitted or confirmed sales order");

  // Delete old R2 file if key changed
  if (
    input.supplierQuotationKey !== undefined &&
    existing.supplierQuotationKey &&
    existing.supplierQuotationKey !== input.supplierQuotationKey
  ) {
    await deleteSupplierQuotationFile(existing.supplierQuotationKey);
  }

  // Rebuild customer snapshot if customer changed
  let customerSnapshot: SalesOrderRow["customerSnapshot"] = existing.customerSnapshot;
  if (input.customerId !== undefined) {
    customerSnapshot = input.customerId
      ? await buildCustomerSnapshot(input.customerId, ownerOrgIds, input.customerOrgMemberId)
      : null;
  }

  const [row] = await db
    .update(salesOrder)
    .set({
      customerId: input.customerId ?? existing.customerId,
      customerSnapshot,
      quotationId: input.linkedQuotations !== undefined
        ? (input.linkedQuotations[0]?.id ?? null)
        : (input.quotationId !== undefined ? (input.quotationId ?? null) : existing.quotationId),
      quotationNo: input.linkedQuotations !== undefined
        ? (input.linkedQuotations[0]?.quotationNo ?? null)
        : (input.quotationNo !== undefined ? (input.quotationNo ?? null) : existing.quotationNo),
      linkedQuotations: input.linkedQuotations !== undefined ? (input.linkedQuotations ?? null) : existing.linkedQuotations,
      customerPoId: input.customerPoLinks !== undefined
        ? (input.customerPoLinks[0]?.customerPoId ?? null)
        : (input.customerPoId !== undefined ? (input.customerPoId ?? null) : existing.customerPoId),
      customerPoNo: input.customerPoLinks !== undefined
        ? (input.customerPoLinks[0]?.customerPoNo ?? null)
        : (input.customerPoNo !== undefined ? (input.customerPoNo ?? null) : existing.customerPoNo),
      customerPoLinks: input.customerPoLinks !== undefined
        ? (input.customerPoLinks.length > 0 ? input.customerPoLinks : null)
        : existing.customerPoLinks,
      supplierQuotationKey: input.supplierQuotationKey !== undefined
        ? input.supplierQuotationKey
        : existing.supplierQuotationKey,
      salesPersonId: input.salesPersonId ?? null,
      salesPersonName: input.salesPersonName ?? null,
      associateSalesPersons: input.associateSalesPersons !== undefined ? (input.associateSalesPersons ?? null) : existing.associateSalesPersons,
      sets: input.sets ?? existing.sets,
      subtotal: input.subtotal ?? existing.subtotal,
      overallDiscountPct: input.overallDiscountPct ?? existing.overallDiscountPct,
      overallDiscountAmt: input.overallDiscountAmt ?? existing.overallDiscountAmt,
      sst: input.sst ?? existing.sst,
      sstPct: input.sstPct ?? existing.sstPct,
      grandTotal: input.grandTotal ?? existing.grandTotal,
      notes: input.notes !== undefined ? (input.notes ?? null) : existing.notes,
      deliveryDate: input.deliveryDate !== undefined ? (input.deliveryDate ?? null) : existing.deliveryDate,
      deliveryAddress: input.deliveryAddress !== undefined ? (input.deliveryAddress ?? null) : existing.deliveryAddress,
      urgentAuthType: input.urgentAuthType !== undefined ? (input.urgentAuthType ?? null) : existing.urgentAuthType,
      urgentAuthBy: input.urgentAuthBy !== undefined ? (input.urgentAuthBy ?? null) : existing.urgentAuthBy,
      urgentAuthDate: input.urgentAuthDate !== undefined ? (input.urgentAuthDate ?? null) : existing.urgentAuthDate,
      urgentPoExpectedBy: input.urgentPoExpectedBy !== undefined ? (input.urgentPoExpectedBy ?? null) : existing.urgentPoExpectedBy,
      urgentAuthNotes: input.urgentAuthNotes !== undefined ? (input.urgentAuthNotes ?? null) : existing.urgentAuthNotes,
      status: input.status ?? existing.status,
    })
    .where(eq(salesOrder.id, input.id))
    .returning();

  // Replace items
  await db.delete(salesOrderItem).where(eq(salesOrderItem.salesOrderId, input.id));

  if (input.items.length > 0) {
    await db.insert(salesOrderItem).values(
      input.items.map((item) => ({
        id: nanoid(),
        salesOrderId: input.id,
        rowNo: item.rowNo,
        productId: item.productId ?? null,
        productCode: item.productCode ?? null,
        description: item.description ?? null,
        qty: item.qty ?? "1",
        uom: item.uom ?? null,
        unitPrice: item.unitPrice ?? "0",
        discountPct: item.discountPct ?? "0",
        discountAmt: item.discountAmt ?? "0",
        totalPrice: item.totalPrice ?? "0",
        lineType: item.lineType ?? "sell",
        rentalDuration: item.rentalDuration ?? null,
        rentalUnit: item.rentalUnit ?? null,
        sourcingType: item.sourcingType ?? null,
        designBrandName: item.designBrandName ?? null,
        designBrandCode: item.designBrandCode ?? null,
        privateLabelCode: item.privateLabelCode ?? null,
        designBrandSource: item.designBrandSource ?? null,
        privateLabelSource: item.privateLabelSource ?? null,
        setGroupId: item.setGroupId ?? null,
        setGroupLabel: item.setGroupLabel ?? null,
        setQty: item.setQty ?? null,
        cpoDescription: item.cpoDescription?.trim() || null,
        setCpoTitle: item.setCpoTitle?.trim() || null,
        sourceQuotationId: item.sourceQuotationId || null,
        sourceCustomerPoId: item.sourceCustomerPoId || null,
        sourceCustomerPoNo: item.sourceCustomerPoNo || null,
        customerId: item.customerId || null,
        customerOrganizationId: item.customerOrganizationId || null,
        customerName: item.customerName || null,
        customerOrganization: item.customerOrganization || null,
        descriptionSource: item.descriptionSource ?? null,
        codeSource: item.codeSource ?? null,
        qtySource: item.qtySource ?? null,
        uomSource: item.uomSource ?? null,
        unitPriceSource: item.unitPriceSource ?? null,
        discountSource: item.discountSource ?? null,
        editedBy: item.editedBy ?? null,
        soEditedBy: item.soEditedBy ?? null,
        isAdditional: item.isAdditional ?? false,
      })),
    );
  }

  revalidatePath("/dashboard/sales/order");
  return row;
}

// Problems come back as a readable message, not a thrown error (those are
// hidden in production). Every check runs before anything is written: the
// writes below aren't in a transaction, so a check failing halfway would
// leave POs/Customer POs unlinked from an SO that still exists.
export async function deleteSalesOrder(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { orgId, userId } = await requireAccess("sales-order:delete");

  const [existing] = await db
    .select()
    .from(salesOrder)
    .where(and(eq(salesOrder.id, id), eq(salesOrder.organizationId, orgId)));

  if (!existing) return { ok: false, error: "Sales order not found" };
  if (existing.createdBy !== userId) return { ok: false, error: "Only the creator can delete this sales order" };
  if (existing.status === "submitted" || existing.status === "confirmed" || existing.status === "fulfilled")
    return { ok: false, error: "Only draft or cancelled orders can be deleted" };

  const blocker = (await salesOrderDeleteBlockers(orgId, [{ id, soNo: existing.soNo }])).get(id);
  if (blocker) return { ok: false, error: blocker };

  // Delete R2 supplier quotation file if present
  if (existing.supplierQuotationKey) {
    await deleteSupplierQuotationFile(existing.supplierQuotationKey);
  }

  // Unlink any POs that reference this SO (set salesOrderId → null)
  await db
    .update(purchaseOrder)
    .set({ salesOrderId: null })
    .where(and(eq(purchaseOrder.organizationId, orgId), eq(purchaseOrder.salesOrderId, id)));

  // Unlink any DOs that reference this SO
  await db
    .update(deliveryOrder)
    .set({ salesOrderId: null, salesOrderNo: null })
    .where(and(eq(deliveryOrder.organizationId, orgId), eq(deliveryOrder.salesOrderId, id)));

  // Unlink any Customer POs that reference this SO
  await db
    .update(customerPurchaseOrder)
    .set({ salesOrderId: null, salesOrderNo: null })
    .where(and(eq(customerPurchaseOrder.organizationId, orgId), eq(customerPurchaseOrder.salesOrderId, id)));

  // Unlink any invoices that reference this SO
  await db
    .update(invoice)
    .set({ salesOrderId: null, salesOrderNo: null })
    .where(and(eq(invoice.organizationId, orgId), eq(invoice.salesOrderId, id)));

  // Delete the SO (items cascade via onDelete: "cascade")
  await db.delete(salesOrder).where(eq(salesOrder.id, id));

  // Release the running number: decrement the counter if this was the latest number for the year
  const soYear = parseInt(existing.soNo.match(/\d{4}/)?.[0] ?? "0", 10);
  const soNum  = parseInt(existing.soNo.split("-").pop() ?? "0", 10);

  if (soYear > 0 && soNum > 0) {
    const [counter] = await db
      .select()
      .from(salesOrderCounter)
      .where(eq(salesOrderCounter.organizationId, orgId))
      .limit(1);

    if (counter && counter.year === soYear && counter.lastNumber === soNum && soNum > 1) {
      await db
        .update(salesOrderCounter)
        .set({ lastNumber: soNum - 1 })
        .where(eq(salesOrderCounter.organizationId, orgId));
    }
  }

  revalidatePath("/dashboard/sales/order");
  return { ok: true };
}

export async function updateSalesOrderStatus(id: string, status: string): Promise<void> {
  const { orgId } = await requireAccess("sales-order:update");

  const [existing] = await db
    .select({ status: salesOrder.status, stockReservationStatus: salesOrder.stockReservationStatus })
    .from(salesOrder)
    .where(and(eq(salesOrder.id, id), eq(salesOrder.organizationId, orgId)));

  if (!existing) throw new Error("Sales order not found");

  await db
    .update(salesOrder)
    .set({ status })
    .where(and(eq(salesOrder.id, id), eq(salesOrder.organizationId, orgId)));

  // Release reservation when cancelling a confirmed order that actually holds stock
  if (existing.status === "confirmed" && status === "cancelled" && existing.stockReservationStatus === "reserved") {
    const soItems = await db
      .select({ productId: salesOrderItem.productId, qty: salesOrderItem.qty })
      .from(salesOrderItem)
      .where(eq(salesOrderItem.salesOrderId, id));

    await Promise.all(
      soItems
        .filter((i) => i.productId)
        .map((i) =>
          adjustReservation({
            orgId,
            productId: i.productId!,
            warehouseLabel: "Default",
            delta: -parseFloat(i.qty ?? "1"),
          }),
        ),
    );
  }
}

// ── Notification helper ────────────────────────────────────────────────────

async function notifyAndEmail(params: {
  orgId: string;
  recipientUserIds: string[];
  type: "so:submitted" | "so:approved" | "so:rejected" | "so:recalled";
  emailType: "submitted" | "approved" | "rejected" | "recalled";
  title: string;
  body: string;
  soNo: string;
  soId: string;
  customerName?: string;
  grandTotal?: string;
  actorName?: string;
}) {
  const link = `${baseUrl}/dashboard/sales/order/${params.soId}`;

  // Fetch recipient emails in parallel with notification creation
  const recipients = await db
    .select({ id: user.id, email: user.email, name: user.name })
    .from(user)
    .where(inArray(user.id, params.recipientUserIds));

  await Promise.all([
    // In-app notifications
    ...params.recipientUserIds.map((userId) =>
      createNotification({
        organizationId: params.orgId,
        userId,
        type: params.type,
        title: params.title,
        body: params.body,
        link: `/dashboard/sales/order/${params.soId}`,
      }),
    ),
    // Emails
    ...recipients.map((r) =>
      resend.emails.send({
        from: `${process.env.EMAIL_SENDER_NAME} <${process.env.EMAIL_SENDER_ADDRESS}>`,
        to: r.email,
        subject: testingSubject(params.title),
        react: SoNotificationEmail({
          type: params.emailType,
          soNo: params.soNo,
          customerName: params.customerName,
          grandTotal: params.grandTotal,
          recipientName: r.name,
          actorName: params.actorName,
          link,
        }),
      }),
    ),
  ]);
}

// ── Submit (draft → submitted) ─────────────────────────────────────────────

export async function submitSalesOrder(id: string): Promise<void> {
  const { orgId, userId, session } = await requireAccess("sales-order:update");

  const [so] = await db
    .select({
      id: salesOrder.id,
      soNo: salesOrder.soNo,
      status: salesOrder.status,
      customerSnapshot: salesOrder.customerSnapshot,
      grandTotal: salesOrder.grandTotal,
      createdBy: salesOrder.createdBy,
    })
    .from(salesOrder)
    .where(and(eq(salesOrder.id, id), eq(salesOrder.organizationId, orgId)));

  if (!so) throw new Error("Sales order not found");
  if (!["draft", "pending-do", "pending-pr"].includes(so.status)) throw new Error("Only draft orders can be submitted");

  await db
    .update(salesOrder)
    .set({ status: "submitted", submittedBy: userId, submittedAt: new Date() })
    .where(eq(salesOrder.id, id));

  revalidatePath(`/dashboard/sales/order/${id}`);
  revalidatePath("/dashboard/sales/order");

  // Notify approvers (fire-and-forget — don't block the response)
  const snap = so.customerSnapshot as any;
  const customerName = snap ? [snap.title, snap.name].filter(Boolean).join(" ") : undefined;
  const actorName = session.user.name;

  getSoApprovers(orgId).then((approverIds) => {
    // Don't notify the submitter if they are also an approver
    const targets = approverIds.filter((uid) => uid !== userId);
    if (targets.length === 0) return;
    notifyAndEmail({
      orgId,
      recipientUserIds: targets,
      type: "so:submitted",
      emailType: "submitted",
      title: `SO ${so.soNo} pending approval`,
      body: `${actorName} submitted ${so.soNo} for approval.`,
      soNo: so.soNo,
      soId: so.id,
      customerName,
      grandTotal: so.grandTotal ?? undefined,
      actorName,
    });
  }).catch(console.error);
}

// ── Approve (submitted → confirmed) ───────────────────────────────────────

export async function approveSalesOrder(id: string): Promise<void> {
  const { orgId, userId, session } = await requireAccess("sales-order:approve");

  const [so] = await db
    .select({ id: salesOrder.id, soNo: salesOrder.soNo, status: salesOrder.status, customerSnapshot: salesOrder.customerSnapshot, grandTotal: salesOrder.grandTotal, createdBy: salesOrder.createdBy })
    .from(salesOrder)
    .where(and(eq(salesOrder.id, id), eq(salesOrder.organizationId, orgId)));

  if (!so) throw new Error("Sales order not found");
  if (so.status !== "submitted") throw new Error("Only submitted orders can be approved");
  await assertSelfActionAllowed(orgId, "sales-order:approve", so.createdBy, userId, "approve");

  await db.update(salesOrder).set({ status: "confirmed", approvedBy: userId, approvedAt: new Date() }).where(eq(salesOrder.id, id));

  const soItems = await db
    .select({ productId: salesOrderItem.productId })
    .from(salesOrderItem)
    .where(eq(salesOrderItem.salesOrderId, id));

  const productIds = soItems.filter((i) => i.productId).map((i) => i.productId!);

  // Attempt to reserve stock; insufficient stock is recorded on the SO rather than blocking approval
  await performStockCheckAndReserve(orgId, userId, id).catch(console.error);

  // Auto-create replenishment PRs for products whose available stock dropped to/below reorder point
  checkAndTriggerReplenishment(orgId, userId, productIds).catch(console.error);

  revalidatePath(`/dashboard/sales/order/${id}`);
  revalidatePath("/dashboard/sales/order");

  const snap = so.customerSnapshot as any;
  const customerName = snap ? [snap.title, snap.name].filter(Boolean).join(" ") : undefined;
  const actorName = session.user.name;

  notifyAndEmail({
    orgId,
    recipientUserIds: [so.createdBy],
    type: "so:approved",
    emailType: "approved",
    title: `SO ${so.soNo} approved`,
    body: `Your sales order ${so.soNo} has been approved by ${actorName}.`,
    soNo: so.soNo,
    soId: so.id,
    customerName,
    grandTotal: so.grandTotal ?? undefined,
    actorName,
  }).catch(console.error);
}

// ── Reject (submitted → draft) ────────────────────────────────────────────

export async function rejectSalesOrder(id: string): Promise<void> {
  const { orgId, userId, session } = await requireAccess("sales-order:approve");

  const [so] = await db
    .select({ id: salesOrder.id, soNo: salesOrder.soNo, status: salesOrder.status, customerSnapshot: salesOrder.customerSnapshot, grandTotal: salesOrder.grandTotal, createdBy: salesOrder.createdBy })
    .from(salesOrder)
    .where(and(eq(salesOrder.id, id), eq(salesOrder.organizationId, orgId)));

  if (!so) throw new Error("Sales order not found");
  if (so.status !== "submitted") throw new Error("Only submitted orders can be rejected");
  await assertSelfActionAllowed(orgId, "sales-order:approve", so.createdBy, userId, "reject");

  await db.update(salesOrder).set({ status: "draft" }).where(eq(salesOrder.id, id));

  revalidatePath(`/dashboard/sales/order/${id}`);
  revalidatePath("/dashboard/sales/order");

  const snap = so.customerSnapshot as any;
  const customerName = snap ? [snap.title, snap.name].filter(Boolean).join(" ") : undefined;
  const actorName = session.user.name;

  notifyAndEmail({
    orgId,
    recipientUserIds: [so.createdBy],
    type: "so:rejected",
    emailType: "rejected",
    title: `SO ${so.soNo} returned for revision`,
    body: `Your sales order ${so.soNo} was returned for revision by ${actorName}.`,
    soNo: so.soNo,
    soId: so.id,
    customerName,
    grandTotal: so.grandTotal ?? undefined,
    actorName,
  }).catch(console.error);
}

// ── Recall (confirmed → draft) ────────────────────────────────────────────

// Documents raised from these SOs that are still live, keyed by SO id (SOs
// with none are absent). Recalling an SO while any exist would leave them
// (and, through an intercompany PO, a sibling org's auto-created SO) running
// against an order that's back in draft — nothing propagates a recall or a
// later edit down the chain. Batched so list pages can check every row at once.
async function activeSalesOrderDownstreamMany(orgId: string, soIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (soIds.length === 0) return out;
  const add = (soId: string | null, label: string) => {
    if (!soId) return;
    if (!out.has(soId)) out.set(soId, []);
    out.get(soId)!.push(label);
  };

  const prs = await db
    .select({ id: purchaseRequisition.id, prNo: purchaseRequisition.prNo, status: purchaseRequisition.status, salesOrderId: purchaseRequisition.salesOrderId })
    .from(purchaseRequisition)
    .where(and(inArray(purchaseRequisition.salesOrderId, soIds), eq(purchaseRequisition.organizationId, orgId)));
  const soOfPr = new Map(prs.map((p) => [p.id, p.salesOrderId]));
  const prIds = prs.map((p) => p.id);

  const pos = await db
    .select({ poNo: purchaseOrder.poNo, prNo: purchaseOrder.prNo, salesOrderId: purchaseOrder.salesOrderId, purchaseRequisitionId: purchaseOrder.purchaseRequisitionId })
    .from(purchaseOrder)
    .where(and(
      eq(purchaseOrder.organizationId, orgId),
      ne(purchaseOrder.status, "cancelled"),
      prIds.length > 0
        ? or(inArray(purchaseOrder.salesOrderId, soIds), inArray(purchaseOrder.purchaseRequisitionId, prIds))
        : inArray(purchaseOrder.salesOrderId, soIds),
    ));

  const dos = await db
    .select({ doNo: deliveryOrder.doNo, salesOrderId: deliveryOrder.salesOrderId })
    .from(deliveryOrder)
    .where(and(inArray(deliveryOrder.salesOrderId, soIds), eq(deliveryOrder.organizationId, orgId)));

  const invs = await db
    .select({ invoiceNo: invoice.invoiceNo, salesOrderId: invoice.salesOrderId })
    .from(invoice)
    .where(and(inArray(invoice.salesOrderId, soIds), eq(invoice.organizationId, orgId), ne(invoice.status, "cancelled")));

  for (const p of prs) if (p.status !== "cancelled") add(p.salesOrderId, `PR ${p.prNo}`);
  for (const p of pos) {
    const soId = p.salesOrderId && soIds.includes(p.salesOrderId) ? p.salesOrderId : (p.purchaseRequisitionId ? soOfPr.get(p.purchaseRequisitionId) ?? null : null);
    add(soId, `PO ${p.poNo ?? p.prNo ?? "(unnumbered)"}`);
  }
  for (const d of dos) add(d.salesOrderId, `DO ${d.doNo}`);
  for (const i of invs) add(i.salesOrderId, `Invoice ${i.invoiceNo}`);
  return out;
}

async function activeSalesOrderDownstream(orgId: string, soId: string): Promise<string[]> {
  return (await activeSalesOrderDownstreamMany(orgId, [soId])).get(soId) ?? [];
}

// Why each of these SOs can't be deleted, keyed by SO id (deletable ones are
// absent): active downstream documents, or references the delete doesn't
// unlink — the database refuses to delete an SO that a PR, consignment or
// revision still points at, even a cancelled one. Cancelling the SO instead
// keeps its trail intact.
async function salesOrderDeleteBlockers(orgId: string, sos: { id: string; soNo: string }[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (sos.length === 0) return out;
  const ids = sos.map((s) => s.id);

  const active = await activeSalesOrderDownstreamMany(orgId, ids);
  const prSoIds = new Set((await db.select({ soId: purchaseRequisition.salesOrderId }).from(purchaseRequisition).where(inArray(purchaseRequisition.salesOrderId, ids))).map((r) => r.soId));
  const consignSoIds = new Set([
    ...(await db.select({ soId: consignment.soId }).from(consignment).where(inArray(consignment.soId, ids))).map((r) => r.soId),
    ...(await db.select({ soId: consignHeader.soId }).from(consignHeader).where(inArray(consignHeader.soId, ids))).map((r) => r.soId),
  ]);
  const revisionOf = new Map((await db.select({ originalSoId: salesOrder.originalSoId, soNo: salesOrder.soNo }).from(salesOrder).where(inArray(salesOrder.originalSoId, ids))).map((r) => [r.originalSoId, r.soNo]));

  for (const so of sos) {
    const live = active.get(so.id);
    if (live?.length) out.set(so.id, `Can't delete ${so.soNo} — documents raised from it are still active: ${live.join(", ")}. Cancel those first, or cancel this order instead of deleting it.`);
    else if (prSoIds.has(so.id)) out.set(so.id, `Can't delete ${so.soNo} — a purchase requisition was raised from it. Cancel the order instead.`);
    else if (consignSoIds.has(so.id)) out.set(so.id, `Can't delete ${so.soNo} — it has consignment records. Cancel the order instead.`);
    else if (revisionOf.has(so.id)) out.set(so.id, `Can't delete ${so.soNo} — ${revisionOf.get(so.id)} is a revision of it. Cancel the order instead.`);
  }
  return out;
}

// Read-only: why each of these SOs can't be deleted (deletable ones absent).
// The list and detail pages hide Delete for these; deleteSalesOrder re-checks.
export async function getSalesOrderDeleteBlockers(soIds: string[]): Promise<Record<string, string>> {
  const { orgId } = await requireAccess("sales-order:read");
  if (soIds.length === 0) return {};
  const sos = await db
    .select({ id: salesOrder.id, soNo: salesOrder.soNo })
    .from(salesOrder)
    .where(and(inArray(salesOrder.id, soIds), eq(salesOrder.organizationId, orgId)));
  return Object.fromEntries(await salesOrderDeleteBlockers(orgId, sos));
}

// Read-only: what would stop this SO being recalled. The detail page hides
// the Recall button when this isn't empty; recallSalesOrder re-checks anyway.
export async function getSalesOrderRecallBlockers(soId: string): Promise<string[]> {
  const { orgId } = await requireAccess("sales-order:read");
  const [so] = await db.select({ id: salesOrder.id }).from(salesOrder).where(and(eq(salesOrder.id, soId), eq(salesOrder.organizationId, orgId)));
  if (!so) return [];
  return activeSalesOrderDownstream(orgId, soId);
}

// Problems come back as a readable message, not a thrown error (those are
// hidden in production).
export async function recallSalesOrder(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { orgId, userId, session } = await requireAccess("sales-order:approve");

  const [so] = await db
    .select({ id: salesOrder.id, soNo: salesOrder.soNo, status: salesOrder.status, customerSnapshot: salesOrder.customerSnapshot, grandTotal: salesOrder.grandTotal, createdBy: salesOrder.createdBy, stockReservationStatus: salesOrder.stockReservationStatus })
    .from(salesOrder)
    .where(and(eq(salesOrder.id, id), eq(salesOrder.organizationId, orgId)));

  if (!so) return { ok: false, error: "Sales order not found" };
  if (so.status !== "confirmed") return { ok: false, error: "Only confirmed orders can be recalled" };
  await assertSelfActionAllowed(orgId, "sales-order:approve", so.createdBy, userId, "recall");

  const downstream = await activeSalesOrderDownstream(orgId, id);
  if (downstream.length > 0) {
    return {
      ok: false,
      error: `Can't recall ${so.soNo} — documents raised from it are still active: ${downstream.join(", ")}. Cancel or recall those first.`,
    };
  }

  await db.update(salesOrder).set({ status: "draft", approvedBy: null, approvedAt: null, stockReservationStatus: null, stockReservedAt: null, stockReservedBy: null }).where(eq(salesOrder.id, id));

  // Release reserved stock (only if it was actually reserved)
  if (so.stockReservationStatus === "reserved") {
    const soItems = await db
      .select({ productId: salesOrderItem.productId, qty: salesOrderItem.qty })
      .from(salesOrderItem)
      .where(eq(salesOrderItem.salesOrderId, id));

    await Promise.all(
      soItems
        .filter((i) => i.productId)
        .map((i) =>
          adjustReservation({
            orgId,
            productId: i.productId!,
            warehouseLabel: "Default",
            delta: -parseFloat(i.qty ?? "1"),
          }),
        ),
    );
  }

  revalidatePath(`/dashboard/sales/order/${id}`);
  revalidatePath("/dashboard/sales/order");

  const snap = so.customerSnapshot as any;
  const customerName = snap ? [snap.title, snap.name].filter(Boolean).join(" ") : undefined;
  const actorName = session.user.name;

  notifyAndEmail({
    orgId,
    recipientUserIds: [so.createdBy],
    type: "so:recalled",
    emailType: "recalled",
    title: `SO ${so.soNo} recalled`,
    body: `Sales order ${so.soNo} has been recalled by ${actorName}.`,
    soNo: so.soNo,
    soId: so.id,
    customerName,
    grandTotal: so.grandTotal ?? undefined,
    actorName,
  }).catch(console.error);

  return { ok: true };
}

export async function toggleSoItemPrExcluded(itemId: string, excluded: boolean): Promise<void> {
  const { orgId } = await requireAccess("sales-order:update");

  // Verify the item belongs to an SO in this org
  const [item] = await db
    .select({ id: salesOrderItem.id, salesOrderId: salesOrderItem.salesOrderId })
    .from(salesOrderItem)
    .where(eq(salesOrderItem.id, itemId));
  if (!item) throw new Error("Item not found");

  const [so] = await db
    .select({ id: salesOrder.id })
    .from(salesOrder)
    .where(and(eq(salesOrder.id, item.salesOrderId), eq(salesOrder.organizationId, orgId)));
  if (!so) throw new Error("Not authorised");

  await db
    .update(salesOrderItem)
    .set({ prExcluded: excluded })
    .where(eq(salesOrderItem.id, itemId));

  revalidatePath(`/dashboard/sales/order/${item.salesOrderId}`);
  revalidatePath("/dashboard/procurement/requisition");
}

export async function toggleSoItemApprovalRejected(itemId: string, rejected: boolean): Promise<{ rejectedByName: string | null; rejectedAt: Date | null }> {
  const { orgId, userId } = await requireAccess("sales-order:approve");

  const [item] = await db
    .select({ id: salesOrderItem.id, salesOrderId: salesOrderItem.salesOrderId })
    .from(salesOrderItem)
    .where(eq(salesOrderItem.id, itemId));
  if (!item) throw new Error("Item not found");

  const [so] = await db
    .select({ id: salesOrder.id, status: salesOrder.status, createdBy: salesOrder.createdBy })
    .from(salesOrder)
    .where(and(eq(salesOrder.id, item.salesOrderId), eq(salesOrder.organizationId, orgId)));
  if (!so) throw new Error("Not authorised");
  if (so.status !== "submitted") throw new Error("Can only reject items on a submitted order");
  await assertSelfActionAllowed(orgId, "sales-order:approve", so.createdBy, userId, rejected ? "reject" : "un-reject");

  const now = rejected ? new Date() : null;
  const by  = rejected ? userId : null;

  await db
    .update(salesOrderItem)
    .set({ approvalRejected: rejected, approvalRejectedBy: by, approvalRejectedAt: now })
    .where(eq(salesOrderItem.id, itemId));

  let rejectedByName: string | null = null;
  if (rejected && userId) {
    const [u] = await db.select({ name: user.name }).from(user).where(eq(user.id, userId));
    rejectedByName = u?.name ?? null;
  }

  revalidatePath(`/dashboard/sales/order/${item.salesOrderId}`);
  return { rejectedByName, rejectedAt: now };
}
