import { db } from "@/db";
import { member, userPermission } from "@/db/schema";
import { and, eq } from "drizzle-orm";

const OWNER_ALL_PERMISSIONS = "*";

export async function getUserPermissions(
  userId: string,
  organizationId: string,
): Promise<string[]> {
  // 1. Fetch role from member table
  const [memberData] = await db
    .select()
    .from(member)
    .where(
      and(eq(member.userId, userId), eq(member.organizationId, organizationId)),
    )
    .limit(1);

  if (!memberData) return [];

  // 2. Owner short-circuits
  if (memberData.role === "owner") return [OWNER_ALL_PERMISSIONS];

  // 3. Everyone else — fetch explicit permission rows
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
