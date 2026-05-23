import { requirePermission } from "@/lib/auth/require-permission";
import { getPurchaseOrders } from "@/server/purchase-order";
import { PurchaseOrderListClient } from "./purchase-order-list-client";

export default async function PurchaseOrderPage() {
  await requirePermission("purchase-order:read");
  const orders = await getPurchaseOrders();
  return <PurchaseOrderListClient initialOrders={orders} />;
}
