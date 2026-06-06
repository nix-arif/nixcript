"use server";

import { db } from "@/db";
import { department } from "@/db/schema";
import { getCachedSession } from "@/lib/auth/cached-session";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";
import { DEFAULT_DEPARTMENTS } from "@/lib/permissions/constants";
import { and, eq, asc } from "drizzle-orm";
import { nanoid } from "nanoid";
import { revalidatePath } from "next/cache";

async function requireAccess(permission: string) {
  const session = await getCachedSession();
  if (!session) throw new Error("You must be signed in to continue");
  const orgId = session.session.activeOrganizationId;
  if (!orgId) throw new Error("No active organization");
  const perms = await getUserPermissions(session.user.id, orgId);
  if (!hasAccess(perms, permission)) throw new Error("You don't have permission to do this");
  return { orgId, userId: session.user.id };
}

export async function getDepartments() {
  const { orgId } = await requireAccess("department:read");

  let rows = await db
    .select()
    .from(department)
    .where(eq(department.organizationId, orgId))
    .orderBy(asc(department.name));

  // Auto-seed default departments for orgs created before this feature
  if (rows.length === 0) {
    await db
      .insert(department)
      .values(
        DEFAULT_DEPARTMENTS.map((name) => ({
          id: nanoid(),
          organizationId: orgId,
          name,
          isDefault: true,
        })),
      )
      .onConflictDoNothing();

    rows = await db
      .select()
      .from(department)
      .where(eq(department.organizationId, orgId))
      .orderBy(asc(department.name));
  }

  return rows;
}

export type Department = Awaited<ReturnType<typeof getDepartments>>[number];

export async function createDepartment(name: string) {
  const { orgId } = await requireAccess("department:create");
  const trimmed = name.toLowerCase().trim().replace(/\s+/g, "-");

  const existing = await db
    .select()
    .from(department)
    .where(and(eq(department.organizationId, orgId), eq(department.name, trimmed)))
    .limit(1);

  if (existing.length > 0) throw new Error(`Department "${trimmed}" already exists`);

  await db.insert(department).values({
    id: nanoid(),
    organizationId: orgId,
    name: trimmed,
    isDefault: false,
  });

  revalidatePath("/dashboard/organization");
}

export async function deleteDepartment(id: string) {
  const { orgId } = await requireAccess("department:delete");

  const [dept] = await db
    .select()
    .from(department)
    .where(and(eq(department.id, id), eq(department.organizationId, orgId)))
    .limit(1);

  if (!dept) throw new Error("Department not found");
  if (dept.isDefault) throw new Error("Default departments cannot be deleted");

  await db
    .delete(department)
    .where(and(eq(department.id, id), eq(department.organizationId, orgId)));

  revalidatePath("/dashboard/organization");
}
