import { requirePermission } from "@/lib/auth/require-permission";
import { getPendingApprovals } from "@/server/leave";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { ApprovalsClient } from "./approvals-client";

export default async function LeaveApprovalsPage() {
  const session = await requirePermission("leave:approve");
  const [applications, permissions] = await Promise.all([
    getPendingApprovals(),
    getUserPermissions(session.user.id, session.session.activeOrganizationId!),
  ]);
  return <ApprovalsClient applications={applications} permissions={permissions} />;
}
