"use server";

import { db } from "@/db";
import {
  claimType,
  claimApplication,
  claimDocument,
  claimLineItem,
  claimEntertainmentDetail,
  notification,
  userPermission,
  user,
} from "@/db/schema";
import { getCachedSession } from "@/lib/auth/cached-session";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";
import { nanoid } from "nanoid";
import { eq, and, desc, asc, inArray, sql } from "drizzle-orm";
import { CLAIM_FORM, LINE_CATEGORY, type ClaimFormType, type LineCategoryType } from "@/lib/claim/constants";

/* =========================
   TYPES
========================= */

export type ClaimTypeRow = typeof claimType.$inferSelect;
export type ClaimApplicationRow = typeof claimApplication.$inferSelect;
export type ClaimDocumentRow = typeof claimDocument.$inferSelect;
export type ClaimLineItemRow = typeof claimLineItem.$inferSelect;
export type ClaimEntertainmentDetailRow = typeof claimEntertainmentDetail.$inferSelect;


export type ClaimLineItemInput = {
  id?: string;               // pre-generated client-side when a receipt file is attached
  category: LineCategoryType;
  lineDate: string;
  // TRAVEL
  fromLocation?: string;
  toLocation?: string;
  distanceKm?: number;
  ratePerUnit?: string;
  // IN_BASE_ENT
  venue?: string;
  // OVERSEAS_MYR, OVERSEAS_FX, OVERSEAS_OTHER
  destination?: string;
  currency?: string;         // e.g. "USD", "SGD"
  amountForeign?: string;   // OVERSEAS_FX
  exchangeRate?: string;    // OVERSEAS_FX
  // All types
  description?: string;
  amountMyr: string;        // final MYR amount (required)
};

export type ClaimEntertainmentDetailInput = {
  eventDate: string;
  restaurantName: string;
  customerName: string;
  departmentOrganization: string;
  purpose: string;
  amount: string;
};

export type ApplyClaimInput = {
  claimTypeId: string;
  claimPeriod: string;       // YYYY-MM for LOCAL/OVERSEAS; YYYY-MM-DD for ENTERTAINMENT_FORM
  description: string;       // overall note / summary
  lineItems?: ClaimLineItemInput[];                    // LOCAL + OVERSEAS
  entertainmentDetail?: ClaimEntertainmentDetailInput; // ENTERTAINMENT_FORM
};

export type ClaimApplicationWithDetails = ClaimApplicationRow & {
  applicantName: string | null;
  documents: ClaimDocumentRow[];
  lineItems: ClaimLineItemRow[];
  entertainmentDetail: ClaimEntertainmentDetailRow | null;
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
    .select({ applicationNo: claimApplication.applicationNo })
    .from(claimApplication)
    .where(
      and(
        eq(claimApplication.organizationId, orgId),
        sql`${claimApplication.applicationNo} LIKE ${`CR-${year}-%`}`,
      ),
    )
    .orderBy(desc(claimApplication.applicationNo));
  let next = 1;
  if (rows.length > 0) {
    const parts = rows[0].applicationNo.split("-");
    const num = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(num)) next = num + 1;
  }
  return `CR-${year}-${String(next).padStart(4, "0")}`;
}

