// A Sales Order line's quantity and total are the TOTALS ordered, in a set or not. A line in a set keeps
// its set's name and how many sets the order has (setQty) only to show "MAJOR GENERAL SET (2 sets)":
// nothing multiplies by it. Customer PO and quotation lines are different: theirs are for ONE set, and
// are multiplied out when they become sales order lines (toSoTotalLine). PR lines are totals too.

type SoLine = { qty?: string | null };
type SetLine = { setGroupId?: string | null; setQty?: string | null };

/** How many sets a line's set is ordered in (1 outside a set). */
export function soLineSets(i: SetLine): number {
  if (!i.setGroupId) return 1;
  const n = parseFloat(i.setQty || "1");
  return Number.isFinite(n) && n > 0 ? n : 1;
}

const decimals = (n: number) => String(Number(n.toFixed(4)));

/**
 * A line priced and counted for one set (Customer PO, quotation) as a sales order line: its quantity
 * and amounts × the number of sets. The unit price is unchanged.
 */
export function toSoTotalLine<T extends SetLine & { qty?: string | number | null; totalPrice?: string | number | null; discountAmt?: string | number | null }>(i: T): T {
  const sets = soLineSets(i);
  if (sets === 1) return i;
  const times = (v: string | number) => (parseFloat(String(v)) || 0) * sets;
  return {
    ...i,
    qty: decimals(times(i.qty ?? 1)),
    ...(i.totalPrice != null && { totalPrice: times(i.totalPrice).toFixed(2) }),
    ...(i.discountAmt != null && { discountAmt: times(i.discountAmt).toFixed(2) }),
  };
}

/** A sales order line's quantity: the total (never × its set's count). */
export function soLineQty(i: SoLine): number {
  return parseFloat(i.qty ?? "1") || 0;
}

/** soLineQty as a string, keeping whole numbers whole ("7", not "7.00"). */
export function soLineQtyText(i: SoLine): string {
  const q = soLineQty(i);
  return Number.isInteger(q) ? String(q) : q.toFixed(2);
}

/** A PR line's quantity: the total, like a sales order line's. */
export function prLineQty(i: { qty?: string | null }): number {
  return parseFloat(i.qty ?? "0") || 0;
}
