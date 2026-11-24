"use server";

import { db } from "@/db";
import {
  customerPurchaseOrder,
  customer,
  salesOrder,
  deliveryOrder,
  invoice,
  purchaseOrder,
  purchaseOrderCustomerPo,
  purchaseOrderItem,
  purchaseRequisition,
  packingListItem,
  salesOrderItem,
  documentNumberingSetting,
  user,
  member,
  organization,
  supplier,
} from "@/db/schema";
import { buildCustomerSnapshot } from "@/server/customer";
import { nanoid } from "nanoid";
import { eq, and, desc, asc, ilike, inArray, or, isNull, isNotNull, notInArray, ne, sql } from "drizzle-orm";
import { createNotification, getSoApprovers } from "@/server/notifications";
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { requireAccess } from "@/lib/auth/require-access";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";
import { PO_TBC_PREFIX } from "@/lib/customer-po/po-number";
import { findCpoNoClash, clashMessage } from "@/lib/customer-po/unique-no";
const s3 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT!,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});
const BUCKET = process.env.R2_CUSTOMER_PURCHASE_ORDER_BUCKET!;

export async function getCustomerPoDocumentUploadUrl(
  filename: string,
  mimeType?: string,
): Promise<{ key: string; uploadUrl: string }> {
  await requireAccess("customer-po:create");
  const key = `customer-pos/${nanoid()}-${filename}`;
  const cmd = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ...(mimeType ? { ContentType: mimeType } : {}),
  });
  return { key, uploadUrl: await getSignedUrl(s3, cmd, { expiresIn: 3600 }) };
}

export async function getCustomerPoDocumentDownloadUrl(key: string): Promise<string> {
  const cmd = new GetObjectCommand({ Bucket: BUCKET, Key: key });
  return getSignedUrl(s3, cmd, { expiresIn: 3600 });
}

async function deleteDocument(key: string | null | undefined) {
  if (!key) return;
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}

// After the CPO no longer points to a document: delete the file. Done after the database change, so a save that
// fails never leaves the CPO pointing at a deleted file; a failed delete only leaves a stray file (logged), never a
// failed save.
async function deleteDocumentAfterSave(key: string | null | undefined) {
  try { await deleteDocument(key); } catch (e) { console.error("customer PO: the old document could not be deleted from storage", key, e); }
}




export type CustomerPo = typeof customerPurchaseOrder.$inferSelect;

export type CpoItemInput = {
  rowNo: number;
  productCode: string;
  description: string;
  qty: string;
  uom: string;
  unitPrice: string;
  discountPct: string;
  totalPrice: string;
  lineType: string;
  setGroupId?: string;
  setGroupLabel?: string;
  setQty?: string;
  // Price of ONE set when the quotation priced the whole set as a lump sum (the lines then carry no unit price)
  setPrice?: string;
  // The item description exactly as written on the customer's PO (e.g. long government PO text)
  cpoDescription?: string;
  // For a set: the main title as written on the customer's PO, e.g. "TOILET & SUTURE SET consist of:-" (same on every item of the set)
  setCpoTitle?: string;
  // Our quotation this line came from (so the "from quotation …" badge stays right after saving)
  quotationNo?: string;
  // The code before a user changed it (kept so the "Code changed from …" notice survives saving)
  originalCode?: string;
  // The customer this line is for: the one on the quotation it came from (a CPO can combine several contacts of one organization)
  customerId?: string;
  customerName?: string;
  customerOrganization?: string;
  customerOrganizationId?: string;
  // The description differs from the product database and the user confirmed that is intended: it stays as written
  descAccepted?: boolean;
  descAcceptedBy?: string;
  // The description the user replaced with the database one, kept so they can go back to it
  prevDescription?: string;
  // A draft keeps the lines the user had switched off, so they can be switched on again later
  _excluded?: boolean;
  _codeSource?: "quote" | "user" | null;
  _descriptionSource?: Array<"quote" | "catalog" | "user"> | null;
  _unitPriceSource?: "quote" | "user" | null;
  _qtySource?: "quote" | "user" | null;
  _editedBy?: string | null;
};

export interface CreateCustomerPoInput {
  customerPoNo: string;
  customerId?: string;
  customerOrgMemberId?: string;
  quotationId?: string;
  quotationNo?: string;
  quotationLinks?: { quotationId: string; quotationNo: string }[];
  salesOrderId?: string;
  salesOrderNo?: string;
  items?: CpoItemInput[];
  amount?: string;
  currency?: string;
  documentKey?: string | null; // undefined: unchanged; null: removed (its file is deleted once saved)
  salesPersonName?: string;
  associateSalesPersons?: { id: string; name: string }[];
  notes?: string;
  receivedDate?: Date;
  deliveryDate?: Date;
  deliveryAddress?: string;
  status?: string;
}

export interface UpdateCustomerPoInput extends CreateCustomerPoInput {
  id: string;
}

// For the forms: is this number free? Returns a message to show when it is not (thrown errors are hidden in production)
export async function checkCustomerPoNo(no: string, excludeId?: string): Promise<{ available: boolean; message?: string; existingId?: string }> {
  const { orgId } = await requireAccess("customer-po:read");
  const clash = await findCpoNoClash(orgId, no, excludeId);
  return clash ? { available: false, message: clashMessage(clash), existingId: clash.id } : { available: true };
}

export async function getNextCashSaleNo(): Promise<string> {
  const { orgId } = await requireAccess("customer-po:create");
  const rows = await db
    .select({ customerPoNo: customerPurchaseOrder.customerPoNo })
    .from(customerPurchaseOrder)
    .where(and(
      eq(customerPurchaseOrder.organizationId, orgId),
      ilike(customerPurchaseOrder.customerPoNo, "CASH-SALE-%"),
    ));
  let max = 0;
  for (const { customerPoNo } of rows) {
    const n = customerPoNo?.match(/^CASH-SALE-(\d+)$/i)?.[1];
    if (n) max = Math.max(max, parseInt(n, 10));
  }
  return `CASH-SALE-${String(max + 1).padStart(2, "0")}`;
}

