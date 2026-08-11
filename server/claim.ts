"use server";

import { db } from "@/db";
import {
  claimType,
  claimApplication,
  claimDocument,
  claimLineItem,
  claimEntertainmentDetail,
  claimCategoryAccount,
  notification,
  userPermission,
  user,
  ledgerAccount,
  ledgerEntry,
  ledgerLine,
  member,
  customer,
} from "@/db/schema";
import { getCachedSession } from "@/lib/auth/cached-session";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";
import { nanoid } from "nanoid";
import { eq, and, desc, asc, inArray, sql, isNull } from "drizzle-orm";
import { CLAIM_FORM, LINE_CATEGORY, type ClaimFormType, type LineCategoryType } from "@/lib/claim/constants";
import { deleteClaimDocFromR2 } from "@/lib/r2/claim-docs";

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
  lineItems?: ClaimLineItemInput[];                      // LOCAL + OVERSEAS
  entertainmentDetails?: ClaimEntertainmentDetailInput[]; // ENTERTAINMENT_FORM (multiple rows)
};

export type ClaimLineItemWithMeta = ClaimLineItemRow & {
  editedByName: string | null;
  slashedByName: string | null;
};
export type ClaimEntertainmentDetailWithMeta = ClaimEntertainmentDetailRow & {
  editedByName: string | null;
  slashedByName: string | null;
};

export type ClaimApplicationWithDetails = ClaimApplicationRow & {
  applicantName: string | null;
  documents: ClaimDocumentRow[];
  lineItems: ClaimLineItemWithMeta[];
  entertainmentDetails: ClaimEntertainmentDetailWithMeta[];
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

async function generateJournalEntryNo(orgId: string): Promise<string> {
  const year = new Date().getFullYear();
  const rows = await db
    .select({ entryNo: ledgerEntry.entryNo })
    .from(ledgerEntry)
    .where(and(eq(ledgerEntry.organizationId, orgId), sql`${ledgerEntry.entryNo} LIKE ${`JE-${year}-%`}`))
    .orderBy(desc(ledgerEntry.entryNo));
  let next = 1;
  if (rows.length > 0) {
    const parts = rows[0].entryNo.split("-");
    const num = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(num)) next = num + 1;
  }
  return `JE-${year}-${String(next).padStart(4, "0")}`;
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
): Promise<boolean> {
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
  if (approvers.length === 0) return false;
  const notifs = approvers.map((a) => ({
    id: nanoid(),
    organizationId: orgId,
    userId: a.userId,
    ...notifData,
    isRead: 0,
    createdAt: new Date(),
  }));
  await db.insert(notification).values(notifs);
  return true;
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
  lineMap: Record<string, ClaimLineItemWithMeta[]>;
  entMap: Record<string, ClaimEntertainmentDetailWithMeta[]>;
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
      .where(inArray(claimEntertainmentDetail.applicationId, appIds))
      .orderBy(asc(claimEntertainmentDetail.sortOrder), asc(claimEntertainmentDetail.createdAt)),
  ]);

  // Resolve editedBy/slashedBy user ids to display names in a single batch query
  const userIds = [
    ...new Set(
      [...lines, ...ents].flatMap((r) => [r.editedBy, r.slashedBy]).filter((id): id is string => !!id),
    ),
  ];
  const nameMap: Record<string, string | null> = {};
  if (userIds.length > 0) {
    const users = await db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, userIds));
    for (const u of users) nameMap[u.id] = u.name;
  }

  const docMap: Record<string, ClaimDocumentRow[]> = {};
  for (const doc of docs) {
    if (!docMap[doc.applicationId]) docMap[doc.applicationId] = [];
    docMap[doc.applicationId].push(doc);
  }
  const lineMap: Record<string, ClaimLineItemWithMeta[]> = {};
  for (const li of lines) {
    if (!lineMap[li.applicationId]) lineMap[li.applicationId] = [];
    lineMap[li.applicationId].push({
      ...li,
      editedByName: li.editedBy ? nameMap[li.editedBy] ?? null : null,
      slashedByName: li.slashedBy ? nameMap[li.slashedBy] ?? null : null,
    });
  }
  const entMap: Record<string, ClaimEntertainmentDetailWithMeta[]> = {};
  for (const e of ents) {
    if (!entMap[e.applicationId]) entMap[e.applicationId] = [];
    entMap[e.applicationId].push({
      ...e,
      editedByName: e.editedBy ? nameMap[e.editedBy] ?? null : null,
      slashedByName: e.slashedBy ? nameMap[e.slashedBy] ?? null : null,
    });
  }
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
  debitAccountId?: string;
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
    debitAccountId: data.debitAccountId ?? null,
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
    debitAccountId: string | null;
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
    entertainmentDetails: entMap[a.id] ?? [],
  }));
}

