"use server";

import { db } from "@/db";
import { salesOrder, salesOrderItem, stockLevel, product } from "@/db/schema";
import { eq, and, inArray, desc } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getCachedSession } from "@/lib/auth/cached-session";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";
import { adjustReservation } from "@/lib/inventory/create-movement";

async function requireAccess(permission: string) {
  const session = await getCachedSession();
  if (!session) throw new Error("You must be signed in to continue");
  const orgId = session.session.activeOrganizationId;
  if (!orgId) throw new Error("No active organization");
  const userId = session.user.id;
  const perms = await getUserPermissions(userId, orgId);
  if (!hasAccess(perms, permission)) throw new Error("You don't have permission to do this");
  return { orgId, userId };
}

export interface StockCheckItem {
  productId: string;
  productCode: string | null;
  description: string | null;
  required: number;
  onHand: number;
  reserved: number;
  available: number;
  shortage: number;
}

export interface StockCheckResult {
  canReserve: boolean;
  items: StockCheckItem[];
}

async function computeStockCheckItems(orgId: string, soId: string) {
  const items = await db
    .select()
    .from(salesOrderItem)
    .where(eq(salesOrderItem.salesOrderId, soId));

  // Items can end up without a linked productId (e.g. imported from a CPO/quotation
  // whose code didn't match at the time). Resolve those by productCode against the
  // catalog and persist the link, so stock is actually checked instead of silently
  // skipped as "untracked".
  const unlinked = items.filter((i) => !i.productId && i.productCode);
  if (unlinked.length > 0) {
    const codes = [...new Set(unlinked.map((i) => i.productCode!))];
    const matches = await db
      .select({ id: product.id, productCode: product.productCode })
      .from(product)
      .where(and(eq(product.organizationId, orgId), inArray(product.productCode, codes)));
    const matchMap = new Map(matches.map((m) => [m.productCode, m.id]));

    for (const item of unlinked) {
      const matchedId = matchMap.get(item.productCode!);
      if (matchedId) {
        await db.update(salesOrderItem).set({ productId: matchedId }).where(eq(salesOrderItem.id, item.id));
        item.productId = matchedId;
      }
    }
  }

  // Items that still have a product code but no resolved productId belong to a
  // different org's catalog — they cannot be stock-checked and must block DO creation.
  const hasUnresolvableItems = items.some((i) => !i.productId && i.productCode);

  const productItems = items.filter((i) => i.productId);
  if (productItems.length === 0) return { productItems, result: [] as StockCheckItem[], hasUnresolvableItems };

  const productIds = [...new Set(productItems.map((i) => i.productId!))];
  const levels = await db
    .select()
    .from(stockLevel)
    .where(and(
      eq(stockLevel.organizationId, orgId),
      eq(stockLevel.warehouseLabel, "Default"),
      inArray(stockLevel.productId, productIds),
    ));

  const levelMap = new Map(levels.map((l) => [l.productId, l]));

  const result: StockCheckItem[] = productItems.map((item) => {
    const level = levelMap.get(item.productId!);
    const required = parseFloat(item.qty ?? "1");
    const onHand = level ? parseFloat(level.quantity) : 0;
    const reserved = level ? parseFloat(level.reservedQty) : 0;
    const available = Math.max(0, onHand - reserved);
    return {
      productId: item.productId!,
      productCode: item.productCode ?? null,
      description: item.description ?? null,
      required,
      onHand,
      reserved,
      available,
      shortage: Math.max(0, required - available),
    };
  });

  return { productItems, result, hasUnresolvableItems };
}

/**
 * Read-only stock insight for the SO detail page — never mutates reservedQty.
 */
export async function getStockInsight(soId: string): Promise<StockCheckResult> {
  const { orgId } = await requireAccess("delivery-order:create");

  const [so] = await db
    .select({ id: salesOrder.id })
    .from(salesOrder)
    .where(and(eq(salesOrder.id, soId), eq(salesOrder.organizationId, orgId)));
  if (!so) throw new Error("Sales order not found");

  const { result, hasUnresolvableItems } = await computeStockCheckItems(orgId, soId);
  return { canReserve: !hasUnresolvableItems && result.every((r) => r.shortage === 0), items: result };
}

export async function checkAndReserveStock(soId: string): Promise<StockCheckResult> {
  const { orgId, userId } = await requireAccess("delivery-order:create");
  return performStockCheckAndReserve(orgId, userId, soId);
}

