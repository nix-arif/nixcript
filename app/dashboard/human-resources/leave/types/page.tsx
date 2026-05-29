import { requirePermission } from "@/lib/auth/require-permission";
import { getLeaveTypes } from "@/server/leave";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { LeaveTypesClient } from "./leave-types-client";

export default async function LeaveTypesPage() {
  const session = await requirePermission("leave:manage");
  const [types, permissions] = await Promise.all([
    getLeaveTypes(),
    getUserPermissions(session.user.id, session.session.activeOrganizationId!),
  ]);
  return <LeaveTypesClient types={types} permissions={permissions} />;
}
