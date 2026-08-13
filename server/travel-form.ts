"use server";

import { db } from "@/db";
import {
  travelForm,
  travelFormDocument,
  travelFormStop,
  user,
  notification,
  claimLineItem,
  claimApplication,
} from "@/db/schema";
import { getCachedSession } from "@/lib/auth/cached-session";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";
import { formatTravelItinerary, travelPurposesSummary } from "@/lib/travel/itinerary";
import { deleteTravelFormDocFromR2 } from "@/lib/r2/travel-docs";
import { assertSelfActionAllowed } from "@/lib/approvals/guard";
import { notifyUsersWithPermission } from "@/server/notifications";
import { nanoid } from "nanoid";
import { eq, and, desc, asc, inArray, sql } from "drizzle-orm";

/* =========================
   TYPES
========================= */

export type TravelFormRow = typeof travelForm.$inferSelect;
export type TravelFormDocumentRow = typeof travelFormDocument.$inferSelect;
export type TravelFormStopRow = typeof travelFormStop.$inferSelect;

export type TravelFormWithDetails = TravelFormRow & {
  applicantName: string | null;
  documents: TravelFormDocumentRow[];
  stops: TravelFormStopRow[];
  claimApplicationNo?: string | null;
};

export type TravelStopInput = {
  stopDate: string;
  fromLocation: string;
  toLocation: string;
  journeyBreak?: boolean;
  mode: string;
  purpose: string;
  distanceKm?: string;
  estimatedCost?: string;
};

export type ApplyTravelFormInput = {
  stops: TravelStopInput[];
  notes?: string;
};

/* =========================
   HELPERS
========================= */

async function getSession() {
  const session = await getCachedSession();
  if (!session) throw new Error("You must be signed in to continue");
  const orgId = session.session.activeOrganizationId;
  if (!orgId) throw new Error("No active organization");
  return { session, orgId, userId: session.user.id, userName: session.user.name };
}

async function requireAccess(permission: string) {
  const { session, orgId, userId, userName } = await getSession();
  const perms = await getUserPermissions(userId, orgId);
  if (!hasAccess(perms, permission)) throw new Error("You don't have permission to do this");
  return { session, orgId, userId, userName };
}

async function generateApplicationNo(orgId: string): Promise<string> {
  const year = new Date().getFullYear();
  const rows = await db
    .select({ applicationNo: travelForm.applicationNo })
    .from(travelForm)
    .where(
      and(
        eq(travelForm.organizationId, orgId),
        sql`${travelForm.applicationNo} LIKE ${`TF-${year}-%`}`,
      ),
    )
    .orderBy(desc(travelForm.applicationNo));
  let next = 1;
  if (rows.length > 0) {
    const parts = rows[0].applicationNo.split("-");
    const num = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(num)) next = num + 1;
  }
  return `TF-${year}-${String(next).padStart(4, "0")}`;
}

async function notifyUser(
  orgId: string,
  userId: string,
  notifData: { type: string; title: string; body: string; link: string },
) {
  await db.insert(notification).values({
    id: nanoid(),
    organizationId: orgId,
    userId,
    ...notifData,
    isRead: 0,
    createdAt: new Date(),
  });
}

async function loadDocuments(formIds: string[]): Promise<Record<string, TravelFormDocumentRow[]>> {
  if (formIds.length === 0) return {};
  const docs = await db
    .select()
    .from(travelFormDocument)
    .where(inArray(travelFormDocument.travelFormId, formIds));
  const docMap: Record<string, TravelFormDocumentRow[]> = {};
  for (const doc of docs) {
    if (!docMap[doc.travelFormId]) docMap[doc.travelFormId] = [];
    docMap[doc.travelFormId].push(doc);
  }
  return docMap;
}

async function loadStops(formIds: string[]): Promise<Record<string, TravelFormStopRow[]>> {
  if (formIds.length === 0) return {};
  const stops = await db
    .select()
    .from(travelFormStop)
    .where(inArray(travelFormStop.travelFormId, formIds))
    .orderBy(asc(travelFormStop.sortOrder));
  const stopMap: Record<string, TravelFormStopRow[]> = {};
  for (const stop of stops) {
    if (!stopMap[stop.travelFormId]) stopMap[stop.travelFormId] = [];
    stopMap[stop.travelFormId].push(stop);
  }
  return stopMap;
}

