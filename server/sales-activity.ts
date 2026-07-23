"use server";

import { db } from "@/db";
import { salesActivity, user, member } from "@/db/schema";
import { getCachedSession } from "@/lib/auth/cached-session";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { nanoid } from "nanoid";
import { eq, and, desc, asc, gte, lte, ilike, or } from "drizzle-orm";

export type SalesActivityRow = {
  id: string;
  date: string;
  customerOrganization: string;
  customerName: string;
  productCategory: string;
  remark: string | null;
  userId: string;
  userName: string;
  createdAt: Date;
};

export type CreateSalesActivityInput = {
  date: string;
  customerOrganization: string;
  customerName: string;
  productCategory: string;
  remark?: string;
};

export type UpdateSalesActivityInput = CreateSalesActivityInput & { id: string };

export async function getSalesActivities(filters?: {
  from?: string;
  to?: string;
  userId?: string;
  search?: string;
}): Promise<SalesActivityRow[]> {
  const session = await getCachedSession();
  if (!session?.session.activeOrganizationId) throw new Error("No active organization");
  const orgId = session.session.activeOrganizationId;

  const rows = await db
    .select({
      id: salesActivity.id,
      date: salesActivity.date,
      customerOrganization: salesActivity.customerOrganization,
      customerName: salesActivity.customerName,
      productCategory: salesActivity.productCategory,
      remark: salesActivity.remark,
      userId: salesActivity.userId,
      userName: user.name,
      createdAt: salesActivity.createdAt,
    })
    .from(salesActivity)
    .innerJoin(user, eq(salesActivity.userId, user.id))
    .where(
      and(
        eq(salesActivity.organizationId, orgId),
        filters?.from ? gte(salesActivity.date, filters.from) : undefined,
        filters?.to ? lte(salesActivity.date, filters.to) : undefined,
        filters?.userId ? eq(salesActivity.userId, filters.userId) : undefined,
        filters?.search
          ? or(
              ilike(salesActivity.customerOrganization, `%${filters.search}%`),
              ilike(salesActivity.customerName, `%${filters.search}%`),
              ilike(salesActivity.productCategory, `%${filters.search}%`),
            )
          : undefined,
      ),
    )
    .orderBy(desc(salesActivity.date), desc(salesActivity.createdAt));

  return rows;
}

export async function createSalesActivity(input: CreateSalesActivityInput): Promise<string> {
  const session = await getCachedSession();
  if (!session?.session.activeOrganizationId) throw new Error("No active organization");
  const orgId = session.session.activeOrganizationId;
  const userId = session.user.id;

  const id = nanoid();
  await db.insert(salesActivity).values({
    id,
    organizationId: orgId,
    userId,
    date: input.date,
    customerOrganization: input.customerOrganization.trim(),
    customerName: input.customerName.trim(),
    productCategory: input.productCategory.trim(),
    remark: input.remark?.trim() || null,
  });
  return id;
}

export async function updateSalesActivity(input: UpdateSalesActivityInput): Promise<void> {
  const session = await getCachedSession();
  if (!session?.session.activeOrganizationId) throw new Error("No active organization");
  const orgId = session.session.activeOrganizationId;
  const userId = session.user.id;

  // Only owner or admin (*) can update
  const existing = await db
    .select({ userId: salesActivity.userId })
    .from(salesActivity)
    .where(and(eq(salesActivity.id, input.id), eq(salesActivity.organizationId, orgId)))
    .limit(1);

  if (!existing[0]) throw new Error("Activity not found");

  const perms = await getUserPermissions(userId, orgId);
  const isAdmin = perms.includes("*");
  if (existing[0].userId !== userId && !isAdmin) throw new Error("Not authorized");

  await db
    .update(salesActivity)
    .set({
      date: input.date,
      customerOrganization: input.customerOrganization.trim(),
      customerName: input.customerName.trim(),
      productCategory: input.productCategory.trim(),
      remark: input.remark?.trim() || null,
      updatedAt: new Date(),
    })
    .where(eq(salesActivity.id, input.id));
}

export async function deleteSalesActivity(id: string): Promise<void> {
  const session = await getCachedSession();
  if (!session?.session.activeOrganizationId) throw new Error("No active organization");
  const orgId = session.session.activeOrganizationId;
  const userId = session.user.id;

  const existing = await db
    .select({ userId: salesActivity.userId })
    .from(salesActivity)
    .where(and(eq(salesActivity.id, id), eq(salesActivity.organizationId, orgId)))
    .limit(1);

  if (!existing[0]) throw new Error("Activity not found");

  const perms = await getUserPermissions(userId, orgId);
  const isAdmin = perms.includes("*");
  if (existing[0].userId !== userId && !isAdmin) throw new Error("Not authorized");

  await db.delete(salesActivity).where(eq(salesActivity.id, id));
}

export async function getMemberRole(): Promise<"owner" | "stakeholder" | "member"> {
  const session = await getCachedSession();
  if (!session?.session.activeOrganizationId) throw new Error("No active organization");
  const orgId = session.session.activeOrganizationId;
  const userId = session.user.id;

  const row = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.organizationId, orgId)))
    .limit(1);

  return (row[0]?.role ?? "member") as "owner" | "stakeholder" | "member";
}

export async function bulkCreateSalesActivities(inputs: CreateSalesActivityInput[]): Promise<number> {
  const session = await getCachedSession();
  if (!session?.session.activeOrganizationId) throw new Error("No active organization");
  const orgId = session.session.activeOrganizationId;
  const userId = session.user.id;

  if (inputs.length === 0) return 0;

  const values = inputs.map((input) => ({
    id: nanoid(),
    organizationId: orgId,
    userId,
    date: input.date,
    customerOrganization: input.customerOrganization.trim(),
    customerName: input.customerName.trim(),
    productCategory: input.productCategory.trim(),
    remark: input.remark?.trim() || null,
  }));

  await db.insert(salesActivity).values(values);
  return values.length;
}

export async function getOrgMembers(): Promise<{ id: string; name: string }[]> {
  const session = await getCachedSession();
  if (!session?.session.activeOrganizationId) throw new Error("No active organization");
  const orgId = session.session.activeOrganizationId;

  const rows = await db
    .select({ id: user.id, name: user.name })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(eq(member.organizationId, orgId))
    .orderBy(asc(user.name));

  return rows;
}
