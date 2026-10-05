"use server";

// Item groups — user-defined sections for the stock lists (Stock Overview,
// Field Stock). The users decide which groups exist, their order and colour,
// and which products belong to each; nothing is predefined. A product can be in
// several groups. Groups are shared across the owner's companies, like the
// product catalogue.

import { db } from "@/db";
import { itemGroup, itemGroupProduct, product, stockLevel } from "@/db/schema";
import { getCachedSession } from "@/lib/auth/cached-session";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";
import { getOrgGroupIds } from "@/lib/document-number-group";
import { and, asc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { groupIdsByProduct } from "@/lib/inventory/item-groups";
import { nanoid } from "nanoid";
import { revalidatePath } from "next/cache";

type Result<T = object> = ({ ok: true } & T) | { ok: false; title: string };

async function ctx(perm: string) {
  const session = await getCachedSession();
  const orgId = session?.session?.activeOrganizationId;
  if (!session || !orgId) throw new Error("Unauthorized");
  const perms = await getUserPermissions(session.user.id, orgId);
  if (!hasAccess(perms, perm)) throw new Error("You don't have permission to do this");
  return { orgId, groupIds: await getOrgGroupIds(orgId), canManage: hasAccess(perms, "inventory:manage") };
}

const guard = async <T,>(fn: () => Promise<Result<T>>): Promise<Result<T>> => {
  try { return await fn(); } catch (e) { return { ok: false, title: e instanceof Error ? e.message : "Something went wrong" }; }
};

function revalidate() {
  revalidatePath("/dashboard/inventory");
  revalidatePath("/dashboard/inventory/item-groups");
  revalidatePath("/dashboard/inventory/field-stock");
}

export type ItemGroupRow = { id: string; name: string; color: string | null; sortOrder: number };

/** The groups, in the users' order (for the stock lists). */
export async function getItemGroups(): Promise<ItemGroupRow[]> {
  const { groupIds } = await ctx("inventory:read");
  return db.select({ id: itemGroup.id, name: itemGroup.name, color: itemGroup.color, sortOrder: itemGroup.sortOrder })
    .from(itemGroup).where(inArray(itemGroup.organizationId, groupIds))
    .orderBy(asc(itemGroup.sortOrder), asc(itemGroup.name));
}

/** Management page: groups with their products, and every stocked product with its groups. */
export async function getItemGroupPage() {
  const { groupIds, canManage } = await ctx("inventory:read");
  const groups = await getItemGroups();
  const gids = groups.map((g) => g.id);
  const [members, stockedRows] = await Promise.all([
    gids.length
      ? db.select({ id: product.id, productCode: product.productCode, description: product.description, groupId: itemGroupProduct.groupId })
          .from(itemGroupProduct).innerJoin(product, eq(product.id, itemGroupProduct.productId))
          .where(inArray(itemGroupProduct.groupId, gids)).orderBy(asc(product.productCode))
      : Promise.resolve([]),
    // Every product the companies actually hold (anywhere), with all its groups
    db.selectDistinct({ id: product.id, productCode: product.productCode, description: product.description })
      .from(product).innerJoin(stockLevel, eq(stockLevel.productId, product.id))
      .where(and(inArray(product.organizationId, groupIds), sql`${stockLevel.quantity}::numeric <> 0`))
      .orderBy(asc(product.productCode)),
  ]);
  const memberOf = await groupIdsByProduct(stockedRows.map((r) => r.id));
  return {
    canManage,
    groups: groups.map((g) => ({ ...g, products: members.filter((m) => m.groupId === g.id).map(({ id, productCode, description }) => ({ id, productCode, description })) })),
    // stocked products, each with every group it's in (a product can be in several)
    stocked: stockedRows.map((r) => ({ ...r, groupIds: (memberOf.get(r.id) ?? []).filter((id) => groups.some((g) => g.id === id)) })),
  };
}

export async function saveItemGroup(input: { id?: string; name: string; color?: string | null }): Promise<Result<{ id: string }>> {
  return guard<{ id: string }>(async () => {
    const { orgId, groupIds, canManage } = await ctx("inventory:read");
    if (!canManage) return { ok: false, title: "You don't have permission to manage item groups" };
    const name = input.name.trim();
    if (!name) return { ok: false, title: "Give the group a name, e.g. \"Laser fibres\"" };
    const existing = await db.select({ id: itemGroup.id, name: itemGroup.name, sortOrder: itemGroup.sortOrder }).from(itemGroup).where(inArray(itemGroup.organizationId, groupIds));
    if (existing.some((g) => g.id !== input.id && g.name.toLowerCase() === name.toLowerCase())) return { ok: false, title: `There is already a group called "${name}"` };
    const color = input.color && /^#[0-9a-f]{6}$/i.test(input.color) ? input.color : null;
    if (input.id) {
      if (!existing.some((g) => g.id === input.id)) return { ok: false, title: "Group not found" };
      await db.update(itemGroup).set({ name, color }).where(eq(itemGroup.id, input.id));
      revalidate();
      return { ok: true, id: input.id };
    }
    const id = nanoid();
    await db.insert(itemGroup).values({ id, organizationId: orgId, name, color, sortOrder: Math.max(0, ...existing.map((g) => g.sortOrder)) + 1 });
    revalidate();
    return { ok: true, id };
  });
}

/** Delete a group — its products stay in their other groups, or go to "Other". */
export async function deleteItemGroup(id: string): Promise<Result> {
  return guard(async () => {
    const { groupIds, canManage } = await ctx("inventory:read");
    if (!canManage) return { ok: false, title: "You don't have permission to manage item groups" };
    const [g] = await db.select({ id: itemGroup.id }).from(itemGroup).where(and(eq(itemGroup.id, id), inArray(itemGroup.organizationId, groupIds))).limit(1);
    if (!g) return { ok: false, title: "Group not found" };
    await db.delete(itemGroup).where(eq(itemGroup.id, id)); // its memberships go with it
    revalidate();
    return { ok: true };
  });
}

/** Save the order of the groups (ids, first to last). */
export async function reorderItemGroups(ids: string[]): Promise<Result> {
  return guard(async () => {
    const { groupIds, canManage } = await ctx("inventory:read");
    if (!canManage) return { ok: false, title: "You don't have permission to manage item groups" };
    const ours = new Set((await db.select({ id: itemGroup.id }).from(itemGroup).where(inArray(itemGroup.organizationId, groupIds))).map((g) => g.id));
    let n = 0;
    for (const id of ids) if (ours.has(id)) await db.update(itemGroup).set({ sortOrder: ++n }).where(eq(itemGroup.id, id));
    revalidate();
    return { ok: true };
  });
}

/** Add products to a group (they stay in any other groups too). */
export async function addProductsToGroup(productIds: string[], groupId: string): Promise<Result> {
  return guard(async () => {
    const { groupIds, canManage } = await ctx("inventory:read");
    if (!canManage) return { ok: false, title: "You don't have permission to manage item groups" };
    const [g] = await db.select({ id: itemGroup.id }).from(itemGroup).where(and(eq(itemGroup.id, groupId), inArray(itemGroup.organizationId, groupIds))).limit(1);
    if (!g) return { ok: false, title: "Group not found" };
    const ours = productIds.length ? await db.select({ id: product.id }).from(product).where(and(inArray(product.id, productIds), inArray(product.organizationId, groupIds))) : [];
    if (ours.length) await db.insert(itemGroupProduct).values(ours.map((p) => ({ groupId, productId: p.id }))).onConflictDoNothing();
    revalidate();
    return { ok: true };
  });
}

/** Take a product out of one group (its other groups are kept). */
export async function removeProductFromGroup(productId: string, groupId: string): Promise<Result> {
  return guard(async () => {
    const { groupIds, canManage } = await ctx("inventory:read");
    if (!canManage) return { ok: false, title: "You don't have permission to manage item groups" };
    const [g] = await db.select({ id: itemGroup.id }).from(itemGroup).where(and(eq(itemGroup.id, groupId), inArray(itemGroup.organizationId, groupIds))).limit(1);
    if (!g) return { ok: false, title: "Group not found" };
    await db.delete(itemGroupProduct).where(and(eq(itemGroupProduct.groupId, groupId), eq(itemGroupProduct.productId, productId)));
    revalidate();
    return { ok: true };
  });
}

/** Catalogue search to add products to a group. */
export async function searchProductsForGroup(query: string) {
  const { groupIds } = await ctx("inventory:read");
  const q = query.trim();
  if (q.length < 2) return [];
  const rows = await db.select({ id: product.id, productCode: product.productCode, description: product.description })
    .from(product)
    .where(and(inArray(product.organizationId, groupIds), or(ilike(product.productCode, `%${q}%`), ilike(product.description, `%${q}%`))))
    .orderBy(asc(product.productCode)).limit(25);
  const memberOf = await groupIdsByProduct(rows.map((r) => r.id));
  return rows.map((r) => ({ ...r, groupIds: memberOf.get(r.id) ?? [] }));
}
