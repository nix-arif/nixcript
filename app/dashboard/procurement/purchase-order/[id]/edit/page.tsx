import { requirePermission } from "@/lib/auth/require-permission";
import { getPurchaseOrderDetail, getApprovedSalesOrders, getActiveCustomerPos } from "@/server/purchase-order";
import { getSuppliers } from "@/server/supplier";
import { getOrganizationProfile } from "@/server/organization-profile";
import { notFound, redirect } from "next/navigation";
import { EditPurchaseOrderClient } from "./edit-po-client";

export default async function EditPurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("purchase-order:update");
  const { id } = await params;

  const [order, suppliers, approvedSos, customerPos, profile] = await Promise.all([
    getPurchaseOrderDetail(id),
    getSuppliers(),
    getApprovedSalesOrders(),
    getActiveCustomerPos(),
    getOrganizationProfile().catch(() => null),
  ]);

  if (!order) notFound();
  if (order.createdBy !== session.user.id) redirect(`/dashboard/procurement/purchase-order/${id}`);
  if (order.status !== "draft") redirect(`/dashboard/procurement/purchase-order/${id}`);

  return (
    <EditPurchaseOrderClient
      order={order}
      suppliers={suppliers}
      approvedSos={approvedSos}
      customerPos={customerPos}
      businessType={profile?.businessType ?? "trading"}
      currentUserName={session.user.name ?? ""}
    />
  );
}
