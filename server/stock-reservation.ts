"use server";

import { db } from "@/db";
import { salesOrder, salesOrderItem, stockLevel, product } from "@/db/schema";
import { eq, and, inArray, desc } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getCachedSession } from "@/lib/auth/cached-session";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";
import { adjustReservation } from "@/lib/inventory/create-movement";
import { computeStockCheckItems, soStockStatusFor, type StockCheckItem, type StockCheckResult } from "@/lib/inventory/so-stock-status";

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

export type { StockCheckItem, StockCheckResult } from "@/lib/inventory/so-stock-status";

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
  return soStockStatusFor(orgId, soId);
}
