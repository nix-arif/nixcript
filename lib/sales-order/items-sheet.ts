// Spreadsheet round trip for the items of a new Sales Order: download the items, fill in the
// description and qty (handy for long government lists), upload it again and the form is filled.
// Only Description and Qty are read back. Code, UOM, unit price, set and CPO are for reference.

export const CPO_DESCRIPTION_LABEL = "CPO description";
export const SET_TITLE_LABEL = "Set title (CPO)";

export type SoSheetItem = {
  key: string;
  no: number;
  productCode: string;
  description: string;
  qty: string;
  uom: string;
  unitPrice: string;
  setGroupLabel: string;
  setGroupId: string; // "" when the item is not in a set
  setCpoTitle: string; // the set's title on the CPO; written on the first row of each set only
  cpoDescription: string;
  cpoNo: string;
};

export async function downloadSoItemsSheet(rows: SoSheetItem[], fileName: string, withPrice: boolean) {
  const XLSX = await import("xlsx");
  const headers = ["No", "Code", "Description", "Qty", "UOM", ...(withPrice ? ["Unit price"] : []), "Set", "CPO", SET_TITLE_LABEL, CPO_DESCRIPTION_LABEL];
  const ws = XLSX.utils.aoa_to_sheet([
    headers,
    ...rows.map((r) => [r.no, r.productCode, r.description, r.qty, r.uom, ...(withPrice ? [r.unitPrice] : []), r.setGroupLabel, r.cpoNo, r.setCpoTitle, r.cpoDescription]),
  ]);
  ws["!cols"] = [{ wch: 6 }, { wch: 16 }, { wch: 60 }, { wch: 8 }, { wch: 8 }, ...(withPrice ? [{ wch: 12 }] : []), { wch: 18 }, { wch: 20 }, { wch: 44 }, { wch: 70 }];
  const notes = XLSX.utils.aoa_to_sheet([
    ["Sales order items sheet"],
    ["Fill in the Description, Qty and CPO description columns, then upload the file again on the sales order page."],
    [`CPO description is the item description as written on the customer's PO. For a set, type its main title (e.g. TOILET & SUTURE SET consist of:-) in "${SET_TITLE_LABEL}" on any row of that set.`],
    ["Only Description, Qty, CPO description and Set title (CPO) are read back. Code, UOM, unit price, set and CPO are for reference and are ignored."],
    ["Rows are matched by the No and Code columns, so do not renumber or change the codes."],
    ["A row with a description and no code (and no matching No) is added to the order as an additional row."],
    ["Leave a cell empty to keep what is already on the order."],
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Items");
  XLSX.utils.book_append_sheet(wb, notes, "Notes");
  XLSX.writeFile(wb, fileName);
}

export type SoSheetRow = { no: number | null; code: string; description: string; qty: string; cpoDescription: string; setCpoTitle: string };

export async function readSoItemsSheet(file: File): Promise<SoSheetRow[]> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: "", raw: false });
  if (raw.length === 0) throw new Error("The sheet has no rows");
  const norm = (h: string) => h.trim().toLowerCase();
  const col = (name: string) => Object.keys(raw[0]).find((h) => norm(h) === norm(name));
  const descCol = col("Description");
  const qtyCol = col("Qty");
  const cpoDescCol = col(CPO_DESCRIPTION_LABEL);
  const titleCol = col(SET_TITLE_LABEL);
  if (!descCol && !qtyCol && !cpoDescCol) throw new Error('Could not find a "Description" or "Qty" column. Use the sheet downloaded from this page.');
  const noCol = col("No");
  const codeCol = col("Code");
  return raw.map((r) => {
    const n = noCol ? Number(String(r[noCol]).trim()) : NaN;
    return {
      no: Number.isFinite(n) && n > 0 ? n : null,
      code: codeCol ? String(r[codeCol] ?? "").trim() : "",
      description: descCol ? String(r[descCol] ?? "").trim() : "",
      qty: qtyCol ? String(r[qtyCol] ?? "").replace(/,/g, "").trim() : "",
      cpoDescription: cpoDescCol ? String(r[cpoDescCol] ?? "").trim() : "",
      setCpoTitle: titleCol ? String(r[titleCol] ?? "").trim() : "",
    };
  });
}

// Match each row to an order item: by No when the code agrees, otherwise by code (first item with
// that code not already matched). Empty cells never overwrite anything, and a value equal to the
// current one is not an edit. A row that matches nothing and has no code is a new additional row.
export function applySoSheet(
  items: Pick<SoSheetItem, "key" | "no" | "productCode" | "description" | "qty" | "cpoDescription" | "setGroupId">[],
  rows: SoSheetRow[],
): {
  descriptions: Map<string, string>;
  qtys: Map<string, string>;
  cpoDescriptions: Map<string, string>;
  setTitles: Map<string, string>; // item key -> title of the set that item is in
  additions: { description: string; qty: string; cpoDescription: string }[];
  skipped: string[];
} {
  const descriptions = new Map<string, string>();
  const qtys = new Map<string, string>();
  const cpoDescriptions = new Map<string, string>();
  const setTitles = new Map<string, string>();
  const additions: { description: string; qty: string; cpoDescription: string }[] = [];
  const skipped: string[] = [];
  const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  const claimed = new Set<string>();
  rows.forEach((r, idx) => {
    if (!r.description && !r.qty && !r.cpoDescription && !r.setCpoTitle) return;
    const label = `Row ${idx + 2}${r.code ? ` (${r.code})` : ""}`;
    const q = r.qty ? Number(r.qty) : null;
    if (r.qty && !(q! > 0)) {
      skipped.push(`${label}: quantity "${r.qty}" must be a number greater than 0`);
      return;
    }
    let hit = r.no != null ? items.find((i) => i.no === r.no && (!r.code || same(i.productCode, r.code)) && !claimed.has(i.key)) : undefined;
    if (!hit && r.code) hit = items.find((i) => same(i.productCode, r.code) && !claimed.has(i.key));
    if (!hit) {
      if (!r.code && r.no == null && (r.description || r.cpoDescription)) additions.push({ description: r.description, qty: r.qty || "1", cpoDescription: r.cpoDescription });
      else skipped.push(`${label}: no matching item on this order`);
      return;
    }
    claimed.add(hit.key);
    if (r.description && r.description.trim().toUpperCase() !== hit.description.trim().toUpperCase()) descriptions.set(hit.key, r.description);
    if (q !== null && q !== Number(hit.qty)) qtys.set(hit.key, String(q));
    if (r.cpoDescription && r.cpoDescription !== hit.cpoDescription) cpoDescriptions.set(hit.key, r.cpoDescription);
    if (r.setCpoTitle && hit.setGroupId) setTitles.set(hit.key, r.setCpoTitle);
  });
  return { descriptions, qtys, cpoDescriptions, setTitles, additions, skipped };
}
