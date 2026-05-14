import { db } from "@/db";
import { permission, userPermission } from "@/db/schema";
import { nanoid } from "nanoid";

export async function seedOwnerPermissions(
  organizationId: string,
  ownerId: string,
) {
  const allPermissions = await db.select().from(permission);

  await db
    .insert(userPermission)
    .values(
      allPermissions.map((p) => ({
        id: nanoid(),
        userId: ownerId,
        organizationId,
        permissionKey: p.key,
        allowed: true,
      })),
    )
    .onConflictDoNothing();
}
