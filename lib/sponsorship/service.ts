// Sponsorship service: all the rules, with the caller passed in so it can be tested without a login.
import { db } from "@/db";
import { sponsorship, sponsorshipItem, sponsorshipDocument, user, notification, userPermission, member } from "@/db/schema";
import { and, asc, desc, eq, inArray, like, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import { hasAccess } from "@/lib/permissions/has-access";
import { assertSelfActionAllowed } from "@/lib/approvals/guard";
import { isSelfActionAllowed } from "@/server/approval-settings";
import { isEditable, isOpen, money, sponsorshipNo, sumAmounts, type SponsorshipStatus } from "@/lib/sponsorship/core";

export type Ctx = { orgId: string; userId: string; perms: string[] };
export type Result<T = void> = { ok: true; value: T } | { ok: false; error: string };
const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = (error: string): Result<never> => ({ ok: false, error });
const can = (ctx: Ctx, key: string) => hasAccess(ctx.perms, key);
const NO_ACCESS = fail("You don't have permission to do this.");
const LINK = "/dashboard/sponsorship";

// ── notifications ───────────────────────────────────────────────────────────
async function notifyUser(orgId: string, userId: string, n: { title: string; body: string; link: string }) {
  await db.insert(notification).values({ id: nanoid(), organizationId: orgId, userId, type: "sponsorship", ...n, isRead: 0, createdAt: new Date() });
}
// everyone who holds a permission: granted explicitly, or the owner(s) who hold all of them
async function holders(orgId: string, key: string): Promise<string[]> {
  const [owners, granted] = await Promise.all([
    db.select({ userId: member.userId }).from(member).where(and(eq(member.organizationId, orgId), eq(member.role, "owner"), isNull(member.deletedAt))),
    db.select({ userId: userPermission.userId }).from(userPermission).where(and(eq(userPermission.organizationId, orgId), eq(userPermission.permissionKey, key), eq(userPermission.allowed, true))),
  ]);
  return [...new Set([...owners, ...granted].map((r) => r.userId))];
}
async function notifyHolders(orgId: string, key: string, n: { title: string; body: string; link: string }, except?: string) {
  for (const id of await holders(orgId, key)) if (id !== except) await notifyUser(orgId, id, n);
}

// ── input ───────────────────────────────────────────────────────────────────
export type SponsorshipInput = {
  id?: string;
  recipientType: string;
  recipientName: string;
  recipientOrganization?: string;
  isHcp: boolean;
  isGovernment: boolean;
  institutionApproved: boolean;
  title: string;
  purpose: string;
  eventDateFrom?: string;
  eventDateTo?: string;
  venue?: string;
  declarationAccepted: boolean;
  items: { category: string; description: string; amount: string | number }[];
};

function validateForSubmit(i: SponsorshipInput): string | null {
  if (!i.recipientName?.trim()) return "Enter who is being sponsored.";
  if (!i.title?.trim()) return "Enter the event or purpose title.";
  if (!i.purpose?.trim()) return "Explain the purpose and why the company is sponsoring it.";
  if (!i.eventDateFrom) return "Enter the date of the event.";
  if (i.eventDateTo && i.eventDateTo < i.eventDateFrom) return "The event cannot end before it starts.";
  const items = i.items.filter((x) => money(x.amount) > 0 || x.description?.trim());
  if (items.length === 0) return "Add at least one item with an amount.";
  const bad = items.findIndex((x) => !(money(x.amount) > 0));
  if (bad >= 0) return `Item ${bad + 1} needs an amount greater than 0.`;
  const noDesc = items.findIndex((x) => !x.description?.trim());
  if (noDesc >= 0) return `Describe item ${noDesc + 1}.`;
  if (i.isGovernment && !i.institutionApproved) return "A government institution's staff can only be sponsored with the institution's permission. Confirm you have it, or do not submit.";
  if (!i.declarationAccepted) return "Tick the declaration before submitting.";
  return null;
}

async function nextNo(orgId: string): Promise<string> {
  const year = new Date().getFullYear();
  const rows = await db.select({ no: sponsorship.sponsorshipNo }).from(sponsorship).where(and(eq(sponsorship.organizationId, orgId), like(sponsorship.sponsorshipNo, `SP-${year}-%`)));
  let max = 0;
  for (const { no } of rows) { const n = parseInt(no.split("-").pop() ?? "", 10); if (!Number.isNaN(n)) max = Math.max(max, n); }
  return sponsorshipNo(year, max + 1);
}

// Saves a draft, or submits (checks everything, then waits for the checker). Editing is for the requester, while it is a draft or was rejected.
export async function saveSponsorship(ctx: Ctx, input: SponsorshipInput, submit: boolean): Promise<Result<{ id: string; status: SponsorshipStatus }>> {
  if (!can(ctx, "sponsorship:read:own")) return NO_ACCESS;
  if (submit) { const bad = validateForSubmit(input); if (bad) return fail(bad); }
  const items = input.items.filter((x) => money(x.amount) > 0 || x.description?.trim());
  const total = sumAmounts(items);
  const base = {
    recipientType: input.recipientType || "other", recipientName: input.recipientName?.trim() ?? "", recipientOrganization: input.recipientOrganization?.trim() || null,
    isHcp: !!input.isHcp, isGovernment: !!input.isGovernment, institutionApproved: !!input.isGovernment && !!input.institutionApproved,
    title: input.title?.trim() ?? "", purpose: input.purpose?.trim() ?? "", eventDateFrom: input.eventDateFrom || null, eventDateTo: input.eventDateTo || null,
    venue: input.venue?.trim() || null, totalRequested: String(total), declarationAccepted: !!input.declarationAccepted,
  };

  let id = input.id;
  let status: SponsorshipStatus = submit ? "PENDING" : "DRAFT";
  if (id) {
    const [s] = await db.select().from(sponsorship).where(and(eq(sponsorship.id, id), eq(sponsorship.organizationId, ctx.orgId)));
    if (!s || s.requestedBy !== ctx.userId) return fail("Sponsorship not found.");
    if (!isEditable(s.status as SponsorshipStatus)) return fail("This request has been submitted and can no longer be edited.");
    await db.update(sponsorship).set({ ...base, status, ...(submit ? { rejectedBy: null, rejectedAt: null, rejectReason: null } : {}) }).where(eq(sponsorship.id, id));
    await db.delete(sponsorshipItem).where(eq(sponsorshipItem.sponsorshipId, id));
  } else {
    id = nanoid();
    await db.insert(sponsorship).values({ id, organizationId: ctx.orgId, sponsorshipNo: await nextNo(ctx.orgId), requestedBy: ctx.userId, status, ...base });
  }
  if (items.length > 0) await db.insert(sponsorshipItem).values(items.map((x, n) => ({ id: nanoid(), sponsorshipId: id!, category: x.category || "other", description: x.description?.trim() ?? "", amount: String(money(x.amount)), sortOrder: n })));

  if (submit) {
    const [me] = await db.select({ name: user.name }).from(user).where(eq(user.id, ctx.userId));
    const body = { title: `Sponsorship request: ${base.title}`, body: `${me?.name ?? "A colleague"} requests RM ${total.toFixed(2)} for ${base.recipientName}.`, link: `${LINK}/${id}` };
    const checkers = (await holders(ctx.orgId, "sponsorship:check")).filter((u) => u !== ctx.userId);
    if (checkers.length > 0) for (const u of checkers) await notifyUser(ctx.orgId, u, body);
    else await notifyHolders(ctx.orgId, "sponsorship:approve", body, ctx.userId);
  }
  return ok({ id, status });
}

// ── reading ─────────────────────────────────────────────────────────────────
type Row = typeof sponsorship.$inferSelect;
async function names(ids: (string | null)[]) {
  const list = [...new Set(ids.filter((v): v is string => !!v))];
  const rows = list.length ? await db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, list)) : [];
  return (id: string | null) => rows.find((r) => r.id === id)?.name ?? null;
}

