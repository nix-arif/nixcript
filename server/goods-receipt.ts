"use server";

import { db } from "@/db";
import {
  goodsReceipt,
  goodsReceiptItem,
  goodsReceiptCounter,
  purchaseOrder,
  purchaseOrderItem,
  purchaseRequisition,
  product,
  user,
  organization,
  supplier,
  salesOrder,
  salesOrderItem,
  member,
  packingList,
} from "@/db/schema";
import { getCachedSession } from "@/lib/auth/cached-session";
import { nanoid } from "nanoid";
import { eq, and, or, ne, desc, inArray } from "drizzle-orm";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";
import { getNumberingConfig } from "@/server/document-numbering";
import { buildDocumentNo } from "@/lib/document-numbering";
import { revalidatePath } from "next/cache";
import { createApprovedMovement } from "@/lib/inventory/create-movement";
import { MOVEMENT_TYPE, REF_TYPE } from "@/lib/inventory/constants";
import { performStockCheckAndReserve } from "@/server/stock-reservation";

// ── Auth helpers ────────────────────────────────────────────────────────────

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

// createGoodsReceipt is used both for the plain direct-PO flow (gated on
// goods-receipt:create, e.g. logistics) and internally when completing a
// packing list's inspection (gated on packing-list:inspect, e.g.
// engineering) — either permission is enough to call it.
async function requireAnyAccess(permissions: string[]) {
  const { session, orgId, userId } = await getSession();
  const perms = await getUserPermissions(userId, orgId);
  if (!permissions.some((p) => hasAccess(perms, p))) throw new Error("You don't have permission to do this");
  return { session, orgId, userId };
}

// For actions restricted to the organization owner regardless of any
// individually granted permission — e.g. recalling or deleting a GR.
async function requireOwner() {
  const { session, orgId, userId } = await getSession();
  const [m] = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.organizationId, orgId)))
    .limit(1);
  if (!m || m.role !== "owner") throw new Error("Only the organization owner can do this");
  return { session, orgId, userId };
}

// Every org owned by the same owner as the caller's active org — see the
// identical pattern duplicated per-file in server/purchase-order.ts etc.
async function getOwnerOrgIds(orgId: string): Promise<string[]> {
  const [ownerMember] = await db
    .select()
    .from(member)
    .where(and(eq(member.organizationId, orgId), eq(member.role, "owner")))
    .limit(1);
  if (!ownerMember) return [orgId];
  const owned = await db
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(and(eq(member.userId, ownerMember.userId), eq(member.role, "owner")));
  const ids = [...new Set(owned.map((m) => m.organizationId))];
  return ids.length > 0 ? ids : [orgId];
}

// ── Running number ──────────────────────────────────────────────────────────

async function generateGrNo(orgId: string): Promise<string> {
  const cfg = await getNumberingConfig(orgId, "gr");
  const year = new Date().getFullYear();
  const existing = await db
    .select()
    .from(goodsReceiptCounter)
    .where(eq(goodsReceiptCounter.organizationId, orgId))
    .limit(1);
  let nextNo: number;
  if (existing.length === 0) {
    await db.insert(goodsReceiptCounter).values({ id: nanoid(), organizationId: orgId, year, lastNumber: 1 });
    nextNo = 1;
  } else {
    const counter = existing[0];
    nextNo = counter.year === year ? counter.lastNumber + 1 : 1;
    await db
      .update(goodsReceiptCounter)
      .set({ year, lastNumber: nextNo })
      .where(eq(goodsReceiptCounter.organizationId, orgId));
  }
  return buildDocumentNo(cfg, year, nextNo);
}

// ── Types ───────────────────────────────────────────────────────────────────

export type GoodsReceiptRow = typeof goodsReceipt.$inferSelect;
export type GoodsReceiptItemRow = typeof goodsReceiptItem.$inferSelect;

export interface GoodsReceiptItemInput {
  purchaseOrderItemId?: string;
  productId?: string;
  productCode?: string;
  description?: string;
  qtyOrdered: string;
  qtyReceived: string;
  uom?: string;
  unitPrice?: string;
  currency?: string;
  notes?: string;
  // Inspection outcome — set only when this line came from a packing list.
  // qtyGood (falls back to qtyReceived when absent) is what actually feeds
  // stock, so a plain direct receipt with no inspection behaves exactly as
  // it always has. A line can split across both qtyReturn and qtyRepair at
  // once, so they're tracked (and resolved) independently.
  packingListItemId?: string;
  qtyGood?: string;
  qtyReturn?: string;
  qtyRepair?: string;
  returnStatus?: string;
  returnNotes?: string;
  repairStatus?: string;
  repairNotes?: string;
}

