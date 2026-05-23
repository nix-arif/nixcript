import { requirePermission } from "@/lib/auth/require-permission";
import { getSalesOrderDetail } from "@/server/sales-order";
import { getQuotationBasic } from "@/server/quotation";
import { notFound } from "next/navigation";
import { SalesOrderDetailClient } from "./so-detail-client";

export default async function SalesOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("sales-order:read");
  const { id } = await params;
  const order = await getSalesOrderDetail(id);
  if (!order) notFound();

  const linkedQuotation = order.quotationId
    ? await getQuotationBasic(order.quotationId).catch(() => null)
    : null;

  return <SalesOrderDetailClient order={order} linkedQuotation={linkedQuotation} />;
}
