import { requirePermission } from "@/lib/auth/require-permission";
import { getPurchaseOrders } from "@/server/purchase-order";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { PurchaseOrderListClient } from "./purchase-order-list-client";

export default async function PurchaseOrderPage() {
  const session = await requirePermission("purchase-order:read");
  const [orders, permissions] = await Promise.all([
    getPurchaseOrders(),
    getUserPermissions(session.user.id, session.session.activeOrganizationId!),
  ]);
  return <PurchaseOrderListClient initialOrders={orders} permissions={permissions} currentUserId={session.user.id} />;
}