export interface CreateGoodsReceiptInput {
  purchaseOrderId: string;
  receivedDate: Date;
  notes?: string;
  items: GoodsReceiptItemInput[];
  // Set together when this GR is generated by completing inspection on a
  // packing list — packingListId links the header, inspectedBy/inspectedAt
  // get stamped onto every item.
  packingListId?: string;
  inspectedBy?: string;
  // Set only by the packing-list-centralized inspection flow, when the
  // packing list belongs to a sibling org rather than the caller's own
  // active org. Never trusted at face value — re-verified independently
  // below regardless of who calls this function or with what claims.
  targetOrgId?: string;
}

export type GoodsReceiptItemEnriched = GoodsReceiptItemRow & {
  returnResolvedByName: string | null;
  repairResolvedByName: string | null;
};

export type GoodsReceiptWithItems = GoodsReceiptRow & {
  items: GoodsReceiptItemEnriched[];
  receivedByName: string | null;
  purchaseOrderNo: string | null;
  purchaseOrderPrNo: string | null;
};

export type GoodsReceiptListRow = GoodsReceiptRow & {
  receivedByName: string | null;
  poNo: string | null;
  prNo: string | null;
  supplierName: string | null;
  itemCount: number;
  salesOrderId: string | null;
  salesOrderNo: string | null;
};

export type ConfirmedPoForGr = {
  id: string;
  prNo: string | null;
  poNo: string | null;
  supplierName: string | null;
  grandTotal: string;
  currency: string;
  expectedDeliveryDate: Date | null;
  grCount: number;
};

// ── Queries ─────────────────────────────────────────────────────────────────

export async function getGoodsReceiptsForPo(purchaseOrderId: string): Promise<GoodsReceiptRow[]> {
  const { orgId } = await requireAccess("purchase-order:read");
  return db
    .select()
    .from(goodsReceipt)
    .where(and(eq(goodsReceipt.purchaseOrderId, purchaseOrderId), eq(goodsReceipt.organizationId, orgId)))
    .orderBy(desc(goodsReceipt.createdAt));
}

export async function getGoodsReceiptDetail(id: string): Promise<GoodsReceiptWithItems | null> {
  const { orgId } = await requireAccess("purchase-order:read");
  const [gr] = await db
    .select()
    .from(goodsReceipt)
    .where(and(eq(goodsReceipt.id, id), eq(goodsReceipt.organizationId, orgId)));
  if (!gr) return null;

  const [items, userRows, poRows] = await Promise.all([
    db.select().from(goodsReceiptItem).where(eq(goodsReceiptItem.goodsReceiptId, id)),
    db.select({ id: user.id, name: user.name }).from(user).where(eq(user.id, gr.receivedBy)),
    db.select({ id: purchaseOrder.id, poNo: purchaseOrder.poNo, prNo: purchaseOrder.prNo })
      .from(purchaseOrder)
      .where(eq(purchaseOrder.id, gr.purchaseOrderId)),
  ]);

  const resolverIds = [...new Set(items.flatMap((i) => [i.returnResolvedBy, i.repairResolvedBy]).filter((v): v is string => !!v))];
  const resolvers = resolverIds.length > 0
    ? await db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, resolverIds))
    : [];
  const resolverNameOf = (id: string | null) => (id ? (resolvers.find((r) => r.id === id)?.name ?? null) : null);

  const enrichedItems: GoodsReceiptItemEnriched[] = items.map((i) => ({
    ...i,
    returnResolvedByName: resolverNameOf(i.returnResolvedBy),
    repairResolvedByName: resolverNameOf(i.repairResolvedBy),
  }));

  return {
    ...gr,
    items: enrichedItems,
    receivedByName: userRows[0]?.name ?? null,
    purchaseOrderNo: poRows[0]?.poNo ?? null,
    purchaseOrderPrNo: poRows[0]?.prNo ?? null,
  };
}