async function rowsToList(rows: Row[]) {
  const nameOf = await names(rows.map((r) => r.requestedBy));
  return rows.map((r) => ({
    id: r.id, sponsorshipNo: r.sponsorshipNo, status: r.status as SponsorshipStatus, title: r.title, recipientName: r.recipientName, recipientType: r.recipientType,
    requestedByName: nameOf(r.requestedBy) ?? "—", eventDateFrom: r.eventDateFrom, totalRequested: r.totalRequested, approvedAmount: r.approvedAmount,
    actualAmount: r.actualAmount, paidAt: r.paidAt, createdAt: r.createdAt,
  }));
}
export type SponsorshipListRow = Awaited<ReturnType<typeof rowsToList>>[number];

export async function listMine(ctx: Ctx) {
  if (!can(ctx, "sponsorship:read:own")) return [];
  return rowsToList(await db.select().from(sponsorship).where(and(eq(sponsorship.organizationId, ctx.orgId), eq(sponsorship.requestedBy, ctx.userId))).orderBy(desc(sponsorship.createdAt)));
}
export async function listToCheck(ctx: Ctx) {
  if (!can(ctx, "sponsorship:check")) return [];
  return rowsToList(await db.select().from(sponsorship).where(and(eq(sponsorship.organizationId, ctx.orgId), eq(sponsorship.status, "PENDING"))).orderBy(asc(sponsorship.createdAt)));
}
export async function listToApprove(ctx: Ctx) {
  if (!can(ctx, "sponsorship:approve")) return [];
  return rowsToList(await db.select().from(sponsorship).where(and(eq(sponsorship.organizationId, ctx.orgId), inArray(sponsorship.status, ["CHECKED", "PENDING"]))).orderBy(asc(sponsorship.createdAt)));
}
export async function listAll(ctx: Ctx) {
  if (!can(ctx, "sponsorship:manage")) return [];
  return rowsToList(await db.select().from(sponsorship).where(and(eq(sponsorship.organizationId, ctx.orgId), inArray(sponsorship.status, ["PENDING", "CHECKED", "APPROVED", "REJECTED", "CANCELLED", "CLOSED"]))).orderBy(desc(sponsorship.createdAt)));
}

