import { getMembersWithPermissions } from "@/server/permissions";
import { BulkPermissionsClient } from "./bulk-permissions-client";
import { requirePermission } from "@/lib/auth/require-permission";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";

export default async function BulkPermissionsPage() {
  await requirePermission("permission:create");
  const session = await auth.api.getSession({ headers: await headers() });
  const activeOrgId = session?.session.activeOrganizationId;

  if (!activeOrgId) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        No active organization selected.
      </div>
    );
  }

  const members = await getMembersWithPermissions(activeOrgId);

  return (
    <BulkPermissionsClient members={members} organizationId={activeOrgId} />
  );
}
