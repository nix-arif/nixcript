"use server";

import { db } from "@/db";
import { categoryAllowanceRate, memberAllowanceRate, documentCategory, organizationProfile, publicHoliday, member, user } from "@/db/schema";
import { getCachedSession } from "@/lib/auth/cached-session";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";
import { nanoid } from "nanoid";
import { eq, and, asc, desc, isNull } from "drizzle-orm";
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

export type MemberAllowanceRateRow = {
  id: string;
  userId: string;
  userName: string;
  categoryId: string;
  categoryName: string;
  salesPersonWeekdayRate: string | null;
  salesPersonWeekendRate: string | null;
  salesPersonHolidayRate: string | null;
  appSpecialistWeekdayRate: string | null;
  appSpecialistWeekendRate: string | null;
  appSpecialistHolidayRate: string | null;
  isActive: boolean;
};

// Every special (member-specific) rate configured for this org, newest first.
export async function getMemberAllowanceRates(): Promise<MemberAllowanceRateRow[]> {
  const { orgId } = await requireAccess("allowance:manage");
  const rows = await db
    .select({
      id: memberAllowanceRate.id,
      userId: memberAllowanceRate.userId,
      userName: user.name,
      categoryId: memberAllowanceRate.categoryId,
      categoryName: documentCategory.name,
      salesPersonWeekdayRate: memberAllowanceRate.salesPersonWeekdayRate,
      salesPersonWeekendRate: memberAllowanceRate.salesPersonWeekendRate,
      salesPersonHolidayRate: memberAllowanceRate.salesPersonHolidayRate,
      appSpecialistWeekdayRate: memberAllowanceRate.appSpecialistWeekdayRate,
      appSpecialistWeekendRate: memberAllowanceRate.appSpecialistWeekendRate,
      appSpecialistHolidayRate: memberAllowanceRate.appSpecialistHolidayRate,
      isActive: memberAllowanceRate.isActive,
    })
    .from(memberAllowanceRate)
    .innerJoin(user, eq(user.id, memberAllowanceRate.userId))
    .innerJoin(documentCategory, eq(documentCategory.id, memberAllowanceRate.categoryId))
    .where(eq(memberAllowanceRate.organizationId, orgId))
    .orderBy(desc(memberAllowanceRate.createdAt));
  return rows;
}

// Members of this org, for the "which person gets a special rate" picker.
export type OrgMemberOption = { userId: string; name: string };

export async function getOrgMemberOptions(): Promise<OrgMemberOption[]> {
  const { orgId } = await requireAccess("allowance:manage");
  const rows = await db
    .select({ userId: member.userId, name: user.name })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(and(eq(member.organizationId, orgId), isNull(member.deletedAt)))
    .orderBy(user.name);
  return rows;
}

export async function upsertMemberAllowanceRate(input: {
  userId: string;
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
  const [memberRow] = await db.select().from(member).where(and(eq(member.userId, input.userId), eq(member.organizationId, orgId)));
  if (!memberRow) throw new Error("That person isn't a member of this organization");

  await db
    .insert(memberAllowanceRate)
    .values({
      id: nanoid(),
      organizationId: orgId,
      userId: input.userId,
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
      target: [memberAllowanceRate.organizationId, memberAllowanceRate.userId, memberAllowanceRate.categoryId],
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

export async function deleteMemberAllowanceRate(id: string): Promise<void> {
  const { orgId } = await requireAccess("allowance:manage");
  await db.delete(memberAllowanceRate).where(and(eq(memberAllowanceRate.id, id), eq(memberAllowanceRate.organizationId, orgId)));
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
