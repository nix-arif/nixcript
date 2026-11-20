// Problems found after delivery and supplier claims: all the rules, with the caller passed in so it can be tested
// without a login. The server actions in server/post-delivery.ts only add the session (and file storage) and call these.
import { db } from "@/db";
import {
  customer, customerIssue, customerIssueItem, customerIssueMedia, deliveryOrder, deliveryOrderItem,
  documentNumberingSetting, goodsReceipt, goodsReceiptItem, member, notification, organization, packingList, packingListItem,
  postDeliveryCounter, postDeliveryEvent, purchaseOrder, supplier, supplierClaim, supplierClaimItem, supplierClaimTerm, user, userPermission,
} from "@/db/schema";
import { and, asc, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { hasAccess } from "@/lib/permissions/has-access";
import { buildDocumentNo, DOC_TYPE_DEFAULTS } from "@/lib/document-numbering";
import {
  CLAIM_LIVE, ISSUE_LIVE, canMoveIssue, clockOf, computeDeadline, isBasis, isChannel, isClaimOutcome, isCustomerResolution, isDay, isSentVia,
  isSeverity, isSituation, isUnitStatus, pickTerm, reminderLevel, situationLabel, todayKL, addDays, ISSUE_STATUS,
  type Basis, type ClaimOutcome, type ClaimStatus, type IssueStatus, type SentVia, type Term, type UnitStatus,
} from "@/lib/post-delivery/core";

export type Ctx = { orgId: string; userId: string; perms: string[] };
export type Result<T = void> = { ok: true; value: T } | { ok: false; error: string };
const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = (error: string): Result<never> => ({ ok: false, error });
const can = (ctx: Ctx, key: string) => hasAccess(ctx.perms, key);
const NO_ACCESS = fail("You don't have permission to do this.");

const ISSUE_LINK = "/dashboard/sales/customer-issues";
const CLAIM_LINK = "/dashboard/procurement/supplier-claims";
const REQUESTS = ["replacement", "credit_note", "repair", "refund"];
const isRequest = (v: unknown): v is string => typeof v === "string" && REQUESTS.includes(v);
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : NaN; };
const clean = (v?: string | null) => (v == null ? null : v.trim() || null);

// ── numbering (customised in Document Numbering settings, like every other document) ──
async function nextNo(orgId: string, docType: "ci" | "sc"): Promise<string> {
  const year = new Date().getFullYear();
  const [row] = await db.select().from(documentNumberingSetting).where(and(eq(documentNumberingSetting.organizationId, orgId), eq(documentNumberingSetting.documentType, docType))).limit(1);
  let cfg = row && { prefix: row.prefix, docCode: row.docCode, separator: row.separator, includeYear: row.includeYear, paddingLength: row.paddingLength, numberFormat: row.numberFormat ?? "standard" };
  if (!cfg) {
    const [org] = await db.select({ slug: organization.slug }).from(organization).where(eq(organization.id, orgId));
    cfg = { prefix: (org?.slug ?? "ORG").toUpperCase(), docCode: DOC_TYPE_DEFAULTS[docType].docCode, separator: "-", includeYear: 1, paddingLength: 4, numberFormat: "standard" };
  }
  // one statement: no two people can get the same number, and a new year starts again at 1
  const [counter] = await db.insert(postDeliveryCounter).values({ id: nanoid(), organizationId: orgId, docType, year, lastNumber: 1 })
    .onConflictDoUpdate({
      target: [postDeliveryCounter.organizationId, postDeliveryCounter.docType],
      set: { lastNumber: sql`CASE WHEN ${postDeliveryCounter.year} = ${year} THEN ${postDeliveryCounter.lastNumber} + 1 ELSE 1 END`, year: sql`${year}`, updatedAt: new Date() },
    }).returning({ lastNumber: postDeliveryCounter.lastNumber });
  return buildDocumentNo(cfg, year, counter.lastNumber);
}

// ── notifications and the timeline ──────────────────────────────────────────
async function notifyUser(orgId: string, userId: string | null | undefined, n: { title: string; body: string; link: string }) {
  if (!userId) return;
  await db.insert(notification).values({ id: nanoid(), organizationId: orgId, userId, type: "customer-issue", ...n, isRead: 0, createdAt: new Date() });
}
// the people who handle supplier claims: the owner(s) and everyone explicitly granted supplier-claim:manage
async function claimHandlerIds(orgId: string): Promise<string[]> {
  const [owners, granted] = await Promise.all([
    db.select({ userId: member.userId }).from(member).where(and(eq(member.organizationId, orgId), eq(member.role, "owner"), isNull(member.deletedAt))),
    db.select({ userId: userPermission.userId }).from(userPermission).where(and(eq(userPermission.organizationId, orgId), eq(userPermission.permissionKey, "supplier-claim:manage"), eq(userPermission.allowed, true))),
  ]);
  return [...new Set([...owners, ...granted].map((r) => r.userId))];
}
async function notifyHandlers(orgId: string, n: { title: string; body: string; link: string }, except?: string) {
  for (const id of await claimHandlerIds(orgId)) if (id !== except) await notifyUser(orgId, id, n);
}
async function logEvent(ctx: Ctx, issueId: string, type: string, message: string, claimId?: string | null) {
  await db.insert(postDeliveryEvent).values({ id: nanoid(), issueId, claimId: claimId ?? null, type, message, actorId: ctx.userId });
}

// ═══════════════════════ supplier claim terms ═══════════════════════
export type TermInput = { situation: string; windowDays: number | string; basis: string; notes?: string };

export async function listSupplierTerms(ctx: Ctx) {
  if (!can(ctx, "supplier-claim:read")) return [];
  const suppliers = await db.select({ id: supplier.id, name: supplier.name, contactPerson: supplier.contactPerson, email: supplier.email, contactNo: supplier.contactNo })
    .from(supplier).where(eq(supplier.organizationId, ctx.orgId)).orderBy(asc(supplier.name));
  const terms = await db.select().from(supplierClaimTerm).where(eq(supplierClaimTerm.organizationId, ctx.orgId));
  return suppliers.map((s) => ({
    ...s,
    terms: terms.filter((t) => t.supplierId === s.id).map((t) => ({ situation: t.situation, windowDays: t.windowDays, basis: t.basis as Basis, notes: t.notes })).sort((a, b) => a.situation.localeCompare(b.situation)),
  }));
}
export type SupplierTerms = Awaited<ReturnType<typeof listSupplierTerms>>[number];

// Replaces all the terms of one supplier: the general one ("" situation) and any for a specific kind of problem
export async function saveSupplierTerms(ctx: Ctx, supplierId: string, terms: TermInput[]): Promise<Result> {
  if (!can(ctx, "supplier-claim:terms")) return NO_ACCESS;
  const [s] = await db.select({ id: supplier.id }).from(supplier).where(and(eq(supplier.id, supplierId), eq(supplier.organizationId, ctx.orgId)));
  if (!s) return fail("Supplier not found.");
  const seen = new Set<string>();
  const rows: { situation: string; windowDays: number; basis: Basis; notes: string | null }[] = [];
  for (const t of terms ?? []) {
    const situation = t.situation ?? "";
    if (situation !== "" && !isSituation(situation)) return fail("Choose a kind of problem from the list.");
    if (seen.has(situation)) return fail(situation === "" ? "The general term is entered twice." : `${situationLabel(situation)} is entered twice.`);
    seen.add(situation);
    const days = Number(t.windowDays);
    if (!Number.isInteger(days) || days < 1 || days > 3650) return fail(`${situation === "" ? "The general term" : situationLabel(situation)}: the number of days must be a whole number from 1 to 3650.`);
    if (!isBasis(t.basis)) return fail("Choose what the days are counted from.");
    rows.push({ situation, windowDays: days, basis: t.basis, notes: clean(t.notes) });
  }
  await db.delete(supplierClaimTerm).where(and(eq(supplierClaimTerm.organizationId, ctx.orgId), eq(supplierClaimTerm.supplierId, supplierId)));
  if (rows.length > 0) await db.insert(supplierClaimTerm).values(rows.map((r) => ({ id: nanoid(), organizationId: ctx.orgId, supplierId, ...r, updatedBy: ctx.userId })));
  return ok(undefined);
}

async function termsOf(orgId: string, supplierId: string): Promise<Term[]> {
  const rows = await db.select().from(supplierClaimTerm).where(and(eq(supplierClaimTerm.organizationId, orgId), eq(supplierClaimTerm.supplierId, supplierId)));
  return rows.map((t) => ({ situation: t.situation, windowDays: t.windowDays, basis: t.basis as Basis, notes: t.notes }));
}

