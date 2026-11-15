"use server";

import { db } from "@/db";
import {
  commissionType,
  commissionRole,
  commissionRate,
  memberCommissionRate,
  documentCategory,
  invoiceAllowance,
  payItem,
  member,
  user,
} from "@/db/schema";
import { getCachedSession } from "@/lib/auth/cached-session";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";
import { nanoid } from "nanoid";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";

const PATH = "/dashboard/organization/custom-commission";

async function requireAccess(permission: string) {
  const session = await getCachedSession();
  if (!session?.session?.activeOrganizationId) throw new Error("Unauthorized");
  const orgId = session.session.activeOrganizationId;
  const perms = await getUserPermissions(session.user.id, orgId);
  if (!hasAccess(perms, permission)) throw new Error("You don't have permission to do this");
  return { orgId, userId: session.user.id };
}

export type CommissionSource = "sales_person" | "application_specialist";
export type MultiMode = "full_each" | "split" | "primary_only";
export type DayType = "weekday" | "weekend" | "holiday";

const SOURCES: CommissionSource[] = ["sales_person", "application_specialist"];
const MODES: MultiMode[] = ["full_each", "split", "primary_only"];
const DAY_TYPES: DayType[] = ["weekday", "weekend", "holiday"];

export type CommissionRoleRow = {
  id: string;
  typeId: string;
  name: string;
  source: CommissionSource;
  multiMode: MultiMode;
  isActive: boolean;
};
export type CommissionTypeRow = {
  id: string;
  name: string;
  isActive: boolean;
  roles: CommissionRoleRow[];
};

function cleanName(n: string) {
  const v = n.trim();
  if (!v) throw new Error("Name is required");
  if (v.length > 60) throw new Error("Name is too long");
  return v;
}

async function ownType(orgId: string, typeId: string) {
  const [t] = await db
    .select()
    .from(commissionType)
    .where(and(eq(commissionType.id, typeId), eq(commissionType.organizationId, orgId)))
    .limit(1);
  if (!t) throw new Error("Commission type not found");
  return t;
}
async function ownRole(orgId: string, roleId: string) {
  const [r] = await db
    .select()
    .from(commissionRole)
    .where(and(eq(commissionRole.id, roleId), eq(commissionRole.organizationId, orgId)))
    .limit(1);
  if (!r) throw new Error("Role not found");
  return r;
}

/* ── Types & roles ───────────────────────────────────────────────── */

export async function getCommissionTypes(): Promise<CommissionTypeRow[]> {
  const { orgId } = await requireAccess("allowance:manage");
  const [types, roles] = await Promise.all([
    db
      .select()
      .from(commissionType)
      .where(eq(commissionType.organizationId, orgId))
      .orderBy(asc(commissionType.sortOrder), asc(commissionType.name)),
    db
      .select()
      .from(commissionRole)
      .where(eq(commissionRole.organizationId, orgId))
      .orderBy(asc(commissionRole.sortOrder), asc(commissionRole.name)),
  ]);
  return types.map((t) => ({
    id: t.id,
    name: t.name,
    isActive: t.isActive,
    roles: roles
      .filter((r) => r.typeId === t.id)
      .map((r) => ({
        id: r.id,
        typeId: r.typeId,
        name: r.name,
        source: r.source as CommissionSource,
        multiMode: r.multiMode as MultiMode,
        isActive: r.isActive,
      })),
  }));
}

export async function createCommissionType(name: string): Promise<string> {
  const { orgId } = await requireAccess("allowance:manage");
  const clean = cleanName(name);
  const existing = await db
    .select({ name: commissionType.name })
    .from(commissionType)
    .where(eq(commissionType.organizationId, orgId));
  if (existing.some((e) => e.name.toLowerCase() === clean.toLowerCase()))
    throw new Error("A commission type with this name already exists");
  const id = nanoid();
  await db.insert(commissionType).values({
    id,
    organizationId: orgId,
    name: clean,
    sortOrder: existing.length,
  });
  revalidatePath(PATH);
  return id;
}

