"use server";

import { db } from "@/db";
import { publicHoliday } from "@/db/schema";
import { getCachedSession } from "@/lib/auth/cached-session";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";
import { nanoid } from "nanoid";
import { eq, and, asc, inArray } from "drizzle-orm";
import { siblingOrgs } from "@/lib/org/sibling-orgs";
import { revalidatePath } from "next/cache";

// The company's public holiday calendar. Each action has its own permission
// (read / create / update / delete) — see lib/permissions/constants.ts.

export type PublicHolidayRow = typeof publicHoliday.$inferSelect;

const PAGE = "/dashboard/organization/org-calendar";

async function requireAccess(permission: string) {
  const session = await getCachedSession();
  if (!session?.session?.activeOrganizationId) throw new Error("Unauthorized");
  const orgId = session.session.activeOrganizationId;
  const perms = await getUserPermissions(session.user.id, orgId);
  if (!hasAccess(perms, permission)) throw new Error("You don't have permission to do this");
  return { orgId, userId: session.user.id };
}

// For the page: which other organizations a change can be applied to
export async function getCalendarSiblingOrgs(): Promise<{ id: string; name: string }[]> {
  const { orgId, userId } = await requireAccess("public-holiday:read");
  return siblingOrgs(orgId, userId, "public-holiday:create");
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

export type ApplyResult = { applied: number; skipped: number };

export async function createPublicHoliday(
  input: { date: string; name: string },
  applyToAll = false,
): Promise<{ row: PublicHolidayRow } & ApplyResult> {
  const { orgId, userId } = await requireAccess("public-holiday:create");
  const v = clean(input);
  const [dup] = await db.select({ id: publicHoliday.id, name: publicHoliday.name }).from(publicHoliday)
    .where(and(eq(publicHoliday.organizationId, orgId), eq(publicHoliday.date, v.date))).limit(1);
  if (dup) throw new Error(`${v.date} is already listed as "${dup.name}" — edit that one instead`);
  const [row] = await db.insert(publicHoliday).values({ id: nanoid(), organizationId: orgId, ...v }).returning();

  let applied = 0;
  let skipped = 0;
  if (applyToAll) {
    for (const o of await siblingOrgs(orgId, userId, "public-holiday:create")) {
      const [exists] = await db.select({ id: publicHoliday.id }).from(publicHoliday)
        .where(and(eq(publicHoliday.organizationId, o.id), eq(publicHoliday.date, v.date))).limit(1);
      if (exists) { skipped++; continue; }
      await db.insert(publicHoliday).values({ id: nanoid(), organizationId: o.id, ...v });
      applied++;
    }
  }
  revalidatePath(PAGE);
  return { row, applied, skipped };
}

export async function updatePublicHoliday(
  id: string,
  input: { date: string; name: string },
  applyToAll = false,
): Promise<{ row: PublicHolidayRow } & ApplyResult> {
  const { orgId, userId } = await requireAccess("public-holiday:update");
  const v = clean(input);
  const [before] = await db.select({ date: publicHoliday.date }).from(publicHoliday)
    .where(and(eq(publicHoliday.id, id), eq(publicHoliday.organizationId, orgId))).limit(1);
  const [dup] = await db.select({ id: publicHoliday.id, name: publicHoliday.name }).from(publicHoliday)
    .where(and(eq(publicHoliday.organizationId, orgId), eq(publicHoliday.date, v.date))).limit(1);
  if (dup && dup.id !== id) throw new Error(`${v.date} is already listed as "${dup.name}"`);
  const [row] = await db.update(publicHoliday).set(v)
    .where(and(eq(publicHoliday.id, id), eq(publicHoliday.organizationId, orgId))).returning();
  if (!row) throw new Error("Holiday not found");

  let applied = 0;
  let skipped = 0;
  if (applyToAll && before) {
    for (const o of await siblingOrgs(orgId, userId, "public-holiday:update")) {
      const [target] = await db.select({ id: publicHoliday.id }).from(publicHoliday)
        .where(and(eq(publicHoliday.organizationId, o.id), eq(publicHoliday.date, before.date))).limit(1);
      if (!target) { skipped++; continue; }
      const [clash] = await db.select({ id: publicHoliday.id }).from(publicHoliday)
        .where(and(eq(publicHoliday.organizationId, o.id), eq(publicHoliday.date, v.date))).limit(1);
      if (clash && clash.id !== target.id) { skipped++; continue; }
      await db.update(publicHoliday).set(v).where(eq(publicHoliday.id, target.id));
      applied++;
    }
  }
  revalidatePath(PAGE);
  return { row, applied, skipped };
}

export async function deletePublicHoliday(id: string, applyToAll = false): Promise<ApplyResult> {
  const { orgId, userId } = await requireAccess("public-holiday:delete");
  const [before] = await db.select({ date: publicHoliday.date }).from(publicHoliday)
    .where(and(eq(publicHoliday.id, id), eq(publicHoliday.organizationId, orgId))).limit(1);
  await db.delete(publicHoliday).where(and(eq(publicHoliday.id, id), eq(publicHoliday.organizationId, orgId)));

  let applied = 0;
  if (applyToAll && before) {
    const orgs = await siblingOrgs(orgId, userId, "public-holiday:delete");
    if (orgs.length) {
      const gone = await db.delete(publicHoliday)
        .where(and(inArray(publicHoliday.organizationId, orgs.map((o) => o.id)), eq(publicHoliday.date, before.date)))
        .returning({ id: publicHoliday.id });
      applied = gone.length;
    }
  }
  revalidatePath(PAGE);
  return { applied, skipped: 0 };
}

// Copy this calendar to the other organizations: adds the dates they are
// missing; never changes or removes what they already have.
export async function copyCalendarToSiblings(): Promise<{ added: number; orgs: number }> {
  const { orgId, userId } = await requireAccess("public-holiday:create");
  const mine = await db.select().from(publicHoliday).where(eq(publicHoliday.organizationId, orgId));
  const orgs = await siblingOrgs(orgId, userId, "public-holiday:create");
  let added = 0;
  for (const o of orgs) {
    const have = new Set(
      (await db.select({ date: publicHoliday.date }).from(publicHoliday).where(eq(publicHoliday.organizationId, o.id))).map((r) => r.date),
    );
    const missing = mine.filter((h) => !have.has(h.date));
    if (missing.length) {
      await db.insert(publicHoliday).values(missing.map((h) => ({ id: nanoid(), organizationId: o.id, date: h.date, name: h.name })));
      added += missing.length;
    }
  }
  revalidatePath(PAGE);
  return { added, orgs: orgs.length };
}
