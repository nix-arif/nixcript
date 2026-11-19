import { ProductSearch } from "./product-search-client";
import { requirePermission } from "@/lib/auth/require-permission";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";

export default async function ProductSearchPage() {
  const session = await requirePermission("product:read");
  const orgId = session.session.activeOrganizationId!;
  const perms = await getUserPermissions(session.user.id, orgId);
  return <ProductSearch canDiscontinue={hasAccess(perms, "product:discontinue")} />;
}
