// lib/organization/on-created.ts
import { db } from "@/db";
import { organizationRole, userPermission, permission } from "@/db/schema";
import { ALL_PERMISSIONS, ROLE_PERMISSIONS } from "@/lib/permissions/constants";
import { nanoid } from "nanoid";

export async function onOrganizationCreated(
  organizationId: string,
  ownerId: string,
) {
  // 1. Seed global permissions (safe to re-run, skips existing)
  await db
    .insert(permission)
    .values(ALL_PERMISSIONS.map((p) => ({ id: nanoid(), ...p })))
    .onConflictDoNothing();

  // 2. Seed organization roles (admin + member) for this org
  for (const [role, permissions] of Object.entries(ROLE_PERMISSIONS)) {
    await db
      .insert(organizationRole)
      .values({
        id: nanoid(),
        organizationId,
        role,
        permission: JSON.stringify(permissions),
      })
      .onConflictDoNothing();
  }

  // 3. Seed owner permissions (all permissions, allowed: true)
  await db
    .insert(userPermission)
    .values(
      ALL_PERMISSIONS.map((p) => ({
        id: nanoid(),
        userId: ownerId,
        organizationId,
        permissionKey: p.key,
        allowed: true,
      })),
    )
    .onConflictDoNothing();
}
