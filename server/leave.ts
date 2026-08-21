"use server";

import { db } from "@/db";
import {
  leaveType,
  leaveEntitlement,
  leaveApplication,
  leaveDocument,
  member,
  user,
  notification,
} from "@/db/schema";
import { getCachedSession } from "@/lib/auth/cached-session";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";
import { assertSelfActionAllowed } from "@/lib/approvals/guard";
import { notifyUsersWithPermission } from "@/server/notifications";
import { nanoid } from "nanoid";
import { eq, and, desc, asc, inArray, sql, ne, isNull, gte, lte } from "drizzle-orm";

/* =========================
   TYPES
========================= */

export type LeaveTypeRow = typeof leaveType.$inferSelect;
export type LeaveEntitlementRow = typeof leaveEntitlement.$inferSelect;
export type LeaveApplicationRow = typeof leaveApplication.$inferSelect;
export type LeaveDocumentRow = typeof leaveDocument.$inferSelect;

export type LeaveApplicationWithDetails = LeaveApplicationRow & {
  applicantName: string | null;
  documents: LeaveDocumentRow[];
};

export type LeaveBalanceBreakdownItem = {
  code: string;
  name: string;
  usedDays: string;
  pendingDays: string;
};

export type MyLeaveBalance = LeaveEntitlementRow & {
  leaveTypeName: string;
  leaveTypeCode: string;
  isPaid: boolean;
  allowHalfDay: boolean;
  emergencyThresholdDays: number | null;
  remainingDays: string;
  openingBalanceSetByName: string | null;
  openingUsedDaysSetByName: string | null;
  // Splits usedDays/pendingDays by the label actually recorded on each
  // application (leaveApplication.leaveTypeCode/Name) rather than this
  // type's own code — so Annual Leave's card can show how much of its
  // usage was auto-classified as Emergency Leave, even though both draw
  // from this same entitlement. Length 1 (matching the type itself) when
  // nothing has ever split off it.
  breakdown: LeaveBalanceBreakdownItem[];
};

