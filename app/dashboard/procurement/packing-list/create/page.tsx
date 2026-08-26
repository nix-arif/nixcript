import { requirePermission } from "@/lib/auth/require-permission";
import { getSuppliersWithConfirmedPos } from "@/server/packing-list";
import { getOrganizationProfile } from "@/server/organization-profile";
import { CreatePackingListClient } from "./create-packing-list-client";

export default async function CreatePackingListPage({
  searchParams,
}: {
  searchParams: Promise<{ supplierId?: string }>;
}) {
  await requirePermission("packing-list:create");
  const { supplierId } = await searchParams;
  const [suppliers, profile] = await Promise.all([
    getSuppliersWithConfirmedPos(),
    getOrganizationProfile().catch(() => null),
  ]);
  return (
    <CreatePackingListClient
      suppliers={suppliers}
      initialSupplierId={supplierId}
      businessType={profile?.businessType ?? "trading"}
    />
  );
}
