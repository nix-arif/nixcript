/**
 * Statement of Account — pdf-lib generator
 *
 * Layout per hospital:
 *   ┌──────────────────────────────────────────────────────┐
 *   │  HOSPITAL NAME (dark header bar)  invoices  MYR …    │
 *   ├──────────────────────────────────────────────────────┤
 *   │ # │ Invoice No. │ Date │ Customer PO │ Case │ Status │ Amount │ Outstanding │
 *   │ … rows …                                             │
 *   ├──────────────────────────────────────────────────────┤
 *   │  Totals footer row                                   │
 *   └──────────────────────────────────────────────────────┘
 */

import { PDFDocument, PDFPage, PDFFont, PDFImage, rgb, StandardFonts } from "pdf-lib";
import { type SoaOrganization } from "@/server/invoice";
import { type FullOrganizationProfile } from "@/server/organization-profile";

// ── A4 ────────────────────────────────────────────────────────────────────────
const W   = 595.28;
const H   = 841.89;
const ML  = 32;
const MR  = 32;
const MT  = 30;
const MB  = 30;
const CW  = W - ML - MR; // 531.28

// ── Palette ───────────────────────────────────────────────────────────────────
const C_BLACK    = rgb(0,     0,    0);
const C_TEXT     = rgb(0.10,  0.10, 0.10);
const C_MUTED    = rgb(0.40,  0.40, 0.40);
const C_FAINT    = rgb(0.60,  0.60, 0.60);
const C_LINE     = rgb(0.85,  0.85, 0.85);
const C_WHITE    = rgb(1,     1,    1);
const C_HOSP_BG  = rgb(0.13,  0.13, 0.13);
const C_THDR_BG  = rgb(0.25,  0.25, 0.25);
const C_FOOT_BG  = rgb(0.92,  0.92, 0.92);
const C_ROW_ALT  = rgb(0.975, 0.975,0.975);
const C_RED      = rgb(0.72,  0.10, 0.10);
const C_AMBER    = rgb(0.57,  0.25, 0.05);
const C_GREEN    = rgb(0.09,  0.40, 0.20);

// ── Column widths ─────────────────────────────────────────────────────────────
const C_NO     = 20;
const C_INVNO  = 90;
const C_DATE   = 55;
const C_PO     = 82;
const C_CASE   = 70;
const C_STATUS = 50;
const C_AMT    = 82;
const C_OUT    = CW - C_NO - C_INVNO - C_DATE - C_PO - C_CASE - C_STATUS - C_AMT; // ~82

const X_NO     = ML;
const X_INVNO  = X_NO     + C_NO;
const X_DATE   = X_INVNO  + C_INVNO;
const X_PO     = X_DATE   + C_DATE;
const X_CASE   = X_PO     + C_PO;
const X_STATUS = X_CASE   + C_CASE;
const X_AMT    = X_STATUS + C_STATUS;
const X_OUT    = X_AMT    + C_AMT;

// ── Row heights ───────────────────────────────────────────────────────────────
const ROW_H      = 15;
const HOSP_HDR_H = 22;
const TBL_HDR_H  = 16;
const FOOT_ROW_H = 18;
const PAGE_FTR_H = 24; // reserved at bottom for page footer
const COL_PAD    = 4;  // horizontal text padding inside cells

// ── String helpers ────────────────────────────────────────────────────────────
function san(t: string): string { return String(t).replace(/[\x00-\x1F\x7F]/g, " "); }

function trunc(text: string | null | undefined, font: PDFFont, size: number, maxW: number): string {
  if (!text) return "";
  const t = san(text).trim();
  if (!t) return "";
  if (font.widthOfTextAtSize(t, size) <= maxW) return t;
  let s = t;
  while (s.length > 0 && font.widthOfTextAtSize(s + "…", size) > maxW) s = s.slice(0, -1);
  return s + "…";
}

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" });
}

