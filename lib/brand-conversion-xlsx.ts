import ExcelJS from "exceljs";
import type { ColumnMap, ConversionStatus } from "@/lib/brand-conversion";

// What the page sends back once the user has reviewed the conversions.
export type ConversionSheetBody = {
  fileName: string;
  headers: string[]; // the uploaded sheet's header row
  columns: ColumnMap; // which uploaded columns are the code / brand / Best Medical code / description / uom
  rows: {
    cells: (string | number | null)[];
    brand: string;
    code: string;
    status: ConversionStatus;
    bestMedicalCode: string;
    description: string;
    catalogueName: string;
    uom: string;
    note: string;
    alternatives: string; // "C201-18 (18×), C201-18S (3×)"
  }[];
};

const THIN = { style: "thin", color: { argb: "FF000000" } } as const;
const BORDER: Partial<ExcelJS.Borders> = { top: THIN, left: THIN, bottom: THIN, right: THIN };
const FILL: Partial<Record<ConversionStatus, string>> = { check: "FFFDE68A", notfound: "FFFECACA", own: "FFDBEAFE" }; // amber / red / blue
const STATUS_LABEL: Record<ConversionStatus, string> = {
  matched: "Matched", check: "Check", own: "Best Medical code", notfound: "Not found", blank: "No code",
};

/** The converted workbook: the uploaded columns, ours filled in, colour-coded status, and a "Needs review" sheet. */
export async function buildConversionWorkbook(body: ConversionSheetBody): Promise<ExcelJS.Workbook> {
  // Output columns = the uploaded columns, plus any of ours the sheet didn't already have
  const outHeaders = [...body.headers.map((h) => (h ?? "").toString())];
  const cols = { ...body.columns };
  const add = (role: "bm" | "description" | "uom", title: string) => {
    if (cols[role] === undefined) { cols[role] = outHeaders.length; outHeaders.push(title); }
  };
  add("bm", "Best Medical Code to Emboss");
  add("description", "Description");
  add("uom", "OUM");
  const catIdx = outHeaders.length; outHeaders.push("Best Medical Catalogue Name");
  const statusIdx = outHeaders.length; outHeaders.push("Conversion Status");
  const noteIdx = outHeaders.length; outHeaders.push("Note");

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Conversion");
  const widthFor = (h: string) => (/description|catalogue name|note/i.test(h) ? 42 : /hospital|set name|brand|code|emboss/i.test(h) ? 22 : 12);
  outHeaders.forEach((h, i) => {
    ws.getColumn(i + 1).width = widthFor(h);
    const c = ws.getRow(1).getCell(i + 1);
    c.value = h; c.font = { bold: true }; c.border = BORDER;
    c.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } };
  });
  ws.getRow(1).height = 30;
  ws.views = [{ state: "frozen", ySplit: 1 }];

  body.rows.forEach((r, n) => {
    const row = ws.getRow(n + 2);
    r.cells.forEach((v, i) => { if (v !== null && v !== "") row.getCell(i + 1).value = v; });
    // Fill our columns without overwriting what the user already typed in them
    const put = (idx: number | undefined, val: string, overwrite: boolean) => {
      if (idx === undefined || !val) return;
      const cur = row.getCell(idx + 1).value;
      if (overwrite || cur === null || cur === undefined || cur === "") row.getCell(idx + 1).value = val;
    };
    put(cols.bm, r.bestMedicalCode, true);
    put(cols.description, r.description, false);
    put(cols.uom, r.uom, false);
    row.getCell(catIdx + 1).value = r.catalogueName || null;
    row.getCell(statusIdx + 1).value = STATUS_LABEL[r.status];
    row.getCell(noteIdx + 1).value = [r.note, r.status === "check" && r.alternatives ? `Seen before: ${r.alternatives}` : ""].filter(Boolean).join(" — ") || null;
    const fill = FILL[r.status];
    for (let i = 0; i < outHeaders.length; i++) {
      const c = row.getCell(i + 1);
      c.border = BORDER;
      c.alignment = { vertical: "top", wrapText: true, horizontal: i === cols.description || i === catIdx || i === noteIdx ? "left" : "center" };
      if (fill) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
    }
  });

  // A short list of what still needs a person's eye
  const todo = body.rows.map((r, n) => ({ r, n })).filter(({ r }) => r.status === "check" || r.status === "notfound");
  if (todo.length > 0) {
    const rv = wb.addWorksheet("Needs review");
    ["Row", "Brand", "Brand Code", "Status", "Suggested Best Medical Code", "Other codes seen before"].forEach((h, i) => {
      const c = rv.getRow(1).getCell(i + 1); c.value = h; c.font = { bold: true }; c.border = BORDER;
      rv.getColumn(i + 1).width = i === 5 ? 50 : 24;
    });
    todo.forEach(({ r, n }, k) => {
      const row = rv.getRow(k + 2);
      [n + 2, r.brand, r.code, STATUS_LABEL[r.status], r.bestMedicalCode, r.alternatives].forEach((v, i) => { row.getCell(i + 1).value = v || null; row.getCell(i + 1).border = BORDER; });
    });
  }

  return wb;
}
