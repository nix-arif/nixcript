"use server";

import { db } from "@/db";
import { categoryAllowanceRate, documentCategory, organizationProfile, publicHoliday } from "@/db/schema";
import { getCachedSession } from "@/lib/auth/cached-session";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";
import { nanoid } from "nanoid";
import { eq, and, asc, desc } from "drizzle-orm";
import { revalidatePath } from "next/cache";

async function requireAccess(permission: string) {
  const session = await getCachedSession();
  if (!session?.session?.activeOrganizationId) throw new Error("Unauthorized");
  const orgId = session.session.activeOrganizationId;
  const perms = await getUserPermissions(session.user.id, orgId);
  if (!hasAccess(perms, permission)) throw new Error("You don't have permission to do this");
  return { orgId, userId: session.user.id };
}

export type CategoryAllowanceRateRow = {
  categoryId: string;
  categoryName: string;
  categoryColor: string | null;
  rateId: string | null;
  salesPersonWeekdayRate: string | null;
  salesPersonWeekendRate: string | null;
  salesPersonHolidayRate: string | null;
  appSpecialistWeekdayRate: string | null;
  appSpecialistWeekendRate: string | null;
  appSpecialistHolidayRate: string | null;
  isActive: boolean;
};

// One row per existing document category, with its rate (if any set yet).
export async function getCategoryAllowanceRates(): Promise<CategoryAllowanceRateRow[]> {
  const { orgId } = await requireAccess("allowance:manage");

  const [categories, rates] = await Promise.all([
    db.select().from(documentCategory).where(eq(documentCategory.organizationId, orgId)).orderBy(asc(documentCategory.position), asc(documentCategory.createdAt)),
    db.select().from(categoryAllowanceRate).where(eq(categoryAllowanceRate.organizationId, orgId)),
  ]);
  const rateByCategoryId = new Map(rates.map((r) => [r.categoryId, r]));

  return categories.map((c) => {
    const r = rateByCategoryId.get(c.id);
    return {
      categoryId: c.id,
      categoryName: c.name,
      categoryColor: c.color,
      rateId: r?.id ?? null,
      salesPersonWeekdayRate: r?.salesPersonWeekdayRate ?? null,
      salesPersonWeekendRate: r?.salesPersonWeekendRate ?? null,
      salesPersonHolidayRate: r?.salesPersonHolidayRate ?? null,
      appSpecialistWeekdayRate: r?.appSpecialistWeekdayRate ?? null,
      appSpecialistWeekendRate: r?.appSpecialistWeekendRate ?? null,
      appSpecialistHolidayRate: r?.appSpecialistHolidayRate ?? null,
      isActive: r?.isActive ?? true,
    };
  });
}

export async function upsertCategoryAllowanceRate(input: {
  categoryId: string;
  salesPersonWeekdayRate?: string | null;
  salesPersonWeekendRate?: string | null;
  salesPersonHolidayRate?: string | null;
  appSpecialistWeekdayRate?: string | null;
  appSpecialistWeekendRate?: string | null;
  appSpecialistHolidayRate?: string | null;
  isActive?: boolean;
}): Promise<void> {
  const { orgId } = await requireAccess("allowance:manage");

  const [category] = await db.select().from(documentCategory).where(and(eq(documentCategory.id, input.categoryId), eq(documentCategory.organizationId, orgId)));
  if (!category) throw new Error("Category not found");

  await db
    .insert(categoryAllowanceRate)
    .values({
      id: nanoid(),
      organizationId: orgId,
      categoryId: input.categoryId,
      salesPersonWeekdayRate: input.salesPersonWeekdayRate ?? null,
      salesPersonWeekendRate: input.salesPersonWeekendRate ?? null,
      salesPersonHolidayRate: input.salesPersonHolidayRate ?? null,
      appSpecialistWeekdayRate: input.appSpecialistWeekdayRate ?? null,
      appSpecialistWeekendRate: input.appSpecialistWeekendRate ?? null,
      appSpecialistHolidayRate: input.appSpecialistHolidayRate ?? null,
      isActive: input.isActive ?? true,
    })
    .onConflictDoUpdate({
      target: [categoryAllowanceRate.organizationId, categoryAllowanceRate.categoryId],
      set: {
        salesPersonWeekdayRate: input.salesPersonWeekdayRate ?? null,
        salesPersonWeekendRate: input.salesPersonWeekendRate ?? null,
        salesPersonHolidayRate: input.salesPersonHolidayRate ?? null,
        appSpecialistWeekdayRate: input.appSpecialistWeekdayRate ?? null,
        appSpecialistWeekendRate: input.appSpecialistWeekendRate ?? null,
        appSpecialistHolidayRate: input.appSpecialistHolidayRate ?? null,
        isActive: input.isActive ?? true,
        updatedAt: new Date(),
      },
    });

  revalidatePath("/dashboard/human-resources/allowance/rates");
}

export type PublicHolidayRow = typeof publicHoliday.$inferSelect;

export async function getPublicHolidays(): Promise<PublicHolidayRow[]> {
  const { orgId } = await requireAccess("allowance:manage");
  return db.select().from(publicHoliday).where(eq(publicHoliday.organizationId, orgId)).orderBy(desc(publicHoliday.date));
}

export async function createPublicHoliday(input: { date: string; name: string }): Promise<PublicHolidayRow> {
  const { orgId } = await requireAccess("allowance:manage");
  const [row] = await db
    .insert(publicHoliday)
    .values({ id: nanoid(), organizationId: orgId, date: input.date, name: input.name.trim() })
    .onConflictDoUpdate({
      target: [publicHoliday.organizationId, publicHoliday.date],
      set: { name: input.name.trim() },
    })
    .returning();
  revalidatePath("/dashboard/human-resources/allowance/rates");
  return row;
}

export async function deletePublicHoliday(id: string): Promise<void> {
  const { orgId } = await requireAccess("allowance:manage");
  await db.delete(publicHoliday).where(and(eq(publicHoliday.id, id), eq(publicHoliday.organizationId, orgId)));
  revalidatePath("/dashboard/human-resources/allowance/rates");
}

export type MultiSalesPersonMode = "full_each" | "split" | "primary_only";

export async function getAllowanceSettings(): Promise<{ multiSalesPersonMode: MultiSalesPersonMode }> {
  const { orgId } = await requireAccess("allowance:manage");
  const [profile] = await db.select({ mode: organizationProfile.allowanceMultiSalesPersonMode }).from(organizationProfile).where(eq(organizationProfile.organizationId, orgId));
  return { multiSalesPersonMode: (profile?.mode as MultiSalesPersonMode) ?? "full_each" };
}

export async function updateAllowanceSettings(input: { multiSalesPersonMode: MultiSalesPersonMode }): Promise<void> {
  const { orgId } = await requireAccess("allowance:manage");
  await db
    .insert(organizationProfile)
    .values({ id: nanoid(), organizationId: orgId, allowanceMultiSalesPersonMode: input.multiSalesPersonMode })
    .onConflictDoUpdate({
      target: organizationProfile.organizationId,
      set: { allowanceMultiSalesPersonMode: input.multiSalesPersonMode, updatedAt: new Date() },
    });
  revalidatePath("/dashboard/human-resources/allowance/rates");
}
