// A set can carry one price for the whole set instead of a price per item.
// The set's total is booked on the FIRST item of the set (position-based, so
// reordering rows in the review screen stays correct); every other item of the
// set contributes 0. This keeps every existing "sum of item totals" correct
// (subtotal, set header totals, PDFs). Items of a priced set hide their own
// unit price / total when displayed.

type SetPriceFields = {
  setGroupId?: string | null;
  setQty?: string | null;
  setPrice?: string | null;
};

/** Numeric set price (per ONE set), 0 when the item has none. */
export function setPriceValue(item: Pick<SetPriceFields, "setPrice">): number {
  const n = Number(String(item.setPrice ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** True when the item belongs to a set that is priced as a whole. */
export function isSetPriced(item: SetPriceFields): boolean {
  return !!item.setGroupId && setPriceValue(item) > 0;
}

/**
 * Per-item line totals (per single global set). Items of a priced set get
 * `setPrice × setQty` on the first item and 0 on the rest; all other items use
 * `calcLine`.
 */
export function lineTotalsWithSetPrice<T extends SetPriceFields>(
  items: T[],
  calcLine: (item: T) => number,
): number[] {
  const seen = new Set<string>();
  return items.map((item) => {
    if (!isSetPriced(item)) return calcLine(item);
    const gid = item.setGroupId as string;
    if (seen.has(gid)) return 0;
    seen.add(gid);
    return setPriceValue(item) * Number(item.setQty ?? 1);
  });
}
