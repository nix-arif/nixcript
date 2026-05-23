import { requirePermission } from "@/lib/auth/require-permission";
import { CreateSalesOrderClient } from "./create-order-client";

export default async function CreateSalesOrderPage() {
  await requirePermission("sales-order:create");
  return <CreateSalesOrderClient />;
}
