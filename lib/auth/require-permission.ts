// lib/auth/require-permission.ts
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";

export async function requirePermission(permission: string) {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) redirect("/login");

  const orgId = session.session.activeOrganizationId;
  if (!orgId) redirect("/dashboard");

  const perms = await getUserPermissions(session.user.id, orgId);

  if (!hasAccess(perms, permission)) redirect("/dashboard?error=forbidden");

  return session;
}
