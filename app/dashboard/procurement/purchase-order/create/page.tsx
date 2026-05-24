import { requirePermission } from "@/lib/auth/require-permission";
import { getSuppliers } from "@/server/supplier";
import { getApprovedSalesOrders, getActiveCustomerPos } from "@/server/purchase-order";
import { CreatePurchaseOrderClient } from "./create-po-client";

export default async function CreatePurchaseOrderPage({ searchParams }: { searchParams: Promise<{ soId?: string }> }) {
  await requirePermission("purchase-order:create");
  const { soId } = await searchParams;
  const [suppliers, approvedSos, customerPos] = await Promise.all([
    getSuppliers(),
    getApprovedSalesOrders(),
    getActiveCustomerPos(),
  ]);
  return <CreatePurchaseOrderClient suppliers={suppliers} approvedSos={approvedSos} customerPos={customerPos} initialSoId={soId} />;
}
