import { requirePermission } from "@/lib/auth/require-permission";
import { getPublicHolidays } from "@/server/public-holiday";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";
import { PublicHolidaysClient } from "./public-holidays-client";

export default async function PublicHolidaysPage() {
  const session = await requirePermission("public-holiday:read");
  const [holidays, perms] = await Promise.all([
    getPublicHolidays(),
    getUserPermissions(session.user.id, session.session.activeOrganizationId!),
  ]);
  return (
    <PublicHolidaysClient
      holidays={holidays}
      canCreate={hasAccess(perms, "public-holiday:create")}
      canUpdate={hasAccess(perms, "public-holiday:update")}
      canDelete={hasAccess(perms, "public-holiday:delete")}
    />
  );
}
