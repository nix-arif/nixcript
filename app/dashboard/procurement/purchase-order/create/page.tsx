import { requirePermission } from "@/lib/auth/require-permission";
import { getSuppliers } from "@/server/supplier";
import { CreatePurchaseOrderClient } from "./create-po-client";

export default async function CreatePurchaseOrderPage() {
  await requirePermission("purchase-order:create");
  const suppliers = await getSuppliers();
  return <CreatePurchaseOrderClient suppliers={suppliers} />;
}
