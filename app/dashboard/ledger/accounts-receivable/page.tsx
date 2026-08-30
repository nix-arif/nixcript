import { requirePermission } from "@/lib/auth/require-permission";
import { getArOverview, getArReferenceData, type ArReferenceData } from "@/server/accounts-receivable";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";
import { AccountsReceivableClient } from "./accounts-receivable-client";

export default async function AccountsReceivablePage() {
  const session = await requirePermission("accounts-receivable:read");
  const orgId = session.session.activeOrganizationId!;
  const permissions = await getUserPermissions(session.user.id, orgId);

  // getArReferenceData additionally requires accounts-receivable:create — a
  // read-only holder (e.g. a bookkeeper who should only monitor, not key in
  // receipts) wouldn't have it, so only fetch it when they do.
  const [balances, refData] = await Promise.all([
    getArOverview(),
    hasAccess(permissions, "accounts-receivable:create") ? getArReferenceData() : Promise.resolve(null as ArReferenceData | null),
  ]);

  return <AccountsReceivableClient initialBalances={balances} refData={refData} permissions={permissions} />;
}
