import { notFound, redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/require-permission";
import {
  getPurchaseOrderDetailCentralized,
  updatePurchaseOrderCentralized,
  getApprovedSalesOrders,
  getActiveCustomerPos,
} from "@/server/purchase-order";
import { getSuppliers } from "@/server/supplier";
import { EditPurchaseOrderClient } from "../../../[id]/edit/edit-po-client";

export default async function CentralizedEditPurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("purchase-order:read:centralized");
  const { id } = await params;

  const [order, suppliers, approvedSos, customerPos] = await Promise.all([
    getPurchaseOrderDetailCentralized(id),
    getSuppliers(),
    getApprovedSalesOrders(),
    getActiveCustomerPos(),
  ]);

  if (!order) notFound();
  if (!order.canEdit) redirect(`/dashboard/procurement/purchase-order/centralized/${id}`);
  if (order.status !== "draft") redirect(`/dashboard/procurement/purchase-order/centralized/${id}`);

  const { organizationName, canEdit, businessType, ...rest } = order;
  return (
    <EditPurchaseOrderClient
      order={rest}
      suppliers={suppliers}
      approvedSos={approvedSos}
      customerPos={customerPos}
      updateFn={updatePurchaseOrderCentralized}
      detailHref={`/dashboard/procurement/purchase-order/centralized/${id}`}
    />
  );
}
