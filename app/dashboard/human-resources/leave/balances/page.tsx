import { requirePermission } from "@/lib/auth/require-permission";
import { getActiveLeaveTypes } from "@/server/leave";
import { getOrgMembers } from "@/server/members";
import { LeaveBalancesClient } from "./balances-client";

export default async function LeaveBalancesPage() {
  await requirePermission("leave:manage");
  const [members, leaveTypes] = await Promise.all([
    getOrgMembers(),
    getActiveLeaveTypes(),
  ]);
  return <LeaveBalancesClient members={members} leaveTypes={leaveTypes} />;
}
