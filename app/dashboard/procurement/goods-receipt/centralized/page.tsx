import { requirePermission } from "@/lib/auth/require-permission";
import { getAllGoodsReceiptsCentralized, getPendingReturnsAndRepairsCentralized } from "@/server/goods-receipt";
import { CentralizedGoodsReceiptClient } from "./centralized-goods-receipt-client";

export default async function CentralizedGoodsReceiptPage() {
  await requirePermission("goods-receipt:read:centralized");
  const [grs, pending] = await Promise.all([
    getAllGoodsReceiptsCentralized(),
    getPendingReturnsAndRepairsCentralized(),
  ]);
  return <CentralizedGoodsReceiptClient initialGrs={grs} pendingReturnsRepairs={pending} />;
}
