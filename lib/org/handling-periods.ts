// Supplier handling over time. A supplier can have several rules, each from a date (null = from the beginning);
// the one with the latest date on or before the document's date applies. Before the first date nothing applies.
// Plain functions, safe for client code. Dates are "YYYY-MM-DD" strings (business dates in Malaysia time).

export type PeriodRule = { effectiveFrom: string | null };

// today's business date (Malaysia), as YYYY-MM-DD
export const todayKL = (d: Date = new Date()) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" });

// a date in any form (Date, timestamp string) as a business date
export const toBusinessDate = (d: Date | string) => (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : todayKL(new Date(d)));

export function activeRule<T extends PeriodRule>(rules: T[], asOf: string): T | undefined {
  let best: T | undefined;
  for (const r of rules) {
    if (r.effectiveFrom !== null && r.effectiveFrom > asOf) continue; // not started yet
    if (!best || (best.effectiveFrom ?? "") < (r.effectiveFrom ?? "")) best = r;
  }
  return best;
}

export type PeriodStatus = "current" | "upcoming" | "past";

// where each rule of one supplier stands on a date
export function periodStatuses<T extends PeriodRule>(rules: T[], asOf: string): Map<T, PeriodStatus> {
  const active = activeRule(rules, asOf);
  const out = new Map<T, PeriodStatus>();
  for (const r of rules) out.set(r, r === active ? "current" : r.effectiveFrom !== null && r.effectiveFrom > asOf ? "upcoming" : "past");
  return out;
}

export const sortPeriods = <T extends PeriodRule>(rules: T[]) =>
  [...rules].sort((a, b) => (a.effectiveFrom ?? "").localeCompare(b.effectiveFrom ?? ""));

export const formatBusinessDate = (d: string | null) =>
  d ? new Date(`${d}T00:00:00`).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" }) : null;
