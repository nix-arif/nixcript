import { requirePermission } from "@/lib/auth/require-permission";
import { listAssetUnits } from "@/server/asset-units";
import { getInventoryLocationNames } from "@/server/inventory";
import { SerializedUnitsClient } from "./serialized-units-client";

export default async function SerializedUnitsPage() {
  await requirePermission("inventory:read");
  const [units, locationNames] = await Promise.all([
    listAssetUnits().catch(() => []),
    getInventoryLocationNames().catch(() => ({})),
  ]);
  return <SerializedUnitsClient initialUnits={units} locationNames={locationNames} />;
}
