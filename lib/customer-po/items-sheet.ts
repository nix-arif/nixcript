// Spreadsheet round trip for the "CPO description" of Customer PO items: download the
// items, fill in the CPO description column (handy for long government POs), upload it again.
// Only the CPO description column is read back; everything else in the sheet is for reference.

import { isNotAsSetLabel } from "@/lib/customer-po/item-order";

export const CPO_DESCRIPTION_LABEL = "CPO description";

export type SheetItem = {
  key: string;
  no: number; // the item number shown on the page
  productCode: string;
  description: string;
  qty: string;
  uom: string;
  setGroupLabel: string;
  setGroupId: string; // "" when the item is not in a set
  setCpoTitle: string; // set title on the CPO; written on the first row of each set only
  cpoDescription: string;
};

export const SET_TITLE_LABEL = "Set title (CPO)";
const HEADERS = ["No", "Code", "Our description", "Qty", "UOM", "Set", SET_TITLE_LABEL, CPO_DESCRIPTION_LABEL];

export async function downloadItemsSheet(rows: SheetItem[], fileName: string) {
  const XLSX = await import("xlsx");
  const ws = XLSX.utils.aoa_to_sheet([
    HEADERS,
    ...rows.map((r) => [r.no, r.productCode, r.description, r.qty, r.uom, r.setGroupLabel, r.setCpoTitle, r.cpoDescription]),
  ]);
  ws["!cols"] = [{ wch: 6 }, { wch: 16 }, { wch: 44 }, { wch: 8 }, { wch: 8 }, { wch: 18 }, { wch: 44 }, { wch: 70 }];
  const notes = XLSX.utils.aoa_to_sheet([
    ["CPO items sheet"],
    [`Type the description exactly as written on the customer's PO in the "${CPO_DESCRIPTION_LABEL}" column, then upload the file again on the CPO page.`],
    [`For a set, type the main title as written on the customer's PO (e.g. TOILET & SUTURE SET consist of:-) in the "${SET_TITLE_LABEL}" column, on any row of that set.`],
    ["Qty is read back too: change a quantity here and it is applied to the item when you upload."],
    ["Set: type a set name to put the item in that set (items with the same name are grouped together). Use not-as-set for an item that is not in a set. An empty cell keeps the current set."],
    ["Only Set, Set title (CPO), Qty and CPO description are read back. Code and description are read-only here. Changes to other columns are ignored."],
    ["Rows are matched by the No and Code columns, so do not renumber, re-sort or change the codes."],
    ["Leave a cell empty to keep what is already on the CPO."],
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Items");
  XLSX.utils.book_append_sheet(wb, notes, "Notes");
  XLSX.writeFile(wb, fileName);
}

export type SheetRow = { no: number | null; code: string; cpoDescription: string; setCpoTitle: string; qty: string; set: string };

export async function readItemsSheet(file: File): Promise<SheetRow[]> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "", raw: false });
  if (raw.length === 0) throw new Error("The sheet has no rows");
  const norm = (h: string) => h.trim().toLowerCase();
  const col = (name: string) => Object.keys(raw[0]).find((h) => norm(h) === norm(name));
  const descCol = col(CPO_DESCRIPTION_LABEL);
  if (!descCol) throw new Error(`Could not find a "${CPO_DESCRIPTION_LABEL}" column. Use the sheet downloaded from this page.`);
  const titleCol = col(SET_TITLE_LABEL); // absent in sheets downloaded before sets had a title
  const noCol = col("No");
  const codeCol = col("Code");
  const qtyCol = col("Qty");
  const setCol = col("Set");
  return raw.map((r) => {
    const n = noCol ? Number(String(r[noCol]).trim()) : NaN;
    return {
      no: Number.isFinite(n) && n > 0 ? n : null,
      code: codeCol ? String(r[codeCol] ?? "").trim() : "",
      cpoDescription: String(r[descCol] ?? "").trim(),
      setCpoTitle: titleCol ? String(r[titleCol] ?? "").trim() : "",
      qty: qtyCol ? String(r[qtyCol] ?? "").replace(/,/g, "").trim() : "",
      set: setCol ? String(r[setCol] ?? "").trim() : "",
    };
  });
}

// Match each row to an item. By No when the code agrees, otherwise by code (first item with that
// code not already matched). Empty cells never overwrite anything.
//  - a set name moves the item into that set (only when it differs from its current one)
//  - a set title goes to the set the item ends up in (reported per item; the page applies it to the set)
//  - a quantity is applied only when it differs from the item's current one
export function applyCpoDescriptions(
  items: Pick<SheetItem, "key" | "no" | "productCode" | "setGroupId" | "setGroupLabel" | "qty">[],
  rows: SheetRow[],
): {
  updates: Map<string, string>;
  setTitles: Map<string, string>; // item key -> title of the set that item is in
  setLabels: Map<string, string>; // item key -> set name to move it to
  qtys: Map<string, string>;
  filled: number;
  skipped: string[];
} {
  const updates = new Map<string, string>();
  const setTitles = new Map<string, string>();
  const setLabels = new Map<string, string>();
  const qtys = new Map<string, string>();
  const skipped: string[] = [];
  const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  const claimed = new Set<string>(); // items already matched by an earlier row
  rows.forEach((r, idx) => {
    if (!r.cpoDescription && !r.setCpoTitle && !r.qty && !r.set) return;
    const label = `Row ${idx + 2}${r.code ? ` (${r.code})` : ""}`;
    let hit = r.no != null ? items.find((i) => i.no === r.no && (!r.code || same(i.productCode, r.code)) && !claimed.has(i.key)) : undefined;
    if (!hit && r.code) hit = items.find((i) => same(i.productCode, r.code) && !claimed.has(i.key));
    if (!hit) {
      if (r.cpoDescription || r.setCpoTitle) skipped.push(`${label}: no matching item`);
      return;
    }
    claimed.add(hit.key);
    if (r.cpoDescription) updates.set(hit.key, r.cpoDescription);
    if (r.set && !same(r.set, hit.setGroupLabel)) setLabels.set(hit.key, r.set);
    // is the item in a real set once this row is applied?
    const inRealSet = r.set ? !isNotAsSetLabel(r.set) : !!hit.setGroupId;
    if (r.setCpoTitle && inRealSet) setTitles.set(hit.key, r.setCpoTitle);
    if (r.qty) {
      const q = Number(r.qty);
      if (!(q > 0)) skipped.push(`${label}: quantity "${r.qty}" must be a number greater than 0`);
      else if (q !== Number(hit.qty)) qtys.set(hit.key, String(q));
    }
  });
  return { updates, setTitles, setLabels, qtys, filled: updates.size, skipped };
}
