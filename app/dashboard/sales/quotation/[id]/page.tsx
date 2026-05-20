import { requirePermission } from "@/lib/auth/require-permission";
import { getQuotationGroupAllDetails } from "@/server/quotation";
import { notFound } from "next/navigation";
import { QuotationDetailClient } from "./quotation-detail-client";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function QuotationDetailPage({ params }: Props) {
  await requirePermission("quotation:read");
  const { id } = await params;
  const group = await getQuotationGroupAllDetails(id);
  if (!group || group.length === 0) notFound();
  return <QuotationDetailClient group={group} initialId={id} />;
}
