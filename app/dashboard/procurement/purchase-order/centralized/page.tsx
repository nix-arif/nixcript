import { requirePermission } from "@/lib/auth/require-permission";
import { getPurchaseOrdersCentralized } from "@/server/purchase-order";
import { CentralizedPurchaseOrderClient } from "./centralized-po-client";

export default async function CentralizedPurchaseOrderPage() {
  await requirePermission("purchase-order:read:centralized");
  const pos = await getPurchaseOrdersCentralized();
  return <CentralizedPurchaseOrderClient initialPos={pos} />;
}
