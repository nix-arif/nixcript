import { requirePermission } from "@/lib/auth/require-permission";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";
import { getSupplierClaims } from "@/server/post-delivery";
import { ClaimsListClient } from "./claims-list-client";

export default async function SupplierClaimsPage() {
  const session = await requirePermission("supplier-claim:read");
  const perms = await getUserPermissions(session.user.id, session.session.activeOrganizationId!);
  return <ClaimsListClient initial={await getSupplierClaims({ tab: "action" })} canSetTerms={hasAccess(perms, "supplier-claim:terms")} />;
}
