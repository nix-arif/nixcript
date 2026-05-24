import { requirePermission } from "@/lib/auth/require-permission";
import { getDeliveryOrderDetail } from "@/server/delivery-order";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { notFound } from "next/navigation";
import { DeliveryOrderDetailClient } from "./do-detail-client";

export default async function DeliveryOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("delivery-order:read");
  const { id } = await params;

  const [order, permissions] = await Promise.all([
    getDeliveryOrderDetail(id),
    getUserPermissions(session.user.id, session.session.activeOrganizationId!),
  ]);

  if (!order) notFound();

  return <DeliveryOrderDetailClient order={order} permissions={permissions} currentUserId={session.user.id} />;
}
