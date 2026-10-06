import { requirePermission } from "@/lib/auth/require-permission";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";
import { listAssetUnits } from "@/server/asset-units";
import { getInventoryLocationNames } from "@/server/inventory";
import { SerializedUnitsClient } from "./serialized-units-client";

export default async function SerializedUnitsPage({ searchParams }: { searchParams: Promise<{ location?: string; product?: string; tab?: string }> }) {
  const session = await requirePermission("inventory:read");
  const sp = await searchParams;
  const [units, locationNames, perms] = await Promise.all([
    listAssetUnits().catch(() => []),
    getInventoryLocationNames().catch(() => ({})),
    getUserPermissions(session.user.id, session.session.activeOrganizationId!),
  ]);
  // From Stock Overview's "Serial numbers": that location and item
  const focus = sp.location && sp.product ? { location: sp.location, productId: sp.product } : undefined;
  return <SerializedUnitsClient initialUnits={units} locationNames={locationNames} focus={focus} canManage={hasAccess(perms, "inventory:manage")} initialTab={sp.tab === "lots" ? "lots" : "serials"} />;
}
