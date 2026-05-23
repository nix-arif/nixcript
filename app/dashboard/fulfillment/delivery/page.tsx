import { requirePermission } from "@/lib/auth/require-permission";
import { getDeliveryOrders } from "@/server/delivery-order";
import { DeliveryOrderListClient } from "./delivery-list-client";

export default async function DeliveryOrderPage() {
  await requirePermission("delivery-order:read");
  const orders = await getDeliveryOrders();
  return <DeliveryOrderListClient initialOrders={orders} />;
}
