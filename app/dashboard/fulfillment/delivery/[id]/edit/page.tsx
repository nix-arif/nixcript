import { requirePermission } from "@/lib/auth/require-permission";
import { getDeliveryOrderDetail } from "@/server/delivery-order";
import { notFound, redirect } from "next/navigation";
import { EditDeliveryOrderClient } from "./edit-do-client";

export default async function EditDeliveryOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("delivery-order:update");
  const { id } = await params;

  const order = await getDeliveryOrderDetail(id);

  if (!order) notFound();
  if (order.createdBy !== session.user.id) redirect(`/dashboard/fulfillment/delivery/${id}`);
  if (order.status !== "draft") redirect(`/dashboard/fulfillment/delivery/${id}`);

  return <EditDeliveryOrderClient order={order} />;
}
