// Builds the intercompany price list template with ExcelJS (so the price column can be limited to numbers).
import ExcelJS from "exceljs";

export type PriceTemplateRow = { code: string; description: string; price: string; currency: string };

const HEADERS = ["Product code", "Description", "Unit price", "Currency"];

export async function buildPriceListWorkbook(sellerName: string, rows: PriceTemplateRow[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Price list", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = [{ width: 22 }, { width: 60 }, { width: 14 }, { width: 10 }];
  ws.addRow(HEADERS);
  rows.forEach((r) => ws.addRow([r.code, r.description, r.price === "" ? null : Number(r.price), r.currency]));
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } };

  const lastData = rows.length + 1;
  const last = lastData + 300; // blank rows below the data, for products added by hand
  for (let r = 2; r <= last; r++) {
    ws.getCell(`C${r}`).numFmt = "#,##0.00";
    ws.getCell(`C${r}`).dataValidation = {
      type: "decimal", operator: "greaterThan", formulae: [0], allowBlank: true,
      showErrorMessage: true, errorTitle: "Unit price", error: "Enter a number greater than 0, or leave the cell empty.",
    };
    // the code and description of the listed products are fixed; the price and currency, and the blank rows, are free
    const free = r > lastData;
    for (let c = 1; c <= 4; c++) ws.getCell(r, c).protection = { locked: !free && c <= 2 };
    if (!free) ws.getCell(`B${r}`).font = { color: { argb: "FF6B7280" } };
  }
  await ws.protect("", { selectLockedCells: true, selectUnlockedCells: true, formatColumns: true, formatRows: true, insertRows: false, deleteRows: false });

  const help = wb.addWorksheet("How to use");
  help.columns = [{ width: 110 }];
  [
    `Intercompany price list for ${sellerName}`,
    "",
    "1. Fill in the Unit price for the products you sell to your sibling organizations. Leave a price empty to skip that product.",
    "2. Currency is MYR unless you change it. The PO's currency must match for the price to be used.",
    "3. A product that is not listed can be added in the empty rows at the bottom: Product code and Unit price are enough.",
    "4. Upload the file on the Intercompany Pricing page. A product already on the list gets the new price. Nothing is removed by uploading.",
    "",
    "The Product code and Description of the listed products are locked so they cannot be changed by accident. The sheet has no password.",
  ].forEach((t, i) => { const row = help.addRow([t]); if (i === 0) row.font = { bold: true, size: 13 }; });

  return Buffer.from(await wb.xlsx.writeBuffer());
}
