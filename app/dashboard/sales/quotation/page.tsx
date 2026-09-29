import { requirePermission } from "@/lib/auth/require-permission";
import { getQuotationsList, getQuotationsListVersion } from "@/server/quotation";
import { QuotationListClient } from "./quotation-list-client";

export default async function QuotationPage({
  searchParams,
}: {
  searchParams: Promise<{ batch?: string }>;
}) {
  await requirePermission("quotation:read");
  const { batch } = await searchParams;
  const [groups, listVersion] = await Promise.all([
    getQuotationsList(),
    getQuotationsListVersion(),
  ]);
  return (
    <QuotationListClient
      initialGroups={groups}
      listVersion={listVersion}
      batchFilter={batch}
    />
  );
}
