import { requirePermission } from "@/lib/auth/require-permission";
import { getFieldReps } from "@/server/field-stock";
import { TransferClient } from "./transfer-client";

export default async function FieldStockTransferPage() {
  await requirePermission("inventory:create");
  const reps = await getFieldReps();
  return <TransferClient reps={reps} />;
}