export async function getAllGoodsReceipts(): Promise<GoodsReceiptListRow[]> {
  const { orgId } = await requireAccess("purchase-order:read");

  const grs = await db
    .select()
    .from(goodsReceipt)
    .where(eq(goodsReceipt.organizationId, orgId))
    .orderBy(desc(goodsReceipt.createdAt));

  if (grs.length === 0) return [];

  const userIds   = [...new Set(grs.map((g) => g.receivedBy))];
  const poIds     = [...new Set(grs.map((g) => g.purchaseOrderId))];
  const grIds     = grs.map((g) => g.id);

  const [users, pos, grItems] = await Promise.all([
    db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, userIds)),
    db.select({ id: purchaseOrder.id, prNo: purchaseOrder.prNo, poNo: purchaseOrder.poNo, supplierSnapshot: purchaseOrder.supplierSnapshot, salesOrderId: purchaseOrder.salesOrderId })
      .from(purchaseOrder)
      .where(inArray(purchaseOrder.id, poIds)),
    db.select({ goodsReceiptId: goodsReceiptItem.goodsReceiptId })
      .from(goodsReceiptItem)
      .where(inArray(goodsReceiptItem.goodsReceiptId, grIds)),
  ]);

  const soIds = [...new Set(pos.map((p) => p.salesOrderId).filter(Boolean))] as string[];
  const soRows = soIds.length > 0
    ? await db.select({ id: salesOrder.id, soNo: salesOrder.soNo }).from(salesOrder).where(inArray(salesOrder.id, soIds))
    : [];
  const soMap = Object.fromEntries(soRows.map((s) => [s.id, s.soNo]));

  const userMap    = Object.fromEntries(users.map((u) => [u.id, u.name]));
  const poMap      = Object.fromEntries(pos.map((p) => [p.id, p]));
  const itemCounts = grIds.reduce<Record<string, number>>((acc, id) => ({ ...acc, [id]: 0 }), {});
  for (const gi of grItems) itemCounts[gi.goodsReceiptId] = (itemCounts[gi.goodsReceiptId] ?? 0) + 1;

  return grs.map((gr) => {
    const po   = poMap[gr.purchaseOrderId];
    const snap = po?.supplierSnapshot as any;
    const soId = po?.salesOrderId ?? null;
    return {
      ...gr,
      receivedByName: userMap[gr.receivedBy] ?? null,
      poNo:           po?.poNo ?? null,
      prNo:           po?.prNo ?? null,
      supplierName:   snap?.name ?? null,
      itemCount:      itemCounts[gr.id] ?? 0,
      salesOrderId:   soId,
      salesOrderNo:   soId ? (soMap[soId] ?? null) : null,
    };
  });
}

export type PendingReturnRepairRow = {
  goodsReceiptItemId: string;
  category: "return" | "repair";
  qty: number;
  notes: string | null;
  productCode: string | null;
  description: string | null;
  goodsReceiptId: string;
  grNo: string;
  purchaseOrderId: string;
  poNo: string | null;
  prNo: string | null;
  supplierName: string | null;
  inspectedAt: Date | null;
};

