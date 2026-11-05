// Server-side helpers for return-replacement attempts. Deliberately NOT a
// "use server" file: these take no auth of their own and must never be callable
// from the client — they're only invoked from already-authorised actions in
// server/packing-list.ts and server/goods-receipt.ts.
import { db } from "@/db";
import { returnReplacementAttempt, goodsReceiptItem, goodsReceipt, packingListItem } from "@/db/schema";
import { and, asc, eq, inArray, like, ne } from "drizzle-orm";
import { nanoid } from "nanoid";

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

  // A packing list never replaces units it rejected itself (its own receipts
  // are created from this very inspection), so such links are ignored.
  const attempts = (await db
    .select({ attempt: returnReplacementAttempt, sourcePackingListId: goodsReceipt.packingListId })
    .from(returnReplacementAttempt)
    .innerJoin(goodsReceiptItem, eq(returnReplacementAttempt.goodsReceiptItemId, goodsReceiptItem.id))
    .innerJoin(goodsReceipt, eq(goodsReceiptItem.goodsReceiptId, goodsReceipt.id))
    .where(and(inArray(returnReplacementAttempt.packingListItemId, lines.map((l) => l.id)), eq(returnReplacementAttempt.status, "linked")))
    .orderBy(asc(returnReplacementAttempt.createdAt)))
    .filter((r) => r.sourcePackingListId !== packingListId)
    .map((r) => r.attempt);
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

  for (const returnId of touchedReturns) await closeReturnIfCovered(returnId, userId, packingListId, now);
}

// Closes a return as "replacement" once the good units across its inspected
// attempts cover the returned qty — but only after the rejected units have
// physically gone back to the supplier; until then the return stays open so
// the hand-back isn't forgotten. Called at inspection time and again when the
// return is marked sent back (whichever happens last triggers the close).
export async function closeReturnIfCovered(returnId: string, userId: string, packingListId?: string, now = new Date()): Promise<boolean> {
  const [ret] = await db
    .select({ qtyReturn: goodsReceiptItem.qtyReturn, returnStatus: goodsReceiptItem.returnStatus, shippedAt: goodsReceiptItem.returnShippedAt })
    .from(goodsReceiptItem)
    .where(eq(goodsReceiptItem.id, returnId));
  if (!ret || ret.returnStatus !== "pending" || !ret.shippedAt) return false;
  const all = await db
    .select({ qtyGood: returnReplacementAttempt.qtyGood, status: returnReplacementAttempt.status, packingListItemId: returnReplacementAttempt.packingListItemId })
    .from(returnReplacementAttempt)
    .where(eq(returnReplacementAttempt.goodsReceiptItemId, returnId))
    .orderBy(asc(returnReplacementAttempt.attemptNo));
  const inspected = all.filter((x) => x.status === "inspected");
  const goodTotal = inspected.reduce((s, x) => s + num(x.qtyGood), 0);
  if (goodTotal + 1e-9 < num(ret.qtyReturn)) return false;

  let plId = packingListId;
  if (!plId && inspected.length > 0) {
    const [l] = await db.select({ plId: packingListItem.packingListId }).from(packingListItem).where(eq(packingListItem.id, inspected[inspected.length - 1].packingListItemId));
    plId = l?.plId;
  }
  await db
    .update(goodsReceiptItem)
    .set({
      returnStatus: "resolved",
      returnResolvedBy: userId,
      returnResolvedAt: now,
      returnResolutionType: "replacement",
      returnResolutionPackingListId: plId ?? null,
      returnResolutionNotes: `Closed automatically after ${all.length} replacement attempt${all.length !== 1 ? "s" : ""}`,
    })
    .where(and(eq(goodsReceiptItem.id, returnId), eq(goodsReceiptItem.returnStatus, "pending")));
  return true;
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

// Runs when a packing list is created. Every line for a PO item that still has
// rejected units waiting to go back is, by definition, the make-good for them
// (the create page already shows that to the user), so the link is recorded
// here instead of making the inspector re-enter it. Units are handed to the
// oldest return first, capped by what the return still lacks and by the line's
// own qty. Replacements arriving under a different PO still go through the
// manual picker on the inspect page; any auto link can be removed there too.
export async function autoLinkReplacementsForPackingList(packingListId: string, orgId: string, userId: string): Promise<number> {
  const lines = await db
    .select({ id: packingListItem.id, purchaseOrderItemId: packingListItem.purchaseOrderItemId, qtyExpected: packingListItem.qtyExpected })
    .from(packingListItem)
    .where(eq(packingListItem.packingListId, packingListId))
    .orderBy(asc(packingListItem.rowNo));
  const poItemIds = [...new Set(lines.map((l) => l.purchaseOrderItemId))];
  if (poItemIds.length === 0) return 0;

  const returns = await db
    .select({ id: goodsReceiptItem.id, purchaseOrderItemId: goodsReceiptItem.purchaseOrderItemId, qtyReturn: goodsReceiptItem.qtyReturn, inspectedAt: goodsReceiptItem.inspectedAt })
    .from(goodsReceiptItem)
    .innerJoin(goodsReceipt, eq(goodsReceiptItem.goodsReceiptId, goodsReceipt.id))
    .where(and(
      eq(goodsReceipt.organizationId, orgId),
      ne(goodsReceipt.status, "recalled"),
      eq(goodsReceiptItem.returnStatus, "pending"),
      inArray(goodsReceiptItem.purchaseOrderItemId, poItemIds),
    ))
    .orderBy(asc(goodsReceiptItem.inspectedAt));
  if (returns.length === 0) return 0;

  const existing = await db.select().from(returnReplacementAttempt).where(inArray(returnReplacementAttempt.goodsReceiptItemId, returns.map((r) => r.id)));
  const uncovered = new Map<string, number>();
  const attemptCount = new Map<string, number>();
  for (const r of returns) {
    const mine = existing.filter((a) => a.goodsReceiptItemId === r.id);
    const covered = mine.reduce((sum, a) => sum + (a.status === "inspected" ? num(a.qtyGood) : num(a.qtyAllocated)), 0);
    uncovered.set(r.id, Math.max(0, num(r.qtyReturn) - covered));
    attemptCount.set(r.id, mine.length);
  }

  const rows: (typeof returnReplacementAttempt.$inferInsert)[] = [];
  for (const line of lines) {
    let lineLeft = num(line.qtyExpected);
    for (const r of returns) {
      if (lineLeft <= 1e-9) break;
      if (r.purchaseOrderItemId !== line.purchaseOrderItemId) continue;
      const take = Math.min(lineLeft, uncovered.get(r.id) ?? 0);
      if (take <= 1e-9) continue;
      lineLeft -= take;
      uncovered.set(r.id, (uncovered.get(r.id) ?? 0) - take);
      const n = (attemptCount.get(r.id) ?? 0) + 1;
      attemptCount.set(r.id, n);
      rows.push({ id: nanoid(), organizationId: orgId, goodsReceiptItemId: r.id, packingListItemId: line.id, attemptNo: n, qtyAllocated: String(take), createdBy: userId });
    }
  }
  if (rows.length > 0) await db.insert(returnReplacementAttempt).values(rows);
  return rows.length;
}