// "PO to follow": the customer has ordered (e.g. by email) but has not sent its PO yet. The CPO gets a
// temporary number, PO-TBC-<org code>-001, 002, … so nothing has to be typed into the number field. The
// org code is the prefix of the organization's document numbering (BIO, AF, SI), else its initials.
// When the real number arrives, rename the CPO: every later document that copied the number follows it.
export async function getNextPoTbcNo(): Promise<string> {
  const { orgId } = await requireAccess("customer-po:create");
  const [[setting], [org]] = await Promise.all([
    db.select({ prefix: documentNumberingSetting.prefix }).from(documentNumberingSetting)
      .where(and(eq(documentNumberingSetting.organizationId, orgId), eq(documentNumberingSetting.documentType, "so"))).limit(1),
    db.select({ name: organization.name }).from(organization).where(eq(organization.id, orgId)).limit(1),
  ]);
  const fromName = (org?.name ?? "")
    .replace(/\b(sdn|bhd|berhad|sendirian)\b\.?/gi, "")
    .split(/\s+/).filter(Boolean).map((w) => w[0]).join("").toUpperCase();
  const code = (setting?.prefix?.trim() || fromName || "ORG").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const head = `${PO_TBC_PREFIX}${code}-`;
  const rows = await db
    .select({ customerPoNo: customerPurchaseOrder.customerPoNo })
    .from(customerPurchaseOrder)
    .where(and(eq(customerPurchaseOrder.organizationId, orgId), ilike(customerPurchaseOrder.customerPoNo, `${head}%`)));
  let max = 0;
  for (const { customerPoNo } of rows) {
    const n = customerPoNo.slice(head.length).match(/^(\d+)$/)?.[1];
    if (n) max = Math.max(max, parseInt(n, 10));
  }
  return `${head}${String(max + 1).padStart(3, "0")}`;
}

// isIntercompany marks a CPO created automatically from a sibling org's PO
// (server/sales-order.ts's maybeCreateIntercompanySalesOrder) rather than a
// real external customer's document — its customerId points at a customer
// record with linkedOrganizationId set. Surfaced so the UI can badge it
// instead of it silently blending in with genuine customer orders.
export type CustomerPoListRow = CustomerPo & { isIntercompany: boolean };

// A draft is private to the person who started it and is not a real order yet: it stays out of sales orders,
// searches, customer pages and summaries, and only its creator sees it in the lists.
const visibleTo = (userId: string) => or(ne(customerPurchaseOrder.status, "draft"), eq(customerPurchaseOrder.createdBy, userId));

// Lists of customer POs: newest first by the date they show, the date received (or, when that is empty, the day the
// PO was recorded), as a Malaysian calendar day; the same day newest-recorded first. As compareCpoNewestFirst in
// lib/customer-po/cpo-date.ts. (A function, not a constant: the column objects are built at import.)
const cpoNewestFirst = () => [
  desc(sql`((coalesce(${customerPurchaseOrder.receivedDate}, ${customerPurchaseOrder.createdAt}) AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kuala_Lumpur')::date`),
  desc(customerPurchaseOrder.createdAt),
];

export async function getCustomerPos(): Promise<CustomerPoListRow[]> {
  const { orgId, userId } = await requireAccess("customer-po:read");
  const rows = await db
    .select({ po: customerPurchaseOrder, linkedOrganizationId: customer.linkedOrganizationId })
    .from(customerPurchaseOrder)
    .leftJoin(customer, eq(customer.id, customerPurchaseOrder.customerId))
    .where(and(eq(customerPurchaseOrder.organizationId, orgId), visibleTo(userId)))
    .orderBy(...cpoNewestFirst());
  return rows.map(({ po, linkedOrganizationId }) => ({ ...po, isIntercompany: !!linkedOrganizationId }));
}

// Returns every org owned by the same owner as the caller's active org (the
// caller need not be a member of those other orgs themselves — only the
// owner is, by design; see the identical pattern in server/quotation.ts).
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

export type CentralizedCustomerPo = CustomerPo & { organizationName: string; isIntercompany: boolean };

// Cross-org view for members explicitly granted customer-po:read:centralized
// — every Customer PO recorded under any org the same owner controls, not
// just the caller's own active org. This is exactly where an intercompany
// CPO is most likely to confuse someone — the "customer" on it is the name
// of one of the very orgs also being aggregated in this same list — hence
// isIntercompany. The two kinds are listed on separate pages: "external"
// (real customers — the centralized Customer POs page) and "intercompany"
// (auto-created from a sibling org's PO — the centralized Intercompany POs
// page), so neither list mixes the other in.
export async function getCustomerPosCentralized(kind: "external" | "intercompany" = "external"): Promise<CentralizedCustomerPo[]> {
  const { orgId, userId } = await requireAccess("customer-po:read:centralized");
  const ownerOrgIds = await getAllOwnerOrgIds(userId, orgId);

  const rows = await db
    .select({ po: customerPurchaseOrder, organizationName: organization.name, linkedOrganizationId: customer.linkedOrganizationId })
    .from(customerPurchaseOrder)
    .innerJoin(organization, eq(organization.id, customerPurchaseOrder.organizationId))
    .leftJoin(customer, eq(customer.id, customerPurchaseOrder.customerId))
    .where(and(
      inArray(customerPurchaseOrder.organizationId, ownerOrgIds),
      visibleTo(userId),
      kind === "intercompany" ? isNotNull(customer.linkedOrganizationId) : isNull(customer.linkedOrganizationId),
    ))
    .orderBy(...cpoNewestFirst());

  return rows.map(({ po, organizationName, linkedOrganizationId }) => ({ ...po, organizationName, isIntercompany: !!linkedOrganizationId }));
}

export async function getOpenCustomerPos(): Promise<CustomerPoSearchResult[]> {
  const { orgId } = await requireAccess("customer-po:read");
  return db
    .select({
      id: customerPurchaseOrder.id,
      customerPoNo: customerPurchaseOrder.customerPoNo,
      customerId: customerPurchaseOrder.customerId,
      customerSnapshot: customerPurchaseOrder.customerSnapshot,
      amount: customerPurchaseOrder.amount,
      currency: customerPurchaseOrder.currency,
      status: customerPurchaseOrder.status,
    })
    .from(customerPurchaseOrder)
    .where(
      and(
        eq(customerPurchaseOrder.organizationId, orgId),
        isNull(customerPurchaseOrder.salesOrderId),
        notInArray(customerPurchaseOrder.status, ["cancelled", "fulfilled", "draft"]),
      ),
    )
    .orderBy(desc(customerPurchaseOrder.createdAt));
}

