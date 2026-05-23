// lib/organization/on-created.ts
import { db } from "@/db";
import {
  organizationRole,
  userPermission,
  permission,
  organizationProfile,
  department,
} from "@/db/schema";
import {
  ALL_PERMISSIONS,
  ROLE_PERMISSIONS,
  DEFAULT_DEPARTMENTS,
} from "@/lib/permissions/constants";
import { nanoid } from "nanoid";

export async function onOrganizationCreated(
  organizationId: string,
  ownerId: string,
) {
  // 1. Seed global permission catalogue
  await db
    .insert(permission)
    .values(ALL_PERMISSIONS.map((p) => ({ id: nanoid(), ...p })))
    .onConflictDoNothing();

  // 2. Seed flat org roles (stakeholder only — manager/member are dept-aware)
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

  // 3. Seed all permissions for the owner
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

  // 4. Create default departments
  await db
    .insert(department)
    .values(
      DEFAULT_DEPARTMENTS.map((name) => ({
        id: nanoid(),
        organizationId,
        name,
        isDefault: true,
      })),
    )
    .onConflictDoNothing();

  // 5. Create org profile
  await db
    .insert(organizationProfile)
    .values({
      id: nanoid(),
      organizationId,
    })
    .onConflictDoNothing();
}
