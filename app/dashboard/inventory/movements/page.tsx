import { requirePermission } from "@/lib/auth/require-permission";
import { getStockMovements } from "@/server/inventory";
import { MovementsClient } from "./movements-client";

export default async function MovementsPage() {
  await requirePermission("inventory:read");
  const movements = await getStockMovements();
  return <MovementsClient movements={movements} />;
}
