// Spreadsheet round trip for the items of a new Sales Order: download the items, fill in the
// description, qty and sourcing (handy for long lists), upload it again and the form is filled.
// Code, UOM, unit price, set, CPO, the CPO description and the set title are for reference only:
// on a sales order the CPO description is read-only, it comes from the Customer PO.

import { createSoItemsSheet } from "@/server/sales-order-sheet";
import type { SoSheetItem } from "@/lib/sales-order/items-workbook";
import { DESIGN_BRAND_LABEL, DESIGN_CODE_LABEL, SOURCING_LABEL } from "@/lib/sales-order/sheet-labels";

export type { SoSheetItem };

export async function downloadSoItemsSheet(rows: SoSheetItem[], fileName: string, opts: { withPrice: boolean; withSourcing: boolean }) {
  const b64 = await createSoItemsSheet(rows, opts);
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

export type SoSheetRow = { no: number | null; code: string; description: string; qty: string; sourcing: string; designBrand: string; designCode: string };

export async function readSoItemsSheet(file: File): Promise<SoSheetRow[]> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: "", raw: false });
  if (raw.length === 0) throw new Error("The sheet has no rows");
  const norm = (h: string) => h.trim().toLowerCase();
  const col = (name: string) => Object.keys(raw[0]).find((h) => norm(h) === norm(name));
  const descCol = col("Description");
  const qtyCol = col("Qty");
  const sourcingCol = col(SOURCING_LABEL);
  const brandCol = col(DESIGN_BRAND_LABEL);
  const designCodeCol = col(DESIGN_CODE_LABEL);
  if (!descCol && !qtyCol) throw new Error('Could not find a "Description" or "Qty" column. Use the sheet downloaded from this page.');
  const noCol = col("No");
  const codeCol = col("Code");
  return raw.map((r) => {
    const n = noCol ? Number(String(r[noCol]).trim()) : NaN;
    return {
      no: Number.isFinite(n) && n > 0 ? n : null,
      code: codeCol ? String(r[codeCol] ?? "").trim() : "",
      description: descCol ? String(r[descCol] ?? "").trim() : "",
      qty: qtyCol ? String(r[qtyCol] ?? "").replace(/,/g, "").trim() : "",
      sourcing: sourcingCol ? String(r[sourcingCol] ?? "").trim() : "",
      designBrand: brandCol ? String(r[brandCol] ?? "").trim() : "",
      designCode: designCodeCol ? String(r[designCodeCol] ?? "").trim() : "",
    };
  });
}

// Match each row to an order item: by No when the code agrees, otherwise by code (first item with
// that code not already matched). Empty cells never overwrite anything, and a value equal to the
// current one is not an edit. A row that matches nothing and has no code is a new additional row.
export function applySoSheet(
  items: Pick<SoSheetItem, "key" | "no" | "productCode" | "description" | "qty" | "sourcing" | "designBrand" | "designCode">[],
  rows: SoSheetRow[],
): {
  descriptions: Map<string, string>;
  qtys: Map<string, string>;
  sourcings: Map<string, "oem" | "trading">;
  designs: Map<string, { brand?: string; code?: string }>;
  additions: { description: string; qty: string }[];
  skipped: string[];
} {
  const descriptions = new Map<string, string>();
  const qtys = new Map<string, string>();
  const sourcings = new Map<string, "oem" | "trading">();
  const designs = new Map<string, { brand?: string; code?: string }>();
  const additions: { description: string; qty: string }[] = [];
  const skipped: string[] = [];
  const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  const claimed = new Set<string>();
  rows.forEach((r, idx) => {
    if (!r.description && !r.qty && !r.sourcing && !r.designBrand && !r.designCode) return;
    const label = `Row ${idx + 2}${r.code ? ` (${r.code})` : ""}`;
    const q = r.qty ? Number(r.qty) : null;
    if (r.qty && !(q! > 0)) {
      skipped.push(`${label}: quantity "${r.qty}" must be a number greater than 0`);
      return;
    }
    let hit = r.no != null ? items.find((i) => i.no === r.no && (!r.code || same(i.productCode, r.code)) && !claimed.has(i.key)) : undefined;
    if (!hit && r.code) hit = items.find((i) => same(i.productCode, r.code) && !claimed.has(i.key));
    if (!hit) {
      if (!r.code && r.no == null && r.description) additions.push({ description: r.description, qty: r.qty || "1" });
      else skipped.push(`${label}: no matching item on this order`);
      return;
    }
    claimed.add(hit.key);
    if (r.description && r.description.trim().toUpperCase() !== hit.description.trim().toUpperCase()) descriptions.set(hit.key, r.description);
    if (q !== null && q !== Number(hit.qty)) qtys.set(hit.key, String(q));
    // Sourcing, and the OEM fields that go with it
    let target: string = hit.sourcing || "";
    let sourcingOk = true;
    if (r.sourcing) {
      // Excel blocks anything else, but a pasted value can get through, so it is checked here too
      const v = r.sourcing.trim().toLowerCase();
      if (v !== "oem" && v !== "trading") { skipped.push(`${label}: sourcing "${r.sourcing}" must be oem or trading`); sourcingOk = false; }
      else if (!hit.productCode.trim()) { skipped.push(`${label}: sourcing can only be set on an item that has a code`); sourcingOk = false; }
      else target = v;
    }
    if (sourcingOk && (r.sourcing || r.designBrand || r.designCode)) {
      if (target === "oem") {
        const code = r.designCode || hit.designCode;
        if (!code.trim()) skipped.push(`${label}: design code is required for an OEM item`);
        else {
          if (r.sourcing && target !== (hit.sourcing || "")) sourcings.set(hit.key, "oem");
          const d: { brand?: string; code?: string } = {};
          if (r.designBrand && r.designBrand !== hit.designBrand) d.brand = r.designBrand;
          if (r.designCode && r.designCode !== hit.designCode) d.code = r.designCode;
          if (d.brand !== undefined || d.code !== undefined) designs.set(hit.key, d);
        }
      } else {
        // an untouched sheet still carries the catalogue values of trading items: only a changed value is a problem
        if ((r.designBrand && r.designBrand !== hit.designBrand) || (r.designCode && r.designCode !== hit.designCode)) skipped.push(`${label}: design brand and design code can only be filled for an OEM item (set sourcing to oem)`);
        if (r.sourcing && target !== (hit.sourcing || "")) sourcings.set(hit.key, "trading");
      }
    }
  });
  return { descriptions, qtys, sourcings, designs, additions, skipped };
}
