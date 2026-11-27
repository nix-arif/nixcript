// Document categories down an order's chain: quotation → customer PO → sales order → PR →
// supplier PO → DO → invoice. Each document takes its categories from the one it was made from
// unless it was given its own. Categories belong to one company, so when an order crosses to a
// sibling company (intercompany SO) they are matched by name to that company's own categories.
// Server-only (reads the database).

import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  customerPurchaseOrder,
  deliveryOrder,
  documentCategory,
  purchaseOrder,
  purchaseRequisition,
  quotation,
  salesOrder,
} from "@/db/schema";

const uniq = (ids: (string | null | undefined)[]) => [...new Set(ids.filter((x): x is string => !!x))];

/** The ids that still exist in this org (a deleted category drops off), in the org's own order. */
export async function keepOrgCategories(orgId: string, ids: string[] | null | undefined): Promise<string[]> {
  const want = uniq(ids ?? []);
  if (want.length === 0) return [];
  const rows = await db
    .select({ id: documentCategory.id })
    .from(documentCategory)
    .where(and(eq(documentCategory.organizationId, orgId), inArray(documentCategory.id, want)))
    .orderBy(documentCategory.position);
  return rows.map((r) => r.id);
}

/** The org's default categories (what a new document starts with when it has nothing to inherit). */
export async function defaultCategories(orgId: string): Promise<string[]> {
  const rows = await db
    .select({ id: documentCategory.id })
    .from(documentCategory)
    .where(and(eq(documentCategory.organizationId, orgId), eq(documentCategory.isDefault, true)))
    .orderBy(documentCategory.position);
  return rows.map((r) => r.id);
}

async function idsOf<T extends { categoryIds: unknown }>(rows: T[]): Promise<string[]> {
  return uniq(rows.flatMap((r) => (Array.isArray(r.categoryIds) ? (r.categoryIds as string[]) : [])));
}

export async function quotationCategories(ids: (string | null | undefined)[]): Promise<string[]> {
  const q = uniq(ids);
  if (q.length === 0) return [];
  return idsOf(await db.select({ categoryIds: quotation.categoryIds }).from(quotation).where(inArray(quotation.id, q)));
}

export async function cpoCategories(ids: (string | null | undefined)[]): Promise<string[]> {
  const q = uniq(ids);
  if (q.length === 0) return [];
  return idsOf(await db.select({ categoryIds: customerPurchaseOrder.categoryIds }).from(customerPurchaseOrder).where(inArray(customerPurchaseOrder.id, q)));
}

export async function soCategories(id: string | null | undefined): Promise<string[]> {
  if (!id) return [];
  return idsOf(await db.select({ categoryIds: salesOrder.categoryIds }).from(salesOrder).where(eq(salesOrder.id, id)));
}

export async function prCategories(id: string | null | undefined): Promise<string[]> {
  if (!id) return [];
  return idsOf(await db.select({ categoryIds: purchaseRequisition.categoryIds }).from(purchaseRequisition).where(eq(purchaseRequisition.id, id)));
}

export async function poCategories(id: string | null | undefined): Promise<string[]> {
  if (!id) return [];
  return idsOf(await db.select({ categoryIds: purchaseOrder.categoryIds }).from(purchaseOrder).where(eq(purchaseOrder.id, id)));
}

export async function doCategories(id: string | null | undefined): Promise<string[]> {
  if (!id) return [];
  return idsOf(await db.select({ categoryIds: deliveryOrder.categoryIds }).from(deliveryOrder).where(eq(deliveryOrder.id, id)));
}

/**
 * Another company's categories (fromIds) as this company's (toOrgId), matched by name ignoring case.
 * A category the other company has and this one doesn't is left off.
 */
export async function mapCategoriesToOrg(fromIds: string[], toOrgId: string): Promise<string[]> {
  const ids = uniq(fromIds);
  if (ids.length === 0) return [];
  const from = await db.select({ id: documentCategory.id, organizationId: documentCategory.organizationId, name: documentCategory.name })
    .from(documentCategory).where(inArray(documentCategory.id, ids));
  if (from.every((c) => c.organizationId === toOrgId)) return keepOrgCategories(toOrgId, ids);
  const names = new Set(from.map((c) => c.name.trim().toLowerCase()));
  const own = await db.select({ id: documentCategory.id, name: documentCategory.name })
    .from(documentCategory).where(eq(documentCategory.organizationId, toOrgId)).orderBy(documentCategory.position);
  return own.filter((c) => names.has(c.name.trim().toLowerCase())).map((c) => c.id);
}

/**
 * What a new document gets: the categories it was given, else what it inherits, else the org's
 * defaults. `given` undefined means "not chosen" (inherit); an empty array is a choice of none.
 */
