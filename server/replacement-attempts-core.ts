// Server-side helpers for return-replacement attempts. Deliberately NOT a
// "use server" file: these take no auth of their own and must never be callable
// from the client — they're only invoked from already-authorised actions in
// server/packing-list.ts and server/goods-receipt.ts.
import { db } from "@/db";
import { returnReplacementAttempt, goodsReceiptItem, packingListItem } from "@/db/schema";
import { and, asc, eq, inArray, like } from "drizzle-orm";

const num = (v: string | null | undefined) => parseFloat(v ?? "0") || 0;

// Called right after a packing list's inspection is completed. Each linked
// attempt gets its good/failed split, then every affected return is closed IF
// the good units across all its attempts now cover what was returned.
// A line's good units are handed out to its attempts in the order they were
// linked (the line's own good qty = received - returned).
export async function settleAttemptsForPackingList(packingListId: string, userId: string): Promise<void> {
  const lines = await db
    .select({
      id: packingListItem.id,
      qtyExpected: packingListItem.qtyExpected,
      draftQtyReceived: packingListItem.draftQtyReceived,
      draftQtyReturn: packingListItem.draftQtyReturn,
    })
    .from(packingListItem)
    .where(eq(packingListItem.packingListId, packingListId));
  if (lines.length === 0) return;

  const attempts = await db
    .select()
    .from(returnReplacementAttempt)
    .where(and(inArray(returnReplacementAttempt.packingListItemId, lines.map((l) => l.id)), eq(returnReplacementAttempt.status, "linked")))
    .orderBy(asc(returnReplacementAttempt.createdAt));
  if (attempts.length === 0) return;

  const goodLeft = new Map<string, number>();
  for (const l of lines) {
    const received = num(l.draftQtyReceived ?? l.qtyExpected);
    goodLeft.set(l.id, Math.max(0, received - num(l.draftQtyReturn)));
  }

  const now = new Date();
  const touchedReturns = new Set<string>();
  for (const a of attempts) {
    const alloc = num(a.qtyAllocated);
    const avail = goodLeft.get(a.packingListItemId) ?? 0;
    const good = Math.min(alloc, avail);
    goodLeft.set(a.packingListItemId, avail - good);
    await db
      .update(returnReplacementAttempt)
      .set({ status: "inspected", qtyGood: String(good), qtyFailed: String(alloc - good), inspectedAt: now })
      .where(eq(returnReplacementAttempt.id, a.id));
    touchedReturns.add(a.goodsReceiptItemId);
  }

  for (const returnId of touchedReturns) {
    const [ret] = await db
      .select({ qtyReturn: goodsReceiptItem.qtyReturn, returnStatus: goodsReceiptItem.returnStatus })
      .from(goodsReceiptItem)
      .where(eq(goodsReceiptItem.id, returnId));
    if (!ret || ret.returnStatus !== "pending") continue;
    const all = await db
      .select({ qtyGood: returnReplacementAttempt.qtyGood, status: returnReplacementAttempt.status })
      .from(returnReplacementAttempt)
      .where(eq(returnReplacementAttempt.goodsReceiptItemId, returnId));
    const goodTotal = all.filter((x) => x.status === "inspected").reduce((s, x) => s + num(x.qtyGood), 0);
    if (goodTotal + 1e-9 >= num(ret.qtyReturn)) {
      await db
        .update(goodsReceiptItem)
        .set({
          returnStatus: "resolved",
          returnResolvedBy: userId,
          returnResolvedAt: now,
          returnResolutionType: "replacement",
          returnResolutionPackingListId: packingListId,
          returnResolutionNotes: `Closed automatically after ${all.length} replacement attempt${all.length !== 1 ? "s" : ""}`,
        })
        .where(and(eq(goodsReceiptItem.id, returnId), eq(goodsReceiptItem.returnStatus, "pending")));
    }
  }
}

// Undo of the above when a packing list's inspection is recalled: attempts go
// back to "linked", and returns that were auto-closed by this packing list
// reopen (manual resolutions with a different type are left alone).
export async function revertAttemptsForPackingList(packingListId: string): Promise<void> {
  const lines = await db.select({ id: packingListItem.id }).from(packingListItem).where(eq(packingListItem.packingListId, packingListId));
  if (lines.length === 0) return;
  const attempts = await db
    .select({ id: returnReplacementAttempt.id, goodsReceiptItemId: returnReplacementAttempt.goodsReceiptItemId })
    .from(returnReplacementAttempt)
    .where(and(inArray(returnReplacementAttempt.packingListItemId, lines.map((l) => l.id)), eq(returnReplacementAttempt.status, "inspected")));
  if (attempts.length === 0) return;
  await db
    .update(returnReplacementAttempt)
    .set({ status: "linked", qtyGood: null, qtyFailed: null, inspectedAt: null })
    .where(inArray(returnReplacementAttempt.id, attempts.map((a) => a.id)));
  await db
    .update(goodsReceiptItem)
    .set({ returnStatus: "pending", returnResolvedBy: null, returnResolvedAt: null, returnResolutionType: null, returnResolutionPackingListId: null, returnResolutionNotes: null })
    .where(and(
      inArray(goodsReceiptItem.id, [...new Set(attempts.map((a) => a.goodsReceiptItemId))]),
      eq(goodsReceiptItem.returnResolutionType, "replacement"),
      eq(goodsReceiptItem.returnResolutionPackingListId, packingListId),
      like(goodsReceiptItem.returnResolutionNotes, "Closed automatically%"),
    ));
}
