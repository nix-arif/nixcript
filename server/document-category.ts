"use server";

import { db } from "@/db";
import { documentCategory, member, organization } from "@/db/schema";
import { getCachedSession } from "@/lib/auth/cached-session";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";
import { nanoid } from "nanoid";
import { eq, and, asc, sql, inArray, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";

async function requireReadAccess() {
  const session = await getCachedSession();
  if (!session?.session?.activeOrganizationId) throw new Error("Unauthorized");
  const orgId = session.session.activeOrganizationId;
  const perms = await getUserPermissions(session.user.id, orgId);
  if (!hasAccess(perms, "quotation:read")) throw new Error("Forbidden");
  return { orgId, userId: session.user.id, perms };
}

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

// Every org owned by the same owner as orgId — same "owner org group"
// pattern duplicated across server/inventory.ts, server/supplier.ts,
// server/field-stock.ts, server/delivery-order.ts etc.
async function getOwnerOrgIds(orgId: string): Promise<string[]> {
  const [ownerMember] = await db
    .select({ userId: member.userId })
    .from(member)
    .where(and(eq(member.organizationId, orgId), eq(member.role, "owner"), isNull(member.deletedAt)))
    .limit(1);
  if (!ownerMember) return [orgId];
  const owned = await db
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(and(eq(member.userId, ownerMember.userId), eq(member.role, "owner"), isNull(member.deletedAt)));
  const ids = [...new Set(owned.map((m) => m.organizationId))];
  return ids.length > 0 ? ids : [orgId];
}

// The caller's sibling orgs (same owner, excluding the active one) — for
// populating the "bill this category to" picker on the intercompany PO rule.
export async function getSiblingOrganizations(): Promise<{ id: string; name: string }[]> {
  const { orgId } = await requireWriteAccess();
  const siblingIds = (await getOwnerOrgIds(orgId)).filter((id) => id !== orgId);
  if (siblingIds.length === 0) return [];
  return db
    .select({ id: organization.id, name: organization.name })
    .from(organization)
    .where(inArray(organization.id, siblingIds))
    .orderBy(asc(organization.name));
}

// Verifies a client-supplied intercompanyOrgId is actually one of the
// caller's owner-group siblings before it's allowed to be written, and that
// the share percent (when a rule is being set) is a sane 0–100 value. Both
// fields travel together: a rule is either fully set or fully cleared.
async function resolveIntercompanyRule(
  orgId: string,
  intercompanyOrgId: string | null | undefined,
  intercompanySharePercent: string | null | undefined,
): Promise<{ intercompanyOrgId: string | null; intercompanySharePercent: string | null }> {
  if (!intercompanyOrgId) return { intercompanyOrgId: null, intercompanySharePercent: null };
  if (intercompanyOrgId === orgId) throw new Error("A category can't bill an intercompany PO to its own organization");
  const siblingIds = await getOwnerOrgIds(orgId);
  if (!siblingIds.includes(intercompanyOrgId)) throw new Error("You can only bill to one of your own organizations");

  const pct = parseFloat(intercompanySharePercent ?? "");
  if (isNaN(pct) || pct <= 0 || pct > 100) throw new Error("Share percent must be between 0 and 100");
  return { intercompanyOrgId, intercompanySharePercent: pct.toFixed(2) };
}

export async function getDocumentCategories(): Promise<DocumentCategoryRow[]> {
  const { orgId } = await requireReadAccess();
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
  intercompanyOrgId?: string | null;
  intercompanySharePercent?: string | null;
}): Promise<DocumentCategoryRow> {
  const { orgId } = await requireWriteAccess();
  const rule = await resolveIntercompanyRule(orgId, input.intercompanyOrgId, input.intercompanySharePercent);

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
      intercompanyOrgId: rule.intercompanyOrgId,
      intercompanySharePercent: rule.intercompanySharePercent,
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
  intercompanyOrgId?: string | null;
  intercompanySharePercent?: string | null;
}): Promise<DocumentCategoryRow> {
  const { orgId } = await requireWriteAccess();

  const [existing] = await db
    .select()
    .from(documentCategory)
    .where(and(eq(documentCategory.id, input.id), eq(documentCategory.organizationId, orgId)));
  if (!existing) throw new Error("Category not found");

  const rule = input.intercompanyOrgId !== undefined || input.intercompanySharePercent !== undefined
    ? await resolveIntercompanyRule(orgId, input.intercompanyOrgId, input.intercompanySharePercent)
    : { intercompanyOrgId: existing.intercompanyOrgId, intercompanySharePercent: existing.intercompanySharePercent };

  const [row] = await db
    .update(documentCategory)
    .set({
      name: input.name?.trim() ?? existing.name,
      color: input.color ?? existing.color,
      isDefault: input.isDefault ?? existing.isDefault,
      intercompanyOrgId: rule.intercompanyOrgId,
      intercompanySharePercent: rule.intercompanySharePercent,
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