// the suppliers someone can pick on an issue: needs no claim permission, because the person who logs the problem is often in sales
export async function listSuppliersForIssue(ctx: Ctx): Promise<{ id: string; name: string }[]> {
  if (!can(ctx, "customer-issue:create") && !can(ctx, "customer-issue:update") && !can(ctx, "supplier-claim:read")) return [];
  return db.select({ id: supplier.id, name: supplier.name }).from(supplier).where(eq(supplier.organizationId, ctx.orgId)).orderBy(asc(supplier.name));
}

// ═══════════════════════ finding the delivery and where the goods came from ═══════════════════════
export type DeliveryOrderHit = { id: string; doNo: string; customerId: string | null; customerName: string; contactPerson: string | null; deliveredAt: string | null; customerPoNo: string | null };

export async function searchDeliveryOrders(ctx: Ctx, query: string): Promise<DeliveryOrderHit[]> {
  if (!can(ctx, "customer-issue:create") && !can(ctx, "customer-issue:update")) return [];
  const q = query.trim();
  if (q.length < 2) return [];
  const like = `%${q}%`;
  const rows = await db.select().from(deliveryOrder)
    .where(and(eq(deliveryOrder.organizationId, ctx.orgId), ne(deliveryOrder.status, "draft"),
      or(sql`${deliveryOrder.doNo} ILIKE ${like}`, sql`${deliveryOrder.customerSnapshot}::text ILIKE ${like}`, sql`${deliveryOrder.customerPoNo} ILIKE ${like}`)))
    .orderBy(desc(deliveryOrder.deliveryDate)).limit(20);
  return rows.map((r) => {
    const snap = (r.customerSnapshot ?? {}) as { name?: string; organizationName?: string };
    return {
      id: r.id, doNo: r.doNo, customerId: r.customerId, customerName: snap.organizationName || snap.name || r.deliveredTo || "", contactPerson: snap.organizationName ? snap.name ?? null : null,
      deliveredAt: r.deliveryDate ? todayKL(r.deliveryDate) : null, customerPoNo: r.customerPoNo,
    };
  });
}

export type DeliveryOrderLines = DeliveryOrderHit & { lines: { productId: string | null; productCode: string | null; description: string | null; qty: string; uom: string | null }[] };
export async function getDeliveryOrderLines(ctx: Ctx, doId: string): Promise<DeliveryOrderLines | null> {
  if (!can(ctx, "customer-issue:create") && !can(ctx, "customer-issue:update")) return null;
  const [hit] = await searchById(ctx, doId);
  if (!hit) return null;
  const lines = await db.select().from(deliveryOrderItem).where(eq(deliveryOrderItem.deliveryOrderId, doId)).orderBy(asc(deliveryOrderItem.rowNo));
  return { ...hit, lines: lines.map((l) => ({ productId: l.productId, productCode: l.productCode, description: l.description, qty: l.qty, uom: l.uom })) };
}
async function searchById(ctx: Ctx, doId: string): Promise<DeliveryOrderHit[]> {
  const [r] = await db.select().from(deliveryOrder).where(and(eq(deliveryOrder.id, doId), eq(deliveryOrder.organizationId, ctx.orgId)));
  if (!r) return [];
  const snap = (r.customerSnapshot ?? {}) as { name?: string; organizationName?: string };
  return [{ id: r.id, doNo: r.doNo, customerId: r.customerId, customerName: snap.organizationName || snap.name || r.deliveredTo || "", contactPerson: snap.organizationName ? snap.name ?? null : null, deliveredAt: r.deliveryDate ? todayKL(r.deliveryDate) : null, customerPoNo: r.customerPoNo }];
}

export type ReceivedLine = {
  packingListItemId: string; goodsReceiptId: string | null; grNo: string | null; receivedAt: string | null; poNo: string | null;
  supplierId: string | null; supplierName: string | null; lotNo: string | null; qtyReceived: number; supplierDocRef: string | null;
  productCode: string | null; description: string | null; unitCost: string | null; currency: string | null;
};
// Lines we received from suppliers for this product code, newest first: the candidates for "where did this come from"
export async function findReceivedLines(ctx: Ctx, productCode: string): Promise<ReceivedLine[]> {
  if (!can(ctx, "customer-issue:create") && !can(ctx, "customer-issue:update") && !can(ctx, "supplier-claim:manage")) return [];
  const code = productCode.trim();
  if (!code) return [];
  const rows = await db.select({
    pliId: packingListItem.id, lotNo: packingListItem.lotNo, qtyExpected: packingListItem.qtyExpected, qtyReceived: packingListItem.draftQtyReceived,
    productCode: packingListItem.productCode, description: packingListItem.description, unitPrice: packingListItem.unitPrice, currency: packingListItem.currency,
    plSupplierRef: packingList.supplierRefNo, supplierId: packingList.supplierId, supplierName: supplier.name,
    poNo: purchaseOrder.poNo, prNo: purchaseOrder.prNo, grId: goodsReceipt.id, grNo: goodsReceipt.grNo, receivedDate: goodsReceipt.receivedDate,
  })
    .from(packingListItem)
    .innerJoin(packingList, eq(packingList.id, packingListItem.packingListId))
    .innerJoin(purchaseOrder, eq(purchaseOrder.id, packingListItem.purchaseOrderId))
    .leftJoin(supplier, eq(supplier.id, packingList.supplierId))
    .leftJoin(goodsReceiptItem, eq(goodsReceiptItem.packingListItemId, packingListItem.id))
    .leftJoin(goodsReceipt, eq(goodsReceipt.id, goodsReceiptItem.goodsReceiptId))
    .where(and(eq(packingList.organizationId, ctx.orgId), eq(packingList.status, "completed"), isNull(packingListItem.removedAt),
      or(sql`lower(${packingListItem.productCode}) = lower(${code})`, sql`lower(${packingListItem.privateLabelCode}) = lower(${code})`)))
    .orderBy(desc(goodsReceipt.receivedDate)).limit(15);
  return rows.map((r) => ({
    packingListItemId: r.pliId, goodsReceiptId: r.grId, grNo: r.grNo, receivedAt: r.receivedDate ? todayKL(r.receivedDate) : null, poNo: r.poNo ?? r.prNo,
    supplierId: r.supplierId, supplierName: r.supplierName, lotNo: r.lotNo, qtyReceived: Number(r.qtyReceived ?? r.qtyExpected) || 0, supplierDocRef: r.plSupplierRef,
    productCode: r.productCode, description: r.description, unitCost: r.unitPrice, currency: r.currency,
  }));
}

// ═══════════════════════ customer issues ═══════════════════════
export type IssueItemInput = {
  id?: string; productId?: string | null; productCode?: string | null; description?: string | null; qtyDelivered?: string | number | null; qtyAffected: string | number;
  uom?: string | null; lotNo?: string | null; serialNo?: string | null; supplierId?: string | null; poNo?: string | null; supplierDocRef?: string | null;
  goodsReceiptId?: string | null; packingListItemId?: string | null; receivedAt?: string | null; unitCost?: string | number | null; currency?: string | null;
  unitStatus?: string; notes?: string | null;
};
export type IssueInput = {
  customerId?: string | null; customerName?: string; contactPerson?: string; contactNo?: string; deliveryOrderId?: string | null; deliveredAt?: string | null;
  reportedAt: string; reportedChannel?: string | null; situation: string; severity?: string; safetyRelated?: boolean; summary: string; description?: string;
  items: IssueItemInput[];
};

