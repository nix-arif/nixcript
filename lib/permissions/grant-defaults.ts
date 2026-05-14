import { db } from "@/db";
import { organizationRole, userPermission } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

const OWNER_ROLE = "owner";

export async function grantDefaultPermissions(
  userId: string,
  organizationId: string,
  role: string,
) {
  if (role === OWNER_ROLE) return;

  const [orgRole] = await db
    .select()
    .from(organizationRole)
    .where(
      and(
        eq(organizationRole.organizationId, organizationId),
        eq(organizationRole.role, role),
      ),
    )
    .limit(1);

  if (!orgRole) {
    console.warn(`No organization role found for role: ${role}`);
    return;
  }

  const permissionKeys: string[] = JSON.parse(orgRole.permission);

  await db
    .insert(userPermission)
    .values(
      permissionKeys.map((key) => ({
        id: nanoid(),
        userId,
        organizationId,
        permissionKey: key,
        allowed: true,
      })),
    )
    .onConflictDoNothing();
}
