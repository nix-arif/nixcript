"use server";

import { db } from "@/db";
import { labelTemplate } from "@/db/schema";
import { eq } from "drizzle-orm";
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

export async function getLabelTemplate(): Promise<LabelDesign | null> {
  const { orgId } = await requireAccess("purchase-order:read");
  const [row] = await db.select().from(labelTemplate).where(eq(labelTemplate.organizationId, orgId)).limit(1);
  return (row?.design as LabelDesign | undefined) ?? null;
}

const MAX_DESIGN_BYTES = 1_500_000; // uploaded logos are embedded as data URLs

export async function saveLabelTemplate(design: LabelDesign): Promise<void> {
  const { orgId, userId } = await requireAccess("purchase-order:update");
  if (JSON.stringify(design).length > MAX_DESIGN_BYTES) {
    throw new Error("The label design is too large — use a smaller logo image");
  }
  await db
    .insert(labelTemplate)
    .values({ id: nanoid(), organizationId: orgId, design, updatedBy: userId })
    .onConflictDoUpdate({ target: labelTemplate.organizationId, set: { design, updatedBy: userId } });
}