// A claimed travel form is linked via claim_line_item.travel_form_id — there's
// no direct FK on travel_form itself. At most one claim application should
// reference a given form at a time (claimedAt is exclusive), so the first
// match is authoritative.
async function loadClaimApplicationNos(formIds: string[]): Promise<Record<string, string>> {
  if (formIds.length === 0) return {};
  const rows = await db
    .selectDistinct({ travelFormId: claimLineItem.travelFormId, applicationNo: claimApplication.applicationNo })
    .from(claimLineItem)
    .innerJoin(claimApplication, eq(claimApplication.id, claimLineItem.applicationId))
    .where(inArray(claimLineItem.travelFormId, formIds));
  const map: Record<string, string> = {};
  for (const r of rows) {
    if (r.travelFormId) map[r.travelFormId] = r.applicationNo;
  }
  return map;
}

/* =========================
   READ
========================= */

export async function getMyTravelForms(): Promise<TravelFormWithDetails[]> {
  const { orgId, userId } = await requireAccess("travel:read:own");
  const forms = await db
    .select()
    .from(travelForm)
    .where(and(eq(travelForm.organizationId, orgId), eq(travelForm.userId, userId)))
    .orderBy(desc(travelForm.createdAt));
  if (forms.length === 0) return [];

  const claimedFormIds = forms.filter((f) => f.claimedAt).map((f) => f.id);
  const [docMap, stopMap, claimNoMap] = await Promise.all([
    loadDocuments(forms.map((f) => f.id)),
    loadStops(forms.map((f) => f.id)),
    loadClaimApplicationNos(claimedFormIds),
  ]);
  const userRow = await db.select({ name: user.name }).from(user).where(eq(user.id, userId)).limit(1);
  const applicantName = userRow[0]?.name ?? null;

  return forms.map((f) => ({
    ...f,
    applicantName,
    documents: docMap[f.id] ?? [],
    stops: stopMap[f.id] ?? [],
    claimApplicationNo: claimNoMap[f.id] ?? null,
  }));
}

export async function getMyApprovedUnclaimedTravelForms(): Promise<TravelFormWithDetails[]> {
  const { orgId, userId } = await requireAccess("travel:apply");
  const forms = await db
    .select()
    .from(travelForm)
    .where(
      and(
        eq(travelForm.organizationId, orgId),
        eq(travelForm.userId, userId),
        eq(travelForm.status, "APPROVED"),
        sql`${travelForm.claimedAt} is null`,
      ),
    )
    .orderBy(desc(travelForm.startDate));
  if (forms.length === 0) return [];

  const [userRow, stopMap] = await Promise.all([
    db.select({ name: user.name }).from(user).where(eq(user.id, userId)).limit(1),
    loadStops(forms.map((f) => f.id)),
  ]);
  const applicantName = userRow[0]?.name ?? null;
  return forms.map((f) => ({ ...f, applicantName, documents: [], stops: stopMap[f.id] ?? [] }));
}

export async function getPendingTravelApprovals(): Promise<TravelFormWithDetails[]> {
  const { orgId } = await requireAccess("travel:approve");
  const forms = await db
    .select({ form: travelForm, applicantName: user.name })
    .from(travelForm)
    .leftJoin(user, eq(travelForm.userId, user.id))
    .where(and(eq(travelForm.organizationId, orgId), eq(travelForm.status, "PENDING")))
    .orderBy(asc(travelForm.startDate));
  if (forms.length === 0) return [];

  const [docMap, stopMap] = await Promise.all([
    loadDocuments(forms.map((f) => f.form.id)),
    loadStops(forms.map((f) => f.form.id)),
  ]);
  return forms.map(({ form, applicantName }) => ({
    ...form,
    applicantName: applicantName ?? null,
    documents: docMap[form.id] ?? [],
    stops: stopMap[form.id] ?? [],
  }));
}

export async function getAllTravelForms(): Promise<TravelFormWithDetails[]> {
  const { orgId } = await requireAccess("travel:read:all");
  const forms = await db
    .select({ form: travelForm, applicantName: user.name })
    .from(travelForm)
    .leftJoin(user, eq(travelForm.userId, user.id))
    .where(and(eq(travelForm.organizationId, orgId), sql`${travelForm.status} != 'DRAFT'`))
    .orderBy(desc(travelForm.createdAt));
  if (forms.length === 0) return [];

  const [docMap, stopMap] = await Promise.all([
    loadDocuments(forms.map((f) => f.form.id)),
    loadStops(forms.map((f) => f.form.id)),
  ]);
  return forms.map(({ form, applicantName }) => ({
    ...form,
    applicantName: applicantName ?? null,
    documents: docMap[form.id] ?? [],
    stops: stopMap[form.id] ?? [],
  }));
}

