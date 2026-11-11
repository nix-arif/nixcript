import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/require-permission";
import { getPackingListDetail, canApprovePackingListInspection, canAmendPackingList } from "@/server/packing-list";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { getCachedSession } from "@/lib/auth/cached-session";
import { getOrganizationProfile } from "@/server/organization-profile";
import { PackingListDetailClient } from "./packing-list-detail-client";

export default async function PackingListDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePermission("purchase-order:read");
  const { id } = await params;
  const session = await getCachedSession();
  const orgId = session!.session.activeOrganizationId!;
  const [pl, permissions, profile] = await Promise.all([
    getPackingListDetail(id),
    getUserPermissions(session!.user.id, orgId),
    getOrganizationProfile().catch(() => null),
  ]);
  if (!pl) notFound();
  // Approve / Reject on change requests — same approvers and self-approval
  // setting as the inspection itself
  const [approval, canRequestChange] = await Promise.all([
    canApprovePackingListInspection(pl.organizationId),
    canAmendPackingList(pl.organizationId),
  ]);
  return (
    <PackingListDetailClient
      packingList={pl}
      permissions={permissions}
      businessType={profile?.businessType ?? "trading"}
      approval={approval}
      canRequestChange={canRequestChange}
    />
  );
}
