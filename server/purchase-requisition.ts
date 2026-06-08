"use server";

import { db } from "@/db";
import {
  purchaseRequisition,
  purchaseRequisitionItem,
  purchaseRequisitionCounter,
  salesOrder,
  salesOrderItem,
  customerPurchaseOrder,
  product,
  supplier,
  user,
} from "@/db/schema";
import { getCachedSession } from "@/lib/auth/cached-session";
import { nanoid } from "nanoid";
import { eq, and, desc, asc, inArray, ilike, or } from "drizzle-orm";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";
import { getNumberingConfig } from "@/server/document-numbering";
import { buildDocumentNo } from "@/lib/document-numbering";
import { revalidatePath } from "next/cache";

async function getSession() {
  const session = await getCachedSession();
  if (!session) throw new Error("You must be signed in to continue");
  const orgId = session.session.activeOrganizationId;
  if (!orgId) throw new Error("No active organization");
  return { session, orgId, userId: session.user.id };
}

async function requireAccess(permission: string) {
  const { session, orgId, userId } = await getSession();
  const perms = await getUserPermissions(userId, orgId);
  if (!hasAccess(perms, permission)) throw new Error("You don't have permission to do this");
  return { session, orgId, userId };
}

async function generatePrNo(orgId: string): Promise<string> {
  const cfg = await getNumberingConfig(orgId, "pr");
  const year = new Date().getFullYear();
  const existing = await db
    .select()
    .from(purchaseRequisitionCounter)
    .where(eq(purchaseRequisitionCounter.organizationId, orgId))
    .limit(1);
  let nextNo: number;
  if (existing.length === 0) {
    await db.insert(purchaseRequisitionCounter).values({ id: nanoid(), organizationId: orgId, year, lastNumber: 1 });
    nextNo = 1;
  } else {
    const counter = existing[0];
    nextNo = counter.year === year ? counter.lastNumber + 1 : 1;
    await db.update(purchaseRequisitionCounter).set({ year, lastNumber: nextNo }).where(eq(purchaseRequisitionCounter.organizationId, orgId));
  }
  return buildDocumentNo(cfg, year, nextNo);
}

// ── Types ──────────────────────────────────────────────────────────────────

export type PrRow = typeof purchaseRequisition.$inferSelect;
export type PrItemRow = typeof purchaseRequisitionItem.$inferSelect;
export type PrWithItems = PrRow & { items: PrItemRow[]; requestedByName: string | null; approvedByName: string | null };
export type PrListRow = PrRow & { requestedByName: string | null; itemCount: number };

export interface PrItemInput {
  rowNo: number;
  productId?: string;
  productCode?: string;
  description?: string;
  qty?: string;
  uom?: string;
  estimatedUnitCost?: string;
  currency?: string;
  preferredSupplierId?: string;
  preferredSupplierName?: string;
}

export interface CreatePrInput {
  salesOrderId?: string;
  salesOrderNo?: string;
  customerPoId?: string;
  customerPoNo?: string;
  notes?: string;
  items: PrItemInput[];
}

export interface UpdatePrInput extends CreatePrInput {
  id: string;
}

// ── Queries ────────────────────────────────────────────────────────────────

export async function getPurchaseRequisitions(): Promise<PrListRow[]> {
  const { orgId } = await requireAccess("purchase-order:read");
  const rows = await db
    .select()
    .from(purchaseRequisition)
    .where(eq(purchaseRequisition.organizationId, orgId))
    .orderBy(desc(purchaseRequisition.createdAt));

  if (rows.length === 0) return [];

  const userIds = [...new Set(rows.map((r) => r.requestedBy))];
  const users = await db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, userIds));
  const nameOf = (id: string) => users.find((u) => u.id === id)?.name ?? null;

  const prIds = rows.map((r) => r.id);
  const itemCounts = await db
    .select({ purchaseRequisitionId: purchaseRequisitionItem.purchaseRequisitionId })
    .from(purchaseRequisitionItem)
    .where(inArray(purchaseRequisitionItem.purchaseRequisitionId, prIds));
  const countMap = new Map<string, number>();
  for (const i of itemCounts) {
    countMap.set(i.purchaseRequisitionId, (countMap.get(i.purchaseRequisitionId) ?? 0) + 1);
  }

  return rows.map((r) => ({ ...r, requestedByName: nameOf(r.requestedBy), itemCount: countMap.get(r.id) ?? 0 }));
}