/* =========================
   APPLY / APPROVE / REJECT / CANCEL
========================= */

function validateStops(stops: TravelStopInput[]): void {
  if (stops.length === 0) throw new Error("At least one stop is required");
  for (const stop of stops) {
    if (!stop.fromLocation.trim() || !stop.toLocation.trim()) throw new Error("Each stop needs a from and to location");
    if (!stop.stopDate) throw new Error("Each stop needs a date");
    if (!stop.purpose.trim()) throw new Error("Each journey needs a purpose");
    if (!stop.mode.trim()) throw new Error("Each leg needs a mode of transport");
  }
}

function computeTripSpan(stops: TravelStopInput[]): { startDate: string; endDate: string; estimatedCost: string | null } {
  const today = new Date().toISOString().slice(0, 10);
  if (stops.length === 0) return { startDate: today, endDate: today, estimatedCost: null };
  const dates = stops.map((s) => s.stopDate).filter(Boolean).sort();
  const startDate = dates[0] ?? today;
  const endDate = dates[dates.length - 1] ?? startDate;
  const costs = stops.map((s) => (s.estimatedCost?.trim() ? parseFloat(s.estimatedCost) : 0));
  const totalCost = costs.reduce((a, b) => a + b, 0);
  const hasAnyCost = stops.some((s) => s.estimatedCost?.trim());
  return { startDate, endDate, estimatedCost: hasAnyCost ? totalCost.toFixed(2) : null };
}

// Delete-and-reinsert, same pattern as claim's replaceClaimItems — simplest
// way to keep sortOrder correct and let a draft be edited freely.
async function replaceStops(formId: string, orgId: string, stops: TravelStopInput[]): Promise<void> {
  await db.delete(travelFormStop).where(eq(travelFormStop.travelFormId, formId));
  if (stops.length === 0) return;
  await db.insert(travelFormStop).values(
    stops.map((s, i) => ({
      id: nanoid(),
      travelFormId: formId,
      organizationId: orgId,
      sortOrder: i,
      stopDate: s.stopDate || new Date().toISOString().slice(0, 10),
      fromLocation: s.fromLocation.trim(),
      toLocation: s.toLocation.trim(),
      journeyBreak: s.journeyBreak ?? false,
      mode: s.mode || "OWN_VEHICLE",
      purpose: s.purpose?.trim() || "",
      distanceKm: s.distanceKm?.trim() || null,
      estimatedCost: s.estimatedCost?.trim() || null,
    })),
  );
}

