import { requirePermission } from "@/lib/auth/require-permission";
import { getSalesOrders } from "@/server/sales-order";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { SalesOrderListClient } from "./order-list-client";

export default async function SalesOrderPage() {
  const session = await requirePermission("sales-order:read");
  const [orders, permissions] = await Promise.all([
    getSalesOrders(),
    getUserPermissions(session.user.id, session.session.activeOrganizationId!),
  ]);
  return <SalesOrderListClient initialOrders={orders} permissions={permissions} currentUserId={session.user.id} />;
}
