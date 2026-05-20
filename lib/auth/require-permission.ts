// lib/auth/require-permission.ts
import { redirect } from "next/navigation";
import { getCachedSession } from "@/lib/auth/cached-session";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";

export async function requirePermission(permission: string) {
  const session = await getCachedSession();

  if (!session) redirect("/login");

  const orgId = session.session.activeOrganizationId;
  if (!orgId) redirect("/dashboard");

  const perms = await getUserPermissions(session.user.id, orgId);

  if (!hasAccess(perms, permission)) redirect("/dashboard?error=forbidden");

  return session;
}
