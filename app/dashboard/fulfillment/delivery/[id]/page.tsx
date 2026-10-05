import { requirePermission } from "@/lib/auth/require-permission";
import { getCaseMachines, getDeliveryOrderDetail, getDoForPdf } from "@/server/delivery-order";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { redirect } from "next/navigation";
import { DeliveryOrderDetailClient } from "./do-detail-client";

export default async function DeliveryOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("delivery-order:read");
  const { id } = await params;

  const [order, permissions] = await Promise.all([
    getDeliveryOrderDetail(id),
    getUserPermissions(session.user.id, session.session.activeOrganizationId!),
  ]);

  // Gone (e.g. just deleted from this page — the delete's revalidation
  // re-renders this route before the client navigates away): back to the list
  if (!order) redirect("/dashboard/fulfillment/delivery");
  const machines = order.isCaseDo ? await getCaseMachines(id).catch(() => []) : [];
  // Items the customer copy leaves out (no valid MDA registration)
  // (a two-step Case DO's customer copy is its customer items)
  const pdf = order.isCaseDo ? await getDoForPdf(id).catch(() => null) : null;
  const noMda = order.isCaseDo
    ? (pdf?.customerItems ?? pdf?.items ?? []).filter((i) => !i.mdaValid)
        .map((i) => ({ code: i.productCode ?? "", reason: i.mdaRegNo ? `MDA ${i.mdaRegNo} expired` : "no MDA registration" }))
    : [];

  return <DeliveryOrderDetailClient order={order} machines={machines} noMda={noMda} permissions={permissions} currentUserId={session.user.id} />;
}
