"use server";

import { db } from "@/db";
import {
  leaveType,
  leaveEntitlement,
  leaveApplication,
  leaveCreditRequest,
  leaveDocument,
  member,
  user,
  profile,
  notification,
  noticePeriodPolicy,
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
export type LeaveCreditRequestRow = typeof leaveCreditRequest.$inferSelect;
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
  // True once today is past the leave type's carryForwardExpiryMonths
  // cutoff for this row's year — carryForwardDays itself is left untouched
  // (historical record) but is excluded from remainingDays once expired.
  carryForwardExpired: boolean;
  carryForwardExpiresOn: string | null;
  // Same idea as carryForwardExpired/Expiresn but for earned (credit-based)
  // leave — computed live from leaveCreditRequest rows, each with its own
  // expiresOn, rather than one shared cutoff. earnedExpired is true once
  // some earned credit has expired (total > available); earnedNextExpiryOn
  // is the soonest still-valid expiry, for a "use it by" nudge.
  earnedExpired: boolean;
  earnedNextExpiryOn: string | null;
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

// Every calendar date in [dateFrom, dateUntil] inclusive — unlike
// calculateWorkingDays above, weekends are NOT skipped: the entire premise
// of a replacement-credit claim is that the person worked on a day they
// normally wouldn't have (a weekend or public holiday).
//
// Formats each date via local getters (getFullYear/getMonth/getDate), NOT
// toISOString() — that converts to UTC first, which silently shifts the
// date by a day whenever the runtime's timezone offset is nonzero. Since
// the input was parsed from "YYYY-MM-DDT00:00:00" (also local), this
// round-trip is timezone-agnostic and always returns the same date string
// that was input — required so this matches the client's identical
// calcDateRange in my-leave-client.tsx regardless of where either runs.
function calcDateRange(dateFrom: string, dateUntil: string): string[] {
  const start = new Date(dateFrom + "T00:00:00");
  const end = new Date(dateUntil + "T00:00:00");
  if (start > end) return [];
  const dates: string[] = [];
  const cur = new Date(start);
  while (cur <= end) {
    const y = cur.getFullYear();
    const m = String(cur.getMonth() + 1).padStart(2, "0");
    const d = String(cur.getDate()).padStart(2, "0");
    dates.push(`${y}-${m}-${d}`);
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
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

// Converts hours worked on one date into a day credit — same tiered-rule
// shape as getEntitledDays above, keyed by hours instead of years. An
// unconfigured type (no rules) falls back to a flat 1 day per date, so
// configuring this is optional, not required for credit-based types to work.
function getCreditDaysForHours(
  rules: Array<{ minHours: number; maxHours: number | null; days: number }>,
  hours: number,
): number {
  if (rules.length === 0) return 1;
  const rule = rules.find(
    (r) => hours >= r.minHours && (r.maxHours === null || hours < r.maxHours),
  );
  return rule?.days ?? 0;
}

// Decimal hours between two "HH:MM" times — same-day only, no handling for
// a shift crossing midnight (not asked for, keeps scope contained).
function calcHoursWorked(timeFrom: string, timeUntil: string): number {
  const [fh, fm] = timeFrom.split(":").map(Number);
  const [uh, um] = timeUntil.split(":").map(Number);
  return (uh * 60 + um - (fh * 60 + fm)) / 60;
}

// The last day of month `expiryMonths` (1-indexed) in `year` — e.g.
// expiryMonths=3 -> 31 March of that year. `new Date(year, expiryMonths, 0)`
// is JS's day-0-of-next-month idiom for "last day of this month".
function carryForwardCutoff(expiryMonths: number, year: number): Date {
  return new Date(year, expiryMonths, 0, 23, 59, 59);
}

// null expiryMonths = never expires (today's behavior for every existing
// leave type, unless HR opts in). `year` is the entitlement row's year —
// carryForwardDays on that row was carried IN from the prior year, and
// expires N months into THIS year.
function isCarryForwardExpired(expiryMonths: number | null, year: number): boolean {
  if (!expiryMonths) return false;
  return new Date() > carryForwardCutoff(expiryMonths, year);
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
    earnedDays: "0",
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
  carryForwardExpiryMonths?: number;
  emergencyThresholdDays?: number;
  allowDuringProbation?: boolean;
  blockedDuringNotice?: boolean;
  isCreditBased?: boolean;
  entitlementRules: Array<{ minYears: number; maxYears: number | null; days: number }>;
  creditHourRules?: Array<{ minHours: number; maxHours: number | null; days: number }>;
  creditExpiryDays?: number;
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
    carryForwardExpiryMonths: data.carryForwardExpiryMonths ?? null,
    emergencyThresholdDays: data.emergencyThresholdDays ?? null,
    allowDuringProbation: data.allowDuringProbation ?? true,
    blockedDuringNotice: data.blockedDuringNotice ?? false,
    isCreditBased: data.isCreditBased ?? false,
    entitlementRules: data.entitlementRules,
    creditHourRules: data.creditHourRules ?? [],
    creditExpiryDays: data.creditExpiryDays ?? null,
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
    carryForwardExpiryMonths: number | null;
    emergencyThresholdDays: number | null;
    allowDuringProbation: boolean;
    blockedDuringNotice: boolean;
    isCreditBased: boolean;
    entitlementRules: Array<{ minYears: number; maxYears: number | null; days: number }>;
    creditHourRules: Array<{ minHours: number; maxHours: number | null; days: number }>;
    creditExpiryDays: number | null;
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
      // Common Malaysian SME practice: new hires accrue Annual Leave from
      // day one, but can't actually apply for it until confirmed permanent;
      // it's also the type most commonly restricted during a resignation
      // notice period. Other types below are left unaffected (defaults).
      allowDuringProbation: false,
      blockedDuringNotice: true,
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
      name: "Replacement Leave",
      code: "REPL",
      isPaid: true,
      requiresDocument: false,
      allowHalfDay: true,
      carryForwardEnabled: false,
      maxCarryForward: null,
      // No application-level cap — a credit request can span a date range,
      // and each date's own contribution is already bounded by the hour
      // tiers below.
      isCreditBased: true,
      sortOrder: 7,
      description: "A day off in exchange for working an off-day or public holiday. Request credit via 'Request Replacement Credit'; once approved, apply for it here like any other leave.",
      // Starts at 0 — balance only grows as leaveCreditRequest rows get
      // approved (leaveEntitlement.earnedDays), not from a tenure tier.
      entitlementRules: [{ minYears: 0, maxYears: null, days: 0 }],
      // Starter thresholds matching common practice: under 4h worked earns
      // nothing, 4-8h counts as half a day, a full 8h+ shift earns a full day.
      creditHourRules: [
        { minHours: 0, maxHours: 4, days: 0 },
        { minHours: 4, maxHours: 8, days: 0.5 },
        { minHours: 8, maxHours: null, days: 1 },
      ],
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
    carryForwardExpiryMonths: (d as { carryForwardExpiryMonths?: number }).carryForwardExpiryMonths ?? null,
    emergencyThresholdDays: (d as { emergencyThresholdDays?: number }).emergencyThresholdDays ?? null,
    allowDuringProbation: (d as { allowDuringProbation?: boolean }).allowDuringProbation ?? true,
    blockedDuringNotice: (d as { blockedDuringNotice?: boolean }).blockedDuringNotice ?? false,
    isCreditBased: (d as { isCreditBased?: boolean }).isCreditBased ?? false,
    entitlementRules: d.entitlementRules,
    creditHourRules: (d as { creditHourRules?: Array<{ minHours: number; maxHours: number | null; days: number }> }).creditHourRules ?? [],
    creditExpiryDays: (d as { creditExpiryDays?: number }).creditExpiryDays ?? null,
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

// "YYYY-MM-DD" for right now, in local time — same reasoning as every other
// local-date formatter this session: never toISOString(), which converts to
// UTC first and silently shifts the date in any nonzero-offset timezone.
function todayLocalDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Earned-credit balance is computed live from approved leaveCreditRequest
// rows rather than a stored running total — each approval has its own
// expiresOn (set at approval time from the type's creditExpiryDays), so
// "available" has to exclude expired ones individually, not as one shared
// cutoff the way carryForwardExpiryMonths works. One batched query covers
// every credit-based type the user has (or pass leaveTypeId to scope it to
// one, e.g. from applyForLeave's balance check).
async function getEarnedAvailableByType(
  orgId: string,
  userId: string,
  leaveTypeId?: string,
): Promise<Record<string, { total: number; available: number; nextExpiryOn: string | null }>> {
  const rows = await db
    .select({
      leaveTypeId: leaveCreditRequest.leaveTypeId,
      totalDays: leaveCreditRequest.totalDays,
      expiresOn: leaveCreditRequest.expiresOn,
    })
    .from(leaveCreditRequest)
    .where(
      and(
        eq(leaveCreditRequest.organizationId, orgId),
        eq(leaveCreditRequest.userId, userId),
        eq(leaveCreditRequest.status, "APPROVED"),
        leaveTypeId ? eq(leaveCreditRequest.leaveTypeId, leaveTypeId) : undefined,
      ),
    );

  const today = todayLocalDate();
  const result: Record<string, { total: number; available: number; nextExpiryOn: string | null }> = {};
  for (const r of rows) {
    const bucket = result[r.leaveTypeId] ?? { total: 0, available: 0, nextExpiryOn: null };
    const days = parseFloat(r.totalDays);
    bucket.total += days;
    const expired = r.expiresOn !== null && r.expiresOn < today;
    if (!expired) {
      bucket.available += days;
      if (r.expiresOn && (!bucket.nextExpiryOn || r.expiresOn < bucket.nextExpiryOn)) {
        bucket.nextExpiryOn = r.expiresOn;
      }
    }
    result[r.leaveTypeId] = bucket;
  }
  return result;
}

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

  const earnedByType = await getEarnedAvailableByType(orgId, userId);

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
    const carryExpired = isCarryForwardExpired(type.carryForwardExpiryMonths, ent.year);
    const carry = carryExpired ? 0 : parseFloat(ent.carryForwardDays);
    const opening = parseFloat(ent.openingBalance);
    const earnedInfo = earnedByType[type.id];
    const earned = earnedInfo?.available ?? 0;
    const openingUsed = parseFloat(ent.openingUsedDays);
    const used = parseFloat(ent.usedDays);
    const pending = parseFloat(ent.pendingDays);
    const remaining = entitled + carry + opening + earned - openingUsed - used - pending;
    const byLabel = breakdownByType.get(type.id);
    const breakdown = byLabel && byLabel.size > 0
      ? [...byLabel.values()].sort((a, b) => (a.code === type.code ? -1 : b.code === type.code ? 1 : 0))
      : [{ code: type.code, name: type.name, usedDays: ent.usedDays, pendingDays: ent.pendingDays }];
    const cutoff = type.carryForwardExpiryMonths ? carryForwardCutoff(type.carryForwardExpiryMonths, ent.year) : null;
    return {
      ...ent,
      leaveTypeName: type.name,
      leaveTypeCode: type.code,
      isPaid: type.isPaid,
      allowHalfDay: type.allowHalfDay,
      emergencyThresholdDays: type.emergencyThresholdDays,
      remainingDays: remaining.toFixed(1),
      earnedDays: (earnedInfo?.total ?? 0).toFixed(2),
      openingBalanceSetByName: ent.openingBalanceSetBy ? nameMap[ent.openingBalanceSetBy] ?? null : null,
      openingUsedDaysSetByName: ent.openingUsedDaysSetBy ? nameMap[ent.openingUsedDaysSetBy] ?? null : null,
      carryForwardExpired: carryExpired,
      carryForwardExpiresOn: cutoff
        ? `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, "0")}-${String(cutoff.getDate()).padStart(2, "0")}`
        : null,
      earnedExpired: (earnedInfo?.total ?? 0) > (earnedInfo?.available ?? 0),
      earnedNextExpiryOn: earnedInfo?.nextExpiryOn ?? null,
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

// HR-only — pairs with profile.employmentStatus ("resigned"), which HR sets
// separately via setMemberEmploymentStatus. leaveBlockedOnNotice governs
// whether leave types flagged blockedDuringNotice (normally Annual Leave)
// can still be applied for during this specific member's notice period —
// decided case-by-case per resignation, not a blanket org policy.
export async function setMemberNoticeDate(
  userId: string,
  noticeDate: string | null,
  leaveBlockedOnNotice: boolean,
): Promise<void> {
  const { orgId } = await requireAccess("leave:manage");
  if (noticeDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(noticeDate)) {
    throw new Error("Invalid notice date");
  }
  await db
    .update(member)
    .set({ noticeDate, leaveBlockedOnNotice })
    .where(
      and(
        eq(member.organizationId, orgId),
        eq(member.userId, userId),
        isNull(member.deletedAt),
      ),
    );
}

/* =========================
   NOTICE PERIOD POLICY
   HR-defined notice-period length (days), by employment status x department
   role. Drives the auto-calculated last working day shown against a
   resigning member's notice date (noticeDate + policy days). A missing row
   for a status/role combo means HR hasn't set one yet, not zero days.
========================= */

export type NoticePeriodPolicyRow = typeof noticePeriodPolicy.$inferSelect;

// Readable by anyone who can see the org's members (the computed last
// working day is shown alongside notice date wherever that already is);
// only leave:manage can change the policy itself.
export async function getNoticePeriodPolicies(): Promise<NoticePeriodPolicyRow[]> {
  const { orgId } = await requireAccess("member:read");
  return db
    .select()
    .from(noticePeriodPolicy)
    .where(eq(noticePeriodPolicy.organizationId, orgId));
}

export async function setNoticePeriodPolicy(
  employmentStatus: "probation" | "permanent",
  departmentRole: "member" | "manager",
  noticePeriodDays: number,
): Promise<void> {
  const { orgId } = await requireAccess("leave:manage");
  if (!Number.isFinite(noticePeriodDays) || noticePeriodDays < 0) {
    throw new Error("Enter a valid, non-negative number of days");
  }
  const [existing] = await db
    .select({ id: noticePeriodPolicy.id })
    .from(noticePeriodPolicy)
    .where(
      and(
        eq(noticePeriodPolicy.organizationId, orgId),
        eq(noticePeriodPolicy.employmentStatus, employmentStatus),
        eq(noticePeriodPolicy.departmentRole, departmentRole),
      ),
    )
    .limit(1);

  if (existing) {
    await db
      .update(noticePeriodPolicy)
      .set({ noticePeriodDays, updatedAt: new Date() })
      .where(eq(noticePeriodPolicy.id, existing.id));
  } else {
    await db.insert(noticePeriodPolicy).values({
      id: nanoid(),
      organizationId: orgId,
      employmentStatus,
      departmentRole,
      noticePeriodDays,
    });
  }
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

  if (!lt.allowDuringProbation) {
    const [profileRow] = await db
      .select({ employmentStatus: profile.employmentStatus })
      .from(profile)
      .where(eq(profile.userId, userId))
      .limit(1);
    if (profileRow?.employmentStatus === "probation") {
      throw new Error(`${lt.name} cannot be applied for while still on probation`);
    }
  }

  if (lt.blockedDuringNotice) {
    const [memberRow] = await db
      .select({ noticeDate: member.noticeDate, leaveBlockedOnNotice: member.leaveBlockedOnNotice })
      .from(member)
      .where(and(eq(member.organizationId, orgId), eq(member.userId, userId), isNull(member.deletedAt)))
      .limit(1);
    if (memberRow?.noticeDate && memberRow.leaveBlockedOnNotice) {
      throw new Error(`${lt.name} cannot be applied for during your notice period`);
    }
  }

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
  // Expired carry-forward can't fund this application — enforced here
  // (not just hidden in the UI), same as computeBalances excludes it from
  // the displayed remaining total.
  const carry = isCarryForwardExpired(lt.carryForwardExpiryMonths, year) ? 0 : parseFloat(ent.carryForwardDays);
  const opening = parseFloat(ent.openingBalance);
  const earned = (await getEarnedAvailableByType(orgId, userId, lt.id))[lt.id]?.available ?? 0;
  const used = parseFloat(ent.usedDays);
  const pending = parseFloat(ent.pendingDays);
  const available = entitled + carry + opening + earned - used - pending;

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
   REPLACEMENT CREDIT (earn side of credit-based leave types)
========================= */

export type LeaveCreditRequestWithDetails = LeaveCreditRequestRow & {
  applicantName: string | null;
};

async function generateCreditRequestNo(orgId: string): Promise<string> {
  const year = new Date().getFullYear();
  const rows = await db
    .select({ requestNo: leaveCreditRequest.requestNo })
    .from(leaveCreditRequest)
    .where(
      and(
        eq(leaveCreditRequest.organizationId, orgId),
        sql`${leaveCreditRequest.requestNo} LIKE ${`RC-${year}-%`}`,
      ),
    )
    .orderBy(desc(leaveCreditRequest.requestNo));
  let next = 1;
  if (rows.length > 0) {
    const parts = rows[0].requestNo.split("-");
    const num = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(num)) next = num + 1;
  }
  return `RC-${year}-${String(next).padStart(4, "0")}`;
}

export type ReplacementCreditLine = {
  date: string;
  timeFrom: string;
  timeUntil: string;
  reason: string;
};

export type ApplyReplacementCreditInput = {
  leaveTypeId: string;
  dateFrom: string;
  dateUntil: string;
  lines: ReplacementCreditLine[];
};

export async function applyForReplacementCredit(data: ApplyReplacementCreditInput): Promise<string> {
  const { orgId, userId, userName } = await requireAccess("leave:apply");

  const [lt] = await db
    .select()
    .from(leaveType)
    .where(and(eq(leaveType.id, data.leaveTypeId), eq(leaveType.organizationId, orgId)))
    .limit(1);
  if (!lt || !lt.isActive) throw new Error("Leave type not found or inactive");
  if (!lt.isCreditBased) throw new Error(`${lt.name} does not accept replacement-credit requests`);

  if (!data.dateFrom || !data.dateUntil) throw new Error("The dates you worked are required");
  if (new Date(data.dateFrom + "T00:00:00") > new Date(data.dateUntil + "T00:00:00"))
    throw new Error("The 'from' date must be on or before the 'until' date");
  if (new Date(data.dateUntil + "T00:00:00") > new Date())
    throw new Error("The worked dates can't be in the future");

  // Server derives the expected date set itself rather than trusting the
  // client's line count — same principle applyForLeave follows for
  // totalDays from startDate/endDate.
  const expectedDates = calcDateRange(data.dateFrom, data.dateUntil);
  const lineDates = data.lines.map((l) => l.date);
  const lineSet = new Set(lineDates);
  if (
    lineDates.length !== expectedDates.length ||
    lineSet.size !== lineDates.length ||
    !expectedDates.every((d) => lineSet.has(d))
  ) {
    throw new Error("Every date from the worked range must have exactly one entry");
  }

  for (const line of data.lines) {
    if (!line.timeFrom || !line.timeUntil) throw new Error(`Time in/out is required for ${line.date}`);
    if (line.timeUntil <= line.timeFrom) throw new Error(`Time until must be after time from for ${line.date}`);
    if (!line.reason?.trim()) throw new Error(`A reason is required for ${line.date}`);
  }

  // Each date's day-credit is computed here, server-side, from the hours
  // worked against the type's creditHourRules — the client never sends a
  // days value, same principle as totalDays itself.
  const computedLines = data.lines.map((line) => {
    const hours = calcHoursWorked(line.timeFrom, line.timeUntil);
    return { ...line, days: getCreditDaysForHours(lt.creditHourRules, hours) };
  });
  const totalDays = computedLines.reduce((sum, l) => sum + l.days, 0);
  if (lt.maxDaysPerApplication && totalDays > lt.maxDaysPerApplication) {
    throw new Error(`Maximum ${lt.maxDaysPerApplication} days allowed per credit request for ${lt.name}`);
  }

  // No individual date already backing another non-cancelled/rejected claim.
  const existing = await db
    .select({ workLines: leaveCreditRequest.workLines })
    .from(leaveCreditRequest)
    .where(
      and(
        eq(leaveCreditRequest.userId, userId),
        eq(leaveCreditRequest.organizationId, orgId),
        eq(leaveCreditRequest.leaveTypeId, data.leaveTypeId),
        ne(leaveCreditRequest.status, "CANCELLED"),
        ne(leaveCreditRequest.status, "REJECTED"),
      ),
    );
  const claimedDates = new Set(existing.flatMap((r) => r.workLines.map((l) => l.date)));
  const conflicts = expectedDates.filter((d) => claimedDates.has(d));
  if (conflicts.length > 0) {
    throw new Error(`You've already claimed replacement credit for: ${conflicts.join(", ")}`);
  }

  const requestNo = await generateCreditRequestNo(orgId);
  const id = nanoid();
  const sortedLines = [...computedLines].sort((a, b) => a.date.localeCompare(b.date));
  await db.insert(leaveCreditRequest).values({
    id,
    organizationId: orgId,
    requestNo,
    userId,
    leaveTypeId: lt.id,
    leaveTypeName: lt.name,
    leaveTypeCode: lt.code,
    dateFrom: data.dateFrom,
    dateUntil: data.dateUntil,
    totalDays: totalDays.toFixed(2),
    workLines: sortedLines.map((l) => ({
      date: l.date,
      timeFrom: l.timeFrom,
      timeUntil: l.timeUntil,
      reason: l.reason.trim(),
      days: l.days,
    })),
    status: "PENDING",
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const period = data.dateFrom === data.dateUntil ? data.dateFrom : `${data.dateFrom} to ${data.dateUntil}`;
  await notifyUsersWithPermission(orgId, "leave:approve", {
    type: "leave:credit:submitted",
    title: `Replacement Credit Request: ${lt.name}`,
    body: `${userName} claimed ${totalDays} day(s) of ${lt.name} for working ${period}`,
    link: `/dashboard/human-resources/leave/approvals`,
  });

  return id;
}

export async function approveReplacementCredit(id: string, comment?: string): Promise<void> {
  const { orgId, userId } = await requireAccess("leave:approve");
  const [req] = await db
    .select()
    .from(leaveCreditRequest)
    .where(and(eq(leaveCreditRequest.id, id), eq(leaveCreditRequest.organizationId, orgId)))
    .limit(1);
  if (!req) throw new Error("Request not found");
  if (req.status !== "PENDING") throw new Error("Only pending requests can be approved");
  await assertSelfActionAllowed(orgId, "leave:approve", req.userId, userId, "approve");

  const [lt] = await db.select().from(leaveType).where(eq(leaveType.id, req.leaveTypeId)).limit(1);
  if (!lt) throw new Error("Leave type not found");

  // Snapshotted at approval time, not recomputed later — editing the
  // type's creditExpiryDays afterward shouldn't retroactively change
  // already-approved requests. Earned balance is derived live from these
  // per-request expiries (getEarnedAvailableByType), not a pooled counter.
  let expiresOn: string | null = null;
  if (lt.creditExpiryDays != null) {
    const d = new Date();
    d.setDate(d.getDate() + lt.creditExpiryDays);
    expiresOn = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  await db
    .update(leaveCreditRequest)
    .set({
      status: "APPROVED",
      reviewedBy: userId,
      reviewedAt: new Date(),
      reviewComment: comment?.trim() ?? null,
      expiresOn,
      updatedAt: new Date(),
    })
    .where(eq(leaveCreditRequest.id, id));

  const period = req.dateFrom === req.dateUntil ? req.dateFrom : `${req.dateFrom} to ${req.dateUntil}`;
  await notifyUser(orgId, req.userId, {
    type: "leave:credit:approved",
    title: `Replacement Credit Approved: ${req.leaveTypeName}`,
    body: `Your claim for ${req.totalDays} day(s) worked ${period} has been approved — your ${req.leaveTypeName} balance has increased.`,
    link: `/dashboard/human-resources/leave`,
  });
}

export async function rejectReplacementCredit(id: string, reason: string): Promise<void> {
  const { orgId, userId } = await requireAccess("leave:approve");
  if (!reason.trim()) throw new Error("Rejection reason is required");
  const [req] = await db
    .select()
    .from(leaveCreditRequest)
    .where(and(eq(leaveCreditRequest.id, id), eq(leaveCreditRequest.organizationId, orgId)))
    .limit(1);
  if (!req) throw new Error("Request not found");
  if (req.status !== "PENDING") throw new Error("Only pending requests can be rejected");
  await assertSelfActionAllowed(orgId, "leave:approve", req.userId, userId, "reject");

  await db
    .update(leaveCreditRequest)
    .set({
      status: "REJECTED",
      reviewedBy: userId,
      reviewedAt: new Date(),
      reviewComment: reason.trim(),
      updatedAt: new Date(),
    })
    .where(eq(leaveCreditRequest.id, id));

  await notifyUser(orgId, req.userId, {
    type: "leave:credit:rejected",
    title: `Replacement Credit Rejected: ${req.leaveTypeName}`,
    body: `Your claim for ${req.totalDays} day(s) worked ${req.dateFrom === req.dateUntil ? req.dateFrom : `${req.dateFrom} to ${req.dateUntil}`} was rejected. Reason: ${reason.trim()}`,
    link: `/dashboard/human-resources/leave`,
  });
}

// Only while PENDING — nothing's been credited yet, so there's no
// leaveEntitlement effect to undo (unlike cancelLeave, which can reverse an
// APPROVED application). Withdrawing an already-approved credit is a manual
// HR adjustment via Leave Balances, out of scope here.
export async function cancelReplacementCredit(id: string): Promise<void> {
  const { orgId, userId } = await requireAccess("leave:apply");
  const [req] = await db
    .select()
    .from(leaveCreditRequest)
    .where(and(eq(leaveCreditRequest.id, id), eq(leaveCreditRequest.organizationId, orgId)))
    .limit(1);
  if (!req) throw new Error("Request not found");
  const perms = await getUserPermissions(userId, orgId);
  if (req.userId !== userId && !hasAccess(perms, "leave:approve"))
    throw new Error("You can only cancel your own requests");
  if (req.status !== "PENDING") throw new Error("Only pending requests can be cancelled");

  await db
    .update(leaveCreditRequest)
    .set({ status: "CANCELLED", updatedAt: new Date() })
    .where(eq(leaveCreditRequest.id, id));
}

export async function getMyReplacementCredits(): Promise<LeaveCreditRequestWithDetails[]> {
  const { orgId, userId } = await requireAccess("leave:read:own");
  const reqs = await db
    .select()
    .from(leaveCreditRequest)
    .where(and(eq(leaveCreditRequest.organizationId, orgId), eq(leaveCreditRequest.userId, userId)))
    .orderBy(desc(leaveCreditRequest.createdAt));

  const userRow = await db.select({ name: user.name }).from(user).where(eq(user.id, userId)).limit(1);
  const applicantName = userRow[0]?.name ?? null;
  return reqs.map((r) => ({ ...r, applicantName }));
}

export async function getPendingReplacementCredits(): Promise<LeaveCreditRequestWithDetails[]> {
  const { orgId } = await requireAccess("leave:approve");
  const reqs = await db
    .select({ req: leaveCreditRequest, applicantName: user.name })
    .from(leaveCreditRequest)
    .leftJoin(user, eq(leaveCreditRequest.userId, user.id))
    .where(and(eq(leaveCreditRequest.organizationId, orgId), eq(leaveCreditRequest.status, "PENDING")))
    .orderBy(asc(leaveCreditRequest.dateFrom));

  return reqs.map(({ req, applicantName }) => ({ ...req, applicantName: applicantName ?? null }));
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
