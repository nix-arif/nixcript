import { db } from "@/db";
import { member, userPermission } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { ROLE_PERMISSIONS } from "@/lib/permissions/constants";

const OWNER_ALL_PERMISSIONS = "*";

export async function getUserPermissions(
  userId: string,
  organizationId: string,
): Promise<string[]> {
  // 1. Direct membership check
  const [memberData] = await db
    .select()
    .from(member)
    .where(
      and(eq(member.userId, userId), eq(member.organizationId, organizationId)),
    )
    .limit(1);

  if (memberData) {
    if (memberData.role === "owner") return [OWNER_ALL_PERMISSIONS];
    return resolvePermissions(userId, organizationId, memberData.role);
  }

  // 2. No direct membership — sibling org fallback.
  //    Members of any org in an owner's cluster can access sibling orgs
  //    using their home-org permissions (supports multi-org comparison flows).
  const [ownerMembership] = await db
    .select({ userId: member.userId })
    .from(member)
    .where(
      and(eq(member.organizationId, organizationId), eq(member.role, "owner")),
    )
    .limit(1);

  if (!ownerMembership) return [];

  const siblingOrgIds = (
    await db
      .select({ organizationId: member.organizationId })
      .from(member)
      .where(
        and(
          eq(member.userId, ownerMembership.userId),
          eq(member.role, "owner"),
        ),
      )
  ).map((r) => r.organizationId);

  if (siblingOrgIds.length === 0) return [];

  const [siblingMembership] = await db
    .select({ role: member.role, organizationId: member.organizationId })
    .from(member)
    .where(
      and(
        eq(member.userId, userId),
        inArray(member.organizationId, siblingOrgIds),
      ),
    )
    .limit(1);

  if (!siblingMembership) return [];
  if (siblingMembership.role === "owner") return [OWNER_ALL_PERMISSIONS];

  return resolvePermissions(
    userId,
    siblingMembership.organizationId,
    siblingMembership.role,
  );
}

// Returns the effective permission keys for a non-owner member.
// Uses explicit user_permission rows when they exist; otherwise falls back
// to the role's default permissions from ROLE_PERMISSIONS.
async function resolvePermissions(
  userId: string,
  organizationId: string,
  role: string,
): Promise<string[]> {
  // Fetch all rows — both allowed and denied — to detect whether any
  // explicit configuration exists for this user/org combination.
  const allRows = await db
    .select({ permissionKey: userPermission.permissionKey, allowed: userPermission.allowed })
    .from(userPermission)
    .where(
      and(
        eq(userPermission.userId, userId),
        eq(userPermission.organizationId, organizationId),
      ),
    );

  if (allRows.length > 0) {
    // Explicit rows exist — honour them (only return allowed ones).
    return allRows.filter((r) => r.allowed).map((r) => r.permissionKey);
  }

  // No explicit rows at all — fall back to the role's default permissions.
  return [...(ROLE_PERMISSIONS[role] ?? [])];
}
