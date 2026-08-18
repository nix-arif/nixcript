import { requirePermission } from "@/lib/auth/require-permission";
import { getSalesOrdersCentralized } from "@/server/sales-order";
import { CentralizedSalesOrderClient } from "./centralized-order-client";

export default async function CentralizedSalesOrderPage() {
  await requirePermission("sales-order:read:centralized");
  const orders = await getSalesOrdersCentralized();
  return <CentralizedSalesOrderClient initialOrders={orders} />;
}