export async function getPendingClaimApprovals(): Promise<ClaimApplicationWithDetails[]> {
  const { orgId } = await requireAccess("claim:approve");
  const apps = await db
    .select({ app: claimApplication, applicantName: user.name })
    .from(claimApplication)
    .leftJoin(user, eq(claimApplication.userId, user.id))
    .where(and(eq(claimApplication.organizationId, orgId), eq(claimApplication.status, "CHECKED")))
    .orderBy(asc(claimApplication.claimDate));

  if (apps.length === 0) return [];
  const appIds = apps.map((a) => a.app.id);
  const { docMap, lineMap, entMap } = await loadExtras(appIds);

  return apps.map(({ app, applicantName }) => ({
    ...app,
    applicantName: applicantName ?? null,
    documents: docMap[app.id] ?? [],
    lineItems: lineMap[app.id] ?? [],
    entertainmentDetails: entMap[app.id] ?? [],
  }));
}

/* =========================
   CATEGORY → ACCOUNT MAPPING
========================= */

export type ClaimCategoryAccountRow = typeof claimCategoryAccount.$inferSelect;

export async function getClaimCategoryAccounts(): Promise<ClaimCategoryAccountRow[]> {
  const { orgId } = await requireAccess("claim:manage");
  return db
    .select()
    .from(claimCategoryAccount)
    .where(eq(claimCategoryAccount.organizationId, orgId));
}

