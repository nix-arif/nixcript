"use server";

import { db } from "@/db";
import { permission, userPermission, member, user } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getCurrentUser } from "./users";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { nanoid } from "nanoid";
import { ALL_PERMISSIONS } from "@/lib/permissions/constants";

// ── Permissions ──────────────────────────────────────────

export const getPermissions = async () => {
  return await db.select().from(permission);
};

export const createPermission = async (key: string, label: string) => {
  try {
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
    .where(eq(member.organizationId, organizationId));

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
