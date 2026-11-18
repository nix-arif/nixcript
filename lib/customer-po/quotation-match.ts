// Suggests which of our quotations a customer's PO document belongs to, from the text of the document.
// It looks for: our quotation number (the strongest sign), the customer's name, our product codes and descriptions,
// and the total. It only suggests; the user decides which quotation to link.

export type MatchCandidate = {
  id: string;
  quotationNo: string;
  grandTotal: string | null;
  customerName: string | null;
  orgNames: string[];
  items: { productCode?: string | null; description?: string | null }[];
  cpoCount: number;
};

export type Suggestion = {
  id: string;
  quotationNo: string;
  customerName: string | null;
  grandTotal: string | null;
  score: number;
  level: "very-likely" | "possible";
  reasons: string[];
  itemHits: number;
  itemTotal: number;
  refFound: boolean;
  amountMatch: boolean;
  customerFound: boolean;
  cpoCount: number;
};

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export const alnum = (s: string | null | undefined) => (s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

// our quotation number, however the customer typed the separators ("AFF-QT-2026-0197", "AFF QT 2026 0197"), and not
// just the start of a longer one: "…-0197" must not be found inside "…-0197-R1"
export function textHasQuotationNo(text: string, no: string): boolean {
  const groups = no.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
  if (groups.length === 0) return false;
  const sep = "[\\s\\-_/.]*";
  const re = new RegExp(`(?<![A-Z0-9])${groups.map(escapeRe).join(sep)}(?![A-Z0-9])(?![\\s\\-_/.]*R\\d)`, "i");
  return re.test(text.toUpperCase());
}

// every number in the text as "1542.00" ("1,542.00", "1542" and "1 542.00" all give the same)
export function numbersIn(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(/\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g)) {
    const v = parseFloat(m[0].replace(/,/g, ""));
    if (Number.isFinite(v)) out.add(v.toFixed(2));
  }
  return out;
}

export const totalAppears = (nums: Set<string>, grandTotal: string | null | undefined) => {
  const v = parseFloat(String(grandTotal ?? "").replace(/,/g, ""));
  return Number.isFinite(v) && v > 0 && nums.has(v.toFixed(2));
};

// the customer: the organization's name, or the contact's full name
export function customerAppears(text: string, c: Pick<MatchCandidate, "customerName" | "orgNames">): { org: boolean; person: boolean } {
  const t = alnum(text);
  const org = c.orgNames.some((o) => alnum(o).length >= 6 && t.includes(alnum(o)));
  const person = !!c.customerName && alnum(c.customerName).length >= 6 && t.includes(alnum(c.customerName));
  return { org, person };
}

// how many of the quotation's items are on the document: by product code (as a whole word), else by the start of the description
export function itemHits(text: string, items: MatchCandidate["items"]): number {
  const upper = text.toUpperCase();
  const t = alnum(text);
  let hits = 0;
  for (const it of items) {
    const code = (it.productCode ?? "").trim().toUpperCase();
    let hit = false;
    if (code.length >= 3) hit = new RegExp(`(?<![A-Z0-9])${escapeRe(code)}(?![A-Z0-9])`).test(upper);
    if (!hit) {
      const d = alnum(it.description).slice(0, 28);
      hit = d.length >= 16 && t.includes(d);
    }
    if (hit) hits++;
  }
  return hits;
}

// cheap signals only (no items): enough to decide which quotations are worth a closer look
export function quickSignals(text: string, nums: Set<string>, c: MatchCandidate) {
  const cust = customerAppears(text, c);
  return { ref: textHasQuotationNo(text, c.quotationNo), amount: totalAppears(nums, c.grandTotal), org: cust.org, person: cust.person };
}

export function scoreCandidate(text: string, nums: Set<string>, c: MatchCandidate): Suggestion | null {
  const sig = quickSignals(text, nums, c);
  const hits = itemHits(text, c.items);
  const total = c.items.length;
  const reasons: string[] = [];
  let score = 0;
  if (sig.ref) { score += 100; reasons.push("Our quotation number is on the document"); }
  if (total > 0 && hits > 0) { score += Math.round((40 * hits) / total); reasons.push(`${hits} of ${total} items are on the document`); }
  if (sig.amount) { score += 25; reasons.push("The total matches"); }
  if (sig.org) { score += 15; reasons.push("The customer's organization is on the document"); }
  if (sig.person) { score += 10; reasons.push("The contact's name is on the document"); }
  const ratio = total > 0 ? hits / total : 0;
  const veryLikely = sig.ref || (ratio >= 0.7 && (sig.amount || sig.org));
  if (!veryLikely && score < 30) return null;
  return {
    id: c.id, quotationNo: c.quotationNo, customerName: c.customerName, grandTotal: c.grandTotal, score,
    level: veryLikely ? "very-likely" : "possible", reasons, itemHits: hits, itemTotal: total,
    refFound: sig.ref, amountMatch: sig.amount, customerFound: sig.org || sig.person, cpoCount: c.cpoCount,
  };
}

export function rankSuggestions(text: string, candidates: MatchCandidate[], max = 5): Suggestion[] {
  const nums = numbersIn(text);
  return candidates
    .map((c) => scoreCandidate(text, nums, c))
    .filter((s): s is Suggestion => !!s)
    .sort((a, b) => b.score - a.score || a.quotationNo.localeCompare(b.quotationNo))
    .slice(0, max);
}

// ── the PO's own number and date, as a suggestion for the form ──────────────
export function extractPoNumber(text: string): string | null {
  const re = /(?:P\.?\s?O\.?\s*(?:No\.?|Number|#)|Purchase\s+Order\s*(?:No\.?|Number|#)?|Order\s*(?:No\.?|Number)|No\.?\s*Pesanan|Nombor\s+Pesanan)\s*[:#.\-]?\s*([A-Z0-9][A-Z0-9\-\/.]{4,29})/i;
  const m = re.exec(text);
  const v = m?.[1]?.replace(/[.\-\/]+$/, "") ?? "";
  // must look like a number: some digits, and not a word such as "Number"
  return /\d{3,}/.test(v) ? v : null;
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, mei: 5, jun: 6, jul: 7, aug: 8, ogos: 8, sep: 9, oct: 10, okt: 10, nov: 11, dec: 12, dis: 12 };
const iso = (y: number, m: number, d: number) => (y >= 2000 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` : null);

// the date next to a "Date" / "Tarikh" label (day first, as in Malaysia); else null
export function extractPoDate(text: string): string | null {
  const m = /(?:Date|Tarikh)\s*(?:of\s+Order)?\s*[:.\-]?\s*(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/i.exec(text);
  if (m) { const y = Number(m[3]); return iso(y < 100 ? 2000 + y : y, Number(m[2]), Number(m[1])); }
  const w = /(?:Date|Tarikh)\s*[:.\-]?\s*(\d{1,2})\s+([A-Za-z]{3,9})\.?\s+(\d{4})/i.exec(text);
  if (w) { const mo = MONTHS[w[2].slice(0, 3).toLowerCase()]; return mo ? iso(Number(w[3]), mo, Number(w[1])) : null; }
  const s = /(?:Date|Tarikh)\s*[:.\-]?\s*(\d{4})-(\d{2})-(\d{2})/i.exec(text);
  return s ? iso(Number(s[1]), Number(s[2]), Number(s[3])) : null;
}