export async function getPurchaseRequisitionDetail(id: string): Promise<PrWithItems | null> {
  const { orgId } = await requireAccess("purchase-order:read");
  const [row] = await db
    .select()
    .from(purchaseRequisition)
    .where(and(eq(purchaseRequisition.id, id), eq(purchaseRequisition.organizationId, orgId)));
  if (!row) return null;

  const items = await db
    .select()
    .from(purchaseRequisitionItem)
    .where(eq(purchaseRequisitionItem.purchaseRequisitionId, id))
    .orderBy(asc(purchaseRequisitionItem.rowNo));

  const userIds = [row.requestedBy, ...(row.approvedBy ? [row.approvedBy] : [])];
  const users = await db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, userIds));
  const nameOf = (uid: string | null) => users.find((u) => u.id === uid)?.name ?? null;

  return { ...row, items, requestedByName: nameOf(row.requestedBy), approvedByName: nameOf(row.approvedBy) };
}

export async function getPrsBySoId(soId: string): Promise<PrListRow[]> {
  const { orgId } = await requireAccess("purchase-order:read");
  const rows = await db
    .select()
    .from(purchaseRequisition)
    .where(and(eq(purchaseRequisition.salesOrderId, soId), eq(purchaseRequisition.organizationId, orgId)))
    .orderBy(asc(purchaseRequisition.createdAt));

  if (rows.length === 0) return [];

  const userIds = [...new Set(rows.map((r) => r.requestedBy))];
  const users = await db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, userIds));
  const nameOf = (id: string) => users.find((u) => u.id === id)?.name ?? null;

  const prIds = rows.map((r) => r.id);
  const allItems = await db
    .select({ purchaseRequisitionId: purchaseRequisitionItem.purchaseRequisitionId })
    .from(purchaseRequisitionItem)
    .where(inArray(purchaseRequisitionItem.purchaseRequisitionId, prIds));
  const countMap = new Map<string, number>();
  for (const i of allItems) {
    countMap.set(i.purchaseRequisitionId, (countMap.get(i.purchaseRequisitionId) ?? 0) + 1);
  }

  return rows.map((r) => ({ ...r, requestedByName: nameOf(r.requestedBy), itemCount: countMap.get(r.id) ?? 0 }));
}

// ── Mutations ──────────────────────────────────────────────────────────────

export async function createPurchaseRequisition(input: CreatePrInput): Promise<PrRow> {
  const { orgId, userId } = await requireAccess("purchase-order:create");
  const prNo = await generatePrNo(orgId);

  const [row] = await db.insert(purchaseRequisition).values({
    id: nanoid(),
    organizationId: orgId,
    prNo,
    salesOrderId:  input.salesOrderId  ?? null,
    salesOrderNo:  input.salesOrderNo  ?? null,
    customerPoId:  input.customerPoId  ?? null,
    customerPoNo:  input.customerPoNo  ?? null,
    notes: input.notes ?? null,
    status: "draft",
    requestedBy: userId,
  }).returning();

  if (input.items.length > 0) {
    await db.insert(purchaseRequisitionItem).values(
      input.items.map((i) => ({
        id: nanoid(),
        purchaseRequisitionId: row.id,
        rowNo: i.rowNo,
        productId: i.productId ?? null,
        productCode: i.productCode ?? null,
        description: i.description ?? null,
        qty: i.qty ?? "1",
        uom: i.uom ?? null,
        estimatedUnitCost: i.estimatedUnitCost ?? "0",
        currency: i.currency ?? "MYR",
        totalEstimatedCost: (
          parseFloat(i.qty ?? "1") * parseFloat(i.estimatedUnitCost ?? "0")
        ).toFixed(2),
        preferredSupplierId: i.preferredSupplierId ?? null,
        preferredSupplierName: i.preferredSupplierName ?? null,
      })),
    );
  }

  revalidatePath("/dashboard/procurement/requisition");
  return row;
}

export async function updatePurchaseRequisition(input: UpdatePrInput): Promise<PrRow> {
  const { orgId } = await requireAccess("purchase-order:update");
  const [existing] = await db
    .select()
    .from(purchaseRequisition)
    .where(and(eq(purchaseRequisition.id, input.id), eq(purchaseRequisition.organizationId, orgId)));
  if (!existing) throw new Error("Purchase requisition not found");
  if (!["draft"].includes(existing.status)) throw new Error("Only draft requisitions can be edited");

  const [row] = await db.update(purchaseRequisition).set({
    salesOrderId: input.salesOrderId ?? null,
    salesOrderNo: input.salesOrderNo ?? null,
    notes: input.notes ?? null,
  }).where(eq(purchaseRequisition.id, input.id)).returning();

  await db.delete(purchaseRequisitionItem).where(eq(purchaseRequisitionItem.purchaseRequisitionId, input.id));
  if (input.items.length > 0) {
    await db.insert(purchaseRequisitionItem).values(
      input.items.map((i) => ({
        id: nanoid(),
        purchaseRequisitionId: input.id,
        rowNo: i.rowNo,
        productId: i.productId ?? null,
        productCode: i.productCode ?? null,
        description: i.description ?? null,
        qty: i.qty ?? "1",
        uom: i.uom ?? null,
        estimatedUnitCost: i.estimatedUnitCost ?? "0",
        currency: i.currency ?? "MYR",
        totalEstimatedCost: (
          parseFloat(i.qty ?? "1") * parseFloat(i.estimatedUnitCost ?? "0")
        ).toFixed(2),
        preferredSupplierId: i.preferredSupplierId ?? null,
        preferredSupplierName: i.preferredSupplierName ?? null,
      })),
    );
  }

  revalidatePath("/dashboard/procurement/requisition");
  revalidatePath(`/dashboard/procurement/requisition/${input.id}`);
  return row;
}

