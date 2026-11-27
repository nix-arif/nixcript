import { requirePermission } from "@/lib/auth/require-permission";
import { getPurchaseOrders, getPendingPrsForPoConversion } from "@/server/purchase-order";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { PurchaseOrderListClient } from "./purchase-order-list-client";
import { categoriesOfOrgs } from "@/lib/document-category/inherit";

export default async function PurchaseOrderPage() {
  const session = await requirePermission("purchase-order:read");
  const [orders, pendingPrs, permissions, categories] = await Promise.all([
    getPurchaseOrders(),
    getPendingPrsForPoConversion(),
    getUserPermissions(session.user.id, session.session.activeOrganizationId!),
    categoriesOfOrgs([session.session.activeOrganizationId!]), // for the filter chips
  ]);
  return <PurchaseOrderListClient initialOrders={orders} pendingPrs={pendingPrs} permissions={permissions} currentUserId={session.user.id} categories={categories} />;
}