async function notifyUsersWithPermission(
  orgId: string,
  permKey: string,
  notifData: { type: string; title: string; body: string; link: string },
) {
  const approvers = await db
    .select({ userId: userPermission.userId })
    .from(userPermission)
    .where(
      and(
        eq(userPermission.organizationId, orgId),
        eq(userPermission.permissionKey, permKey),
        eq(userPermission.allowed, true),
      ),
    );
  if (approvers.length === 0) return;
  const notifs = approvers.map((a) => ({
    id: nanoid(),
    organizationId: orgId,
    userId: a.userId,
    ...notifData,
    isRead: 0,
    createdAt: new Date(),
  }));
  await db.insert(notification).values(notifs);
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

async function loadExtras(appIds: string[]): Promise<{
  docMap: Record<string, ClaimDocumentRow[]>;
  lineMap: Record<string, ClaimLineItemRow[]>;
  entMap: Record<string, ClaimEntertainmentDetailRow>;
}> {
  const [docs, lines, ents] = await Promise.all([
    db.select().from(claimDocument).where(inArray(claimDocument.applicationId, appIds)),
    db
      .select()
      .from(claimLineItem)
      .where(inArray(claimLineItem.applicationId, appIds))
      .orderBy(asc(claimLineItem.sortOrder), asc(claimLineItem.lineDate)),
    db
      .select()
      .from(claimEntertainmentDetail)
      .where(inArray(claimEntertainmentDetail.applicationId, appIds)),
  ]);
  const docMap: Record<string, ClaimDocumentRow[]> = {};
  for (const doc of docs) {
    if (!docMap[doc.applicationId]) docMap[doc.applicationId] = [];
    docMap[doc.applicationId].push(doc);
  }
  const lineMap: Record<string, ClaimLineItemRow[]> = {};
  for (const li of lines) {
    if (!lineMap[li.applicationId]) lineMap[li.applicationId] = [];
    lineMap[li.applicationId].push(li);
  }
  const entMap: Record<string, ClaimEntertainmentDetailRow> = {};
  for (const e of ents) entMap[e.applicationId] = e;
  return { docMap, lineMap, entMap };
}

/* =========================
   CLAIM TYPES CRUD
========================= */

export async function getClaimTypes(): Promise<ClaimTypeRow[]> {
  const { orgId } = await requireAccess("claim:read:own");
  return db
    .select()
    .from(claimType)
    .where(eq(claimType.organizationId, orgId))
    .orderBy(asc(claimType.sortOrder), asc(claimType.name));
}

export async function getActiveClaimTypes(): Promise<ClaimTypeRow[]> {
  const { orgId } = await requireAccess("claim:read:own");
  return db
    .select()
    .from(claimType)
    .where(and(eq(claimType.organizationId, orgId), eq(claimType.isActive, true)))
    .orderBy(asc(claimType.sortOrder), asc(claimType.name));
}

export async function createClaimType(data: {
  name: string;
  code: string;
  category: string;
  unitType: string;
  ratePerUnit?: string;
  requiresReceipt: boolean;
  maxAmountPerClaim?: string;
  maxAmountPerYear?: string;
  hotelCapPerNight?: string;
  mealBreakfastRate?: string;
  mealLunchRate?: string;
  mealDinnerRate?: string;
  description?: string;
  sortOrder?: number;
}): Promise<ClaimTypeRow> {
  const { orgId } = await requireAccess("claim:manage");
  const row = {
    id: nanoid(),
    organizationId: orgId,
    name: data.name.trim(),
    code: data.code.trim().toUpperCase(),
    category: data.category,
    unitType: data.unitType,
    ratePerUnit: data.ratePerUnit?.trim() || null,
    requiresReceipt: data.requiresReceipt,
    maxAmountPerClaim: data.maxAmountPerClaim?.trim() || null,
    maxAmountPerYear: data.maxAmountPerYear?.trim() || null,
    hotelCapPerNight: data.hotelCapPerNight?.trim() || null,
    mealBreakfastRate: data.mealBreakfastRate?.trim() || null,
    mealLunchRate: data.mealLunchRate?.trim() || null,
    mealDinnerRate: data.mealDinnerRate?.trim() || null,
    isActive: true,
    description: data.description?.trim() ?? null,
    sortOrder: data.sortOrder ?? 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  await db.insert(claimType).values(row);
  return row;
}

export async function updateClaimType(
  id: string,
  data: Partial<{
    name: string;
    category: string;
    unitType: string;
    ratePerUnit: string | null;
    requiresReceipt: boolean;
    maxAmountPerClaim: string | null;
    maxAmountPerYear: string | null;
    hotelCapPerNight: string | null;
    mealBreakfastRate: string | null;
    mealLunchRate: string | null;
    mealDinnerRate: string | null;
    description: string;
    isActive: boolean;
    sortOrder: number;
  }>,
): Promise<void> {
  const { orgId } = await requireAccess("claim:manage");
  await db
    .update(claimType)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(claimType.id, id), eq(claimType.organizationId, orgId)));
}