export type ApplyLeaveInput = {
  leaveTypeId: string;
  startDate: string;
  endDate: string;
  isHalfDay: boolean;
  halfDayPeriod?: "AM" | "PM";
  reason?: string;
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

function calculateWorkingDays(startDate: string, endDate: string, isHalfDay: boolean): number {
  if (isHalfDay) return 0.5;
  const start = new Date(startDate + "T00:00:00");
  const end = new Date(endDate + "T00:00:00");
  if (start > end) return 0;
  let days = 0;
  const cur = new Date(start);
  while (cur <= end) {
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6) days++;
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}

function calcServiceYears(joinDate: Date): number {
  const ms = Date.now() - joinDate.getTime();
  return ms / (1000 * 60 * 60 * 24 * 365.25);
}

function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function roundToHalfDay(n: number): number {
  return Math.round(n * 2) / 2;
}

// Full-year tier entitlement is only correct for a member who was already
// employed on Jan 1. For the calendar year they actually joined, scale it
// down to the fraction of that year remaining from their hire date onward
// (rounded to the nearest half day). Every later year gets the full amount.
function prorateForJoinYear(fullDays: number, joinDate: Date, year: number): number {
  if (joinDate.getFullYear() < year) return fullDays;
  if (joinDate.getFullYear() > year) return 0; // hasn't joined as of this year
  const yearEnd = new Date(year, 11, 31);
  const daysInYear = isLeapYear(year) ? 366 : 365;
  const msPerDay = 1000 * 60 * 60 * 24;
  const daysRemaining = Math.floor((yearEnd.getTime() - joinDate.getTime()) / msPerDay) + 1;
  return roundToHalfDay(fullDays * daysRemaining / daysInYear);
}

function getEntitledDays(
  rules: Array<{ minYears: number; maxYears: number | null; days: number }>,
  serviceYears: number,
): number {
  const rule = rules.find(
    (r) => serviceYears >= r.minYears && (r.maxYears === null || serviceYears < r.maxYears),
  );
  return rule?.days ?? 0;
}

async function generateApplicationNo(orgId: string): Promise<string> {
  const year = new Date().getFullYear();
  const rows = await db
    .select({ applicationNo: leaveApplication.applicationNo })
    .from(leaveApplication)
    .where(
      and(
        eq(leaveApplication.organizationId, orgId),
        sql`${leaveApplication.applicationNo} LIKE ${`LV-${year}-%`}`,
      ),
    )
    .orderBy(desc(leaveApplication.applicationNo));
  let next = 1;
  if (rows.length > 0) {
    const parts = rows[0].applicationNo.split("-");
    const num = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(num)) next = num + 1;
  }
  return `LV-${year}-${String(next).padStart(4, "0")}`;
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

async function ensureEntitlement(
  orgId: string,
  userId: string,
  type: typeof leaveType.$inferSelect,
  year: number,
): Promise<typeof leaveEntitlement.$inferSelect> {
  const existing = await db
    .select()
    .from(leaveEntitlement)
    .where(
      and(
        eq(leaveEntitlement.organizationId, orgId),
        eq(leaveEntitlement.userId, userId),
        eq(leaveEntitlement.leaveTypeId, type.id),
        eq(leaveEntitlement.year, year),
      ),
    )
    .limit(1);

  const memberRow = await db
    .select()
    .from(member)
    .where(
      and(
        eq(member.organizationId, orgId),
        eq(member.userId, userId),
        isNull(member.deletedAt),
      ),
    )
    .limit(1);
  const joinDate = memberRow[0]?.hireDate
    ? new Date(memberRow[0].hireDate + "T00:00:00")
    : (memberRow[0]?.createdAt ?? new Date());
  const serviceYears = calcServiceYears(joinDate);
  const fullEntitledDays = getEntitledDays(type.entitlementRules, serviceYears);
  const entitledDays = prorateForJoinYear(fullEntitledDays, joinDate, year);

  if (existing[0]) {
    // Keep entitledDays in sync with the leave type's current rules — usedDays/
    // pendingDays/carryForwardDays/openingBalance are persisted state and stay untouched.
    const fresh = entitledDays.toString();
    if (fresh !== existing[0].entitledDays) {
      await db
        .update(leaveEntitlement)
        .set({ entitledDays: fresh, updatedAt: new Date() })
        .where(eq(leaveEntitlement.id, existing[0].id));
      return { ...existing[0], entitledDays: fresh };
    }
    return existing[0];
  }

  let carryForwardDays = 0;
  if (type.carryForwardEnabled) {
    const prevYear = await db
      .select()
      .from(leaveEntitlement)
      .where(
        and(
          eq(leaveEntitlement.organizationId, orgId),
          eq(leaveEntitlement.userId, userId),
          eq(leaveEntitlement.leaveTypeId, type.id),
          eq(leaveEntitlement.year, year - 1),
        ),
      )
      .limit(1);
    if (prevYear[0]) {
      const prevEntitled = parseFloat(prevYear[0].entitledDays);
      const prevUsed = parseFloat(prevYear[0].usedDays);
      const prevCarry = parseFloat(prevYear[0].carryForwardDays);
      const prevRemaining = prevEntitled + prevCarry - prevUsed;
      carryForwardDays =
        prevRemaining > 0
          ? type.maxCarryForward !== null
            ? Math.min(prevRemaining, type.maxCarryForward)
            : prevRemaining
          : 0;
    }
  }

  const row = {
    id: nanoid(),
    organizationId: orgId,
    userId,
    leaveTypeId: type.id,
    year,
    entitledDays: entitledDays.toString(),
    usedDays: "0",
    pendingDays: "0",
    carryForwardDays: carryForwardDays.toString(),
    openingBalance: "0",
    openingBalanceSetBy: null,
    openingBalanceSetAt: null,
    openingUsedDays: "0",
    openingUsedDaysSetBy: null,
    openingUsedDaysSetAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  await db.insert(leaveEntitlement).values(row);
  return row;
}

/* =========================
   LEAVE TYPES CRUD
========================= */

export async function getLeaveTypes(): Promise<LeaveTypeRow[]> {
  const { orgId } = await requireAccess("leave:read:own");
  return db
    .select()
    .from(leaveType)
    .where(eq(leaveType.organizationId, orgId))
    .orderBy(asc(leaveType.sortOrder), asc(leaveType.name));
}

export async function getActiveLeaveTypes(): Promise<LeaveTypeRow[]> {
  const { orgId } = await requireAccess("leave:read:own");
  return db
    .select()
    .from(leaveType)
    .where(and(eq(leaveType.organizationId, orgId), eq(leaveType.isActive, true)))
    .orderBy(asc(leaveType.sortOrder), asc(leaveType.name));
}

export async function createLeaveType(data: {
  name: string;
  code: string;
  isPaid: boolean;
  requiresDocument: boolean;
  allowHalfDay: boolean;
  maxDaysPerApplication?: number;
  carryForwardEnabled: boolean;
  maxCarryForward?: number;
  emergencyThresholdDays?: number;
  entitlementRules: Array<{ minYears: number; maxYears: number | null; days: number }>;
  description?: string;
  sortOrder?: number;
}): Promise<LeaveTypeRow> {
  const { orgId } = await requireAccess("leave:manage");
  const row = {
    id: nanoid(),
    organizationId: orgId,
    name: data.name.trim(),
    code: data.code.trim().toUpperCase(),
    isPaid: data.isPaid,
    isActive: true,
    requiresDocument: data.requiresDocument,
    allowHalfDay: data.allowHalfDay,
    maxDaysPerApplication: data.maxDaysPerApplication ?? null,
    carryForwardEnabled: data.carryForwardEnabled,
    maxCarryForward: data.maxCarryForward ?? null,
    emergencyThresholdDays: data.emergencyThresholdDays ?? null,
    entitlementRules: data.entitlementRules,
    sortOrder: data.sortOrder ?? 0,
    description: data.description?.trim() ?? null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  await db.insert(leaveType).values(row);
  return row;
}

export async function updateLeaveType(
  id: string,
  data: Partial<{
    name: string;
    isPaid: boolean;
    requiresDocument: boolean;
    allowHalfDay: boolean;
    maxDaysPerApplication: number | null;
    carryForwardEnabled: boolean;
    maxCarryForward: number | null;
    emergencyThresholdDays: number | null;
    entitlementRules: Array<{ minYears: number; maxYears: number | null; days: number }>;
    description: string;
    isActive: boolean;
    sortOrder: number;
  }>,
): Promise<void> {
  const { orgId } = await requireAccess("leave:manage");
  await db
    .update(leaveType)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(leaveType.id, id), eq(leaveType.organizationId, orgId)));
}

export async function deleteLeaveType(id: string): Promise<void> {
  const { orgId } = await requireAccess("leave:manage");
  const used = await db
    .select({ id: leaveApplication.id })
    .from(leaveApplication)
    .where(and(eq(leaveApplication.leaveTypeId, id), eq(leaveApplication.organizationId, orgId)))
    .limit(1);
  if (used.length > 0)
    throw new Error("Leave type is used in applications. Deactivate it instead.");
  await db
    .delete(leaveType)
    .where(and(eq(leaveType.id, id), eq(leaveType.organizationId, orgId)));
}

export async function seedDefaultLeaveTypes(): Promise<void> {
  const { orgId } = await requireAccess("leave:manage");
  const existing = await db
    .select({ id: leaveType.id })
    .from(leaveType)
    .where(eq(leaveType.organizationId, orgId))
    .limit(1);
  if (existing.length > 0)
    throw new Error("Leave types already exist. Delete existing ones to re-seed.");

  const defaults = [
    {
      name: "Annual Leave",
      code: "AL",
      isPaid: true,
      requiresDocument: false,
      allowHalfDay: true,
      carryForwardEnabled: true,
      maxCarryForward: 8,
      // Applications of 2 days or fewer are auto-labeled Emergency Leave —
      // still drawn from this same Annual Leave balance, not a separate
      // pool. Adjust per org via Leave Types settings.
      emergencyThresholdDays: 2,
      sortOrder: 1,
      description: "Paid annual leave per Employment Act 1955",
      entitlementRules: [
        { minYears: 0, maxYears: 2, days: 8 },
        { minYears: 2, maxYears: 5, days: 12 },
        { minYears: 5, maxYears: null, days: 16 },
      ],
    },
    {
      name: "Medical/Sick Leave",
      code: "ML",
      isPaid: true,
      requiresDocument: true,
      allowHalfDay: false,
      carryForwardEnabled: false,
      maxCarryForward: null,
      sortOrder: 2,
      description: "Sick leave per Employment Act 1955. MC required.",
      entitlementRules: [
        { minYears: 0, maxYears: 2, days: 14 },
        { minYears: 2, maxYears: 5, days: 18 },
        { minYears: 5, maxYears: null, days: 22 },
      ],
    },
    {
      name: "Hospitalisation Leave",
      code: "HL",
      isPaid: true,
      requiresDocument: true,
      allowHalfDay: false,
      carryForwardEnabled: false,
      maxCarryForward: null,
      sortOrder: 3,
      description: "Hospitalisation leave — total including ML capped at 60 days.",
      entitlementRules: [{ minYears: 0, maxYears: null, days: 60 }],
    },
    {
      name: "Maternity Leave",
      code: "MAT",
      isPaid: true,
      requiresDocument: true,
      allowHalfDay: false,
      carryForwardEnabled: false,
      maxCarryForward: null,
      sortOrder: 4,
      description: "98 days paid maternity leave per Employment Act 1955 (2022 amendment).",
      entitlementRules: [{ minYears: 0, maxYears: null, days: 98 }],
    },
    {
      name: "Paternity Leave",
      code: "PAT",
      isPaid: true,
      requiresDocument: true,
      allowHalfDay: false,
      carryForwardEnabled: false,
      maxCarryForward: null,
      sortOrder: 5,
      description: "7 days paid paternity leave per Employment Act 1955 (2022 amendment).",
      entitlementRules: [{ minYears: 0, maxYears: null, days: 7 }],
    },
    {
      name: "Bereavement Leave",
      code: "BER",
      isPaid: true,
      requiresDocument: false,
      allowHalfDay: false,
      carryForwardEnabled: false,
      maxCarryForward: null,
      maxDaysPerApplication: 3,
      sortOrder: 6,
      description: "3 days paid compassionate/bereavement leave per incident.",
      entitlementRules: [{ minYears: 0, maxYears: null, days: 3 }],
    },
    {
      name: "Unpaid Leave",
      code: "UPL",
      isPaid: false,
      requiresDocument: false,
      allowHalfDay: false,
      carryForwardEnabled: false,
      maxCarryForward: null,
      sortOrder: 8,
      description: "Unpaid leave at employer discretion.",
      entitlementRules: [{ minYears: 0, maxYears: null, days: 999 }],
    },
  ];

  const rows = defaults.map((d) => ({
    id: nanoid(),
    organizationId: orgId,
    name: d.name,
    code: d.code,
    isPaid: d.isPaid,
    isActive: true,
    requiresDocument: d.requiresDocument,
    allowHalfDay: d.allowHalfDay,
    maxDaysPerApplication: (d as { maxDaysPerApplication?: number }).maxDaysPerApplication ?? null,
    carryForwardEnabled: d.carryForwardEnabled,
    maxCarryForward: d.maxCarryForward ?? null,
    emergencyThresholdDays: (d as { emergencyThresholdDays?: number }).emergencyThresholdDays ?? null,
    entitlementRules: d.entitlementRules,
    sortOrder: d.sortOrder,
    description: d.description,
    createdAt: new Date(),
    updatedAt: new Date(),
  }));
  await db.insert(leaveType).values(rows);
}

/* =========================
   LEAVE BALANCES
========================= */

async function computeBalances(orgId: string, userId: string): Promise<MyLeaveBalance[]> {
  const year = new Date().getFullYear();
  const types = await db
    .select()
    .from(leaveType)
    .where(and(eq(leaveType.organizationId, orgId), eq(leaveType.isActive, true)))
    .orderBy(asc(leaveType.sortOrder));

  const ents: (typeof leaveEntitlement.$inferSelect)[] = [];
  for (const type of types) {
    ents.push(await ensureEntitlement(orgId, userId, type, year));
  }

  const setByIds = [...new Set([
    ...ents.map((e) => e.openingBalanceSetBy),
    ...ents.map((e) => e.openingUsedDaysSetBy),
  ].filter((id): id is string => !!id))];
  const nameMap: Record<string, string | null> = {};
  if (setByIds.length > 0) {
    const users = await db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, setByIds));
    for (const u of users) nameMap[u.id] = u.name;
  }

  // Split each type's used/pending by the label actually recorded on each
  // application — a type with emergencyThresholdDays set (normally Annual
  // Leave) draws from one pool but some applications are labeled Emergency
  // Leave, and that split should still be visible per-type.
  const apps = await db
    .select({
      leaveTypeId: leaveApplication.leaveTypeId,
      code: leaveApplication.leaveTypeCode,
      name: leaveApplication.leaveTypeName,
      status: leaveApplication.status,
      totalDays: leaveApplication.totalDays,
    })
    .from(leaveApplication)
    .where(
      and(
        eq(leaveApplication.organizationId, orgId),
        eq(leaveApplication.userId, userId),
        inArray(leaveApplication.status, ["APPROVED", "PENDING"]),
        gte(leaveApplication.startDate, `${year}-01-01`),
        lte(leaveApplication.startDate, `${year}-12-31`),
      ),
    );

  const breakdownByType = new Map<string, Map<string, LeaveBalanceBreakdownItem>>();
  for (const a of apps) {
    if (!breakdownByType.has(a.leaveTypeId)) breakdownByType.set(a.leaveTypeId, new Map());
    const byLabel = breakdownByType.get(a.leaveTypeId)!;
    if (!byLabel.has(a.code)) byLabel.set(a.code, { code: a.code, name: a.name, usedDays: "0", pendingDays: "0" });
    const item = byLabel.get(a.code)!;
    if (a.status === "APPROVED") item.usedDays = (parseFloat(item.usedDays) + parseFloat(a.totalDays)).toFixed(2);
    else item.pendingDays = (parseFloat(item.pendingDays) + parseFloat(a.totalDays)).toFixed(2);
  }

  return types.map((type, i) => {
    const ent = ents[i];
    const entitled = parseFloat(ent.entitledDays);
    const carry = parseFloat(ent.carryForwardDays);
    const opening = parseFloat(ent.openingBalance);
    const openingUsed = parseFloat(ent.openingUsedDays);
    const used = parseFloat(ent.usedDays);
    const pending = parseFloat(ent.pendingDays);
    const remaining = entitled + carry + opening - openingUsed - used - pending;
    const byLabel = breakdownByType.get(type.id);
    const breakdown = byLabel && byLabel.size > 0
      ? [...byLabel.values()].sort((a, b) => (a.code === type.code ? -1 : b.code === type.code ? 1 : 0))
      : [{ code: type.code, name: type.name, usedDays: ent.usedDays, pendingDays: ent.pendingDays }];
    return {
      ...ent,
      leaveTypeName: type.name,
      leaveTypeCode: type.code,
      isPaid: type.isPaid,
      allowHalfDay: type.allowHalfDay,
      emergencyThresholdDays: type.emergencyThresholdDays,
      remainingDays: remaining.toFixed(1),
      openingBalanceSetByName: ent.openingBalanceSetBy ? nameMap[ent.openingBalanceSetBy] ?? null : null,
      openingUsedDaysSetByName: ent.openingUsedDaysSetBy ? nameMap[ent.openingUsedDaysSetBy] ?? null : null,
      breakdown,
    };
  });
}

