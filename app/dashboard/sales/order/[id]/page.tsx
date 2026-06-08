import { requirePermission } from "@/lib/auth/require-permission";
import { getSalesOrderDetail } from "@/server/sales-order";
import { getQuotationBasic } from "@/server/quotation";
import { getDeliveryOrdersBySoId } from "@/server/delivery-order";
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

  const [linkedQuotation, linkedDos, linkedPrs] = await Promise.all([
    order.quotationId ? getQuotationBasic(order.quotationId).catch(() => null) : Promise.resolve(null),
    getDeliveryOrdersBySoId(id).catch(() => []),
    getPrsBySoId(id).catch(() => []),
  ]);

  return <SalesOrderDetailClient order={order} linkedQuotation={linkedQuotation} linkedDos={linkedDos} linkedPrs={linkedPrs} permissions={permissions} currentUserId={session.user.id} draftRedirected={draft === "1"} />;
}
