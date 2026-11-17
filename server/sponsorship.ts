"use server";

// Sponsorship actions. The rules are in lib/sponsorship/service.ts; this adds the signed-in user and file storage.
import { getCachedSession } from "@/lib/auth/cached-session";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import * as S from "@/lib/sponsorship/service";
import { deleteClaimDocFromR2, getClaimPresignedDownloadUrl, getClaimPresignedUploadUrl } from "@/lib/r2/claim-docs";
import { nanoid } from "nanoid";

export type { Result, SponsorshipInput, SponsorshipListRow } from "@/lib/sponsorship/service";
export type SponsorshipDetailData = NonNullable<Awaited<ReturnType<typeof S.getSponsorship>>>;

async function ctx(): Promise<S.Ctx> {
  const session = await getCachedSession();
  if (!session) throw new Error("You must be signed in to continue");
  const orgId = session.session.activeOrganizationId;
  if (!orgId) throw new Error("No active organization");
  return { orgId, userId: session.user.id, perms: await getUserPermissions(session.user.id, orgId) };
}

export async function saveSponsorship(input: S.SponsorshipInput, submit: boolean) { return S.saveSponsorship(await ctx(), input, submit); }
export async function getMySponsorships() { return S.listMine(await ctx()); }
export async function getSponsorshipsToCheck() { return S.listToCheck(await ctx()); }
export async function getSponsorshipsToApprove() { return S.listToApprove(await ctx()); }
export async function getAllSponsorships() { return S.listAll(await ctx()); }
export async function getSponsorshipDetail(id: string) { return S.getSponsorship(await ctx(), id); }
export async function checkSponsorship(id: string, comment?: string) { return S.checkSponsorship(await ctx(), id, comment); }
export async function approveSponsorship(id: string, input: { amount?: string | number; comment?: string }) { return S.approveSponsorship(await ctx(), id, input); }
export async function rejectSponsorship(id: string, reason: string) { return S.rejectSponsorship(await ctx(), id, reason); }
export async function cancelSponsorship(id: string, reason?: string) { return S.cancelSponsorship(await ctx(), id, reason); }
export async function recordSponsorshipSpend(id: string, input: { items: { id: string; actualAmount: string | number | null }[]; paymentRef?: string; paid: boolean }) { return S.recordSpend(await ctx(), id, input); }
export async function closeSponsorship(id: string, note?: string) { return S.closeSponsorship(await ctx(), id, note); }

// ── documents ───────────────────────────────────────────────────────────────
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED = ["application/pdf", "image/jpeg", "image/png", "image/webp"];

export async function getSponsorshipDocUploadUrl(sponsorshipId: string, fileName: string, mimeType: string, size: number): Promise<S.Result<{ key: string; uploadUrl: string }>> {
  const c = await ctx();
  const d = await S.getSponsorship(c, sponsorshipId);
  if (!d || !d.can.addDocument) return { ok: false, error: "You can't add documents to this sponsorship." };
  if (!ALLOWED.includes(mimeType)) return { ok: false, error: "Upload a PDF or an image (JPG, PNG, WebP)." };
  if (size > MAX_BYTES) return { ok: false, error: "The file is larger than 10 MB." };
  const ext = fileName.includes(".") ? fileName.split(".").pop() : "bin";
  const key = `sponsorship/${c.orgId}/${sponsorshipId}/${nanoid()}.${ext}`;
  return { ok: true, value: { key, uploadUrl: await getClaimPresignedUploadUrl(key, mimeType) } };
}

export async function addSponsorshipDocument(sponsorshipId: string, doc: { kind: string; fileName: string; fileKey: string; fileSize: number; mimeType: string }) {
  const c = await ctx();
  if (!doc.fileKey.startsWith(`sponsorship/${c.orgId}/${sponsorshipId}/`)) return { ok: false as const, error: "That file does not belong to this sponsorship." };
  return S.addDocumentRecord(c, sponsorshipId, doc);
}

export async function removeSponsorshipDocument(docId: string) {
  const r = await S.removeDocumentRecord(await ctx(), docId);
  if (r.ok) await deleteClaimDocFromR2(r.value).catch(() => {}); // the record is gone either way
  return r.ok ? ({ ok: true, value: undefined } as S.Result) : r;
}

export async function getSponsorshipDocDownloadUrl(docId: string): Promise<S.Result<string>> {
  const doc = await S.findDocument(await ctx(), docId);
  if (!doc) return { ok: false, error: "Document not found." };
  return { ok: true, value: await getClaimPresignedDownloadUrl(doc.fileKey, doc.fileName) };
}