export type SponsorshipDetail = Awaited<ReturnType<typeof getSponsorship>>;

export async function getSponsorship(ctx: Ctx, id: string) {
  const [s] = await db.select().from(sponsorship).where(and(eq(sponsorship.id, id), eq(sponsorship.organizationId, ctx.orgId)));
  if (!s) return null;
  const mine = s.requestedBy === ctx.userId;
  const staff = can(ctx, "sponsorship:check") || can(ctx, "sponsorship:approve") || can(ctx, "sponsorship:manage");
  if (!(mine && can(ctx, "sponsorship:read:own")) && !(staff && s.status !== "DRAFT")) return null;
  const [items, docs] = await Promise.all([
    db.select().from(sponsorshipItem).where(eq(sponsorshipItem.sponsorshipId, id)).orderBy(asc(sponsorshipItem.sortOrder)),
    db.select().from(sponsorshipDocument).where(eq(sponsorshipDocument.sponsorshipId, id)).orderBy(asc(sponsorshipDocument.uploadedAt)),
  ]);
  const nameOf = await names([s.requestedBy, s.checkedBy, s.approvedBy, s.rejectedBy, s.cancelledBy, s.paidBy, s.closedBy, ...docs.map((d) => d.uploadedBy)]);
  const status = s.status as SponsorshipStatus;
  const open = isOpen(status);
  // acting on your own request follows the organization's approval settings (off by default)
  const selfCheck = !mine || (await isSelfActionAllowed(ctx.orgId, "sponsorship:check"));
  const selfApprove = !mine || (await isSelfActionAllowed(ctx.orgId, "sponsorship:approve"));
  return {
    ...s, status, items, requestedByName: nameOf(s.requestedBy), checkedByName: nameOf(s.checkedBy), approvedByName: nameOf(s.approvedBy), rejectedByName: nameOf(s.rejectedBy),
    cancelledByName: nameOf(s.cancelledBy), paidByName: nameOf(s.paidBy), closedByName: nameOf(s.closedBy),
    documents: docs.map((d) => ({ ...d, uploadedByName: nameOf(d.uploadedBy) })),
    isMine: mine,
    can: {
      edit: mine && isEditable(status),
      cancel: (mine && (status === "DRAFT" || status === "REJECTED" || open)) || (can(ctx, "sponsorship:manage") && (open || (status === "APPROVED" && !s.actualAmount && !s.paidAt))),
      check: can(ctx, "sponsorship:check") && status === "PENDING" && selfCheck,
      approve: can(ctx, "sponsorship:approve") && (status === "CHECKED" || status === "PENDING") && selfApprove,
      reject: (can(ctx, "sponsorship:check") && status === "PENDING" && selfCheck) || (can(ctx, "sponsorship:approve") && open && selfApprove),
      record: can(ctx, "sponsorship:manage") && status === "APPROVED",
      addDocument: (mine || can(ctx, "sponsorship:manage")) && status !== "CANCELLED" && status !== "CLOSED",
    },
  };
}

