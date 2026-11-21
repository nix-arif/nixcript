import { eq } from "drizzle-orm";
import { db } from "@/db";
import { organization } from "@/db/schema";
import { requirePermission } from "@/lib/auth/require-permission";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";
import { getReviewTemplates } from "@/server/performance";
import { TemplatesClient } from "./templates-client";

export default async function ReviewTemplatesPage() {
  const session = await requirePermission("review:manage");
  const orgId = session.session.activeOrganizationId!;
  const [templates, perms, [org]] = await Promise.all([
    getReviewTemplates(),
    getUserPermissions(session.user.id, orgId),
    db.select({ name: organization.name }).from(organization).where(eq(organization.id, orgId)).limit(1),
  ]);
  return <TemplatesClient initial={templates} canDelete={hasAccess(perms, "review:template:delete")} orgName={org?.name ?? ""} />;
}
