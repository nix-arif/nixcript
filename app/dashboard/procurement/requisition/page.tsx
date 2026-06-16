import { requirePermission } from "@/lib/auth/require-permission";
import { getPurchaseRequisitions, getPendingSosForPr } from "@/server/purchase-requisition";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { PrListClient } from "./pr-list-client";

export default async function PurchaseRequisitionPage() {
  const session = await requirePermission("purchase-requisition:read");
  const [requisitions, pendingSos, permissions] = await Promise.all([
    getPurchaseRequisitions(),
    getPendingSosForPr(),
    getUserPermissions(session.user.id, session.session.activeOrganizationId!),
  ]);
  return <PrListClient requisitions={requisitions} pendingSos={pendingSos} permissions={permissions} />;
}