export async function resolveCategories(orgId: string, given: string[] | null | undefined, inherited: () => Promise<string[]>): Promise<string[]> {
  if (Array.isArray(given)) return mapCategoriesToOrg(given, orgId);
  const from = await inherited();
  const mine = from.length > 0 ? await mapCategoriesToOrg(from, orgId) : [];
  return mine.length > 0 ? mine : defaultCategories(orgId);
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
const asIds = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : []);

type ChainDoc = "cpo" | "so" | "pr" | "po";

/**
 * A document's categories changed from oldIds to newIds: the documents made from it that still carry
 * its old categories (or none) follow, and so on down the chain, across to the sibling company's
 * sales order of an intercompany PO. A document whose categories were changed by hand keeps them.
 * Issued DOs and invoices are never changed here.
 */
export async function cascadeCategories(kind: ChainDoc, id: string, oldIds: string[], newIds: string[], depth = 0): Promise<void> {
  if (depth > 8 || sameSet(oldIds, newIds)) return;

  type Next = { kind: ChainDoc; id: string; orgId: string; cur: string[] };
  const next: Next[] = [];
  if (kind === "cpo") {
    const sos = await db.select({ id: salesOrder.id, orgId: salesOrder.organizationId, cur: salesOrder.categoryIds })
      .from(salesOrder).where(eq(salesOrder.customerPoId, id));
    const [cpo] = await db.select({ soId: customerPurchaseOrder.salesOrderId }).from(customerPurchaseOrder).where(eq(customerPurchaseOrder.id, id));
    const extra = cpo?.soId && !sos.some((s) => s.id === cpo.soId)
      ? await db.select({ id: salesOrder.id, orgId: salesOrder.organizationId, cur: salesOrder.categoryIds }).from(salesOrder).where(eq(salesOrder.id, cpo.soId))
      : [];
    for (const s of [...sos, ...extra]) next.push({ kind: "so", id: s.id, orgId: s.orgId, cur: asIds(s.cur) });
  } else if (kind === "so") {
    for (const r of await db.select({ id: purchaseRequisition.id, orgId: purchaseRequisition.organizationId, cur: purchaseRequisition.categoryIds })
      .from(purchaseRequisition).where(eq(purchaseRequisition.salesOrderId, id)))
      next.push({ kind: "pr", id: r.id, orgId: r.orgId, cur: asIds(r.cur) });
    // supplier POs raised straight from the SO (no PR)
    for (const p of await db.select({ id: purchaseOrder.id, orgId: purchaseOrder.organizationId, cur: purchaseOrder.categoryIds, prId: purchaseOrder.purchaseRequisitionId })
      .from(purchaseOrder).where(eq(purchaseOrder.salesOrderId, id)))
      if (!p.prId) next.push({ kind: "po", id: p.id, orgId: p.orgId, cur: asIds(p.cur) });
  } else if (kind === "pr") {
    for (const p of await db.select({ id: purchaseOrder.id, orgId: purchaseOrder.organizationId, cur: purchaseOrder.categoryIds })
      .from(purchaseOrder).where(eq(purchaseOrder.purchaseRequisitionId, id)))
      next.push({ kind: "po", id: p.id, orgId: p.orgId, cur: asIds(p.cur) });
  } else {
    // the sibling company's sales order for this intercompany PO: its own categories, by name
    for (const s of await db.select({ id: salesOrder.id, orgId: salesOrder.organizationId, cur: salesOrder.categoryIds })
      .from(salesOrder).where(eq(salesOrder.sourcePurchaseOrderId, id)))
      next.push({ kind: "so", id: s.id, orgId: s.orgId, cur: asIds(s.cur) });
  }

  for (const n of next) {
    const mappedOld = await mapCategoriesToOrg(oldIds, n.orgId);
    // changed by hand: keeps its own
    if (!(n.cur.length === 0 || sameSet(n.cur, oldIds) || sameSet(n.cur, mappedOld))) continue;
    const ids = await mapCategoriesToOrg(newIds, n.orgId);
    const table = n.kind === "so" ? salesOrder : n.kind === "pr" ? purchaseRequisition : purchaseOrder;
    await db.update(table).set({ categoryIds: ids }).where(eq(table.id, n.id));
    await cascadeCategories(n.kind, n.id, n.cur.length ? n.cur : mappedOld, ids, depth + 1);
  }
}

/** Every category of these companies, for filter chips (in each company's own order). */
export async function categoriesOfOrgs(orgIds: string[]): Promise<{ id: string; name: string; color: string | null }[]> {
  if (orgIds.length === 0) return [];
  return db.select({ id: documentCategory.id, name: documentCategory.name, color: documentCategory.color })
    .from(documentCategory).where(inArray(documentCategory.organizationId, orgIds))
    .orderBy(documentCategory.position, documentCategory.createdAt);
}