// checks the input and turns it into rows; everything it reads (supplier, delivery order, goods receipt) must be in this organization
async function prepareIssue(ctx: Ctx, input: IssueInput) {
  const reportedAt = input.reportedAt;
  if (!isDay(reportedAt)) return fail("Enter the date the customer reported the problem.");
  if (reportedAt > todayKL()) return fail("The report date cannot be in the future.");
  if (!isSituation(input.situation)) return fail("Choose what kind of problem it is.");
  const summary = clean(input.summary);
  if (!summary) return fail("Write a short summary of the problem.");
  if (input.severity && !isSeverity(input.severity)) return fail("Severity is Normal, High or Urgent.");
  if (input.reportedChannel && !isChannel(input.reportedChannel)) return fail("Choose how the customer reported it.");
  if (input.deliveredAt && !isDay(input.deliveredAt)) return fail("The delivery date is not a valid date.");
  if (!input.items?.length) return fail("Add at least one item that has the problem.");

  let customerName = clean(input.customerName);
  let customerId = input.customerId || null;
  if (customerId) {
    const [c] = await db.select({ id: customer.id }).from(customer).where(and(eq(customer.id, customerId), eq(customer.organizationId, ctx.orgId)));
    if (!c) customerId = null;
  }
  let deliveredAt = input.deliveredAt || null;
  let doNo: string | null = null;
  const doId = input.deliveryOrderId || null;
  if (doId) {
    const [hit] = await searchById(ctx, doId);
    if (!hit) return fail("That delivery order was not found.");
    doNo = hit.doNo;
    deliveredAt = deliveredAt ?? hit.deliveredAt;
    customerName = customerName ?? hit.customerName;
    customerId = customerId ?? hit.customerId;
  }
  if (!customerName) return fail("Enter the customer's name.");

  const supplierIds = [...new Set(input.items.map((i) => i.supplierId).filter((v): v is string => !!v))];
  const suppliers = supplierIds.length ? await db.select({ id: supplier.id, name: supplier.name }).from(supplier).where(and(inArray(supplier.id, supplierIds), eq(supplier.organizationId, ctx.orgId))) : [];
  const grIds = [...new Set(input.items.map((i) => i.goodsReceiptId).filter((v): v is string => !!v))];
  const grs = grIds.length ? await db.select({ id: goodsReceipt.id, grNo: goodsReceipt.grNo }).from(goodsReceipt).where(and(inArray(goodsReceipt.id, grIds), eq(goodsReceipt.organizationId, ctx.orgId))) : [];

  const items = [];
  for (const [i, it] of input.items.entries()) {
    const n = i + 1;
    if (!clean(it.productCode) && !clean(it.description)) return fail(`Item ${n} needs a product code or a description.`);
    const qty = num(it.qtyAffected);
    if (!(qty > 0)) return fail(`Item ${n}: the quantity with the problem must be more than 0.`);
    const delivered = it.qtyDelivered == null || it.qtyDelivered === "" ? null : num(it.qtyDelivered);
    if (delivered != null && (!Number.isFinite(delivered) || delivered < 0)) return fail(`Item ${n}: the delivered quantity is not valid.`);
    if (delivered != null && qty > delivered + 1e-9) return fail(`Item ${n}: ${qty} with the problem is more than the ${delivered} delivered.`);
    if (it.receivedAt && !isDay(it.receivedAt)) return fail(`Item ${n}: the date received from the supplier is not valid.`);
    if (it.unitStatus && !isUnitStatus(it.unitStatus)) return fail(`Item ${n}: unknown unit status.`);
    const cost = it.unitCost == null || it.unitCost === "" ? null : num(it.unitCost);
    if (cost != null && (!Number.isFinite(cost) || cost < 0)) return fail(`Item ${n}: the unit cost is not valid.`);
    const supplierId = it.supplierId || null;
    let supplierName: string | null = null;
    if (supplierId) {
      const s = suppliers.find((x) => x.id === supplierId);
      if (!s) return fail(`Item ${n}: that supplier was not found.`);
      supplierName = s.name;
    }
    const gr = it.goodsReceiptId ? grs.find((g) => g.id === it.goodsReceiptId) : undefined;
    if (it.goodsReceiptId && !gr) return fail(`Item ${n}: that goods receipt was not found.`);
    items.push({
      id: it.id, productId: it.productId || null, productCode: clean(it.productCode), description: clean(it.description),
      qtyDelivered: delivered == null ? null : String(delivered), qtyAffected: String(qty), uom: clean(it.uom), lotNo: clean(it.lotNo), serialNo: clean(it.serialNo),
      supplierId, supplierName, poNo: clean(it.poNo), supplierDocRef: clean(it.supplierDocRef), goodsReceiptId: gr?.id ?? null, grNo: gr?.grNo ?? null,
      packingListItemId: it.packingListItemId || null, receivedAt: it.receivedAt || null, unitCost: cost == null ? null : String(cost), currency: clean(it.currency),
      unitStatus: (it.unitStatus as UnitStatus) ?? "with_customer", notes: clean(it.notes), rowNo: i,
    });
  }
  return ok({
    header: {
      customerId, customerName, contactPerson: clean(input.contactPerson), contactNo: clean(input.contactNo), deliveryOrderId: doId, deliveryOrderNo: doNo, deliveredAt,
      reportedAt, reportedChannel: input.reportedChannel || null, situation: input.situation, severity: input.severity ?? "normal", safetyRelated: !!input.safetyRelated,
      summary, description: clean(input.description),
    },
    items,
  });
}

export async function createIssue(ctx: Ctx, input: IssueInput): Promise<Result<{ id: string; issueNo: string }>> {
  if (!can(ctx, "customer-issue:create")) return NO_ACCESS;
  const prepared = await prepareIssue(ctx, input);
  if (!prepared.ok) return prepared;
  const { header, items } = prepared.value;
  const id = nanoid();
  const issueNo = await nextNo(ctx.orgId, "ci");
  await db.insert(customerIssue).values({ id, organizationId: ctx.orgId, issueNo, status: "open", ...header, createdBy: ctx.userId });
  await db.insert(customerIssueItem).values(items.map((it) => ({ ...it, id: nanoid(), issueId: id })));
  await logEvent(ctx, id, "created", `Issue reported by ${header.customerName}: ${header.summary}`);
  const urgent = header.safetyRelated || header.severity === "urgent";
  await notifyHandlers(ctx.orgId, {
    title: `${urgent ? "URGENT customer issue" : "Customer issue"}: ${issueNo}`,
    body: `${header.customerName} reported: ${header.summary}${header.safetyRelated ? " (safety related)" : ""}`,
    link: `${ISSUE_LINK}/${id}`,
  }, ctx.userId);
  return ok({ id, issueNo });
}

const EDITABLE: IssueStatus[] = ["open", "investigating", "claim_raised"];

export async function updateIssue(ctx: Ctx, id: string, input: IssueInput): Promise<Result> {
  if (!can(ctx, "customer-issue:update")) return NO_ACCESS;
  const [existing] = await db.select().from(customerIssue).where(and(eq(customerIssue.id, id), eq(customerIssue.organizationId, ctx.orgId)));
  if (!existing) return fail("Issue not found.");
  if (!EDITABLE.includes(existing.status as IssueStatus)) return fail("This issue is closed. Reopen it to change it.");
  const prepared = await prepareIssue(ctx, input);
  if (!prepared.ok) return prepared;
  const { header, items } = prepared.value;

  const current = await db.select().from(customerIssueItem).where(eq(customerIssueItem.issueId, id));
  const keep = new Set(items.map((i) => i.id).filter(Boolean));
  const stale = current.filter((c) => !keep.has(c.id));
  if (stale.length > 0) {
    // an item that is in a live claim cannot just disappear
    const inClaim = await db.select({ itemId: supplierClaimItem.issueItemId, claimNo: supplierClaim.claimNo }).from(supplierClaimItem)
      .innerJoin(supplierClaim, eq(supplierClaim.id, supplierClaimItem.claimId))
      .where(and(inArray(supplierClaimItem.issueItemId, stale.map((s) => s.id)), inArray(supplierClaim.status, CLAIM_LIVE)));
    if (inClaim.length > 0) return fail(`An item you removed is in claim ${inClaim[0].claimNo}. Withdraw the claim first.`);
  }
  for (const it of items) {
    if (it.id && !current.some((c) => c.id === it.id)) return fail("An item in the form does not belong to this issue. Reload the page.");
  }
  await db.update(customerIssue).set({ ...header }).where(eq(customerIssue.id, id));
  if (stale.length > 0) await db.delete(customerIssueItem).where(inArray(customerIssueItem.id, stale.map((s) => s.id)));
  for (const it of items) {
    const { id: itemId, ...row } = it;
    if (itemId) await db.update(customerIssueItem).set(row).where(eq(customerIssueItem.id, itemId));
    else await db.insert(customerIssueItem).values({ ...row, id: nanoid(), issueId: id });
  }
  await refreshDraftClaims(ctx, id);
  await logEvent(ctx, id, "edited", "Issue details were updated");
  return ok(undefined);
}

