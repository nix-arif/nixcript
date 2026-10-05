import { requirePermission } from "@/lib/auth/require-permission";
import { getSettlementOverview } from "@/server/consign";
import { SettlementClient } from "./settlement-client";

export default async function ConsignmentSettlementPage() {
  await requirePermission("consignment:settle");
  const overview = await getSettlementOverview();
  return <SettlementClient overview={overview} />;
}