// ── workflow ────────────────────────────────────────────────────────────────
async function load(ctx: Ctx, id: string) {
  const [s] = await db.select().from(sponsorship).where(and(eq(sponsorship.id, id), eq(sponsorship.organizationId, ctx.orgId)));
  return s ?? null;
}
const guard = async (ctx: Ctx, key: string, s: Row, label: string): Promise<string | null> => {
  try { await assertSelfActionAllowed(ctx.orgId, key, s.requestedBy, ctx.userId, label); return null; } catch (e: any) { return e.message; }
};

export async function checkSponsorship(ctx: Ctx, id: string, comment?: string): Promise<Result> {
  if (!can(ctx, "sponsorship:check")) return NO_ACCESS;
  const s = await load(ctx, id); if (!s) return fail("Sponsorship not found.");
  if (s.status !== "PENDING") return fail("Only a request waiting for check can be checked.");
  const self = await guard(ctx, "sponsorship:check", s, "check"); if (self) return fail(self);
  await db.update(sponsorship).set({ status: "CHECKED", checkedBy: ctx.userId, checkedAt: new Date(), checkComment: comment?.trim() || null }).where(eq(sponsorship.id, id));
  await notifyHolders(ctx.orgId, "sponsorship:approve", { title: `Sponsorship to approve: ${s.title}`, body: `${s.sponsorshipNo} (RM ${money(s.totalRequested).toFixed(2)}) was checked and needs approval.`, link: `${LINK}/${id}` }, ctx.userId);
  return ok(undefined);
}

