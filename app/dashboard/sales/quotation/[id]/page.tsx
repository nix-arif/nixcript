import { requirePermission } from "@/lib/auth/require-permission";
import { getQuotationDetail } from "@/server/quotation";
import { notFound } from "next/navigation";
import { QuotationDetailClient } from "./quotation-detail-client";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function QuotationDetailPage({ params }: Props) {
  await requirePermission("quotation:read");
  const { id } = await params;
  const data = await getQuotationDetail(id);
  if (!data) notFound();
  return <QuotationDetailClient data={data} />;
}
