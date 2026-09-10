import { requirePermission } from "@/lib/auth/require-permission";
import { getFieldReps, getMainWarehouseLabel } from "@/server/field-stock";
import { TransferClient } from "./transfer-client";

export default async function FieldStockTransferPage() {
  await requirePermission("inventory:create");
  const [reps, mainWarehouseLabel] = await Promise.all([getFieldReps(), getMainWarehouseLabel()]);
  return <TransferClient reps={reps} mainWarehouseLabel={mainWarehouseLabel} />;
}