export async function approveSponsorship(ctx: Ctx, id: string, input: { amount?: string | number; comment?: string }): Promise<Result> {
  if (!can(ctx, "sponsorship:approve")) return NO_ACCESS;
  const s = await load(ctx, id); if (!s) return fail("Sponsorship not found.");
  if (s.status !== "CHECKED" && s.status !== "PENDING") return fail("This request is not waiting for approval.");
  const self = await guard(ctx, "sponsorship:approve", s, "approve"); if (self) return fail(self);
  const requested = money(s.totalRequested);
  const amount = input.amount === undefined || input.amount === "" ? requested : money(input.amount);
  if (!(amount > 0)) return fail("The approved amount must be greater than 0.");
  if (amount > requested) return fail(`The approved amount cannot be more than the requested RM ${requested.toFixed(2)}.`);
  await db.update(sponsorship).set({ status: "APPROVED", approvedBy: ctx.userId, approvedAt: new Date(), approvedAmount: String(amount), approveComment: input.comment?.trim() || null }).where(eq(sponsorship.id, id));
  await notifyUser(ctx.orgId, s.requestedBy, { title: `Sponsorship approved: ${s.title}`, body: `${s.sponsorshipNo} was approved for RM ${amount.toFixed(2)}${amount < requested ? ` (you asked for RM ${requested.toFixed(2)})` : ""}.`, link: `${LINK}/${id}` });
  await notifyHolders(ctx.orgId, "sponsorship:manage", { title: `Approved sponsorship to arrange: ${s.title}`, body: `${s.sponsorshipNo}, RM ${amount.toFixed(2)}. Record the spend when it is paid.`, link: `${LINK}/${id}` }, ctx.userId);
  return ok(undefined);
}

export async function rejectSponsorship(ctx: Ctx, id: string, reason: string): Promise<Result> {
  const s = await load(ctx, id); if (!s) return fail("Sponsorship not found.");
  const allowed = (can(ctx, "sponsorship:check") && s.status === "PENDING") || (can(ctx, "sponsorship:approve") && (s.status === "PENDING" || s.status === "CHECKED"));
  if (!allowed) return NO_ACCESS;
  if (!reason?.trim()) return fail("Give the reason, so the requester knows what to change.");
  const self = await guard(ctx, s.status === "PENDING" && !can(ctx, "sponsorship:approve") ? "sponsorship:check" : "sponsorship:approve", s, "reject"); if (self) return fail(self);
  await db.update(sponsorship).set({ status: "REJECTED", rejectedBy: ctx.userId, rejectedAt: new Date(), rejectReason: reason.trim() }).where(eq(sponsorship.id, id));
  await notifyUser(ctx.orgId, s.requestedBy, { title: `Sponsorship rejected: ${s.title}`, body: `${s.sponsorshipNo}: ${reason.trim()} You can edit and submit it again.`, link: `${LINK}/${id}` });
  return ok(undefined);
}

export async function cancelSponsorship(ctx: Ctx, id: string, reason?: string): Promise<Result> {
  const d = await getSponsorship(ctx, id);
  if (!d) return fail("Sponsorship not found.");
  if (!d.can.cancel) return fail(d.status === "APPROVED" ? "Spend or payment was already recorded, so it cannot be cancelled. Close it instead." : "This request cannot be cancelled now.");
  await db.update(sponsorship).set({ status: "CANCELLED", cancelledBy: ctx.userId, cancelledAt: new Date(), cancelReason: reason?.trim() || null }).where(eq(sponsorship.id, id));
  if (!d.isMine) await notifyUser(ctx.orgId, d.requestedBy, { title: `Sponsorship cancelled: ${d.title}`, body: `${d.sponsorshipNo} was cancelled${reason?.trim() ? `: ${reason.trim()}` : ""}.`, link: `${LINK}/${id}` });
  return ok(undefined);
}

