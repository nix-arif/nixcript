import { requirePermission } from "@/lib/auth/require-permission";
import { getLedgerAccounts } from "@/server/ledger";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { MemberBalancesClient } from "./member-balances-client";

export default async function MemberBalancesPage() {
  const session = await requirePermission("account:read");
  const [accounts, permissions] = await Promise.all([
    getLedgerAccounts(),
    getUserPermissions(session.user.id, session.session.activeOrganizationId!),
  ]);
  return <MemberBalancesClient accounts={accounts} permissions={permissions} />;
}
