"use server";

import { db } from "@/db";
import { leaveApplication, member, organization, user } from "@/db/schema";
import { getCachedSession } from "@/lib/auth/cached-session";
import { getOrgGroupIds } from "@/lib/document-number-group";
import { and, asc, eq, gte, inArray, isNull, lte } from "drizzle-orm";

// Who is away — approved leave of everyone in the companies under the same
// owner, for today and the current week (Monday–Sunday, Malaysia time).
// Any member of those companies sees it; the leave reason is never shown.

export interface TeamLeaveRow {
  id: string;
  name: string;
  orgName: string;
  leaveType: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;
  isHalfDay: boolean;
  halfDayPeriod: string | null;
  totalDays: string;
}

export interface TeamLeave {
  today: string;
  weekStart: string;
  weekEnd: string;
  onLeaveToday: TeamLeaveRow[];
  thisWeek: TeamLeaveRow[]; // approved leave touching this week, including today's
}

const ymd = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuala_Lumpur" }).format(d); // YYYY-MM-DD

export async function getTeamLeave(): Promise<TeamLeave | null> {
  const session = await getCachedSession();
  const orgId = session?.session.activeOrganizationId;
  if (!session || !orgId) return null;
  // Only members of the group see it
  const [me] = await db.select({ id: member.id }).from(member)
    .where(and(eq(member.organizationId, orgId), eq(member.userId, session.user.id), isNull(member.deletedAt))).limit(1);
  if (!me) return null;

  const today = ymd(new Date());
  const t = new Date(`${today}T00:00:00Z`);
  const monday = new Date(t); monday.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7));
  const sunday = new Date(monday); sunday.setUTCDate(monday.getUTCDate() + 6);
  const weekStart = monday.toISOString().slice(0, 10), weekEnd = sunday.toISOString().slice(0, 10);

  const groupIds = await getOrgGroupIds(orgId);
  const rows = await db.select({
    id: leaveApplication.id, name: user.name, orgName: organization.name, leaveType: leaveApplication.leaveTypeName,
    startDate: leaveApplication.startDate, endDate: leaveApplication.endDate,
    isHalfDay: leaveApplication.isHalfDay, halfDayPeriod: leaveApplication.halfDayPeriod, totalDays: leaveApplication.totalDays,
  })
    .from(leaveApplication)
    .innerJoin(user, eq(user.id, leaveApplication.userId))
    .innerJoin(organization, eq(organization.id, leaveApplication.organizationId))
    .where(and(inArray(leaveApplication.organizationId, groupIds), eq(leaveApplication.status, "APPROVED"),
      lte(leaveApplication.startDate, weekEnd), gte(leaveApplication.endDate, weekStart)))
    .orderBy(asc(leaveApplication.startDate), asc(user.name));

  const list: TeamLeaveRow[] = rows.map((r) => ({ ...r, name: r.name ?? "—", leaveType: r.leaveType ?? "Leave", isHalfDay: !!r.isHalfDay }));
  return {
    today, weekStart, weekEnd,
    onLeaveToday: list.filter((r) => r.startDate <= today && r.endDate >= today),
    thisWeek: list,
  };
}
