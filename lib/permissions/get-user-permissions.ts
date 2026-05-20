import { db } from "@/db";
import { member, userPermission } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";

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

    const rows = await db
      .select()
      .from(userPermission)
      .where(
        and(
          eq(userPermission.userId, userId),
          eq(userPermission.organizationId, organizationId),
          eq(userPermission.allowed, true),
        ),
      );
    return rows.map((r) => r.permissionKey);
  }

  // 2. No direct membership — check sibling orgs under the same owner.
  //    Members of org X can access org Y if both are owned by the same owner,
  //    using their home-org permissions. This supports multi-org comparison flows.
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

  // Find user's membership in any sibling org
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

  // Return permissions from their home org
  const rows = await db
    .select()
    .from(userPermission)
    .where(
      and(
        eq(userPermission.userId, userId),
        eq(userPermission.organizationId, siblingMembership.organizationId),
        eq(userPermission.allowed, true),
      ),
    );
  return rows.map((r) => r.permissionKey);
}
