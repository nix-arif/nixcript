import { requirePermission } from "@/lib/auth/require-permission";
import { getAllPackingLists, getPurchaseOrdersPendingPacking } from "@/server/packing-list";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { getCachedSession } from "@/lib/auth/cached-session";
import { PackingListListClient } from "./packing-list-list-client";

export default async function PackingListsPage() {
  await requirePermission("purchase-order:read");
  const session = await getCachedSession();
  const orgId = session!.session.activeOrganizationId!;
  const [lists, pendingPos, permissions] = await Promise.all([
    getAllPackingLists(),
    getPurchaseOrdersPendingPacking(),
    getUserPermissions(session!.user.id, orgId),
  ]);
  return <PackingListListClient initialLists={lists} pendingPos={pendingPos} permissions={permissions} />;
}