export async function applyForTravelForm(data: ApplyTravelFormInput): Promise<string> {
  const { orgId, userId, userName } = await requireAccess("travel:apply");
  validateStops(data.stops);

  const { startDate, endDate, estimatedCost } = computeTripSpan(data.stops);
  const applicationNo = await generateApplicationNo(orgId);
  const formId = nanoid();

  await db.insert(travelForm).values({
    id: formId,
    organizationId: orgId,
    applicationNo,
    userId,
    startDate,
    endDate,
    estimatedCost,
    notes: data.notes?.trim() || null,
    status: "PENDING",
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  await replaceStops(formId, orgId, data.stops);

  const itinerary = formatTravelItinerary(data.stops);
  const purposes = travelPurposesSummary(data.stops);
  await notifyUsersWithPermission(orgId, "travel:approve", {
    type: "travel:submitted",
    title: `Travel Form: ${itinerary}`,
    body: `${userName} requested travel authorization from ${startDate} to ${endDate} (${itinerary}) — ${purposes}`,
    link: `/dashboard/human-resources/travel/approvals`,
  });

  return formId;
}

/* =========================
   DRAFT
========================= */

export async function saveDraftTravelForm(data: ApplyTravelFormInput): Promise<string> {
  const { orgId, userId } = await requireAccess("travel:apply");

  const { startDate, endDate, estimatedCost } = computeTripSpan(data.stops);
  const applicationNo = await generateApplicationNo(orgId);
  const formId = nanoid();

  await db.insert(travelForm).values({
    id: formId,
    organizationId: orgId,
    applicationNo,
    userId,
    startDate,
    endDate,
    estimatedCost,
    notes: data.notes?.trim() || null,
    status: "DRAFT",
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  await replaceStops(formId, orgId, data.stops);
  return formId;
}

export async function updateDraftTravelForm(draftId: string, data: ApplyTravelFormInput): Promise<void> {
  const { orgId, userId } = await requireAccess("travel:apply");
  const [form] = await db.select().from(travelForm).where(and(eq(travelForm.id, draftId), eq(travelForm.organizationId, orgId))).limit(1);
  if (!form || form.userId !== userId) throw new Error("Draft not found");
  if (form.status !== "DRAFT") throw new Error("Only drafts can be updated this way");

  const { startDate, endDate, estimatedCost } = computeTripSpan(data.stops);
  await replaceStops(draftId, orgId, data.stops);
  await db
    .update(travelForm)
    .set({ startDate, endDate, estimatedCost, notes: data.notes?.trim() || null, updatedAt: new Date() })
    .where(eq(travelForm.id, draftId));
}

export async function finalizeDraftTravelForm(draftId: string, data: ApplyTravelFormInput): Promise<void> {
  const { orgId, userId, userName } = await requireAccess("travel:apply");
  const [form] = await db.select().from(travelForm).where(and(eq(travelForm.id, draftId), eq(travelForm.organizationId, orgId))).limit(1);
  if (!form || form.userId !== userId) throw new Error("Draft not found");
  if (form.status !== "DRAFT") throw new Error("Only drafts can be submitted this way");
  validateStops(data.stops);

  const { startDate, endDate, estimatedCost } = computeTripSpan(data.stops);
  await replaceStops(draftId, orgId, data.stops);
  await db
    .update(travelForm)
    .set({ startDate, endDate, estimatedCost, notes: data.notes?.trim() || null, status: "PENDING", updatedAt: new Date() })
    .where(eq(travelForm.id, draftId));

  const itinerary = formatTravelItinerary(data.stops);
  const purposes = travelPurposesSummary(data.stops);
  await notifyUsersWithPermission(orgId, "travel:approve", {
    type: "travel:submitted",
    title: `Travel Form: ${itinerary}`,
    body: `${userName} requested travel authorization from ${startDate} to ${endDate} (${itinerary}) — ${purposes}`,
    link: `/dashboard/human-resources/travel/approvals`,
  });
}

export async function getTravelFormForEdit(id: string): Promise<TravelFormWithDetails | null> {
  const { orgId, userId } = await requireAccess("travel:apply");
  const [form] = await db.select().from(travelForm).where(and(eq(travelForm.id, id), eq(travelForm.organizationId, orgId))).limit(1);
  if (!form || form.userId !== userId || form.status !== "DRAFT") return null;

  const [docs, stopMap] = await Promise.all([
    db.select().from(travelFormDocument).where(eq(travelFormDocument.travelFormId, id)),
    loadStops([id]),
  ]);
  return { ...form, applicantName: null, documents: docs, stops: stopMap[id] ?? [] };
}

export async function approveTravelForm(id: string, comment?: string): Promise<void> {
  const { orgId, userId } = await requireAccess("travel:approve");
  const [form] = await db
    .select()
    .from(travelForm)
    .where(and(eq(travelForm.id, id), eq(travelForm.organizationId, orgId)))
    .limit(1);
  if (!form) throw new Error("Travel form not found");
  if (form.status !== "PENDING") throw new Error("Only pending travel forms can be approved");
  await assertSelfActionAllowed(orgId, "travel:approve", form.userId, userId, "approve");

  await db
    .update(travelForm)
    .set({
      status: "APPROVED",
      reviewedBy: userId,
      reviewedAt: new Date(),
      reviewComment: comment?.trim() || null,
      updatedAt: new Date(),
    })
    .where(eq(travelForm.id, id));

  const stops = (await loadStops([id]))[id] ?? [];
  const itinerary = formatTravelItinerary(stops);
  await notifyUser(orgId, form.userId, {
    type: "travel:approved",
    title: `Travel Form Approved: ${form.applicationNo}`,
    body: `Your travel ${itinerary} (${form.startDate} to ${form.endDate}) has been approved.${comment ? ` Comment: ${comment}` : ""}`,
    link: `/dashboard/human-resources/travel`,
  });
}

export async function rejectTravelForm(id: string, reason: string): Promise<void> {
  const { orgId, userId } = await requireAccess("travel:approve");
  if (!reason.trim()) throw new Error("Rejection reason is required");
  const [form] = await db
    .select()
    .from(travelForm)
    .where(and(eq(travelForm.id, id), eq(travelForm.organizationId, orgId)))
    .limit(1);
  if (!form) throw new Error("Travel form not found");
  if (form.status !== "PENDING") throw new Error("Only pending travel forms can be rejected");
  await assertSelfActionAllowed(orgId, "travel:approve", form.userId, userId, "reject");

  await db
    .update(travelForm)
    .set({
      status: "REJECTED",
      reviewedBy: userId,
      reviewedAt: new Date(),
      reviewComment: reason.trim(),
      updatedAt: new Date(),
    })
    .where(eq(travelForm.id, id));

  const stops = (await loadStops([id]))[id] ?? [];
  const itinerary = formatTravelItinerary(stops);
  await notifyUser(orgId, form.userId, {
    type: "travel:rejected",
    title: `Travel Form Rejected: ${form.applicationNo}`,
    body: `Your travel ${itinerary} was rejected. Reason: ${reason}`,
    link: `/dashboard/human-resources/travel`,
  });
}

export async function cancelTravelForm(id: string, reason?: string): Promise<void> {
  const { orgId, userId } = await requireAccess("travel:apply");
  const [form] = await db
    .select()
    .from(travelForm)
    .where(and(eq(travelForm.id, id), eq(travelForm.organizationId, orgId)))
    .limit(1);
  if (!form) throw new Error("Travel form not found");
  const perms = await getUserPermissions(userId, orgId);
  const canApprove = hasAccess(perms, "travel:approve");
  if (form.userId !== userId && !canApprove) throw new Error("You can only cancel your own travel forms");
  if (form.status === "CANCELLED") throw new Error("Travel form is already cancelled");
  if (form.claimedAt) throw new Error("This travel form is already linked to a claim and cannot be cancelled");

  if (form.status === "DRAFT") {
    // A draft was never submitted for approval — delete it outright rather
    // than leaving a "cancelled" record behind, same as claim drafts.
    const docs = await db.select({ fileKey: travelFormDocument.fileKey }).from(travelFormDocument).where(eq(travelFormDocument.travelFormId, id));
    await db.delete(travelForm).where(eq(travelForm.id, id)); // cascades stops + documents
    await Promise.allSettled(docs.map((d) => deleteTravelFormDocFromR2(d.fileKey)));
    return;
  }

  await db
    .update(travelForm)
    .set({
      status: "CANCELLED",
      cancelledBy: userId,
      cancelledAt: new Date(),
      cancelReason: reason?.trim() || null,
      updatedAt: new Date(),
    })
    .where(eq(travelForm.id, id));
}

/* =========================
   DOCUMENT MANAGEMENT
========================= */

export async function createTravelFormDocumentRecord(data: {
  travelFormId: string;
  fileName: string;
  fileKey: string;
  fileSize: number;
  mimeType: string;
}): Promise<TravelFormDocumentRow> {
  const { orgId, userId } = await requireAccess("travel:apply");
  const [form] = await db
    .select()
    .from(travelForm)
    .where(and(eq(travelForm.id, data.travelFormId), eq(travelForm.organizationId, orgId)))
    .limit(1);
  if (!form) throw new Error("Travel form not found");

  const row = {
    id: nanoid(),
    travelFormId: data.travelFormId,
    organizationId: orgId,
    fileName: data.fileName,
    fileKey: data.fileKey,
    fileSize: data.fileSize,
    mimeType: data.mimeType,
    uploadedBy: userId,
    uploadedAt: new Date(),
  };
  await db.insert(travelFormDocument).values(row);
  return row;
}

export async function deleteTravelFormDocument(id: string): Promise<string> {
  const { orgId, userId } = await requireAccess("travel:apply");
  const [doc] = await db
    .select()
    .from(travelFormDocument)
    .where(and(eq(travelFormDocument.id, id), eq(travelFormDocument.organizationId, orgId)))
    .limit(1);
  if (!doc) throw new Error("Document not found");
  const perms = await getUserPermissions(userId, orgId);
  if (doc.uploadedBy !== userId && !hasAccess(perms, "travel:approve"))
    throw new Error("You don't have permission to do this");
  await db.delete(travelFormDocument).where(eq(travelFormDocument.id, id));
  return doc.fileKey;
}