export type IssueListRow = {
  id: string; issueNo: string; status: IssueStatus; customerName: string; deliveryOrderNo: string | null; situation: string; summary: string; severity: string; safetyRelated: boolean;
  reportedAt: string; itemCount: number; claimCount: number; nearestDeadline: string | null; anyLate: boolean; createdAt: Date;
};
export async function listIssues(ctx: Ctx, opts: { scope?: "live" | "all"; q?: string } = {}): Promise<IssueListRow[]> {
  if (!can(ctx, "customer-issue:read")) return [];
  const rows = await db.select().from(customerIssue).where(eq(customerIssue.organizationId, ctx.orgId)).orderBy(desc(customerIssue.createdAt));
  const ids = rows.map((r) => r.id);
  const [items, claims] = ids.length
    ? await Promise.all([
        db.select({ issueId: customerIssueItem.issueId }).from(customerIssueItem).where(inArray(customerIssueItem.issueId, ids)),
        db.select({ issueId: supplierClaim.issueId, status: supplierClaim.status, deadline: supplierClaim.deadlineDate }).from(supplierClaim).where(inArray(supplierClaim.issueId, ids)),
      ])
    : [[], []];
  const today = todayKL();
  const q = opts.q?.trim().toLowerCase();
  return rows
    .filter((r) => (opts.scope === "all" ? true : ISSUE_LIVE.includes(r.status as IssueStatus)))
    .filter((r) => !q || [r.issueNo, r.customerName, r.deliveryOrderNo, r.summary, situationLabel(r.situation)].some((v) => v?.toLowerCase().includes(q)))
    .map((r) => {
      const mine = claims.filter((c) => c.issueId === r.id && CLAIM_LIVE.includes(c.status as ClaimStatus));
      const open = mine.filter((c) => c.status === "draft" && c.deadline).map((c) => c.deadline as string).sort();
      return {
        id: r.id, issueNo: r.issueNo, status: r.status as IssueStatus, customerName: r.customerName, deliveryOrderNo: r.deliveryOrderNo, situation: r.situation, summary: r.summary,
        severity: r.severity, safetyRelated: r.safetyRelated, reportedAt: r.reportedAt, itemCount: items.filter((i) => i.issueId === r.id).length,
        claimCount: claims.filter((c) => c.issueId === r.id && c.status !== "withdrawn").length, nearestDeadline: open[0] ?? null,
        anyLate: open.some((d) => clockOf(d, today).state === "late"), createdAt: r.createdAt,
      };
    });
}

export async function getIssue(ctx: Ctx, id: string) {
  if (!can(ctx, "customer-issue:read")) return null;
  const [issue] = await db.select().from(customerIssue).where(and(eq(customerIssue.id, id), eq(customerIssue.organizationId, ctx.orgId)));
  if (!issue) return null;
  const [items, media, events, claims] = await Promise.all([
    db.select().from(customerIssueItem).where(eq(customerIssueItem.issueId, id)).orderBy(asc(customerIssueItem.rowNo)),
    db.select().from(customerIssueMedia).where(eq(customerIssueMedia.issueId, id)).orderBy(asc(customerIssueMedia.createdAt)),
    db.select().from(postDeliveryEvent).where(eq(postDeliveryEvent.issueId, id)).orderBy(desc(postDeliveryEvent.createdAt)),
    db.select().from(supplierClaim).where(eq(supplierClaim.issueId, id)).orderBy(asc(supplierClaim.createdAt)),
  ]);
  const claimItems = claims.length ? await db.select().from(supplierClaimItem).where(inArray(supplierClaimItem.claimId, claims.map((c) => c.id))) : [];
  const userIds = [...new Set([issue.createdBy, ...events.map((e) => e.actorId), ...media.map((m) => m.uploadedBy)].filter((v): v is string => !!v))];
  const users = userIds.length ? await db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, userIds)) : [];
  const nameOf = (u: string | null) => users.find((x) => x.id === u)?.name ?? null;
  const today = todayKL();
  return {
    ...issue, status: issue.status as IssueStatus, createdByName: nameOf(issue.createdBy),
    canUpdate: can(ctx, "customer-issue:update"), canManageClaims: can(ctx, "supplier-claim:manage"), canReadClaims: can(ctx, "supplier-claim:read"),
    items: items.map((i) => ({ ...i, unitStatus: i.unitStatus as UnitStatus, claimIds: claimItems.filter((ci) => ci.issueItemId === i.id).map((ci) => ci.claimId).filter((cid) => claims.find((c) => c.id === cid && CLAIM_LIVE.includes(c.status as ClaimStatus))) })),
    media: media.map((m) => ({ ...m, uploadedByName: nameOf(m.uploadedBy) })),
    events: events.map((e) => ({ ...e, actorName: nameOf(e.actorId) })),
    claims: can(ctx, "supplier-claim:read")
      ? claims.map((c) => ({ id: c.id, claimNo: c.claimNo, supplierId: c.supplierId, supplierName: c.supplierName, status: c.status as ClaimStatus, deadlineDate: c.deadlineDate, clock: clockOf(c.deadlineDate, today), itemCount: claimItems.filter((ci) => ci.claimId === c.id).length }))
      : [],
  };
}
export type IssueDetail = NonNullable<Awaited<ReturnType<typeof getIssue>>>;

async function loadIssue(ctx: Ctx, id: string) {
  const [issue] = await db.select().from(customerIssue).where(and(eq(customerIssue.id, id), eq(customerIssue.organizationId, ctx.orgId)));
  return issue ?? null;
}
const liveClaimsOf = (issueId: string) => db.select({ id: supplierClaim.id, claimNo: supplierClaim.claimNo }).from(supplierClaim).where(and(eq(supplierClaim.issueId, issueId), inArray(supplierClaim.status, CLAIM_LIVE)));

// Moves an issue by hand. A claim moves it to "claim raised" by itself; resolving needs what the customer was given.
export async function setIssueStatus(ctx: Ctx, id: string, to: IssueStatus, input: { reason?: string } = {}): Promise<Result> {
  if (!can(ctx, "customer-issue:update")) return NO_ACCESS;
  const issue = await loadIssue(ctx, id);
  if (!issue) return fail("Issue not found.");
  if (to === "resolved") return fail("Use Resolve to record what the customer was given.");
  if (!canMoveIssue(issue.status, to)) return fail(`An issue that is ${ISSUE_STATUS[issue.status as IssueStatus].toLowerCase()} cannot be moved to ${ISSUE_STATUS[to].toLowerCase()}.`);
  const reason = clean(input.reason);
  if ((to === "closed_no_claim" || to === "cancelled") && !reason) return fail(to === "cancelled" ? "Say why the issue is cancelled." : "Say why no claim is being made (for example: caused by misuse, or not the supplier's fault).");
  if (to === "closed_no_claim" || to === "cancelled") {
    const live = await liveClaimsOf(id);
    if (live.length > 0) return fail(`Claim ${live[0].claimNo} is still open. Withdraw it first.`);
  }
  await db.update(customerIssue).set({ status: to, closedReason: to === "closed_no_claim" || to === "cancelled" ? reason : null, ...(to === "investigating" || to === "open" ? { resolvedAt: null } : {}) }).where(eq(customerIssue.id, id));
  await logEvent(ctx, id, "status", `Status changed from ${ISSUE_STATUS[issue.status as IssueStatus]} to ${ISSUE_STATUS[to]}${reason ? `: ${reason}` : ""}`);
  return ok(undefined);
}

export async function resolveIssue(ctx: Ctx, id: string, input: { resolution: string; notes?: string }): Promise<Result> {
  if (!can(ctx, "customer-issue:update")) return NO_ACCESS;
  const issue = await loadIssue(ctx, id);
  if (!issue) return fail("Issue not found.");
  if (!canMoveIssue(issue.status, "resolved")) return fail("Only an issue that is still being worked on can be resolved.");
  if (!isCustomerResolution(input.resolution)) return fail("Choose what the customer was given.");
  await db.update(customerIssue).set({ status: "resolved", customerResolution: input.resolution, customerResolutionNotes: clean(input.notes), resolvedAt: new Date() }).where(eq(customerIssue.id, id));
  await logEvent(ctx, id, "resolved", `Resolved for the customer: ${input.resolution}${clean(input.notes) ? ` (${clean(input.notes)})` : ""}`);
  return ok(undefined);
}

// records what the customer is owed or was given without closing the issue
export async function setCustomerResolution(ctx: Ctx, id: string, input: { resolution: string | null; notes?: string }): Promise<Result> {
  if (!can(ctx, "customer-issue:update")) return NO_ACCESS;
  const issue = await loadIssue(ctx, id);
  if (!issue) return fail("Issue not found.");
  if (input.resolution && !isCustomerResolution(input.resolution)) return fail("Choose what the customer is given.");
  await db.update(customerIssue).set({ customerResolution: input.resolution || null, customerResolutionNotes: clean(input.notes) }).where(eq(customerIssue.id, id));
  await logEvent(ctx, id, "customer", input.resolution ? `For the customer: ${input.resolution}${clean(input.notes) ? ` (${clean(input.notes)})` : ""}` : "Customer resolution cleared");
  return ok(undefined);
}

export async function addIssueNote(ctx: Ctx, id: string, text: string): Promise<Result> {
  if (!can(ctx, "customer-issue:update")) return NO_ACCESS;
  const issue = await loadIssue(ctx, id);
  if (!issue) return fail("Issue not found.");
  const note = clean(text);
  if (!note) return fail("Write the note first.");
  await logEvent(ctx, id, "note", note);
  return ok(undefined);
}

