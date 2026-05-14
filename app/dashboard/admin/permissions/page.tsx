// app/dashboard/admin/permissions/page.tsx
import {
  getPermissions,
  getMembersWithPermissions,
  getUserPermissionsForOrg,
} from "@/server/permissions";
// import { PermissionsPageClient } from "./permissions-client";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { AllPermissions } from "@/app/dashboard/admin/permissions/permissions-client";
import { requirePermission } from "@/lib/auth/require-permission";

export default async function PermissionsPage() {
  await requirePermission("permission:read");
  const session = await auth.api.getSession({ headers: await headers() });
  const activeOrgId = session?.session.activeOrganizationId;

  if (!activeOrgId) {
    return (
      <div
        style={{
          padding: "1.5rem",
          color: "var(--color-text-secondary)",
          fontSize: "14px",
        }}
      >
        No active organization selected.
      </div>
    );
  }

  const [permissions, membersPermissions] = await Promise.all([
    getPermissions(),
    getMembersWithPermissions(activeOrgId),
  ]);

  //   console.log(membersPermissions);

  return (
    <div>
      <AllPermissions
        permissions={permissions}
        organizationId={activeOrgId}
        members={membersPermissions}
      />
    </div>
  );
}
