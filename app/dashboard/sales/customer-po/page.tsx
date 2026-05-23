import { requirePermission } from "@/lib/auth/require-permission";
import { getCustomerPos } from "@/server/customer-purchase-order";
import { CustomerPoClient } from "./customer-po-client";

export default async function CustomerPoPage() {
  await requirePermission("customer-po:read");
  const pos = await getCustomerPos();
  return <CustomerPoClient initialPos={pos} />;
}
