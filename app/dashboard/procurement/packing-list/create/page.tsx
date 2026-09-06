import { requirePermission } from "@/lib/auth/require-permission";
import { getSuppliersWithConfirmedPos } from "@/server/packing-list";
import { getOrganizationProfile } from "@/server/organization-profile";
import { CreatePackingListClient } from "./create-packing-list-client";

export default async function CreatePackingListPage({
  searchParams,
}: {
  searchParams: Promise<{ supplierId?: string; poIds?: string }>;
}) {
  await requirePermission("packing-list:create");
  const { supplierId, poIds } = await searchParams;
  const [suppliers, profile] = await Promise.all([
    getSuppliersWithConfirmedPos(),
    getOrganizationProfile().catch(() => null),
  ]);
  return (
    <CreatePackingListClient
      suppliers={suppliers}
      initialSupplierId={supplierId}
      initialPurchaseOrderIds={poIds ? poIds.split(",").filter(Boolean) : undefined}
      businessType={profile?.businessType ?? "trading"}
    />
  );
}