export async function deleteClaimType(id: string): Promise<void> {
  const { orgId } = await requireAccess("claim:manage");
  const used = await db
    .select({ id: claimApplication.id })
    .from(claimApplication)
    .where(and(eq(claimApplication.claimTypeId, id), eq(claimApplication.organizationId, orgId)))
    .limit(1);
  if (used.length > 0)
    throw new Error("Claim type is used in applications. Deactivate it instead.");
  await db
    .delete(claimType)
    .where(and(eq(claimType.id, id), eq(claimType.organizationId, orgId)));
}

export async function seedDefaultClaimTypes(): Promise<void> {
  const { orgId } = await requireAccess("claim:manage");
  const existing = await db
    .select({ id: claimType.id })
    .from(claimType)
    .where(eq(claimType.organizationId, orgId))
    .limit(1);
  if (existing.length > 0)
    throw new Error("Claim types already exist. Delete existing ones to re-seed.");

  const defaults = [
    {
      name: "Local Reimbursement Claim",
      code: "LOCAL",
      category: CLAIM_FORM.LOCAL,
      unitType: "AMOUNT",
      ratePerUnit: "0.50",
      hotelCapPerNight: "200.00",
      mealBreakfastRate: "10.00",
      mealLunchRate: "15.00",
      mealDinnerRate: "20.00",
      requiresReceipt: false,
      sortOrder: 1,
      description: "Travel, miscellaneous, in-base entertainment and other local expenses.",
    },
    {
      name: "Overseas Expenses Reimbursement",
      code: "OVERSEAS",
      category: CLAIM_FORM.OVERSEAS,
      unitType: "AMOUNT",
      ratePerUnit: null,
      requiresReceipt: true,
      sortOrder: 2,
      description: "Overseas travel and accommodation expenses (MYR and foreign currency).",
    },
    {
      name: "Entertainment Form",
      code: "ENT_FORM",
      category: CLAIM_FORM.ENTERTAINMENT_FORM,
      unitType: "AMOUNT",
      ratePerUnit: null,
      requiresReceipt: true,
      maxAmountPerClaim: "500.00",
      sortOrder: 3,
      description: "Client entertainment — restaurant, customer, purpose, department details required.",
    },
  ];

  const rows = defaults.map((d) => ({
    id: nanoid(),
    organizationId: orgId,
    name: d.name,
    code: d.code,
    category: d.category,
    unitType: d.unitType,
    ratePerUnit: d.ratePerUnit ?? null,
    requiresReceipt: d.requiresReceipt,
    maxAmountPerClaim: (d as { maxAmountPerClaim?: string }).maxAmountPerClaim ?? null,
    maxAmountPerYear: null,
    hotelCapPerNight: (d as { hotelCapPerNight?: string }).hotelCapPerNight ?? null,
    mealBreakfastRate: (d as { mealBreakfastRate?: string }).mealBreakfastRate ?? null,
    mealLunchRate: (d as { mealLunchRate?: string }).mealLunchRate ?? null,
    mealDinnerRate: (d as { mealDinnerRate?: string }).mealDinnerRate ?? null,
    isActive: true,
    description: d.description,
    sortOrder: d.sortOrder,
    createdAt: new Date(),
    updatedAt: new Date(),
  }));
  await db.insert(claimType).values(rows);
}

/* =========================
   MY CLAIMS
========================= */

