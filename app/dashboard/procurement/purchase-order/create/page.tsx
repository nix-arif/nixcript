import { requirePermission } from "@/lib/auth/require-permission";
import { getSuppliers } from "@/server/supplier";
import {
  getApprovedSalesOrders,
  getActiveCustomerPos,
  getPrForPoConversion,
} from "@/server/purchase-order";
import { redirect } from "next/navigation";
import { CreatePurchaseOrderClient } from "./create-po-client";

export default async function CreatePurchaseOrderPage({ searchParams }: { searchParams: Promise<{ soId?: string; prId?: string }> }) {
  await requirePermission("purchase-order:create");
  const { soId, prId } = await searchParams;

  // PR conversion path
  if (prId) {
    const [prData, suppliers] = await Promise.all([
      getPrForPoConversion(prId).catch(() => null),
      getSuppliers(),
    ]);
    if (!prData) redirect("/dashboard/procurement/requisition");
    return <CreatePurchaseOrderClient suppliers={suppliers} prData={prData} />;
  }

  // Direct creation path
  const [suppliers, approvedSos, customerPos] = await Promise.all([
    getSuppliers(),
    getApprovedSalesOrders(),
    getActiveCustomerPos(),
  ]);
  return <CreatePurchaseOrderClient suppliers={suppliers} approvedSos={approvedSos} customerPos={customerPos} initialSoId={soId} />;
}
