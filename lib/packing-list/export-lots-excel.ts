// The lot numbers of packing list lines as an Excel file — the "Lot Numbers" button on a packing list, on the
// packing list list, and on the centralized list. Sheet "Lots": one row per lot (a PO line on one packing list).
// Sheet "Stickers": one row per piece (lot-001 … up to the accepted quantity), as printed on the labels.
// Browser only (saves a file).
import * as XLSX from "xlsx";
import type { LotNumberRow } from "@/server/packing-list";
import { lotWithPiece } from "@/lib/lot-no";

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