// "Fulfilled" only tracks physical receipt (see maybeAutoFulfill below) — it
// says nothing about condition. This is the org-wide worklist for the other
// half: every received line still sitting unresolved in "return to
// supplier" or "in-house repair", across every PO, in one place — the
// alternative to hunting down each GR individually to find out what's
// outstanding.
export async function getPendingReturnsAndRepairs(): Promise<PendingReturnRepairRow[]> {
  const { orgId } = await requireAccess("purchase-order:read");

  const rows = await db
    .select({
      id: goodsReceiptItem.id,
      qtyReturn: goodsReceiptItem.qtyReturn,
      returnStatus: goodsReceiptItem.returnStatus,
      returnNotes: goodsReceiptItem.returnNotes,
      qtyRepair: goodsReceiptItem.qtyRepair,
      repairStatus: goodsReceiptItem.repairStatus,
      repairNotes: goodsReceiptItem.repairNotes,
      productCode: goodsReceiptItem.productCode,
      description: goodsReceiptItem.description,
      inspectedAt: goodsReceiptItem.inspectedAt,
      goodsReceiptId: goodsReceipt.id,
      grNo: goodsReceipt.grNo,
      purchaseOrderId: goodsReceipt.purchaseOrderId,
    })
    .from(goodsReceiptItem)
    .innerJoin(goodsReceipt, eq(goodsReceiptItem.goodsReceiptId, goodsReceipt.id))
    .where(and(
      eq(goodsReceipt.organizationId, orgId),
      ne(goodsReceipt.status, "recalled"),
      or(eq(goodsReceiptItem.returnStatus, "pending"), eq(goodsReceiptItem.repairStatus, "pending")),
    ));
  if (rows.length === 0) return [];

  const poIds = [...new Set(rows.map((r) => r.purchaseOrderId))];
  const pos = await db
    .select({ id: purchaseOrder.id, poNo: purchaseOrder.poNo, prNo: purchaseOrder.prNo, supplierSnapshot: purchaseOrder.supplierSnapshot })
    .from(purchaseOrder)
    .where(inArray(purchaseOrder.id, poIds));
  const poMap = Object.fromEntries(pos.map((p) => [p.id, p]));

  const result: PendingReturnRepairRow[] = [];
  for (const r of rows) {
    const po = poMap[r.purchaseOrderId];
    const snap = po?.supplierSnapshot as { name?: string } | null;
    const base = {
      productCode: r.productCode,
      description: r.description,
      goodsReceiptId: r.goodsReceiptId,
      grNo: r.grNo,
      purchaseOrderId: r.purchaseOrderId,
      poNo: po?.poNo ?? null,
      prNo: po?.prNo ?? null,
      supplierName: snap?.name ?? null,
      inspectedAt: r.inspectedAt,
    };
    const qtyReturn = parseFloat(r.qtyReturn ?? "0") || 0;
    if (r.returnStatus === "pending" && qtyReturn > 0) {
      result.push({ ...base, goodsReceiptItemId: r.id, category: "return", qty: qtyReturn, notes: r.returnNotes });
    }
    const qtyRepair = parseFloat(r.qtyRepair ?? "0") || 0;
    if (r.repairStatus === "pending" && qtyRepair > 0) {
      result.push({ ...base, goodsReceiptItemId: r.id, category: "repair", qty: qtyRepair, notes: r.repairNotes });
    }
  }
  return result.sort((a, b) => (a.inspectedAt?.getTime() ?? 0) - (b.inspectedAt?.getTime() ?? 0));
}

export async function getConfirmedPosForGr(): Promise<ConfirmedPoForGr[]> {
  const { orgId } = await requireAccess("purchase-order:read");

  const pos = await db
    .select()
    .from(purchaseOrder)
    .where(and(eq(purchaseOrder.organizationId, orgId), eq(purchaseOrder.status, "confirmed")))
    .orderBy(desc(purchaseOrder.createdAt));

  if (pos.length === 0) return [];

  const poIds = pos.map((p) => p.id);
  const existingGrs = await db
    .select({ purchaseOrderId: goodsReceipt.purchaseOrderId })
    .from(goodsReceipt)
    .where(and(eq(goodsReceipt.organizationId, orgId), inArray(goodsReceipt.purchaseOrderId, poIds)));

  const grCountByPo = existingGrs.reduce<Record<string, number>>((acc, g) => {
    acc[g.purchaseOrderId] = (acc[g.purchaseOrderId] ?? 0) + 1;
    return acc;
  }, {});

  return pos.map((p) => {
    const snap = p.supplierSnapshot as any;
    return {
      id:                   p.id,
      prNo:                 p.prNo,
      poNo:                 p.poNo,
      supplierName:         snap?.name ?? null,
      grandTotal:           p.grandTotal,
      currency:             p.currency,
      expectedDeliveryDate: p.expectedDeliveryDate,
      grCount:              grCountByPo[p.id] ?? 0,
    };
  });
}

// ── Mutations ───────────────────────────────────────────────────────────────

