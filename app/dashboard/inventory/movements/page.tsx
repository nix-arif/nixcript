import { requirePermission } from "@/lib/auth/require-permission";
import { getStockMovements, getWarehouses } from "@/server/inventory";
import { getFieldReps } from "@/server/field-stock";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { MovementsClient } from "./movements-client";

export default async function MovementsPage() {
  const session = await requirePermission("inventory:read");
  const [movements, warehouses, fieldReps, permissions] = await Promise.all([
    getStockMovements(),
    getWarehouses(),
    getFieldReps().catch(() => []),
    getUserPermissions(session.user.id, session.session.activeOrganizationId!),
  ]);

  // Merge configured warehouses with virtual field warehouses (Field:{repId})
  const fieldWarehouses = fieldReps.map(rep => ({ label: `Field:${rep.id}`, address: rep.name }));
  const allWarehouses = [
    ...warehouses,
    ...fieldWarehouses.filter(fw => !warehouses.find(w => w.label === fw.label)),
  ];

  return <MovementsClient movements={movements} warehouses={allWarehouses} permissions={permissions} />;
}