export async function getCustomerPoDetail(id: string): Promise<CustomerPo | null> {
  const { orgId, userId } = await requireAccess("customer-po:read");
  const [row] = await db
    .select()
    .from(customerPurchaseOrder)
    .where(and(eq(customerPurchaseOrder.id, id), eq(customerPurchaseOrder.organizationId, orgId), visibleTo(userId)));
  return row ?? null;
}

// Same lookup, but resolvable across every org the caller's owner controls —
// for the Edit flow reached from the centralized view.
export async function getCustomerPoDetailCentralized(id: string): Promise<CustomerPo | null> {
  const { orgId, userId } = await requireAccess("customer-po:update:centralized");
  const ownerOrgIds = await getAllOwnerOrgIds(userId, orgId);
  const [row] = await db
    .select()
    .from(customerPurchaseOrder)
    .where(and(eq(customerPurchaseOrder.id, id), inArray(customerPurchaseOrder.organizationId, ownerOrgIds), visibleTo(userId)));
  return row ?? null;
}

export type CustomerPoForSoCreate = {
  id: string;
  customerPoNo: string;
  customerId: string | null;
  customerSnapshot: {
    title?: string; name: string; organizationName?: string;
    organizationAddress?: string; email?: string; contactNo?: string;
  } | null;
  quotationId: string | null;
  quotationNo: string | null;
  quotationLinks: { quotationId: string; quotationNo: string }[] | null;
  salesOrderId: string | null;
  amount: string;
  currency: string;
  items: CpoItemInput[] | null;
  deliveryDate: Date | null;
  deliveryAddress: string | null;
  salesPersonName: string | null;
  associateSalesPersons: { id: string; name: string }[] | null;
  notes: string | null;
};

export async function getCustomerPoForSoCreate(id: string): Promise<CustomerPoForSoCreate | null> {
  const { orgId } = await requireAccess("customer-po:read");
  const [row] = await db
    .select({
      id: customerPurchaseOrder.id,
      customerPoNo: customerPurchaseOrder.customerPoNo,
      customerId: customerPurchaseOrder.customerId,
      customerSnapshot: customerPurchaseOrder.customerSnapshot,
      quotationId: customerPurchaseOrder.quotationId,
      quotationNo: customerPurchaseOrder.quotationNo,
      quotationLinks: customerPurchaseOrder.quotationLinks,
      salesOrderId: customerPurchaseOrder.salesOrderId,
      amount: customerPurchaseOrder.amount,
      currency: customerPurchaseOrder.currency,
      items: customerPurchaseOrder.items,
      deliveryDate: customerPurchaseOrder.deliveryDate,
      deliveryAddress: customerPurchaseOrder.deliveryAddress,
      salesPersonName: customerPurchaseOrder.salesPersonName,
      associateSalesPersons: customerPurchaseOrder.associateSalesPersons,
      notes: customerPurchaseOrder.notes,
    })
    .from(customerPurchaseOrder)
    .where(and(eq(customerPurchaseOrder.id, id), eq(customerPurchaseOrder.organizationId, orgId), ne(customerPurchaseOrder.status, "draft")));
  return row ?? null;
}

export type CustomerPoSearchResult = {
  id: string;
  customerPoNo: string;
  customerId: string | null;
  customerSnapshot: {
    title?: string; name: string; organizationName?: string;
  } | null;
  amount: string;
  currency: string;
  status: string;
};

export async function searchCustomerPosByNo(query: string): Promise<CustomerPoSearchResult[]> {
  const { orgId } = await requireAccess("customer-po:read");
  const rows = await db
    .select({
      id: customerPurchaseOrder.id,
      customerPoNo: customerPurchaseOrder.customerPoNo,
      customerId: customerPurchaseOrder.customerId,
      customerSnapshot: customerPurchaseOrder.customerSnapshot,
      amount: customerPurchaseOrder.amount,
      currency: customerPurchaseOrder.currency,
      status: customerPurchaseOrder.status,
    })
    .from(customerPurchaseOrder)
    .where(
      and(
        eq(customerPurchaseOrder.organizationId, orgId),
        ilike(customerPurchaseOrder.customerPoNo, `%${query}%`),
        ne(customerPurchaseOrder.status, "draft"),
      ),
    )
    .orderBy(desc(customerPurchaseOrder.createdAt))
    .limit(10);
  return rows;
}

export async function getCustomerPosByCustomer(customerId: string): Promise<CustomerPo[]> {
  const { orgId } = await requireAccess("customer-po:read");
  return db
    .select()
    .from(customerPurchaseOrder)
    .where(
      and(
        eq(customerPurchaseOrder.organizationId, orgId),
        eq(customerPurchaseOrder.customerId, customerId),
        ne(customerPurchaseOrder.status, "draft"),
      ),
    )
    .orderBy(desc(customerPurchaseOrder.createdAt));
}

// Backstop for the form check: every item on a CPO needs its CPO description (a cancelled CPO is exempt)
function assertCpoDescriptions(items: CpoItemInput[] | null | undefined, status?: string) {
  if (!items || items.length === 0 || status === "cancelled") return;
  const missing = items.filter((i) => !(i.cpoDescription ?? "").trim());
  if (missing.length > 0)
    throw new Error(`CPO description is required for every item (missing on ${missing.length} of ${items.length}).`);
}

