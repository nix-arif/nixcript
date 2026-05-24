import { requirePermission } from "@/lib/auth/require-permission";
import { getCustomerPoSummary } from "@/server/customer-purchase-order";
import { CustomerPoSummaryClient } from "./customer-po-summary-client";

export default async function CustomerPoSummaryPage() {
  await requirePermission("customer-po:read");
  const rows = await getCustomerPoSummary();
  return <CustomerPoSummaryClient rows={rows} />;
}
