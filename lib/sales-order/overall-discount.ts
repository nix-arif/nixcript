// Overall (whole-order) discount on a Sales Order: either a % of the subtotal or a fixed RM amount.
//
// When an SO is built from quotations, each quotation brings its own overall discount
// (a % or a fixed "special discount"). These helpers carry them over so the SO total
// matches what the customer was quoted.

export type DiscountMode = "pct" | "fixed";

export type OverallDiscount = { mode: DiscountMode; pct: string; amt: string };

export const NO_DISCOUNT: OverallDiscount = { mode: "pct", pct: "0", amt: "0" };

/** RM amount the overall discount takes off the subtotal. */
export function overallDiscountAmount(subtotal: number, d: OverallDiscount): number {
  if (d.mode === "fixed") return Math.max(0, parseFloat(d.amt) || 0);
  return (subtotal * (parseFloat(d.pct) || 0)) / 100;
}

/** How an existing SO's saved discount should show in the editor. */
export function discountFromSaved(pct: string | null | undefined, amt: string | null | undefined): OverallDiscount {
  if ((parseFloat(pct ?? "0") || 0) > 0) return { mode: "pct", pct: pct!, amt: "0" };
  if ((parseFloat(amt ?? "0") || 0) > 0) return { mode: "fixed", pct: "0", amt: amt! };
  return NO_DISCOUNT;
}

export type QuotationDiscount = {
  id: string;
  /** Overall discount % on the quotation ("0" when it used a fixed amount) */
  discountPct: string;
  /** Overall discount RM on the quotation (the fixed amount, or what its % came to) */
  discountAmt: string;
};

/**
 * The SO's overall discount, combined from the linked quotations.
 * - One quotation, or several sharing the same %: keep it as that %.
 * - Otherwise (a fixed amount, or different %s): a fixed RM total, where each
 *   quotation's % applies only to the SO lines that came from it.
 */
export function discountFromQuotations(
  items: { sourceQuotationId?: string | null; totalPrice?: string | null }[],
  quotations: QuotationDiscount[],
): OverallDiscount {
  const pcts = quotations.map((q) => parseFloat(q.discountPct) || 0);
  const fixed = quotations.map((q, i) => (pcts[i] > 0 ? 0 : parseFloat(q.discountAmt) || 0));
  const anyFixed = fixed.some((a) => a > 0);
  const discounting = pcts.filter((p) => p > 0);

  if (!anyFixed && discounting.length === 0) return NO_DISCOUNT;
  if (!anyFixed && discounting.length === quotations.length && pcts.every((p) => p === pcts[0])) {
    return { mode: "pct", pct: String(pcts[0]), amt: "0" };
  }

  let total = 0;
  quotations.forEach((q, i) => {
    if (pcts[i] > 0) {
      const sub = items
        .filter((it) => it.sourceQuotationId === q.id)
        .reduce((s, it) => s + (parseFloat(it.totalPrice ?? "0") || 0), 0);
      total += (sub * pcts[i]) / 100;
    } else {
      total += fixed[i];
    }
  });
  return { mode: "fixed", pct: "0", amt: total.toFixed(2) };
}