// Tell the sales approvers that a new Customer PO needs a Sales Order
async function notifyNewCpo(orgId: string, userId: string, cpoId: string, customerPoNo: string, customerSnapshot: CustomerPo["customerSnapshot"]) {
  try {
    const approvers = await getSoApprovers(orgId);
    const snap = customerSnapshot as any;
    const customerName = snap ? [snap.title, snap.name].filter(Boolean).join(" ") : null;
    const body = customerName
      ? `${customerName} sent a PO that requires a Sales Order to be created.`
      : "A new Customer PO has been received and requires a Sales Order.";
    await Promise.all(
      approvers
        .filter((uid) => uid !== userId) // don't notify self
        .map((uid) =>
          createNotification({ organizationId: orgId, userId: uid, type: "cpo:received", title: `New Customer PO: ${customerPoNo}`, body, link: `/dashboard/sales/customer-po/${cpoId}` }),
        ),
    );
  } catch {
    // Notification failure must never break CPO creation
  }
}

export async function createCustomerPo(input: CreateCustomerPoInput): Promise<CustomerPo> {
  const { orgId, userId } = await requireAccess("customer-po:create");
  const isDraft = input.status === "draft";
  if (isDraft) {
    // a draft can be saved half-way, as long as there is something to come back to
    if (!input.customerPoNo?.trim() && !input.quotationLinks?.length && !input.items?.length) {
      throw new Error("Add a customer PO number, a quotation or an item before saving a draft.");
    }
  } else {
    assertCpoDescriptions(input.items, input.status);
    if (input.status !== "cancelled") {
      const clash = await findCpoNoClash(orgId, input.customerPoNo);
      if (clash) throw new Error(clashMessage(clash));
    }
  }

  const customerSnapshot: CustomerPo["customerSnapshot"] = input.customerId
    ? await buildCustomerSnapshot(input.customerId, await getAllOwnerOrgIds(userId, orgId), input.customerOrgMemberId)
    : null;

  const [row] = await db
    .insert(customerPurchaseOrder)
    .values({
      id: nanoid(),
      organizationId: orgId,
      customerPoNo: input.customerPoNo?.trim() ?? "",
      customerId: input.customerId ?? null,
      customerSnapshot,
      quotationId: input.quotationLinks?.[0]?.quotationId ?? input.quotationId ?? null,
      quotationNo: input.quotationLinks?.[0]?.quotationNo ?? input.quotationNo ?? null,
      quotationLinks: input.quotationLinks && input.quotationLinks.length > 0 ? input.quotationLinks : null,
      salesOrderId: input.salesOrderId ?? null,
      salesOrderNo: input.salesOrderNo ?? null,
      items: input.items ?? null,
      amount: input.amount ?? "0",
      currency: input.currency ?? "MYR",
      documentKey: input.documentKey ?? null,
      notes: input.notes ?? null,
      salesPersonName: input.salesPersonName ?? null,
      associateSalesPersons: input.associateSalesPersons && input.associateSalesPersons.length > 0 ? input.associateSalesPersons : null,
      receivedDate: input.receivedDate ?? null,
      deliveryDate: input.deliveryDate ?? null,
      deliveryAddress: input.deliveryAddress ?? null,
      status: input.status ?? "received",
      createdBy: userId,
    })
    .returning();

  // A draft is not an order yet: nobody is told until it is recorded
  if (!isDraft) await notifyNewCpo(orgId, userId, row.id, row.customerPoNo, customerSnapshot);

  return row;
}

export async function updateCustomerPo(input: UpdateCustomerPoInput): Promise<CustomerPo> {
  const { orgId, userId } = await requireAccess("customer-po:update");

  const [existing] = await db
    .select()
    .from(customerPurchaseOrder)
    .where(and(eq(customerPurchaseOrder.id, input.id), eq(customerPurchaseOrder.organizationId, orgId)));
  if (!existing) throw new Error("Customer PO not found");

  return applyCustomerPoUpdate(existing, input, userId);
}

// Same update, but resolvable across every org the caller's owner controls —
// for the Edit flow reached from the centralized view.
export async function updateCustomerPoCentralized(input: UpdateCustomerPoInput): Promise<CustomerPo> {
  const { orgId, userId } = await requireAccess("customer-po:update:centralized");
  const ownerOrgIds = await getAllOwnerOrgIds(userId, orgId);

  const [existing] = await db
    .select()
    .from(customerPurchaseOrder)
    .where(and(eq(customerPurchaseOrder.id, input.id), inArray(customerPurchaseOrder.organizationId, ownerOrgIds)));
  if (!existing) throw new Error("Customer PO not found");

  return applyCustomerPoUpdate(existing, input, userId);
}

async function applyCustomerPoUpdate(existing: CustomerPo, input: UpdateCustomerPoInput, userId: string): Promise<CustomerPo> {
  const wasDraft = existing.status === "draft";
  const nextStatus = input.status ?? existing.status;
  const staysDraft = nextStatus === "draft";
  if (wasDraft && existing.createdBy !== userId) throw new Error("Only the person who started this draft can change it.");
  if (!wasDraft && staysDraft) throw new Error("A recorded Customer PO cannot go back to a draft.");
  if (!staysDraft) {
    // recording it (a draft becoming a real CPO) or an ordinary edit: the full rules
    if (!input.customerPoNo?.trim()) throw new Error("Customer PO number is required.");
    assertCpoDescriptions(input.items ?? existing.items, nextStatus);
    if (nextStatus !== "cancelled") {
      const clash = await findCpoNoClash(existing.organizationId, input.customerPoNo, existing.id);
      if (clash) throw new Error(clashMessage(clash));
    }
  }
  // the document was removed or replaced: its old file is deleted after the save below
  const oldDocument = input.documentKey !== undefined && existing.documentKey && existing.documentKey !== input.documentKey ? existing.documentKey : null;

  const newNo = input.customerPoNo.trim();
  const oldNo = existing.customerPoNo;
  // (nothing has been made from a draft, and an empty old number must never match other documents)
  const renamed = !!newNo && newNo !== oldNo && !wasDraft && !!oldNo.trim();

  const [row] = await db
    .update(customerPurchaseOrder)
    .set({
      customerPoNo: input.customerPoNo.trim(),
      quotationId: input.quotationLinks?.[0]?.quotationId ?? input.quotationId ?? null,
      quotationNo: input.quotationLinks?.[0]?.quotationNo ?? input.quotationNo ?? null,
      quotationLinks: input.quotationLinks !== undefined
        ? (input.quotationLinks && input.quotationLinks.length > 0 ? input.quotationLinks : null)
        : existing.quotationLinks,
      salesOrderId: input.salesOrderId ?? null,
      salesOrderNo: input.salesOrderNo ?? null,
      items: input.items !== undefined ? (input.items ?? null) : existing.items,
      amount: input.amount ?? existing.amount,
      currency: input.currency ?? existing.currency,
      documentKey: input.documentKey !== undefined ? input.documentKey : existing.documentKey,
      salesPersonName: input.salesPersonName !== undefined ? (input.salesPersonName ?? null) : existing.salesPersonName,
      associateSalesPersons: input.associateSalesPersons !== undefined
        ? (input.associateSalesPersons && input.associateSalesPersons.length > 0 ? input.associateSalesPersons : null)
        : existing.associateSalesPersons,
      notes: input.notes ?? null,
      receivedDate: input.receivedDate ?? null,
      deliveryDate: input.deliveryDate !== undefined ? (input.deliveryDate ?? null) : existing.deliveryDate,
      deliveryAddress: input.deliveryAddress !== undefined ? (input.deliveryAddress ?? null) : existing.deliveryAddress,
      status: input.status ?? existing.status,
    })
    .where(eq(customerPurchaseOrder.id, input.id))
    .returning();
  if (oldDocument) await deleteDocumentAfterSave(oldDocument);
  if (renamed) await renameCustomerPoNoOnDocuments(existing, oldNo, newNo);
  // recorded now: tell the sales approvers, as if it had just been received
  if (wasDraft && !staysDraft && nextStatus !== "cancelled") await notifyNewCpo(existing.organizationId, userId, existing.id, newNo, row.customerSnapshot);
  return row;
}