export async function setUnitStatus(ctx: Ctx, itemId: string, status: string): Promise<Result> {
  if (!can(ctx, "customer-issue:update")) return NO_ACCESS;
  if (!isUnitStatus(status)) return fail("Unknown unit status.");
  const [row] = await db.select({ id: customerIssueItem.id, issueId: customerIssueItem.issueId, code: customerIssueItem.productCode, prev: customerIssueItem.unitStatus })
    .from(customerIssueItem).innerJoin(customerIssue, eq(customerIssue.id, customerIssueItem.issueId))
    .where(and(eq(customerIssueItem.id, itemId), eq(customerIssue.organizationId, ctx.orgId)));
  if (!row) return fail("Item not found.");
  await db.update(customerIssueItem).set({ unitStatus: status }).where(eq(customerIssueItem.id, itemId));
  await logEvent(ctx, row.issueId, "unit", `${row.code ?? "Item"}: ${row.prev} -> ${status}`);
  return ok(undefined);
}

// ── evidence ────────────────────────────────────────────────────────────────
export const mediaKeyPrefix = (orgId: string, issueId: string) => `post-delivery/${orgId}/${issueId}/`;

export async function registerMedia(ctx: Ctx, issueId: string, input: { key: string; filename: string; kind: "image" | "video"; itemId?: string | null; caption?: string }): Promise<Result<{ id: string }>> {
  if (!can(ctx, "customer-issue:update") && !can(ctx, "customer-issue:create")) return NO_ACCESS;
  const issue = await loadIssue(ctx, issueId);
  if (!issue) return fail("Issue not found.");
  if (!input.key.startsWith(mediaKeyPrefix(ctx.orgId, issueId))) return fail("That file does not belong to this issue.");
  let itemId: string | null = null;
  if (input.itemId) {
    const [it] = await db.select({ id: customerIssueItem.id }).from(customerIssueItem).where(and(eq(customerIssueItem.id, input.itemId), eq(customerIssueItem.issueId, issueId)));
    if (!it) return fail("That item does not belong to this issue.");
    itemId = it.id;
  }
  const id = nanoid();
  await db.insert(customerIssueMedia).values({ id, issueId, itemId, imageKey: input.key, kind: input.kind === "video" ? "video" : "image", filename: input.filename.slice(0, 200), caption: clean(input.caption), uploadedBy: ctx.userId });
  await logEvent(ctx, issueId, "evidence", `Added ${input.kind === "video" ? "a video" : "a photo"}: ${input.filename.slice(0, 80)}`);
  return ok({ id });
}

export async function removeMedia(ctx: Ctx, mediaId: string): Promise<Result<{ key: string }>> {
  if (!can(ctx, "customer-issue:update")) return NO_ACCESS;
  const [m] = await db.select().from(customerIssueMedia).innerJoin(customerIssue, eq(customerIssue.id, customerIssueMedia.issueId))
    .where(and(eq(customerIssueMedia.id, mediaId), eq(customerIssue.organizationId, ctx.orgId)));
  if (!m) return fail("File not found.");
  await db.delete(customerIssueMedia).where(eq(customerIssueMedia.id, mediaId));
  await logEvent(ctx, m.customer_issue_media.issueId, "evidence", `Removed a file: ${m.customer_issue_media.filename}`);
  return ok({ key: m.customer_issue_media.imageKey });
}

export async function getMediaKey(ctx: Ctx, mediaId: string): Promise<{ key: string; filename: string; kind: string } | null> {
  if (!can(ctx, "customer-issue:read")) return null;
  const [m] = await db.select().from(customerIssueMedia).innerJoin(customerIssue, eq(customerIssue.id, customerIssueMedia.issueId))
    .where(and(eq(customerIssueMedia.id, mediaId), eq(customerIssue.organizationId, ctx.orgId)));
  return m ? { key: m.customer_issue_media.imageKey, filename: m.customer_issue_media.filename, kind: m.customer_issue_media.kind } : null;
}

// ═══════════════════════ supplier claims ═══════════════════════
async function loadClaim(ctx: Ctx, id: string) {
  const [claim] = await db.select().from(supplierClaim).where(and(eq(supplierClaim.id, id), eq(supplierClaim.organizationId, ctx.orgId)));
  return claim ?? null;
}

// the deadline for a set of items of one supplier, from that supplier's own terms
async function deadlineFor(orgId: string, supplierId: string, situation: string, issue: { deliveredAt: string | null }, items: { receivedAt: string | null }[]) {
  return computeDeadline(await termsOf(orgId, supplierId), situation, { receivedDates: items.map((i) => i.receivedAt), deliveredAt: issue.deliveredAt });
}

export type ClaimPreview = {
  supplierName: string; items: { id: string; productCode: string | null; description: string | null; qtyAffected: string; qtyAvailable: number; receivedAt: string | null; inClaim: string | null }[];
  deadline: string | null; basis: Basis | null; basisDate: string | null; windowDays: number | null; problem: string | null; notes: string | null; daysLeft: number | null; state: string;
};

// What a claim to this supplier would look like: the items that can go in it and the deadline its terms give
export async function previewClaim(ctx: Ctx, issueId: string, supplierId: string, itemIds?: string[]): Promise<Result<ClaimPreview>> {
  if (!can(ctx, "supplier-claim:read")) return NO_ACCESS;
  const issue = await loadIssue(ctx, issueId);
  if (!issue) return fail("Issue not found.");
  const [s] = await db.select({ id: supplier.id, name: supplier.name }).from(supplier).where(and(eq(supplier.id, supplierId), eq(supplier.organizationId, ctx.orgId)));
  if (!s) return fail("Supplier not found.");
  const items = await db.select().from(customerIssueItem).where(and(eq(customerIssueItem.issueId, issueId), eq(customerIssueItem.supplierId, supplierId))).orderBy(asc(customerIssueItem.rowNo));
  const taken = items.length ? await db.select({ itemId: supplierClaimItem.issueItemId, claimNo: supplierClaim.claimNo }).from(supplierClaimItem).innerJoin(supplierClaim, eq(supplierClaim.id, supplierClaimItem.claimId)).where(and(inArray(supplierClaimItem.issueItemId, items.map((i) => i.id)), inArray(supplierClaim.status, CLAIM_LIVE))) : [];
  const chosen = items.filter((i) => !itemIds || itemIds.includes(i.id));
  const d = await deadlineFor(ctx.orgId, supplierId, issue.situation, issue, chosen);
  const clock = clockOf(d.deadline, todayKL());
  return ok({
    supplierName: s.name,
    items: items.map((i) => ({ id: i.id, productCode: i.productCode, description: i.description, qtyAffected: i.qtyAffected, qtyAvailable: Number(i.qtyAffected), receivedAt: i.receivedAt, inClaim: taken.find((t) => t.itemId === i.id)?.claimNo ?? null })),
    deadline: d.deadline, basis: d.basis, basisDate: d.basisDate, windowDays: d.windowDays, problem: d.problem, notes: d.term?.notes ?? null, daysLeft: clock.daysLeft, state: clock.state,
  });
}

export type ClaimInput = { issueId: string; supplierId: string; items: { issueItemId: string; qtyClaimed?: string | number }[]; supplierRef?: string; requestedOutcome?: string };

