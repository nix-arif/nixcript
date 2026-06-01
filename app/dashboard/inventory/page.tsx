import { requirePermission } from "@/lib/auth/require-permission";
import { getInventory, getWarehouses } from "@/server/inventory";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { InventoryClient } from "./inventory-client";

export default async function InventoryPage() {
  const session = await requirePermission("inventory:read");
  const [inventory, warehouses, permissions] = await Promise.all([
    getInventory(),
    getWarehouses(),
    getUserPermissions(session.user.id, session.session.activeOrganizationId!),
  ]);
  return <InventoryClient inventory={inventory} warehouses={warehouses} permissions={permissions} />;
}