export async function getMyClaimApplications(): Promise<ClaimApplicationWithDetails[]> {
  const { orgId, userId } = await requireAccess("claim:read:own");
  const apps = await db
    .select()
    .from(claimApplication)
    .where(and(eq(claimApplication.organizationId, orgId), eq(claimApplication.userId, userId)))
    .orderBy(desc(claimApplication.createdAt));

  if (apps.length === 0) return [];
  const appIds = apps.map((a) => a.id);
  const { docMap, lineMap, entMap } = await loadExtras(appIds);

  const userRow = await db.select({ name: user.name }).from(user).where(eq(user.id, userId)).limit(1);
  const applicantName = userRow[0]?.name ?? null;

  return apps.map((a) => ({
    ...a,
    applicantName,
    documents: docMap[a.id] ?? [],
    lineItems: lineMap[a.id] ?? [],
    entertainmentDetail: entMap[a.id] ?? null,
  }));
}

export async function getPendingClaimApprovals(): Promise<ClaimApplicationWithDetails[]> {
  const { orgId } = await requireAccess("claim:approve");
  const apps = await db
    .select({ app: claimApplication, applicantName: user.name })
    .from(claimApplication)
    .leftJoin(user, eq(claimApplication.userId, user.id))
    .where(and(eq(claimApplication.organizationId, orgId), eq(claimApplication.status, "PENDING")))
    .orderBy(asc(claimApplication.claimDate));

  if (apps.length === 0) return [];
  const appIds = apps.map((a) => a.app.id);
  const { docMap, lineMap, entMap } = await loadExtras(appIds);

  return apps.map(({ app, applicantName }) => ({
    ...app,
    applicantName: applicantName ?? null,
    documents: docMap[app.id] ?? [],
    lineItems: lineMap[app.id] ?? [],
    entertainmentDetail: entMap[app.id] ?? null,
  }));
}

/* =========================
   SUBMIT / APPROVE / REJECT / CANCEL
========================= */