/**
 * Core shortage-checked reservation logic, shared by the manual "Recheck"
 * action and the automatic attempt on SO approval. No permission check —
 * callers must already have verified the caller's access.
 */
export async function performStockCheckAndReserve(
  orgId: string,
  userId: string,
  soId: string,
): Promise<StockCheckResult> {
  const [so] = await db
    .select()
    .from(salesOrder)
    .where(and(eq(salesOrder.id, soId), eq(salesOrder.organizationId, orgId)));
  if (!so) throw new Error("Sales order not found");
  if (so.status !== "confirmed") throw new Error("Only confirmed sales orders can have stock reserved");
  if (so.stockReservationStatus === "reserved") throw new Error("Stock is already reserved for this sales order");

  const { productItems, result, hasUnresolvableItems } = await computeStockCheckItems(orgId, soId);

  // Items with product codes that couldn't be resolved to this org's catalog cannot
  // be stock-checked — treat as insufficient so DO is blocked until the catalog is linked.
  if (hasUnresolvableItems && productItems.length === 0) {
    await db
      .update(salesOrder)
      .set({ stockReservationStatus: "insufficient" })
      .where(eq(salesOrder.id, soId));
    return { canReserve: false, items: [] };
  }

  // Truly no trackable items (description-only, no product code) — allow DO
  if (productItems.length === 0) {
    await db
      .update(salesOrder)
      .set({ stockReservationStatus: "reserved", stockReservedAt: new Date(), stockReservedBy: userId })
      .where(eq(salesOrder.id, soId));
    return { canReserve: true, items: [] };
  }

  const canReserve = result.every((r) => r.shortage === 0);

  if (canReserve) {
    await Promise.all(
      productItems.map((item) =>
        adjustReservation({
          orgId,
          productId: item.productId!,
          warehouseLabel: "Default",
          delta: parseFloat(item.qty ?? "1"),
        }),
      ),
    );
    await db
      .update(salesOrder)
      .set({ stockReservationStatus: "reserved", stockReservedAt: new Date(), stockReservedBy: userId })
      .where(eq(salesOrder.id, soId));
  } else {
    await db
      .update(salesOrder)
      .set({ stockReservationStatus: "insufficient" })
      .where(eq(salesOrder.id, soId));
  }

  return { canReserve, items: result };
}

/**
 * Re-checks every confirmed SO that is stuck in "insufficient" status.
 * Called from the delivery list page on load to catch SOs whose stock
 * arrived via GR before the auto-trigger was in place.
 */
export async function recheckAllInsufficientSos(): Promise<{ resolved: number }> {
  const { orgId, userId } = await requireAccess("delivery-order:create");

  const insufficientSos = await db
    .select({ id: salesOrder.id })
    .from(salesOrder)
    .where(and(
      eq(salesOrder.organizationId, orgId),
      eq(salesOrder.status, "confirmed"),
      eq(salesOrder.stockReservationStatus, "insufficient"),
    ))
    .orderBy(desc(salesOrder.createdAt));

  if (insufficientSos.length === 0) return { resolved: 0 };

  let resolved = 0;
  for (const so of insufficientSos) {
    try {
      const result = await performStockCheckAndReserve(orgId, userId, so.id);
      if (result.canReserve) resolved++;
    } catch {
      // Still insufficient — skip silently
    }
  }

  if (resolved > 0) {
    revalidatePath("/dashboard/fulfillment/delivery");
  }

  return { resolved };
}

/**
 * Pure read — determines whether an SO should be "pending-do" or "pending-pr"
 * based on current stock, without mutating reservedQty or stockReservationStatus.
 * Safe to call at creation time (after items have been inserted).
 */
export async function getSoStockStatus(orgId: string, soId: string): Promise<"pending-do" | "pending-pr"> {
  const session = await getCachedSession();
  if (!session) throw new Error("You must be signed in to continue");
  if (session.session.activeOrganizationId !== orgId) throw new Error("Unauthorized");

  const { productItems, result, hasUnresolvableItems } = await computeStockCheckItems(orgId, soId);
  if (productItems.length === 0) {
    return hasUnresolvableItems ? "pending-pr" : "pending-do";
  }
  return result.every((r) => r.shortage === 0) ? "pending-do" : "pending-pr";
}
