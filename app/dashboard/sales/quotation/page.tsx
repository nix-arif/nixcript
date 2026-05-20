import { requirePermission } from "@/lib/auth/require-permission";
import { getQuotationsList } from "@/server/quotation";
import { QuotationListClient } from "./quotation-list-client";

export default async function QuotationPage() {
  await requirePermission("quotation:read");
  const groups = await getQuotationsList();
  return <QuotationListClient initialGroups={groups} />;
}
