// Adding a spreadsheet's items to items the user already keyed in (or uploaded earlier), instead of replacing them.
// Sets are matched by their group id (g-<set name>): a set that already exists keeps its own subtitle, price and
// quantity, and the new rows join it. Items without a set and items with sets cannot be mixed in one quotation, so
// when one side has sets and the other has none, the set-less rows go to the "not-as-set" group.

type Row = { rowNo: string; productCode?: string; setGroupId?: string; setGroupLabel?: string; setSubtitle?: string; setPrice?: string; setQty?: string };

export const NOT_AS_SET_GROUP = { id: "g-not-as-set", label: "not-as-set", qty: "1" };

const intoNotAsSet = <T extends Row>(r: T): T => (r.setGroupId ? r : { ...r, setGroupId: NOT_AS_SET_GROUP.id, setGroupLabel: NOT_AS_SET_GROUP.label, setQty: NOT_AS_SET_GROUP.qty });

export function mergeUploadedItems<T extends Row>(existing: T[], incoming: T[]): T[] {
  if (existing.length === 0) return incoming;
  if (incoming.length === 0) return existing;
  let base = existing;
  let add = incoming;
  if (add.some((r) => r.setGroupId) && base.some((r) => !r.setGroupId)) base = base.map(intoNotAsSet);
  if (base.some((r) => r.setGroupId) && add.some((r) => !r.setGroupId)) add = add.map(intoNotAsSet);

  // a set that is already there keeps its own details
  const setOf = new Map<string, T>();
  for (const r of base) if (r.setGroupId && !setOf.has(r.setGroupId)) setOf.set(r.setGroupId, r);
  add = add.map((r) => {
    const s = r.setGroupId ? setOf.get(r.setGroupId) : undefined;
    return s ? { ...r, setGroupLabel: s.setGroupLabel, setSubtitle: s.setSubtitle, setPrice: s.setPrice, setQty: s.setQty } : r;
  });

  // the new rows continue the numbering
  const last = base.reduce((m, r) => (Number.isFinite(Number(r.rowNo)) ? Math.max(m, Number(r.rowNo)) : m), 0);
  return [...base, ...add.map((r, n) => ({ ...r, rowNo: String(last + 1 + n) }))];
}

// Codes of the new rows that are already in the list (to warn before adding), compared without capitals or spaces around
export function repeatedCodes(existing: Row[], incoming: Row[]): string[] {
  const norm = (c?: string) => (c ?? "").trim().toLowerCase();
  const have = new Set(existing.map((r) => norm(r.productCode)).filter(Boolean));
  return [...new Set(incoming.filter((r) => have.has(norm(r.productCode))).map((r) => (r.productCode ?? "").trim()))];
}

// A row nobody has filled in yet (added with "Add row" and left empty)
export const isBlankRow = (r: { productCode?: string; description?: string }) => !(r.productCode ?? "").trim() && !(r.description ?? "").trim();
