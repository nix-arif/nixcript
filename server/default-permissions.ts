"use server";

import { db } from "@/db";
import { orgDefaultPermission, sensitivePermission, userPermission, member } from "@/db/schema";
import { getCachedSession } from "@/lib/auth/cached-session";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { ALL_PERMISSIONS } from "@/lib/permissions/constants";
import { auth } from "@/lib/auth";
import { and, eq, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import { revalidatePath } from "next/cache";

const ALL_PERMISSION_KEYS = new Set(ALL_PERMISSIONS.map((p) => p.key));

async function requireOwnerOrAdmin() {
  const session = await getCachedSession();
  if (!session) throw new Error("Unauthorized");
  const orgId = session.session.activeOrganizationId;
  if (!orgId) throw new Error("No active organization");

  const [m] = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.userId, session.user.id), eq(member.organizationId, orgId), isNull(member.deletedAt)))
    .limit(1);

  if (!m || !["owner", "admin"].includes(m.role)) throw new Error("Only owners and admins can manage default permissions");
  return { orgId, session };
}

export async function getDefaultPermissionKeys(): Promise<string[]> {
  const { orgId } = await requireOwnerOrAdmin();
  const rows = await db
    .select({ permissionKey: orgDefaultPermission.permissionKey })
    .from(orgDefaultPermission)
    .where(eq(orgDefaultPermission.organizationId, orgId));
  return rows.map((r) => r.permissionKey);
}

export async function getSensitivePermissionKeys(): Promise<string[]> {
  const { orgId } = await requireOwnerOrAdmin();
  const rows = await db
    .select({ permissionKey: sensitivePermission.permissionKey })
    .from(sensitivePermission)
    .where(eq(sensitivePermission.organizationId, orgId));
  return rows.map((r) => r.permissionKey);
}

// Marking/unmarking the "sensitive" flag itself needs no password — it's
// just metadata about which permissions should get the alert icon and the
// password gate below. Only actually granting a flagged permission does.
export async function setSensitivePermissionFlag(permissionKey: string, sensitive: boolean): Promise<void> {
  const { orgId } = await requireOwnerOrAdmin();
  if (!ALL_PERMISSION_KEYS.has(permissionKey as never)) throw new Error("Invalid permission key");

  if (sensitive) {
    await db.insert(sensitivePermission).values({ id: nanoid(), organizationId: orgId, permissionKey }).onConflictDoNothing();
  } else {
    await db
      .delete(sensitivePermission)
      .where(and(eq(sensitivePermission.organizationId, orgId), eq(sensitivePermission.permissionKey, permissionKey)));
  }
  revalidatePath("/dashboard/admin/default-permissions");
}

// Enabling a default grants it to every current non-owner member — including
// members who currently have zero explicit user_permission rows and are
// relying on live DEPT_ROLE_PERMISSIONS fallback (lib/permissions/get-user-permissions.ts).
// For those, we first materialize their full current effective permission
// set as explicit rows before adding the new key — otherwise a bare upsert
// of just the new key would flip them into "explicit mode" and silently
// wipe every permission they only ever had via department fallback.
async function applyDefaultToAllMembers(orgId: string, permissionKey: string): Promise<number> {
  await db
    .insert(orgDefaultPermission)
    .values({ id: nanoid(), organizationId: orgId, permissionKey })
    .onConflictDoNothing();

  const members = await db
    .select({ userId: member.userId, role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, orgId), isNull(member.deletedAt)));
  const eligible = members.filter((m) => m.role !== "owner");

  for (const m of eligible) {
    const existingRows = await db
      .select({ id: userPermission.id })
      .from(userPermission)
      .where(and(eq(userPermission.userId, m.userId), eq(userPermission.organizationId, orgId)))
      .limit(1);

    if (existingRows.length === 0) {
      // Relying entirely on live fallback today — lock in their current
      // effective permissions first so adding the new key doesn't erase them.
      const effective = await getUserPermissions(m.userId, orgId);
      const toMaterialize = effective.filter((k) => k !== "*");
      if (toMaterialize.length > 0) {
        await db
          .insert(userPermission)
          .values(toMaterialize.map((k) => ({ id: nanoid(), userId: m.userId, organizationId: orgId, permissionKey: k, allowed: true })))
          .onConflictDoNothing();
      }
    }

    await db
      .insert(userPermission)
      .values({ id: nanoid(), userId: m.userId, organizationId: orgId, permissionKey, allowed: true })
      .onConflictDoUpdate({
        target: [userPermission.userId, userPermission.organizationId, userPermission.permissionKey],
        set: { allowed: true },
      });
  }

  revalidatePath("/dashboard/admin/default-permissions");
  revalidatePath("/dashboard/admin/permissions");
  return eligible.length;
}

// Disabling only removes the org-wide default marker — per-member grants
// already applied are never retroactively revoked (see the Default
// Permissions page copy). Revoking from everyone is a separate, deliberate
// action via Access Control, not a side effect of unchecking a box here.
export async function setDefaultPermission(permissionKey: string, enabled: boolean): Promise<{ appliedToMembers: number }> {
  const { orgId } = await requireOwnerOrAdmin();
  if (!ALL_PERMISSION_KEYS.has(permissionKey as never)) throw new Error("Invalid permission key");

  if (!enabled) {
    await db
      .delete(orgDefaultPermission)
      .where(and(eq(orgDefaultPermission.organizationId, orgId), eq(orgDefaultPermission.permissionKey, permissionKey)));
    revalidatePath("/dashboard/admin/default-permissions");
    return { appliedToMembers: 0 };
  }

  const [flagged] = await db
    .select({ id: sensitivePermission.id })
    .from(sensitivePermission)
    .where(and(eq(sensitivePermission.organizationId, orgId), eq(sensitivePermission.permissionKey, permissionKey)))
    .limit(1);
  if (flagged) throw new Error("This permission is marked sensitive — confirm your password to enable it");

  const appliedToMembers = await applyDefaultToAllMembers(orgId, permissionKey);
  return { appliedToMembers };
}

// Password-gated variant for permissions flagged sensitive. Re-verifies the
// acting admin's own account password via the same sign-in check used
// elsewhere in this app (server/users.ts) before granting anything.
export async function enableSensitiveDefaultPermission(permissionKey: string, password: string): Promise<{ appliedToMembers: number }> {
  const { orgId, session } = await requireOwnerOrAdmin();
  if (!ALL_PERMISSION_KEYS.has(permissionKey as never)) throw new Error("Invalid permission key");

  try {
    await auth.api.signInEmail({ body: { email: session.user.email, password } });
  } catch {
    throw new Error("Incorrect password");
  }

  const appliedToMembers = await applyDefaultToAllMembers(orgId, permissionKey);
  return { appliedToMembers };
}
