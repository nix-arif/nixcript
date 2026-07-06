import { requirePermission } from "@/lib/auth/require-permission";
import { getQuotationsList } from "@/server/quotation";
import { QuotationListClient } from "./quotation-list-client";

export default async function QuotationPage({
  searchParams,
}: {
  searchParams: Promise<{ batch?: string }>;
}) {
  await requirePermission("quotation:read");
  const { batch } = await searchParams;
  const groups = await getQuotationsList();
  return <QuotationListClient initialGroups={groups} batchFilter={batch} />;
}
