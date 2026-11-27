import { requirePermission } from "@/lib/auth/require-permission";
import { getSalesOrders, getSalesOrderDeleteBlockers } from "@/server/sales-order";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { getOpenCustomerPos } from "@/server/customer-purchase-order";
import { SalesOrderListClient } from "./order-list-client";
import { categoriesOfOrgs } from "@/lib/document-category/inherit";

export default async function SalesOrderPage() {
  const session = await requirePermission("sales-order:read");
  const [orders, permissions, pendingCpos, categories] = await Promise.all([
    getSalesOrders(),
    getUserPermissions(session.user.id, session.session.activeOrganizationId!),
    getOpenCustomerPos().catch(() => []),
    categoriesOfOrgs([session.session.activeOrganizationId!]), // for the filter chips
  ]);
  // Only rows that would otherwise show a Delete button (the creator's own
  // deletable orders) need checking.
  const deletableIds = orders
    .filter((o) => ["draft", "pending-do", "pending-pr", "cancelled"].includes(o.status) && o.createdBy === session.user.id)
    .map((o) => o.id);
  const deleteBlockers = await getSalesOrderDeleteBlockers(deletableIds).catch(() => ({}));
  return <SalesOrderListClient initialOrders={orders} permissions={permissions} currentUserId={session.user.id} pendingCpos={pendingCpos} deleteBlockers={deleteBlockers} categories={categories} />;
}
