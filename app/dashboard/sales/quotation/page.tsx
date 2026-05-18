import { requirePermission } from "@/lib/auth/require-permission";
import { getQuotations } from "@/server/quotation";
import { QuotationListClient } from "./quotation-list-client";

export default async function QuotationPage() {
  await requirePermission("quotation:read");
  const quotations = await getQuotations();
  return <QuotationListClient initialQuotations={quotations} />;
}
