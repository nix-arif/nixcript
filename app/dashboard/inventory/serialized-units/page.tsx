import { requirePermission } from "@/lib/auth/require-permission";
import { listAssetUnits } from "@/server/asset-units";
import { SerializedUnitsClient } from "./serialized-units-client";

export default async function SerializedUnitsPage() {
  await requirePermission("inventory:read");
  const units = await listAssetUnits().catch(() => []);
  return <SerializedUnitsClient initialUnits={units} />;
}
