import { requirePermission } from "@/lib/auth/require-permission";
import { getOrgMembers, getDeletedMembers } from "@/server/members";
import { getDepartments } from "@/server/departments";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { getNoticePeriodPolicies } from "@/server/leave";
import { MembersClient } from "./members-client";

export default async function MembersPage() {
  const session = await requirePermission("member:read");
  const orgId = session.session.activeOrganizationId!;
  const [members, deletedMembers, departments, permissions, noticePolicies] = await Promise.all([
    getOrgMembers(),
    getDeletedMembers(),
    getDepartments(),
    getUserPermissions(session.user.id, orgId),
    getNoticePeriodPolicies(),
  ]);
  return (
    <MembersClient
      members={members}
      deletedMembers={deletedMembers}
      departments={departments}
      currentUserId={session.user.id}
      permissions={permissions}
      noticePolicies={noticePolicies}
    />
  );
}
