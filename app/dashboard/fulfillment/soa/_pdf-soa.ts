/**
 * Statement of Account — pdf-lib generator
 *
 * Exported:
 *   generateSoaPdf(soa, orgProfile)         → all hospitals in one PDF
 *   generateSoaPdfForOrg(org, orgProfile)   → single-hospital PDF
 */

import { PDFDocument, PDFPage, PDFFont, PDFImage, rgb, StandardFonts } from "pdf-lib";
import { type SoaOrganization } from "@/server/invoice";
import { type FullOrganizationProfile } from "@/server/organization-profile";

// ── A4 ────────────────────────────────────────────────────────────────────────
const W   = 595.28;
const H   = 841.89;
const ML  = 32;
const MR  = 32;
const MT  = 32;
const MB  = 32;
const CW  = W - ML - MR; // 531.28

// ── Palette ───────────────────────────────────────────────────────────────────
const C_BLACK   = rgb(0,     0,     0    );
const C_TEXT    = rgb(0.10,  0.10,  0.10 );
const C_MUTED   = rgb(0.40,  0.40,  0.40 );
const C_FAINT   = rgb(0.60,  0.60,  0.60 );
const C_LINE    = rgb(0.84,  0.84,  0.84 );
const C_WHITE   = rgb(1,     1,     1    );
const C_HOSP_BG = rgb(0.13,  0.13,  0.13 );
const C_THDR_BG = rgb(0.25,  0.25,  0.25 );
const C_FOOT_BG = rgb(0.91,  0.91,  0.91 );
const C_ROW_ALT = rgb(0.975, 0.975, 0.975);
const C_RED     = rgb(0.72,  0.10,  0.10 );
const C_AMBER   = rgb(0.57,  0.25,  0.05 );
const C_GREEN   = rgb(0.09,  0.40,  0.20 );

// ── Column widths (must sum to CW = 531.28) ───────────────────────────────────
const C_NO     = 20;
const C_INVNO  = 90;
const C_DATE   = 55;
const C_PO     = 80;
const C_CASE   = 72;
const C_STATUS = 48;
const C_AMT    = 83;
const C_OUT    = CW - C_NO - C_INVNO - C_DATE - C_PO - C_CASE - C_STATUS - C_AMT; // 83.28

const X_NO     = ML;
const X_INVNO  = X_NO     + C_NO;
const X_DATE   = X_INVNO  + C_INVNO;
const X_PO     = X_DATE   + C_DATE;
const X_CASE   = X_PO     + C_PO;
const X_STATUS = X_CASE   + C_CASE;
const X_AMT    = X_STATUS + C_STATUS;
const X_OUT    = X_AMT    + C_AMT;

// ── Row heights ───────────────────────────────────────────────────────────────
const ROW_H      = 16;   // data row
const HOSP_HDR_H = 28;   // hospital name bar (2 text lines)
const TBL_HDR_H  = 17;   // column header row
const FOOT_ROW_H = 19;   // per-hospital totals footer
const PAGE_FTR_H = 28;   // reserved at bottom for page footer
const COL_PAD    = 4;    // horizontal padding inside cells

// ── String helpers ────────────────────────────────────────────────────────────
function san(t: string): string {
  return String(t).replace(/[\x00-\x1F\x7F]/g, " ");
}

function trunc(
  text: string | null | undefined,
  font: PDFFont,
  size: number,
  maxW: number,
): string {
  if (!text) return "";
  const t = san(text).trim();
  if (!t || maxW <= 0) return "";
  if (font.widthOfTextAtSize(t, size) <= maxW) return t;
  let s = t;
  while (s.length > 0 && font.widthOfTextAtSize(s + "…", size) > maxW) s = s.slice(0, -1);
  return s.length ? s + "…" : "";
}

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-MY", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