function fmtMoney(v: number | string | null | undefined): string {
  const n = typeof v === "string" ? parseFloat(v) : Number(v ?? 0);
  return (isNaN(n) ? 0 : n).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function statusLabel(s: string): string {
  const map: Record<string, string> = {
    draft: "Draft", sent: "Sent", paid: "Paid",
    overdue: "Overdue", cancelled: "Cancelled",
  };
  return map[s] ?? s;
}

// ── Page management ───────────────────────────────────────────────────────────
interface Ctx {
  pdfDoc: PDFDocument;
  fontR: PDFFont;
  fontB: PDFFont;
  logoImg: PDFImage | null;
  orgProfile: FullOrganizationProfile;
  pages: PDFPage[];
  totalPages: number; // filled in after all pages created
  pageNo: number;
  curY: number;
  page: PDFPage;
  docDate: string;
}

function addPage(ctx: Ctx): void {
  const page = ctx.pdfDoc.addPage([W, H]);
  ctx.pages.push(page);
  ctx.page = page;
  ctx.pageNo = ctx.pages.length;
  ctx.curY = H - MT;
}

/** Check if `needed` pixels remain before page footer reserve. Add page if not. */
function ensureSpace(ctx: Ctx, needed: number): void {
  if (ctx.curY - needed < MB + PAGE_FTR_H) {
    addPage(ctx);
  }
}

// ── Header + info block ───────────────────────────────────────────────────────
function drawPageHeader(ctx: Ctx): void {
  const { page, fontR, fontB, logoImg, orgProfile } = ctx;
  const { companyName, companyAddress, phone, email, website, newSsmNo, oldSsmNo, mdaEstablishmentNo, taxNo } = orgProfile;
  const name = orgProfile.orgNameUppercase ? (companyName ?? "").toUpperCase() : (companyName ?? "");
  const nameSize = ({ small: 10, medium: 13, large: 16, xlarge: 20 } as Record<string, number>)[orgProfile.orgNameSize ?? "medium"] ?? 13;
  const nameFont = orgProfile.orgNameBold ? fontB : fontR;

  let cy = ctx.curY;

  // "STATEMENT OF ACCOUNT" — right-aligned large label
  const SOA_LABEL = "STATEMENT OF ACCOUNT";
  const SOA_SIZE  = 12;
  const soaW = fontB.widthOfTextAtSize(SOA_LABEL, SOA_SIZE);
  page.drawText(SOA_LABEL, {
    x: W - MR - soaW, y: cy - SOA_SIZE, size: SOA_SIZE, font: fontB, color: C_BLACK,
  });

  // Logo + company info
  let textX = ML;
  let logoLh = 0, logoLw = 0;
  const LOGO_H_MAX = 40, LOGO_W_MAX = 100;

  if (logoImg) {
    const scale = Math.min(LOGO_H_MAX / logoImg.height, LOGO_W_MAX / logoImg.width);
    logoLw = logoImg.width * scale;
    logoLh = logoImg.height * scale;
    page.drawImage(logoImg, { x: ML, y: cy - logoLh, width: logoLw, height: logoLh });
    textX = ML + logoLw + 8;
  }

  const textZoneW = W - MR - soaW - 12 - textX;

  page.drawText(trunc(name, nameFont, nameSize, textZoneW), {
    x: textX, y: cy - nameSize, size: nameSize, font: nameFont, color: C_TEXT,
  });
  cy -= nameSize + 8;

  const infoSz = 8;
  const infoLH = 10;

  if (companyAddress) {
    page.drawText(trunc(companyAddress, fontR, infoSz, textZoneW), {
      x: textX, y: cy, size: infoSz, font: fontR, color: C_MUTED,
    });
    cy -= infoLH;
  }

  const regParts: string[] = [];
  if (newSsmNo || oldSsmNo) regParts.push(newSsmNo && oldSsmNo ? `SSM: ${newSsmNo} (${oldSsmNo})` : `SSM: ${newSsmNo ?? oldSsmNo ?? ""}`);
  if (mdaEstablishmentNo) regParts.push(`MDA: ${mdaEstablishmentNo}`);
  if (taxNo) regParts.push(`Tax: ${taxNo}`);
  if (regParts.length) {
    page.drawText(trunc(regParts.join("  ·  "), fontR, 7.5, textZoneW), {
      x: textX, y: cy, size: 7.5, font: fontR, color: C_MUTED,
    });
    cy -= infoLH;
  }

  const contactParts = ([email, website, phone].filter(Boolean) as string[]).map(san);
  if (contactParts.length) {
    page.drawText(trunc(contactParts.join("  ·  "), fontR, 7.5, textZoneW), {
      x: textX, y: cy, size: 7.5, font: fontR, color: C_FAINT,
    });
    cy -= infoLH;
  }

  // Right column: "As at" date
  const dateStr = `As at: ${ctx.docDate}`;
  const dateW = fontR.widthOfTextAtSize(dateStr, 8);
  page.drawText(dateStr, { x: W - MR - dateW, y: cy + 10, size: 8, font: fontR, color: C_MUTED });

  const headerBottom = Math.min(cy, H - MT - Math.max(logoLh, nameSize + 8));
  ctx.curY = headerBottom - 6;

  // Thick divider
  page.drawLine({
    start: { x: ML, y: ctx.curY }, end: { x: W - MR, y: ctx.curY },
    thickness: 1.0, color: C_BLACK,
  });
  ctx.curY -= 10;
}

// ── Page footer ───────────────────────────────────────────────────────────────
function drawPageFooter(ctx: Ctx, totalPages: number): void {
  const { page, fontR } = ctx;
  const fY = MB + 10;
  page.drawLine({
    start: { x: ML, y: fY + 12 }, end: { x: W - MR, y: fY + 12 },
    thickness: 0.4, color: C_LINE,
  });
  page.drawText("Statement of Account — Computer generated document.", {
    x: ML, y: fY, size: 7, font: fontR, color: C_FAINT,
  });
  const pg = `Page ${ctx.pageNo} of ${totalPages}`;
  const pgW = fontR.widthOfTextAtSize(pg, 7);
  page.drawText(pg, { x: W - MR - pgW, y: fY, size: 7, font: fontR, color: C_FAINT });
}

// ── Table column header row ───────────────────────────────────────────────────
function drawTableHeader(ctx: Ctx): void {
  const { page, fontB } = ctx;
  const y = ctx.curY;

  page.drawRectangle({ x: ML, y: y - TBL_HDR_H, width: CW, height: TBL_HDR_H, color: C_THDR_BG });

  const cols: { label: string; x: number; w: number; align: "left" | "right" | "center" }[] = [
    { label: "#",           x: X_NO,     w: C_NO,     align: "center" },
    { label: "INVOICE NO.", x: X_INVNO,  w: C_INVNO,  align: "left"   },
    { label: "DATE",        x: X_DATE,   w: C_DATE,   align: "left"   },
    { label: "CUSTOMER PO", x: X_PO,     w: C_PO,     align: "left"   },
    { label: "CASE",        x: X_CASE,   w: C_CASE,   align: "left"   },
    { label: "STATUS",      x: X_STATUS, w: C_STATUS, align: "center" },
    { label: "AMOUNT",      x: X_AMT,    w: C_AMT,    align: "right"  },
    { label: "OUTSTANDING", x: X_OUT,    w: C_OUT,    align: "right"  },
  ];

  const sz = 6.5;
  for (const col of cols) {
    const tw = fontB.widthOfTextAtSize(col.label, sz);
    let tx: number;
    if (col.align === "center") tx = col.x + (col.w - tw) / 2;
    else if (col.align === "right") tx = col.x + col.w - COL_PAD - tw;
    else tx = col.x + COL_PAD;
    page.drawText(col.label, { x: tx, y: y - TBL_HDR_H + 5, size: sz, font: fontB, color: C_WHITE });
  }

  ctx.curY -= TBL_HDR_H;
}

// ── Hospital header bar ───────────────────────────────────────────────────────
function drawHospitalHeader(ctx: Ctx, org: SoaOrganization): void {
  const { page, fontR, fontB } = ctx;
  const y = ctx.curY;

  page.drawRectangle({ x: ML, y: y - HOSP_HDR_H, width: CW, height: HOSP_HDR_H, color: C_HOSP_BG });

  // Hospital name
  const nameMaxW = CW * 0.55;
  const nameStr = trunc(org.organizationName, fontB, 9, nameMaxW);
  page.drawText(nameStr, { x: ML + COL_PAD, y: y - HOSP_HDR_H + 8, size: 9, font: fontB, color: C_WHITE });

  // Invoice count
  const countStr = `${org.invoices.length} invoice${org.invoices.length !== 1 ? "s" : ""}`;
  const countW = fontR.widthOfTextAtSize(countStr, 7.5);
  page.drawText(countStr, { x: ML + nameMaxW + 8, y: y - HOSP_HDR_H + 8, size: 7.5, font: fontR, color: rgb(0.7, 0.7, 0.7) });

  // Amounts (right side)
  const billedStr = `Billed: MYR ${fmtMoney(org.totalBilled)}`;
  const outStr    = `Outstanding: MYR ${fmtMoney(org.outstanding)}`;
  const outColor  = org.outstanding > 0 ? (org.overdueCount > 0 ? C_RED : rgb(1, 0.75, 0.4)) : rgb(0.6, 0.6, 0.6);

  const outW    = fontB.widthOfTextAtSize(outStr, 8);
  const billedW = fontR.widthOfTextAtSize(billedStr, 7.5);
  page.drawText(outStr,    { x: W - MR - outW,              y: y - HOSP_HDR_H + 8,  size: 8,   font: fontB, color: outColor });
  page.drawText(billedStr, { x: W - MR - outW - billedW - 16, y: y - HOSP_HDR_H + 8, size: 7.5, font: fontR, color: rgb(0.7, 0.7, 0.7) });

  ctx.curY -= HOSP_HDR_H;
}

// ── Invoice row ───────────────────────────────────────────────────────────────
function drawInvoiceRow(ctx: Ctx, inv: SoaOrganization["invoices"][number], idx: number): void {
  const { page, fontR, fontB } = ctx;
  const y = ctx.curY;
  const isAlt = idx % 2 === 1;

  if (isAlt) {
    page.drawRectangle({ x: ML, y: y - ROW_H, width: CW, height: ROW_H, color: C_ROW_ALT });
  }

  const baseline = y - ROW_H + 5;
  const sz = 7.5;

  // #
  const noStr = String(idx + 1);
  const noW = fontR.widthOfTextAtSize(noStr, sz - 0.5);
  page.drawText(noStr, { x: X_NO + (C_NO - noW) / 2, y: baseline, size: sz - 0.5, font: fontR, color: C_FAINT });

  // Invoice No.
  page.drawText(trunc(inv.invoiceNo, fontB, sz, C_INVNO - COL_PAD * 2), {
    x: X_INVNO + COL_PAD, y: baseline, size: sz, font: fontB, color: C_TEXT,
  });

  // Date
  page.drawText(fmtDate(inv.invoiceDate), {
    x: X_DATE + COL_PAD, y: baseline, size: sz - 0.5, font: fontR, color: C_MUTED,
  });

  // Customer PO
  const po = inv.customerPoNo ?? "—";
  page.drawText(trunc(po, fontR, sz - 0.5, C_PO - COL_PAD * 2), {
    x: X_PO + COL_PAD, y: baseline, size: sz - 0.5, font: fontR, color: C_TEXT,
  });

  // Case
  const caseStr = inv.caseType ?? "—";
  page.drawText(trunc(caseStr, fontR, sz - 0.5, C_CASE - COL_PAD * 2), {
    x: X_CASE + COL_PAD, y: baseline, size: sz - 0.5, font: fontR, color: C_TEXT,
  });

  // Status
  const stLabel = statusLabel(inv.status);
  const stW = fontR.widthOfTextAtSize(stLabel, sz - 0.5);
  const stColor =
    inv.status === "paid"      ? C_GREEN :
    inv.status === "overdue"   ? C_RED   :
    inv.status === "cancelled" ? C_FAINT :
    inv.status === "sent"      ? rgb(0.10, 0.30, 0.65) : C_MUTED;
  page.drawText(stLabel, {
    x: X_STATUS + (C_STATUS - stW) / 2, y: baseline, size: sz - 0.5, font: fontR, color: stColor,
  });

  // Amount (right-aligned)
  const amtStr = fmtMoney(inv.grandTotal);
  const amtW = fontR.widthOfTextAtSize(amtStr, sz);
  page.drawText(amtStr, {
    x: X_AMT + C_AMT - COL_PAD - amtW, y: baseline, size: sz, font: fontR, color: C_TEXT,
  });

  // Outstanding (right-aligned, coloured)
  const outstanding = inv.status === "paid" || inv.status === "cancelled"
    ? 0
    : Math.max(0, parseFloat(inv.grandTotal || "0") - parseFloat(inv.paidAmount || "0"));

  if (outstanding > 0) {
    const outStr = fmtMoney(outstanding);
    const outW = fontB.widthOfTextAtSize(outStr, sz);
    const outColor = inv.status === "overdue" ? C_RED : C_AMBER;
    page.drawText(outStr, {
      x: X_OUT + C_OUT - COL_PAD - outW, y: baseline, size: sz, font: fontB, color: outColor,
    });
  } else {
    const dashW = fontR.widthOfTextAtSize("—", sz - 0.5);
    page.drawText("—", {
      x: X_OUT + C_OUT - COL_PAD - dashW, y: baseline, size: sz - 0.5, font: fontR, color: C_FAINT,
    });
  }

  // Row bottom divider
  page.drawLine({
    start: { x: ML, y: y - ROW_H }, end: { x: W - MR, y: y - ROW_H },
    thickness: 0.3, color: C_LINE,
  });

  ctx.curY -= ROW_H;
}

// ── Hospital totals footer ────────────────────────────────────────────────────
function drawHospitalFooter(ctx: Ctx, org: SoaOrganization): void {
  const { page, fontR, fontB } = ctx;
  const y = ctx.curY;

  page.drawRectangle({ x: ML, y: y - FOOT_ROW_H, width: CW, height: FOOT_ROW_H, color: C_FOOT_BG });

  // Left: subtotals label
  page.drawText(`Total — ${org.invoices.length} invoice${org.invoices.length !== 1 ? "s" : ""}`, {
    x: ML + COL_PAD, y: y - FOOT_ROW_H + 6, size: 8, font: fontB, color: C_TEXT,
  });

  // Collected (right of label area)
  const paidStr = `Collected: MYR ${fmtMoney(org.totalPaid)}`;
  const paidW = fontR.widthOfTextAtSize(paidStr, 7.5);
  page.drawText(paidStr, {
    x: X_AMT - paidW - 8, y: y - FOOT_ROW_H + 6, size: 7.5, font: fontR, color: C_GREEN,
  });

  // Billed amount (right-aligned in AMT col)
  const billedStr = fmtMoney(org.totalBilled);
  const billedW = fontB.widthOfTextAtSize(billedStr, 8);
  page.drawText(billedStr, {
    x: X_AMT + C_AMT - COL_PAD - billedW, y: y - FOOT_ROW_H + 6, size: 8, font: fontB, color: C_TEXT,
  });

  // Outstanding (right-aligned in OUT col)
  if (org.outstanding > 0) {
    const outStr = fmtMoney(org.outstanding);
    const outW = fontB.widthOfTextAtSize(outStr, 8);
    const outColor = org.overdueCount > 0 ? C_RED : C_AMBER;
    page.drawText(outStr, {
      x: X_OUT + C_OUT - COL_PAD - outW, y: y - FOOT_ROW_H + 6, size: 8, font: fontB, color: outColor,
    });
  } else {
    page.drawText("Fully paid", {
      x: X_OUT + COL_PAD, y: y - FOOT_ROW_H + 6, size: 7.5, font: fontR, color: C_GREEN,
    });
  }

  ctx.curY -= FOOT_ROW_H;
}

// ── Grand totals block ────────────────────────────────────────────────────────
function drawGrandTotals(ctx: Ctx, soa: SoaOrganization[]): void {
  const { page, fontR, fontB } = ctx;

  const totalBilled      = soa.reduce((s, o) => s + o.totalBilled, 0);
  const totalCollected   = soa.reduce((s, o) => s + o.totalPaid, 0);
  const totalOutstanding = soa.reduce((s, o) => s + o.outstanding, 0);
  const totalHospitals   = soa.length;
  const totalInvoices    = soa.reduce((s, o) => s + o.invoices.length, 0);

  const BLOCK_H = 72;
  ensureSpace(ctx, BLOCK_H + 10);

  ctx.curY -= 12;
  const y = ctx.curY;

  // Header
  page.drawRectangle({ x: ML, y: y - 18, width: CW, height: 18, color: C_BLACK });
  page.drawText("GRAND TOTAL SUMMARY", {
    x: ML + COL_PAD, y: y - 13, size: 8, font: fontB, color: C_WHITE,
  });
  page.drawText(`${totalHospitals} hospital${totalHospitals !== 1 ? "s" : ""}  ·  ${totalInvoices} invoice${totalInvoices !== 1 ? "s" : ""}`, {
    x: W - MR - fontR.widthOfTextAtSize(`${totalHospitals} hospital${totalHospitals !== 1 ? "s" : ""}  ·  ${totalInvoices} invoice${totalInvoices !== 1 ? "s" : ""}`, 8),
    y: y - 13, size: 8, font: fontR, color: rgb(0.7, 0.7, 0.7),
  });
  ctx.curY -= 18;

  // Rows
  const rows: [string, string, any][] = [
    ["Total Billed",      `MYR ${fmtMoney(totalBilled)}`,      C_TEXT  ],
    ["Total Collected",   `MYR ${fmtMoney(totalCollected)}`,   C_GREEN ],
    ["Total Outstanding", `MYR ${fmtMoney(totalOutstanding)}`, totalOutstanding > 0 ? C_AMBER : C_GREEN],
  ];

  for (let i = 0; i < rows.length; i++) {
    const [lbl, val, color] = rows[i];
    const isLast = i === rows.length - 1;
    const rowY = ctx.curY;
    const rowH = isLast ? 22 : 16;

    if (i % 2 === 1) page.drawRectangle({ x: ML, y: rowY - rowH, width: CW, height: rowH, color: C_ROW_ALT });

    const lblSz = isLast ? 9 : 8;
    const valSz = isLast ? 10 : 8.5;
    const valFont = isLast ? fontB : fontR;

    page.drawText(lbl, { x: ML + COL_PAD, y: rowY - rowH + (isLast ? 7 : 5), size: lblSz, font: fontR, color: C_MUTED });

    const valStr = String(val);
    const valW = valFont.widthOfTextAtSize(valStr, valSz);
    page.drawText(valStr, { x: W - MR - COL_PAD - valW, y: rowY - rowH + (isLast ? 7 : 5), size: valSz, font: valFont, color: color });

    if (isLast) {
      page.drawLine({ start: { x: ML, y: rowY }, end: { x: W - MR, y: rowY }, thickness: 0.8, color: C_BLACK });
      page.drawLine({ start: { x: ML, y: rowY - rowH }, end: { x: W - MR, y: rowY - rowH }, thickness: 0.8, color: C_BLACK });
    } else {
      page.drawLine({ start: { x: ML, y: rowY - rowH }, end: { x: W - MR, y: rowY - rowH }, thickness: 0.3, color: C_LINE });
    }

    ctx.curY -= rowH;
  }
}

// ── Main export ───────────────────────────────────────────────────────────────
export async function generateSoaPdf(
  soa: SoaOrganization[],
  orgProfile: FullOrganizationProfile,
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const fontR  = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontB  = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // Try to embed logo
  let logoImg: PDFImage | null = null;
  const logoUrl = orgProfile.logo;
  if (logoUrl) {
    try {
      const res = await fetch(logoUrl);
      if (res.ok) {
        const buf = await res.arrayBuffer();
        logoImg = logoUrl.toLowerCase().includes(".png")
          ? await pdfDoc.embedPng(buf)
          : await pdfDoc.embedJpg(buf);
      }
    } catch { /* generate without logo */ }
  }

  const today = new Date();
  const docDate = today.toLocaleDateString("en-MY", { day: "2-digit", month: "long", year: "numeric" });

  // Context
  const ctx: Ctx = {
    pdfDoc, fontR, fontB, logoImg, orgProfile,
    pages: [], totalPages: 0,
    pageNo: 0, curY: 0,
    page: null as unknown as PDFPage,
    docDate,
  };

  // ── First page ──────────────────────────────────────────────────────────────
  addPage(ctx);
  drawPageHeader(ctx);

  // ── Hospital sections ───────────────────────────────────────────────────────
  for (const org of soa) {
    // Hospital header + table header needs enough room for at least 2 rows + footer
    const minNeeded = HOSP_HDR_H + TBL_HDR_H + ROW_H * 2 + FOOT_ROW_H;
    if (ctx.curY - minNeeded < MB + PAGE_FTR_H) {
      addPage(ctx);
    }

    // Hospital name header
    drawHospitalHeader(ctx, org);

    // Table column headers
    drawTableHeader(ctx);

    // Invoice rows
    for (let i = 0; i < org.invoices.length; i++) {
      const inv = org.invoices[i];
      const isLastRow = i === org.invoices.length - 1;

      // Check space: row + (footer if last)
      const needed = ROW_H + (isLastRow ? FOOT_ROW_H : 0);
      if (ctx.curY - needed < MB + PAGE_FTR_H) {
        addPage(ctx);
        // Repeat table header on continuation page
        const contTitle = trunc(org.organizationName, fontB, 7.5, CW * 0.6) + " (continued)";
        const contW = fontB.widthOfTextAtSize(contTitle, 7.5);
        ctx.page.drawText(contTitle, {
          x: ML, y: ctx.curY - 10, size: 7.5, font: fontB, color: C_MUTED,
        });
        ctx.curY -= 14;
        drawTableHeader(ctx);
      }

      drawInvoiceRow(ctx, inv, i);
    }

    // Hospital totals footer
    if (ctx.curY - FOOT_ROW_H < MB + PAGE_FTR_H) {
      addPage(ctx);
    }
    drawHospitalFooter(ctx, org);

    // Gap between hospitals
    ctx.curY -= 10;
  }

  // ── Grand totals ────────────────────────────────────────────────────────────
  drawGrandTotals(ctx, soa);

  // ── Stamp page footers now that we know total page count ────────────────────
  const totalPages = ctx.pages.length;
  for (let pi = 0; pi < ctx.pages.length; pi++) {
    const savedPage = ctx.page;
    const savedY    = ctx.curY;
    const savedNo   = ctx.pageNo;
    ctx.page  = ctx.pages[pi];
    ctx.pageNo = pi + 1;
    drawPageFooter(ctx, totalPages);
    ctx.page  = savedPage;
    ctx.curY  = savedY;
    ctx.pageNo = savedNo;
  }

  return pdfDoc.save();
}
