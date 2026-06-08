import { requirePermission } from "@/lib/auth/require-permission";
import { getPurchaseRequisitions } from "@/server/purchase-requisition";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { PrListClient } from "./pr-list-client";

export default async function PurchaseRequisitionPage() {
  const session = await requirePermission("purchase-order:read");
  const [requisitions, permissions] = await Promise.all([
    getPurchaseRequisitions(),
    getUserPermissions(session.user.id, session.session.activeOrganizationId!),
  ]);
  return <PrListClient requisitions={requisitions} permissions={permissions} />;
}