export async function deletePurchaseRequisition(id: string): Promise<void> {
  const { orgId } = await requireAccess("purchase-order:delete");
  const [existing] = await db
    .select()
    .from(purchaseRequisition)
    .where(and(eq(purchaseRequisition.id, id), eq(purchaseRequisition.organizationId, orgId)));
  if (!existing) throw new Error("Purchase requisition not found");
  if (existing.status !== "draft") throw new Error("Only draft requisitions can be deleted");
  await db.delete(purchaseRequisition).where(eq(purchaseRequisition.id, id));
  revalidatePath("/dashboard/procurement/requisition");
}

export async function submitPurchaseRequisition(id: string): Promise<void> {
  const { orgId } = await requireAccess("purchase-order:create");
  const [existing] = await db
    .select()
    .from(purchaseRequisition)
    .where(and(eq(purchaseRequisition.id, id), eq(purchaseRequisition.organizationId, orgId)));
  if (!existing) throw new Error("Purchase requisition not found");
  if (existing.status !== "draft") throw new Error("Only draft requisitions can be submitted");
  await db.update(purchaseRequisition).set({ status: "submitted" }).where(eq(purchaseRequisition.id, id));
  revalidatePath(`/dashboard/procurement/requisition/${id}`);
  revalidatePath("/dashboard/procurement/requisition");
}

export async function approvePurchaseRequisition(id: string): Promise<void> {
  const { orgId, userId } = await requireAccess("purchase-requisition:approve");
  const [existing] = await db
    .select()
    .from(purchaseRequisition)
    .where(and(eq(purchaseRequisition.id, id), eq(purchaseRequisition.organizationId, orgId)));
  if (!existing) throw new Error("Purchase requisition not found");
  if (existing.status !== "submitted") throw new Error("Only submitted requisitions can be approved");
  await db.update(purchaseRequisition).set({ status: "approved", approvedBy: userId, approvedAt: new Date() }).where(eq(purchaseRequisition.id, id));
  revalidatePath(`/dashboard/procurement/requisition/${id}`);
  revalidatePath("/dashboard/procurement/requisition");
}

export async function rejectPurchaseRequisition(id: string): Promise<void> {
  const { orgId } = await requireAccess("purchase-requisition:approve");
  const [existing] = await db
    .select()
    .from(purchaseRequisition)
    .where(and(eq(purchaseRequisition.id, id), eq(purchaseRequisition.organizationId, orgId)));
  if (!existing) throw new Error("Purchase requisition not found");
  if (existing.status !== "submitted") throw new Error("Only submitted requisitions can be rejected");
  await db.update(purchaseRequisition).set({ status: "draft" }).where(eq(purchaseRequisition.id, id));
  revalidatePath(`/dashboard/procurement/requisition/${id}`);
  revalidatePath("/dashboard/procurement/requisition");
}

export async function cancelPurchaseRequisition(id: string): Promise<void> {
  const { orgId } = await requireAccess("purchase-order:update");
  const [existing] = await db
    .select()
    .from(purchaseRequisition)
    .where(and(eq(purchaseRequisition.id, id), eq(purchaseRequisition.organizationId, orgId)));
  if (!existing) throw new Error("Purchase requisition not found");
  if (["ordered", "cancelled"].includes(existing.status)) throw new Error("Cannot cancel this requisition");
  await db.update(purchaseRequisition).set({ status: "cancelled" }).where(eq(purchaseRequisition.id, id));
  revalidatePath(`/dashboard/procurement/requisition/${id}`);
  revalidatePath("/dashboard/procurement/requisition");
}

// ── Helpers for create form ────────────────────────────────────────────────

export async function searchSuppliersForPr(query: string) {
  if (!query.trim()) return [];
  const { orgId } = await requireAccess("purchase-order:read");
  return db
    .select({ id: supplier.id, name: supplier.name })
    .from(supplier)
    .where(and(eq(supplier.organizationId, orgId), ilike(supplier.name, `%${query}%`)))
    .orderBy(asc(supplier.name))
    .limit(20);
}

export type CpoLineItem = {
  rowNo: number;
  productCode: string;
  description: string;
  qty: string;
  uom: string;
  unitPrice: string;
  discountPct: string;
  totalPrice: string;
  lineType: string;
};

