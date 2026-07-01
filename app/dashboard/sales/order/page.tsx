import { requirePermission } from "@/lib/auth/require-permission";
import { getSalesOrders } from "@/server/sales-order";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { getOpenCustomerPos } from "@/server/customer-purchase-order";
import { SalesOrderListClient } from "./order-list-client";

export default async function SalesOrderPage() {
  const session = await requirePermission("sales-order:read");
  const [orders, permissions, pendingCpos] = await Promise.all([
    getSalesOrders(),
    getUserPermissions(session.user.id, session.session.activeOrganizationId!),
    getOpenCustomerPos().catch(() => []),
  ]);
  return <SalesOrderListClient initialOrders={orders} permissions={permissions} currentUserId={session.user.id} pendingCpos={pendingCpos} />;
}
