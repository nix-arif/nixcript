import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/require-permission";
import { getGoodsReceiptDetail } from "@/server/goods-receipt";
import { GoodsReceiptDetailClient } from "./gr-detail-client";

export default async function GoodsReceiptDetailPage({
  params,
}: {
  params: Promise<{ id: string; grId: string }>;
}) {
  await requirePermission("purchase-order:read");
  const { id, grId } = await params;
  const gr = await getGoodsReceiptDetail(grId);
  if (!gr || gr.purchaseOrderId !== id) notFound();
  return <GoodsReceiptDetailClient gr={gr} purchaseOrderId={id} />;
}
