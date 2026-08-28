import { notFound, redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/require-permission";
import { getPackingListDetail } from "@/server/packing-list";
import { getOrganizationProfile } from "@/server/organization-profile";
import { InspectPackingListClient } from "./inspect-packing-list-client";

export default async function InspectPackingListPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePermission("packing-list:inspect");
  const { id } = await params;
  const [pl, profile] = await Promise.all([
    getPackingListDetail(id),
    getOrganizationProfile().catch(() => null),
  ]);
  if (!pl) notFound();
  if (pl.status !== "pending") redirect(`/dashboard/procurement/packing-list/${id}`);
  return <InspectPackingListClient packingList={pl} businessType={profile?.businessType ?? "trading"} />;
}
