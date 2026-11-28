"use server";

import { notifyUsersWithPermission } from "@/server/notifications";
import { discardDraftPos, draftPosOfSo } from "@/lib/purchase-order/draft-pos";
import { isSelfActionAllowed } from "@/server/approval-settings";
import { isApprovalRequired } from "@/lib/approvals/required";
import { cascadeCategories, cpoCategories, mapCategoriesToOrg, poCategories, quotationCategories, resolveCategories } from "@/lib/document-category/inherit";
import { fillSalesOrderItemCustomers } from "@/lib/trace/item-customer";
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
import { newDraftRef, isDraftRef } from "@/lib/draft-ref";
import { soLineQty } from "@/lib/sales-order/set-qty";
import { soProcurementStages, type SoProcurement } from "@/lib/sales-order/procurement-stage";
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
  // Overall discount saved on the CPO (null: none recorded)
  overallDiscountPct: string | null;
  overallDiscountAmt: string | null;
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
  /** Document categories; undefined: inherit from its customer PO(s) / quotation(s) (on create) or unchanged (on update) */
  categoryIds?: string[];
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
          .select({ id: customerPurchaseOrder.id, customerId: customerPurchaseOrder.customerId, customerSnapshot: customerPurchaseOrder.customerSnapshot, deliveryDate: customerPurchaseOrder.deliveryDate, salesPersonName: customerPurchaseOrder.salesPersonName, overallDiscountPct: customerPurchaseOrder.overallDiscountPct, overallDiscountAmt: customerPurchaseOrder.overallDiscountAmt })
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
        overallDiscountPct: cpo?.overallDiscountPct ?? null,
        overallDiscountAmt: cpo?.overallDiscountAmt ?? null,
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
          .select({ id: customerPurchaseOrder.id, customerId: customerPurchaseOrder.customerId, customerSnapshot: customerPurchaseOrder.customerSnapshot, deliveryDate: customerPurchaseOrder.deliveryDate, salesPersonName: customerPurchaseOrder.salesPersonName, overallDiscountPct: customerPurchaseOrder.overallDiscountPct, overallDiscountAmt: customerPurchaseOrder.overallDiscountAmt })
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
      overallDiscountPct: cpo?.overallDiscountPct ?? null,
      overallDiscountAmt: cpo?.overallDiscountAmt ?? null,
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
            salesPersonName: customerPurchaseOrder.salesPersonName, overallDiscountPct: customerPurchaseOrder.overallDiscountPct, overallDiscountAmt: customerPurchaseOrder.overallDiscountAmt,
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
      overallDiscountPct: cpo?.overallDiscountPct ?? null,
      overallDiscountAmt: cpo?.overallDiscountAmt ?? null,
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

// The CPO ids an SO input links: customerPoLinks, or the single customerPoId.
function cpoIdsOf(input: { customerPoLinks?: { customerPoId: string }[] | null; customerPoId?: string | null }): string[] {
  const ids = input.customerPoLinks?.length ? input.customerPoLinks.map((l) => l.customerPoId) : input.customerPoId ? [input.customerPoId] : [];
  return [...new Set(ids.filter(Boolean))];
}

// A CPO belongs to at most one SO (an SO may combine several CPOs). Why these
// CPOs can't go on SO `soId` (null: a new SO), or null when they can: each
// must be in this org and have no SO yet — or one that's cancelled, or this SO.
async function cpoLinkConflict(orgId: string, cpoIds: string[], soId: string | null): Promise<string | null> {
  if (cpoIds.length === 0) return null;
  const rows = await db
    .select({ id: customerPurchaseOrder.id, customerPoNo: customerPurchaseOrder.customerPoNo, salesOrderId: customerPurchaseOrder.salesOrderId, soNo: salesOrder.soNo, soStatus: salesOrder.status })
    .from(customerPurchaseOrder)
    .leftJoin(salesOrder, eq(salesOrder.id, customerPurchaseOrder.salesOrderId))
    .where(and(inArray(customerPurchaseOrder.id, cpoIds), eq(customerPurchaseOrder.organizationId, orgId)));
  if (rows.length !== cpoIds.length) return "One or more customer POs were not found";
  const taken = rows.filter((r) => r.salesOrderId && r.salesOrderId !== soId && r.soStatus !== "cancelled");
  if (taken.length === 0) return null;
  return `A customer PO can only be on one sales order — ${taken.map((r) => `${r.customerPoNo} is already on ${r.soNo ?? "another sales order"}`).join("; ")}`;
}

