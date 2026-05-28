import { requirePermission } from "@/lib/auth/require-permission";
import { getLedgerAccounts } from "@/server/ledger";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { AccountsClient } from "./accounts-client";

export default async function LedgerAccountsPage() {
  const session = await requirePermission("account:read");
  const [accounts, permissions] = await Promise.all([
    getLedgerAccounts(),
    getUserPermissions(session.user.id, session.session.activeOrganizationId!),
  ]);
  return <AccountsClient accounts={accounts} permissions={permissions} />;
}
