import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/require-permission";
import { getPackingListDetail } from "@/server/packing-list";
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
  return (
    <PackingListDetailClient
      packingList={pl}
      permissions={permissions}
      businessType={profile?.businessType ?? "trading"}
    />
  );
}
