"use server";

import { db } from "@/db";
import { salesOrder, salesOrderItem, stockLevel } from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
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

export async function checkAndReserveStock(soId: string): Promise<StockCheckResult> {
  const { orgId, userId } = await requireAccess("delivery-order:create");

  const [so] = await db
    .select()
    .from(salesOrder)
    .where(and(eq(salesOrder.id, soId), eq(salesOrder.organizationId, orgId)));
  if (!so) throw new Error("Sales order not found");
  if (so.status !== "confirmed") throw new Error("Only confirmed sales orders can have stock reserved");
  if (so.stockReservationStatus === "reserved") throw new Error("Stock is already reserved for this sales order");

  const items = await db
    .select()
    .from(salesOrderItem)
    .where(eq(salesOrderItem.salesOrderId, soId));

  const productItems = items.filter((i) => i.productId);

  // No trackable items — mark reserved immediately so DO can be created
  if (productItems.length === 0) {
    await db
      .update(salesOrder)
      .set({ stockReservationStatus: "reserved", stockReservedAt: new Date(), stockReservedBy: userId })
      .where(eq(salesOrder.id, soId));
    return { canReserve: true, items: [] };
  }

  const productIds = [...new Set(productItems.map((i) => i.productId!))];
  const levels = await db
    .select()
    .from(stockLevel)
    .where(and(eq(stockLevel.organizationId, orgId), inArray(stockLevel.productId, productIds)));

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

export async function releaseStockReservation(soId: string): Promise<void> {
  const { orgId } = await requireAccess("delivery-order:create");

  const [so] = await db
    .select()
    .from(salesOrder)
    .where(and(eq(salesOrder.id, soId), eq(salesOrder.organizationId, orgId)));
  if (!so || so.stockReservationStatus !== "reserved") return;

  const items = await db
    .select()
    .from(salesOrderItem)
    .where(eq(salesOrderItem.salesOrderId, soId));

  await Promise.all(
    items
      .filter((i) => i.productId)
      .map((i) =>
        adjustReservation({
          orgId,
          productId: i.productId!,
          warehouseLabel: "Default",
          delta: -parseFloat(i.qty ?? "1"),
        }),
      ),
  );

  await db
    .update(salesOrder)
    .set({ stockReservationStatus: null, stockReservedAt: null, stockReservedBy: null })
    .where(eq(salesOrder.id, soId));
}