// The CPO number is copied onto the documents made from the CPO (sales order, PR, internal PO, DO,
// invoice, packing list). When the number changes (a temporary number replaced by the real PO, or a
// CPO that turns out to be a cash sale) those copies are renamed too, so no document keeps the old
// number. Linked documents are found by the CPO id; the copies that only hold the number text
// (internal PO items, packing list items) are matched by the old number inside the same owner's orgs.
async function renameCustomerPoNoOnDocuments(cpo: CustomerPo, oldNo: string, newNo: string) {
  const orgIds = await getAllOwnerOrgIds("", cpo.organizationId);
  const id = cpo.id;
  const orgPoIds = db.select({ id: purchaseOrder.id }).from(purchaseOrder).where(inArray(purchaseOrder.organizationId, orgIds));

  const linkedSos = await db
    .select({ id: salesOrder.id, links: salesOrder.customerPoLinks })
    .from(salesOrder)
    .where(and(inArray(salesOrder.organizationId, orgIds), or(
      eq(salesOrder.id, cpo.salesOrderId ?? "-"),
      sql`${salesOrder.customerPoLinks}::text like ${"%" + id + "%"}`,
    )));

  const queries = [
    ...linkedSos.map((so) => {
      const links = (so.links ?? []).map((l) => (l.customerPoId === id ? { ...l, customerPoNo: newNo } : l));
      const first = links[0]?.customerPoId === id;
      return db.update(salesOrder).set({
        customerPoLinks: links.length > 0 ? links : null,
        ...(first || links.length === 0 ? { customerPoNo: newNo } : {}),
      }).where(eq(salesOrder.id, so.id));
    }),
    db.update(salesOrderItem).set({ sourceCustomerPoNo: newNo }).where(eq(salesOrderItem.sourceCustomerPoId, id)),
    db.update(purchaseRequisition).set({ customerPoNo: newNo }).where(eq(purchaseRequisition.customerPoId, id)),
    db.update(purchaseOrderCustomerPo).set({ customerPoNo: newNo }).where(eq(purchaseOrderCustomerPo.customerPoId, id)),
    db.update(deliveryOrder).set({ customerPoNo: newNo }).where(eq(deliveryOrder.customerPoId, id)),
    db.update(invoice).set({ customerPoNo: newNo }).where(eq(invoice.customerPoId, id)),
    db.update(purchaseOrderItem).set({ customerPoNo: newNo })
      .where(and(eq(purchaseOrderItem.customerPoNo, oldNo), inArray(purchaseOrderItem.purchaseOrderId, orgPoIds))),
    db.update(packingListItem).set({ customerPoNo: newNo })
      .where(and(eq(packingListItem.customerPoNo, oldNo), inArray(packingListItem.purchaseOrderId, orgPoIds))),
  ];
  // one atomic batch: either every copy is renamed or none
  await db.batch(queries as unknown as [(typeof queries)[0], ...(typeof queries)[number][]]);
}

export interface CustomerPoTrackingData {
  cpo: CustomerPo;
  createdByName: string | null;
  so: {
    id: string; soNo: string; status: string;
    createdAt: Date; grandTotal: string | null;
    deliveryDate: Date | null;
  } | null;
  internalPos: { id: string; prNo: string | null; poNo: string | null; status: string; createdAt: Date; grandTotal: string | null; supplierId: string | null }[];
  dos: { id: string; doNo: string; status: string; createdAt: Date; deliveryDate: Date | null }[];
  invoices: {
    id: string; invoiceNo: string; status: string; createdAt: Date;
    grandTotal: string; dueDate: Date | null; paidAt: Date | null; paidAmount: string | null;
    paymentTerms: string | null;
  }[];
  // Where the chain continues inside a sibling org: one leg per Supplier PO
  // above that went to a linked sibling (see IntercompanyLeg).
  intercompany: IntercompanyLeg[];
}

// One hop of the trail into a sibling org: our PO to it (viaPoNo), the SO
// auto-created there from that PO, and the POs it raised from that SO — then
// recursively onward if one of those went to yet another sibling. Numbers and
// statuses only, never amounts (a sibling's supplier prices are its cost).
// href is set only when the viewer can open the centralized SO/PO pages; the
// plain ones are scoped to the active org and would 404.
export interface IntercompanyLeg {
  organizationName: string;
  viaPoNo: string;
  viaPoStatus: string;
  so: { id: string; soNo: string; status: string; createdAt: Date; href: string | null } | null;
  pos: { id: string; poNo: string | null; prNo: string | null; status: string; createdAt: Date; href: string | null }[];
  next: IntercompanyLeg[];
}