export async function createSalesOrder(input: CreateSalesOrderInput): Promise<SalesOrderRow> {
  const { orgId, userId } = await requireAccess("sales-order:create");
  const conflict = await cpoLinkConflict(orgId, cpoIdsOf(input), null);
  if (conflict) throw new Error(conflict);
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

  // the running number comes on approval (assignSoNumber); until then a draft reference
  const soNo = newDraftRef();

  const categoryIds = await resolveCategories(orgId, input.categoryIds, async () => {
    const fromCpo = await cpoCategories(cpoIdsOf(input));
    return fromCpo.length > 0 ? fromCpo
      : quotationCategories([input.quotationId, ...(input.linkedQuotations ?? []).map((q) => q.id)]);
  });

  const [row] = await db
    .insert(salesOrder)
    .values({
      id: nanoid(),
      categoryIds,
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
      // Starts as "pending-do" / "pending-pr" (set below from stock) — not yet
      // submitted, so it's shown with a "Draft" tag (lib/sales-order/stock-stage.ts).
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
    await fillSalesOrderItemCustomers(row.id);
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
        // the buying company's categories, as this company's own (matched by name)
        categoryIds: await mapCategoriesToOrg(await poCategories(poId), targetOrgId),
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
      // the PO's own totals: the SO's lines carry the same prices
      subtotal: po.subtotal ?? undefined,
      sst: po.sst ?? undefined,
      sstPct: po.sstPct ?? undefined,
      grandTotal: po.grandTotal ?? undefined,
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

  // CPOs added to / removed from this SO (only when the links are being changed)
  const oldCpoIds = cpoIdsOf({ customerPoLinks: existing.customerPoLinks as { customerPoId: string }[] | null, customerPoId: existing.customerPoId });
  const newCpoIds = input.customerPoLinks !== undefined || input.customerPoId !== undefined ? cpoIdsOf(input) : oldCpoIds;
  const addedCpoIds = newCpoIds.filter((id) => !oldCpoIds.includes(id));
  const removedCpoIds = oldCpoIds.filter((id) => !newCpoIds.includes(id));
  const conflict = await cpoLinkConflict(existing.organizationId, addedCpoIds, existing.id);
  if (conflict) throw new Error(conflict);

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

  // categories: as chosen; else, when it had none yet, its CPOs' / quotations'; else unchanged
  const oldCategories = (existing.categoryIds ?? []) as string[];
  const categoryIds = input.categoryIds !== undefined
    ? await mapCategoriesToOrg(input.categoryIds, existing.organizationId)
    : oldCategories.length > 0 ? oldCategories
    : await mapCategoriesToOrg(await (async () => {
        const fromCpo = await cpoCategories(cpoIdsOf({ customerPoLinks: (input.customerPoLinks ?? existing.customerPoLinks) as { customerPoId: string }[] | null, customerPoId: input.customerPoId ?? existing.customerPoId }));
        return fromCpo.length > 0 ? fromCpo : quotationCategories([existing.quotationId, ...((input.linkedQuotations ?? existing.linkedQuotations ?? []) as { id: string }[]).map((q) => q.id)]);
      })(), existing.organizationId);

  const [row] = await db
    .update(salesOrder)
    .set({
      categoryIds,
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
      // the order type can still change while a draft is being created (the create form auto-saves)
      ...(input.soType !== undefined && {
        soType: input.soType,
        proformaReason: input.soType === "proforma" ? (input.proformaReason ?? null) : null,
        originalSoId: input.soType === "proforma" ? (input.originalSoId ?? null) : null,
        originalSoNo: input.soType === "proforma" ? (input.originalSoNo ?? null) : null,
      }),
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
    await fillSalesOrderItemCustomers(input.id);
  }

  // Keep each CPO's own link in step with the SO's list: added CPOs point here,
  // removed ones are free for another SO.
  if (addedCpoIds.length > 0) {
    await db.update(customerPurchaseOrder).set({ salesOrderId: existing.id, salesOrderNo: existing.soNo })
      .where(and(eq(customerPurchaseOrder.organizationId, existing.organizationId), inArray(customerPurchaseOrder.id, addedCpoIds)));
  }
  if (removedCpoIds.length > 0) {
    await db.update(customerPurchaseOrder).set({ salesOrderId: null, salesOrderNo: null })
      .where(and(eq(customerPurchaseOrder.organizationId, existing.organizationId), inArray(customerPurchaseOrder.id, removedCpoIds), eq(customerPurchaseOrder.salesOrderId, existing.id)));
  }

  // its PRs and supplier POs follow, unless their categories were changed by hand
  await cascadeCategories("so", existing.id, oldCategories, categoryIds);

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

  // Release the running number when it was the latest one given out (a draft has none). The
  // counter's number is rebuilt in the org's own format and compared, so any format works.
  if (!isDraftRef(existing.soNo)) {
    const [counter] = await db
      .select()
      .from(salesOrderCounter)
      .where(eq(salesOrderCounter.organizationId, orgId))
      .limit(1);
    if (counter && counter.lastNumber > 0) {
      const cfg = await getNumberingConfig(orgId, "so");
      if (buildDocumentNo(cfg, counter.year, counter.lastNumber) === existing.soNo) {
        await db
          .update(salesOrderCounter)
          .set({ lastNumber: counter.lastNumber - 1 })
          .where(eq(salesOrderCounter.organizationId, orgId));
      }
    }
  }

  // No revalidatePath here: a revalidating action makes the router re-render
  // the page it was called from — this deleted document's own page — which
  // then 404s and strands the user. The caller refreshes or navigates instead
  // (navigateBackAfterDelete refreshes the page it lands on).
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
      .select({ productId: salesOrderItem.productId, qty: salesOrderItem.qty, setGroupId: salesOrderItem.setGroupId, setQty: salesOrderItem.setQty })
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
            delta: -soLineQty(i),
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

  // the company doesn't need SOs approved (Approvals page): submitting confirms it, as the submitter
  if (!(await isApprovalRequired(orgId, "sales-order:approve"))) {
    await confirmSubmittedSo(orgId, userId, session.user.name, so, true);
    return;
  }

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

// An SO gets its running number when it is approved (lib/draft-ref.ts). Every document that
// copied the draft reference follows it. Returns the SO's number (unchanged if it had one).
async function assignSoNumber(orgId: string, soId: string, current: string): Promise<string> {
  if (!isDraftRef(current)) return current;
  const soNo = await generateSoNo(orgId);
  await db.update(salesOrder).set({ soNo }).where(eq(salesOrder.id, soId));
  await Promise.all([
    db.update(customerPurchaseOrder).set({ salesOrderNo: soNo }).where(eq(customerPurchaseOrder.salesOrderId, soId)),
    db.update(purchaseRequisition).set({ salesOrderNo: soNo }).where(eq(purchaseRequisition.salesOrderId, soId)),
    db.update(deliveryOrder).set({ salesOrderNo: soNo }).where(eq(deliveryOrder.salesOrderId, soId)),
    db.update(invoice).set({ salesOrderNo: soNo }).where(eq(invoice.salesOrderId, soId)),
    db.update(consignment).set({ soNo }).where(eq(consignment.soId, soId)),
    db.update(salesOrder).set({ originalSoNo: soNo }).where(eq(salesOrder.originalSoId, soId)),
  ]);
  return soNo;
}

export async function approveSalesOrder(id: string): Promise<void> {
  const { orgId, userId, session } = await requireAccess("sales-order:approve");

  const [so] = await db
    .select({ id: salesOrder.id, soNo: salesOrder.soNo, status: salesOrder.status, customerSnapshot: salesOrder.customerSnapshot, grandTotal: salesOrder.grandTotal, createdBy: salesOrder.createdBy })
    .from(salesOrder)
    .where(and(eq(salesOrder.id, id), eq(salesOrder.organizationId, orgId)));

  if (!so) throw new Error("Sales order not found");
  if (so.status !== "submitted") throw new Error("Only submitted orders can be approved");
  await assertSelfActionAllowed(orgId, "sales-order:approve", so.createdBy, userId, "approve");

  await confirmSubmittedSo(orgId, userId, session.user.name, so, false);
}

type SubmittedSo = { id: string; soNo: string; customerSnapshot: unknown; grandTotal: string | null; createdBy: string };

// submitted → confirmed: its number, the stock reserved, replenishment checked, its creator told. By the
// approver, or — when the company doesn't need SOs approved (Approvals page) — as the submitter (auto).
async function confirmSubmittedSo(orgId: string, userId: string, actorName: string, so: SubmittedSo, auto: boolean): Promise<string> {
  const id = so.id;
  await db.update(salesOrder).set({ status: "confirmed", approvedBy: userId, approvedAt: new Date() }).where(eq(salesOrder.id, id));
  const soNo = await assignSoNumber(orgId, id, so.soNo);

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

  // confirmed by its own creator (no approval needed): nobody to tell
  if (auto && so.createdBy === userId) return soNo;
  const snap = so.customerSnapshot as any;
  const customerName = snap ? [snap.title, snap.name].filter(Boolean).join(" ") : undefined;

  notifyAndEmail({
    orgId,
    recipientUserIds: [so.createdBy],
    type: "so:approved",
    emailType: "approved",
    title: auto ? `SO ${soNo} confirmed` : `SO ${soNo} approved`,
    body: auto ? `Your sales order ${soNo} was confirmed by ${actorName}.` : `Your sales order ${soNo} has been approved by ${actorName}.`,
    soNo,
    soId: so.id,
    customerName,
    grandTotal: so.grandTotal ?? undefined,
    actorName,
  }).catch(console.error);
  return soNo;
}

/**
 * A submitted SO confirmed at once when the company doesn't need SOs approved (an amended SO comes back
 * submitted). Does nothing when approval is needed. Returns whether it was confirmed.
 */
export async function confirmSalesOrderIfNoApproval(id: string): Promise<boolean> {
  const { orgId, userId, session } = await requireAccess("sales-order:update");
  if (await isApprovalRequired(orgId, "sales-order:approve")) return false;
  const [so] = await db
    .select({ id: salesOrder.id, soNo: salesOrder.soNo, status: salesOrder.status, customerSnapshot: salesOrder.customerSnapshot, grandTotal: salesOrder.grandTotal, createdBy: salesOrder.createdBy })
    .from(salesOrder)
    .where(and(eq(salesOrder.id, id), eq(salesOrder.organizationId, orgId)));
  if (!so || so.status !== "submitted") return false;
  await confirmSubmittedSo(orgId, userId, session.user.name, so, true);
  return true;
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
// What stops recalling a confirmed SO, and what recalling it discards. Its PRs not approved yet (a draft,
// or one waiting for approval: no number yet, nothing ordered from it) and draft supplier POs raised
// straight from it were made from the order as it was: they don't hold it, and are deleted when it's
// recalled (a PR's approvers are told it was withdrawn). Anything else live (an approved PR, an issued PO,
// a DO, an invoice) holds it; so does the self-approval rule for its own creator.
async function soRecallPlan(orgId: string, soId: string, userId: string): Promise<{ blockers: string[]; draftPrs: { id: string; prNo: string; status: string }[]; draftPos: { id: string; poNo: string | null }[] }> {
  const [so] = await db.select({ createdBy: salesOrder.createdBy }).from(salesOrder).where(and(eq(salesOrder.id, soId), eq(salesOrder.organizationId, orgId)));
  if (!so) return { blockers: ["Sales order not found"], draftPrs: [], draftPos: [] };
  const draftPrs = await db
    .select({ id: purchaseRequisition.id, prNo: purchaseRequisition.prNo, status: purchaseRequisition.status })
    .from(purchaseRequisition)
    .where(and(eq(purchaseRequisition.organizationId, orgId), eq(purchaseRequisition.salesOrderId, soId), inArray(purchaseRequisition.status, ["draft", "submitted"])));
  const draftPos = await draftPosOfSo(orgId, soId);
  const skip = new Set([...draftPrs.map((p) => `PR ${p.prNo}`), ...draftPos.map((p) => `PO ${p.poNo ?? "(unnumbered)"}`)]);
  const live = (await activeSalesOrderDownstream(orgId, soId)).filter((label) => !skip.has(label));
  const blockers = live.length ? [`documents raised from it are still active (${live.join(", ")}): cancel or recall those first`] : [];
  if (so.createdBy === userId && !(await isSelfActionAllowed(orgId, "sales-order:approve")))
    blockers.push("you can't recall your own sales order (self-approval is off on the Approvals page)");
  return { blockers, draftPrs, draftPos: draftPos.map((p) => ({ id: p.id, poNo: p.poNo })) };
}

/** Why a confirmed SO can't be recalled (empty: it can — the page shows Recall only then) */
export async function getSalesOrderRecallBlockers(soId: string): Promise<string[]> {
  const { orgId, userId } = await requireAccess("sales-order:read");
  return (await soRecallPlan(orgId, soId, userId)).blockers;
}

/** The SO page's Recall: why it can't be, and the drafts it would delete (listed in its confirmation) */
export async function getSalesOrderRecallPlan(soId: string): Promise<{ blockers: string[]; drafts: string[] }> {
  const { orgId, userId } = await requireAccess("sales-order:read");
  const plan = await soRecallPlan(orgId, soId, userId);
  return { blockers: plan.blockers, drafts: [...plan.draftPrs.map((p) => `PR ${p.prNo}${p.status === "submitted" ? " (waiting for approval)" : ""}`), ...plan.draftPos.map((p) => `PO ${p.poNo ?? "(draft)"}`)] };
}

// ── Cancel ────────────────────────────────────────────────────────────────

// Why this SO can't be cancelled, or null: live documents raised from it, or
// — for an SO auto-created from a sibling org's PO — that PO still being
// live. An intercompany order is cancelled from the buyer's side: cancelling
// their PO cancels this SO too (cancelIntercompanySalesOrdersForPo).
async function salesOrderCancelBlocker(orgId: string, so: { id: string; soNo: string; sourcePurchaseOrderId: string | null }): Promise<string | null> {
  const live = await activeSalesOrderDownstream(orgId, so.id);
  if (live.length > 0) return `Can't cancel ${so.soNo} — documents raised from it are still active: ${live.join(", ")}. Cancel those first.`;
  if (so.sourcePurchaseOrderId) {
    const [src] = await db
      .select({ poNo: purchaseOrder.poNo, prNo: purchaseOrder.prNo, status: purchaseOrder.status, orgName: organization.name })
      .from(purchaseOrder)
      .leftJoin(organization, eq(organization.id, purchaseOrder.organizationId))
      .where(eq(purchaseOrder.id, so.sourcePurchaseOrderId));
    if (src && src.status !== "cancelled") {
      return `Can't cancel ${so.soNo} — it came from ${src.orgName ?? "a sibling organization"}'s PO ${src.poNo ?? src.prNo ?? ""}, which is still ${src.status}. Ask them to cancel that PO; this order is cancelled with it.`;
    }
  }
  return null;
}

// Read-only, for the SO detail page: hides Cancel when this is set.
export async function getSalesOrderCancelBlocker(soId: string): Promise<string | null> {
  const { orgId } = await requireAccess("sales-order:read");
  const [so] = await db
    .select({ id: salesOrder.id, soNo: salesOrder.soNo, sourcePurchaseOrderId: salesOrder.sourcePurchaseOrderId })
    .from(salesOrder)
    .where(and(eq(salesOrder.id, soId), eq(salesOrder.organizationId, orgId)));
  return so ? salesOrderCancelBlocker(orgId, so) : null;
}

// ── History (the SO list's hover card) ────────────────────────────────────

export interface SalesOrderHistory {
  so: {
    soNo: string; status: string; grandTotal: string | null; stockReservationStatus: string | null;
    createdAt: Date; createdByName: string | null;
    submittedAt: Date | null; submittedByName: string | null;
    approvedAt: Date | null; approvedByName: string | null;
    updatedAt: Date | null;
  };
  // An intercompany SO: the sibling org's PO it was created from.
  source: { orgName: string | null; poNo: string | null } | null;
  cpos: { customerPoNo: string; receivedDate: Date | null; createdAt: Date }[];
  prs: { prNo: string; status: string; createdAt: Date }[];
  pos: { poNo: string | null; prNo: string | null; status: string; createdAt: Date; supplierName: string | null }[];
  dos: { doNo: string; status: string; createdAt: Date; deliveryDate: Date | null }[];
  invoices: { invoiceNo: string; status: string; grandTotal: string | null; createdAt: Date; paidAt: Date | null; paidAmount: string | null }[];
}

// Read-only, scoped to the active org: what's happened to this SO and the
// documents raised from it, for the hover history on the SO list.
export async function getSalesOrderHistory(soId: string): Promise<SalesOrderHistory | null> {
  const { orgId } = await requireAccess("sales-order:read");
  return salesOrderHistoryIn([orgId], soId);
}

// Same, for the centralized SO list: any org the caller's owner holds, under
// the same permission that list needs.
export async function getSalesOrderHistoryCentralized(soId: string): Promise<SalesOrderHistory | null> {
  const { orgId, userId } = await requireAccess("sales-order:read:centralized");
  return salesOrderHistoryIn(await getAllOwnerOrgIds(userId, orgId), soId);
}

// The SO must belong to one of `allowedOrgIds`; everything else is read from
// the SO's own org.
async function salesOrderHistoryIn(allowedOrgIds: string[], soId: string): Promise<SalesOrderHistory | null> {
  const [so] = await db.select().from(salesOrder).where(and(eq(salesOrder.id, soId), inArray(salesOrder.organizationId, allowedOrgIds)));
  if (!so) return null;
  const orgId = so.organizationId;

  const userIds = [so.createdBy, so.submittedBy, so.approvedBy].filter((v): v is string => !!v);
  const [users, cpos, prs, dos, invs, source] = await Promise.all([
    userIds.length ? db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, userIds)) : Promise.resolve([]),
    db.select({ customerPoNo: customerPurchaseOrder.customerPoNo, receivedDate: customerPurchaseOrder.receivedDate, createdAt: customerPurchaseOrder.createdAt })
      .from(customerPurchaseOrder).where(and(eq(customerPurchaseOrder.salesOrderId, soId), eq(customerPurchaseOrder.organizationId, orgId))),
    db.select({ id: purchaseRequisition.id, prNo: purchaseRequisition.prNo, status: purchaseRequisition.status, createdAt: purchaseRequisition.createdAt })
      .from(purchaseRequisition).where(and(eq(purchaseRequisition.salesOrderId, soId), eq(purchaseRequisition.organizationId, orgId))),
    db.select({ doNo: deliveryOrder.doNo, status: deliveryOrder.status, createdAt: deliveryOrder.createdAt, deliveryDate: deliveryOrder.deliveryDate })
      .from(deliveryOrder).where(and(eq(deliveryOrder.salesOrderId, soId), eq(deliveryOrder.organizationId, orgId))),
    db.select({ invoiceNo: invoice.invoiceNo, status: invoice.status, grandTotal: invoice.grandTotal, createdAt: invoice.createdAt, paidAt: invoice.paidAt, paidAmount: invoice.paidAmount })
      .from(invoice).where(and(eq(invoice.salesOrderId, soId), eq(invoice.organizationId, orgId))),
    so.sourcePurchaseOrderId
      ? db.select({ poNo: purchaseOrder.poNo, orgName: organization.name }).from(purchaseOrder)
          .leftJoin(organization, eq(organization.id, purchaseOrder.organizationId))
          .where(eq(purchaseOrder.id, so.sourcePurchaseOrderId)).then((r) => r[0] ?? null)
      : Promise.resolve(null),
  ]);
  const nameOf = (id: string | null) => users.find((u) => u.id === id)?.name ?? null;

  const prIds = prs.map((p) => p.id);
  const pos = await db
    .select({ poNo: purchaseOrder.poNo, prNo: purchaseOrder.prNo, status: purchaseOrder.status, createdAt: purchaseOrder.createdAt, supplierSnapshot: purchaseOrder.supplierSnapshot })
    .from(purchaseOrder)
    .where(and(
      eq(purchaseOrder.organizationId, orgId),
      prIds.length ? or(eq(purchaseOrder.salesOrderId, soId), inArray(purchaseOrder.purchaseRequisitionId, prIds)) : eq(purchaseOrder.salesOrderId, soId),
    ));

  return {
    so: {
      soNo: so.soNo, status: so.status, grandTotal: so.grandTotal, stockReservationStatus: so.stockReservationStatus,
      createdAt: so.createdAt, createdByName: nameOf(so.createdBy),
      submittedAt: so.submittedAt, submittedByName: nameOf(so.submittedBy),
      approvedAt: so.approvedAt, approvedByName: nameOf(so.approvedBy),
      updatedAt: so.updatedAt,
    },
    source: source ? { orgName: source.orgName, poNo: source.poNo } : null,
    cpos,
    prs: prs.map(({ prNo, status, createdAt }) => ({ prNo, status, createdAt })),
    pos: pos.map((p) => ({ poNo: p.poNo, prNo: p.prNo, status: p.status, createdAt: p.createdAt, supplierName: (p.supplierSnapshot as { name?: string } | null)?.name ?? null })),
    dos,
    invoices: invs,
  };
}

// Releases the SO's stock reservation, if it holds one.
async function releaseSoReservation(orgId: string, soId: string, reservationStatus: string | null): Promise<void> {
  if (reservationStatus !== "reserved") return;
  const soItems = await db.select({ productId: salesOrderItem.productId, qty: salesOrderItem.qty, setGroupId: salesOrderItem.setGroupId, setQty: salesOrderItem.setQty }).from(salesOrderItem).where(eq(salesOrderItem.salesOrderId, soId));
  for (const i of soItems) {
    if (!i.productId) continue;
    await adjustReservation({ orgId, productId: i.productId, warehouseLabel: "Default", delta: -soLineQty(i) });
  }
}

// Cancels a submitted or confirmed SO (an unsubmitted one is edited or
// deleted instead; fulfilled/cancelled can't be). Kept on record, not
// deleted. Its Customer PO is unlinked so a new SO can be raised from it —
// except an intercompany CPO, which is cancelled with the SO (it only exists
// because of the sibling's PO). Problems come back as a readable message.
export async function cancelSalesOrder(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { orgId } = await requireAccess("sales-order:approve");
  const [so] = await db
    .select({ id: salesOrder.id, soNo: salesOrder.soNo, status: salesOrder.status, sourcePurchaseOrderId: salesOrder.sourcePurchaseOrderId, stockReservationStatus: salesOrder.stockReservationStatus })
    .from(salesOrder)
    .where(and(eq(salesOrder.id, id), eq(salesOrder.organizationId, orgId)));
  if (!so) return { ok: false, error: "Sales order not found" };
  if (so.status === "fulfilled" || so.status === "cancelled") return { ok: false, error: `${so.soNo} is already ${so.status}` };
  // Not submitted yet (draft / pending-do / pending-pr): nothing went out, so
  // it's edited or deleted, not cancelled.
  if (so.status === "draft" || so.status === "pending-do" || so.status === "pending-pr") {
    return { ok: false, error: `${so.soNo} hasn't been submitted yet — edit or delete it instead of cancelling` };
  }

  const blocker = await salesOrderCancelBlocker(orgId, so);
  if (blocker) return { ok: false, error: blocker };

  await applyCancelSalesOrder(orgId, so);
  revalidatePath(`/dashboard/sales/order/${id}`);
  revalidatePath("/dashboard/sales/order");
  revalidatePath("/dashboard/sales/customer-po");
  return { ok: true };
}

async function applyCancelSalesOrder(orgId: string, so: { id: string; sourcePurchaseOrderId: string | null; stockReservationStatus: string | null }): Promise<void> {
  await db.update(salesOrder).set({ status: "cancelled", stockReservationStatus: null, stockReservedAt: null, stockReservedBy: null }).where(eq(salesOrder.id, so.id));
  await releaseSoReservation(orgId, so.id, so.stockReservationStatus);

  const cpos = await db
    .select({ id: customerPurchaseOrder.id })
    .from(customerPurchaseOrder)
    .where(and(eq(customerPurchaseOrder.organizationId, orgId), eq(customerPurchaseOrder.salesOrderId, so.id)));
  if (so.sourcePurchaseOrderId) {
    // Intercompany: the auto-created CPO goes with it — matched by link, or
    // by being the CPO the SO was created from (older ones were never linked back).
    const [own] = await db.select({ customerPoId: salesOrder.customerPoId }).from(salesOrder).where(eq(salesOrder.id, so.id));
    const ids = [...new Set([...cpos.map((c) => c.id), ...(own?.customerPoId ? [own.customerPoId] : [])])];
    if (ids.length > 0) {
      await db.update(customerPurchaseOrder).set({ status: "cancelled" })
        .where(and(eq(customerPurchaseOrder.organizationId, orgId), inArray(customerPurchaseOrder.id, ids)));
    }
  } else if (cpos.length > 0) {
    await db.update(customerPurchaseOrder).set({ salesOrderId: null, salesOrderNo: null })
      .where(and(eq(customerPurchaseOrder.organizationId, orgId), inArray(customerPurchaseOrder.id, cpos.map((c) => c.id))));
  }
}

// For cancelPurchaseOrder: what the sibling orgs' SOs auto-created from this
// PO would block. An SO the sibling hasn't acted on (nothing raised from it)
// can be cancelled along with the PO; one they have, can't — a person there
// has to decide. Read-only. Scoped like maybeCreateIntercompanySalesOrder:
// the PO must be in the caller's active org, the SOs in orgs the same owner holds.
export async function intercompanySoCancelBlockers(poId: string): Promise<string[]> {
  const { orgId, userId } = await requireAccess("purchase-order:read");
  const [po] = await db.select({ organizationId: purchaseOrder.organizationId }).from(purchaseOrder).where(eq(purchaseOrder.id, poId));
  if (!po || po.organizationId !== orgId) return [];
  const ownerOrgIds = await getAllOwnerOrgIds(userId, orgId);

  const sos = await db
    .select({ id: salesOrder.id, soNo: salesOrder.soNo, status: salesOrder.status, organizationId: salesOrder.organizationId, orgName: organization.name })
    .from(salesOrder)
    .leftJoin(organization, eq(organization.id, salesOrder.organizationId))
    .where(and(eq(salesOrder.sourcePurchaseOrderId, poId), ne(salesOrder.status, "cancelled")));

  const out: string[] = [];
  for (const so of sos) {
    const where = so.orgName ?? "the sibling organization";
    if (!ownerOrgIds.includes(so.organizationId)) { out.push(`SO ${so.soNo} in ${where}`); continue; }
    if (so.status === "fulfilled") { out.push(`SO ${so.soNo} in ${where} (already fulfilled)`); continue; }
    const live = await activeSalesOrderDownstream(so.organizationId, so.id);
    if (live.length > 0) out.push(`SO ${so.soNo} in ${where} (${live.join(", ")})`);
  }
  return out;
}

// Called right after cancelPurchaseOrder cancels a PO: cancels the SO (and
// its auto-created CPO) each sibling org got from it, and tells that org's SO
// approvers. Takes only a poId and re-derives everything — this is a public
// action like any export here. Never throws: the PO is already cancelled, and
// the trail flags any SO left open.
export async function cancelIntercompanySalesOrdersForPo(poId: string): Promise<void> {
  try {
    const { orgId, userId } = await requireAccess("purchase-order:update");
    const [po] = await db
      .select({ organizationId: purchaseOrder.organizationId, status: purchaseOrder.status, poNo: purchaseOrder.poNo, prNo: purchaseOrder.prNo })
      .from(purchaseOrder)
      .where(eq(purchaseOrder.id, poId));
    if (!po || po.organizationId !== orgId || po.status !== "cancelled") return;
    const ownerOrgIds = await getAllOwnerOrgIds(userId, orgId);
    const [buyer] = await db.select({ name: organization.name }).from(organization).where(eq(organization.id, orgId));

    const sos = await db
      .select({ id: salesOrder.id, soNo: salesOrder.soNo, status: salesOrder.status, organizationId: salesOrder.organizationId, sourcePurchaseOrderId: salesOrder.sourcePurchaseOrderId, stockReservationStatus: salesOrder.stockReservationStatus })
      .from(salesOrder)
      .where(and(eq(salesOrder.sourcePurchaseOrderId, poId), ne(salesOrder.status, "cancelled"), ne(salesOrder.status, "fulfilled")));

    for (const so of sos) {
      if (!ownerOrgIds.includes(so.organizationId)) continue;
      if ((await activeSalesOrderDownstream(so.organizationId, so.id)).length > 0) continue; // re-check: acted on since
      await applyCancelSalesOrder(so.organizationId, so);

      const poRef = po.poNo ?? po.prNo ?? poId;
      const approvers = await getSoApprovers(so.organizationId).catch(() => [] as string[]);
      for (const uid of approvers) {
        await createNotification({
          organizationId: so.organizationId,
          userId: uid,
          type: "so:cancelled",
          title: `SO ${so.soNo} cancelled`,
          body: `${buyer?.name ?? "A sibling organization"} cancelled PO ${poRef}, so sales order ${so.soNo} (raised from it) was cancelled too.`,
          link: `/dashboard/sales/order/${so.id}`,
        }).catch(console.error);
      }
    }
    revalidatePath("/dashboard/sales/order");
    revalidatePath("/dashboard/sales/customer-po");
  } catch (e) {
    console.error("cancelIntercompanySalesOrdersForPo failed:", e);
  }
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
  try {
    await assertSelfActionAllowed(orgId, "sales-order:approve", so.createdBy, userId, "recall");
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "You can't recall this document" };
  }

  const plan = await soRecallPlan(orgId, id, userId);
  if (plan.blockers.length > 0) {
    return {
      ok: false,
      error: `Can't recall ${so.soNo}: ${plan.blockers.join("; ")}.`,
    };
  }

  // its PRs not approved yet and draft supplier POs were made from the order as it was: deleted (raised
  // again after it's confirmed); a PR waiting for approval is withdrawn, and its approvers are told
  if (plan.draftPrs.length) await db.delete(purchaseRequisition).where(inArray(purchaseRequisition.id, plan.draftPrs.map((p) => p.id))); // their lines go with them
  for (const pr of plan.draftPrs.filter((p) => p.status === "submitted"))
    await notifyUsersWithPermission(orgId, "purchase-requisition:approve", {
      type: "purchase-requisition:withdrawn",
      title: `Purchase Requisition withdrawn`,
      body: `${pr.prNo} no longer needs approval: sales order ${so.soNo} was recalled to be corrected.`,
      link: `/dashboard/sales/order/${id}`,
    }).catch(() => {});
  await discardDraftPos(plan.draftPos.map((p) => p.id));

  await db.update(salesOrder).set({ status: "draft", approvedBy: null, approvedAt: null, stockReservationStatus: null, stockReservedAt: null, stockReservedBy: null }).where(eq(salesOrder.id, id));

  // Release reserved stock (only if it was actually reserved)
  if (so.stockReservationStatus === "reserved") {
    const soItems = await db
      .select({ productId: salesOrderItem.productId, qty: salesOrderItem.qty, setGroupId: salesOrderItem.setGroupId, setQty: salesOrderItem.setQty })
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
            delta: -soLineQty(i),
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

// How far buying has got for each confirmed SO that's short of stock (the "Pending PR" tag tells
// the truth: PR raised / ordered / partly received). Any org of the owner's (lists can be centralized).
export async function getSoProcurementStages(soIds: string[]): Promise<Record<string, SoProcurement>> {
  const { orgId, userId } = await requireAccess("sales-order:read").catch(() => requireAccess("sales-order:read:centralized"));
  return soProcurementStages(await getAllOwnerOrgIds(userId, orgId), soIds.slice(0, 500));
}