function fmtMoney(v: number | string | null | undefined): string {
  const n = typeof v === "string" ? parseFloat(v) : Number(v ?? 0);
  return (isNaN(n) ? 0 : n).toLocaleString("en-MY", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
}

function statusLabel(s: string): string {
  const MAP: Record<string, string> = {
    draft: "Draft", sent: "Sent", paid: "Paid",
    overdue: "Overdue", cancelled: "Cancelled",
  };
  return MAP[s] ?? s;
}

// ── Drawing context ───────────────────────────────────────────────────────────
interface Ctx {
  pdfDoc:     PDFDocument;
  fontR:      PDFFont;
  fontB:      PDFFont;
  logoImg:    PDFImage | null;
  orgProfile: FullOrganizationProfile;
  pages:      PDFPage[];
  pageNo:     number;
  curY:       number;
  page:       PDFPage;
  docDate:    string;
}

function addPage(ctx: Ctx): void {
  const page = ctx.pdfDoc.addPage([W, H]);
  ctx.pages.push(page);
  ctx.page  = page;
  ctx.pageNo = ctx.pages.length;
  ctx.curY  = H - MT;
}

function ensureSpace(ctx: Ctx, needed: number): void {
  if (ctx.curY - needed < MB + PAGE_FTR_H) addPage(ctx);
}

// ── Page header ───────────────────────────────────────────────────────────────
function drawPageHeader(ctx: Ctx): void {
  const { fontR, fontB, logoImg, orgProfile } = ctx;
  const {
    companyName, companyAddress, phone, email, website,
    newSsmNo, oldSsmNo, mdaEstablishmentNo, taxNo,
  } = orgProfile;

  const nameSize = (
    { small: 10, medium: 13, large: 16, xlarge: 20 } as Record<string, number>
  )[orgProfile.orgNameSize ?? "medium"] ?? 13;
  const nameFont = orgProfile.orgNameBold ? fontB : fontR;
  const dispName = orgProfile.orgNameUppercase
    ? (companyName ?? "").toUpperCase()
    : (companyName ?? "");

  const startY = ctx.curY;

  // ── Right column: SOA label + date ─────────────────────────────────────────
  const SOA_LABEL = "STATEMENT OF ACCOUNT";
  const SOA_SZ    = 11;
  const soaW      = fontB.widthOfTextAtSize(SOA_LABEL, SOA_SZ);
  ctx.page.drawText(SOA_LABEL, {
    x: W - MR - soaW, y: startY - SOA_SZ,
    size: SOA_SZ, font: fontB, color: C_BLACK,
  });

  const dateStr = `As at: ${ctx.docDate}`;
  const dateW   = fontR.widthOfTextAtSize(dateStr, 8);
  ctx.page.drawText(dateStr, {
    x: W - MR - dateW, y: startY - SOA_SZ - 12,
    size: 8, font: fontR, color: C_MUTED,
  });

  // ── Left column: logo + company info ───────────────────────────────────────
  // Reserve space for the right column so they never overlap
  const RIGHT_RESERVE = soaW + 16;
  let   textX         = ML;
  let   logoLh        = 0;

  const LOGO_H_MAX = 40, LOGO_W_MAX = 96;

  if (logoImg) {
    const scale = Math.min(LOGO_H_MAX / logoImg.height, LOGO_W_MAX / logoImg.width);
    const lw    = logoImg.width  * scale;
    logoLh       = logoImg.height * scale;
    ctx.page.drawImage(logoImg, { x: ML, y: startY - logoLh, width: lw, height: logoLh });
    textX = ML + lw + 8;
  }

  const textZoneW = W - MR - RIGHT_RESERVE - textX;

  let cy = startY;
  ctx.page.drawText(trunc(dispName, nameFont, nameSize, textZoneW), {
    x: textX, y: cy - nameSize, size: nameSize, font: nameFont, color: C_TEXT,
  });
  cy -= nameSize + 7;

  const infoSz = 7.5;
  const infoLH = 10;

  if (companyAddress) {
    ctx.page.drawText(trunc(companyAddress, fontR, infoSz, textZoneW), {
      x: textX, y: cy, size: infoSz, font: fontR, color: C_MUTED,
    });
    cy -= infoLH;
  }

  const regParts: string[] = [];
  if (newSsmNo || oldSsmNo)
    regParts.push(
      newSsmNo && oldSsmNo
        ? `SSM: ${newSsmNo} (${oldSsmNo})`
        : `SSM: ${newSsmNo ?? oldSsmNo ?? ""}`,
    );
  if (mdaEstablishmentNo) regParts.push(`MDA: ${mdaEstablishmentNo}`);
  if (taxNo)              regParts.push(`Tax: ${taxNo}`);
  if (regParts.length) {
    ctx.page.drawText(trunc(regParts.join("  ·  "), fontR, infoSz, textZoneW), {
      x: textX, y: cy, size: infoSz, font: fontR, color: C_MUTED,
    });
    cy -= infoLH;
  }

  const contactParts = ([email, website, phone].filter(Boolean) as string[]).map(san);
  if (contactParts.length) {
    ctx.page.drawText(trunc(contactParts.join("  ·  "), fontR, infoSz, textZoneW), {
      x: textX, y: cy, size: infoSz, font: fontR, color: C_FAINT,
    });
    cy -= infoLH;
  }

  // curY = bottom of the taller of left or right columns
  const leftBottom  = cy;
  const rightBottom = startY - SOA_SZ - 12 - 10; // after date line
  ctx.curY = Math.min(leftBottom, rightBottom) - 8;

  // Thick divider
  ctx.page.drawLine({
    start: { x: ML,     y: ctx.curY },
    end:   { x: W - MR, y: ctx.curY },
    thickness: 0.9, color: C_BLACK,
  });
  ctx.curY -= 10;
}

// ── Page footer (stamped after all pages are known) ───────────────────────────
function drawPageFooter(ctx: Ctx, totalPages: number): void {
  const fY = MB + 8;
  ctx.page.drawLine({
    start: { x: ML,     y: fY + 13 },
    end:   { x: W - MR, y: fY + 13 },
    thickness: 0.35, color: C_LINE,
  });
  ctx.page.drawText("Statement of Account — Computer generated document.", {
    x: ML, y: fY, size: 7, font: ctx.fontR, color: C_FAINT,
  });
  const pg  = `Page ${ctx.pageNo} of ${totalPages}`;
  const pgW = ctx.fontR.widthOfTextAtSize(pg, 7);
  ctx.page.drawText(pg, { x: W - MR - pgW, y: fY, size: 7, font: ctx.fontR, color: C_FAINT });
}

// ── Table column header ───────────────────────────────────────────────────────
function drawTableHeader(ctx: Ctx): void {
  const y = ctx.curY;

  ctx.page.drawRectangle({
    x: ML, y: y - TBL_HDR_H, width: CW, height: TBL_HDR_H,
    color: C_THDR_BG,
  });

  type ColDef = { label: string; x: number; w: number; align: "left" | "right" | "center" };
  const cols: ColDef[] = [
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
    const tw = ctx.fontB.widthOfTextAtSize(col.label, sz);
    let tx: number;
    if      (col.align === "center") tx = col.x + (col.w - tw) / 2;
    else if (col.align === "right")  tx = col.x + col.w - COL_PAD - tw;
    else                             tx = col.x + COL_PAD;
    ctx.page.drawText(col.label, {
      x: tx, y: y - TBL_HDR_H + 5,
      size: sz, font: ctx.fontB, color: C_WHITE,
    });
  }

  ctx.curY -= TBL_HDR_H;
}

// ── Hospital header bar (2-line layout, no text overlap) ─────────────────────
function drawHospitalHeader(ctx: Ctx, org: SoaOrganization): void {
  const { fontR, fontB } = ctx;
  const y = ctx.curY;

  ctx.page.drawRectangle({
    x: ML, y: y - HOSP_HDR_H, width: CW, height: HOSP_HDR_H,
    color: C_HOSP_BG,
  });

  // ── Left section (max 55% of CW) ──────────────────────────────────────────
  const LEFT_MAX_W = CW * 0.52;

  // Line 1 (top): hospital name (bold, 9pt)
  const nameStr = trunc(org.organizationName, fontB, 9, LEFT_MAX_W - COL_PAD * 2);
  ctx.page.drawText(nameStr, {
    x: ML + COL_PAD, y: y - 12,
    size: 9, font: fontB, color: C_WHITE,
  });

  // Line 2 (bottom): invoice count (regular, 7pt)
  const countStr = `${org.invoices.length} invoice${org.invoices.length !== 1 ? "s" : ""}`;
  ctx.page.drawText(countStr, {
    x: ML + COL_PAD, y: y - HOSP_HDR_H + 7,
    size: 7, font: fontR, color: rgb(0.65, 0.65, 0.65),
  });

  // ── Right section (from RIGHT_START to W - MR) ────────────────────────────
  // Compute amount strings first so we know their widths
  const billedStr = `Billed: MYR ${fmtMoney(org.totalBilled)}`;
  const outStr    = org.outstanding > 0
    ? `Outstanding: MYR ${fmtMoney(org.outstanding)}`
    : "Fully paid";

  const RIGHT_MAX_W = CW - LEFT_MAX_W - 8;
  const outColor = org.outstanding > 0
    ? (org.overdueCount > 0 ? rgb(1, 0.5, 0.5) : rgb(1, 0.78, 0.4))
    : rgb(0.5, 0.9, 0.6);

  // Line 1 (top): outstanding — right-aligned
  const outTrunc = trunc(outStr, fontB, 8, RIGHT_MAX_W);
  const outW     = fontB.widthOfTextAtSize(outTrunc, 8);
  ctx.page.drawText(outTrunc, {
    x: W - MR - outW, y: y - 12,
    size: 8, font: fontB, color: outColor,
  });

  // Line 2 (bottom): billed — right-aligned
  const bilTrunc = trunc(billedStr, fontR, 7, RIGHT_MAX_W);
  const bilW     = fontR.widthOfTextAtSize(bilTrunc, 7);
  ctx.page.drawText(bilTrunc, {
    x: W - MR - bilW, y: y - HOSP_HDR_H + 7,
    size: 7, font: fontR, color: rgb(0.65, 0.65, 0.65),
  });

  ctx.curY -= HOSP_HDR_H;
}

// ── Invoice row ───────────────────────────────────────────────────────────────
function drawInvoiceRow(
  ctx: Ctx,
  inv: SoaOrganization["invoices"][number],
  idx: number,
): void {
  const { fontR, fontB } = ctx;
  const y      = ctx.curY;
  const isAlt  = idx % 2 === 1;

  if (isAlt) {
    ctx.page.drawRectangle({
      x: ML, y: y - ROW_H, width: CW, height: ROW_H,
      color: C_ROW_ALT,
    });
  }

  const base = y - ROW_H + 5; // text baseline
  const sz   = 7.5;

  // # (centered)
  const noStr = String(idx + 1);
  const noW   = fontR.widthOfTextAtSize(noStr, sz - 1);
  ctx.page.drawText(noStr, {
    x: X_NO + (C_NO - noW) / 2, y: base,
    size: sz - 1, font: fontR, color: C_FAINT,
  });

  // Invoice No. (left, bold)
  ctx.page.drawText(trunc(inv.invoiceNo, fontB, sz, C_INVNO - COL_PAD * 2), {
    x: X_INVNO + COL_PAD, y: base,
    size: sz, font: fontB, color: C_TEXT,
  });

  // Date (left)
  ctx.page.drawText(fmtDate(inv.invoiceDate), {
    x: X_DATE + COL_PAD, y: base,
    size: sz - 1, font: fontR, color: C_MUTED,
  });

  // Customer PO (left)
  ctx.page.drawText(trunc(inv.customerPoNo ?? "—", fontR, sz - 1, C_PO - COL_PAD * 2), {
    x: X_PO + COL_PAD, y: base,
    size: sz - 1, font: fontR, color: C_TEXT,
  });

  // Case (left)
  ctx.page.drawText(trunc(inv.caseType ?? "—", fontR, sz - 1, C_CASE - COL_PAD * 2), {
    x: X_CASE + COL_PAD, y: base,
    size: sz - 1, font: fontR, color: C_TEXT,
  });

  // Status (centred, coloured)
  const stLabel = statusLabel(inv.status);
  const stColor =
    inv.status === "paid"      ? C_GREEN :
    inv.status === "overdue"   ? C_RED   :
    inv.status === "cancelled" ? C_FAINT :
    inv.status === "sent"      ? rgb(0.10, 0.30, 0.65) : C_MUTED;
  const stStr = trunc(stLabel, fontR, sz - 1, C_STATUS - COL_PAD * 2);
  const stW   = fontR.widthOfTextAtSize(stStr, sz - 1);
  ctx.page.drawText(stStr, {
    x: X_STATUS + (C_STATUS - stW) / 2, y: base,
    size: sz - 1, font: fontR, color: stColor,
  });

  // Amount (right-aligned)
  const amtStr = fmtMoney(inv.grandTotal);
  const amtW   = fontR.widthOfTextAtSize(amtStr, sz);
  ctx.page.drawText(amtStr, {
    x: X_AMT + C_AMT - COL_PAD - amtW, y: base,
    size: sz, font: fontR, color: C_TEXT,
  });

  // Outstanding (right-aligned, coloured)
  const outstanding =
    inv.status === "paid" || inv.status === "cancelled"
      ? 0
      : Math.max(
          0,
          parseFloat(inv.grandTotal   || "0") -
          parseFloat(inv.paidAmount ?? "0"),
        );

  if (outstanding > 0) {
    const outStr   = fmtMoney(outstanding);
    const outW     = fontB.widthOfTextAtSize(outStr, sz);
    const outColor = inv.status === "overdue" ? C_RED : C_AMBER;
    ctx.page.drawText(outStr, {
      x: X_OUT + C_OUT - COL_PAD - outW, y: base,
      size: sz, font: fontB, color: outColor,
    });
  } else {
    const dashW = fontR.widthOfTextAtSize("—", sz - 1);
    ctx.page.drawText("—", {
      x: X_OUT + C_OUT - COL_PAD - dashW, y: base,
      size: sz - 1, font: fontR, color: C_FAINT,
    });
  }

  // Row divider
  ctx.page.drawLine({
    start: { x: ML,     y: y - ROW_H },
    end:   { x: W - MR, y: y - ROW_H },
    thickness: 0.3, color: C_LINE,
  });

  ctx.curY -= ROW_H;
}

// ── Hospital totals footer ────────────────────────────────────────────────────
function drawHospitalFooter(ctx: Ctx, org: SoaOrganization): void {
  const { fontR, fontB } = ctx;
  const y = ctx.curY;

  ctx.page.drawRectangle({
    x: ML, y: y - FOOT_ROW_H, width: CW, height: FOOT_ROW_H,
    color: C_FOOT_BG,
  });

  const base = y - FOOT_ROW_H + 6;

  // Left: label
  const lbl = `${org.invoices.length} invoice${org.invoices.length !== 1 ? "s" : ""}  ·  Total`;
  ctx.page.drawText(lbl, {
    x: ML + COL_PAD, y: base,
    size: 7.5, font: fontB, color: C_TEXT,
  });

  // Middle: collected — capped to stay left of AMT column
  const collStr = `Collected: MYR ${fmtMoney(org.totalPaid)}`;
  const collMaxW = X_AMT - ML - COL_PAD - fontB.widthOfTextAtSize(lbl, 7.5) - 24;
  if (collMaxW > 40) {
    const collTrunc = trunc(collStr, fontR, 7, collMaxW);
    const collW     = fontR.widthOfTextAtSize(collTrunc, 7);
    // right-align it to X_AMT - 12
    ctx.page.drawText(collTrunc, {
      x: X_AMT - collW - 12, y: base,
      size: 7, font: fontR, color: C_GREEN,
    });
  }

  // AMT column: total billed (right-aligned)
  const bilStr = fmtMoney(org.totalBilled);
  const bilW   = fontB.widthOfTextAtSize(bilStr, 8);
  ctx.page.drawText(bilStr, {
    x: X_AMT + C_AMT - COL_PAD - bilW, y: base,
    size: 8, font: fontB, color: C_TEXT,
  });

  // OUT column: outstanding (right-aligned, coloured)
  if (org.outstanding > 0) {
    const outStr   = fmtMoney(org.outstanding);
    const outW     = fontB.widthOfTextAtSize(outStr, 8);
    const outColor = org.overdueCount > 0 ? C_RED : C_AMBER;
    ctx.page.drawText(outStr, {
      x: X_OUT + C_OUT - COL_PAD - outW, y: base,
      size: 8, font: fontB, color: outColor,
    });
  } else {
    ctx.page.drawText("—", {
      x: X_OUT + COL_PAD, y: base,
      size: 7.5, font: fontR, color: C_FAINT,
    });
  }

  ctx.curY -= FOOT_ROW_H;
}

// ── Grand totals (only shown when multiple hospitals) ─────────────────────────
function drawGrandTotals(ctx: Ctx, soa: SoaOrganization[]): void {
  const totalBilled      = soa.reduce((s, o) => s + o.totalBilled, 0);
  const totalCollected   = soa.reduce((s, o) => s + o.totalPaid, 0);
  const totalOutstanding = soa.reduce((s, o) => s + o.outstanding, 0);
  const totalHospitals   = soa.length;
  const totalInvoices    = soa.reduce((s, o) => s + o.invoices.length, 0);

  const BLOCK_H = 18 + 16 + 16 + 22 + 4; // header + 3 rows
  ensureSpace(ctx, BLOCK_H + 14);

  ctx.curY -= 12;

  // ── Block header ───────────────────────────────────────────────────────────
  // NOTE: ctx.page may have changed after ensureSpace — always use ctx.page
  ctx.page.drawRectangle({
    x: ML, y: ctx.curY - 18, width: CW, height: 18,
    color: C_BLACK,
  });
  ctx.page.drawText("GRAND TOTAL SUMMARY", {
    x: ML + COL_PAD, y: ctx.curY - 13,
    size: 8, font: ctx.fontB, color: C_WHITE,
  });
  const summStr = `${totalHospitals} hospital${totalHospitals !== 1 ? "s" : ""}  ·  ${totalInvoices} invoice${totalInvoices !== 1 ? "s" : ""}`;
  const summW   = ctx.fontR.widthOfTextAtSize(summStr, 7.5);
  ctx.page.drawText(summStr, {
    x: W - MR - summW, y: ctx.curY - 13,
    size: 7.5, font: ctx.fontR, color: rgb(0.65, 0.65, 0.65),
  });
  ctx.curY -= 18;

  // ── Summary rows ───────────────────────────────────────────────────────────
  const rows: [string, string, ReturnType<typeof rgb>][] = [
    ["Total Billed",      `MYR ${fmtMoney(totalBilled)}`,      C_TEXT  ],
    ["Total Collected",   `MYR ${fmtMoney(totalCollected)}`,   C_GREEN ],
    ["Total Outstanding", `MYR ${fmtMoney(totalOutstanding)}`,
      totalOutstanding > 0 ? C_AMBER : C_GREEN],
  ];

  for (let i = 0; i < rows.length; i++) {
    const [lbl, val, col] = rows[i];
    const isLast = i === rows.length - 1;
    const rowH   = isLast ? 22 : 16;
    const rowY   = ctx.curY;

    if (i % 2 === 1) {
      ctx.page.drawRectangle({
        x: ML, y: rowY - rowH, width: CW, height: rowH,
        color: C_ROW_ALT,
      });
    }

    const lblSz  = isLast ? 9   : 7.5;
    const valSz  = isLast ? 10  : 8.5;
    const valFnt = isLast ? ctx.fontB : ctx.fontR;
    const base   = rowY - rowH + (isLast ? 7 : 5);

    ctx.page.drawText(lbl, {
      x: ML + COL_PAD, y: base,
      size: lblSz, font: ctx.fontR, color: C_MUTED,
    });

    const valW = valFnt.widthOfTextAtSize(val, valSz);
    ctx.page.drawText(val, {
      x: W - MR - COL_PAD - valW, y: base,
      size: valSz, font: valFnt, color: col,
    });

    if (isLast) {
      ctx.page.drawLine({
        start: { x: ML, y: rowY },
        end:   { x: W - MR, y: rowY },
        thickness: 0.8, color: C_BLACK,
      });
      ctx.page.drawLine({
        start: { x: ML, y: rowY - rowH },
        end:   { x: W - MR, y: rowY - rowH },
        thickness: 0.8, color: C_BLACK,
      });
    } else {
      ctx.page.drawLine({
        start: { x: ML, y: rowY - rowH },
        end:   { x: W - MR, y: rowY - rowH },
        thickness: 0.3, color: C_LINE,
      });
    }

    ctx.curY -= rowH;
  }
}

// ── Core draw loop (shared by full and per-org) ───────────────────────────────
async function buildContext(
  pdfDoc:     PDFDocument,
  orgProfile: FullOrganizationProfile,
): Promise<Ctx> {
  const fontR = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontB = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

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

  const docDate = new Date().toLocaleDateString("en-MY", {
    day: "2-digit", month: "long", year: "numeric",
  });

  return {
    pdfDoc, fontR, fontB, logoImg, orgProfile,
    pages: [], pageNo: 0, curY: 0,
    page: null as unknown as PDFPage,
    docDate,
  };
}

function drawHospitalSection(ctx: Ctx, org: SoaOrganization): void {
  // Need room for: hospital header + table header + at least 2 rows + footer
  const minNeeded = HOSP_HDR_H + TBL_HDR_H + ROW_H * 2 + FOOT_ROW_H;
  if (ctx.curY - minNeeded < MB + PAGE_FTR_H) addPage(ctx);

  drawHospitalHeader(ctx, org);
  drawTableHeader(ctx);

  for (let i = 0; i < org.invoices.length; i++) {
    const isLastRow = i === org.invoices.length - 1;
    const needed    = ROW_H + (isLastRow ? FOOT_ROW_H : 0);

    if (ctx.curY - needed < MB + PAGE_FTR_H) {
      addPage(ctx);
      // Continuation label
      const contLabel = trunc(org.organizationName, ctx.fontB, 7.5, CW * 0.55) + " (continued)";
      ctx.page.drawText(contLabel, {
        x: ML, y: ctx.curY - 11,
        size: 7.5, font: ctx.fontB, color: C_MUTED,
      });
      ctx.curY -= 15;
      drawTableHeader(ctx);
    }

    drawInvoiceRow(ctx, org.invoices[i], i);
  }

  // Footer row
  ensureSpace(ctx, FOOT_ROW_H);
  drawHospitalFooter(ctx, org);
  ctx.curY -= 10;
}

function stampFooters(ctx: Ctx): void {
  const totalPages = ctx.pages.length;
  const savedPage  = ctx.page;
  const savedY     = ctx.curY;
  const savedNo    = ctx.pageNo;

  for (let pi = 0; pi < ctx.pages.length; pi++) {
    ctx.page   = ctx.pages[pi];
    ctx.pageNo = pi + 1;
    drawPageFooter(ctx, totalPages);
  }

  ctx.page   = savedPage;
  ctx.curY   = savedY;
  ctx.pageNo = savedNo;
}

// ── Public: full SOA (all hospitals) ─────────────────────────────────────────
export async function generateSoaPdf(
  soa:        SoaOrganization[],
  orgProfile: FullOrganizationProfile,
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const ctx    = await buildContext(pdfDoc, orgProfile);

  addPage(ctx);
  drawPageHeader(ctx);

  for (const org of soa) {
    drawHospitalSection(ctx, org);
  }

  if (soa.length > 1) {
    drawGrandTotals(ctx, soa);
  }

  stampFooters(ctx);
  return pdfDoc.save();
}

// ── Public: single-hospital SOA ───────────────────────────────────────────────
export async function generateSoaPdfForOrg(
  org:        SoaOrganization,
  orgProfile: FullOrganizationProfile,
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const ctx    = await buildContext(pdfDoc, orgProfile);

  addPage(ctx);
  drawPageHeader(ctx);
  drawHospitalSection(ctx, org);
  stampFooters(ctx);
  return pdfDoc.save();
}