export async function getCposForSo(soId: string): Promise<{
  id: string;
  customerPoNo: string;
  amount: string;
  currency: string;
  items: CpoLineItem[] | null;
}[]> {
  const { orgId } = await requireAccess("purchase-order:read");
  return db
    .select({
      id: customerPurchaseOrder.id,
      customerPoNo: customerPurchaseOrder.customerPoNo,
      amount: customerPurchaseOrder.amount,
      currency: customerPurchaseOrder.currency,
      items: customerPurchaseOrder.items,
    })
    .from(customerPurchaseOrder)
    .where(and(eq(customerPurchaseOrder.salesOrderId, soId), eq(customerPurchaseOrder.organizationId, orgId)))
    .orderBy(asc(customerPurchaseOrder.createdAt));
}

export async function getSoItemsForPr(soId: string) {
  const { orgId } = await requireAccess("purchase-order:read");
  const [so] = await db
    .select({ id: salesOrder.id, soNo: salesOrder.soNo })
    .from(salesOrder)
    .where(and(eq(salesOrder.id, soId), eq(salesOrder.organizationId, orgId)));
  if (!so) return null;

  const [items, cpos] = await Promise.all([
    db
      .select({
        id: salesOrderItem.id,
        productId: salesOrderItem.productId,
        productCode: salesOrderItem.productCode,
        description: salesOrderItem.description,
        qty: salesOrderItem.qty,
        uom: salesOrderItem.uom,
      })
      .from(salesOrderItem)
      .where(eq(salesOrderItem.salesOrderId, soId))
      .orderBy(asc(salesOrderItem.rowNo)),

    db
      .select({
        id: customerPurchaseOrder.id,
        customerPoNo: customerPurchaseOrder.customerPoNo,
        customerSnapshot: customerPurchaseOrder.customerSnapshot,
        items: customerPurchaseOrder.items,
      })
      .from(customerPurchaseOrder)
      .where(and(
        eq(customerPurchaseOrder.salesOrderId, soId),
        eq(customerPurchaseOrder.organizationId, orgId),
      )),
  ]);

  // Match each SO item to a CPO by productCode (primary) or description (fallback)
  function matchCpo(productCode: string | null, description: string | null) {
    for (const cpo of cpos) {
      const hit = (cpo.items ?? []).some((ci) =>
        (productCode && ci.productCode && ci.productCode === productCode) ||
        (description && ci.description && ci.description === description)
      );
      if (hit) {
        const snap = cpo.customerSnapshot as { name?: string } | null;
        return { cpoId: cpo.id, cpoNo: cpo.customerPoNo, customerName: snap?.name ?? null };
      }
    }
    return null;
  }

  // Enrich with product unit cost for estimated price
  const productIds = items.map((i) => i.productId).filter(Boolean) as string[];
  const costs = productIds.length > 0
    ? await db.select({ id: product.id, costUnitPrice: product.costUnitPrice }).from(product).where(inArray(product.id, productIds))
    : [];
  const costMap = new Map(costs.map((c) => [c.id, c.costUnitPrice]));

  return {
    soNo: so.soNo,
    items: items
      .filter((i) => i.description || i.productCode)
      .map((i, idx) => {
        const cpoMatch = matchCpo(i.productCode, i.description);
        return {
          rowNo: idx + 1,
          productId: i.productId ?? undefined,
          productCode: i.productCode ?? "",
          description: i.description ?? "",
          qty: i.qty ?? "1",
          uom: i.uom ?? "",
          estimatedUnitCost: i.productId ? (costMap.get(i.productId) ?? "0") : "0",
          cpoId:        cpoMatch?.cpoId        ?? null,
          cpoNo:        cpoMatch?.cpoNo        ?? null,
          customerName: cpoMatch?.customerName ?? null,
        };
      }),
  };
}

export async function searchConfirmedSosForPr(query: string) {
  const { orgId } = await requireAccess("purchase-order:read");
  return db
    .select({ id: salesOrder.id, soNo: salesOrder.soNo })
    .from(salesOrder)
    .where(and(
      eq(salesOrder.organizationId, orgId),
      inArray(salesOrder.status, ["confirmed", "fulfilled"]),
      or(ilike(salesOrder.soNo, `%${query}%`)),
    ))
    .orderBy(desc(salesOrder.createdAt))
    .limit(20);
}

export async function getOpenSosForPr() {
  const { orgId } = await requireAccess("purchase-order:read");
  return db
    .select({ id: salesOrder.id, soNo: salesOrder.soNo })
    .from(salesOrder)
    .where(and(
      eq(salesOrder.organizationId, orgId),
      inArray(salesOrder.status, ["confirmed", "fulfilled"]),
    ))
    .orderBy(desc(salesOrder.createdAt))
    .limit(30);
}
