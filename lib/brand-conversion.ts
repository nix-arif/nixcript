// Brand conversion — turning a hospital's brand catalogue code (medicon,
// geister, bolton surgical, …) into the Best Medical code to emboss. Shared
// by the Brand Conversion page, its server actions, the Excel download and
// the seed script, so they all read codes and sheets the same way.

export type ConversionStatus = "matched" | "check" | "own" | "notfound" | "blank";

export type Mapping = {
  brandName: string;
  bestMedicalCode: string;
  description: string | null;
  uom: string | null;
  useCount: number;
  lastSeen: string | null;
};

export type ConversionAlt = { bestMedicalCode: string; useCount: number; description: string | null };

export type ConversionResult = {
  status: ConversionStatus;
  bestMedicalCode: string; // the suggested code ("" when not found)
  description: string; // the description used on past order sheets for this item, else the catalogue name
  catalogueName: string; // Best Medical's own product name from the catalogue ("" when not in the catalogue)
  uom: string;
  alternatives: ConversionAlt[]; // every Best Medical code this brand code has been converted to, best first
  note: string;
};

// ── Normalising what people type ────────────────────────────────────────────

const BRAND_ALIASES: Record<string, string> = {
  bolton: "bolton surgical",
  "bolton surgicals": "bolton surgical",
  bestmedical: "best medical",
  "best-medical": "best medical",
  best: "best medical",
  "spiggle and theis": "spiggle & theis",
  "spiggle&theis": "spiggle & theis",
};

export function normBrand(v: unknown): string {
  const t = String(v ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  return BRAND_ALIASES[t] ?? t;
}

/** Case- and space-insensitive key; punctuation is kept because "01.27.03" and "01-27-03" are different codes. */
export function codeKey(v: unknown): string {
  return String(v ?? "").replace(/\s+/g, "").toUpperCase();
}

export function cleanText(v: unknown): string {
  return String(v ?? "").replace(/ /g, " ").replace(/[ \t]+/g, " ").trim();
}

/** Order sheets sometimes prefix a one-off coating request to the description; that isn't the item's own description. */
export function isCoatingVariant(desc: string): boolean {
  return /^\s*black ceramic coating/i.test(desc);
}

// ── Reading a sheet: find the header row and the columns we care about ──────

export type ColumnRole = "hospital" | "setName" | "no" | "brand" | "code" | "bm" | "description" | "qty" | "uom";
export type ColumnMap = Partial<Record<ColumnRole, number>>;

const ROLE_MATCHERS: [ColumnRole, (h: string) => boolean][] = [
  ["bm", (h) => h.includes("emboss") || h.startsWith("best medical code") || h === "best medical" || h === "bm code"],
  ["brand", (h) => h.includes("brand name") || h === "brand"],
  ["code", (h) =>
    h.includes("brand code") || h === "code" || h === "product code" || h === "item code" || h === "catalogue code" ||
    h === "catalog code" || h === "catalogue no" || h === "catalog no" || h === "cat no" || h === "ref" || h === "ref no" ||
    h === "part no" || h === "part number" || h === "design code" || h.startsWith("code to refer")],
  ["description", (h) => h.startsWith("description") || h === "desc" || h === "item description" || h === "item name"],
  ["hospital", (h) => h.startsWith("hosp") || h === "customer" || h === "ward"],
  ["setName", (h) => h.startsWith("set name") || h === "set"],
  ["qty", (h) => h === "qty" || h === "quantity" || h === "qty (pcs)"],
  ["uom", (h) => h === "oum" || h === "uom" || h === "unit"],
  ["no", (h) => h === "no" || h === "no." || h === "item no" || h === "#"],
];

/** Which column plays which role, judged from a header row. A role is only taken once. */
export function detectColumns(headerRow: unknown[]): ColumnMap {
  const map: ColumnMap = {};
  const taken = new Set<number>();
  for (const [role, test] of ROLE_MATCHERS) {
    const i = headerRow.findIndex((v, idx) => !taken.has(idx) && test(cleanText(v).toLowerCase()));
    if (i >= 0) { map[role] = i; taken.add(i); }
  }
  return map;
}

/** First row (within the first 15) that has a code column — spreadsheets often start with a title. */
export function findHeaderRow(rows: unknown[][]): { index: number; columns: ColumnMap } | null {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const columns = detectColumns(rows[i] ?? []);
    if (columns.code !== undefined) return { index: i, columns };
  }
  return null;
}