export async function createGoodsReceipt(input: CreateGoodsReceiptInput): Promise<GoodsReceiptRow> {
  let orgId: string;
  let userId: string;

  if (input.targetOrgId) {
    // Cross-org path, used only when completing inspection on a packing list
    // that belongs to a sibling org — this function is a public server
    // action, so targetOrgId is independently re-verified here rather than
    // trusted from the caller: it must be an org the caller's owner actually
    // controls, and the caller must hold either the dedicated centralized
    // permission or packing-list:inspect evaluated in that specific org
    // (which itself falls back to sibling-org role resolution).
    const session = await getCachedSession();
    if (!session) throw new Error("You must be signed in to continue");
    const callerOrgId = session.session.activeOrganizationId;
    if (!callerOrgId) throw new Error("No active organization");
    userId = session.user.id;

    const ownerOrgIds = await getOwnerOrgIds(callerOrgId);
    if (!ownerOrgIds.includes(input.targetOrgId)) throw new Error("You don't have permission to do this");

    const callerPerms = await getUserPermissions(userId, callerOrgId);
    const targetPerms = input.targetOrgId === callerOrgId ? callerPerms : await getUserPermissions(userId, input.targetOrgId);
    if (!hasAccess(callerPerms, "packing-list:inspect:centralized") && !hasAccess(targetPerms, "packing-list:inspect")) {
      throw new Error("You don't have permission to do this");
    }
    orgId = input.targetOrgId;
  } else {
    ({ orgId, userId } = await requireAnyAccess(["goods-receipt:create", "packing-list:inspect"]));
  }

  // Verify PO exists, belongs to org, and is in confirmed status
  const [po] = await db
    .select()
    .from(purchaseOrder)
    .where(and(eq(purchaseOrder.id, input.purchaseOrderId), eq(purchaseOrder.organizationId, orgId)));
  if (!po) throw new Error("Purchase order not found");
  if (po.status !== "confirmed") throw new Error("Goods receipt can only be created for confirmed purchase orders");

  const grNo = await generateGrNo(orgId);

  const [gr] = await db
    .insert(goodsReceipt)
    .values({
      id: nanoid(),
      organizationId: orgId,
      grNo,
      purchaseOrderId: input.purchaseOrderId,
      packingListId: input.packingListId ?? null,
      receivedDate: input.receivedDate,
      receivedBy: userId,
      notes: input.notes ?? null,
    })
    .returning();

  if (input.items.length > 0) {
    await db.insert(goodsReceiptItem).values(
      input.items.map((item) => ({
        id: nanoid(),
        goodsReceiptId: gr.id,
        purchaseOrderItemId: item.purchaseOrderItemId ?? null,
        productId: item.productId ?? null,
        productCode: item.productCode ?? null,
        description: item.description ?? null,
        qtyOrdered: item.qtyOrdered,
        qtyReceived: item.qtyReceived,
        uom: item.uom ?? null,
        unitPrice: item.unitPrice ?? "0",
        currency: item.currency ?? "MYR",
        notes: item.notes ?? null,
        packingListItemId: item.packingListItemId ?? null,
        qtyGood: item.qtyGood ?? null,
        qtyReturn: item.qtyReturn ?? null,
        qtyRepair: item.qtyRepair ?? null,
        returnStatus: item.returnStatus ?? null,
        returnNotes: item.returnNotes ?? null,
        repairStatus: item.repairStatus ?? null,
        repairNotes: item.repairNotes ?? null,
        inspectedBy: input.inspectedBy ?? null,
        inspectedAt: input.inspectedBy ? new Date() : null,
      })),
    );
  }

  // Determine warehouse: sample_demo PRs go to "Demo" stock, all others to "Default"
  let warehouseLabel = "Default";
  if (po.purchaseRequisitionId) {
    const [pr] = await db
      .select({ prType: purchaseRequisition.prType })
      .from(purchaseRequisition)
      .where(eq(purchaseRequisition.id, po.purchaseRequisitionId));
    if (pr?.prType === "sample_demo") warehouseLabel = "Demo";
  }

  // Create STOCK_IN inventory movement for items with productId and stock
  // qty > 0. Stock qty is qtyGood when the item was inspected (only the
  // good-condition portion should ever enter available inventory), falling
  // back to the full qtyReceived for the plain direct-PO flow which has no
  // inspection concept.
  const stockQty = (item: GoodsReceiptItemInput) =>
    item.qtyGood !== undefined ? (parseFloat(item.qtyGood) || 0) : (parseFloat(item.qtyReceived) || 0);
  const poRef = po.poNo ?? po.prNo ?? po.id;
  await Promise.all(
    input.items
      .filter((item) => item.productId && stockQty(item) > 0)
      .map(async (item) => {
        await createApprovedMovement({
          orgId,
          userId,
          productId: item.productId!,
          warehouseLabel,
          movementType: MOVEMENT_TYPE.STOCK_IN,
          quantity: stockQty(item),
          unitCost: item.unitPrice ?? undefined,
          referenceType: REF_TYPE.PURCHASE_ORDER,
          referenceId: gr.id,
          referenceNo: grNo,
          notes: `GR ${grNo} · PO ${poRef}: ${item.productCode ?? ""}`.trim(),
        });
        // Update product cost price
        if (item.unitPrice) {
          await db
            .update(product)
            .set({
              costUnitPrice: item.unitPrice,
              ...(item.currency ? { costPriceCurrency: item.currency } : {}),
            })
            .where(eq(product.id, item.productId!));
        }
      }),
  );

  // Auto-fulfill the PO if all items are fully received across all GRs
  await syncPoFulfillmentStatus(input.purchaseOrderId, orgId);

  // Re-attempt stock reservation for any SOs that were previously insufficient
  // and contain the products just received into the Default warehouse.
  if (warehouseLabel === "Default") {
    const receivedProductIds = input.items
      .filter((i) => i.productId && stockQty(i) > 0)
      .map((i) => i.productId!);

    if (receivedProductIds.length > 0) {
      await retryInsufficientSos(orgId, userId, receivedProductIds);
    }
  }

  revalidatePath(`/dashboard/procurement/purchase-order/${input.purchaseOrderId}`);
  revalidatePath("/dashboard/procurement/purchase-order");
  revalidatePath("/dashboard/inventory");
  revalidatePath("/dashboard/inventory/movements");
  revalidatePath("/dashboard/fulfillment/delivery");

  return gr;
}

