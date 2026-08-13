import { requirePermission } from "@/lib/auth/require-permission";
import { getPendingTravelApprovals } from "@/server/travel-form";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { TravelApprovalsClient } from "./approvals-client";

export default async function TravelApprovalsPage() {
  const session = await requirePermission("travel:approve");
  const [travelForms, permissions] = await Promise.all([
    getPendingTravelApprovals(),
    getUserPermissions(session.user.id, session.session.activeOrganizationId!),
  ]);
  return <TravelApprovalsClient travelForms={travelForms} permissions={permissions} />;
}
