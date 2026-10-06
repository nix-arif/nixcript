import { requirePermission } from "@/lib/auth/require-permission";
import { getStockRulesPage } from "@/server/stock-rules";
import { StockRulesClient } from "./stock-rules-client";

export default async function StockRulesPage() {
  await requirePermission("inventory:read");
  const data = await getStockRulesPage();
  return <StockRulesClient data={data} />;
}
