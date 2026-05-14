import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { getRoles, getMemberCountPerRole } from "@/server/roles";
import { getPermissions } from "@/server/permissions";
import { RolesClient } from "./roles-client";

export default async function RolesPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  const activeOrgId = session?.session.activeOrganizationId;

  if (!activeOrgId) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        No active organization selected.
      </div>
    );
  }

  const [roles, memberCounts, permissions] = await Promise.all([
    getRoles(activeOrgId),
    getMemberCountPerRole(activeOrgId),
    getPermissions(),
  ]);

  // Add owner as a virtual role (managed by Better Auth, not in org_role table)
  const ownerRole = {
    id: "owner",
    organizationId: activeOrgId,
    role: "owner",
    permissions: permissions.map((p) => p.key),
    isSystem: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    permission: "",
  };

  const allRoles = [ownerRole, ...roles];

  return (
    <RolesClient
      roles={allRoles}
      memberCounts={memberCounts}
      permissions={permissions}
      organizationId={activeOrgId}
    />
  );
}