async function retryInsufficientSos(orgId: string, userId: string, productIds: string[]) {
  // Find confirmed SOs with insufficient stock that contain any of the received products
  const affectedSoItems = await db
    .select({ salesOrderId: salesOrderItem.salesOrderId })
    .from(salesOrderItem)
    .innerJoin(salesOrder, eq(salesOrderItem.salesOrderId, salesOrder.id))
    .where(and(
      eq(salesOrder.organizationId, orgId),
      eq(salesOrder.status, "confirmed"),
      eq(salesOrder.stockReservationStatus, "insufficient"),
      inArray(salesOrderItem.productId, productIds),
    ));

  const soIds = [...new Set(affectedSoItems.map((r) => r.salesOrderId))];
  for (const soId of soIds) {
    try {
      await performStockCheckAndReserve(orgId, userId, soId);
    } catch {
      // Ignore — SO may still not have enough stock, that's fine
    }
  }
}

// Bidirectional: called after a normal receipt (may push confirmed -> fulfilled)
// and after a recall (may pull fulfilled back down to confirmed, since a
// recalled GR's items no longer count as received). Recalled GRs are
// excluded from the received-qty sum entirely either way.
async function syncPoFulfillmentStatus(purchaseOrderId: string, orgId: string) {
  const poItems = await db
    .select()
    .from(purchaseOrderItem)
    .where(eq(purchaseOrderItem.purchaseOrderId, purchaseOrderId));

  if (poItems.length === 0) return;

  const activeGrs = await db
    .select({ id: goodsReceipt.id })
    .from(goodsReceipt)
    .where(and(
      eq(goodsReceipt.purchaseOrderId, purchaseOrderId),
      eq(goodsReceipt.organizationId, orgId),
      ne(goodsReceipt.status, "recalled"),
    ));

  const grIds = activeGrs.map((g) => g.id);
  const allGrItems = grIds.length > 0
    ? await db.select().from(goodsReceiptItem).where(inArray(goodsReceiptItem.goodsReceiptId, grIds))
    : [];

  // Sum received qty per PO item
  const receivedByPoItemId: Record<string, number> = {};
  for (const grItem of allGrItems) {
    if (grItem.purchaseOrderItemId) {
      receivedByPoItemId[grItem.purchaseOrderItemId] =
        (receivedByPoItemId[grItem.purchaseOrderItemId] ?? 0) + parseFloat(grItem.qtyReceived ?? "0");
    }
  }

  const allFulfilled = poItems.every((item) => {
    const received = receivedByPoItemId[item.id] ?? 0;
    const ordered = parseFloat(item.qty ?? "0");
    return received >= ordered;
  });

  const [po] = await db.select({ status: purchaseOrder.status }).from(purchaseOrder).where(eq(purchaseOrder.id, purchaseOrderId));
  if (allFulfilled && po?.status === "confirmed") {
    await db.update(purchaseOrder).set({ status: "fulfilled" }).where(eq(purchaseOrder.id, purchaseOrderId));
  } else if (!allFulfilled && po?.status === "fulfilled") {
    await db.update(purchaseOrder).set({ status: "confirmed" }).where(eq(purchaseOrder.id, purchaseOrderId));
  }
}