export async function getMyLeaveBalances(): Promise<MyLeaveBalance[]> {
  const { orgId, userId } = await requireAccess("leave:read:own");
  return computeBalances(orgId, userId);
}

export async function getMemberLeaveBalances(userId: string): Promise<MyLeaveBalance[]> {
  const { orgId } = await requireAccess("leave:manage");
  return computeBalances(orgId, userId);
}

export async function setOpeningBalance(
  userId: string,
  leaveTypeId: string,
  year: number,
  days: number,
): Promise<void> {
  const { orgId, userId: actorId } = await requireAccess("leave:manage");
  if (!Number.isFinite(days) || days < 0) throw new Error("Opening balance must be a non-negative number");

  const [type] = await db
    .select()
    .from(leaveType)
    .where(and(eq(leaveType.id, leaveTypeId), eq(leaveType.organizationId, orgId)))
    .limit(1);
  if (!type) throw new Error("Leave type not found");

  const ent = await ensureEntitlement(orgId, userId, type, year);
  await db
    .update(leaveEntitlement)
    .set({
      openingBalance: days.toFixed(1),
      openingBalanceSetBy: actorId,
      openingBalanceSetAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(leaveEntitlement.id, ent.id));
}

// Days already taken before this system was adopted (e.g. tracked manually
// on paper/Excel for a company rolling this out mid-year) — subtracts from
// remaining, unlike setOpeningBalance above which adds.
export async function setOpeningUsedDays(
  userId: string,
  leaveTypeId: string,
  year: number,
  days: number,
): Promise<void> {
  const { orgId, userId: actorId } = await requireAccess("leave:manage");
  if (!Number.isFinite(days) || days < 0) throw new Error("Opening used days must be a non-negative number");

  const [type] = await db
    .select()
    .from(leaveType)
    .where(and(eq(leaveType.id, leaveTypeId), eq(leaveType.organizationId, orgId)))
    .limit(1);
  if (!type) throw new Error("Leave type not found");

  const ent = await ensureEntitlement(orgId, userId, type, year);
  await db
    .update(leaveEntitlement)
    .set({
      openingUsedDays: days.toFixed(1),
      openingUsedDaysSetBy: actorId,
      openingUsedDaysSetAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(leaveEntitlement.id, ent.id));
}

// HR-only — never exposed on the member's own profile page. Drives service-
// years and join-year proration in ensureEntitlement(); pass null to clear
// back to the createdAt fallback.
export async function setMemberHireDate(userId: string, hireDate: string | null): Promise<void> {
  const { orgId } = await requireAccess("leave:manage");
  if (hireDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(hireDate)) {
    throw new Error("Invalid hire date");
  }
  await db
    .update(member)
    .set({ hireDate })
    .where(
      and(
        eq(member.organizationId, orgId),
        eq(member.userId, userId),
        isNull(member.deletedAt),
      ),
    );
}

/* =========================
   LEAVE APPLICATIONS
========================= */

export async function getMyLeaveApplications(): Promise<LeaveApplicationWithDetails[]> {
  const { orgId, userId } = await requireAccess("leave:read:own");
  const apps = await db
    .select()
    .from(leaveApplication)
    .where(
      and(eq(leaveApplication.organizationId, orgId), eq(leaveApplication.userId, userId)),
    )
    .orderBy(desc(leaveApplication.createdAt));

  if (apps.length === 0) return [];
  const appIds = apps.map((a) => a.id);
  const docs = await db
    .select()
    .from(leaveDocument)
    .where(inArray(leaveDocument.applicationId, appIds));
  const docMap: Record<string, LeaveDocumentRow[]> = {};
  for (const doc of docs) {
    if (!docMap[doc.applicationId]) docMap[doc.applicationId] = [];
    docMap[doc.applicationId].push(doc);
  }

  const userRow = await db
    .select({ name: user.name })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  const applicantName = userRow[0]?.name ?? null;

  return apps.map((a) => ({
    ...a,
    applicantName,
    documents: docMap[a.id] ?? [],
  }));
}

export async function getPendingApprovals(): Promise<LeaveApplicationWithDetails[]> {
  const { orgId } = await requireAccess("leave:approve");
  const apps = await db
    .select({ app: leaveApplication, applicantName: user.name })
    .from(leaveApplication)
    .leftJoin(user, eq(leaveApplication.userId, user.id))
    .where(
      and(eq(leaveApplication.organizationId, orgId), eq(leaveApplication.status, "PENDING")),
    )
    .orderBy(asc(leaveApplication.startDate));

  if (apps.length === 0) return [];
  const appIds = apps.map((a) => a.app.id);
  const docs = await db
    .select()
    .from(leaveDocument)
    .where(inArray(leaveDocument.applicationId, appIds));
  const docMap: Record<string, LeaveDocumentRow[]> = {};
  for (const doc of docs) {
    if (!docMap[doc.applicationId]) docMap[doc.applicationId] = [];
    docMap[doc.applicationId].push(doc);
  }

  return apps.map(({ app, applicantName }) => ({
    ...app,
    applicantName: applicantName ?? null,
    documents: docMap[app.id] ?? [],
  }));
}

/* =========================
   REPORT
========================= */

// Matches the existing "Medical/Sick Leave" naming convention — one shared
// trailing "Leave", not "Annual Leave/Emergency Leave".
function withEmergencyLabel(name: string, hasThreshold: boolean): string {
  if (!hasThreshold) return name;
  return `${name.replace(/\s*Leave$/i, "")}/Emergency Leave`;
}

export type LeaveReportColumn = {
  code: string;
  name: string;
  // Set when this column is a subset label drawn from another column's
  // pool (e.g. "Emergency Leave" under "Annual Leave") — lets the UI show
  // it as a sub-column of its parent rather than an unrelated type.
  parentCode?: string;
};
export type LeaveReportRow = {
  userId: string;
  memberName: string;
  // code -> total days taken (APPROVED only) for the report year
  totals: Record<string, string>;
  grandTotal: string;
};

// One row per org member, one column per leave-type LABEL actually used
// (leaveApplication.leaveTypeCode/Name as recorded at apply time). This is
// deliberately keyed by label rather than leaveTypeId — a type like Annual
// Leave that auto-splits short applications into an "Emergency Leave" label
// (see leaveType.emergencyThresholdDays) shares one entitlement pool but
// should still show as two separate columns here, since that split is
// exactly what a leave-taken report needs to answer.
export async function getLeaveReport(year?: number): Promise<{
  year: number;
  columns: LeaveReportColumn[];
  rows: LeaveReportRow[];
}> {
  const { orgId } = await requireAccess("leave:read:all");
  const y = year ?? new Date().getFullYear();

  const [types, apps, members] = await Promise.all([
    db
      .select({ id: leaveType.id, code: leaveType.code, name: leaveType.name, emergencyThresholdDays: leaveType.emergencyThresholdDays })
      .from(leaveType)
      .where(and(eq(leaveType.organizationId, orgId), eq(leaveType.isActive, true)))
      .orderBy(asc(leaveType.sortOrder)),
    db
      .select({
        userId: leaveApplication.userId,
        leaveTypeId: leaveApplication.leaveTypeId,
        code: leaveApplication.leaveTypeCode,
        name: leaveApplication.leaveTypeName,
        totalDays: leaveApplication.totalDays,
      })
      .from(leaveApplication)
      .where(
        and(
          eq(leaveApplication.organizationId, orgId),
          eq(leaveApplication.status, "APPROVED"),
          gte(leaveApplication.startDate, `${y}-01-01`),
          lte(leaveApplication.startDate, `${y}-12-31`),
        ),
      ),
    db
      .select({ userId: member.userId, name: user.name })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .where(and(eq(member.organizationId, orgId), isNull(member.deletedAt))),
  ]);

  // Columns: one per active leave type, immediately followed by any subset
  // label drawn from that same type's pool (e.g. Emergency Leave applications
  // carry leaveTypeId = Annual Leave's id but a different recorded code) —
  // keeps the subset visually attached to its parent instead of trailing at
  // the end of the table next to unrelated types. Any application whose
  // leaveTypeId doesn't match an active type (e.g. the type was since
  // deactivated) falls back to its own trailing column.
  const columns: LeaveReportColumn[] = [];
  const seenCodes = new Set<string>();
  for (const type of types) {
    columns.push({ code: type.code, name: withEmergencyLabel(type.name, type.emergencyThresholdDays != null) });
    seenCodes.add(type.code);
    const subsetCodes = new Set(
      apps.filter((a) => a.leaveTypeId === type.id && a.code !== type.code).map((a) => a.code),
    );
    for (const code of subsetCodes) {
      if (seenCodes.has(code)) continue;
      const sample = apps.find((a) => a.code === code)!;
      columns.push({ code, name: sample.name, parentCode: type.code });
      seenCodes.add(code);
    }
  }
  for (const a of apps) {
    if (seenCodes.has(a.code)) continue;
    columns.push({ code: a.code, name: a.name });
    seenCodes.add(a.code);
  }

  // Rows: every current member, so people who took zero leave still appear.
  const rowMap = new Map<string, LeaveReportRow>();
  for (const m of members) {
    rowMap.set(m.userId, { userId: m.userId, memberName: m.name ?? "—", totals: {}, grandTotal: "0" });
  }
  for (const a of apps) {
    if (!rowMap.has(a.userId)) continue; // application from a member who has since left the org
    const row = rowMap.get(a.userId)!;
    const cur = parseFloat(row.totals[a.code] ?? "0");
    row.totals[a.code] = (cur + parseFloat(a.totalDays)).toFixed(2);
  }
  for (const row of rowMap.values()) {
    const sum = Object.values(row.totals).reduce((s, v) => s + parseFloat(v), 0);
    row.grandTotal = sum.toFixed(2);
  }

  const rows = [...rowMap.values()].sort((a, b) => a.memberName.localeCompare(b.memberName));
  return { year: y, columns, rows };
}

export async function getAllLeaveApplications(filters?: {
  status?: string;
  leaveTypeId?: string;
}): Promise<LeaveApplicationWithDetails[]> {
  const { orgId } = await requireAccess("leave:read:all");
  let query = db
    .select({ app: leaveApplication, applicantName: user.name })
    .from(leaveApplication)
    .leftJoin(user, eq(leaveApplication.userId, user.id))
    .where(eq(leaveApplication.organizationId, orgId))
    .$dynamic();

  if (filters?.status && filters.status !== "ALL") {
    query = query.where(
      and(
        eq(leaveApplication.organizationId, orgId),
        eq(leaveApplication.status, filters.status),
      ),
    );
  }
  const apps = await query.orderBy(desc(leaveApplication.createdAt));
  const appIds = apps.map((a) => a.app.id);
  if (appIds.length === 0) return [];
  const docs = await db
    .select()
    .from(leaveDocument)
    .where(inArray(leaveDocument.applicationId, appIds));
  const docMap: Record<string, LeaveDocumentRow[]> = {};
  for (const doc of docs) {
    if (!docMap[doc.applicationId]) docMap[doc.applicationId] = [];
    docMap[doc.applicationId].push(doc);
  }
  return apps.map(({ app, applicantName }) => ({
    ...app,
    applicantName: applicantName ?? null,
    documents: docMap[app.id] ?? [],
  }));
}

/* =========================
   APPLY / APPROVE / REJECT / CANCEL
========================= */

export async function applyForLeave(data: ApplyLeaveInput): Promise<string> {
  const { orgId, userId, userName } = await requireAccess("leave:apply");
  const year = new Date().getFullYear();

  const type = await db
    .select()
    .from(leaveType)
    .where(and(eq(leaveType.id, data.leaveTypeId), eq(leaveType.organizationId, orgId)))
    .limit(1);
  if (!type[0] || !type[0].isActive) throw new Error("Leave type not found or inactive");
  const lt = type[0];

  if (data.isHalfDay && !lt.allowHalfDay)
    throw new Error("This leave type does not allow half-day applications");

  const totalDays = calculateWorkingDays(data.startDate, data.endDate, data.isHalfDay);
  if (totalDays <= 0) throw new Error("Selected dates have no working days");

  if (lt.maxDaysPerApplication && totalDays > lt.maxDaysPerApplication) {
    throw new Error(
      `Maximum ${lt.maxDaysPerApplication} days allowed per application for ${lt.name}`,
    );
  }

  const overlapping = await db
    .select({ id: leaveApplication.id })
    .from(leaveApplication)
    .where(
      and(
        eq(leaveApplication.userId, userId),
        eq(leaveApplication.organizationId, orgId),
        ne(leaveApplication.status, "CANCELLED"),
        ne(leaveApplication.status, "REJECTED"),
        sql`${leaveApplication.startDate} <= ${data.endDate}`,
        sql`${leaveApplication.endDate} >= ${data.startDate}`,
      ),
    )
    .limit(1);
  if (overlapping.length > 0)
    throw new Error("You have an existing leave application overlapping these dates");

  const ent = await ensureEntitlement(orgId, userId, lt, year);
  const entitled = parseFloat(ent.entitledDays);
  const carry = parseFloat(ent.carryForwardDays);
  const opening = parseFloat(ent.openingBalance);
  const used = parseFloat(ent.usedDays);
  const pending = parseFloat(ent.pendingDays);
  const available = entitled + carry + opening - used - pending;

  if (totalDays > available) {
    throw new Error(
      `Insufficient ${lt.name} balance. Available: ${available.toFixed(1)} days, Requested: ${totalDays} days`,
    );
  }

  // Emergency Leave isn't a separate balance — it's a short-application
  // label on whichever type has emergencyThresholdDays set (normally
  // Annual Leave). leaveTypeId keeps pointing at the real type (lt) so the
  // entitlement above is still what gets debited; only the display
  // name/code recorded on the application changes.
  const isEmergency = lt.emergencyThresholdDays != null && totalDays <= lt.emergencyThresholdDays;
  const appliedName = isEmergency ? "Emergency Leave" : lt.name;
  const appliedCode = isEmergency ? "EMERG" : lt.code;

  const applicationNo = await generateApplicationNo(orgId);
  const appId = nanoid();

  // neon-http driver has no transaction support — insert then update
  // sequentially, matching the pattern already used in ledger.ts.
  await db.insert(leaveApplication).values({
    id: appId,
    organizationId: orgId,
    applicationNo,
    userId,
    leaveTypeId: data.leaveTypeId,
    leaveTypeName: appliedName,
    leaveTypeCode: appliedCode,
    startDate: data.startDate,
    endDate: data.endDate,
    totalDays: totalDays.toString(),
    isHalfDay: data.isHalfDay,
    halfDayPeriod: data.halfDayPeriod ?? null,
    reason: data.reason?.trim() ?? null,
    status: "PENDING",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  await db
    .update(leaveEntitlement)
    .set({
      pendingDays: (pending + totalDays).toFixed(2),
      updatedAt: new Date(),
    })
    .where(eq(leaveEntitlement.id, ent.id));

  await notifyUsersWithPermission(orgId, "leave:approve", {
    type: "leave:submitted",
    title: `Leave Application: ${appliedName}`,
    body: `${userName} applied for ${appliedName} from ${data.startDate} to ${data.endDate} (${totalDays} day${totalDays !== 1 ? "s" : ""})`,
    link: `/dashboard/human-resources/leave/approvals`,
  });

  return appId;
}

export async function approveLeave(appId: string, comment?: string): Promise<void> {
  const { orgId, userId } = await requireAccess("leave:approve");
  const app = await db
    .select()
    .from(leaveApplication)
    .where(and(eq(leaveApplication.id, appId), eq(leaveApplication.organizationId, orgId)))
    .limit(1);
  if (!app[0]) throw new Error("Application not found");
  if (app[0].status !== "PENDING") throw new Error("Only pending applications can be approved");
  await assertSelfActionAllowed(orgId, "leave:approve", app[0].userId, userId, "approve");

  const totalDays = parseFloat(app[0].totalDays);
  const year = new Date(app[0].startDate).getFullYear();

  const ent = await db
    .select()
    .from(leaveEntitlement)
    .where(
      and(
        eq(leaveEntitlement.organizationId, orgId),
        eq(leaveEntitlement.userId, app[0].userId),
        eq(leaveEntitlement.leaveTypeId, app[0].leaveTypeId),
        eq(leaveEntitlement.year, year),
      ),
    )
    .limit(1);
  if (!ent[0]) throw new Error("Entitlement record not found");

  // neon-http driver has no transaction support — update sequentially.
  await db
    .update(leaveApplication)
    .set({
      status: "APPROVED",
      reviewedBy: userId,
      reviewedAt: new Date(),
      reviewComment: comment?.trim() ?? null,
      updatedAt: new Date(),
    })
    .where(eq(leaveApplication.id, appId));

  const newUsed = parseFloat(ent[0].usedDays) + totalDays;
  const newPending = Math.max(0, parseFloat(ent[0].pendingDays) - totalDays);
  await db
    .update(leaveEntitlement)
    .set({
      usedDays: newUsed.toFixed(2),
      pendingDays: newPending.toFixed(2),
      updatedAt: new Date(),
    })
    .where(eq(leaveEntitlement.id, ent[0].id));

  await notifyUser(orgId, app[0].userId, {
    type: "leave:approved",
    title: `Leave Approved: ${app[0].leaveTypeName}`,
    body: `Your ${app[0].leaveTypeName} from ${app[0].startDate} to ${app[0].endDate} has been approved.${comment ? ` Comment: ${comment}` : ""}`,
    link: `/dashboard/human-resources/leave`,
  });
}

export async function rejectLeave(appId: string, reason: string): Promise<void> {
  const { orgId, userId } = await requireAccess("leave:approve");
  if (!reason.trim()) throw new Error("Rejection reason is required");
  const app = await db
    .select()
    .from(leaveApplication)
    .where(and(eq(leaveApplication.id, appId), eq(leaveApplication.organizationId, orgId)))
    .limit(1);
  if (!app[0]) throw new Error("Application not found");
  if (app[0].status !== "PENDING") throw new Error("Only pending applications can be rejected");
  await assertSelfActionAllowed(orgId, "leave:approve", app[0].userId, userId, "reject");

  const totalDays = parseFloat(app[0].totalDays);
  const year = new Date(app[0].startDate).getFullYear();
  const ent = await db
    .select()
    .from(leaveEntitlement)
    .where(
      and(
        eq(leaveEntitlement.organizationId, orgId),
        eq(leaveEntitlement.userId, app[0].userId),
        eq(leaveEntitlement.leaveTypeId, app[0].leaveTypeId),
        eq(leaveEntitlement.year, year),
      ),
    )
    .limit(1);

  // neon-http driver has no transaction support — update sequentially.
  await db
    .update(leaveApplication)
    .set({
      status: "REJECTED",
      reviewedBy: userId,
      reviewedAt: new Date(),
      reviewComment: reason.trim(),
      updatedAt: new Date(),
    })
    .where(eq(leaveApplication.id, appId));

  if (ent[0]) {
    const newPending = Math.max(0, parseFloat(ent[0].pendingDays) - totalDays);
    await db
      .update(leaveEntitlement)
      .set({
        pendingDays: newPending.toFixed(2),
        updatedAt: new Date(),
      })
      .where(eq(leaveEntitlement.id, ent[0].id));
  }

  await notifyUser(orgId, app[0].userId, {
    type: "leave:rejected",
    title: `Leave Rejected: ${app[0].leaveTypeName}`,
    body: `Your ${app[0].leaveTypeName} from ${app[0].startDate} to ${app[0].endDate} was rejected. Reason: ${reason}`,
    link: `/dashboard/human-resources/leave`,
  });
}

export async function cancelLeave(appId: string, reason?: string): Promise<void> {
  const { orgId, userId } = await requireAccess("leave:apply");
  const app = await db
    .select()
    .from(leaveApplication)
    .where(and(eq(leaveApplication.id, appId), eq(leaveApplication.organizationId, orgId)))
    .limit(1);
  if (!app[0]) throw new Error("Application not found");
  const perms = await getUserPermissions(userId, orgId);
  const canApprove = hasAccess(perms, "leave:approve");
  if (app[0].userId !== userId && !canApprove)
    throw new Error("You can only cancel your own applications");
  if (app[0].status === "CANCELLED") throw new Error("Application is already cancelled");

  const totalDays = parseFloat(app[0].totalDays);
  const year = new Date(app[0].startDate).getFullYear();
  const ent = await db
    .select()
    .from(leaveEntitlement)
    .where(
      and(
        eq(leaveEntitlement.organizationId, orgId),
        eq(leaveEntitlement.userId, app[0].userId),
        eq(leaveEntitlement.leaveTypeId, app[0].leaveTypeId),
        eq(leaveEntitlement.year, year),
      ),
    )
    .limit(1);

  // neon-http driver has no transaction support — update sequentially.
  await db
    .update(leaveApplication)
    .set({
      status: "CANCELLED",
      cancelledBy: userId,
      cancelledAt: new Date(),
      cancelReason: reason?.trim() ?? null,
      updatedAt: new Date(),
    })
    .where(eq(leaveApplication.id, appId));

  if (ent[0]) {
    const update: Record<string, string | Date> = { updatedAt: new Date() };
    if (app[0].status === "PENDING") {
      update.pendingDays = Math.max(0, parseFloat(ent[0].pendingDays) - totalDays).toFixed(2);
    } else if (app[0].status === "APPROVED") {
      update.usedDays = Math.max(0, parseFloat(ent[0].usedDays) - totalDays).toFixed(2);
    }
    await db
      .update(leaveEntitlement)
      .set(update)
      .where(eq(leaveEntitlement.id, ent[0].id));
  }
}

/* =========================
   DOCUMENT MANAGEMENT
========================= */

export async function createLeaveDocumentRecord(data: {
  applicationId: string;
  fileName: string;
  fileKey: string;
  fileSize: number;
  mimeType: string;
}): Promise<LeaveDocumentRow> {
  const { orgId, userId } = await requireAccess("leave:apply");
  const app = await db
    .select()
    .from(leaveApplication)
    .where(
      and(eq(leaveApplication.id, data.applicationId), eq(leaveApplication.organizationId, orgId)),
    )
    .limit(1);
  if (!app[0]) throw new Error("Application not found");
  const row = {
    id: nanoid(),
    applicationId: data.applicationId,
    organizationId: orgId,
    fileName: data.fileName,
    fileKey: data.fileKey,
    fileSize: data.fileSize,
    mimeType: data.mimeType,
    uploadedBy: userId,
    uploadedAt: new Date(),
  };
  await db.insert(leaveDocument).values(row);
  return row;
}

export async function deleteLeaveDocument(id: string): Promise<string> {
  const { orgId, userId } = await requireAccess("leave:apply");
  const doc = await db
    .select()
    .from(leaveDocument)
    .where(and(eq(leaveDocument.id, id), eq(leaveDocument.organizationId, orgId)))
    .limit(1);
  if (!doc[0]) throw new Error("Document not found");
  const perms = await getUserPermissions(userId, orgId);
  if (doc[0].uploadedBy !== userId && !hasAccess(perms, "leave:approve"))
    throw new Error("You don't have permission to do this");
  await db.delete(leaveDocument).where(eq(leaveDocument.id, id));
  return doc[0].fileKey;
}

export async function calculateLeaveDays(
  startDate: string,
  endDate: string,
  isHalfDay: boolean,
): Promise<number> {
  return calculateWorkingDays(startDate, endDate, isHalfDay);
}
