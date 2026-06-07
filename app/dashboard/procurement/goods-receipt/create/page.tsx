import { requirePermission } from "@/lib/auth/require-permission";
import { getConfirmedPosForGr } from "@/server/goods-receipt";
import { SelectPoClient } from "./select-po-client";

export default async function NewGoodsReceiptPage() {
  await requirePermission("purchase-order:update");
  const confirmedPos = await getConfirmedPosForGr();
  return <SelectPoClient confirmedPos={confirmedPos} />;
}