export async function updateCommissionType(
  id: string,
  data: { name?: string; isActive?: boolean },
): Promise<void> {
  const { orgId } = await requireAccess("allowance:manage");
  const t = await ownType(orgId, id);
  const set: { name?: string; isActive?: boolean } = {};
  if (data.name !== undefined) {
    const clean = cleanName(data.name);
    const others = await db
      .select({ id: commissionType.id, name: commissionType.name })
      .from(commissionType)
      .where(eq(commissionType.organizationId, orgId));
    if (others.some((o) => o.id !== t.id && o.name.toLowerCase() === clean.toLowerCase()))
      throw new Error("A commission type with this name already exists");
    set.name = clean;
  }
  if (data.isActive !== undefined) set.isActive = data.isActive;
  if (Object.keys(set).length) await db.update(commissionType).set(set).where(eq(commissionType.id, id));
  revalidatePath(PATH);
}

// Past earnings keep their rows (type/role links are cleared, labels stay);
// its rates and roles are removed with it.
export async function deleteCommissionType(id: string): Promise<void> {
  const { orgId } = await requireAccess("allowance:manage");
  await ownType(orgId, id);
  const [used] = await db
    .select({ id: payItem.id })
    .from(payItem)
    .where(and(eq(payItem.organizationId, orgId), eq(payItem.commissionTypeId, id)))
    .limit(1);
  if (used) throw new Error("A payslip item uses this commission type. Change or remove that item first.");
  await db.delete(commissionType).where(eq(commissionType.id, id));
  revalidatePath(PATH);
}

export async function createCommissionRole(
  typeId: string,
  data: { name: string; source: CommissionSource; multiMode: MultiMode },
): Promise<void> {
  const { orgId } = await requireAccess("allowance:manage");
  await ownType(orgId, typeId);
  const name = cleanName(data.name);
  if (!SOURCES.includes(data.source)) throw new Error("Invalid source");
  if (!MODES.includes(data.multiMode)) throw new Error("Invalid rule");
  const existing = await db
    .select({ name: commissionRole.name })
    .from(commissionRole)
    .where(eq(commissionRole.typeId, typeId));
  if (existing.some((e) => e.name.toLowerCase() === name.toLowerCase()))
    throw new Error("This type already has a role with that name");
  await db.insert(commissionRole).values({
    id: nanoid(),
    typeId,
    organizationId: orgId,
    name,
    source: data.source,
    multiMode: data.source === "sales_person" ? data.multiMode : "full_each",
    sortOrder: existing.length,
  });
  revalidatePath(PATH);
}

export async function updateCommissionRole(
  id: string,
  data: { name?: string; source?: CommissionSource; multiMode?: MultiMode; isActive?: boolean },
): Promise<void> {
  const { orgId } = await requireAccess("allowance:manage");
  const r = await ownRole(orgId, id);
  const set: Partial<typeof commissionRole.$inferInsert> = {};
  if (data.name !== undefined) {
    const name = cleanName(data.name);
    const siblings = await db
      .select({ id: commissionRole.id, name: commissionRole.name })
      .from(commissionRole)
      .where(eq(commissionRole.typeId, r.typeId));
    if (siblings.some((s) => s.id !== id && s.name.toLowerCase() === name.toLowerCase()))
      throw new Error("This type already has a role with that name");
    set.name = name;
  }
  if (data.source !== undefined) {
    if (!SOURCES.includes(data.source)) throw new Error("Invalid source");
    set.source = data.source;
  }
  if (data.multiMode !== undefined) {
    if (!MODES.includes(data.multiMode)) throw new Error("Invalid rule");
    set.multiMode = data.multiMode;
  }
  if ((set.source ?? r.source) !== "sales_person") set.multiMode = "full_each";
  if (data.isActive !== undefined) set.isActive = data.isActive;
  if (Object.keys(set).length) await db.update(commissionRole).set(set).where(eq(commissionRole.id, id));
  revalidatePath(PATH);
}

