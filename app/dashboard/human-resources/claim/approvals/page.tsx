import { requirePermission } from "@/lib/auth/require-permission";
import { getPendingClaimApprovals } from "@/server/claim";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { ClaimApprovalsClient } from "./approvals-client";

export default async function ClaimApprovalsPage() {
  const session = await requirePermission("claim:approve");
  const [applications, permissions] = await Promise.all([
    getPendingClaimApprovals(),
    getUserPermissions(session.user.id, session.session.activeOrganizationId!),
  ]);
  return <ClaimApprovalsClient applications={applications} permissions={permissions} />;
}