export async function submitClaim(data: ApplyClaimInput): Promise<string> {
  const { orgId, userId, userName } = await requireAccess("claim:apply");

  const type = await db
    .select()
    .from(claimType)
    .where(and(eq(claimType.id, data.claimTypeId), eq(claimType.organizationId, orgId)))
    .limit(1);
  if (!type[0] || !type[0].isActive) throw new Error("Claim type not found or inactive");
  const ct = type[0];
  const formType = ct.category as ClaimFormType;

  // ── Compute total amount ──────────────────────────────────────────────────
  let totalAmount: number;
  if (formType === CLAIM_FORM.ENTERTAINMENT_FORM) {
    if (!data.entertainmentDetail) throw new Error("Entertainment details are required");
    totalAmount = parseFloat(data.entertainmentDetail.amount);
  } else {
    if (!data.lineItems || data.lineItems.length === 0)
      throw new Error("At least one expense line item is required");
    totalAmount = data.lineItems.reduce((sum, li) => sum + parseFloat(li.amountMyr), 0);
  }
  if (isNaN(totalAmount) || totalAmount <= 0) throw new Error("Total amount must be greater than 0");

  // ── Cap checks ────────────────────────────────────────────────────────────
  if (ct.maxAmountPerClaim) {
    const cap = parseFloat(ct.maxAmountPerClaim);
    if (totalAmount > cap)
      throw new Error(`Maximum claim amount per application is RM ${ct.maxAmountPerClaim}`);
  }
  if (ct.maxAmountPerYear) {
    const yearCap = parseFloat(ct.maxAmountPerYear);
    const year = parseInt(data.claimPeriod.slice(0, 4), 10);
    const ytdRows = await db
      .select({ amount: claimApplication.amount })
      .from(claimApplication)
      .where(
        and(
          eq(claimApplication.userId, userId),
          eq(claimApplication.organizationId, orgId),
          eq(claimApplication.claimTypeId, ct.id),
          sql`EXTRACT(YEAR FROM ${claimApplication.createdAt}) = ${year}`,
          sql`${claimApplication.status} IN ('PENDING', 'APPROVED')`,
        ),
      );
    const ytdTotal = ytdRows.reduce((sum, r) => sum + parseFloat(r.amount), 0);
    if (ytdTotal + totalAmount > yearCap) {
      const remaining = yearCap - ytdTotal;
      throw new Error(`Annual cap of RM ${ct.maxAmountPerYear} exceeded. Remaining: RM ${remaining.toFixed(2)}`);
    }
  }

  // ── claimDate: YYYY-MM → YYYY-MM-01 for monthly claims ───────────────────
  const claimDate =
    /^\d{4}-\d{2}$/.test(data.claimPeriod) ? `${data.claimPeriod}-01` : data.claimPeriod;

  const applicationNo = await generateApplicationNo(orgId);
  const appId = nanoid();

  await db.insert(claimApplication).values({
    id: appId,
    organizationId: orgId,
    applicationNo,
    userId,
    claimTypeId: ct.id,
    claimTypeName: ct.name,
    claimTypeCode: ct.code,
    claimDate,
    description: data.description.trim(),
    unitType: ct.unitType,
    quantity: null,
    ratePerUnit: ct.ratePerUnit ?? null,
    amount: totalAmount.toFixed(2),
    status: "PENDING",
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  // ── Insert line items (LOCAL / OVERSEAS) ──────────────────────────────────
  if (data.lineItems && data.lineItems.length > 0) {
    const rows = data.lineItems.map((li, idx) => ({
      id: li.id ?? nanoid(),
      applicationId: appId,
      organizationId: orgId,
      category: li.category,
      lineDate: li.lineDate,
      description: li.description?.trim() ?? null,
      fromLocation: li.fromLocation?.trim() ?? null,
      toLocation: li.toLocation?.trim() ?? null,
      distanceKm: li.distanceKm != null ? String(li.distanceKm) : null,
      ratePerUnit: li.ratePerUnit ?? null,
      venue: li.venue?.trim() ?? null,
      destination: li.destination?.trim() ?? null,
      currency: li.currency ?? null,
      amountForeign: li.amountForeign ?? null,
      exchangeRate: li.exchangeRate ?? null,
      amountMyr: li.amountMyr,
      sortOrder: idx,
      createdAt: new Date(),
    }));
    await db.insert(claimLineItem).values(rows);
  }

  // ── Insert entertainment detail ───────────────────────────────────────────
  if (formType === CLAIM_FORM.ENTERTAINMENT_FORM && data.entertainmentDetail) {
    const ed = data.entertainmentDetail;
    await db.insert(claimEntertainmentDetail).values({
      id: nanoid(),
      applicationId: appId,
      organizationId: orgId,
      eventDate: ed.eventDate,
      restaurantName: ed.restaurantName.trim(),
      customerName: ed.customerName.trim(),
      departmentOrganization: ed.departmentOrganization.trim(),
      purpose: ed.purpose.trim(),
      amount: ed.amount,
      createdAt: new Date(),
    });
  }

  await notifyUsersWithPermission(orgId, "claim:approve", {
    type: "claim:submitted",
    title: `Claim: ${ct.name}`,
    body: `${userName} submitted a ${ct.name} for RM ${totalAmount.toFixed(2)}`,
    link: `/dashboard/human-resources/claim/approvals`,
  });

  return appId;
}

export async function approveClaim(appId: string, comment?: string): Promise<void> {
  const { orgId, userId } = await requireAccess("claim:approve");
  const app = await db
    .select()
    .from(claimApplication)
    .where(and(eq(claimApplication.id, appId), eq(claimApplication.organizationId, orgId)))
    .limit(1);
  if (!app[0]) throw new Error("Application not found");
  if (app[0].status !== "PENDING") throw new Error("Only pending applications can be approved");
  if (app[0].userId === userId) throw new Error("You cannot approve your own claim");

  await db
    .update(claimApplication)
    .set({ status: "APPROVED", reviewedBy: userId, reviewedAt: new Date(), reviewComment: comment?.trim() ?? null, updatedAt: new Date() })
    .where(eq(claimApplication.id, appId));

  await notifyUser(orgId, app[0].userId, {
    type: "claim:approved",
    title: `Claim Approved: ${app[0].claimTypeName}`,
    body: `Your ${app[0].claimTypeName} (RM ${parseFloat(app[0].amount).toFixed(2)}) has been approved.${comment ? ` Note: ${comment}` : ""}`,
    link: `/dashboard/human-resources/claim`,
  });
}

export async function rejectClaim(appId: string, reason: string): Promise<void> {
  const { orgId, userId } = await requireAccess("claim:approve");
  if (!reason.trim()) throw new Error("Rejection reason is required");
  const app = await db
    .select()
    .from(claimApplication)
    .where(and(eq(claimApplication.id, appId), eq(claimApplication.organizationId, orgId)))
    .limit(1);
  if (!app[0]) throw new Error("Application not found");
  if (app[0].status !== "PENDING") throw new Error("Only pending applications can be rejected");

  await db
    .update(claimApplication)
    .set({ status: "REJECTED", reviewedBy: userId, reviewedAt: new Date(), reviewComment: reason.trim(), updatedAt: new Date() })
    .where(eq(claimApplication.id, appId));

  await notifyUser(orgId, app[0].userId, {
    type: "claim:rejected",
    title: `Claim Rejected: ${app[0].claimTypeName}`,
    body: `Your ${app[0].claimTypeName} (RM ${parseFloat(app[0].amount).toFixed(2)}) was rejected. Reason: ${reason}`,
    link: `/dashboard/human-resources/claim`,
  });
}

export async function cancelClaim(appId: string, reason?: string): Promise<void> {
  const { orgId, userId } = await requireAccess("claim:apply");
  const app = await db
    .select()
    .from(claimApplication)
    .where(and(eq(claimApplication.id, appId), eq(claimApplication.organizationId, orgId)))
    .limit(1);
  if (!app[0]) throw new Error("Application not found");
  const perms = await getUserPermissions(userId, orgId);
  const canApprove = hasAccess(perms, "claim:approve");
  if (app[0].userId !== userId && !canApprove) throw new Error("You can only cancel your own claims");
  if (app[0].status === "CANCELLED") throw new Error("Application is already cancelled");

  await db
    .update(claimApplication)
    .set({ status: "CANCELLED", cancelledBy: userId, cancelledAt: new Date(), cancelReason: reason?.trim() ?? null, updatedAt: new Date() })
    .where(eq(claimApplication.id, appId));
}

/* =========================
   DOCUMENT MANAGEMENT
========================= */

export async function createClaimDocumentRecord(data: {
  applicationId: string;
  lineItemId?: string;
  fileName: string;
  fileKey: string;
  fileSize: number;
  mimeType: string;
}): Promise<ClaimDocumentRow> {
  const { orgId, userId } = await requireAccess("claim:apply");
  const app = await db
    .select()
    .from(claimApplication)
    .where(and(eq(claimApplication.id, data.applicationId), eq(claimApplication.organizationId, orgId)))
    .limit(1);
  if (!app[0]) throw new Error("Application not found");
  const row = {
    id: nanoid(),
    applicationId: data.applicationId,
    lineItemId: data.lineItemId ?? null,
    organizationId: orgId,
    fileName: data.fileName,
    fileKey: data.fileKey,
    fileSize: data.fileSize,
    mimeType: data.mimeType,
    uploadedBy: userId,
    uploadedAt: new Date(),
  };
  await db.insert(claimDocument).values(row);
  return row;
}

export async function deleteClaimDocument(id: string): Promise<string> {
  const { orgId, userId } = await requireAccess("claim:apply");
  const doc = await db
    .select()
    .from(claimDocument)
    .where(and(eq(claimDocument.id, id), eq(claimDocument.organizationId, orgId)))
    .limit(1);
  if (!doc[0]) throw new Error("Document not found");
  const perms = await getUserPermissions(userId, orgId);
  if (doc[0].uploadedBy !== userId && !hasAccess(perms, "claim:approve")) throw new Error("You don't have permission to do this");
  await db.delete(claimDocument).where(eq(claimDocument.id, id));
  return doc[0].fileKey;
}