export async function deleteCommissionRole(id: string): Promise<void> {
  const { orgId } = await requireAccess("allowance:manage");
  await ownRole(orgId, id);
  await db.delete(commissionRole).where(eq(commissionRole.id, id)); // rates cascade
  revalidatePath(PATH);
}

/* ── Rates ───────────────────────────────────────────────────────── */

export type RateCell = { roleId: string; categoryId: string; dayType: DayType; rate: string };
export type MemberRateCell = RateCell & { userId: string };

export type RateMatrix = {
  categories: { id: string; name: string; color: string | null }[];
  rates: RateCell[];
  memberRates: (MemberRateCell & { userName: string })[];
};

export async function getRateMatrix(typeId: string): Promise<RateMatrix> {
  const { orgId } = await requireAccess("allowance:manage");
  await ownType(orgId, typeId);
  const roles = await db
    .select({ id: commissionRole.id })
    .from(commissionRole)
    .where(eq(commissionRole.typeId, typeId));
  const roleIds = roles.map((r) => r.id);

  const categories = await db
    .select({ id: documentCategory.id, name: documentCategory.name, color: documentCategory.color })
    .from(documentCategory)
    .where(eq(documentCategory.organizationId, orgId))
    .orderBy(asc(documentCategory.position), asc(documentCategory.createdAt));

  if (!roleIds.length) return { categories, rates: [], memberRates: [] };

  const [rates, memberRates] = await Promise.all([
    db
      .select({
        roleId: commissionRate.roleId,
        categoryId: commissionRate.categoryId,
        dayType: commissionRate.dayType,
        rate: commissionRate.rate,
      })
      .from(commissionRate)
      .where(inArray(commissionRate.roleId, roleIds)),
    db
      .select({
        userId: memberCommissionRate.userId,
        userName: user.name,
        roleId: memberCommissionRate.roleId,
        categoryId: memberCommissionRate.categoryId,
        dayType: memberCommissionRate.dayType,
        rate: memberCommissionRate.rate,
      })
      .from(memberCommissionRate)
      .innerJoin(user, eq(user.id, memberCommissionRate.userId))
      .where(inArray(memberCommissionRate.roleId, roleIds)),
  ]);
  return {
    categories,
    rates: rates.map((r) => ({ ...r, dayType: r.dayType as DayType })),
    memberRates: memberRates.map((r) => ({ ...r, dayType: r.dayType as DayType })),
  };
}

function checkCells(cells: { dayType: string; rate: string | null }[]) {
  for (const c of cells) {
    if (!DAY_TYPES.includes(c.dayType as DayType)) throw new Error("Invalid day type");
    if (c.rate !== null && c.rate.trim() !== "" && !(Number(c.rate) >= 0)) throw new Error("Invalid rate");
  }
}
const blank = (r: string | null) => r === null || r.trim() === "";

// Set the default rates for one category; a blank rate removes it (that role
// earns nothing for that day type).
export async function saveCategoryRates(
  typeId: string,
  categoryId: string,
  cells: { roleId: string; dayType: DayType; rate: string | null }[],
): Promise<void> {
  const { orgId } = await requireAccess("allowance:manage");
  await ownType(orgId, typeId);
  const [cat] = await db
    .select({ id: documentCategory.id })
    .from(documentCategory)
    .where(and(eq(documentCategory.id, categoryId), eq(documentCategory.organizationId, orgId)));
  if (!cat) throw new Error("Category not found");
  checkCells(cells);
  const roles = await db
    .select({ id: commissionRole.id })
    .from(commissionRole)
    .where(eq(commissionRole.typeId, typeId));
  const valid = new Set(roles.map((r) => r.id));

  for (const c of cells) {
    if (!valid.has(c.roleId)) throw new Error("Role not in this type");
    if (blank(c.rate)) {
      await db
        .delete(commissionRate)
        .where(
          and(
            eq(commissionRate.roleId, c.roleId),
            eq(commissionRate.categoryId, categoryId),
            eq(commissionRate.dayType, c.dayType),
          ),
        );
    } else {
      await db
        .insert(commissionRate)
        .values({
          id: nanoid(),
          organizationId: orgId,
          roleId: c.roleId,
          categoryId,
          dayType: c.dayType,
          rate: String(Number(c.rate)),
        })
        .onConflictDoUpdate({
          target: [commissionRate.roleId, commissionRate.categoryId, commissionRate.dayType],
          set: { rate: String(Number(c.rate)) },
        });
    }
  }
  revalidatePath(PATH);
}

