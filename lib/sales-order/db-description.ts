// Pure rules for keeping a sales order item's description in step with the product database.
// (The hook that fetches the data is lib/sales-order/use-db-descriptions.ts.)
type Source = "quote" | "catalog" | "user" | "cpo" | "so";

export type DbDescItem = {
  _key: string;
  productCode?: string;
  sourcingType?: "trading" | "oem" | null;
  designBrandCode?: string | null;
  description?: string;
  _descriptionSource?: Source[] | null;
  _isAdditional?: boolean;
  _dbDescription?: string | null; // undefined = not looked up yet, null = no database description
  _dbRef?: string; // the reference code the database description was looked up with
  _descKeep?: boolean; // the description differs from the database and was accepted as intended on the Customer PO: not overwritten by the first automatic sync
};

// The code the database description is looked up with ("" = nothing to look up).
// An OEM item is described by its design code (the product code of the catalogue product it is made like),
// every other item by its own code.
export function refOf(i: DbDescItem, showSourcing: boolean): string {
  if (i._isAdditional) return "";
  if (showSourcing && i.sourcingType === "oem" && i.designBrandCode?.trim()) return i.designBrandCode.trim();
  return (i.productCode ?? "").trim();
}

// Compared ignoring case and any difference in spacing or line breaks (a spreadsheet turns a line break into
// "\r\n", collapses or adds spaces, and may swap a non-breaking space), so the same text is never "different".
export const normText = (s?: string | null) => (s ?? "").replace(/\s+/g, " ").trim().toUpperCase();
export const sameText = (a?: string | null, b?: string | null) => normText(a) === normText(b);

// Apply looked-up database descriptions (reference code lowercased -> text) to the items.
export function mergeDbDescriptions<T extends DbDescItem>(
  prev: T[],
  codes: string[],
  byCode: Map<string, string>,
  opts: { showSourcing: boolean; syncOnLoad: boolean },
): T[] {
  return prev.map((i) => {
    const r = refOf(i, opts.showSourcing);
    if (!r || i._dbRef === r || !codes.includes(r)) return i; // nothing to look up, already done, or it changed while we waited
    const db = byCode.get(r.toLowerCase()) || null;
    const firstTime = i._dbDescription === undefined;
    const next: T = { ...i, _dbRef: r, _dbDescription: db ? db.toUpperCase() : null };
    if (!db) return next;
    // accepted at the Customer PO: the automatic sync on first load leaves the text alone (the database text is only kept for
    // comparing). After that the user is in charge: whatever they type or revert to is the newest description.
    if (i._descKeep && firstTime) return next;
    // follow the database unless the user customised the text (on first load: unless this page keeps what was saved)
    const inSync = firstTime ? opts.syncOnLoad : sameText(i.description, i._dbDescription);
    if (inSync || sameText(i.description, db)) return { ...next, description: db.toUpperCase(), _descriptionSource: ["catalog"] };
    return next;
  });
}
