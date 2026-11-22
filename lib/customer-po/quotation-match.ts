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

// A line of the customer's PO, when the document's lines could be read (a government order): quantity and price
// tell a right item from the same item quoted elsewhere.
export type DocLine = { description: string; unitPrice: number | null };

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
  orgFound: boolean; // the customer's organization is on the document: such quotations always come first
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

const words = (s: string | null | undefined) => (s ?? "").toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);

// Words that say nothing about which customer or which product it is: kinds of places, company forms, and the
// boilerplate of a PO. Left out when names and descriptions are compared word by word.
const GENERIC = new Set([
  "HOSPITAL", "KLINIK", "CLINIC", "PUSAT", "CENTRE", "CENTER", "MEDICAL", "PERUBATAN", "SPECIALIST", "PAKAR", "KESIHATAN",
  "UNIVERSITI", "UNIVERSITY", "JABATAN", "INSTITUT", "INSTITUTE", "SDN", "BHD", "BERHAD", "THE", "AND", "DAN", "FOR", "WITH",
  "PIECE", "PIECES", "PCS", "UNIT", "UNITS", "SET", "SETS", "BOX", "PACK", "SPEC", "CODE", "SIZE", "TYPE", "EACH",
]);
// How a word is compared: the short forms used in instrument names written out, and a plural made singular, so
// "SCISSORS MAYO CVD" (ours) and "SCISSOR MAYO CURVED" (the PO) share every word.
const ABBREV: Record<string, string> = {
  CVD: "CURVED", CRVD: "CURVED", CUR: "CURVED", STR: "STRAIGHT", STRT: "STRAIGHT", STRAI: "STRAIGHT",
  FCPS: "FORCEPS", FCP: "FORCEPS", FORC: "FORCEPS", RETR: "RETRACTOR", RETRAC: "RETRACTOR", SCISS: "SCISSORS", SCIS: "SCISSORS",
  NDL: "NEEDLE", HLDR: "HOLDER", HOLD: "HOLDER", SST: "STEEL", INSTR: "INSTRUMENT", DISP: "DISPOSABLE", STER: "STERILE",
};
const norm = (w: string) => {
  const a = ABBREV[w] ?? w;
  return a.length >= 5 && a.endsWith("S") && !a.endsWith("SS") ? a.slice(0, -1) : a;
};
const normWords = (s: string | null | undefined) => words(s).map(norm);

// the words of a name or description that tell it apart (3+ letters, not generic), compared as above
const distinctive = (s: string | null | undefined) => [...new Set(normWords(s).filter((w) => w.length >= 3 && !GENERIC.has(w)))];

