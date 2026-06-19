import { requirePermission } from "@/lib/auth/require-permission";
import { getAllRepFieldStock, getFieldMovements } from "@/server/field-stock";
import { FieldStockClient } from "./field-stock-client";

export default async function FieldStockPage() {
  await requirePermission("inventory:read");
  const [reps, movements] = await Promise.all([
    getAllRepFieldStock(),
    getFieldMovements(),
  ]);
  return <FieldStockClient reps={reps} movements={movements} />;
}
