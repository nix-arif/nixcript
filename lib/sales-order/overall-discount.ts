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
  /**
   * The quotation's full subtotal. When given, a fixed amount is shared out by the part of the
   * quotation being ordered (RM 500 off a RM 10,000 quotation, RM 4,000 ordered → RM 200).
   */
  subtotal?: string;
};

/**
 * The SO's overall discount, combined from the linked quotations.
 * - One quotation, or several sharing the same %: keep it as that %.
 * - Otherwise (a fixed amount, or different %s): a fixed RM total, where each
 *   quotation's % applies only to the lines that came from it, and a fixed amount
 *   is shared out by the part of the quotation ordered (when its subtotal is given).
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
    const sub = items
      .filter((it) => it.sourceQuotationId === q.id)
      .reduce((s, it) => s + (parseFloat(it.totalPrice ?? "0") || 0), 0);
    if (pcts[i] > 0) {
      total += (sub * pcts[i]) / 100;
    } else if (fixed[i] > 0) {
      const full = parseFloat(q.subtotal ?? "") || 0;
      total += full > 0 ? fixed[i] * Math.min(1, sub / full) : fixed[i];
    }
  });
  return { mode: "fixed", pct: "0", amt: total.toFixed(2) };
}

/** The overall discount saved on a CPO, if it was saved with one (older CPOs have none recorded). */
export function cpoDiscount(c: { overallDiscountPct?: string | null; overallDiscountAmt?: string | null }): {
  discountPct?: string;
  discountAmt?: string;
} {
  if (c.overallDiscountPct == null && c.overallDiscountAmt == null) return {};
  return { discountPct: c.overallDiscountPct ?? "0", discountAmt: c.overallDiscountAmt ?? "0" };
}
