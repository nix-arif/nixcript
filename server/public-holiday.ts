"use server";

import { db } from "@/db";
import { publicHoliday } from "@/db/schema";
import { getCachedSession } from "@/lib/auth/cached-session";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";
import { nanoid } from "nanoid";
import { eq, and, asc } from "drizzle-orm";
import { revalidatePath } from "next/cache";

// The company's public holiday calendar. Each action has its own permission
// (read / create / update / delete) — see lib/permissions/constants.ts.

export type PublicHolidayRow = typeof publicHoliday.$inferSelect;

const PAGE = "/dashboard/human-resources/public-holidays";

async function requireAccess(permission: string) {
  const session = await getCachedSession();
  if (!session?.session?.activeOrganizationId) throw new Error("Unauthorized");
  const orgId = session.session.activeOrganizationId;
  const perms = await getUserPermissions(session.user.id, orgId);
  if (!hasAccess(perms, permission)) throw new Error("You don't have permission to do this");
  return { orgId };
}

function clean(input: { date: string; name: string }) {
  const name = input.name?.trim();
  if (!name) throw new Error("Give the holiday a name");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || Number.isNaN(new Date(`${input.date}T00:00:00`).getTime())) {
    throw new Error("Choose a valid date");
  }
  return { date: input.date, name };
}

export async function getPublicHolidays(): Promise<PublicHolidayRow[]> {
  const { orgId } = await requireAccess("public-holiday:read");
  return db.select().from(publicHoliday).where(eq(publicHoliday.organizationId, orgId)).orderBy(asc(publicHoliday.date));
}

export async function createPublicHoliday(input: { date: string; name: string }): Promise<PublicHolidayRow> {
  const { orgId } = await requireAccess("public-holiday:create");
  const v = clean(input);
  const [dup] = await db.select({ id: publicHoliday.id, name: publicHoliday.name }).from(publicHoliday)
    .where(and(eq(publicHoliday.organizationId, orgId), eq(publicHoliday.date, v.date))).limit(1);
  if (dup) throw new Error(`${v.date} is already listed as "${dup.name}" — edit that one instead`);
  const [row] = await db.insert(publicHoliday).values({ id: nanoid(), organizationId: orgId, ...v }).returning();
  revalidatePath(PAGE);
  return row;
}

export async function updatePublicHoliday(id: string, input: { date: string; name: string }): Promise<PublicHolidayRow> {
  const { orgId } = await requireAccess("public-holiday:update");
  const v = clean(input);
  const [dup] = await db.select({ id: publicHoliday.id, name: publicHoliday.name }).from(publicHoliday)
    .where(and(eq(publicHoliday.organizationId, orgId), eq(publicHoliday.date, v.date))).limit(1);
  if (dup && dup.id !== id) throw new Error(`${v.date} is already listed as "${dup.name}"`);
  const [row] = await db.update(publicHoliday).set(v)
    .where(and(eq(publicHoliday.id, id), eq(publicHoliday.organizationId, orgId))).returning();
  if (!row) throw new Error("Holiday not found");
  revalidatePath(PAGE);
  return row;
}

export async function deletePublicHoliday(id: string): Promise<void> {
  const { orgId } = await requireAccess("public-holiday:delete");
  await db.delete(publicHoliday).where(and(eq(publicHoliday.id, id), eq(publicHoliday.organizationId, orgId)));
  revalidatePath(PAGE);
}
