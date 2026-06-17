import { PDFDocument, PDFFont, rgb, StandardFonts } from "pdf-lib";

// ── A4 ────────────────────────────────────────────────────────────────────────
const W  = 595.28;
const H  = 841.89;
const ML = 40;
const MR = 40;
const MT = 40;
const MB = 36;
const CW = W - ML - MR;

const C_BLACK = rgb(0, 0, 0);
const C_TEXT  = rgb(0.12, 0.12, 0.12);
const C_MUTED = rgb(0.45, 0.45, 0.45);
const C_LINE  = rgb(0.82, 0.82, 0.82);
const C_DARK  = rgb(0.15, 0.15, 0.15);
const C_WHITE = rgb(1, 1, 1);

function san(t: string | null | undefined): string {
  return String(t ?? "").replace(/[\x00-\x1F\x7F]/g, " ").trim();
}

function trunc(text: string, font: PDFFont, size: number, maxW: number): string {
  const t = san(text);
  if (!t) return "";
  if (font.widthOfTextAtSize(t, size) <= maxW) return t;
  let s = t;
  while (s.length > 0 && font.widthOfTextAtSize(s + "…", size) > maxW) s = s.slice(0, -1);
  return s.length ? s + "…" : "";
}

function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" });
}

function fmtMoney(v: string | number | null | undefined): string {
  const n = typeof v === "string" ? parseFloat(v) : Number(v ?? 0);
  return (isNaN(n) ? 0 : n).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export type InvoiceForPdf = {
  invoiceNo: string;
  invoiceDate: string | Date | null;
  dueDate: string | Date | null;
  status: string | null;
  notes: string | null;
  subtotal: string | null;
  overallDiscountAmt: string | null;
  sstPct: string | null;
  sst: string | null;
  grandTotal: string | null;
  customerSnapshot: {
    title?: string;
    name?: string;
    organizationName?: string;
    organizationAddress?: string;
    email?: string;
    contactNo?: string;
  } | null;
  items: {
    rowNo: number | null;
    productCode: string | null;
    description: string | null;
    qty: string | null;
    uom: string | null;
    unitPrice: string | null;
    totalPrice: string | null;
  }[];
  expenses: {
    description: string | null;
    amount: string | null;
  }[];
};

export type OrgForPdf = {
  companyName: string;
  companyAddress: string | null;
  taxNo: string | null;
};

export async function generateInvoicePdf(inv: InvoiceForPdf, org: OrgForPdf): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const fontR  = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontB  = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const page = pdfDoc.addPage([W, H]);
  let y = H - MT;

  const draw = (text: string, x: number, yPos: number, font: PDFFont, size: number, color = C_TEXT) => {
    page.drawText(san(text), { x, y: yPos, font, size, color });
  };

  const line = (x1: number, y1: number, x2: number, y2: number, color = C_LINE, thickness = 0.5) => {
    page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, color, thickness });
  };

  const rect = (x: number, yPos: number, w: number, h: number, color = C_DARK) => {
    page.drawRectangle({ x, y: yPos, width: w, height: h, color });
  };

  // ── Header bar ──────────────────────────────────────────────────────────────
  rect(ML - 4, y - 36, CW + 8, 40, C_DARK);
  draw(san(org.companyName), ML + 4, y - 8, fontB, 13, C_WHITE);
  if (org.taxNo) draw(`TIN: ${org.taxNo}`, ML + 4, y - 22, fontR, 8, rgb(0.8, 0.8, 0.8));
  // TAX INVOICE label right-aligned
  const titleW = fontB.widthOfTextAtSize("TAX INVOICE", 14);
  draw("TAX INVOICE", ML + CW - titleW - 4, y - 9, fontB, 14, C_WHITE);
  y -= 48;

  // ── Org address ─────────────────────────────────────────────────────────────
  if (org.companyAddress) {
    draw(san(org.companyAddress), ML, y, fontR, 7.5, C_MUTED);
    y -= 10;
  }
  y -= 6;
  line(ML, y, ML + CW, y);
  y -= 10;

  // ── Two-column: Bill To | Invoice Details ────────────────────────────────────
  const snap = inv.customerSnapshot ?? {};
  const colL = ML;
  const colR = ML + CW * 0.55;
  const colRW = CW * 0.45;

  // Left — Bill To
  draw("BILL TO", colL, y, fontB, 7.5, C_MUTED);
  y -= 13;
  const customerName = [snap.title, snap.name].filter(Boolean).join(" ");
  if (customerName) { draw(customerName, colL, y, fontB, 9); }
  const billY = y;
  y -= 12;
  if (snap.organizationName) { draw(snap.organizationName, colL, y, fontR, 8.5, C_TEXT); y -= 11; }
  if (snap.organizationAddress) {
    const lines = snap.organizationAddress.split(/[\n,]/).map(s => s.trim()).filter(Boolean);
    for (const l of lines.slice(0, 3)) { draw(l, colL, y, fontR, 8, C_MUTED); y -= 10; }
  }
  if (snap.email) { draw(snap.email, colL, y, fontR, 8, C_MUTED); y -= 10; }
  if (snap.contactNo) { draw(snap.contactNo, colL, y, fontR, 8, C_MUTED); }

  // Right — Invoice meta
  let metaY = billY;
  const metaLabel = (label: string, value: string) => {
    draw(label, colR, metaY, fontR, 8, C_MUTED);
    const valX = colR + colRW - fontR.widthOfTextAtSize(san(value), 8.5);
    draw(value, valX, metaY, fontB, 8.5);
    metaY -= 13;
  };
  metaLabel("Invoice No", inv.invoiceNo);
  metaLabel("Date", fmtDate(inv.invoiceDate));
  if (inv.dueDate) metaLabel("Due Date", fmtDate(inv.dueDate));
  metaLabel("Status", (inv.status ?? "draft").toUpperCase());

  y = Math.min(y, metaY) - 16;
  line(ML, y, ML + CW, y);
  y -= 12;

  // ── Items table ──────────────────────────────────────────────────────────────
  const C_NO   = 22;
  const C_CODE = 60;
  const C_DESC = CW - C_NO - C_CODE - 38 - 44 - 60;
  const C_QTY  = 38;
  const C_UOM  = 44;
  const C_UNIT = 60;
  const C_TOT  = CW - C_NO - C_CODE - C_DESC - C_QTY - C_UOM - C_UNIT;

  const X_NO   = ML;
  const X_CODE = X_NO + C_NO;
  const X_DESC = X_CODE + C_CODE;
  const X_QTY  = X_DESC + C_DESC;
  const X_UOM  = X_QTY + C_QTY;
  const X_UNIT = X_UOM + C_UOM;
  const X_TOT  = X_UNIT + C_UNIT;

  // Table header
  const TH = 16;
  rect(ML, y - TH + 4, CW, TH, C_DARK);
  const ths: [string, number][] = [
    ["#", X_NO], ["Code", X_CODE], ["Description", X_DESC],
    ["Qty", X_QTY], ["UOM", X_UOM], ["Unit Price", X_UNIT], ["Total", X_TOT],
  ];
  for (const [label, x] of ths) {
    const isRight = label === "Qty" || label === "Unit Price" || label === "Total";
    const tx = isRight ? x + (label === "Total" ? C_TOT : label === "Unit Price" ? C_UNIT : C_QTY) - fontB.widthOfTextAtSize(label, 7.5) - 2 : x + 2;
    draw(label, tx, y - TH + 8, fontB, 7.5, C_WHITE);
  }
  y -= TH + 2;

  // Rows
  const ROW = 14;
  for (const item of inv.items) {
    if (y < 120) { break; } // avoid overflow — simplified single-page
    const desc = trunc(item.description ?? "", fontR, 8, C_DESC - 4);
    const code = trunc(item.productCode ?? "", fontR, 7.5, C_CODE - 4);
    draw(String(item.rowNo ?? ""), X_NO + 2, y, fontR, 8);
    draw(code, X_CODE + 2, y, fontR, 7.5, C_MUTED);
    draw(desc, X_DESC + 2, y, fontR, 8);
    const qty = san(item.qty ?? "");
    draw(qty, X_QTY + C_QTY - fontR.widthOfTextAtSize(qty, 8) - 2, y, fontR, 8);
    draw(san(item.uom ?? ""), X_UOM + 2, y, fontR, 8, C_MUTED);
    const up = fmtMoney(item.unitPrice);
    draw(up, X_UNIT + C_UNIT - fontR.widthOfTextAtSize(up, 8) - 2, y, fontR, 8);
    const tot = fmtMoney(item.totalPrice);
    draw(tot, X_TOT + C_TOT - fontR.widthOfTextAtSize(tot, 8) - 2, y, fontB, 8);
    y -= ROW;
    line(ML, y + 2, ML + CW, y + 2, C_LINE, 0.3);
  }

  // Expenses
  if (inv.expenses.length > 0) {
    y -= 4;
    for (const exp of inv.expenses) {
      draw(san(exp.description ?? ""), X_DESC + 2, y, fontR, 8, C_MUTED);
      const amt = fmtMoney(exp.amount);
      draw(amt, X_TOT + C_TOT - fontR.widthOfTextAtSize(amt, 8) - 2, y, fontR, 8);
      y -= ROW;
    }
  }

  // ── Totals ───────────────────────────────────────────────────────────────────
  y -= 6;
  line(ML, y, ML + CW, y);
  y -= 14;

  const totX = ML + CW * 0.6;
  const totW = CW * 0.4;

  const totRow = (label: string, value: string, bold = false) => {
    draw(label, totX, y, fontR, 8.5, C_MUTED);
    const vw = (bold ? fontB : fontR).widthOfTextAtSize(san(value), 9);
    draw(value, totX + totW - vw, y, bold ? fontB : fontR, 9);
    y -= 14;
  };

  totRow("Subtotal", `MYR ${fmtMoney(inv.subtotal)}`);
  if (parseFloat(inv.overallDiscountAmt ?? "0") > 0)
    totRow("Discount", `- MYR ${fmtMoney(inv.overallDiscountAmt)}`);
  if (parseFloat(inv.sstPct ?? "0") > 0)
    totRow(`SST (${inv.sstPct}%)`, `MYR ${fmtMoney(inv.sst)}`);

  // Grand total bar
  y -= 4;
  rect(totX - 4, y - 4, totW + 4, 20, C_DARK);
  draw("GRAND TOTAL", totX, y + 4, fontB, 9, C_WHITE);
  const gt = `MYR ${fmtMoney(inv.grandTotal)}`;
  const gtW = fontB.widthOfTextAtSize(gt, 10);
  draw(gt, totX + totW - gtW, y + 3, fontB, 10, C_WHITE);
  y -= 26;

  // ── Notes ────────────────────────────────────────────────────────────────────
  if (inv.notes) {
    y -= 6;
    draw("Notes:", ML, y, fontB, 8, C_MUTED);
    y -= 12;
    draw(san(inv.notes).slice(0, 300), ML, y, fontR, 8, C_MUTED);
  }

  // ── Footer ───────────────────────────────────────────────────────────────────
  const footY = MB + 10;
  line(ML, footY, ML + CW, footY, C_LINE);
  draw("Generated by nixcript", ML, footY - 10, fontR, 7, C_MUTED);

  return pdfDoc.save();
}
