import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/require-permission";
import { getPackingListDetailCentralized } from "@/server/packing-list";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { PackingListDetailClient } from "../../[id]/packing-list-detail-client";

export default async function CentralizedPackingListDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("packing-list:read:centralized");
  const { id } = await params;

  const data = await getPackingListDetailCentralized(id);
  if (!data) notFound();

  const { organizationName, isOwnOrg, businessType, canInspect, ...packingList } = data;
  // Cancel stays gated behind the caller's real permissions, and only when
  // this packing list genuinely belongs to their own active org. Inspect is
  // separately unlocked by canInspect — either the dedicated
  // packing-list:inspect:centralized grant, or packing-list:inspect
  // evaluated in the packing list's own org (see getPackingListDetailCentralized).
  const ownOrgPermissions = isOwnOrg
    ? await getUserPermissions(session.user.id, session.session.activeOrganizationId!)
    : [];
  const permissions = canInspect ? [...ownOrgPermissions, "packing-list:inspect"] : ownOrgPermissions;

  return (
    <PackingListDetailClient
      packingList={packingList}
      permissions={permissions}
      businessType={businessType}
      backHref="/dashboard/procurement/packing-list/centralized"
      organizationName={organizationName}
      inspectHref={`/dashboard/procurement/packing-list/centralized/${id}/inspect`}
    />
  );
}
