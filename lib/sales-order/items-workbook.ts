// Builds the Sales Order items workbook. ExcelJS (not the lighter xlsx package) so the Sourcing
// column can be locked to a list: Excel itself then only accepts "oem" or "trading" in it.
import ExcelJS from "exceljs";

import { CPO_DESCRIPTION_LABEL, DESIGN_BRAND_LABEL, DESIGN_CODE_LABEL, EMBOSS_CODE_LABEL, SET_TITLE_LABEL, SOURCING_LABEL } from "@/lib/sales-order/sheet-labels";

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
  sourcing: string; // "oem" | "trading" | ""
  designBrand: string;
  designCode: string;
};

export async function buildSoItemsWorkbook(rows: SoSheetItem[], opts: { withPrice: boolean; withSourcing: boolean }): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Items", { views: [{ state: "frozen", ySplit: 1 }] });

  const cols: { header: string; width: number; get: (r: SoSheetItem) => string | number }[] = [
    { header: "No", width: 6, get: (r) => r.no },
    { header: "Code", width: 16, get: (r) => r.productCode },
    { header: "Description", width: 60, get: (r) => r.description },
    { header: "Qty", width: 8, get: (r) => r.qty },
    { header: "UOM", width: 8, get: (r) => r.uom },
    ...(opts.withPrice ? [{ header: "Unit price", width: 12, get: (r: SoSheetItem) => r.unitPrice }] : []),
    ...(opts.withSourcing
      ? [
          { header: SOURCING_LABEL, width: 12, get: (r: SoSheetItem) => r.sourcing },
          { header: DESIGN_BRAND_LABEL, width: 18, get: (r: SoSheetItem) => r.designBrand },
          { header: DESIGN_CODE_LABEL, width: 18, get: (r: SoSheetItem) => r.designCode },
          // Always the item Code (OEM items only): a formula, and the cell is locked
          { header: EMBOSS_CODE_LABEL, width: 16, get: (r: SoSheetItem) => (r.sourcing === "oem" ? r.productCode : "") },
        ]
      : []),
    { header: "Set", width: 18, get: (r) => r.setGroupLabel },
    { header: "CPO", width: 20, get: (r) => r.cpoNo },
    { header: SET_TITLE_LABEL, width: 44, get: (r) => r.setCpoTitle },
    { header: CPO_DESCRIPTION_LABEL, width: 70, get: (r) => r.cpoDescription },
  ];
  ws.columns = cols.map((c) => ({ header: c.header, width: c.width }));
  rows.forEach((r) => ws.addRow(cols.map((c) => c.get(r))));
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } };

  if (opts.withSourcing) {
    const idx = (h: string) => cols.findIndex((c) => c.header === h) + 1;
    const L = (h: string) => ws.getColumn(idx(h)).letter;
    const sCol = L(SOURCING_LABEL), codeCol = L("Code"), brandCol = L(DESIGN_BRAND_LABEL), dCol = L(DESIGN_CODE_LABEL), eCol = L(EMBOSS_CODE_LABEL);
    const last = rows.length + 301; // also covers blank rows below the data, for rows added by hand
    const GREY = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFE5E7EB" }, bgColor: { argb: "FFE5E7EB" } };
    const RED = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFFECACA" }, bgColor: { argb: "FFFECACA" } };

    for (let r = 2; r <= last; r++) {
      // Sourcing: only "oem" or "trading" (or empty)
      ws.getCell(`${sCol}${r}`).dataValidation = {
        type: "list", allowBlank: true, formulae: ['"oem,trading"'],
        showErrorMessage: true, errorStyle: "stop", errorTitle: "Sourcing", error: 'Type or choose "oem" or "trading".',
        showInputMessage: true, promptTitle: "Sourcing", prompt: "oem or trading",
      };
      // Design brand / code: can only be typed when Sourcing is oem
      for (const c of [brandCol, dCol]) {
        ws.getCell(`${c}${r}`).dataValidation = {
          type: "custom", allowBlank: true, formulae: [`$${sCol}${r}="oem"`],
          showErrorMessage: true, errorStyle: "stop", errorTitle: "OEM only",
          error: 'Design brand and design code can only be filled when Sourcing is "oem".',
        };
      }
      // Emboss code always follows Code (OEM only)
      const e = ws.getCell(`${eCol}${r}`);
      const code = r - 2 < rows.length ? rows[r - 2] : null;
      e.value = { formula: `IF($${sCol}${r}="oem",$${codeCol}${r},"")`, result: code && code.sourcing === "oem" ? code.productCode : "" };
      e.fill = GREY;
    }
    // Looks: greyed out unless oem, red when oem and the design code is still empty
    ws.addConditionalFormatting({
      ref: `${brandCol}2:${dCol}${last}`,
      rules: [{ type: "expression", priority: 2, formulae: [`$${sCol}2<>"oem"`], style: { fill: GREY } }],
    });
    // Both are required for an OEM item: red while still empty
    ws.addConditionalFormatting({
      ref: `${brandCol}2:${brandCol}${last}`,
      rules: [{ type: "expression", priority: 1, formulae: [`AND($${sCol}2="oem",LEN(${brandCol}2)=0)`], style: { fill: RED } }],
    });
    ws.addConditionalFormatting({
      ref: `${dCol}2:${dCol}${last}`,
      rules: [{ type: "expression", priority: 1, formulae: [`AND($${sCol}2="oem",LEN(${dCol}2)=0)`], style: { fill: RED } }],
    });

    // Lock the sheet (no password, so it can be unprotected) with only Emboss code locked
    const lockedAt = idx(EMBOSS_CODE_LABEL);
    for (let r = 2; r <= last; r++) {
      for (let c = 1; c <= cols.length; c++) if (c !== lockedAt) ws.getCell(r, c).protection = { locked: false };
    }
    await ws.protect("", { selectLockedCells: true, selectUnlockedCells: true, formatCells: true, formatColumns: true, formatRows: true, insertRows: true, insertColumns: false, deleteRows: false });
  }

  const notes = wb.addWorksheet("Notes");
  [
    "Sales order items sheet",
    "Fill in the Description and Qty columns, then upload the file again on the sales order page.",
    `CPO description and ${SET_TITLE_LABEL} are shown for reference. On a sales order they are read-only: they come from the Customer PO, and changes to them here are ignored.`,
    ...(opts.withSourcing
      ? [
          `${SOURCING_LABEL}: only "oem" or "trading" is accepted. Leave it empty to keep what is already on the order.`,
          `${DESIGN_BRAND_LABEL} and ${DESIGN_CODE_LABEL} can only be filled for OEM items (set ${SOURCING_LABEL} to oem first). ${DESIGN_BRAND_LABEL} and ${DESIGN_CODE_LABEL} are both required for every OEM item; the cells turn red while empty.`,
          `${EMBOSS_CODE_LABEL} always follows the Code column and is locked. The sheet is protected without a password, only to lock that column.`,
        ]
      : []),
    `Only Description, Qty${opts.withSourcing ? `, ${SOURCING_LABEL}, ${DESIGN_BRAND_LABEL} and ${DESIGN_CODE_LABEL}` : ""} are read back. Code, UOM, unit price, set and CPO are for reference and are ignored.`,
    "Rows are matched by the No and Code columns, so do not renumber or change the codes. You can sort and filter freely.",
    "A row with a description and no code (and no matching No) is added to the order as an additional row.",
    "Leave a cell empty to keep what is already on the order.",
  ].forEach((t, i) => {
    const row = notes.addRow([t]);
    if (i === 0) row.font = { bold: true };
  });
  notes.getColumn(1).width = 120;

  return Buffer.from(await wb.xlsx.writeBuffer());
}
