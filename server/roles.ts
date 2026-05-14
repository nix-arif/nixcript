"use server";

import { db } from "@/db";
import { organizationRole, member, userPermission } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { ROLE_PERMISSIONS } from "@/lib/permissions/constants";

const SYSTEM_ROLES = ["owner", "admin", "member"];

export const getRoles = async (organizationId: string) => {
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