export async function createClaim(ctx: Ctx, input: ClaimInput): Promise<Result<{ id: string; claimNo: string }>> {
  if (!can(ctx, "supplier-claim:manage")) return NO_ACCESS;
  const issue = await loadIssue(ctx, input.issueId);
  if (!issue) return fail("Issue not found.");
  if (!EDITABLE.includes(issue.status as IssueStatus)) return fail("This issue is closed. Reopen it before raising a claim.");
  const [s] = await db.select({ id: supplier.id, name: supplier.name }).from(supplier).where(and(eq(supplier.id, input.supplierId), eq(supplier.organizationId, ctx.orgId)));
  if (!s) return fail("Choose the supplier the claim is for.");
  if (!input.items?.length) return fail("Choose at least one item for the claim.");
  if (input.requestedOutcome && !isRequest(input.requestedOutcome)) return fail("Choose what you are asking the supplier for: replacement, credit note, repair or refund.");
  const ids = input.items.map((i) => i.issueItemId);
  if (new Set(ids).size !== ids.length) return fail("An item is chosen twice.");
  const rows = await db.select().from(customerIssueItem).where(and(eq(customerIssueItem.issueId, issue.id), inArray(customerIssueItem.id, ids)));
  if (rows.length !== ids.length) return fail("An item does not belong to this issue.");
  for (const r of rows) {
    if (r.supplierId !== s.id) return fail(`${r.productCode ?? r.description ?? "An item"} is not an item of ${s.name}. Set its supplier on the issue first.`);
  }
  const taken = await db.select({ claimNo: supplierClaim.claimNo, itemId: supplierClaimItem.issueItemId }).from(supplierClaimItem).innerJoin(supplierClaim, eq(supplierClaim.id, supplierClaimItem.claimId)).where(and(inArray(supplierClaimItem.issueItemId, ids), inArray(supplierClaim.status, CLAIM_LIVE)));
  if (taken.length > 0) return fail(`An item is already in claim ${taken[0].claimNo}.`);
  const lines = [];
  for (const i of input.items) {
    const row = rows.find((r) => r.id === i.issueItemId)!;
    const qty = i.qtyClaimed == null || i.qtyClaimed === "" ? Number(row.qtyAffected) : num(i.qtyClaimed);
    if (!(qty > 0) || qty > Number(row.qtyAffected) + 1e-9) return fail(`${row.productCode ?? "Item"}: claim between 1 and ${row.qtyAffected}.`);
    lines.push({ issueItemId: row.id, qtyClaimed: String(qty) });
  }
  const d = await deadlineFor(ctx.orgId, s.id, issue.situation, issue, rows);
  const id = nanoid();
  const claimNo = await nextNo(ctx.orgId, "sc");
  await db.insert(supplierClaim).values({
    id, organizationId: ctx.orgId, claimNo, issueId: issue.id, supplierId: s.id, supplierName: s.name, status: "draft", situation: issue.situation,
    basis: d.basis, basisDate: d.basisDate, windowDays: d.windowDays, deadlineDate: d.deadline, supplierRef: clean(input.supplierRef), requestedOutcome: input.requestedOutcome || "replacement", createdBy: ctx.userId,
  });
  await db.insert(supplierClaimItem).values(lines.map((l) => ({ ...l, id: nanoid(), claimId: id })));
  if (issue.status === "open" || issue.status === "investigating") await db.update(customerIssue).set({ status: "claim_raised" }).where(eq(customerIssue.id, issue.id));
  await logEvent(ctx, issue.id, "claim", `Claim ${claimNo} raised against ${s.name}${d.deadline ? `; the supplier's terms give until ${d.deadline}` : "; no deadline (no terms recorded)"}`, id);
  return ok({ id, claimNo });
}

// a draft claim follows the issue: new dates or a new supplier received date change its deadline (unless someone set it by hand)
async function refreshDraftClaims(ctx: Ctx, issueId: string) {
  const issue = await loadIssue(ctx, issueId);
  if (!issue) return;
  const drafts = await db.select().from(supplierClaim).where(and(eq(supplierClaim.issueId, issueId), eq(supplierClaim.status, "draft"), eq(supplierClaim.deadlineOverridden, false)));
  for (const c of drafts) {
    const items = await db.select({ i: customerIssueItem }).from(supplierClaimItem).innerJoin(customerIssueItem, eq(customerIssueItem.id, supplierClaimItem.issueItemId)).where(eq(supplierClaimItem.claimId, c.id));
    // the issue's CURRENT kind of problem decides which of the supplier's terms applies
    const d = await deadlineFor(ctx.orgId, c.supplierId, issue.situation, issue, items.map((x) => x.i));
    await db.update(supplierClaim).set({ basis: d.basis, basisDate: d.basisDate, windowDays: d.windowDays, deadlineDate: d.deadline, situation: issue.situation }).where(eq(supplierClaim.id, c.id));
  }
}

// works the deadline out again from the supplier's current terms (for example after the terms were changed)
export async function recalculateDeadline(ctx: Ctx, claimId: string): Promise<Result<{ deadline: string | null }>> {
  if (!can(ctx, "supplier-claim:manage")) return NO_ACCESS;
  const c = await loadClaim(ctx, claimId);
  if (!c) return fail("Claim not found.");
  if (c.status !== "draft") return fail("The deadline of a claim that was already sent cannot be changed.");
  const issue = await loadIssue(ctx, c.issueId);
  if (!issue) return fail("Issue not found.");
  const items = await db.select({ i: customerIssueItem }).from(supplierClaimItem).innerJoin(customerIssueItem, eq(customerIssueItem.id, supplierClaimItem.issueItemId)).where(eq(supplierClaimItem.claimId, c.id));
  const d = await deadlineFor(ctx.orgId, c.supplierId, issue.situation, issue, items.map((x) => x.i));
  await db.update(supplierClaim).set({ basis: d.basis, basisDate: d.basisDate, windowDays: d.windowDays, deadlineDate: d.deadline, deadlineOverridden: false, deadlineNote: null, situation: issue.situation }).where(eq(supplierClaim.id, claimId));
  await logEvent(ctx, c.issueId, "deadline", `Deadline worked out again from the supplier's terms: ${d.deadline ?? "none"}`, claimId);
  return ok({ deadline: d.deadline });
}

export type ClaimUpdate = { requestedOutcome?: string; supplierRef?: string | null; followUpDate?: string | null; deadline?: { date: string | null; note: string }; items?: { issueItemId: string; qtyClaimed: string | number }[] };

export async function updateClaim(ctx: Ctx, claimId: string, patch: ClaimUpdate): Promise<Result> {
  if (!can(ctx, "supplier-claim:manage")) return NO_ACCESS;
  const c = await loadClaim(ctx, claimId);
  if (!c) return fail("Claim not found.");
  if (c.status === "closed" || c.status === "withdrawn") return fail("This claim is finished and cannot be changed.");
  const set: Partial<typeof supplierClaim.$inferInsert> = {};
  const notes: string[] = [];
  if (patch.supplierRef !== undefined) { set.supplierRef = clean(patch.supplierRef); notes.push(`supplier reference ${set.supplierRef ?? "cleared"}`); }
  if (patch.requestedOutcome !== undefined) {
    if (!isRequest(patch.requestedOutcome)) return fail("Choose what you are asking the supplier for: replacement, credit note, repair or refund.");
    set.requestedOutcome = patch.requestedOutcome; notes.push(`asking for ${patch.requestedOutcome}`);
  }
  if (patch.followUpDate !== undefined) {
    if (patch.followUpDate && !isDay(patch.followUpDate)) return fail("The follow-up date is not a valid date.");
    set.followUpDate = patch.followUpDate || null; set.followUpNotified = null; notes.push(`follow-up ${set.followUpDate ?? "cleared"}`);
  }
  if (patch.deadline) {
    if (c.status !== "draft") return fail("The deadline of a claim that was already sent cannot be changed.");
    const note = clean(patch.deadline.note);
    if (!note) return fail("Say why the deadline is being changed by hand (for example: the supplier agreed to extend it).");
    if (patch.deadline.date && !isDay(patch.deadline.date)) return fail("The deadline is not a valid date.");
    set.deadlineDate = patch.deadline.date || null; set.deadlineOverridden = true; set.deadlineNote = note;
    notes.push(`deadline set by hand to ${set.deadlineDate ?? "none"} (${note})`);
  }
  if (patch.items) {
    if (c.status !== "draft") return fail("The items of a claim that was already sent cannot be changed.");
    if (patch.items.length === 0) return fail("A claim needs at least one item.");
    const ids = patch.items.map((i) => i.issueItemId);
    const rows = await db.select().from(customerIssueItem).where(and(eq(customerIssueItem.issueId, c.issueId), inArray(customerIssueItem.id, ids)));
    if (rows.length !== ids.length) return fail("An item does not belong to this issue.");
    const taken = await db.select({ claimNo: supplierClaim.claimNo }).from(supplierClaimItem).innerJoin(supplierClaim, eq(supplierClaim.id, supplierClaimItem.claimId)).where(and(inArray(supplierClaimItem.issueItemId, ids), inArray(supplierClaim.status, CLAIM_LIVE), ne(supplierClaim.id, claimId)));
    if (taken.length > 0) return fail(`An item is already in claim ${taken[0].claimNo}.`);
    const lines = [];
    for (const i of patch.items) {
      const row = rows.find((r) => r.id === i.issueItemId)!;
      if (row.supplierId !== c.supplierId) return fail(`${row.productCode ?? "An item"} is not an item of ${c.supplierName}.`);
      const qty = num(i.qtyClaimed);
      if (!(qty > 0) || qty > Number(row.qtyAffected) + 1e-9) return fail(`${row.productCode ?? "Item"}: claim between 1 and ${row.qtyAffected}.`);
      lines.push({ id: nanoid(), claimId, issueItemId: row.id, qtyClaimed: String(qty) });
    }
    await db.delete(supplierClaimItem).where(eq(supplierClaimItem.claimId, claimId));
    await db.insert(supplierClaimItem).values(lines);
    notes.push("items changed");
  }
  if (Object.keys(set).length > 0) await db.update(supplierClaim).set(set).where(eq(supplierClaim.id, claimId));
  if (patch.items && !patch.deadline) await recalculateIfAuto(ctx, claimId);
  if (notes.length > 0) await logEvent(ctx, c.issueId, "claim", `Claim ${c.claimNo}: ${notes.join("; ")}`, claimId);
  return ok(undefined);
}
async function recalculateIfAuto(ctx: Ctx, claimId: string) {
  const c = await loadClaim(ctx, claimId);
  if (c && c.status === "draft" && !c.deadlineOverridden) await recalculateDeadline(ctx, claimId);
}

export async function sendClaim(ctx: Ctx, claimId: string, input: { sentAt?: string; via: string; supplierRef?: string; followUpDate?: string | null; allowLate?: boolean }): Promise<Result> {
  if (!can(ctx, "supplier-claim:manage")) return NO_ACCESS;
  const c = await loadClaim(ctx, claimId);
  if (!c) return fail("Claim not found.");
  if (c.status !== "draft") return fail("Only a draft claim can be sent.");
  if (!isSentVia(input.via)) return fail("Say how the claim was sent.");
  const sentDay = input.sentAt || todayKL();
  if (!isDay(sentDay)) return fail("The date sent is not a valid date.");
  if (sentDay > todayKL()) return fail("The date sent cannot be in the future.");
  const itemCount = await db.select({ id: supplierClaimItem.id }).from(supplierClaimItem).where(eq(supplierClaimItem.claimId, claimId));
  if (itemCount.length === 0) return fail("The claim has no items.");
  const late = !!c.deadlineDate && sentDay > c.deadlineDate;
  if (late && !input.allowLate) return fail(`The supplier's deadline was ${c.deadlineDate}. Tick "send anyway" to record it as a late claim, or change the deadline if the supplier agreed to extend it.`);
  if (input.followUpDate && !isDay(input.followUpDate)) return fail("The follow-up date is not a valid date.");
  const followUp = input.followUpDate === undefined ? addDays(sentDay, 7) : input.followUpDate || null;
  const sentAt = sentDay === todayKL() ? new Date() : new Date(`${sentDay}T12:00:00+08:00`);
  await db.update(supplierClaim).set({ status: "sent", sentAt, sentBy: ctx.userId, sentVia: input.via, sentLate: late, supplierRef: clean(input.supplierRef) ?? c.supplierRef, followUpDate: followUp, followUpNotified: null }).where(eq(supplierClaim.id, claimId));
  await logEvent(ctx, c.issueId, "claim", `Claim ${c.claimNo} sent to ${c.supplierName} on ${sentDay} by ${input.via}${late ? " (after the supplier's deadline)" : ""}`, claimId);
  return ok(undefined);
}

export type ResponseInput = {
  result: "accepted" | "partial" | "rejected"; outcome?: string; outcomeNotes?: string; response?: string; respondedAt?: string;
  items?: { issueItemId: string; qtyAccepted: string | number }[]; creditAmount?: string | number | null; creditCurrency?: string;
};

export async function recordResponse(ctx: Ctx, claimId: string, input: ResponseInput): Promise<Result> {
  if (!can(ctx, "supplier-claim:manage")) return NO_ACCESS;
  const c = await loadClaim(ctx, claimId);
  if (!c) return fail("Claim not found.");
  if (c.status !== "sent") return fail("A response can be recorded once the claim has been sent.");
  const lines = await db.select().from(supplierClaimItem).where(eq(supplierClaimItem.claimId, claimId));
  const respondedDay = input.respondedAt || todayKL();
  if (!isDay(respondedDay) || respondedDay > todayKL()) return fail("The date of the supplier's answer is not valid.");
  let outcome: ClaimOutcome;
  const accepted = new Map<string, number>();
  if (input.result === "rejected") {
    outcome = "rejected";
    for (const l of lines) accepted.set(l.id, 0);
  } else {
    if (!isClaimOutcome(input.outcome) || input.outcome === "rejected") return fail("Choose what the supplier is giving: replacement, credit note, repair, refund or goodwill.");
    outcome = input.outcome;
    for (const l of lines) {
      const given = input.items?.find((i) => i.issueItemId === l.issueItemId);
      const qty = given ? num(given.qtyAccepted) : Number(l.qtyClaimed);
      if (!(qty >= 0) || qty > Number(l.qtyClaimed) + 1e-9) return fail(`Accepted quantity must be between 0 and ${l.qtyClaimed}.`);
      accepted.set(l.id, qty);
    }
    const all = lines.every((l) => (accepted.get(l.id) ?? 0) >= Number(l.qtyClaimed) - 1e-9);
    const none = lines.every((l) => (accepted.get(l.id) ?? 0) === 0);
    if (input.result === "accepted" && !all) return fail("Some quantities are less than claimed. Record it as partly accepted.");
    if (input.result === "partial" && (all || none)) return fail(all ? "Everything was accepted. Record it as accepted." : "Nothing was accepted. Record it as rejected.");
  }
  const credit = input.creditAmount == null || input.creditAmount === "" ? null : num(input.creditAmount);
  if (credit != null && (!Number.isFinite(credit) || credit < 0)) return fail("The credit amount is not valid.");
  for (const l of lines) await db.update(supplierClaimItem).set({ qtyAccepted: String(accepted.get(l.id) ?? 0) }).where(eq(supplierClaimItem.id, l.id));
  const respondedAt = respondedDay === todayKL() ? new Date() : new Date(`${respondedDay}T12:00:00+08:00`);
  await db.update(supplierClaim).set({
    status: input.result, outcome, outcomeNotes: clean(input.outcomeNotes), supplierResponse: clean(input.response), respondedAt,
    creditAmount: credit == null ? null : String(credit), creditCurrency: clean(input.creditCurrency), followUpDate: null,
  }).where(eq(supplierClaim.id, claimId));
  await logEvent(ctx, c.issueId, "claim", `${c.supplierName} answered claim ${c.claimNo}: ${input.result === "accepted" ? "accepted" : input.result === "partial" ? "partly accepted" : "rejected"} (${outcome})${clean(input.response) ? ` - ${clean(input.response)}` : ""}`, claimId);
  const issue = await loadIssue(ctx, c.issueId);
  await notifyUser(ctx.orgId, issue?.createdBy, { title: `Supplier answered: ${c.claimNo}`, body: `${c.supplierName} ${input.result === "rejected" ? "rejected" : "accepted"} the claim for ${issue?.issueNo ?? "the issue"}.`, link: `${CLAIM_LINK}/${claimId}` });
  return ok(undefined);
}

export async function closeClaim(ctx: Ctx, claimId: string, note?: string): Promise<Result> {
  if (!can(ctx, "supplier-claim:manage")) return NO_ACCESS;
  const c = await loadClaim(ctx, claimId);
  if (!c) return fail("Claim not found.");
  if (!(["accepted", "partial", "rejected"] as ClaimStatus[]).includes(c.status as ClaimStatus)) return fail("Record the supplier's answer before closing the claim.");
  await db.update(supplierClaim).set({ status: "closed", closedAt: new Date() }).where(eq(supplierClaim.id, claimId));
  await logEvent(ctx, c.issueId, "claim", `Claim ${c.claimNo} closed${clean(note) ? `: ${clean(note)}` : ""}`, claimId);
  return ok(undefined);
}

export async function withdrawClaim(ctx: Ctx, claimId: string, reason: string): Promise<Result> {
  if (!can(ctx, "supplier-claim:manage")) return NO_ACCESS;
  const c = await loadClaim(ctx, claimId);
  if (!c) return fail("Claim not found.");
  if (c.status !== "draft" && c.status !== "sent") return fail("Only a draft or sent claim can be withdrawn.");
  const why = clean(reason);
  if (!why) return fail("Say why the claim is withdrawn.");
  await db.update(supplierClaim).set({ status: "withdrawn", withdrawnReason: why, followUpDate: null }).where(eq(supplierClaim.id, claimId));
  const live = await liveClaimsOf(c.issueId);
  const issue = await loadIssue(ctx, c.issueId);
  if (live.length === 0 && issue?.status === "claim_raised") await db.update(customerIssue).set({ status: "investigating" }).where(eq(customerIssue.id, c.issueId));
  await logEvent(ctx, c.issueId, "claim", `Claim ${c.claimNo} withdrawn: ${why}`, claimId);
  return ok(undefined);
}

// A rejected claim can be sent again (for example with better evidence or after talking to the supplier)
export async function resubmitClaim(ctx: Ctx, claimId: string, input: { via: string; note?: string }): Promise<Result> {
  if (!can(ctx, "supplier-claim:manage")) return NO_ACCESS;
  const c = await loadClaim(ctx, claimId);
  if (!c) return fail("Claim not found.");
  if (c.status !== "rejected") return fail("Only a rejected claim can be sent again.");
  if (!isSentVia(input.via)) return fail("Say how the claim was sent.");
  await db.update(supplierClaim).set({
    status: "sent", sentAt: new Date(), sentBy: ctx.userId, sentVia: input.via as SentVia, followUpDate: addDays(todayKL(), 7), followUpNotified: null,
    respondedAt: null, supplierResponse: null, outcome: null, outcomeNotes: null,
  }).where(eq(supplierClaim.id, claimId));
  await db.update(supplierClaimItem).set({ qtyAccepted: null }).where(eq(supplierClaimItem.claimId, claimId));
  await logEvent(ctx, c.issueId, "claim", `Claim ${c.claimNo} sent again after the supplier rejected it${clean(input.note) ? `: ${clean(input.note)}` : ""}. Earlier answer: ${c.supplierResponse ?? "none recorded"}`, claimId);
  return ok(undefined);
}

export type ClaimListRow = {
  id: string; claimNo: string; issueId: string; issueNo: string; supplierName: string; situation: string; status: ClaimStatus; deadlineDate: string | null; daysLeft: number | null;
  clockState: string; sentAt: Date | null; sentLate: boolean; followUpDate: string | null; followUpDue: boolean; outcome: string | null; itemCount: number; needsAction: boolean;
};

export async function listClaims(ctx: Ctx, opts: { tab?: "action" | "waiting" | "done" | "all"; q?: string } = {}): Promise<ClaimListRow[]> {
  if (!can(ctx, "supplier-claim:read")) return [];
  const rows = await db.select({ c: supplierClaim, issueNo: customerIssue.issueNo }).from(supplierClaim)
    .innerJoin(customerIssue, eq(customerIssue.id, supplierClaim.issueId)).where(eq(supplierClaim.organizationId, ctx.orgId)).orderBy(desc(supplierClaim.createdAt));
  const items = rows.length ? await db.select({ claimId: supplierClaimItem.claimId }).from(supplierClaimItem).where(inArray(supplierClaimItem.claimId, rows.map((r) => r.c.id))) : [];
  const today = todayKL();
  const q = opts.q?.trim().toLowerCase();
  const mapped = rows.map(({ c, issueNo }): ClaimListRow => {
    const clock = clockOf(c.deadlineDate, today);
    const followUpDue = c.status === "sent" && !!c.followUpDate && c.followUpDate <= today;
    // needs a person today: a draft that is not sent yet, a rejected claim to decide on, an answer to close, or a follow-up that is due
    const needsAction = c.status === "draft" || c.status === "rejected" || c.status === "accepted" || c.status === "partial" || followUpDue;
    return {
      id: c.id, claimNo: c.claimNo, issueId: c.issueId, issueNo, supplierName: c.supplierName, situation: c.situation, status: c.status as ClaimStatus, deadlineDate: c.deadlineDate,
      daysLeft: c.status === "draft" ? clock.daysLeft : null, clockState: c.status === "draft" ? clock.state : "none", sentAt: c.sentAt, sentLate: c.sentLate, followUpDate: c.followUpDate,
      followUpDue, outcome: c.outcome, itemCount: items.filter((i) => i.claimId === c.id).length, needsAction,
    };
  });
  const tab = opts.tab ?? "action";
  return mapped
    .filter((r) => (tab === "all" ? true : tab === "action" ? r.needsAction : tab === "waiting" ? r.status === "sent" : r.status === "closed" || r.status === "withdrawn"))
    .filter((r) => !q || [r.claimNo, r.issueNo, r.supplierName, situationLabel(r.situation)].some((v) => v.toLowerCase().includes(q)))
    // soonest deadline first inside a tab, claims without one last
    .sort((a, b) => (a.deadlineDate ?? "9999").localeCompare(b.deadlineDate ?? "9999"));
}

export async function getClaim(ctx: Ctx, id: string) {
  if (!can(ctx, "supplier-claim:read")) return null;
  const claim = await loadClaim(ctx, id);
  if (!claim) return null;
  const issue = await loadIssue(ctx, claim.issueId);
  if (!issue) return null;
  const [lines, events, terms, media, [org]] = await Promise.all([
    db.select({ l: supplierClaimItem, i: customerIssueItem }).from(supplierClaimItem).innerJoin(customerIssueItem, eq(customerIssueItem.id, supplierClaimItem.issueItemId)).where(eq(supplierClaimItem.claimId, id)).orderBy(asc(customerIssueItem.rowNo)),
    db.select().from(postDeliveryEvent).where(and(eq(postDeliveryEvent.issueId, claim.issueId), eq(postDeliveryEvent.claimId, id))).orderBy(desc(postDeliveryEvent.createdAt)),
    termsOf(ctx.orgId, claim.supplierId),
    db.select().from(customerIssueMedia).where(eq(customerIssueMedia.issueId, claim.issueId)).orderBy(asc(customerIssueMedia.createdAt)),
    db.select({ name: organization.name }).from(organization).where(eq(organization.id, ctx.orgId)),
  ]);
  const [sup] = await db.select({ id: supplier.id, name: supplier.name, email: supplier.email, contactPerson: supplier.contactPerson, contactNo: supplier.contactNo }).from(supplier).where(eq(supplier.id, claim.supplierId));
  const actors = [...new Set(events.map((e) => e.actorId).filter((v): v is string => !!v))];
  const users = actors.length ? await db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, actors)) : [];
  const today = todayKL();
  const itemIds = new Set(lines.map((x) => x.i.id));
  return {
    ...claim, status: claim.status as ClaimStatus, clock: claim.status === "draft" ? clockOf(claim.deadlineDate, today) : clockOf(null, today), companyName: org?.name ?? "",
    issue: { id: issue.id, issueNo: issue.issueNo, status: issue.status as IssueStatus, customerName: issue.customerName, deliveryOrderNo: issue.deliveryOrderNo, deliveredAt: issue.deliveredAt, reportedAt: issue.reportedAt, situation: issue.situation, summary: issue.summary, description: issue.description, safetyRelated: issue.safetyRelated },
    supplier: sup ?? null,
    term: pickTerm(terms, claim.situation),
    canManage: can(ctx, "supplier-claim:manage"),
    items: lines.map((x) => ({ id: x.l.id, issueItemId: x.i.id, qtyClaimed: x.l.qtyClaimed, qtyAccepted: x.l.qtyAccepted, productCode: x.i.productCode, description: x.i.description, uom: x.i.uom, lotNo: x.i.lotNo, serialNo: x.i.serialNo, poNo: x.i.poNo, grNo: x.i.grNo, supplierDocRef: x.i.supplierDocRef, receivedAt: x.i.receivedAt, qtyAffected: x.i.qtyAffected, unitCost: x.i.unitCost, currency: x.i.currency })),
    // evidence of the items in this claim, plus what was attached to the issue as a whole
    media: media.filter((m) => !m.itemId || itemIds.has(m.itemId)),
    events: events.map((e) => ({ ...e, actorName: users.find((u) => u.id === e.actorId)?.name ?? null })),
  };
}
export type ClaimDetail = NonNullable<Awaited<ReturnType<typeof getClaim>>>;

