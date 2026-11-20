import { requirePermission } from "@/lib/auth/require-permission";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";
import { getCustomerIssues } from "@/server/post-delivery";
import { IssuesListClient } from "./issues-list-client";

export default async function CustomerIssuesPage() {
  const session = await requirePermission("customer-issue:read");
  const perms = await getUserPermissions(session.user.id, session.session.activeOrganizationId!);
  return <IssuesListClient initial={await getCustomerIssues({ scope: "live" })} canCreate={hasAccess(perms, "customer-issue:create")} />;
}
