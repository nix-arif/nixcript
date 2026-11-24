// Stock check for a Sales Order — no session or org checks of its own, so it
// is NOT a server action (this file has no "use server"): callers must have
// authorized access to orgId already. Lives here rather than in
// server/stock-reservation.ts so code that legitimately works on a different
// org than the caller's active one (the intercompany SO created in the
// receiving org — see maybeCreateIntercompanySalesOrder) can use it; anything
// exported from a "use server" file is a public, client-callable action.

import { db } from "@/db";
import { salesOrderItem, stockLevel, product } from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";

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

export async function computeStockCheckItems(orgId: string, soId: string) {
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

// Initial status for an SO: "pending-do" when every tracked item is in stock,
// "pending-pr" when something is short or can't be stock-checked at all.
export async function soStockStatusFor(orgId: string, soId: string): Promise<"pending-do" | "pending-pr"> {
  const { productItems, result, hasUnresolvableItems } = await computeStockCheckItems(orgId, soId);
  if (productItems.length === 0) {
    return hasUnresolvableItems ? "pending-pr" : "pending-do";
  }
  return result.every((r) => r.shortage === 0) ? "pending-do" : "pending-pr";
}
