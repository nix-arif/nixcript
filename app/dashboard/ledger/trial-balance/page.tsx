import { requirePermission } from "@/lib/auth/require-permission";
import { getTrialBalance } from "@/server/ledger";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { TrialBalanceClient } from "./trial-balance-client";

export default async function TrialBalancePage() {
  const session = await requirePermission("account:read");
  const [balances, permissions] = await Promise.all([
    getTrialBalance(),
    getUserPermissions(session.user.id, session.session.activeOrganizationId!),
  ]);
  return <TrialBalanceClient initialBalances={balances} permissions={permissions} />;
}
