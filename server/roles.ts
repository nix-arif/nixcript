"use server";

import { db } from "@/db";
import { organizationRole, member, userPermission } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { ROLE_PERMISSIONS } from "@/lib/permissions/constants";
import { getCachedSession } from "@/lib/auth/cached-session";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";

const SYSTEM_ROLES = ["owner", "admin", "member"];

// This whole file has no live callers today (the one prior consumer,
// create-new-role-form.tsx, imports it commented out) — but every exported
// function in a "use server" file is still a directly-invokable action
// endpoint, so it's gated the same as any live one rather than left open
// for whenever a UI gets wired back up to it.
async function assertOrgMember(organizationId: string): Promise<string> {
  const session = await getCachedSession();
  if (!session) throw new Error("Unauthorized");
  const orgId = session.session.activeOrganizationId;
  if (!orgId || orgId !== organizationId) throw new Error("Unauthorized");
  return session.user.id;
}

async function requireAccess(organizationId: string, permission: string): Promise<string> {
  const userId = await assertOrgMember(organizationId);
  const perms = await getUserPermissions(userId, organizationId);
  if (!hasAccess(perms, permission)) throw new Error("You don't have permission to do this");
  return userId;
}

export const getRoles = async (organizationId: string) => {
  await assertOrgMember(organizationId);

  const roles = await db
    .select()
    .from(organizationRole)
    .where(eq(organizationRole.organizationId, organizationId));

  return roles.map((r) => ({
    ...r,
    permissions: JSON.parse(r.permission) as string[],
    isSystem: SYSTEM_ROLES.includes(r.role),
  }));
};

export const getMemberCountPerRole = async (organizationId: string) => {
  await assertOrgMember(organizationId);

  const members = await db
    .select({ role: member.role })
    .from(member)
    .where(eq(member.organizationId, organizationId));

  return members.reduce(
    (acc, m) => {
      acc[m.role] = (acc[m.role] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );
};

export const createRole = async (
  organizationId: string,
  roleName: string,
  permissions: string[],
) => {
  try {
    const callerId = await requireAccess(organizationId, "organization-role:create");
    const callerPerms = await getUserPermissions(callerId, organizationId);
    if (!callerPerms.includes("*")) {
      const missing = permissions.filter((k) => !callerPerms.includes(k));
      if (missing.length > 0) {
        return { success: false, message: `You cannot grant permissions you don't have yourself: ${missing.join(", ")}` };
      }
    }

    const existing = await db
      .select()
      .from(organizationRole)
      .where(
        and(
          eq(organizationRole.organizationId, organizationId),
          eq(organizationRole.role, roleName.toLowerCase().trim()),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      return {
        success: false,
        message: "A role with this name already exists.",
      };
    }

    await db.insert(organizationRole).values({
      id: nanoid(),
      organizationId,
      role: roleName.toLowerCase().trim(),
      permission: JSON.stringify(permissions),
    });

    return { success: true, message: "Role created." };
  } catch (e) {
    return { success: false, message: (e as Error).message };
  }
};

export const updateRole = async (
  organizationId: string,
  roleId: string,
  permissions: string[],
) => {
  try {
    const callerId = await requireAccess(organizationId, "organization-role:update");
    const callerPerms = await getUserPermissions(callerId, organizationId);
    if (!callerPerms.includes("*")) {
      const missing = permissions.filter((k) => !callerPerms.includes(k));
      if (missing.length > 0) {
        return { success: false, message: `You cannot grant permissions you don't have yourself: ${missing.join(", ")}` };
      }
    }

    await db
      .update(organizationRole)
      .set({ permission: JSON.stringify(permissions) })
      .where(
        and(
          eq(organizationRole.id, roleId),
          eq(organizationRole.organizationId, organizationId),
        ),
      );

    return { success: true, message: "Role updated." };
  } catch (e) {
    return { success: false, message: (e as Error).message };
  }
};

export const deleteRole = async (
  organizationId: string,
  roleId: string,
  roleName: string,
) => {
  try {
    await requireAccess(organizationId, "organization-role:delete");

    // 1. Reassign members with this role to "member"
    await db
      .update(member)
      .set({ role: "member" })
      .where(
        and(
          eq(member.organizationId, organizationId),
          eq(member.role, roleName),
        ),
      );

    // 2. Get default member permissions
    const memberPermissions = ROLE_PERMISSIONS["member"] ?? [];

    // 3. Find affected users to reset their permissions
    const affectedMembers = await db
      .select({ userId: member.userId })
      .from(member)
      .where(
        and(
          eq(member.organizationId, organizationId),
          eq(member.role, "member"),
        ),
      );

    // 4. Reset their user_permission rows to member defaults
    for (const { userId } of affectedMembers) {
      await db
        .delete(userPermission)
        .where(
          and(
            eq(userPermission.userId, userId),
            eq(userPermission.organizationId, organizationId),
          ),
        );

      await db
        .insert(userPermission)
        .values(
          memberPermissions.map((key) => ({
            id: nanoid(),
            userId,
            organizationId,
            permissionKey: key,
            allowed: true,
          })),
        )
        .onConflictDoNothing();
    }

    // 5. Delete the role itself
    await db
      .delete(organizationRole)
      .where(
        and(
          eq(organizationRole.id, roleId),
          eq(organizationRole.organizationId, organizationId),
        ),
      );

    return {
      success: true,
      message: "Role deleted. Affected members reassigned to 'member'.",
    };
  } catch (e) {
    return { success: false, message: (e as Error).message };
  }
};
