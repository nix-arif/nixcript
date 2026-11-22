// Reads the lines of a Malaysian government order (Pesanan Kerajaan) from the positions of the text on the page, and
// matches them to the items on the CPO. Nothing here changes anything: the page shows the result and the user applies it.

export type Cell = { page: number; x: number; y: number; str: string };
export type PoLine = { no: number; description: string; qty: number | null; unitPrice: number | null; amount: number | null };

const num = (s: string) => {
  const v = parseFloat(s.replace(/,/g, ""));
  return Number.isFinite(v) ? v : null;
};
const isNum = (s: string) => /^\d[\d,]*(\.\d+)?$/.test(s.trim());

// The columns are found from their headings (Kuantiti, Harga Seunit, Amaun); each line starts with its number at the
// left, its description follows underneath (it may wrap), and the accounting codes between lines are skipped.
export function parseGovLines(cells: Cell[]): PoLine[] {
  const out: PoLine[] = [];
  const pages = [...new Set(cells.map((c) => c.page))].sort((a, b) => a - b);
  for (const pg of pages) {
    const cs = cells.filter((c) => c.page === pg && c.str.trim());
    const kq = cs.find((c) => c.str.trim() === "Kuantiti");
    const hp = cs.find((c) => /^Harga Seunit/i.test(c.str.trim()));
    const am = cs.find((c) => c.str.trim() === "Amaun" && kq && Math.abs(c.y - kq.y) < 4);
    if (!kq || !hp || !am) continue;
    const stop = cs.filter((c) => /^Jumlah\s*\(RM\)/i.test(c.str.trim()) && c.y < kq.y).sort((a, b) => b.y - a.y)[0];
    const bottom = stop ? stop.y + 4 : -Infinity;
    const body = cs.filter((c) => c.y < kq.y - 14 && c.y > bottom).sort((a, b) => b.y - a.y || a.x - b.x);
    // rows: cells whose heights are close together
    const rows: Cell[][] = [];
    for (const c of body) {
      const last = rows[rows.length - 1];
      if (last && Math.abs(last[0].y - c.y) <= 3) last.push(c); else rows.push([c]);
    }
    let cur: PoLine | null = null;
    for (const row of rows) {
      const first = row.find((c) => c.x < 30 && /^\d{1,3}$/.test(c.str.trim()));
      if (first) {
        const inCol = (lo: number, hi: number) => row.find((c) => c.x >= lo && c.x < hi && isNum(c.str));
        cur = {
          no: Number(first.str.trim()),
          description: "",
          qty: num(inCol(kq.x - 6, hp.x)?.str ?? ""),
          unitPrice: num(inCol(hp.x - 6, am.x - 6)?.str ?? ""),
          amount: num(inCol(am.x - 6, Infinity)?.str ?? ""),
        };
        out.push(cur);
        continue;
      }
      // the accounting codes between lines have many cells; a description has a few words at the left
      const text = row.filter((c) => c.x < kq.x - 6).map((c) => c.str.trim()).join(" ").trim();
      if (!cur || row.length >= 3 || !text) continue;
      cur.description = `${cur.description} ${text}`.trim();
    }
  }
  return out.filter((l) => l.description);
}

// ── match the lines to the items ────────────────────────────────────────────
// group: which quotation the item came from (shown when picking an item by hand)
export type MatchItem = { key: string; productCode: string; description: string; qty: string; unitPrice: string; included: boolean; inSet: boolean; group?: string };
// how sure the automatic match is: "strong" when the wording and the price agree, "weak" when only part of it does
export type MatchConfidence = "strong" | "weak";
export type LineMatch = {
  line: PoLine;
  itemKey: string | null;
  priceDiff: { po: number; ours: number } | null;
  qtyDiff: { po: number; ours: number } | null;
  confidence?: MatchConfidence | null; // of the automatic match (none for a match picked by hand)
};
export type PoLinesResult = { matches: LineMatch[]; notOnPo: string[] };

const words = (s: string) => (s ?? "").toUpperCase().split(/[^A-Z0-9]+/).filter((w) => w.length >= 3);

