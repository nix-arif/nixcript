import { requirePermission } from "@/lib/auth/require-permission";
import { getMyClaimApplications, getActiveClaimTypes, getCustomersForClaim } from "@/server/claim";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { MyClaimClient } from "./my-claim-client";

export default async function MyClaimPage() {
  const session = await requirePermission("claim:read:own");
  const [applications, claimTypes, permissions, customers] = await Promise.all([
    getMyClaimApplications(),
    getActiveClaimTypes(),
    getUserPermissions(session.user.id, session.session.activeOrganizationId!),
    getCustomersForClaim(),
  ]);
  return (
    <MyClaimClient
      applications={applications}
      claimTypes={claimTypes}
      permissions={permissions}
      customers={customers}
    />
  );
}
