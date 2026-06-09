import { requirePermission } from "@/lib/auth/require-permission";
import { getDeliveryOrders, getPendingSosForDo } from "@/server/delivery-order";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { DeliveryOrderListClient } from "./delivery-list-client";

export default async function DeliveryOrderPage() {
  const session = await requirePermission("delivery-order:read");
  const [orders, pendingSos, permissions] = await Promise.all([
    getDeliveryOrders(),
    getPendingSosForDo().catch(() => []),
    getUserPermissions(session.user.id, session.session.activeOrganizationId!),
  ]);
  return <DeliveryOrderListClient initialOrders={orders} pendingSos={pendingSos} permissions={permissions} currentUserId={session.user.id} />;
}
