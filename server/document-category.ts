"use server";

import { db } from "@/db";
import { documentCategory } from "@/db/schema";
import { getCachedSession } from "@/lib/auth/cached-session";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";
import { nanoid } from "nanoid";
import { eq, and, asc, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";

async function requireOrgAccess() {
  const session = await getCachedSession();
  if (!session?.session?.activeOrganizationId) throw new Error("Unauthorized");
  const orgId = session.session.activeOrganizationId;
  const perms = await getUserPermissions(session.user.id, orgId);
  if (!hasAccess(perms, "organization-profile:read")) throw new Error("Forbidden");
  return { orgId, userId: session.user.id, perms };
}

async function requireWriteAccess() {
  const session = await getCachedSession();
  if (!session?.session?.activeOrganizationId) throw new Error("Unauthorized");
  const orgId = session.session.activeOrganizationId;
  const perms = await getUserPermissions(session.user.id, orgId);
  if (!hasAccess(perms, "organization-profile:update")) throw new Error("Forbidden");
  return { orgId, userId: session.user.id };
}

export type DocumentCategoryRow = typeof documentCategory.$inferSelect;

export async function getDocumentCategories(): Promise<DocumentCategoryRow[]> {
  const { orgId } = await requireOrgAccess();
  return db
    .select()
    .from(documentCategory)
    .where(eq(documentCategory.organizationId, orgId))
    .orderBy(asc(documentCategory.position), asc(documentCategory.createdAt));
}

export async function createDocumentCategory(input: {
  name: string;
  color?: string;
  isDefault?: boolean;
}): Promise<DocumentCategoryRow> {
  const { orgId } = await requireWriteAccess();

  // Place new category at the end
  const [{ maxPos }] = await db
    .select({ maxPos: sql<number>`coalesce(max(${documentCategory.position}), -1)` })
    .from(documentCategory)
    .where(eq(documentCategory.organizationId, orgId));

  const [row] = await db
    .insert(documentCategory)
    .values({
      id: nanoid(),
      organizationId: orgId,
      name: input.name.trim(),
      color: input.color ?? "#6366f1",
      isDefault: input.isDefault ?? false,
      position: (maxPos ?? -1) + 1,
    })
    .returning();

  revalidatePath("/dashboard/organization/categories");
  return row;
}

export async function updateDocumentCategory(input: {
  id: string;
  name?: string;
  color?: string;
  isDefault?: boolean;
}): Promise<DocumentCategoryRow> {
  const { orgId } = await requireWriteAccess();

  const [existing] = await db
    .select()
    .from(documentCategory)
    .where(and(eq(documentCategory.id, input.id), eq(documentCategory.organizationId, orgId)));
  if (!existing) throw new Error("Category not found");

  const [row] = await db
    .update(documentCategory)
    .set({
      name: input.name?.trim() ?? existing.name,
      color: input.color ?? existing.color,
      isDefault: input.isDefault ?? existing.isDefault,
    })
    .where(eq(documentCategory.id, input.id))
    .returning();

  revalidatePath("/dashboard/organization/categories");
  return row;
}

export async function deleteDocumentCategory(id: string): Promise<void> {
  const { orgId } = await requireWriteAccess();
  const [existing] = await db
    .select()
    .from(documentCategory)
    .where(and(eq(documentCategory.id, id), eq(documentCategory.organizationId, orgId)));
  if (!existing) throw new Error("Category not found");
  await db.delete(documentCategory).where(eq(documentCategory.id, id));
  revalidatePath("/dashboard/organization/categories");
}

// Bulk-update positions after a drag-and-drop reorder
export async function reorderDocumentCategories(orderedIds: string[]): Promise<void> {
  const { orgId } = await requireWriteAccess();
  for (let i = 0; i < orderedIds.length; i++) {
    await db
      .update(documentCategory)
      .set({ position: i })
      .where(and(eq(documentCategory.id, orderedIds[i]), eq(documentCategory.organizationId, orgId)));
  }
  revalidatePath("/dashboard/organization/categories");
}

// Toggles the isDefault flag on a single category (multiple defaults allowed)
export async function toggleDefaultDocumentCategory(id: string): Promise<DocumentCategoryRow> {
  const { orgId } = await requireWriteAccess();
  const [existing] = await db
    .select()
    .from(documentCategory)
    .where(and(eq(documentCategory.id, id), eq(documentCategory.organizationId, orgId)));
  if (!existing) throw new Error("Category not found");

  const [row] = await db
    .update(documentCategory)
    .set({ isDefault: !existing.isDefault })
    .where(eq(documentCategory.id, id))
    .returning();

  revalidatePath("/dashboard/organization/categories");
  return row;
}
