// lib/auth/require-permission.ts
import { redirect } from "next/navigation";
import { getCachedSession } from "@/lib/auth/cached-session";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";
import { db } from "@/db";
import { member } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";

export async function requirePermission(permission: string) {
  const session = await getCachedSession();

  if (!session) redirect("/login");

  const orgId = session.session.activeOrganizationId;
  if (!orgId) redirect("/dashboard");

  const perms = await getUserPermissions(session.user.id, orgId);

  if (!hasAccess(perms, permission)) redirect("/dashboard?error=forbidden");

  return session;
}

// Any one of several permissions is enough (e.g. view or manage)
export async function requireAnyPermission(permissions: string[]) {
  const session = await getCachedSession();

  if (!session) redirect("/login");

  const orgId = session.session.activeOrganizationId;
  if (!orgId) redirect("/dashboard");

  const perms = await getUserPermissions(session.user.id, orgId);

  if (!permissions.some((p) => hasAccess(perms, p))) redirect("/dashboard?error=forbidden");

  return { session, orgId, perms };
}

// Strictly owner — not owner-or-admin, and not permission-based. Use for
// actions that can hand out large permission bundles (approving member
// invitations / department assignments) where delegating the check to a
// grantable permission key would let it be handed out too.
export async function requireOwner() {
  const session = await getCachedSession();

  if (!session) redirect("/login");

  const orgId = session.session.activeOrganizationId;
  if (!orgId) redirect("/dashboard");

  const [m] = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.userId, session.user.id), eq(member.organizationId, orgId), isNull(member.deletedAt)))
    .limit(1);

  if (!m || m.role !== "owner") redirect("/dashboard?error=forbidden");

  return session;
}
