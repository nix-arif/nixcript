import { requirePermission } from "@/lib/auth/require-permission";
import { getActiveLeaveTypes, getNoticePeriodPolicies } from "@/server/leave";
import { getOrgMembers } from "@/server/members";
import { LeaveBalancesClient } from "./balances-client";

export default async function LeaveBalancesPage() {
  await requirePermission("leave:manage");
  const [members, leaveTypes, noticePolicies] = await Promise.all([
    getOrgMembers(),
    getActiveLeaveTypes(),
    getNoticePeriodPolicies(),
  ]);
  return <LeaveBalancesClient members={members} leaveTypes={leaveTypes} noticePolicies={noticePolicies} />;
}