// ── Deciding the conversion ─────────────────────────────────────────────────

/** If one Best Medical code accounts for at least this share of past conversions, it's treated as settled. */
export const SETTLED_SHARE = 0.85;

export function resolveConversion(
  item: { brand: string; code: string },
  mappingsByKey: ReadonlyMap<string, Mapping[]>,
  catalogue: ReadonlyMap<string, { description: string | null; uom: string | null }>,
): ConversionResult {
  const key = codeKey(item.code);
  const blank: ConversionResult = { status: "blank", bestMedicalCode: "", description: "", catalogueName: "", uom: "", alternatives: [], note: "" };
  if (!key) return blank;

  const brand = normBrand(item.brand);
  const all = mappingsByKey.get(key) ?? [];
  // A conversion recorded without a brand name applies whatever brand is typed
  const sameBrand = brand ? all.filter((m) => m.brandName === brand || m.brandName === "") : all;
  const cands = sameBrand.length > 0 ? sameBrand : all;
  const brandDiffers = !!brand && sameBrand.length === 0 && all.length > 0;

  // A code that is already a Best Medical code needs no conversion
  const inCatalogue = catalogue.get(key);
  if (brand === "best medical" || (cands.length === 0 && inCatalogue)) {
    const cat = inCatalogue;
    const hist = cands.find((m) => m.description)?.description ?? "";
    return {
      status: "own", bestMedicalCode: String(item.code).trim().toUpperCase(),
      description: hist || cat?.description || "", catalogueName: cat?.description ?? "", uom: cat?.uom ?? "", alternatives: [],
      note: brand === "best medical" ? "" : "Not a known brand code, but it is a Best Medical product code",
    };
  }
  if (cands.length === 0) return { ...blank, status: "notfound", note: "No conversion on record" };

  // Group by Best Medical code: most used first, newest as tie-break
  const groups = new Map<string, { count: number; lastSeen: string; description: string | null; uom: string | null }>();
  for (const m of cands) {
    const bm = m.bestMedicalCode.toUpperCase();
    const g = groups.get(bm) ?? { count: 0, lastSeen: "", description: null, uom: null };
    g.count += m.useCount;
    if ((m.lastSeen ?? "") >= g.lastSeen) { g.lastSeen = m.lastSeen ?? ""; g.description = m.description ?? g.description; }
    g.uom = g.uom ?? m.uom;
    groups.set(bm, g);
  }
  const ranked = [...groups.entries()].sort((a, b) => b[1].count - a[1].count || b[1].lastSeen.localeCompare(a[1].lastSeen));
  const total = ranked.reduce((s, [, g]) => s + g.count, 0);
  const [topCode, top] = ranked[0];
  const settled = ranked.length === 1 || top.count / total >= SETTLED_SHARE;

  const cat = catalogue.get(codeKey(topCode));
  const notes: string[] = [];
  if (brandDiffers) notes.push(`Converted before under a different brand (${[...new Set(all.map((m) => m.brandName || "unknown"))].join(", ")})`);
  if (!settled) notes.push("Converted to different codes before — check which one is right");
  return {
    status: settled ? "matched" : "check",
    bestMedicalCode: topCode,
    description: top.description || cat?.description || "",
    catalogueName: cat?.description ?? "",
    uom: cat?.uom ?? top.uom ?? "",
    alternatives: ranked.map(([c, g]) => ({ bestMedicalCode: c, useCount: g.count, description: g.description || catalogue.get(codeKey(c))?.description || null })),
    note: notes.join("; "),
  };
}
