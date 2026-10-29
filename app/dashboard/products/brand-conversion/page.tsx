import { requirePermission } from "@/lib/auth/require-permission";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";
import { BrandConversionClient } from "./brand-conversion-client";

export default async function BrandConversionPage() {
  const session = await requirePermission("brand-conversion:read");
  const perms = await getUserPermissions(session.user.id, session.session.activeOrganizationId!);
  return <BrandConversionClient canManage={hasAccess(perms, "brand-conversion:manage")} />;
}
