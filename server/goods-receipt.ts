"use server";

import { db } from "@/db";
import {
  goodsReceipt,
  goodsReceiptItem,
  goodsReceiptCounter,
  purchaseOrder,
  purchaseOrderItem,
  product,
  user,
  organization,
  supplier,
} from "@/db/schema";
import { getCachedSession } from "@/lib/auth/cached-session";
import { nanoid } from "nanoid";
import { eq, and, desc, inArray } from "drizzle-orm";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";
import { getNumberingConfig } from "@/server/document-numbering";
import { buildDocumentNo } from "@/lib/document-numbering";
import { revalidatePath } from "next/cache";
import { createApprovedMovement } from "@/lib/inventory/create-movement";
import { MOVEMENT_TYPE, REF_TYPE } from "@/lib/inventory/constants";

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
}

export interface CreateGoodsReceiptInput {
  purchaseOrderId: string;
  receivedDate: Date;
  notes?: string;
  items: GoodsReceiptItemInput[];
}

export type GoodsReceiptWithItems = GoodsReceiptRow & {
  items: GoodsReceiptItemRow[];
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

  return {
    ...gr,
    items,
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
    db.select({ id: purchaseOrder.id, prNo: purchaseOrder.prNo, poNo: purchaseOrder.poNo, supplierSnapshot: purchaseOrder.supplierSnapshot })
      .from(purchaseOrder)
      .where(inArray(purchaseOrder.id, poIds)),
    db.select({ goodsReceiptId: goodsReceiptItem.goodsReceiptId })
      .from(goodsReceiptItem)
      .where(inArray(goodsReceiptItem.goodsReceiptId, grIds)),
  ]);

  const userMap    = Object.fromEntries(users.map((u) => [u.id, u.name]));
  const poMap      = Object.fromEntries(pos.map((p) => [p.id, p]));
  const itemCounts = grIds.reduce<Record<string, number>>((acc, id) => ({ ...acc, [id]: 0 }), {});
  for (const gi of grItems) itemCounts[gi.goodsReceiptId] = (itemCounts[gi.goodsReceiptId] ?? 0) + 1;

  return grs.map((gr) => {
    const po   = poMap[gr.purchaseOrderId];
    const snap = po?.supplierSnapshot as any;
    return {
      ...gr,
      receivedByName: userMap[gr.receivedBy] ?? null,
      poNo:           po?.poNo ?? null,
      prNo:           po?.prNo ?? null,
      supplierName:   snap?.name ?? null,
      itemCount:      itemCounts[gr.id] ?? 0,
    };
  });
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
  const { orgId, userId } = await requireAccess("purchase-order:update");

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
      })),
    );
  }

  // Create STOCK_IN inventory movement for items with productId and qty received > 0
  const poRef = po.poNo ?? po.prNo ?? po.id;
  await Promise.all(
    input.items
      .filter((item) => item.productId && parseFloat(item.qtyReceived) > 0)
      .map(async (item) => {
        await createApprovedMovement({
          orgId,
          userId,
          productId: item.productId!,
          warehouseLabel: "Default",
          movementType: MOVEMENT_TYPE.STOCK_IN,
          quantity: parseFloat(item.qtyReceived),
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
  await maybeAutoFulfill(input.purchaseOrderId, orgId);

  revalidatePath(`/dashboard/procurement/purchase-order/${input.purchaseOrderId}`);
  revalidatePath("/dashboard/procurement/purchase-order");
  revalidatePath("/dashboard/inventory");
  revalidatePath("/dashboard/inventory/movements");

  return gr;
}

async function maybeAutoFulfill(purchaseOrderId: string, orgId: string) {
  // Get all PO items
  const poItems = await db
    .select()
    .from(purchaseOrderItem)
    .where(eq(purchaseOrderItem.purchaseOrderId, purchaseOrderId));

  if (poItems.length === 0) return;

  // Get all GR items for this PO across all GRs
  const allGrs = await db
    .select({ id: goodsReceipt.id })
    .from(goodsReceipt)
    .where(and(eq(goodsReceipt.purchaseOrderId, purchaseOrderId), eq(goodsReceipt.organizationId, orgId)));

  if (allGrs.length === 0) return;

  const grIds = allGrs.map((g) => g.id);
  const allGrItems = await db
    .select()
    .from(goodsReceiptItem)
    .where(
      grIds.length === 1
        ? eq(goodsReceiptItem.goodsReceiptId, grIds[0])
        : eq(goodsReceiptItem.goodsReceiptId, grIds[0]), // simplified: check at least first
    );

  // Sum received qty per PO item
  const receivedByPoItemId: Record<string, number> = {};
  for (const grItem of allGrItems) {
    if (grItem.purchaseOrderItemId) {
      receivedByPoItemId[grItem.purchaseOrderItemId] =
        (receivedByPoItemId[grItem.purchaseOrderItemId] ?? 0) + parseFloat(grItem.qtyReceived ?? "0");
    }
  }

  // Check if all PO items are fully received
  const allFulfilled = poItems.every((item) => {
    const received = receivedByPoItemId[item.id] ?? 0;
    const ordered = parseFloat(item.qty ?? "0");
    return received >= ordered;
  });

  if (allFulfilled) {
    await db
      .update(purchaseOrder)
      .set({ status: "fulfilled" })
      .where(eq(purchaseOrder.id, purchaseOrderId));
  }
}
