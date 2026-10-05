import { requirePermission } from "@/lib/auth/require-permission";
import { getAllRepFieldStock, getFieldMovements } from "@/server/field-stock";
import { FieldStockClient } from "./field-stock-client";
import { getItemGroups } from "@/server/item-group";

export default async function FieldStockPage() {
  await requirePermission("inventory:read");
  const [reps, movements, itemGroups] = await Promise.all([
    getAllRepFieldStock(),
    getFieldMovements(),
    getItemGroups().catch(() => []),
  ]);
  return <FieldStockClient reps={reps} movements={movements} itemGroups={itemGroups} />;
}