type IcContext = { ownerOrgIds: Set<string>; canOpenSo: boolean; canOpenPo: boolean };

const IC_MAX_DEPTH = 3;

async function fetchIntercompanyLegs(
  pos: { id: string; poNo: string | null; prNo: string | null; status: string; supplierId: string | null }[],
  ctx: IcContext,
  depth = 1,
  seen = new Set<string>(),
): Promise<IntercompanyLeg[]> {
  if (depth > IC_MAX_DEPTH) return [];
  const supplierIds = [...new Set(pos.map((p) => p.supplierId).filter((v): v is string => !!v))];
  if (supplierIds.length === 0) return [];

  const sups = await db
    .select({ id: supplier.id, linkedOrganizationId: supplier.linkedOrganizationId })
    .from(supplier)
    .where(inArray(supplier.id, supplierIds));
  // Only siblings under the same owner — a stale link to an org that changed hands is ignored.
  const siblingOf = new Map(
    sups.filter((x) => x.linkedOrganizationId && ctx.ownerOrgIds.has(x.linkedOrganizationId)).map((x) => [x.id, x.linkedOrganizationId!]),
  );
  const icPos = pos.filter((p) => p.supplierId && siblingOf.has(p.supplierId) && !seen.has(p.id));
  if (icPos.length === 0) return [];
  icPos.forEach((p) => seen.add(p.id));

  const orgIds = [...new Set(icPos.map((p) => siblingOf.get(p.supplierId!)!))];
  const [orgRows, soRows] = await Promise.all([
    db.select({ id: organization.id, name: organization.name }).from(organization).where(inArray(organization.id, orgIds)),
    db.select({
      id: salesOrder.id, soNo: salesOrder.soNo, status: salesOrder.status, createdAt: salesOrder.createdAt,
      organizationId: salesOrder.organizationId, sourcePurchaseOrderId: salesOrder.sourcePurchaseOrderId, customerPoId: salesOrder.customerPoId,
    }).from(salesOrder).where(inArray(salesOrder.sourcePurchaseOrderId, icPos.map((p) => p.id))),
  ]);
  const orgName = new Map(orgRows.map((o) => [o.id, o.name]));

  const legs: IntercompanyLeg[] = [];
  for (const p of icPos) {
    const siblingOrgId = siblingOf.get(p.supplierId!)!;
    const so = soRows.find((r) => r.sourcePurchaseOrderId === p.id && r.organizationId === siblingOrgId) ?? null;

    let siblingPos: { id: string; poNo: string | null; prNo: string | null; status: string; createdAt: Date; supplierId: string | null }[] = [];
    if (so) {
      // The sibling's POs for this order — linked through the SO itself, a PR
      // raised from it, or the auto-created Customer PO behind it.
      const [prRows, cpoLinkRows] = await Promise.all([
        db.select({ id: purchaseRequisition.id }).from(purchaseRequisition).where(eq(purchaseRequisition.salesOrderId, so.id)),
        so.customerPoId
          ? db.select({ id: purchaseOrderCustomerPo.purchaseOrderId }).from(purchaseOrderCustomerPo).where(eq(purchaseOrderCustomerPo.customerPoId, so.customerPoId))
          : Promise.resolve([] as { id: string }[]),
      ]);
      const links = [eq(purchaseOrder.salesOrderId, so.id)];
      if (prRows.length > 0) links.push(inArray(purchaseOrder.purchaseRequisitionId, prRows.map((r) => r.id)));
      if (cpoLinkRows.length > 0) links.push(inArray(purchaseOrder.id, cpoLinkRows.map((r) => r.id)));
      siblingPos = await db
        .select({
          id: purchaseOrder.id, poNo: purchaseOrder.poNo, prNo: purchaseOrder.prNo, status: purchaseOrder.status,
          createdAt: purchaseOrder.createdAt, supplierId: purchaseOrder.supplierId,
        })
        .from(purchaseOrder)
        .where(and(eq(purchaseOrder.organizationId, siblingOrgId), or(...links)))
        .orderBy(asc(purchaseOrder.createdAt));
    }

    legs.push({
      organizationName: orgName.get(siblingOrgId) ?? "Sibling organization",
      viaPoNo: p.poNo ?? p.prNo ?? p.id,
      viaPoStatus: p.status,
      so: so
        ? { id: so.id, soNo: so.soNo, status: so.status, createdAt: so.createdAt, href: ctx.canOpenSo ? `/dashboard/sales/order/centralized/${so.id}` : null }
        : null,
      pos: siblingPos.map((x) => ({
        id: x.id, poNo: x.poNo, prNo: x.prNo, status: x.status, createdAt: x.createdAt,
        href: ctx.canOpenPo ? `/dashboard/procurement/purchase-order/centralized/${x.id}` : null,
      })),
      next: await fetchIntercompanyLegs(siblingPos, ctx, depth + 1, seen),
    });
  }
  return legs;
}

export async function getCustomerPoForTracking(id: string): Promise<CustomerPoTrackingData | null> {
  const { orgId, userId } = await requireAccess("customer-po:read");

  const [cpo] = await db
    .select()
    .from(customerPurchaseOrder)
    .where(and(eq(customerPurchaseOrder.id, id), eq(customerPurchaseOrder.organizationId, orgId)));

  if (!cpo) return null;
  return fetchCpoTrackingData(cpo, { userId, orgId });
}

// Same tracking data, but resolvable across every org the caller's owner
// controls — for members explicitly granted customer-po:read:centralized.
export async function getCustomerPoForTrackingCentralized(
  id: string,
): Promise<(CustomerPoTrackingData & { organizationName: string; isIntercompany: boolean }) | null> {
  const { orgId, userId } = await requireAccess("customer-po:read:centralized");
  const ownerOrgIds = await getAllOwnerOrgIds(userId, orgId);

  const [row] = await db
    .select({ po: customerPurchaseOrder, organizationName: organization.name, linkedOrganizationId: customer.linkedOrganizationId })
    .from(customerPurchaseOrder)
    .innerJoin(organization, eq(organization.id, customerPurchaseOrder.organizationId))
    .leftJoin(customer, eq(customer.id, customerPurchaseOrder.customerId))
    .where(and(eq(customerPurchaseOrder.id, id), inArray(customerPurchaseOrder.organizationId, ownerOrgIds)));

  if (!row) return null;
  const data = await fetchCpoTrackingData(row.po, { userId, orgId });
  return { ...data, organizationName: row.organizationName, isIntercompany: !!row.linkedOrganizationId };
}

