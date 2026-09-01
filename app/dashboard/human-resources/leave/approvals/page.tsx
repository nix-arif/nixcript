import { requirePermission } from "@/lib/auth/require-permission";
import { getPendingApprovals, getPendingReplacementCredits } from "@/server/leave";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { ApprovalsClient } from "./approvals-client";

export default async function LeaveApprovalsPage() {
  const session = await requirePermission("leave:approve");
  const [applications, creditRequests, permissions] = await Promise.all([
    getPendingApprovals(),
    getPendingReplacementCredits(),
    getUserPermissions(session.user.id, session.session.activeOrganizationId!),
  ]);
  return <ApprovalsClient applications={applications} creditRequests={creditRequests} permissions={permissions} />;
}
