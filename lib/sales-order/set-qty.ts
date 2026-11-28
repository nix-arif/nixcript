// A Sales Order line inside a set is priced and counted for ONE set; the set carries how many
// sets are ordered (setQty). What is actually bought, reserved, delivered and invoiced is the
// line's quantity × the number of sets. Lines outside a set are their own quantity.

type SoLine = { qty?: string | null; setGroupId?: string | null; setQty?: string | null };

/** Number of sets a line's set is ordered in (1 outside a set). */
export function soLineSets(i: Pick<SoLine, "setGroupId" | "setQty">): number {
  if (!i.setGroupId) return 1;
  const n = parseFloat(i.setQty || "1");
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/** The line's real quantity: qty × the number of sets. */
export function soLineQty(i: SoLine): number {
  return (parseFloat(i.qty ?? "1") || 0) * soLineSets(i);
}

/** soLineQty as a string, keeping whole numbers whole ("7", not "7.00"). */
export function soLineQtyText(i: SoLine): string {
  const q = soLineQty(i);
  return Number.isInteger(q) ? String(q) : q.toFixed(2);
}

// ── PR lines ───────────────────────────────────────────────────────────────────────────────────
// A PR line is always the TOTAL to buy. A PR line in a set keeps its set's name and how many sets the
// sales order has (setQty), only to show "MAJOR GENERAL SET (2 sets)": nothing multiplies by it, so a
// buyer can ask for any total (3 pcs of a line that is 1 per set).

/** A PR line's quantity: the total (never × its set's count). */
export function prLineQty(i: { qty?: string | null }): number {
  return parseFloat(i.qty ?? "0") || 0;
}
