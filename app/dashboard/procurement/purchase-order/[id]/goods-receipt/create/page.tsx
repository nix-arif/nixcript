import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/require-permission";
import { getPurchaseOrderDetail } from "@/server/purchase-order";
import { CreateGoodsReceiptClient } from "./create-gr-client";

export default async function CreateGoodsReceiptPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePermission("purchase-order:update");
  const { id } = await params;
  const order = await getPurchaseOrderDetail(id);
  if (!order || order.status !== "confirmed") notFound();
  return <CreateGoodsReceiptClient order={order} />;
}
