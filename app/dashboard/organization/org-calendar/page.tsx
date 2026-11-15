import { requirePermission } from "@/lib/auth/require-permission";
import { getPublicHolidays, getCalendarSiblingOrgs } from "@/server/public-holiday";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";
import { PublicHolidaysClient } from "./public-holidays-client";
import { db } from "@/db";
import { organization } from "@/db/schema";
import { eq } from "drizzle-orm";

export default async function PublicHolidaysPage() {
  const session = await requirePermission("public-holiday:read");
  const orgId = session.session.activeOrganizationId!;
  const [holidays, siblings, perms, [org]] = await Promise.all([
    getPublicHolidays(),
    getCalendarSiblingOrgs(),
    getUserPermissions(session.user.id, orgId),
    db.select({ name: organization.name }).from(organization).where(eq(organization.id, orgId)).limit(1),
  ]);
  return (
    <PublicHolidaysClient
      orgName={org?.name ?? ""}
      siblingOrgs={siblings}
      holidays={holidays}
      canCreate={hasAccess(perms, "public-holiday:create")}
      canUpdate={hasAccess(perms, "public-holiday:update")}
      canDelete={hasAccess(perms, "public-holiday:delete")}
    />
  );
}
