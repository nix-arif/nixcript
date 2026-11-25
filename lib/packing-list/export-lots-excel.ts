// The lot numbers of packing list lines as an Excel file — the "Lot Numbers" button on a packing list, on the
// packing list list, and on the centralized list. Sheet "Lots": one row per lot (a PO line on one packing list).
// Sheet "Stickers": one row per piece (lot-001 … up to the accepted quantity), as printed on the labels.
// Browser only (saves a file).
import * as XLSX from "xlsx";
import type { LotNumberRow } from "@/server/packing-list";
import { lotWithPiece, pieceNo } from "@/lib/lot-no";

const fmtDate = (d: Date | string) =>
  new Date(d).toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" });

export function exportLotNumbersExcel(rows: LotNumberRow[], opts: { fileName: string; showCompany: boolean }) {
  const { showCompany } = opts;
  const lead = (r: LotNumberRow) => (showCompany ? [r.company] : []);

  const lotHeader = [
    "Lot No", "Stickers", ...(showCompany ? ["Company"] : []), "Packing List", "Supplier Ref", "PL Date", "Supplier",
    "PO No", "PO Line", "Product Code", "Description", "Design Brand", "Design Code", "Emboss Code", "UOM",
    "Expected", "Received", "Rejected", "Accepted", "Customer", "Customer Organization", "Customer PO",
  ];
  const lotRows = rows.map((r) => [
    r.lotNo,
    r.qtyAccepted >= 1 ? `${lotWithPiece(r.lotNo, 1)} to ${lotWithPiece(r.lotNo, Math.floor(r.qtyAccepted))}` : "",
    ...lead(r), r.packingListNo, r.supplierRefNo ?? "", fmtDate(r.plDate), r.supplier,
    r.poNo, r.poLine ?? "", r.productCode, r.description, r.designBrandName, r.designBrandCode, r.privateLabelCode, r.uom,
    r.qtyExpected, r.qtyReceived, r.qtyRejected, r.qtyAccepted, r.customerName, r.customerOrganization, r.customerPoNo,
  ]);

  const stickerHeader = ["Sticker No", "Lot No", ...(showCompany ? ["Company"] : []), "Packing List", "PO No", "PO Line", "Product Code", "Description", "Customer", "Customer PO"];
  const stickerRows: (string | number)[][] = [];
  for (const r of rows) {
    for (let n = 1; n <= Math.floor(r.qtyAccepted); n++) {
      stickerRows.push([lotWithPiece(r.lotNo, n), r.lotNo, ...lead(r), r.packingListNo, r.poNo, r.poLine ?? "", r.productCode, r.description, r.customerName, r.customerPoNo]);
    }
  }

  const sheet = (header: string[], data: (string | number)[][], widths: Record<string, number>) => {
    const ws = XLSX.utils.aoa_to_sheet([header, ...data]);
    ws["!cols"] = header.map((h) => ({ wch: widths[h] ?? 14 }));
    ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: data.length, c: header.length - 1 } }) };
    ws["!freeze"] = { xSplit: 0, ySplit: 1 };
    return ws;
  };
  const widths = { "Lot No": 20, "Sticker No": 24, Stickers: 46, Company: 24, "Packing List": 24, Supplier: 28, Description: 40, Customer: 24, "Customer Organization": 28, "Customer PO": 18 };

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet(lotHeader, lotRows, widths), "Lots");
  XLSX.utils.book_append_sheet(wb, sheet(stickerHeader, stickerRows, widths), "Stickers");
  XLSX.writeFile(wb, opts.fileName.endsWith(".xlsx") ? opts.fileName : `${opts.fileName}.xlsx`);
}

// Item Tracking layout: one row per PO line, with all its lots (newest packing list first) stacked in one cell and the
// sticker range of each lot ("02-260010-066-01-001 → 002"); quantities are the totals across those lots.
export async function exportLotNumbersByLineExcel(rows: LotNumberRow[], opts: { fileName: string }) {
  const ExcelJS = (await import("exceljs")).default;
  const groups = new Map<string, LotNumberRow[]>();
  for (const r of rows) {
    const key = `${r.poNo}|${r.poLine ?? ""}|${r.productCode}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Lot Numbers", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = [
    { header: "Lot No", width: 20 },
    { header: "Stickers", width: 32 },
    { header: "PO No", width: 14 },
    { header: "PO Line", width: 9 },
    { header: "Product Code", width: 16 },
    { header: "Description", width: 45 },
    { header: "Design Brand", width: 16 },
    { header: "Design Code", width: 14 },
    { header: "Emboss Code", width: 14 },
    { header: "UOM", width: 8 },
    { header: "Expected", width: 10 },
    { header: "Received", width: 10 },
    { header: "Rejected", width: 10 },
    { header: "Accepted", width: 10 },
    { header: "Customer", width: 24 },
    { header: "Customer Organization", width: 30 },
    { header: "Customer PO", width: 18 },
  ];
  ws.getRow(1).font = { bold: true };

  const uniq = (vals: string[]) => [...new Set(vals.filter(Boolean))].join("\n");
  const sum = (lots: LotNumberRow[], f: (r: LotNumberRow) => number) => lots.reduce((s, r) => s + f(r), 0);
  const ordered = [...groups.values()].sort((a, b) => a[0].poNo.localeCompare(b[0].poNo) || (a[0].poLine ?? 0) - (b[0].poLine ?? 0));
  for (const lots of ordered) {
    const first = lots[0];
    const stickers = lots
      .filter((r) => r.qtyAccepted >= 1)
      .map((r) => `${lotWithPiece(r.lotNo, 1)} → ${pieceNo(Math.floor(r.qtyAccepted))}`)
      .join(",\n");
    const row = ws.addRow([
      lots.map((r) => r.lotNo).join("\n"),
      stickers,
      first.poNo,
      first.poLine ?? "",
      first.productCode,
      first.description,
      first.designBrandName,
      first.designBrandCode,
      first.privateLabelCode,
      first.uom,
      sum(lots, (r) => r.qtyExpected),
      sum(lots, (r) => r.qtyReceived),
      sum(lots, (r) => r.qtyRejected),
      sum(lots, (r) => r.qtyAccepted),
      uniq(lots.map((r) => r.customerName)),
      uniq(lots.map((r) => r.customerOrganization)),
      uniq(lots.map((r) => r.customerPoNo)),
    ]);
    row.alignment = { vertical: "top", wrapText: true };
  }
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columns.length } };

  const buf = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = opts.fileName.endsWith(".xlsx") ? opts.fileName : `${opts.fileName}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
