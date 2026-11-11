// Deliberately NOT a "use server" file: takes no auth of its own and must
// never be callable from the client — only invoked from already-authorised
// actions (server/goods-receipt.ts, server/packing-list.ts).
import { db } from "@/db";
import { goodsReceipt, goodsReceiptItem, purchaseOrder, purchaseOrderItem, salesOrder, salesOrderItem } from "@/db/schema";
import { performStockCheckAndReserve } from "@/server/stock-reservation";
import { and, eq, inArray, ne } from "drizzle-orm";

// Bidirectional: called after a normal receipt (may push confirmed -> fulfilled)
// and after a recall or amendment (may pull fulfilled back down to confirmed,
// since a recalled GR's items no longer count as received). Recalled GRs are
// excluded from the received-qty sum entirely either way.
export async function syncPoFulfillmentStatus(purchaseOrderId: string, orgId: string) {
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

  // Sum accepted qty per PO item — qtyGood, not qtyReceived, so a line
  // returned to the supplier doesn't count as fulfilling the PO (it was
  // never actually kept). Falls back to qtyReceived for the plain direct-GR
  // flow, which has no inspection split (qtyGood is null there).
  const receivedByPoItemId: Record<string, number> = {};
  for (const grItem of allGrItems) {
    if (grItem.purchaseOrderItemId) {
      const accepted = parseFloat(grItem.qtyGood ?? grItem.qtyReceived ?? "0") || 0;
      receivedByPoItemId[grItem.purchaseOrderItemId] =
        (receivedByPoItemId[grItem.purchaseOrderItemId] ?? 0) + accepted;
    }
  }

  const allFulfilled = poItems.every((item) => {
    if (item.shortfallClosedStatus) return true;
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

// After stock comes IN for these products (a receipt, or an amendment that
// raised the accepted qty), re-try reserving stock for confirmed SOs that
// were short of any of them. An SO that still can't be covered is left as is.
export async function retryInsufficientSalesOrders(orgId: string, userId: string, productIds: string[]) {
  if (productIds.length === 0) return;
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