// one letter typed wrong, added or left out ("MAGGIL" for "MAGGILL"): only for longer words, where it cannot turn one
// real word into another
function oneEditApart(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

// The document's words (compared as above), and its "tokens" (each run of non-spaces, without punctuation) to find
// product codes in: "Code: 77-9995" gives 779995, "46.28.10" gives 462810.
export type DocIndex = { text: string; alnum: string; words: Set<string>; byStart: Map<string, string[]>; tokens: Set<string>; nums: Set<string> };
export function indexDoc(text: string): DocIndex {
  const tokens = new Set<string>();
  for (const t of text.toUpperCase().split(/\s+/)) { const a = alnum(t); if (a.length >= 3) tokens.add(a); }
  const ws = new Set(normWords(text));
  const byStart = new Map<string, string[]>();
  for (const w of ws) if (w.length >= 5) { const k = w.slice(0, 2); byStart.set(k, [...(byStart.get(k) ?? []), w]); }
  return { text, alnum: alnum(text), words: ws, byStart, tokens, nums: numbersIn(text) };
}
// a word of ours is on the document: as it is, or with one letter different (words of 6+ letters)
function hasWord(doc: DocIndex, w: string): boolean {
  if (doc.words.has(w)) return true;
  if (w.length < 6) return false;
  return (doc.byStart.get(w.slice(0, 2)) ?? []).some((d) => d.length >= 5 && oneEditApart(d, w));
}

// the customer: the organization's name, or the contact's full name. A name matches when it is on the document as
// written, or when all its telling words are (in any order, across line breaks): "Hospital Sultanah Aminah Johor
// Bahru (HSAJB)" is found in "HOSPITAL SULTANAH AMINAH, JOHOR BAHRU" without the "(HSAJB)", but "Hospital Sultanah
// Bahiyah" is not found in it.
function nameAppears(doc: DocIndex, name: string | null | undefined): boolean {
  const dw = distinctive(name).filter((w) => !/^\d+$/.test(w));
  if (dw.length === 0) return false; // only generic words ("Hospital", "Klinik Kesihatan"): says nothing about who
  const a = alnum(name);
  if (a.length >= 6 && doc.alnum.includes(a)) return true;
  if (dw.length === 1 && dw[0].length < 5) return false; // one short word is too weak to go on
  // names are matched exactly, word for word (no typo allowance: "Bahiyah" must not pass for another name)
  const found = dw.filter((w) => doc.words.has(w)).length;
  // all of them, or all but a short one when there are several (an abbreviation in brackets, a missing "JB")
  return found === dw.length || (dw.length >= 3 && found === dw.length - 1 && dw.find((w) => !doc.words.has(w))!.length <= 5);
}
export function customerAppears(text: string | DocIndex, c: Pick<MatchCandidate, "customerName" | "orgNames">): { org: boolean; person: boolean } {
  const doc = typeof text === "string" ? indexDoc(text) : text;
  const org = c.orgNames.some((o) => nameAppears(doc, o));
  const person = !!c.customerName && alnum(c.customerName).length >= 6 && doc.alnum.includes(alnum(c.customerName));
  return { org, person };
}

// How one of our items shows on the document:
//  "strong": its product code is there, or its description AND its unit price are
//  "weak":   most of its description is there but not the price (the customer's price may differ from ours)
type ItemKind = "strong" | "weak" | null;
const priceOf = (v: string | null | undefined) => { const p = parseFloat(String(v ?? "").replace(/,/g, "")); return Number.isFinite(p) && p > 0 ? p : null; };
function descShare(itemDesc: string | null | undefined, doc: DocIndex): { share: number; n: number; found: number } {
  const toks = distinctive(itemDesc).filter((w) => w.length >= 3);
  if (toks.length === 0) return { share: 0, n: 0, found: 0 };
  const found = toks.filter((w) => hasWord(doc, w)).length;
  return { share: found / toks.length, n: toks.length, found };
}
function itemKind(doc: DocIndex, it: MatchCandidate["items"][number]): ItemKind {
  const code = alnum(it.productCode);
  if (code.length >= 4 && doc.tokens.has(code)) return "strong";
  const d = alnum(it.description).slice(0, 28);
  if (d.length >= 16 && doc.alnum.includes(d)) return "strong";
  const { share, n } = descShare(it.description, doc);
  const price = priceOf(it.unitPrice);
  const priceOnDoc = price != null && doc.nums.has(price.toFixed(2));
  if (priceOnDoc && (n >= 2 ? share >= 0.6 : n === 1 && share === 1)) return "strong";
  if (n >= 3 && share >= 0.75) return "weak";
  return null;
}

// how many of the quotation's items are on the document (strong and weak), for the score and the reasons
export function itemHits(text: string | DocIndex, items: MatchCandidate["items"]): { strong: number; weak: number } {
  const doc = typeof text === "string" ? indexDoc(text) : text;
  let strong = 0, weak = 0;
  for (const it of items) { const k = itemKind(doc, it); if (k === "strong") strong++; else if (k === "weak") weak++; }
  return { strong, weak };
}

// How many of the PO's own lines this quotation covers. A PO is often for a few lines of a bigger quotation, so the
// question "is everything on this PO in that quotation?" tells more than "how much of the quotation is on the PO?".
// A line is covered:
//  strongly when one of our items has its code, or most of its words and its unit price, or its exact unit price
//            and at least one telling word ("CORD SCISSOR" at 366.00 is our "UMBILICAL SCISSORS" at 366.00)
//  weakly   when only most of the words agree, or only the exact unit price does (the customer may name it its own way)
export function lineCoverage(lines: DocLine[], items: MatchCandidate["items"]): { strong: number; weak: number; total: number } {
  let strong = 0, weak = 0;
  for (const l of lines) {
    const lineDoc = { ...indexDoc(l.description), nums: new Set(l.unitPrice != null ? [l.unitPrice.toFixed(2)] : []) };
    let best: ItemKind = null;
    for (const it of items) {
      let k = itemKind(lineDoc, it);
      if (k !== "strong" && l.unitPrice != null) {
        const p = priceOf(it.unitPrice);
        if (p != null && Math.abs(p - l.unitPrice) < 0.005) k = descShare(it.description, lineDoc).found >= 1 ? "strong" : "weak";
      }
      if (k === "strong") { best = "strong"; break; }
      if (k === "weak") best = "weak";
    }
    if (best === "strong") strong++; else if (best === "weak") weak++;
  }
  return { strong, weak, total: lines.length };
}

export function scoreCandidate(text: string | DocIndex, nums: Set<string> | null, c: MatchCandidate, lines: DocLine[] = []): Suggestion | null {
  const doc = typeof text === "string" ? indexDoc(text) : text;
  const ref = textHasQuotationNo(doc.text, c.quotationNo);
  const amount = totalAppears(nums ?? doc.nums, c.grandTotal);
  const cust = customerAppears(doc, c);
  const hits = itemHits(doc, c.items);
  const cover = lines.length ? lineCoverage(lines, c.items) : null;
  const total = c.items.length;
  const reasons: string[] = [];
  let score = 0;
  // the organization is checked first and said first: it decides the order (see rankSuggestions)
  if (cust.org) { score += 15; reasons.push("The customer's organization is on the document"); }
  if (ref) { score += 100; reasons.push("Our quotation number is on the document"); }
  // The customer quoted the number this revision replaced ("…-0143" on the PO, and we revised it to "…-0143-R1"):
  // as good as its own number. If the revision matches the PO as well as the original, the tie goes to the newer one.
  const base = c.quotationNo.replace(/-R\d+$/i, "");
  const baseRef = !ref && base !== c.quotationNo && textHasQuotationNo(doc.text, base);
  if (baseRef) { score += 100; reasons.push(`The document quotes ${base}, which this quotation revises`); }
  // items: a weak one (the words but not the price) counts for less than a strong one. A customer often orders only
  // some of the quotation's lines, so a few matching lines count for something even when they are a small share.
  const weighted = hits.strong + 0.4 * hits.weak;
  if (total > 0 && weighted > 0) {
    score += Math.max(Math.round((40 * weighted) / total), Math.round(Math.min(weighted, 5) * 9));
    const n = hits.strong + hits.weak;
    reasons.push(`${n} of ${total} items are on the document${hits.weak > 0 && hits.strong === 0 ? " (by description; the price differs)" : hits.weak > 0 ? ` (${hits.weak} by description only)` : ""}`);
  }
  // every line of the PO is in this quotation: the PO is a part of it, whatever share of the quotation that is
  if (cover && cover.total > 0) {
    const covered = cover.strong + cover.weak;
    if (covered === cover.total) {
      score += cover.strong === cover.total ? 25 : 15;
      reasons.push(cover.total === 1 ? "The PO's line is in this quotation" : `All ${cover.total} lines of the PO are in this quotation`);
    } else if (covered > 0) {
      score += Math.round((15 * covered) / cover.total);
      reasons.push(`${covered} of the PO's ${cover.total} lines are in this quotation`);
    }
  }
  if (total > 0 && hits.strong + hits.weak > 0 && hits.strong + hits.weak < total && !amount) reasons.push("The PO may be for part of the quotation");
  if (amount) { score += 25; reasons.push("The total matches"); }
  if (cust.person) { score += 10; reasons.push("The contact's name is on the document"); }
  const ratio = total > 0 ? hits.strong / total : 0;
  const allStrong = !!cover && cover.total > 0 && cover.strong === cover.total;
  const veryLikely = ref || baseRef || (ratio >= 0.7 && (amount || cust.org)) || (allStrong && (amount || cust.org));
  // Shown when it scores enough, or when it is for the right organization and anything else agrees too (an item, a
  // line of the PO, the total): the organization comes first, so its quotations are not hidden for a low score. The
  // organization alone is not enough: every quotation ever made to that hospital would be listed.
  const somethingElse = ref || baseRef || amount || hits.strong + hits.weak > 0 || (!!cover && cover.strong + cover.weak > 0);
  if (!veryLikely && score < 30 && !(cust.org && somethingElse)) return null;
  return {
    id: c.id, quotationNo: c.quotationNo, customerName: c.customerName, grandTotal: c.grandTotal, score,
    level: veryLikely ? "very-likely" : "possible", reasons, itemHits: hits.strong + hits.weak, itemTotal: total,
    refFound: ref, amountMatch: amount, customerFound: cust.org || cust.person, orgFound: cust.org, cpoCount: c.cpoCount,
  };
}

// The order of the suggestions:
//  1. the customer's organization first: a quotation for the organization on the PO comes before any other,
//  2. then by how well the rest agrees (the quotation number, the items, the PO's lines, the total),
//  3. then the newer one (the candidates come newest first): of two that match equally (a quotation and its
//     revision, two quotations to the same customer for the same total) the customer most likely ordered the newer.
export function rankSuggestions(text: string, candidates: MatchCandidate[], max = 5, lines: DocLine[] = []): Suggestion[] {
  const doc = indexDoc(text);
  return candidates
    .map((c, i) => ({ s: scoreCandidate(doc, doc.nums, c, lines), i }))
    .filter((x): x is { s: Suggestion; i: number } => !!x.s)
    .sort((a, b) => Number(b.s.orgFound) - Number(a.s.orgFound) || b.s.score - a.s.score || a.i - b.i)
    .slice(0, max)
    .map((x) => x.s);
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
