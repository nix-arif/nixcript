import { requirePermission } from "@/lib/auth/require-permission";
import { getSalesOrderDetailCentralized } from "@/server/sales-order";
import { getQuotationBasic, type QuotationBasic } from "@/server/quotation";
import { getDeliveryOrdersBySoId, getSoItemDeliveredQtys } from "@/server/delivery-order";
import { getPrsBySoId } from "@/server/purchase-requisition";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { notFound } from "next/navigation";
import { SalesOrderDetailClient } from "../../[id]/so-detail-client";

export default async function CentralizedSalesOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("sales-order:read:centralized");
  const { id } = await params;

  const [data, permissions] = await Promise.all([
    getSalesOrderDetailCentralized(id),
    getUserPermissions(session.user.id, session.session.activeOrganizationId!),
  ]);

  if (!data) notFound();

  const { organizationName, ...order } = data;

  const allQuotationIds = (() => {
    const linked = (order.linkedQuotations as { id: string }[] | null) ?? [];
    const ids = new Set(linked.map((q) => q.id));
    if (order.quotationId) ids.add(order.quotationId);
    return [...ids];
  })();

  // Delivery orders / purchase requisitions are looked up scoped to the
  // caller's own active org (not owner-org-aware) — for an order that
  // belongs to a sibling org, these best-effort fetches may come back empty
  // rather than error. Linked quotations resolve correctly (getQuotationBasic
  // is already owner-org-aware).
  const [linkedQuotations, linkedDos, linkedPrs, itemDeliveredQtys] = await Promise.all([
    Promise.all(allQuotationIds.map((qId) => getQuotationBasic(qId).catch(() => null))).then(
      (results) => results.filter((q): q is QuotationBasic => q !== null)
    ),
    getDeliveryOrdersBySoId(id).catch(() => []),
    getPrsBySoId(id).catch(() => []),
    getSoItemDeliveredQtys(id).catch(() => ({} as Record<string, number>)),
  ]);

  const canEdit = permissions.includes("*") || permissions.includes("sales-order:update:centralized");

  return (
    <SalesOrderDetailClient
      order={order}
      linkedQuotations={linkedQuotations}
      linkedDos={linkedDos}
      linkedPrs={linkedPrs}
      permissions={[]}
      currentUserId={session.user.id}
      itemDeliveredQtys={itemDeliveredQtys}
      backHref="/dashboard/sales/order/centralized"
      organizationName={organizationName}
      editHref={canEdit ? `/dashboard/sales/order/centralized/${id}/edit` : undefined}
    />
  );
}
