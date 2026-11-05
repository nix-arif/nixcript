import { requirePermission } from "@/lib/auth/require-permission";
import { getReturnsToSupplier, getSurplusItems, getClosedReturns } from "@/server/receiving-issues";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { getCachedSession } from "@/lib/auth/cached-session";
import { ReceivingIssuesClient } from "./receiving-issues-client";

export default async function ReceivingIssuesPage() {
  await requirePermission("purchase-order:read");
  const session = await getCachedSession();
  const orgId = session!.session.activeOrganizationId!;
  const [returns, surplus, closedReturns, permissions] = await Promise.all([
    getReturnsToSupplier(),
    getSurplusItems(),
    getClosedReturns(),
    getUserPermissions(session!.user.id, orgId),
  ]);
  return <ReceivingIssuesClient initialReturns={returns} surplus={surplus} closedReturns={closedReturns} permissions={permissions} />;
}
