import { requirePermission } from "@/lib/auth/require-permission";
import { getStockMovements, getWarehouses } from "@/server/inventory";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { MovementsClient } from "./movements-client";

export default async function MovementsPage() {
  const session = await requirePermission("inventory:read");
  const [movements, warehouses, permissions] = await Promise.all([
    getStockMovements(),
    getWarehouses(),
    getUserPermissions(session.user.id, session.session.activeOrganizationId!),
  ]);
  return <MovementsClient movements={movements} warehouses={warehouses} permissions={permissions} />;
}
