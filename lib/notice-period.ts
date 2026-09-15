import type { NoticePeriodPolicyRow } from "@/server/leave";

type MemberForNoticeCalc = {
  noticeDate: string | Date | null;
  employmentStatus: string | null;
  departments: { deptRole: string }[];
};

// A member counts as "manager" bucket for notice-period policy if they hold
// a Manager role in any department — resigning managers commonly owe a
// longer notice than regular staff, so the longer bucket wins.
export function memberNoticeRoleBucket(m: MemberForNoticeCalc): "manager" | "member" {
  return m.departments.some((d) => d.deptRole === "manager") ? "manager" : "member";
}

// Returns null when there's no notice date yet, the employment status isn't
// probation/permanent, or HR hasn't set a policy for that combination.
export function computeLastWorkingDay(
  m: MemberForNoticeCalc,
  policies: NoticePeriodPolicyRow[],
): string | null {
  if (!m.noticeDate) return null;
  if (m.employmentStatus !== "probation" && m.employmentStatus !== "permanent") return null;
  const bucket = memberNoticeRoleBucket(m);
  const policy = policies.find((p) => p.employmentStatus === m.employmentStatus && p.departmentRole === bucket);
  if (!policy) return null;
  const noticeDateStr = typeof m.noticeDate === "string" ? m.noticeDate : m.noticeDate.toISOString().slice(0, 10);
  // Date-only arithmetic done entirely in UTC — constructing via
  // `new Date(str + "T00:00:00")` (local time) and then .toISOString()
  // (UTC) shifts the result back a day in any timezone ahead of UTC.
  const [y, mo, da] = noticeDateStr.split("-").map(Number);
  const d = new Date(Date.UTC(y, mo - 1, da + policy.noticePeriodDays));
  return d.toISOString().slice(0, 10);
}

// A resigning member's unused notice-affecting leave balance (Annual Leave,
// normally — see getAnnualLeaveBalanceForNoticeCalc in server/leave.ts) gets
// consumed against the tail end of their notice period, so they stop
// physically attending work this many days before the notice-period-only
// last working day computed above. Their official last day of employment is
// unaffected — this only ever pulls the *attendance* last day earlier, never
// later, and never earlier than the notice date itself (can't attend zero
// days of a notice period you just tendered).
export function computeLastWorkingDayAfterLeaveDeduction(
  lastWorkingDayBeforeDeduction: string | null,
  noticeDate: string | Date | null,
  unusedLeaveBalanceDays: number,
): string | null {
  if (!lastWorkingDayBeforeDeduction) return null;
  const deductDays = Math.max(0, Math.floor(unusedLeaveBalanceDays));
  if (deductDays === 0) return lastWorkingDayBeforeDeduction;

  const [y, mo, da] = lastWorkingDayBeforeDeduction.split("-").map(Number);
  let d = new Date(Date.UTC(y, mo - 1, da - deductDays));

  if (noticeDate) {
    const noticeDateStr = typeof noticeDate === "string" ? noticeDate : noticeDate.toISOString().slice(0, 10);
    const [ny, nmo, nda] = noticeDateStr.split("-").map(Number);
    const noticeD = new Date(Date.UTC(ny, nmo - 1, nda));
    if (d < noticeD) d = noticeD;
  }
  return d.toISOString().slice(0, 10);
}
