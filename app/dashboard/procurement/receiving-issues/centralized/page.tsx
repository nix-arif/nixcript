import { requirePermission } from "@/lib/auth/require-permission";
import { getReturnsToSupplierCentralized, getSurplusItemsCentralized, getClosedReturnsCentralized } from "@/server/receiving-issues";
import { ReceivingIssuesClient } from "../receiving-issues-client";

export default async function CentralizedReceivingIssuesPage() {
  await requirePermission("goods-receipt:read:centralized");
  const [returns, surplus, closedReturns] = await Promise.all([getReturnsToSupplierCentralized(), getSurplusItemsCentralized(), getClosedReturnsCentralized()]);
  // No client-side gating here: every action is re-authorised on the server against the item's own org
  return <ReceivingIssuesClient initialReturns={returns} surplus={surplus} closedReturns={closedReturns} permissions={[]} centralized />;
}