export type OrgMemberOption = { userId: string; name: string };

export async function getOrgMemberOptions(): Promise<OrgMemberOption[]> {
  const { orgId } = await requireAccess("allowance:manage");
  return db
    .select({ userId: member.userId, name: user.name })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(and(eq(member.organizationId, orgId), isNull(member.deletedAt)))
    .orderBy(user.name);
}

// A person's own rates for one category within a type (replacing the default).
// A blank rate removes that override so the default applies again.
export async function saveMemberRates(
  typeId: string,
  userId: string,
  categoryId: string,
  cells: { roleId: string; dayType: DayType; rate: string | null }[],
): Promise<void> {
  const { orgId } = await requireAccess("allowance:manage");
  await ownType(orgId, typeId);
  const [cat] = await db
    .select({ id: documentCategory.id })
    .from(documentCategory)
    .where(and(eq(documentCategory.id, categoryId), eq(documentCategory.organizationId, orgId)));
  if (!cat) throw new Error("Category not found");
  const [m] = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.organizationId, orgId)));
  if (!m) throw new Error("That person isn't a member of this organization");
  checkCells(cells);
  const roles = await db
    .select({ id: commissionRole.id })
    .from(commissionRole)
    .where(eq(commissionRole.typeId, typeId));
  const valid = new Set(roles.map((r) => r.id));

  for (const c of cells) {
    if (!valid.has(c.roleId)) throw new Error("Role not in this type");
    if (blank(c.rate)) {
      await db
        .delete(memberCommissionRate)
        .where(
          and(
            eq(memberCommissionRate.userId, userId),
            eq(memberCommissionRate.roleId, c.roleId),
            eq(memberCommissionRate.categoryId, categoryId),
            eq(memberCommissionRate.dayType, c.dayType),
          ),
        );
    } else {
      await db
        .insert(memberCommissionRate)
        .values({
          id: nanoid(),
          organizationId: orgId,
          userId,
          roleId: c.roleId,
          categoryId,
          dayType: c.dayType,
          rate: String(Number(c.rate)),
        })
        .onConflictDoUpdate({
          target: [
            memberCommissionRate.userId,
            memberCommissionRate.roleId,
            memberCommissionRate.categoryId,
            memberCommissionRate.dayType,
          ],
          set: { rate: String(Number(c.rate)) },
        });
    }
  }
  revalidatePath(PATH);
}

export async function deleteMemberRates(typeId: string, userId: string, categoryId: string): Promise<void> {
  const { orgId } = await requireAccess("allowance:manage");
  await ownType(orgId, typeId);
  const roles = await db
    .select({ id: commissionRole.id })
    .from(commissionRole)
    .where(eq(commissionRole.typeId, typeId));
  if (roles.length)
    await db
      .delete(memberCommissionRate)
      .where(
        and(
          eq(memberCommissionRate.userId, userId),
          eq(memberCommissionRate.categoryId, categoryId),
          inArray(memberCommissionRate.roleId, roles.map((r) => r.id)),
        ),
      );
  revalidatePath(PATH);
}

// How many earnings a type has produced (shown before deleting)
export async function getCommissionUsage(typeId: string): Promise<number> {
  const { orgId } = await requireAccess("allowance:manage");
  await ownType(orgId, typeId);
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(invoiceAllowance)
    .where(eq(invoiceAllowance.commissionTypeId, typeId));
  return Number(row?.n ?? 0);
}
