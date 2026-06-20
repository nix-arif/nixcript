import { requirePermission } from "@/lib/auth/require-permission";
import { getInventory, getWarehouses, getExpiringLots } from "@/server/inventory";
import { getActiveConsignmentItems } from "@/server/consignment";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { InventoryClient } from "./inventory-client";

export default async function InventoryPage() {
  const session = await requirePermission("inventory:read");
  const [inventory, warehouses, permissions, activeConsignments, expiringLots] = await Promise.all([
    getInventory(),
    getWarehouses(),
    getUserPermissions(session.user.id, session.session.activeOrganizationId!),
    getActiveConsignmentItems().catch(() => []),
    getExpiringLots().catch(() => []),
  ]);
  return <InventoryClient inventory={inventory} warehouses={warehouses} permissions={permissions} activeConsignments={activeConsignments} expiringLots={expiringLots} />;
}
