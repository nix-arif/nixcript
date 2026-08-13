"use server";

import { db } from "@/db";
import { permission, userPermission, member, user } from "@/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { getCurrentUser } from "./users";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { nanoid } from "nanoid";
import { ALL_PERMISSIONS } from "@/lib/permissions/constants";
import { getCachedSession } from "@/lib/auth/cached-session";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";

// Resolves the caller's own session + active org and checks the given
// permission — never trusts a client-supplied organizationId for the
// authorization decision itself. Callers still pass organizationId to say
// *which* org's data to read/write, but callOrgMatches() below makes sure
// that argument can't be spoofed to target an org the caller isn't in.
async function requireAccess(permKey: string) {
  const session = await getCachedSession();
  if (!session) throw new Error("Unauthorized");
  const orgId = session.session.activeOrganizationId;
  if (!orgId) throw new Error("No active organization");

  const perms = await getUserPermissions(session.user.id, orgId);
  if (!hasAccess(perms, permKey)) throw new Error("You don't have permission to do this");

  return { orgId, userId: session.user.id, perms };
}

function assertOrgMatches(claimedOrgId: string, actualOrgId: string) {
  if (claimedOrgId !== actualOrgId) throw new Error("Unauthorized");
}

// Nobody — including someone who holds permission:update — can hand out a
// permission they don't currently hold themselves. Without this, having
// permission:update becomes a master key: grant it to one person and they
// can bootstrap themselves (or anyone else) up to full access one toggle at
// a time. Owners bypass via the "*" marker. Only checked on the grant path
// (allowed = true) — revoking is a reduction in access, never an escalation,
// so it doesn't need this guard.
function assertCanGrant(callerPerms: string[], keysToGrant: string[]) {
  if (callerPerms.includes("*")) return;
  const missing = keysToGrant.filter((k) => !callerPerms.includes(k));
  if (missing.length > 0) {
    throw new Error(`You cannot grant permissions you don't have yourself: ${missing.join(", ")}`);
  }
}

// ── Permissions ──────────────────────────────────────────
//
// `permission` is a global catalog table, not scoped to any one org — so
// there's no org to authorize against the way every other function in this
// file does. None of these three have a live caller today (see
// /test-boundary), but as a "use server" export each is still a directly
// invokable endpoint, so it's gated defensively: caller must be an owner of
// their active org, the closest available proxy for "trusted admin" when
// the resource itself has no owning org.
async function requireOwner() {
  const session = await getCachedSession();
  if (!session) throw new Error("Unauthorized");
  const orgId = session.session.activeOrganizationId;
  if (!orgId) throw new Error("No active organization");
  const [m] = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.userId, session.user.id), eq(member.organizationId, orgId), isNull(member.deletedAt)))
    .limit(1);
  if (!m || m.role !== "owner") throw new Error("Only owners can do this");
}

export const getPermissions = async () => {
  await requireOwner();
  return await db.select().from(permission);
};

export const createPermission = async (key: string, label: string) => {
  try {
    await requireOwner();
    await db
      .insert(permission)
      .values({ id: nanoid(), key, label })
      .onConflictDoNothing();
    return { success: true, message: "Permission created." };
  } catch (e) {
    return { success: false, message: (e as Error).message };
  }
};

export const deletePermission = async (id: string) => {
  try {
    await requireOwner();
    // Fetch the permission first to check if it's a default one
    const [existing] = await db
      .select()
      .from(permission)
      .where(eq(permission.id, id))
      .limit(1);

    if (!existing) return { success: false, message: "Permission not found." };

    const defaultKeys = new Set<string>(ALL_PERMISSIONS.map((p) => p.key));
    if (defaultKeys.has(existing.key)) {
      return {
        success: false,
        message: "Default permissions cannot be deleted.",
      };
    }

    await db.delete(permission).where(eq(permission.id, id));
    return { success: true, message: "Permission deleted." };
  } catch (e) {
    return { success: false, message: (e as Error).message };
  }
};

// ── Members + their permissions ───────────────────────────