// ═══════════════════════ reminders ═══════════════════════
// There is no background job: this runs when someone opens the claims page, and tells each handler once per level.
//   a draft claim whose deadline is within a week (level 1) or within 2 days / past (level 2)
//   a sent claim whose follow-up date has come
export async function runReminders(ctx: Ctx): Promise<number> {
  if (!can(ctx, "supplier-claim:read")) return 0;
  const today = todayKL();
  let sent = 0;
  const live = await db.select({ c: supplierClaim, issueNo: customerIssue.issueNo }).from(supplierClaim).innerJoin(customerIssue, eq(customerIssue.id, supplierClaim.issueId))
    .where(and(eq(supplierClaim.organizationId, ctx.orgId), inArray(supplierClaim.status, ["draft", "sent"])));
  for (const { c, issueNo } of live) {
    if (c.status === "draft") {
      const level = reminderLevel(clockOf(c.deadlineDate, today));
      if (level > c.remindedLevel) {
        const clock = clockOf(c.deadlineDate, today);
        await db.update(supplierClaim).set({ remindedLevel: level }).where(eq(supplierClaim.id, c.id));
        await notifyHandlers(ctx.orgId, {
          title: clock.state === "late" ? `Claim deadline passed: ${c.claimNo}` : `Claim deadline close: ${c.claimNo}`,
          body: `${c.supplierName}, ${issueNo}: ${clock.state === "late" ? `the deadline (${c.deadlineDate}) has passed` : `send it by ${c.deadlineDate}`}. The claim is still a draft.`,
          link: `${CLAIM_LINK}/${c.id}`,
        });
        sent++;
      }
    } else if (c.followUpDate && c.followUpDate <= today && c.followUpNotified !== today) {
      await db.update(supplierClaim).set({ followUpNotified: today }).where(eq(supplierClaim.id, c.id));
      await notifyHandlers(ctx.orgId, { title: `Follow up: ${c.claimNo}`, body: `${c.supplierName} has not answered claim ${c.claimNo} (${issueNo}). Chase them.`, link: `${CLAIM_LINK}/${c.id}` });
      sent++;
    }
  }
  return sent;
}
