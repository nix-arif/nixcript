import { requirePermission } from "@/lib/auth/require-permission";
import { getSalesOrderDetail } from "@/server/sales-order";
import { getQuotationBasic } from "@/server/quotation";
import { getCachedSession } from "@/lib/auth/cached-session";
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

  const linkedQuotation = order.quotationId
    ? await getQuotationBasic(order.quotationId).catch(() => null)
    : null;

  return <SalesOrderDetailClient order={order} linkedQuotation={linkedQuotation} permissions={permissions} currentUserId={session.user.id} draftRedirected={draft === "1"} />;
}
