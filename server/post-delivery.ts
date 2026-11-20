"use server";

// Problems found after delivery and supplier claims. The rules are in lib/post-delivery/service.ts; this adds the signed-in
// user and the file storage for the evidence.
import { getCachedSession } from "@/lib/auth/cached-session";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import * as S from "@/lib/post-delivery/service";
import * as R2 from "@/lib/r2/post-delivery";
import { nanoid } from "nanoid";

export type {
  Result, IssueInput, IssueItemInput, IssueListRow, ClaimInput, ClaimUpdate, ClaimListRow, ClaimPreview, ResponseInput, TermInput, SupplierTerms,
  DeliveryOrderHit, DeliveryOrderLines, ReceivedLine,
} from "@/lib/post-delivery/service";

async function ctx(): Promise<S.Ctx> {
  const session = await getCachedSession();
  if (!session) throw new Error("You must be signed in to continue");
  const orgId = session.session.activeOrganizationId;
  if (!orgId) throw new Error("No active organization");
  return { orgId, userId: session.user.id, perms: await getUserPermissions(session.user.id, orgId) };
}

// ── terms ───────────────────────────────────────────────────────────────────
export async function getSupplierTerms() { return S.listSupplierTerms(await ctx()); }
export async function saveSupplierClaimTerms(supplierId: string, terms: S.TermInput[]) { return S.saveSupplierTerms(await ctx(), supplierId, terms); }

export async function getSuppliersForIssue() { return S.listSuppliersForIssue(await ctx()); }

// ── finding the delivery and where the goods came from ──────────────────────
export async function findDeliveryOrders(query: string) { return S.searchDeliveryOrders(await ctx(), query); }
export async function getDeliveryOrderForIssue(id: string) { return S.getDeliveryOrderLines(await ctx(), id); }
export async function findReceivedLinesFor(productCode: string) { return S.findReceivedLines(await ctx(), productCode); }

// ── customer issues ─────────────────────────────────────────────────────────
export async function createCustomerIssue(input: S.IssueInput) { return S.createIssue(await ctx(), input); }
export async function updateCustomerIssue(id: string, input: S.IssueInput) { return S.updateIssue(await ctx(), id, input); }
export async function getCustomerIssues(opts: { scope?: "live" | "all"; q?: string } = {}) { return S.listIssues(await ctx(), opts); }
export async function setCustomerIssueStatus(id: string, to: Parameters<typeof S.setIssueStatus>[2], input: { reason?: string } = {}) { return S.setIssueStatus(await ctx(), id, to, input); }
export async function resolveCustomerIssue(id: string, input: { resolution: string; notes?: string }) { return S.resolveIssue(await ctx(), id, input); }
export async function setIssueCustomerResolution(id: string, input: { resolution: string | null; notes?: string }) { return S.setCustomerResolution(await ctx(), id, input); }
export async function addCustomerIssueNote(id: string, text: string) { return S.addIssueNote(await ctx(), id, text); }
export async function setIssueItemUnitStatus(itemId: string, status: string) { return S.setUnitStatus(await ctx(), itemId, status); }

// The issue with a link for each photo and video (links last two hours)
export async function getCustomerIssueDetail(id: string) {
  const c = await ctx();
  const d = await S.getIssue(c, id);
  if (!d) return null;
  const media = await Promise.all(d.media.map(async (m) => ({ ...m, url: await R2.downloadUrl(m.imageKey, { video: m.kind === "video" }).catch(() => null) })));
  return { ...d, media };
}
export type CustomerIssueDetail = NonNullable<Awaited<ReturnType<typeof getCustomerIssueDetail>>>;

