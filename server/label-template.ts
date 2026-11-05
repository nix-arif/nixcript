"use server";

import { db } from "@/db";
import { labelTemplate } from "@/db/schema";
import { and, asc, desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getCachedSession } from "@/lib/auth/cached-session";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";
import type { LabelDesign } from "@/lib/label-design";

async function requireAccess(permission: string) {
  const session = await getCachedSession();
  if (!session) throw new Error("You must be signed in to continue");
  const orgId = session.session.activeOrganizationId;
  if (!orgId) throw new Error("No active organization");
  const perms = await getUserPermissions(session.user.id, orgId);
  if (!hasAccess(perms, permission)) throw new Error("You don't have permission to do this");
  return { orgId, userId: session.user.id };
}

export type LabelTemplateRow = { id: string; name: string; isDefault: boolean; design: LabelDesign };

const MAX_DESIGN_BYTES = 1_500_000; // uploaded logos are embedded as data URLs
const MAX_NAME_LENGTH = 60;

const toRow = (r: typeof labelTemplate.$inferSelect): LabelTemplateRow => ({
  id: r.id,
  name: r.name,
  isDefault: r.isDefault,
  design: r.design as LabelDesign,
});

function cleanName(name: string | undefined): string {
  const n = (name ?? "").trim();
  if (!n) throw new Error("Give the template a name");
  if (n.length > MAX_NAME_LENGTH) throw new Error(`Template name is too long (max ${MAX_NAME_LENGTH} characters)`);
  return n;
}

function checkSize(design: LabelDesign) {
  if (JSON.stringify(design).length > MAX_DESIGN_BYTES) {
    throw new Error("The label design is too large — use a smaller logo image");
  }
}

// Default template first, then alphabetical.
export async function listLabelTemplates(): Promise<LabelTemplateRow[]> {
  const { orgId } = await requireAccess("label:read");
  const rows = await db
    .select()
    .from(labelTemplate)
    .where(eq(labelTemplate.organizationId, orgId))
    .orderBy(desc(labelTemplate.isDefault), asc(labelTemplate.name));
  return rows.map(toRow);
}

// Saves a design. With an `id` it updates that template (label:update) and can
// optionally rename it; without one it creates a new named template
// (label:create). The first template an organisation ever saves becomes its default.
export async function saveLabelTemplate(input: { id?: string; name?: string; design: LabelDesign }): Promise<LabelTemplateRow> {
  checkSize(input.design);

  if (input.id) {
    const { orgId, userId } = await requireAccess("label:update");
    const [existing] = await db
      .select()
      .from(labelTemplate)
      .where(and(eq(labelTemplate.id, input.id), eq(labelTemplate.organizationId, orgId)));
    if (!existing) throw new Error("Template not found");
    const name = input.name !== undefined ? cleanName(input.name) : existing.name;
    try {
      const [row] = await db
        .update(labelTemplate)
        .set({ design: input.design, name, updatedBy: userId })
        .where(eq(labelTemplate.id, existing.id))
        .returning();
      return toRow(row);
    } catch {
      throw new Error(`A template named “${name}” already exists`);
    }
  }

  const { orgId, userId } = await requireAccess("label:create");
  const name = cleanName(input.name);
  const [anyExisting] = await db.select({ id: labelTemplate.id }).from(labelTemplate).where(eq(labelTemplate.organizationId, orgId)).limit(1);
  try {
    const [row] = await db
      .insert(labelTemplate)
      .values({
        id: nanoid(),
        organizationId: orgId,
        name,
        isDefault: !anyExisting,
        design: input.design,
        createdBy: userId,
        updatedBy: userId,
      })
      .returning();
    return toRow(row);
  } catch {
    throw new Error(`A template named “${name}” already exists`);
  }
}

// The template the labels page opens with. Needs label:update since it changes
// what everyone in the organisation sees first.
export async function setDefaultLabelTemplate(id: string): Promise<void> {
  const { orgId, userId } = await requireAccess("label:update");
  const [target] = await db
    .select({ id: labelTemplate.id })
    .from(labelTemplate)
    .where(and(eq(labelTemplate.id, id), eq(labelTemplate.organizationId, orgId)));
  if (!target) throw new Error("Template not found");
  await db.transaction(async (tx) => {
    await tx.update(labelTemplate).set({ isDefault: false }).where(eq(labelTemplate.organizationId, orgId));
    await tx.update(labelTemplate).set({ isDefault: true, updatedBy: userId }).where(eq(labelTemplate.id, id));
  });
}

// Deleting the default hands the role to the oldest remaining template.
export async function deleteLabelTemplate(id: string): Promise<void> {
  const { orgId } = await requireAccess("label:delete");
  const [target] = await db
    .select()
    .from(labelTemplate)
    .where(and(eq(labelTemplate.id, id), eq(labelTemplate.organizationId, orgId)));
  if (!target) throw new Error("Template not found");
  await db.transaction(async (tx) => {
    await tx.delete(labelTemplate).where(eq(labelTemplate.id, id));
    if (target.isDefault) {
      const [next] = await tx
        .select({ id: labelTemplate.id })
        .from(labelTemplate)
        .where(eq(labelTemplate.organizationId, orgId))
        .orderBy(asc(labelTemplate.createdAt))
        .limit(1);
      if (next) await tx.update(labelTemplate).set({ isDefault: true }).where(eq(labelTemplate.id, next.id));
    }
  });
}
