import { requirePermission } from "@/lib/auth/require-permission";
import { getSalesOrders } from "@/server/sales-order";
import { SalesOrderListClient } from "./order-list-client";

export default async function SalesOrderPage() {
  await requirePermission("sales-order:read");
  const orders = await getSalesOrders();
  return <SalesOrderListClient initialOrders={orders} />;
}