// ── evidence ────────────────────────────────────────────────────────────────
export async function getIssueMediaUploadUrl(issueId: string, fileName: string, contentType: string, size: number): Promise<S.Result<{ key: string; uploadUrl: string; kind: "image" | "video" }>> {
  const c = await ctx();
  if (!c.perms.includes("*") && !c.perms.includes("customer-issue:update") && !c.perms.includes("customer-issue:create")) return { ok: false, error: "You don't have permission to do this." };
  const issue = await S.getIssue(c, issueId);
  if (!issue) return { ok: false, error: "Issue not found." };
  const ext = R2.extOf(fileName);
  const kind = R2.IMAGE_EXTS.includes(ext) ? "image" : R2.VIDEO_EXTS.includes(ext) ? "video" : null;
  if (!kind) return { ok: false, error: "Only photos (JPG, PNG, WebP, GIF) and videos (MP4, MOV, WebM, 3GP) can be attached." };
  if (size > (kind === "image" ? R2.MAX_IMAGE_BYTES : R2.MAX_VIDEO_BYTES)) return { ok: false, error: kind === "image" ? "A photo can be up to 10 MB." : "A video can be up to 200 MB." };
  const safe = fileName.replace(/[^\w.-]+/g, "_").slice(-80);
  const key = `${S.mediaKeyPrefix(c.orgId, issueId)}${nanoid()}-${safe}`;
  return { ok: true, value: { key, uploadUrl: await R2.uploadUrl(key, contentType || "application/octet-stream"), kind } };
}
export async function addIssueMedia(issueId: string, input: { key: string; filename: string; kind: "image" | "video"; itemId?: string | null; caption?: string }) { return S.registerMedia(await ctx(), issueId, input); }
export async function deleteIssueMedia(mediaId: string): Promise<S.Result> {
  const r = await S.removeMedia(await ctx(), mediaId);
  if (!r.ok) return r;
  await R2.deleteObject(r.value.key).catch(() => {}); // the record is gone either way
  return { ok: true, value: undefined };
}
export async function getIssueMediaDownloadUrl(mediaId: string): Promise<S.Result<{ url: string }>> {
  const m = await S.getMediaKey(await ctx(), mediaId);
  if (!m) return { ok: false, error: "File not found." };
  return { ok: true, value: { url: await R2.downloadUrl(m.key, { filename: m.filename }) } };
}

// ── supplier claims ─────────────────────────────────────────────────────────
export async function previewSupplierClaim(issueId: string, supplierId: string, itemIds?: string[]) { return S.previewClaim(await ctx(), issueId, supplierId, itemIds); }
export async function createSupplierClaim(input: S.ClaimInput) { return S.createClaim(await ctx(), input); }
export async function updateSupplierClaim(id: string, patch: S.ClaimUpdate) { return S.updateClaim(await ctx(), id, patch); }
export async function recalculateClaimDeadline(id: string) { return S.recalculateDeadline(await ctx(), id); }
export async function sendSupplierClaim(id: string, input: Parameters<typeof S.sendClaim>[2]) { return S.sendClaim(await ctx(), id, input); }
export async function recordSupplierResponse(id: string, input: S.ResponseInput) { return S.recordResponse(await ctx(), id, input); }
export async function closeSupplierClaim(id: string, note?: string) { return S.closeClaim(await ctx(), id, note); }
export async function withdrawSupplierClaim(id: string, reason: string) { return S.withdrawClaim(await ctx(), id, reason); }
export async function resubmitSupplierClaim(id: string, input: { via: string; note?: string }) { return S.resubmitClaim(await ctx(), id, input); }
// opening the list also sends the reminders that are due (there is no background job)
export async function getSupplierClaims(opts: { tab?: "action" | "waiting" | "done" | "all"; q?: string } = {}) {
  const c = await ctx();
  await S.runReminders(c).catch(() => 0);
  return S.listClaims(c, opts);
}
export async function getSupplierClaimDetail(id: string) {
  const c = await ctx();
  const d = await S.getClaim(c, id);
  if (!d) return null;
  const media = await Promise.all(d.media.map(async (m) => ({ ...m, url: await R2.downloadUrl(m.imageKey, { video: m.kind === "video" }).catch(() => null) })));
  return { ...d, media };
}
export type SupplierClaimDetail = NonNullable<Awaited<ReturnType<typeof getSupplierClaimDetail>>>;
