import { requirePermission } from "@/lib/auth/require-permission";
import { getPendingMovements, getWarehouses, getInventoryLocationNames } from "@/server/inventory";
import { getFieldReps } from "@/server/field-stock";
import { InventoryApprovalsClient } from "./inventory-approvals-client";

export default async function InventoryApprovalsPage() {
  await requirePermission("inventory:approve");
  const [pending, warehouses, fieldReps, locationNames] = await Promise.all([
    getPendingMovements(),
    getWarehouses(),
    getFieldReps().catch(() => []),
    getInventoryLocationNames().catch(() => ({})),
  ]);
  const fieldWarehouses = fieldReps.map(r => ({ label: `Field:${r.id}`, address: r.name }));
  const allWarehouses = [
    ...warehouses,
    ...fieldWarehouses.filter(fw => !warehouses.find(w => w.label === fw.label)),
  ];
  return <InventoryApprovalsClient pending={pending} warehouses={allWarehouses} locationNames={locationNames} />;
}