// Upsert if ledgerAccountId provided; delete mapping if null.
export async function setClaimCategoryAccount(
  category: string,
  ledgerAccountId: string | null,
): Promise<void> {
  const { orgId } = await requireAccess("claim:manage");
  if (!ledgerAccountId) {
    await db
      .delete(claimCategoryAccount)
      .where(
        and(
          eq(claimCategoryAccount.organizationId, orgId),
          eq(claimCategoryAccount.category, category),
        ),
      );
    return;
  }
  const existing = await db
    .select({ id: claimCategoryAccount.id })
    .from(claimCategoryAccount)
    .where(
      and(
        eq(claimCategoryAccount.organizationId, orgId),
        eq(claimCategoryAccount.category, category),
      ),
    )
    .limit(1);

  if (existing[0]) {
    await db
      .update(claimCategoryAccount)
      .set({ ledgerAccountId, updatedAt: new Date() })
      .where(eq(claimCategoryAccount.id, existing[0].id));
  } else {
    await db.insert(claimCategoryAccount).values({
      id: nanoid(),
      organizationId: orgId,
      category,
      ledgerAccountId,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }
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
    if (!data.entertainmentDetails || data.entertainmentDetails.length === 0) throw new Error("At least one entertainment detail is required");
    totalAmount = data.entertainmentDetails.reduce((s, ed) => s + parseFloat(ed.amount), 0);
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

  // ── Insert entertainment details ──────────────────────────────────────────
  if (formType === CLAIM_FORM.ENTERTAINMENT_FORM && data.entertainmentDetails && data.entertainmentDetails.length > 0) {
    await db.insert(claimEntertainmentDetail).values(
      data.entertainmentDetails.map((ed, idx) => ({
        id: nanoid(),
        applicationId: appId,
        organizationId: orgId,
        eventDate: ed.eventDate,
        restaurantName: ed.restaurantName.trim(),
        customerName: ed.customerName.trim(),
        departmentOrganization: ed.departmentOrganization.trim(),
        purpose: ed.purpose.trim(),
        amount: ed.amount,
        sortOrder: idx,
        createdAt: new Date(),
      })),
    );
  }

  // Notify checkers first; if none exist, fall through to approvers
  const checkersNotified = await notifyUsersWithPermission(orgId, "claim:check", {
    type: "claim:submitted",
    title: `Claim: ${ct.name}`,
    body: `${userName} submitted a ${ct.name} for RM ${totalAmount.toFixed(2)}`,
    link: `/dashboard/human-resources/claim/checker`,
  });
  if (!checkersNotified) {
    await notifyUsersWithPermission(orgId, "claim:approve", {
      type: "claim:submitted",
      title: `Claim: ${ct.name}`,
      body: `${userName} submitted a ${ct.name} for RM ${totalAmount.toFixed(2)}`,
      link: `/dashboard/human-resources/claim/approvals`,
    });
  }

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
  if (app[0].status !== "CHECKED" && app[0].status !== "PENDING") throw new Error("Only checked applications can be approved");
  if (app[0].userId === userId) throw new Error("You cannot approve your own claim");

  await db
    .update(claimApplication)
    .set({ status: "APPROVED", reviewedBy: userId, reviewedAt: new Date(), reviewComment: comment?.trim() ?? null, updatedAt: new Date() })
    .where(eq(claimApplication.id, appId));

  // ── Auto-post journal entry ────────────────────────────────────────────────
  // Failure does NOT roll back the approval.
  try {
    // Require a Staff Claims Payable credit account
    const [creditAcc] = await db
      .select()
      .from(ledgerAccount)
      .where(and(
        eq(ledgerAccount.organizationId, orgId),
        eq(ledgerAccount.subtype, "STAFF_CLAIMS_PAYABLE"),
        eq(ledgerAccount.isActive, true),
      ))
      .limit(1);

    if (creditAcc) {
      const [ct] = await db
        .select({ debitAccountId: claimType.debitAccountId })
        .from(claimType)
        .where(eq(claimType.id, app[0].claimTypeId))
        .limit(1);
      const fallbackAccountId = ct?.debitAccountId ?? null;

      // Fetch per-category account mappings for this org
      const categoryMappings = await db
        .select({ category: claimCategoryAccount.category, ledgerAccountId: claimCategoryAccount.ledgerAccountId })
        .from(claimCategoryAccount)
        .where(eq(claimCategoryAccount.organizationId, orgId));
      const catMap = Object.fromEntries(categoryMappings.map((m) => [m.category, m.ledgerAccountId]));

      // Fetch the claim's line items (excluding any slashed by the checker)
      const lineItems = await db
        .select({ category: claimLineItem.category, amountMyr: claimLineItem.amountMyr })
        .from(claimLineItem)
        .where(and(eq(claimLineItem.applicationId, appId), eq(claimLineItem.slashed, false)));

      // Fetch entertainment detail if present (excluding any slashed by the checker)
      const [entDetail] = await db
        .select({ amount: claimEntertainmentDetail.amount })
        .from(claimEntertainmentDetail)
        .where(and(eq(claimEntertainmentDetail.applicationId, appId), eq(claimEntertainmentDetail.slashed, false)))
        .limit(1);

      // Build debit lines: group amount by resolved accountId
      // Resolution order: category mapping → fallback (claimType.debitAccountId)
      const debitBuckets = new Map<string, number>(); // accountId → total MYR

      const addToBucket = (accountId: string | null, amount: number) => {
        if (!accountId || amount <= 0) return;
        debitBuckets.set(accountId, (debitBuckets.get(accountId) ?? 0) + amount);
      };

      if (lineItems.length > 0) {
        for (const li of lineItems) {
          const accountId = catMap[li.category] ?? fallbackAccountId;
          addToBucket(accountId, parseFloat(li.amountMyr));
        }
      } else if (entDetail) {
        // ENTERTAINMENT_FORM — one line
        const accountId = catMap["ENTERTAINMENT_FORM"] ?? fallbackAccountId;
        addToBucket(accountId, parseFloat(entDetail.amount));
      }

      // Verify total debits = claim total (guard against rounding drift)
      const totalDebit = [...debitBuckets.values()].reduce((s, v) => s + v, 0);
      if (totalDebit <= 0) {
        // No account mapped anywhere — skip journal silently
        console.warn("[approveClaim] no debit accounts resolved for claim", appId);
      } else {
        // Fetch account details for all debit buckets
        const debitAccountIds = [...debitBuckets.keys()];
        const debitAccounts = await db
          .select()
          .from(ledgerAccount)
          .where(inArray(ledgerAccount.id, debitAccountIds));
        const debitAccMap = Object.fromEntries(debitAccounts.map((a) => [a.id, a]));

        // Resolve member for stakeholder tagging
        const [memberRow] = await db
          .select({ id: member.id })
          .from(member)
          .where(and(eq(member.userId, app[0].userId), eq(member.organizationId, orgId), isNull(member.deletedAt)))
          .limit(1);
        const [applicantRow] = await db
          .select({ name: user.name })
          .from(user)
          .where(eq(user.id, app[0].userId))
          .limit(1);
        const applicantName = applicantRow?.name ?? "Unknown";

        const entryNo = await generateJournalEntryNo(orgId);
        const entryId = nanoid();
        const creditAmount = totalDebit.toFixed(2);

        await db.insert(ledgerEntry).values({
          id: entryId,
          organizationId: orgId,
          entryNo,
          date: app[0].claimDate,
          description: `Staff claim: ${app[0].claimTypeName} — ${app[0].applicationNo} (${applicantName})`,
          transactionType: "GENERAL_EXPENSE",
          referenceType: "CLAIM_APPLICATION",
          referenceId: appId,
          referenceNo: app[0].applicationNo,
          stakeholderType: "MEMBER",
          stakeholderId: memberRow?.id ?? app[0].userId,
          stakeholderName: applicantName,
          totalAmount: creditAmount,
          status: "POSTED",
          postedAt: new Date(),
          createdBy: userId,
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        const debitLines = [...debitBuckets.entries()].map(([accountId, amount]) => ({
          id: nanoid(),
          entryId,
          accountId,
          accountCode: debitAccMap[accountId]?.code ?? "",
          accountName: debitAccMap[accountId]?.name ?? "",
          debit: amount.toFixed(2),
          credit: "0.00",
          currency: null as string | null,
          amountForeign: null as string | null,
          exchangeRate: null as string | null,
          description: `${app[0].claimTypeName} — ${app[0].applicationNo}`,
          createdAt: new Date(),
        }));

        const creditLine = {
          id: nanoid(),
          entryId,
          accountId: creditAcc.id,
          accountCode: creditAcc.code,
          accountName: creditAcc.name,
          debit: "0.00",
          credit: creditAmount,
          currency: null as string | null,
          amountForeign: null as string | null,
          exchangeRate: null as string | null,
          description: `${app[0].claimTypeName} — ${applicantName}`,
          createdAt: new Date(),
        };

        await db.insert(ledgerLine).values([...debitLines, creditLine]);
        await db
          .update(claimApplication)
          .set({ journalEntryId: entryId })
          .where(eq(claimApplication.id, appId));
      }
    }
  } catch (journalErr) {
    console.error("[approveClaim] journal posting failed (claim still approved):", journalErr);
  }

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
  if (app[0].status !== "CHECKED" && app[0].status !== "PENDING") throw new Error("Only checked or pending applications can be rejected");

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
   DRAFT / EDIT / RESUBMIT
========================= */

// Shared helper: replace line items + entertainment detail for an existing application.
// Deletes and reinserts every row with fresh ids, so any checker edit/slash annotations
// (editedBy/editReason, slashed/slashReason) are intentionally wiped — a resubmission
// starts a fresh review cycle, not a continuation of the prior one.
async function replaceClaimItems(
  appId: string,
  orgId: string,
  data: ApplyClaimInput,
  ct: ClaimTypeRow,
): Promise<number> {
  const formType = ct.category as ClaimFormType;
  let totalAmount: number;
  if (formType === CLAIM_FORM.ENTERTAINMENT_FORM) {
    totalAmount = (data.entertainmentDetails ?? []).reduce((s, ed) => s + parseFloat(ed.amount), 0);
  } else {
    totalAmount = (data.lineItems ?? []).reduce((s, li) => s + parseFloat(li.amountMyr), 0);
  }

  await db.delete(claimLineItem).where(eq(claimLineItem.applicationId, appId));
  await db.delete(claimEntertainmentDetail).where(eq(claimEntertainmentDetail.applicationId, appId));

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
  if (formType === CLAIM_FORM.ENTERTAINMENT_FORM && data.entertainmentDetails && data.entertainmentDetails.length > 0) {
    await db.insert(claimEntertainmentDetail).values(
      data.entertainmentDetails.map((ed, idx) => ({
        id: nanoid(),
        applicationId: appId,
        organizationId: orgId,
        eventDate: ed.eventDate,
        restaurantName: ed.restaurantName.trim(),
        customerName: ed.customerName.trim(),
        departmentOrganization: ed.departmentOrganization.trim(),
        purpose: ed.purpose.trim(),
        amount: ed.amount,
        sortOrder: idx,
        createdAt: new Date(),
      })),
    );
  }
  return totalAmount;
}

export async function saveDraftClaim(data: ApplyClaimInput): Promise<string> {
  const { orgId, userId } = await requireAccess("claim:apply");
  const type = await db.select().from(claimType).where(and(eq(claimType.id, data.claimTypeId), eq(claimType.organizationId, orgId))).limit(1);
  if (!type[0]) throw new Error("Claim type not found");
  const ct = type[0];
  const claimDate = /^\d{4}-\d{2}$/.test(data.claimPeriod) ? `${data.claimPeriod}-01` : data.claimPeriod;
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
    description: data.description.trim() || "Draft",
    unitType: ct.unitType,
    quantity: null,
    ratePerUnit: ct.ratePerUnit ?? null,
    amount: "0",
    status: "DRAFT",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  await replaceClaimItems(appId, orgId, data, ct);
  return appId;
}

export async function updateDraftClaim(draftId: string, data: ApplyClaimInput): Promise<void> {
  const { orgId, userId } = await requireAccess("claim:apply");
  const app = await db.select().from(claimApplication).where(and(eq(claimApplication.id, draftId), eq(claimApplication.organizationId, orgId))).limit(1);
  if (!app[0] || app[0].userId !== userId) throw new Error("Draft not found");
  if (app[0].status !== "DRAFT") throw new Error("Only drafts can be updated this way");
  const claimDate = /^\d{4}-\d{2}$/.test(data.claimPeriod) ? `${data.claimPeriod}-01` : data.claimPeriod;
  const ct = app[0];
  const type = await db.select().from(claimType).where(eq(claimType.id, data.claimTypeId)).limit(1);
  if (!type[0]) throw new Error("Claim type not found");
  const totalAmount = await replaceClaimItems(draftId, orgId, data, type[0]);
  await db.update(claimApplication).set({
    claimTypeId: data.claimTypeId,
    claimTypeName: type[0].name,
    claimTypeCode: type[0].code,
    claimDate,
    description: data.description.trim() || "Draft",
    amount: totalAmount.toFixed(2),
    updatedAt: new Date(),
  }).where(eq(claimApplication.id, draftId));
}

export async function finalizeDraftClaim(draftId: string, data: ApplyClaimInput): Promise<void> {
  const { orgId, userId, userName } = await requireAccess("claim:apply");
  const app = await db.select().from(claimApplication).where(and(eq(claimApplication.id, draftId), eq(claimApplication.organizationId, orgId))).limit(1);
  if (!app[0] || app[0].userId !== userId) throw new Error("Draft not found");
  if (app[0].status !== "DRAFT") throw new Error("Only drafts can be finalized");
  const type = await db.select().from(claimType).where(and(eq(claimType.id, data.claimTypeId), eq(claimType.organizationId, orgId))).limit(1);
  if (!type[0] || !type[0].isActive) throw new Error("Claim type not found or inactive");
  const ct = type[0];
  const formType = ct.category as ClaimFormType;
  let totalAmount: number;
  if (formType === CLAIM_FORM.ENTERTAINMENT_FORM) {
    if (!data.entertainmentDetails || data.entertainmentDetails.length === 0) throw new Error("At least one entertainment detail required");
    totalAmount = data.entertainmentDetails.reduce((s, ed) => s + parseFloat(ed.amount), 0);
  } else {
    if (!data.lineItems || data.lineItems.length === 0) throw new Error("At least one expense item required");
    totalAmount = data.lineItems.reduce((s, li) => s + parseFloat(li.amountMyr), 0);
  }
  if (isNaN(totalAmount) || totalAmount <= 0) throw new Error("Total amount must be greater than 0");
  const claimDate = /^\d{4}-\d{2}$/.test(data.claimPeriod) ? `${data.claimPeriod}-01` : data.claimPeriod;
  const totalAmountFinal = await replaceClaimItems(draftId, orgId, data, ct);
  await db.update(claimApplication).set({
    claimTypeId: ct.id,
    claimTypeName: ct.name,
    claimTypeCode: ct.code,
    claimDate,
    description: data.description.trim(),
    amount: totalAmountFinal.toFixed(2),
    status: "PENDING",
    updatedAt: new Date(),
  }).where(eq(claimApplication.id, draftId));
  const checkersNotified = await notifyUsersWithPermission(orgId, "claim:check", {
    type: "claim:submitted",
    title: `Claim: ${ct.name}`,
    body: `${userName} submitted a ${ct.name} for RM ${totalAmountFinal.toFixed(2)}`,
    link: `/dashboard/human-resources/claim/checker`,
  });
  if (!checkersNotified) {
    await notifyUsersWithPermission(orgId, "claim:approve", {
      type: "claim:submitted",
      title: `Claim: ${ct.name}`,
      body: `${userName} submitted a ${ct.name} for RM ${totalAmountFinal.toFixed(2)}`,
      link: `/dashboard/human-resources/claim/approvals`,
    });
  }
}

export async function resubmitRejectedClaim(appId: string, data: ApplyClaimInput): Promise<void> {
  const { orgId, userId, userName } = await requireAccess("claim:apply");
  const app = await db.select().from(claimApplication).where(and(eq(claimApplication.id, appId), eq(claimApplication.organizationId, orgId))).limit(1);
  if (!app[0] || app[0].userId !== userId) throw new Error("Application not found");
  if (app[0].status !== "REJECTED") throw new Error("Only rejected claims can be resubmitted");
  const type = await db.select().from(claimType).where(and(eq(claimType.id, data.claimTypeId), eq(claimType.organizationId, orgId))).limit(1);
  if (!type[0] || !type[0].isActive) throw new Error("Claim type not found or inactive");
  const ct = type[0];
  const formType = ct.category as ClaimFormType;
  let totalAmount: number;
  if (formType === CLAIM_FORM.ENTERTAINMENT_FORM) {
    if (!data.entertainmentDetails || data.entertainmentDetails.length === 0) throw new Error("At least one entertainment detail required");
    totalAmount = data.entertainmentDetails.reduce((s, ed) => s + parseFloat(ed.amount), 0);
  } else {
    if (!data.lineItems || data.lineItems.length === 0) throw new Error("At least one expense item required");
    totalAmount = data.lineItems.reduce((s, li) => s + parseFloat(li.amountMyr), 0);
  }
  if (isNaN(totalAmount) || totalAmount <= 0) throw new Error("Total amount must be greater than 0");
  const claimDate = /^\d{4}-\d{2}$/.test(data.claimPeriod) ? `${data.claimPeriod}-01` : data.claimPeriod;
  const totalAmountFinal = await replaceClaimItems(appId, orgId, data, ct);
  await db.update(claimApplication).set({
    claimDate,
    description: data.description.trim(),
    amount: totalAmountFinal.toFixed(2),
    status: "PENDING",
    reviewedBy: null,
    reviewedAt: null,
    reviewComment: null,
    checkedBy: null,
    checkedAt: null,
    checkerComment: null,
    updatedAt: new Date(),
  }).where(eq(claimApplication.id, appId));
  const checkersNotified = await notifyUsersWithPermission(orgId, "claim:check", {
    type: "claim:submitted",
    title: `Claim: ${ct.name}`,
    body: `${userName} resubmitted a ${ct.name} for RM ${totalAmountFinal.toFixed(2)}`,
    link: `/dashboard/human-resources/claim/checker`,
  });
  if (!checkersNotified) {
    await notifyUsersWithPermission(orgId, "claim:approve", {
      type: "claim:submitted",
      title: `Claim: ${ct.name}`,
      body: `${userName} resubmitted a ${ct.name} for RM ${totalAmountFinal.toFixed(2)}`,
      link: `/dashboard/human-resources/claim/approvals`,
    });
  }
}

export async function deleteClaim(appId: string): Promise<void> {
  const { orgId, userId } = await requireAccess("claim:apply");
  const app = await db.select().from(claimApplication).where(and(eq(claimApplication.id, appId), eq(claimApplication.organizationId, orgId))).limit(1);
  if (!app[0]) throw new Error("Application not found");
  if (app[0].userId !== userId) throw new Error("You can only delete your own claims");
  if (app[0].status === "APPROVED") throw new Error("Approved claims cannot be deleted");
  if (app[0].status === "DRAFT" || app[0].status === "CANCELLED") {
    // Fetch docs first so we can clean up R2 after the cascade
    const docs = await db.select({ fileKey: claimDocument.fileKey }).from(claimDocument).where(eq(claimDocument.applicationId, appId));
    // Hard delete — cascade removes line items, entertainment, documents
    await db.delete(claimApplication).where(eq(claimApplication.id, appId));
    // Best-effort R2 cleanup after DB is clean
    await Promise.allSettled(docs.map(d => deleteClaimDocFromR2(d.fileKey)));
  } else {
    // Soft delete: mark as CANCELLED
    await db.update(claimApplication).set({
      status: "CANCELLED",
      cancelledBy: userId,
      cancelledAt: new Date(),
      cancelReason: "Withdrawn by submitter",
      updatedAt: new Date(),
    }).where(eq(claimApplication.id, appId));
  }
}

/* =========================
   CHECKER WORKFLOW
========================= */

export async function getPendingClaimChecks(): Promise<ClaimApplicationWithDetails[]> {
  const { orgId } = await requireAccess("claim:check");
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
    entertainmentDetails: entMap[app.id] ?? [],
  }));
}

// Recomputes claimApplication.amount from all non-slashed line items + entertainment rows
async function recomputeClaimTotal(appId: string): Promise<string> {
  const [lineSum, entSum] = await Promise.all([
    db
      .select({ amt: sql<string>`coalesce(sum(${claimLineItem.amountMyr}::numeric), 0)` })
      .from(claimLineItem)
      .where(and(eq(claimLineItem.applicationId, appId), eq(claimLineItem.slashed, false))),
    db
      .select({ amt: sql<string>`coalesce(sum(${claimEntertainmentDetail.amount}::numeric), 0)` })
      .from(claimEntertainmentDetail)
      .where(and(eq(claimEntertainmentDetail.applicationId, appId), eq(claimEntertainmentDetail.slashed, false))),
  ]);
  const total = (parseFloat(lineSum[0]?.amt ?? "0") + parseFloat(entSum[0]?.amt ?? "0")).toFixed(2);
  await db.update(claimApplication).set({ amount: total, updatedAt: new Date() }).where(eq(claimApplication.id, appId));
  return total;
}

async function resolveUserName(userId: string): Promise<string | null> {
  const [u] = await db.select({ name: user.name }).from(user).where(eq(user.id, userId)).limit(1);
  return u?.name ?? null;
}

export async function editClaimLineItem(
  itemId: string,
  data: { amountMyr?: string; description?: string },
  reason: string,
): Promise<{ amountMyr: string; description: string | null; editedByName: string | null; editedAt: Date; newTotal: string }> {
  const { orgId, userId, userName } = await requireAccess("claim:check");
  if (!reason.trim()) throw new Error("An edit reason is required");
  const [item] = await db.select().from(claimLineItem).where(eq(claimLineItem.id, itemId)).limit(1);
  if (!item) throw new Error("Line item not found");
  const [app] = await db
    .select()
    .from(claimApplication)
    .where(and(eq(claimApplication.id, item.applicationId), eq(claimApplication.organizationId, orgId)))
    .limit(1);
  if (!app) throw new Error("Application not found");
  if (app.status !== "PENDING") throw new Error("Only pending applications can be edited");
  if (app.userId === userId) throw new Error("You cannot edit your own claim");

  const patch: { amountMyr?: string; description?: string | null; originalAmountMyr?: string; originalDescription?: string | null; editedBy: string; editedAt: Date; editReason: string } = {
    editedBy: userId,
    editedAt: new Date(),
    editReason: reason.trim(),
  };
  if (data.amountMyr !== undefined) {
    if (item.originalAmountMyr === null) patch.originalAmountMyr = item.amountMyr;
    patch.amountMyr = data.amountMyr;
  }
  if (data.description !== undefined) {
    if (item.originalDescription === null) patch.originalDescription = item.description;
    patch.description = data.description.trim() || null;
  }
  await db.update(claimLineItem).set(patch).where(eq(claimLineItem.id, itemId));
  const newTotal = await recomputeClaimTotal(item.applicationId);
  const editedByName = await resolveUserName(userId);

  const changeDesc = patch.amountMyr !== undefined
    ? `RM ${parseFloat(item.amountMyr).toFixed(2)} → RM ${parseFloat(patch.amountMyr).toFixed(2)}`
    : "description";
  await notifyUser(orgId, app.userId, {
    type: "claim:line-edited",
    title: `Claim Line Edited: ${app.claimTypeName}`,
    body: `${userName} corrected a line item (${changeDesc}) on your ${app.claimTypeName} claim (${app.applicationNo}). Reason: ${reason.trim()}`,
    link: `/dashboard/human-resources/claim`,
  });

  return {
    amountMyr: patch.amountMyr ?? item.amountMyr,
    description: patch.description !== undefined ? patch.description : item.description,
    editedByName,
    editedAt: patch.editedAt,
    newTotal,
  };
}

export async function toggleClaimLineItemSlash(
  itemId: string,
  slashed: boolean,
  reason?: string,
): Promise<{ slashedByName: string | null; slashedAt: Date | null; newTotal: string }> {
  const { orgId, userId, userName } = await requireAccess("claim:check");
  if (slashed && !reason?.trim()) throw new Error("A slash reason is required");
  const [item] = await db.select().from(claimLineItem).where(eq(claimLineItem.id, itemId)).limit(1);
  if (!item) throw new Error("Line item not found");
  const [app] = await db
    .select()
    .from(claimApplication)
    .where(and(eq(claimApplication.id, item.applicationId), eq(claimApplication.organizationId, orgId)))
    .limit(1);
  if (!app) throw new Error("Application not found");
  if (app.status !== "PENDING") throw new Error("Only pending applications can be reviewed");
  if (app.userId === userId) throw new Error("You cannot slash your own claim");

  const now = slashed ? new Date() : null;
  const by = slashed ? userId : null;
  await db
    .update(claimLineItem)
    .set({ slashed, slashedBy: by, slashedAt: now, slashReason: slashed ? (reason?.trim() ?? null) : null })
    .where(eq(claimLineItem.id, itemId));
  const newTotal = await recomputeClaimTotal(item.applicationId);
  const slashedByName = slashed ? await resolveUserName(userId) : null;

  if (slashed) {
    await notifyUser(orgId, app.userId, {
      type: "claim:line-slashed",
      title: `Claim Line Slashed: ${app.claimTypeName}`,
      body: `${userName} slashed a line item (RM ${parseFloat(item.amountMyr).toFixed(2)}) on your ${app.claimTypeName} claim (${app.applicationNo}). Reason: ${reason?.trim()}`,
      link: `/dashboard/human-resources/claim`,
    });
  }

  return { slashedByName, slashedAt: now, newTotal };
}

export async function editClaimEntertainmentDetail(
  itemId: string,
  data: { amount?: string; purpose?: string },
  reason: string,
): Promise<{ amount: string; purpose: string; editedByName: string | null; editedAt: Date; newTotal: string }> {
  const { orgId, userId, userName } = await requireAccess("claim:check");
  if (!reason.trim()) throw new Error("An edit reason is required");
  const [item] = await db.select().from(claimEntertainmentDetail).where(eq(claimEntertainmentDetail.id, itemId)).limit(1);
  if (!item) throw new Error("Entertainment detail not found");
  const [app] = await db
    .select()
    .from(claimApplication)
    .where(and(eq(claimApplication.id, item.applicationId), eq(claimApplication.organizationId, orgId)))
    .limit(1);
  if (!app) throw new Error("Application not found");
  if (app.status !== "PENDING") throw new Error("Only pending applications can be edited");
  if (app.userId === userId) throw new Error("You cannot edit your own claim");

  const patch: { amount?: string; purpose?: string; originalAmount?: string; originalPurpose?: string; editedBy: string; editedAt: Date; editReason: string } = {
    editedBy: userId,
    editedAt: new Date(),
    editReason: reason.trim(),
  };
  if (data.amount !== undefined) {
    if (item.originalAmount === null) patch.originalAmount = item.amount;
    patch.amount = data.amount;
  }
  if (data.purpose !== undefined) {
    if (item.originalPurpose === null) patch.originalPurpose = item.purpose;
    patch.purpose = data.purpose.trim();
  }
  await db.update(claimEntertainmentDetail).set(patch).where(eq(claimEntertainmentDetail.id, itemId));
  const newTotal = await recomputeClaimTotal(item.applicationId);
  const editedByName = await resolveUserName(userId);

  const changeDesc = patch.amount !== undefined
    ? `RM ${parseFloat(item.amount).toFixed(2)} → RM ${parseFloat(patch.amount).toFixed(2)}`
    : "purpose";
  await notifyUser(orgId, app.userId, {
    type: "claim:line-edited",
    title: `Claim Entry Edited: ${app.claimTypeName}`,
    body: `${userName} corrected an entertainment entry (${changeDesc}) on your ${app.claimTypeName} claim (${app.applicationNo}). Reason: ${reason.trim()}`,
    link: `/dashboard/human-resources/claim`,
  });

  return {
    amount: patch.amount ?? item.amount,
    purpose: patch.purpose ?? item.purpose,
    editedByName,
    editedAt: patch.editedAt,
    newTotal,
  };
}

export async function toggleClaimEntertainmentDetailSlash(
  itemId: string,
  slashed: boolean,
  reason?: string,
): Promise<{ slashedByName: string | null; slashedAt: Date | null; newTotal: string }> {
  const { orgId, userId, userName } = await requireAccess("claim:check");
  if (slashed && !reason?.trim()) throw new Error("A slash reason is required");
  const [item] = await db.select().from(claimEntertainmentDetail).where(eq(claimEntertainmentDetail.id, itemId)).limit(1);
  if (!item) throw new Error("Entertainment detail not found");
  const [app] = await db
    .select()
    .from(claimApplication)
    .where(and(eq(claimApplication.id, item.applicationId), eq(claimApplication.organizationId, orgId)))
    .limit(1);
  if (!app) throw new Error("Application not found");
  if (app.status !== "PENDING") throw new Error("Only pending applications can be reviewed");
  if (app.userId === userId) throw new Error("You cannot slash your own claim");

  const now = slashed ? new Date() : null;
  const by = slashed ? userId : null;
  await db
    .update(claimEntertainmentDetail)
    .set({ slashed, slashedBy: by, slashedAt: now, slashReason: slashed ? (reason?.trim() ?? null) : null })
    .where(eq(claimEntertainmentDetail.id, itemId));
  const newTotal = await recomputeClaimTotal(item.applicationId);
  const slashedByName = slashed ? await resolveUserName(userId) : null;

  if (slashed) {
    await notifyUser(orgId, app.userId, {
      type: "claim:line-slashed",
      title: `Claim Entry Slashed: ${app.claimTypeName}`,
      body: `${userName} slashed an entertainment entry (RM ${parseFloat(item.amount).toFixed(2)}) on your ${app.claimTypeName} claim (${app.applicationNo}). Reason: ${reason?.trim()}`,
      link: `/dashboard/human-resources/claim`,
    });
  }

  return { slashedByName, slashedAt: now, newTotal };
}

export async function checkClaim(appId: string, comment?: string): Promise<void> {
  const { orgId, userId, userName } = await requireAccess("claim:check");
  const app = await db.select().from(claimApplication).where(and(eq(claimApplication.id, appId), eq(claimApplication.organizationId, orgId))).limit(1);
  if (!app[0]) throw new Error("Application not found");
  if (app[0].status !== "PENDING") throw new Error("Only pending applications can be checked");
  if (app[0].userId === userId) throw new Error("You cannot check your own claim");
  await db.update(claimApplication).set({
    status: "CHECKED",
    checkedBy: userId,
    checkedAt: new Date(),
    checkerComment: comment?.trim() ?? null,
    updatedAt: new Date(),
  }).where(eq(claimApplication.id, appId));
  await notifyUsersWithPermission(orgId, "claim:approve", {
    type: "claim:checked",
    title: `Claim Ready for Approval`,
    body: `${userName} checked a claim from ${app[0].claimTypeName} — RM ${app[0].amount}`,
    link: `/dashboard/human-resources/claim/approvals`,
  });
}

export async function rejectByChecker(appId: string, reason: string): Promise<void> {
  const { orgId, userId } = await requireAccess("claim:check");
  const app = await db.select().from(claimApplication).where(and(eq(claimApplication.id, appId), eq(claimApplication.organizationId, orgId))).limit(1);
  if (!app[0]) throw new Error("Application not found");
  if (app[0].status !== "PENDING") throw new Error("Only pending applications can be rejected by checker");
  if (app[0].userId === userId) throw new Error("You cannot reject your own claim");
  await db.update(claimApplication).set({
    status: "REJECTED",
    checkedBy: userId,
    checkedAt: new Date(),
    checkerComment: reason.trim(),
    updatedAt: new Date(),
  }).where(eq(claimApplication.id, appId));
  await notifyUser(orgId, app[0].userId, {
    type: "claim:rejected",
    title: "Claim Rejected",
    body: `Your ${app[0].claimTypeName} claim was rejected by the checker: ${reason.trim()}`,
    link: `/dashboard/human-resources/claim`,
  });
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
  // Best-effort R2 cleanup — DB is already clean so ignore R2 errors
  await deleteClaimDocFromR2(doc[0].fileKey).catch(() => {});
  return doc[0].fileKey;
}

/* =========================
   CUSTOMER LOOKUP FOR ENTERTAINMENT FORM
========================= */

export type ClaimCustomerOption = {
  id: string;
  name: string;
  organizationName: string | null;
};

export async function getCustomersForClaim(): Promise<ClaimCustomerOption[]> {
  const { orgId } = await requireAccess("claim:apply");

  const rows = await db
    .select({
      id: customer.id,
      name: customer.name,
      organizationName: customer.organizationName,
    })
    .from(customer)
    .where(eq(customer.organizationId, orgId))
    .orderBy(asc(customer.name));

  return rows;
}