// ── spend, payment and closing ──────────────────────────────────────────────
export async function recordSpend(ctx: Ctx, id: string, input: { items: { id: string; actualAmount: string | number | null }[]; paymentRef?: string; paid: boolean }): Promise<Result> {
  if (!can(ctx, "sponsorship:manage")) return NO_ACCESS;
  const s = await load(ctx, id); if (!s) return fail("Sponsorship not found.");
  if (s.status !== "APPROVED") return fail("Spend can only be recorded on an approved sponsorship.");
  const rows = await db.select().from(sponsorshipItem).where(eq(sponsorshipItem.sponsorshipId, id));
  for (const i of input.items) {
    if (!rows.some((r) => r.id === i.id)) return fail("An item in the form does not exist any more. Reload the page.");
    if (i.actualAmount !== null && i.actualAmount !== "" && money(i.actualAmount) < 0) return fail("Amounts cannot be negative.");
  }
  for (const i of input.items) {
    const v = i.actualAmount === null || i.actualAmount === "" ? null : String(money(i.actualAmount));
    await db.update(sponsorshipItem).set({ actualAmount: v }).where(eq(sponsorshipItem.id, i.id));
  }
  const after = await db.select().from(sponsorshipItem).where(eq(sponsorshipItem.sponsorshipId, id));
  const any = after.some((r) => r.actualAmount !== null);
  const actual = any ? String(sumAmounts(after.map((r) => ({ amount: r.actualAmount })))) : null;
  if (input.paid && !any) return fail("Enter the amounts actually spent before marking it as paid.");
  await db.update(sponsorship).set({
    actualAmount: actual, paymentRef: input.paymentRef?.trim() || null,
    ...(input.paid ? (s.paidAt ? {} : { paidAt: new Date(), paidBy: ctx.userId }) : { paidAt: null, paidBy: null }),
  }).where(eq(sponsorship.id, id));
  return ok(undefined);
}

export async function closeSponsorship(ctx: Ctx, id: string, note?: string): Promise<Result> {
  if (!can(ctx, "sponsorship:manage")) return NO_ACCESS;
  const s = await load(ctx, id); if (!s) return fail("Sponsorship not found.");
  if (s.status !== "APPROVED") return fail("Only an approved sponsorship can be closed.");
  if (s.actualAmount == null) return fail("Record the amount actually spent before closing.");
  const over = money(s.actualAmount) > money(s.approvedAmount);
  if (over && (note?.trim().length ?? 0) < 3) return fail(`The spend (RM ${money(s.actualAmount).toFixed(2)}) is more than the approved RM ${money(s.approvedAmount).toFixed(2)}. Say why in the note.`);
  await db.update(sponsorship).set({ status: "CLOSED", closedBy: ctx.userId, closedAt: new Date(), closeNote: note?.trim() || null }).where(eq(sponsorship.id, id));
  return ok(undefined);
}

// ── documents (the file itself is stored by the server action; this keeps the record) ──
export async function addDocumentRecord(ctx: Ctx, id: string, doc: { kind: string; fileName: string; fileKey: string; fileSize: number; mimeType: string }): Promise<Result<string>> {
  const d = await getSponsorship(ctx, id);
  if (!d || !d.can.addDocument) return NO_ACCESS;
  const docId = nanoid();
  await db.insert(sponsorshipDocument).values({ id: docId, sponsorshipId: id, organizationId: ctx.orgId, kind: doc.kind || "other", fileName: doc.fileName, fileKey: doc.fileKey, fileSize: doc.fileSize, mimeType: doc.mimeType, uploadedBy: ctx.userId });
  return ok(docId);
}

export async function removeDocumentRecord(ctx: Ctx, docId: string): Promise<Result<string>> {
  const [doc] = await db.select().from(sponsorshipDocument).where(and(eq(sponsorshipDocument.id, docId), eq(sponsorshipDocument.organizationId, ctx.orgId)));
  if (!doc) return fail("Document not found.");
  const d = await getSponsorship(ctx, doc.sponsorshipId);
  if (!d || !d.can.addDocument) return NO_ACCESS;
  if (doc.uploadedBy !== ctx.userId && !can(ctx, "sponsorship:manage")) return NO_ACCESS;
  await db.delete(sponsorshipDocument).where(eq(sponsorshipDocument.id, docId));
  return ok(doc.fileKey);
}

export async function findDocument(ctx: Ctx, docId: string) {
  const [doc] = await db.select().from(sponsorshipDocument).where(and(eq(sponsorshipDocument.id, docId), eq(sponsorshipDocument.organizationId, ctx.orgId)));
  if (!doc) return null;
  const d = await getSponsorship(ctx, doc.sponsorshipId);
  return d ? doc : null;
}