// viewer: the signed-in caller (active org), used to scope the intercompany
// legs to the owner's own orgs and decide whether they link anywhere.
async function fetchCpoTrackingData(cpo: CustomerPo, viewer: { userId: string; orgId: string }): Promise<CustomerPoTrackingData> {
  const id = cpo.id;
  const [userRows, soRows, poLinkRows] = await Promise.all([
    db.select({ id: user.id, name: user.name }).from(user).where(eq(user.id, cpo.createdBy)),
    cpo.salesOrderId
      ? db.select({
          id: salesOrder.id, soNo: salesOrder.soNo, status: salesOrder.status,
          createdAt: salesOrder.createdAt, grandTotal: salesOrder.grandTotal,
          deliveryDate: salesOrder.deliveryDate,
        }).from(salesOrder).where(eq(salesOrder.id, cpo.salesOrderId))
      : Promise.resolve([]),
    db.select({ purchaseOrderId: purchaseOrderCustomerPo.purchaseOrderId })
      .from(purchaseOrderCustomerPo)
      .where(eq(purchaseOrderCustomerPo.customerPoId, id)),
  ]);

  const so = soRows[0] ?? null;

  const [dosRows, invoiceRows, internalPoRows] = await Promise.all([
    so
      ? db.select({
          id: deliveryOrder.id, doNo: deliveryOrder.doNo, status: deliveryOrder.status,
          createdAt: deliveryOrder.createdAt, deliveryDate: deliveryOrder.deliveryDate,
        }).from(deliveryOrder).where(eq(deliveryOrder.salesOrderId, so.id))
          .orderBy(asc(deliveryOrder.createdAt))
      : Promise.resolve([]),
    db.select({
      id: invoice.id, invoiceNo: invoice.invoiceNo, status: invoice.status,
      createdAt: invoice.createdAt, grandTotal: invoice.grandTotal,
      dueDate: invoice.dueDate, paidAt: invoice.paidAt, paidAmount: invoice.paidAmount,
      paymentTerms: invoice.paymentTerms,
    }).from(invoice)
      .where(
        so
          ? eq(invoice.salesOrderId, so.id)
          : eq(invoice.customerPoId, id),
      )
      .orderBy(asc(invoice.createdAt)),
    poLinkRows.length > 0
      ? db.select({
          id: purchaseOrder.id, prNo: purchaseOrder.prNo, poNo: purchaseOrder.poNo, status: purchaseOrder.status,
          createdAt: purchaseOrder.createdAt, grandTotal: purchaseOrder.grandTotal, supplierId: purchaseOrder.supplierId,
        }).from(purchaseOrder)
          .where(inArray(purchaseOrder.id, poLinkRows.map((r) => r.purchaseOrderId)))
          .orderBy(asc(purchaseOrder.createdAt))
      : Promise.resolve([]),
  ]);

  let intercompany: IntercompanyLeg[] = [];
  // Cancelled POs included: a cancel doesn't reach the sibling's SO, and a
  // still-open SO behind a cancelled PO is exactly what the trail should show.
  const outgoing = internalPoRows.filter((p) => p.supplierId);
  if (outgoing.length > 0) {
    const [ownerOrgIds, perms] = await Promise.all([
      getAllOwnerOrgIds(viewer.userId, viewer.orgId),
      getUserPermissions(viewer.userId, viewer.orgId),
    ]);
    intercompany = await fetchIntercompanyLegs(outgoing, {
      ownerOrgIds: new Set(ownerOrgIds),
      canOpenSo: hasAccess(perms, "sales-order:read:centralized"),
      canOpenPo: hasAccess(perms, "purchase-order:read:centralized"),
    });
  }

  return {
    cpo,
    createdByName: userRows[0]?.name ?? null,
    so,
    internalPos: internalPoRows,
    dos: dosRows,
    invoices: invoiceRows,
    intercompany,
  };
}

export type PaymentStatus = "none" | "unpaid" | "partial" | "paid" | "overdue";

export interface CustomerPoSummaryInvoice {
  id: string;
  invoiceNo: string;
  status: string;
  grandTotal: string;
  paidAmount: string | null;
  dueDate: Date | null;
  createdAt: Date;
}

export interface CustomerPoSummaryRow {
  cpo: CustomerPo;
  soNo: string | null;
  soStatus: string | null;
  soId: string | null;
  internalPoCount: number;
  doTotal: number;
  doDelivered: number;
  invoices: CustomerPoSummaryInvoice[];   // all invoices linked to this CPO
  invoiceTotal: number;
  paidAmount: number;
  paymentStatus: PaymentStatus;
  dueDate: Date | null;
}