// Where a PO line and one of our items disagree: the price and the quantity. Used for the automatic matches and for
// the ones the user picks, so both are checked the same way.
export function lineDiffs(line: PoLine, it: MatchItem | null | undefined): Pick<LineMatch, "priceDiff" | "qtyDiff"> {
  if (!it) return { priceDiff: null, qtyDiff: null };
  const price = parseFloat(it.unitPrice);
  return {
    priceDiff: line.unitPrice != null && Number.isFinite(price) && price > 0 && Math.abs(price - line.unitPrice) >= 0.005 ? { po: line.unitPrice, ours: price } : null,
    qtyDiff: line.qty != null && Number(it.qty) !== line.qty ? { po: line.qty, ours: Number(it.qty) } : null,
  };
}

// A score of 4 or more is a match. It is "strong" only when nearly all the words agree AND the price or the quantity
// does too: a matching price alone must not vouch for the wrong variant ("Reload 75mm GREEN" for "Reload 75mm BLUE"
// shares 3 of 4 words and the price, and is still only "please check").
const isStrong = (overlap: number, priceEq: boolean, qtyEq: boolean) => overlap >= 0.85 && (priceEq || qtyEq);

export function matchPoLines(lines: PoLine[], items: MatchItem[]): PoLinesResult {
  const pairs: { li: number; key: string; score: number; strong: boolean }[] = [];
  lines.forEach((l, li) => {
    const lw = new Set(words(l.description));
    for (const it of items) {
      const iw = new Set(words(it.description));
      const common = [...lw].filter((w) => iw.has(w)).length;
      const overlap = lw.size && iw.size ? common / Math.min(lw.size, iw.size) : 0;
      const price = parseFloat(it.unitPrice);
      const priceEq = l.unitPrice != null && Number.isFinite(price) && price > 0 && Math.abs(price - l.unitPrice) < 0.005;
      const qtyEq = l.qty != null && Number(it.qty) === l.qty;
      const score = overlap * 4 + (priceEq ? 3 : 0) + (qtyEq ? 1 : 0);
      if (score >= 4) pairs.push({ li, key: it.key, score, strong: isStrong(overlap, priceEq, qtyEq) });
    }
  });
  // the best pairs first, each item and each line used once
  pairs.sort((a, b) => b.score - a.score || a.li - b.li);
  const lineTo = new Map<number, { key: string; score: number; strong: boolean }>();
  const used = new Set<string>();
  for (const p of pairs) {
    if (lineTo.has(p.li) || used.has(p.key)) continue;
    lineTo.set(p.li, p);
    used.add(p.key);
  }
  const matches: LineMatch[] = lines.map((line, li) => {
    const m = lineTo.get(li);
    const it = m ? items.find((i) => i.key === m.key) : undefined;
    return { line, itemKey: m?.key ?? null, ...lineDiffs(line, it), confidence: m ? (m.strong ? "strong" : "weak") : null };
  });
  return { matches, notOnPo: items.filter((i) => i.included && !used.has(i.key)).map((i) => i.key) };
}

// The matches as the user settled them: an automatic match, or the item they picked for a line (null: the line is not
// one of ours). An item picked for one line is taken off any other line it was matched to.
export function resolveMatches(
  auto: PoLinesResult,
  items: MatchItem[],
  picks: Record<number, string | null>, // by PO line number
): PoLinesResult & { picked: Set<number> } {
  const known = new Set(items.map((i) => i.key));
  const chosen = new Map<number, string | null>();
  const picked = new Set<number>();
  for (const m of auto.matches) {
    const p = picks[m.line.no];
    if (p !== undefined && (p === null || known.has(p))) { chosen.set(m.line.no, p); picked.add(m.line.no); }
    else chosen.set(m.line.no, m.itemKey);
  }
  // an item picked by hand wins over the same item matched automatically elsewhere
  const pickedItems = new Set([...picked].map((n) => chosen.get(n)).filter(Boolean) as string[]);
  for (const m of auto.matches) {
    const k = chosen.get(m.line.no);
    if (k && !picked.has(m.line.no) && pickedItems.has(k)) chosen.set(m.line.no, null);
  }
  const matches: LineMatch[] = auto.matches.map((m) => {
    const key = chosen.get(m.line.no) ?? null;
    const byHand = picked.has(m.line.no);
    return { line: m.line, itemKey: key, ...lineDiffs(m.line, items.find((i) => i.key === key)), confidence: byHand ? null : key ? m.confidence : null };
  });
  const used = new Set(matches.map((m) => m.itemKey).filter(Boolean) as string[]);
  return { matches, notOnPo: items.filter((i) => i.included && !used.has(i.key)).map((i) => i.key), picked };
}