// Owner-only. Reverses the stock this GR put in (one STOCK_OUT movement per
// line that originally fed stock), reopens the source packing list for
// correction if there was one, and drops the PO back to "confirmed" if this
// GR had auto-fulfilled it — then marks the GR itself "recalled" rather than
// deleting it, so there's still a record of what happened. Blocked if
// reversing would take any product negative — createApprovedMovement
// already enforces that for every STOCK_OUT, so a partially-consumed
// recall fails atomically before any movement is written, not halfway
// through. Does NOT attempt to unwind the weighted-average stockLevel.unitCost
// or the product.costUnitPrice this GR set — those are lossy to invert
// precisely and reversing them isn't safe to automate.
export async function recallGoodsReceipt(id: string): Promise<void> {
  const { orgId, userId } = await requireOwner();

  const [gr] = await db
    .select()
    .from(goodsReceipt)
    .where(and(eq(goodsReceipt.id, id), eq(goodsReceipt.organizationId, orgId)));
  if (!gr) throw new Error("Goods receipt not found");
  if (gr.status === "recalled") throw new Error("This goods receipt has already been recalled");

  const [po] = await db.select().from(purchaseOrder).where(eq(purchaseOrder.id, gr.purchaseOrderId));

  let warehouseLabel = "Default";
  if (po?.purchaseRequisitionId) {
    const [pr] = await db
      .select({ prType: purchaseRequisition.prType })
      .from(purchaseRequisition)
      .where(eq(purchaseRequisition.id, po.purchaseRequisitionId));
    if (pr?.prType === "sample_demo") warehouseLabel = "Demo";
  }

  const items = await db.select().from(goodsReceiptItem).where(eq(goodsReceiptItem.goodsReceiptId, id));
  const stockQty = (item: GoodsReceiptItemRow) =>
    item.qtyGood !== null ? (parseFloat(item.qtyGood) || 0) : (parseFloat(item.qtyReceived) || 0);
  const poRef = po?.poNo ?? po?.prNo ?? gr.purchaseOrderId;

  for (const item of items) {
    if (item.productId && stockQty(item) > 0) {
      await createApprovedMovement({
        orgId,
        userId,
        productId: item.productId,
        warehouseLabel,
        movementType: MOVEMENT_TYPE.STOCK_OUT,
        quantity: stockQty(item),
        referenceType: REF_TYPE.PURCHASE_ORDER,
        referenceId: gr.id,
        referenceNo: gr.grNo,
        notes: `Recall of ${gr.grNo} · PO ${poRef}: ${item.productCode ?? ""}`.trim(),
      });
    }
  }

  if (gr.packingListId) {
    await db.update(packingList).set({ status: "pending" }).where(eq(packingList.id, gr.packingListId));
  }

  await db.update(goodsReceipt).set({ status: "recalled" }).where(eq(goodsReceipt.id, id));
  await syncPoFulfillmentStatus(gr.purchaseOrderId, orgId);

  revalidatePath("/dashboard/procurement/goods-receipt");
  revalidatePath(`/dashboard/procurement/goods-receipt/${id}`);
  revalidatePath(`/dashboard/procurement/purchase-order/${gr.purchaseOrderId}`);
  if (gr.packingListId) {
    revalidatePath("/dashboard/procurement/packing-list");
    revalidatePath(`/dashboard/procurement/packing-list/${gr.packingListId}`);
  }
  revalidatePath("/dashboard/inventory");
  revalidatePath("/dashboard/inventory/movements");
}

// Owner-only, and only once a GR has already been recalled — permanently
// removes the record. goodsReceiptItem cascades with it.
export async function deleteGoodsReceipt(id: string): Promise<void> {
  const { orgId } = await requireOwner();

  const [gr] = await db
    .select()
    .from(goodsReceipt)
    .where(and(eq(goodsReceipt.id, id), eq(goodsReceipt.organizationId, orgId)));
  if (!gr) throw new Error("Goods receipt not found");
  if (gr.status !== "recalled") throw new Error("Only a recalled goods receipt can be deleted — recall it first");

  await db.delete(goodsReceipt).where(eq(goodsReceipt.id, id));

  revalidatePath("/dashboard/procurement/goods-receipt");
  revalidatePath(`/dashboard/procurement/purchase-order/${gr.purchaseOrderId}`);
}
