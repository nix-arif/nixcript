import { requirePermission } from "@/lib/auth/require-permission";
import { getCustomerPosCentralized } from "@/server/customer-purchase-order";
import { CentralizedCustomerPoClient } from "./centralized-po-client";

export default async function CentralizedCustomerPoPage() {
  await requirePermission("customer-po:read:centralized");
  const pos = await getCustomerPosCentralized();
  return <CentralizedCustomerPoClient initialPos={pos} />;
}