export async function getCustomerPoSummary(): Promise<CustomerPoSummaryRow[]> {
  const { orgId } = await requireAccess("customer-po:read");

  // Excludes intercompany CPOs (auto-created by maybeCreateIntercompanySalesOrder
  // from a sibling org's PO — see customer.linkedOrganizationId) — this is a
  // revenue/fulfillment view of real external customer business, and an
  // intercompany "sale" would otherwise silently inflate it with what's
  // actually just goods moving between the owner's own organizations.
  const allCustomers = await db
    .select({ id: customer.id, linkedOrganizationId: customer.linkedOrganizationId })
    .from(customer)
    .where(eq(customer.organizationId, orgId));
  const intercompanyCustomerIds = new Set(allCustomers.filter((c) => c.linkedOrganizationId).map((c) => c.id));

  const cpos = (
    await db
      .select()
      .from(customerPurchaseOrder)
      .where(and(eq(customerPurchaseOrder.organizationId, orgId), ne(customerPurchaseOrder.status, "draft")))
      .orderBy(...cpoNewestFirst())
  ).filter((c) => !c.customerId || !intercompanyCustomerIds.has(c.customerId));

  if (cpos.length === 0) return [];

  const cpoIds  = cpos.map((c) => c.id);
  const soIds   = cpos.map((c) => c.salesOrderId).filter((x): x is string => !!x);

  // Parallel bulk fetches
  const [soRows, doRows, invoiceRows, poLinkRows] = await Promise.all([
    soIds.length > 0
      ? db.select({
          id: salesOrder.id, soNo: salesOrder.soNo, status: salesOrder.status,
        }).from(salesOrder).where(inArray(salesOrder.id, soIds))
      : Promise.resolve([] as { id: string; soNo: string; status: string }[]),

    soIds.length > 0
      ? db.select({
          salesOrderId: deliveryOrder.salesOrderId,
          status: deliveryOrder.status,
        }).from(deliveryOrder).where(inArray(deliveryOrder.salesOrderId, soIds))
      : Promise.resolve([] as { salesOrderId: string | null; status: string }[]),

    db.select({
      id: invoice.id, invoiceNo: invoice.invoiceNo, status: invoice.status,
      grandTotal: invoice.grandTotal, paidAmount: invoice.paidAmount,
      dueDate: invoice.dueDate, createdAt: invoice.createdAt,
      salesOrderId: invoice.salesOrderId, customerPoId: invoice.customerPoId,
    }).from(invoice)
      .where(
        soIds.length > 0
          ? or(inArray(invoice.customerPoId, cpoIds), inArray(invoice.salesOrderId, soIds))!
          : inArray(invoice.customerPoId, cpoIds),
      )
      .orderBy(desc(invoice.createdAt)),

    db.select({
      customerPoId: purchaseOrderCustomerPo.customerPoId,
      purchaseOrderId: purchaseOrderCustomerPo.purchaseOrderId,
    }).from(purchaseOrderCustomerPo)
      .where(inArray(purchaseOrderCustomerPo.customerPoId, cpoIds)),
  ]);

  // Build lookup maps
  const soMap     = new Map(soRows.map((s) => [s.id, s]));
  const dosBySo   = new Map<string, typeof doRows>();
  for (const d of doRows) {
    if (!d.salesOrderId) continue;
    if (!dosBySo.has(d.salesOrderId)) dosBySo.set(d.salesOrderId, []);
    dosBySo.get(d.salesOrderId)!.push(d);
  }
  const invBySo   = new Map<string, typeof invoiceRows>();
  const invByCpo  = new Map<string, typeof invoiceRows>();
  for (const inv of invoiceRows) {
    if (inv.salesOrderId) {
      if (!invBySo.has(inv.salesOrderId)) invBySo.set(inv.salesOrderId, []);
      invBySo.get(inv.salesOrderId)!.push(inv);
    } else if (inv.customerPoId) {
      if (!invByCpo.has(inv.customerPoId)) invByCpo.set(inv.customerPoId, []);
      invByCpo.get(inv.customerPoId)!.push(inv);
    }
  }
  const poCountByCpo = new Map<string, number>();
  for (const link of poLinkRows) {
    poCountByCpo.set(link.customerPoId, (poCountByCpo.get(link.customerPoId) ?? 0) + 1);
  }

  return cpos.map((cpo) => {
    const so  = cpo.salesOrderId ? (soMap.get(cpo.salesOrderId) ?? null) : null;
    const dos = so ? (dosBySo.get(so.id) ?? []) : [];
    const invs = so
      ? (invBySo.get(so.id) ?? invByCpo.get(cpo.id) ?? [])
      : (invByCpo.get(cpo.id) ?? []);

    const doDelivered  = dos.filter((d) => d.status === "delivered").length;
    const invoiceTotal = invs.reduce((s, i) => s + Number(i.grandTotal ?? 0), 0);
    const paidAmount   = invs.reduce((s, i) => s + Number(i.paidAmount ?? 0), 0);

    let paymentStatus: PaymentStatus = "none";
    if (invs.length > 0) {
      if (invs.every((i) => i.status === "paid"))        paymentStatus = "paid";
      else if (invs.some((i) => i.status === "overdue")) paymentStatus = "overdue";
      else if (paidAmount > 0)                           paymentStatus = "partial";
      else                                               paymentStatus = "unpaid";
    }

    const latestDue = invs.reduce<Date | null>((d, i) => {
      if (!i.dueDate) return d;
      const dt = new Date(i.dueDate);
      return !d || dt > d ? dt : d;
    }, null);

    return {
      cpo,
      soNo:          so?.soNo ?? null,
      soStatus:      so?.status ?? null,
      soId:          so?.id ?? null,
      internalPoCount: poCountByCpo.get(cpo.id) ?? 0,
      doTotal:       dos.length,
      doDelivered,
      invoices: invs.map((i) => ({
        id:          i.id,
        invoiceNo:   i.invoiceNo,
        status:      i.status,
        grandTotal:  i.grandTotal,
        paidAmount:  i.paidAmount,
        dueDate:     i.dueDate,
        createdAt:   i.createdAt,
      })),
      invoiceTotal,
      paidAmount,
      paymentStatus,
      dueDate:       latestDue,
    };
  });
}

export async function deleteCustomerPo(id: string): Promise<void> {
  // whoever started a draft may delete it; any other CPO needs the delete permission
  const { orgId, userId } = await requireAccess("customer-po:read");
  const [existing] = await db
    .select()
    .from(customerPurchaseOrder)
    .where(and(eq(customerPurchaseOrder.id, id), eq(customerPurchaseOrder.organizationId, orgId)));
  if (!existing) throw new Error("Customer PO not found");
  if (!(existing.status === "draft" && existing.createdBy === userId)) await requireAccess("customer-po:delete");
  if (existing.status === "draft" && existing.createdBy !== userId) throw new Error("Customer PO not found");
  if (existing.salesOrderId) {
    throw new Error(
      `Cannot delete — this CPO is linked to sales order ${existing.salesOrderNo ?? existing.salesOrderId}. Remove the link from the sales order first.`,
    );
  }
  await db.delete(customerPurchaseOrder).where(eq(customerPurchaseOrder.id, id));
  await deleteDocumentAfterSave(existing.documentKey); // after the CPO is gone, as above
}
