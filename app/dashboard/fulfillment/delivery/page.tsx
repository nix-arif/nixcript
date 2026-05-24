import { requirePermission } from "@/lib/auth/require-permission";
import { getDeliveryOrders } from "@/server/delivery-order";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { DeliveryOrderListClient } from "./delivery-list-client";

export default async function DeliveryOrderPage() {
  const session = await requirePermission("delivery-order:read");
  const [orders, permissions] = await Promise.all([
    getDeliveryOrders(),
    getUserPermissions(session.user.id, session.session.activeOrganizationId!),
  ]);
  return <DeliveryOrderListClient initialOrders={orders} permissions={permissions} currentUserId={session.user.id} />;
}
