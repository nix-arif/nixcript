import { requirePermission } from "@/lib/auth/require-permission";
import { getLedgerAccounts } from "@/server/ledger";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { SubsidiaryLedgerClient } from "./subsidiary-ledger-client";

export default async function SubsidiaryLedgerPage() {
  const session = await requirePermission("account:read");
  const [accounts, permissions] = await Promise.all([
    getLedgerAccounts(),
    getUserPermissions(session.user.id, session.session.activeOrganizationId!),
  ]);
  return <SubsidiaryLedgerClient accounts={accounts} permissions={permissions} />;
}
