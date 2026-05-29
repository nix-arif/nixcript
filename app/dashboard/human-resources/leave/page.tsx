import { requirePermission } from "@/lib/auth/require-permission";
import { getMyLeaveBalances, getMyLeaveApplications, getActiveLeaveTypes } from "@/server/leave";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { MyLeaveClient } from "./my-leave-client";

export default async function MyLeavePage() {
  const session = await requirePermission("leave:read:own");
  const [balances, applications, leaveTypes, permissions] = await Promise.all([
    getMyLeaveBalances(),
    getMyLeaveApplications(),
    getActiveLeaveTypes(),
    getUserPermissions(session.user.id, session.session.activeOrganizationId!),
  ]);
  return (
    <MyLeaveClient
      balances={balances}
      applications={applications}
      leaveTypes={leaveTypes}
      permissions={permissions}
    />
  );
}