export const getMembersWithPermissions = async (organizationId: string) => {
  const { orgId } = await requireAccess("permission:read");
  assertOrgMatches(organizationId, orgId);

  const rows = await db
    .select({
      memberId: member.id,
      userId: member.userId,
      role: member.role,
      name: user.name,
      email: user.email,
      image: user.image,
      permissionKey: userPermission.permissionKey,
      allowed: userPermission.allowed,
    })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .leftJoin(
      userPermission,
      and(
        eq(userPermission.userId, member.userId),
        eq(userPermission.organizationId, organizationId),
      ),
    )
    .where(and(eq(member.organizationId, organizationId), isNull(member.deletedAt)));

  // Group flat rows into members with permissions array
  const membersMap = new Map<
    string,
    {
      memberId: string;
      userId: string;
      role: string;
      name: string;
      email: string;
      image: string | null | undefined;
      permissions: { key: string; allowed: boolean }[];
    }
  >();

  for (const row of rows) {
    if (!membersMap.has(row.userId)) {
      membersMap.set(row.userId, {
        memberId: row.memberId,
        userId: row.userId,
        role: row.role,
        name: row.name,
        email: row.email,
        image: row.image,
        permissions: [],
      });
    }

    if (row.permissionKey !== null && row.allowed !== null) {
      membersMap.get(row.userId)!.permissions.push({
        key: row.permissionKey,
        allowed: row.allowed,
      });
    }
  }

  return Array.from(membersMap.values());
};

export const getUserPermissionsForOrg = async (
  userId: string,
  organizationId: string,
) => {
  const { orgId } = await requireAccess("permission:read");
  assertOrgMatches(organizationId, orgId);

  return await db
    .select()
    .from(userPermission)
    .where(
      and(
        eq(userPermission.userId, userId),
        eq(userPermission.organizationId, organizationId),
      ),
    );
};

export const bulkGrantPermissions = async (
  userId: string,
  organizationId: string,
  permissionKeys: string[],
) => {
  try {
    const { orgId, perms } = await requireAccess("permission:update");
    assertOrgMatches(organizationId, orgId);
    assertCanGrant(perms, permissionKeys);

    await Promise.all(
      permissionKeys.map((key) =>
        db
          .insert(userPermission)
          .values({ id: nanoid(), userId, organizationId, permissionKey: key, allowed: true })
          .onConflictDoUpdate({
            target: [userPermission.userId, userPermission.organizationId, userPermission.permissionKey],
            set: { allowed: true },
          }),
      ),
    );
    return { success: true };
  } catch (e) {
    return { success: false, message: (e as Error).message };
  }
};

export const bulkRevokePermissions = async (
  userId: string,
  organizationId: string,
  permissionKeys: string[],
) => {
  try {
    const { orgId } = await requireAccess("permission:update");
    assertOrgMatches(organizationId, orgId);

    await Promise.all(
      permissionKeys.map((key) =>
        db
          .insert(userPermission)
          .values({ id: nanoid(), userId, organizationId, permissionKey: key, allowed: false })
          .onConflictDoUpdate({
            target: [userPermission.userId, userPermission.organizationId, userPermission.permissionKey],
            set: { allowed: false },
          }),
      ),
    );
    return { success: true };
  } catch (e) {
    return { success: false, message: (e as Error).message };
  }
};

export const upsertUserPermission = async (
  userId: string,
  organizationId: string,
  permissionKey: string,
  allowed: boolean,
) => {
  try {
    const { orgId, perms } = await requireAccess("permission:update");
    assertOrgMatches(organizationId, orgId);
    if (allowed) assertCanGrant(perms, [permissionKey]);

    await db
      .insert(userPermission)
      .values({
        id: nanoid(),
        userId,
        organizationId,
        permissionKey,
        allowed,
      })
      .onConflictDoUpdate({
        target: [
          userPermission.userId,
          userPermission.organizationId,
          userPermission.permissionKey,
        ],
        set: { allowed },
      });
    return { success: true };
  } catch (e) {
    return { success: false, message: (e as Error).message };
  }
};
