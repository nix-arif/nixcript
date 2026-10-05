import { requirePermission } from "@/lib/auth/require-permission";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";
import { listConsignments } from "@/server/consign";
import { ConsignmentListClient } from "./consignment-list-client";

export default async function ConsignmentPage() {
  const session = await requirePermission("consignment:read");
  const [rows, perms] = await Promise.all([
    listConsignments(),
    getUserPermissions(session.user.id, session.session.activeOrganizationId!),
  ]);
  return <ConsignmentListClient rows={rows} canCreate={hasAccess(perms, "consignment:manage")} />;
}
