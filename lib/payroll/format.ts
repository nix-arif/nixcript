// Accounting number format: thousands separators, two decimals, negatives in
// brackets, zero as a dash. Pair with right-aligned tabular-nums cells.
export function acc(v: string | number | null | undefined): string {
  const n = Number(v ?? 0) || 0;
  if (Math.abs(n) < 0.005) return "–";
  const s = Math.abs(n).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? `(${s})` : s;
}
