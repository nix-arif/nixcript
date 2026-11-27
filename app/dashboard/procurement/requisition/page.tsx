import { requirePermission } from "@/lib/auth/require-permission";
import { getPurchaseRequisitions, getPendingSosForPr } from "@/server/purchase-requisition";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { PrListClient } from "./pr-list-client";
import { categoriesOfOrgs } from "@/lib/document-category/inherit";

export default async function PurchaseRequisitionPage() {
  const session = await requirePermission("purchase-requisition:read");
  const [requisitions, pendingSos, permissions, categories] = await Promise.all([
    getPurchaseRequisitions(),
    getPendingSosForPr(),
    getUserPermissions(session.user.id, session.session.activeOrganizationId!),
    categoriesOfOrgs([session.session.activeOrganizationId!]), // for the filter chips
  ]);
  return <PrListClient requisitions={requisitions} pendingSos={pendingSos} permissions={permissions} categories={categories} />;
}
