import { requirePermission } from "@/lib/auth/require-permission";
import { getSalesOrderDetail } from "@/server/sales-order";
import { getQuotationBasic, type QuotationBasic } from "@/server/quotation";
import { getDeliveryOrdersBySoId, getSoItemDeliveredQtys } from "@/server/delivery-order";
import { getPrsBySoId } from "@/server/purchase-requisition";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { notFound } from "next/navigation";
import { SalesOrderDetailClient } from "./so-detail-client";

export default async function SalesOrderDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ draft?: string }> }) {
  const session = await requirePermission("sales-order:read");
  const { id } = await params;
  const { draft } = await searchParams;

  const [order, permissions] = await Promise.all([
    getSalesOrderDetail(id),
    getUserPermissions(session.user.id, session.session.activeOrganizationId!),
  ]);

  if (!order) notFound();

  const allQuotationIds = (() => {
    const linked = (order.linkedQuotations as { id: string }[] | null) ?? [];
    const ids = new Set(linked.map((q) => q.id));
    if (order.quotationId) ids.add(order.quotationId);
    return [...ids];
  })();

  const [linkedQuotations, linkedDos, linkedPrs, itemDeliveredQtys] = await Promise.all([
    Promise.all(allQuotationIds.map((qId) => getQuotationBasic(qId).catch(() => null))).then(
      (results) => results.filter((q): q is QuotationBasic => q !== null)
    ),
    getDeliveryOrdersBySoId(id).catch(() => []),
    getPrsBySoId(id).catch(() => []),
    getSoItemDeliveredQtys(id).catch(() => ({} as Record<string, number>)),
  ]);

  return <SalesOrderDetailClient order={order} linkedQuotations={linkedQuotations} linkedDos={linkedDos} linkedPrs={linkedPrs} permissions={permissions} currentUserId={session.user.id} draftRedirected={draft === "1"} itemDeliveredQtys={itemDeliveredQtys} />;
}
