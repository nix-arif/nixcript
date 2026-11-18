// Suggests which of our quotations a customer's PO document belongs to, from the text of the document.
// It looks for: our quotation number (the strongest sign), the customer's name, our product codes and descriptions,
// and the total. It only suggests; the user decides which quotation to link.

export type MatchCandidate = {
  id: string;
  quotationNo: string;
  grandTotal: string | null;
  customerName: string | null;
  orgNames: string[];
  items: { productCode?: string | null; description?: string | null; unitPrice?: string | null }[];
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

const words = (s: string | null | undefined) => (s ?? "").toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);

// how many of the quotation's items are on the document: by product code (as a whole word), else by the start of a long
// description; and, when the document's numbers are given, by description AND unit price together (a government PO does
// not carry our codes, and the customer may mistype a word, so most of the words plus the same price is enough)
export function itemHits(text: string, items: MatchCandidate["items"], nums?: Set<string>): number {
  const upper = text.toUpperCase();
  const t = alnum(text);
  const docWords = nums ? new Set(words(text)) : null;
  let hits = 0;
  for (const it of items) {
    const code = (it.productCode ?? "").trim().toUpperCase();
    let hit = false;
    if (code.length >= 3) hit = new RegExp(`(?<![A-Z0-9])${escapeRe(code)}(?![A-Z0-9])`).test(upper);
    if (!hit) {
      const d = alnum(it.description).slice(0, 28);
      hit = d.length >= 16 && t.includes(d);
    }
    if (!hit && nums && docWords) {
      const price = parseFloat(String(it.unitPrice ?? "").replace(/,/g, ""));
      if (Number.isFinite(price) && price > 0 && nums.has(price.toFixed(2))) {
        const toks = words(it.description).filter((w) => w.length >= 4);
        const found = toks.filter((w) => docWords.has(w)).length;
        hit = toks.length >= 2 ? found / toks.length >= 0.6 : toks.length === 1 && toks[0].length >= 6 && found === 1;
      }
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
  const hits = itemHits(text, c.items, nums);
  const total = c.items.length;
  const reasons: string[] = [];
  let score = 0;
  if (sig.ref) { score += 100; reasons.push("Our quotation number is on the document"); }
  // a customer often orders only some of the quotation's lines, so a few matching lines count for something even when they are a small share
  if (total > 0 && hits > 0) {
    score += Math.max(Math.round((40 * hits) / total), Math.min(hits, 5) * 9);
    reasons.push(`${hits} of ${total} items are on the document`);
    if (hits < total && !sig.amount) reasons.push("The PO may be for part of the quotation");
  }
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

// ── the Malaysian government order (Pesanan Kerajaan, AM 75E): the labels sit below their values ──
const DMY = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
type GovOrder = { no: string | null; date: string | null; due: string | null; address: string | null };
function parseGovOrder(text: string): GovOrder | null {
  if (!/PESANAN\s+KERAJAAN/i.test(text)) return null;
  const lines = text.split("\n").map((l) => l.replace(/\s+/g, " ").trim());
  const toIso = (d: string) => { const m = DMY.exec(d); return m ? isoDate(Number(m[3]), Number(m[2]), Number(m[1])) : null; };
  let no: string | null = null, date: string | null = null;
  const h = lines.findIndex((l) => /Tarikh Dokumen/i.test(l) && /No\. ?Dokumen/i.test(l));
  if (h > 0) {
    const m = /(\d{1,2}\/\d{1,2}\/\d{4})\s+([A-Z]{1,3}\d{8,})\s*$/.exec(lines[h - 1]);
    if (m) { date = toIso(m[1]); no = m[2]; }
  }
  let due: string | null = null, address: string | null = null;
  const p = lines.findIndex((l) => /^Pada atau sebelum/i.test(l));
  if (p >= 0) {
    const addr: string[] = [];
    for (let i = p + 1; i < Math.min(lines.length, p + 8); i++) {
      if (!lines[i] || /^Sila bekalkan/i.test(lines[i])) break;
      if (DMY.test(lines[i])) { due = toIso(lines[i]); break; }
      addr.push(lines[i]);
    }
    if (addr.length) address = addr.join("\n");
  }
  return { no, date, due, address };
}

// ── the PO's own number and date, as a suggestion for the form ──────────────
export function extractPoNumber(text: string): string | null {
  const gov = parseGovOrder(text)?.no;
  if (gov) return gov;
  const re = /(?:P\.?\s?O\.?\s*(?:No\.?|Number|#)|Purchase\s+Order\s*(?:No\.?|Number|#)?|Order\s*(?:No\.?|Number)|No\.?\s*Pesanan|Nombor\s+Pesanan)\s*[:#.\-]?\s*([A-Z0-9][A-Z0-9\-\/.]{4,29})/i;
  const m = re.exec(text);
  const v = m?.[1]?.replace(/[.\-\/]+$/, "") ?? "";
  // must look like a number: some digits, and not a word such as "Number"
  return /\d{3,}/.test(v) ? v : null;
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, mei: 5, jun: 6, jul: 7, aug: 8, ogos: 8, sep: 9, oct: 10, okt: 10, nov: 11, dec: 12, dis: 12 };
const isoDate = (y: number, m: number, d: number) => (y >= 2000 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` : null);

// a date written after a label, day first as in Malaysia: 12/11/2026, 12-11-26, 12 Nov 2026, 2026-11-12
function dateAfter(label: string, text: string): string | null {
  const m = new RegExp(`(?:${label})\\s*[:.\\-]?\\s*(\\d{1,2})[\\/.\\-](\\d{1,2})[\\/.\\-](\\d{2,4})`, "i").exec(text);
  if (m) { const y = Number(m[3]); return isoDate(y < 100 ? 2000 + y : y, Number(m[2]), Number(m[1])); }
  const w = new RegExp(`(?:${label})\\s*[:.\\-]?\\s*(\\d{1,2})(?:st|nd|rd|th)?\\s+([A-Za-z]{3,9})\\.?,?\\s+(\\d{4})`, "i").exec(text);
  if (w) { const mo = MONTHS[w[2].slice(0, 3).toLowerCase()]; if (mo) return isoDate(Number(w[3]), mo, Number(w[1])); }
  const s = new RegExp(`(?:${label})\\s*[:.\\-]?\\s*(\\d{4})-(\\d{2})-(\\d{2})`, "i").exec(text);
  return s ? isoDate(Number(s[1]), Number(s[2]), Number(s[3])) : null;
}

// the date of the order: next to "Date" / "Tarikh", but not the delivery, due or validity dates
export function extractPoDate(text: string): string | null {
  const gov = parseGovOrder(text);
  if (gov) return gov.date;
  return dateAfter("(?<!Delivery\\s|Deliver\\s|Due\\s|Required\\s|Expiry\\s|Valid\\s|Hantar\\s)(?:Date|Tarikh)\\s*(?:of\\s+Order)?", text);
}

// when the customer wants the goods
export function extractDeliveryDate(text: string): string | null {
  const gov = parseGovOrder(text);
  if (gov) return gov.due;
  return dateAfter("Delivery\\s*Date|Deliver(?:y)?\\s*By|Date\\s*Required|Required\\s*(?:Date|By|Delivery)|Due\\s*Date|Delivery\\s*Required|Tarikh\\s*(?:Penghantaran|Hantar|Dihantar)", text);
}

// the address the goods go to: the lines after "Deliver to" / "Ship to", up to the next label
const ADDRESS_LABEL = /(?:Deliver(?:y)?\s*(?:To|Address|At)|Ship(?:ping)?\s*To|Alamat\s*Penghantaran|Hantar\s*(?:Ke|Kepada))\s*[:\-]?/i;
const NEXT_LABEL = /^(?:\W*)(?:Bill(?:ing)?\s*To|Invoice\s*To|Date|Tarikh|P\.?O\.?\s*(?:No|Number|#)|Order\s*No|Tel|Phone|Fax|Attn|Attention|Contact|Terms|Payment|Currency|Page|Item|No\.?\s|Description|Qty|Quantity|Vendor|Supplier|Requisition|Ref|Delivery\s*Date|Due|Sub\s*total|Total)\b/i;
export function extractDeliveryAddress(text: string): string | null {
  const gov = parseGovOrder(text);
  if (gov) return gov.address;
  const m = ADDRESS_LABEL.exec(text);
  if (!m) return null;
  const lines = text.slice(m.index + m[0].length).split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length && out.length < 6; i++) {
    const l = lines[i].replace(/\s+/g, " ").trim();
    if (!l) { if (out.length) break; continue; }
    if (i > 0 && NEXT_LABEL.test(l)) break;
    out.push(l);
  }
  const addr = out.join("\n").trim();
  // an address has a few words and usually a number or a postcode; not just a label's leftovers
  return addr.length >= 12 && addr.length <= 300 && /[A-Za-z]{3,}/.test(addr) ? addr : null;
}
