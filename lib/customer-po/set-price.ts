// A quotation can price a whole set with one lump sum (set price × number of sets) instead of a price per item.
// The Customer PO keeps that price on the lines of the set, so its amount is the lump sum, not 0.
// Same convention as the quotation: the set's total is booked on the FIRST line of the set, the others carry 0.
import { isSetPriced, setPriceValue } from "@/lib/quotation-set-price";

type Line = {
  included: boolean;
  totalPrice: string;
  setGroupId?: string | null;
  setQty?: string | null;
  setPrice?: string | null;
};

const sets = (i: Pick<Line, "setQty">) => parseFloat(i.setQty || "1") || 1;
const lump = (i: Line) => setPriceValue(i) * sets(i);

/** The amount of the ticked lines: a priced set counts once as its lump sum, other lines by their own total. */
export function sumLines(items: Line[]): string {
  const seen = new Set<string>();
  return items
    .filter((i) => i.included)
    .reduce((s, i) => {
      if (isSetPriced(i)) {
        if (seen.has(i.setGroupId as string)) return s;
        seen.add(i.setGroupId as string);
        return s + lump(i);
      }
      return s + (parseFloat(i.totalPrice) || 0);
    }, 0)
    .toFixed(2);
}

/** The total of one set (all sets together), for its header row. */
export function setTotal(items: Line[], groupId: string): number {
  const mine = items.filter((i) => i.setGroupId === groupId && i.included);
  if (mine.length === 0) return 0;
  if (isSetPriced(mine[0])) return lump(mine[0]);
  return mine.reduce((s, i) => s + (parseFloat(i.totalPrice) || 0), 0);
}

/** The ticked lines with the lump sum of each priced set booked on its first line and 0 on the others (for saving). */
export function bookSetPrices<T extends Line>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.map((i) => {
    if (!i.included || !isSetPriced(i)) return i;
    const gid = i.setGroupId as string;
    if (seen.has(gid)) return { ...i, totalPrice: "0.00" };
    seen.add(gid);
    return { ...i, totalPrice: lump(i).toFixed(2) };
  });
}
