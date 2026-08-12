/**
 * Expense claim form — pdf-lib generator
 *
 * Form-only (letterhead, claim details, line items, totals, approval trail).
 * Receipt attachments are merged in by the caller (app/api/claim/[id]/pdf/route.ts)
 * after this document is generated, following the same copyPages/embedImage
 * pattern used by app/api/quotation/[id]/mda-certs/route.ts.
 *
 * Structure mirrors app/dashboard/fulfillment/soa/_pdf-soa.ts: a Ctx object
 * threaded through draw functions, addPage/ensureSpace for pagination, and a
 * two-pass stampFooters() once total page count is known.
 */

import { PDFDocument, PDFPage, PDFFont, PDFImage, rgb, StandardFonts } from "pdf-lib";
import { type FullOrganizationProfile } from "@/server/organization-profile";
import { type ClaimApplicationWithDetails } from "@/server/claim";
import { CLAIM_FORM, LINE_CATEGORY } from "@/lib/claim/constants";

// ── A4 ──────────────────────────────────────────────────────────────────────
const W  = 595.28;
const H  = 841.89;
const ML = 32;
const MR = 32;
const MT = 32;
const MB = 32;
const CW = W - ML - MR;

// ── Palette ─────────────────────────────────────────────────────────────────
const C_BLACK  = rgb(0, 0, 0);
const C_TEXT   = rgb(0.10, 0.10, 0.10);
const C_MUTED  = rgb(0.40, 0.40, 0.40);
const C_FAINT  = rgb(0.60, 0.60, 0.60);
const C_LINE   = rgb(0.84, 0.84, 0.84);
const C_WHITE  = rgb(1, 1, 1);
const C_THDR   = rgb(0.25, 0.25, 0.25);
const C_RED    = rgb(0.72, 0.10, 0.10);
const C_AMBER  = rgb(0.62, 0.42, 0.02);
const C_GREEN  = rgb(0.09, 0.40, 0.20);
const C_BLUE   = rgb(0.09, 0.29, 0.65);
const C_ROW_ALT = rgb(0.975, 0.975, 0.975);

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Draft", PENDING: "Pending", CHECKED: "Checked",
  APPROVED: "Approved", REJECTED: "Rejected", CANCELLED: "Cancelled",
};
const STATUS_COLOR: Record<string, ReturnType<typeof rgb>> = {
  DRAFT: C_MUTED, PENDING: C_AMBER, CHECKED: C_BLUE,
  APPROVED: C_GREEN, REJECTED: C_RED, CANCELLED: C_FAINT,
};

const SECTION_LABELS: Record<string, string> = {
  [LINE_CATEGORY.TRAVEL]:                "Travel",
  [LINE_CATEGORY.TRAVEL_ACCOMMODATION]:  "Accommodation",
  [LINE_CATEGORY.TRAVEL_DAILY_ALLOWANCE]:"Daily Allowance",
  [LINE_CATEGORY.TRAVEL_ENTERTAINMENT]:  "Travel Entertainment",
  [LINE_CATEGORY.TOLL]:                  "Toll / Touch N Go",
  [LINE_CATEGORY.PARKING]:               "Parking",
  [LINE_CATEGORY.MOBILE]:                "Mobile Phone",
  [LINE_CATEGORY.IN_BASE_ENT]:           "In-Base Entertainment",
  [LINE_CATEGORY.OTHER_LOCAL]:           "Other Expenses",
  [LINE_CATEGORY.OVERSEAS_MYR]:          "Travel (MYR)",
  [LINE_CATEGORY.OVERSEAS_FX]:           "Travel (Foreign Currency)",
  [LINE_CATEGORY.OVERSEAS_OTHER]:        "Other Expenses",
};

// ── String / format helpers ───────────────────────────────────────────────────
function san(t: string | null | undefined): string {
  return String(t ?? "").replace(/[\x00-\x1F\x7F]/g, " ");
}

function trunc(text: string | null | undefined, font: PDFFont, size: number, maxW: number): string {
  if (!text) return "";
  const t = san(text).trim();
  if (!t || maxW <= 0) return "";
  if (font.widthOfTextAtSize(t, size) <= maxW) return t;
  let s = t;
  while (s.length > 0 && font.widthOfTextAtSize(s + "…", size) > maxW) s = s.slice(0, -1);
  return s.length ? s + "…" : "";
}

// Word-wraps text into at most maxLines lines that fit maxW; ellipsizes the last line if it overflows.
function wrapLines(text: string | null | undefined, font: PDFFont, size: number, maxW: number, maxLines: number): string[] {
  const t = san(text).trim();
  if (!t) return [];
  const words = t.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const attempt = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(attempt, size) <= maxW) {
      cur = attempt;
    } else {
      if (cur) lines.push(cur);
      cur = w;
      if (lines.length >= maxLines) break;
    }
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  if (lines.length > maxLines) lines.length = maxLines;
  if (lines.length === maxLines) {
    const last = lines[maxLines - 1];
    lines[maxLines - 1] = trunc(last, font, size, maxW);
  }
  return lines;
}

function fmtMoney(v: number | string | null | undefined): string {
  const n = typeof v === "string" ? parseFloat(v) : Number(v ?? 0);
  return (isNaN(n) ? 0 : n).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" });
}

function fmtPeriod(claimDate: string): string {
  if (/^\d{4}-\d{2}-01$/.test(claimDate)) {
    const [year, month] = claimDate.split("-");
    return new Date(parseInt(year), parseInt(month) - 1, 1).toLocaleDateString("en-MY", { month: "long", year: "numeric" });
  }
  return claimDate;
}

function getFormType(claim: ClaimApplicationWithDetails): string {
  if (claim.entertainmentDetails.length > 0) return CLAIM_FORM.ENTERTAINMENT_FORM;
  const cat = claim.lineItems[0]?.category ?? "";
  return cat.startsWith("OVERSEAS") ? CLAIM_FORM.OVERSEAS : CLAIM_FORM.LOCAL;
}

// ── Column layout (line items table) ──────────────────────────────────────────
const C_NO   = 20;
const C_DATE = 55;
const C_CAT  = 92;
const C_AMT  = 75;
const C_DESC = CW - C_NO - C_DATE - C_CAT - C_AMT;
const X_NO   = ML;
const X_DATE = X_NO + C_NO;
const X_CAT  = X_DATE + C_DATE;
const X_DESC = X_CAT + C_CAT;
const X_AMT  = X_DESC + C_DESC;

const TBL_HDR_H  = 16;
const ROW_BASE_H = 15;
const NOTE_LINE_H = 10;
const PAGE_FTR_H = 24;
const COL_PAD    = 4;

// ── Ctx ─────────────────────────────────────────────────────────────────────
interface Ctx {
  pdfDoc:  PDFDocument;
  fontR:   PDFFont;
  fontB:   PDFFont;
  logoImg: PDFImage | null;
  orgProfile: FullOrganizationProfile;
  pages:   PDFPage[];
  pageNo:  number;
  curY:    number;
  page:    PDFPage;
}

function addPage(ctx: Ctx): void {
  const page = ctx.pdfDoc.addPage([W, H]);
  ctx.pages.push(page);
  ctx.page = page;
  ctx.pageNo = ctx.pages.length;
  ctx.curY = H - MT;
}

function ensureSpace(ctx: Ctx, needed: number): void {
  if (ctx.curY - needed < MB + PAGE_FTR_H) addPage(ctx);
}

async function buildContext(pdfDoc: PDFDocument, orgProfile: FullOrganizationProfile): Promise<Ctx> {
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

  return { pdfDoc, fontR, fontB, logoImg, orgProfile, pages: [], pageNo: 0, curY: 0, page: null as unknown as PDFPage };
}

// ── Letterhead ──────────────────────────────────────────────────────────────
function drawPageHeader(ctx: Ctx, claim: ClaimApplicationWithDetails): void {
  const { fontR, fontB, logoImg, orgProfile } = ctx;
  const { companyName, companyAddress, phone, email, website, newSsmNo, oldSsmNo, taxNo } = orgProfile;

  const nameSize = ({ small: 10, medium: 13, large: 16, xlarge: 20 } as Record<string, number>)[orgProfile.orgNameSize ?? "medium"] ?? 13;
  const nameFont = orgProfile.orgNameBold ? fontB : fontR;
  const dispName = orgProfile.orgNameUppercase ? (companyName ?? "").toUpperCase() : (companyName ?? "");

  const startY = ctx.curY;

  const LABEL = "EXPENSE CLAIM";
  const LABEL_SZ = 11;
  const labelW = fontB.widthOfTextAtSize(LABEL, LABEL_SZ);
  ctx.page.drawText(LABEL, { x: W - MR - labelW, y: startY - LABEL_SZ, size: LABEL_SZ, font: fontB, color: C_BLACK });

  const refStr = claim.applicationNo;
  const refW = fontR.widthOfTextAtSize(refStr, 8);
  ctx.page.drawText(refStr, { x: W - MR - refW, y: startY - LABEL_SZ - 12, size: 8, font: fontR, color: C_MUTED });

  const RIGHT_RESERVE = labelW + 16;
  let textX = ML;
  let logoLh = 0;
  const LOGO_H_MAX = 40, LOGO_W_MAX = 96;

  if (logoImg) {
    const scale = Math.min(LOGO_H_MAX / logoImg.height, LOGO_W_MAX / logoImg.width);
    const lw = logoImg.width * scale;
    logoLh = logoImg.height * scale;
    ctx.page.drawImage(logoImg, { x: ML, y: startY - logoLh, width: lw, height: logoLh });
    textX = ML + lw + 8;
  }

  const textZoneW = W - MR - RIGHT_RESERVE - textX;
  let cy = startY;
  ctx.page.drawText(trunc(dispName, nameFont, nameSize, textZoneW), { x: textX, y: cy - nameSize, size: nameSize, font: nameFont, color: C_TEXT });
  cy -= nameSize + 7;

  const infoSz = 7.5;
  const infoLH = 10;
  if (companyAddress) {
    ctx.page.drawText(trunc(companyAddress, fontR, infoSz, textZoneW), { x: textX, y: cy, size: infoSz, font: fontR, color: C_MUTED });
    cy -= infoLH;
  }
  const regParts: string[] = [];
  if (newSsmNo || oldSsmNo) regParts.push(newSsmNo && oldSsmNo ? `SSM: ${newSsmNo} (${oldSsmNo})` : `SSM: ${newSsmNo ?? oldSsmNo ?? ""}`);
  if (taxNo) regParts.push(`Tax: ${taxNo}`);
  if (regParts.length) {
    ctx.page.drawText(trunc(regParts.join("  ·  "), fontR, infoSz, textZoneW), { x: textX, y: cy, size: infoSz, font: fontR, color: C_MUTED });
    cy -= infoLH;
  }
  const contactParts = ([email, website, phone].filter(Boolean) as string[]).map(san);
  if (contactParts.length) {
    ctx.page.drawText(trunc(contactParts.join("  ·  "), fontR, infoSz, textZoneW), { x: textX, y: cy, size: infoSz, font: fontR, color: C_FAINT });
    cy -= infoLH;
  }

  const leftBottom = cy;
  const rightBottom = startY - LABEL_SZ - 12 - 10;
  ctx.curY = Math.min(leftBottom, rightBottom) - 8;

  ctx.page.drawLine({ start: { x: ML, y: ctx.curY }, end: { x: W - MR, y: ctx.curY }, thickness: 0.9, color: C_BLACK });
  ctx.curY -= 10;
}

function drawPageFooter(ctx: Ctx, totalPages: number): void {
  const fY = MB + 8;
  ctx.page.drawLine({ start: { x: ML, y: fY + 13 }, end: { x: W - MR, y: fY + 13 }, thickness: 0.35, color: C_LINE });
  ctx.page.drawText("Computer-generated document — no signature required.", { x: ML, y: fY, size: 7, font: ctx.fontR, color: C_FAINT });
  const pg = `Page ${ctx.pageNo} of ${totalPages}`;
  const pgW = ctx.fontR.widthOfTextAtSize(pg, 7);
  ctx.page.drawText(pg, { x: W - MR - pgW, y: fY, size: 7, font: ctx.fontR, color: C_FAINT });
}

function stampFooters(ctx: Ctx): void {
  const totalPages = ctx.pages.length;
  const savedPage = ctx.page, savedY = ctx.curY, savedNo = ctx.pageNo;
  for (let pi = 0; pi < ctx.pages.length; pi++) {
    ctx.page = ctx.pages[pi];
    ctx.pageNo = pi + 1;
    drawPageFooter(ctx, totalPages);
  }
  ctx.page = savedPage; ctx.curY = savedY; ctx.pageNo = savedNo;
}

// ── Claim info block ───────────────────────────────────────────────────────
function drawClaimInfo(ctx: Ctx, claim: ClaimApplicationWithDetails, formType: string): void {
  const { fontR, fontB } = ctx;
  ensureSpace(ctx, 90);
  const y0 = ctx.curY;

  const FORM_LABELS: Record<string, string> = { LOCAL: "Local Reimbursement", OVERSEAS: "Overseas Expenses", ENTERTAINMENT_FORM: "Entertainment" };
  const period = formType === CLAIM_FORM.ENTERTAINMENT_FORM ? fmtDate(claim.claimDate) : fmtPeriod(claim.claimDate);

  const rows: Array<[string, string]> = [
    ["Applicant", claim.applicantName ?? "—"],
    ["Claim Type", `${claim.claimTypeName} (${FORM_LABELS[formType] ?? formType})`],
    ["Period", period],
    ["Submitted", fmtDate(claim.createdAt)],
  ];

  const rowH = 13;
  let y = y0;
  const labelW = 90;
  for (const [label, value] of rows) {
    ctx.page.drawText(label, { x: ML, y: y - 9, size: 8, font: fontR, color: C_MUTED });
    ctx.page.drawText(trunc(value, fontB, 9, CW * 0.55 - labelW), { x: ML + labelW, y: y - 9, size: 9, font: fontB, color: C_TEXT });
    y -= rowH;
  }

  // Right column: status badge + amount
  const statusLabel = STATUS_LABEL[claim.status] ?? claim.status;
  const statusColor = STATUS_COLOR[claim.status] ?? C_MUTED;
  const badgeSz = 9;
  const badgeW = fontB.widthOfTextAtSize(statusLabel.toUpperCase(), badgeSz) + 12;
  ctx.page.drawRectangle({ x: W - MR - badgeW, y: y0 - 12, width: badgeW, height: 16, color: statusColor, opacity: 0.15 });
  ctx.page.drawText(statusLabel.toUpperCase(), { x: W - MR - badgeW + 6, y: y0 - 8.5, size: badgeSz, font: fontB, color: statusColor });

  const amtLabel = "Total Amount";
  const amtStr = `RM ${fmtMoney(claim.amount)}`;
  ctx.page.drawText(amtLabel, { x: W - MR - fontR.widthOfTextAtSize(amtLabel, 8), y: y0 - 30, size: 8, font: fontR, color: C_MUTED });
  const amtSz = 15;
  ctx.page.drawText(amtStr, { x: W - MR - fontB.widthOfTextAtSize(amtStr, amtSz), y: y0 - 48, size: amtSz, font: fontB, color: C_GREEN });

  if (claim.description) {
    y -= 3;
    ctx.page.drawText("Note", { x: ML, y: y - 9, size: 8, font: fontR, color: C_MUTED });
    ctx.page.drawText(trunc(claim.description, fontR, 8.5, CW * 0.55 - labelW), { x: ML + labelW, y: y - 9, size: 8.5, font: fontR, color: C_TEXT });
    y -= rowH;
  }

  ctx.curY = Math.min(y, y0 - 60) - 8;
  ctx.page.drawLine({ start: { x: ML, y: ctx.curY }, end: { x: W - MR, y: ctx.curY }, thickness: 0.5, color: C_LINE });
  ctx.curY -= 12;
}

// ── Line items table ───────────────────────────────────────────────────────
function drawTableHeader(ctx: Ctx): void {
  const y = ctx.curY;
  ctx.page.drawRectangle({ x: ML, y: y - TBL_HDR_H, width: CW, height: TBL_HDR_H, color: C_THDR });
  const cols: Array<[string, number, number, "left" | "right" | "center"]> = [
    ["#", X_NO, C_NO, "center"],
    ["DATE", X_DATE, C_DATE, "left"],
    ["CATEGORY", X_CAT, C_CAT, "left"],
    ["DESCRIPTION", X_DESC, C_DESC, "left"],
    ["AMOUNT (RM)", X_AMT, C_AMT, "right"],
  ];
  const sz = 6.5;
  for (const [label, x, w, align] of cols) {
    const tw = ctx.fontB.widthOfTextAtSize(label, sz);
    const tx = align === "center" ? x + (w - tw) / 2 : align === "right" ? x + w - COL_PAD - tw : x + COL_PAD;
    ctx.page.drawText(label, { x: tx, y: y - TBL_HDR_H + 5, size: sz, font: ctx.fontB, color: C_WHITE });
  }
  ctx.curY -= TBL_HDR_H;
}

function measureItemRowHeight(item: ClaimApplicationWithDetails["lineItems"][number], descLines: string[]): number {
  let h = Math.max(ROW_BASE_H, descLines.length * 9 + 6);
  if (item.slashed) h += NOTE_LINE_H;
  if (item.editedBy) h += NOTE_LINE_H;
  return h;
}

function drawLineItemRow(ctx: Ctx, item: ClaimApplicationWithDetails["lineItems"][number], idx: number, isAlt: boolean): void {
  const { fontR, fontB } = ctx;
  const descLines = wrapLines(item.description, fontR, 8, C_DESC - COL_PAD * 2, 2);
  const rowH = measureItemRowHeight(item, descLines);
  const y = ctx.curY;

  if (isAlt) ctx.page.drawRectangle({ x: ML, y: y - rowH, width: CW, height: rowH, color: C_ROW_ALT });

  const textColor = item.slashed ? C_FAINT : C_TEXT;
  ctx.page.drawText(String(idx + 1), { x: X_NO + (C_NO - fontR.widthOfTextAtSize(String(idx + 1), 8)) / 2, y: y - 10, size: 8, font: fontR, color: textColor });
  ctx.page.drawText(fmtDate(item.lineDate), { x: X_DATE + COL_PAD, y: y - 10, size: 7.5, font: fontR, color: textColor });
  ctx.page.drawText(trunc(SECTION_LABELS[item.category] ?? item.category, fontR, 7.5, C_CAT - COL_PAD * 2), { x: X_CAT + COL_PAD, y: y - 10, size: 7.5, font: fontR, color: textColor });

  let dy = y - 10;
  for (const line of descLines) {
    ctx.page.drawText(line, { x: X_DESC + COL_PAD, y: dy, size: 8, font: fontR, color: textColor });
    dy -= 9;
  }
  if (descLines.length === 0) {
    ctx.page.drawText("—", { x: X_DESC + COL_PAD, y: y - 10, size: 8, font: fontR, color: C_FAINT });
  }

  const amtStr = fmtMoney(item.amountMyr);
  const amtW = fontB.widthOfTextAtSize(amtStr, 8.5);
  ctx.page.drawText(amtStr, { x: X_AMT + C_AMT - COL_PAD - amtW, y: y - 10, size: 8.5, font: fontB, color: textColor });

  // Strikethrough for slashed items
  if (item.slashed) {
    const strikeY = y - 7;
    ctx.page.drawLine({ start: { x: X_DATE, y: strikeY }, end: { x: X_AMT + C_AMT - COL_PAD, y: strikeY }, thickness: 0.6, color: C_RED });
  }

  let noteY = y - 10 - Math.max(descLines.length * 9, 9) - 2;
  if (item.slashed) {
    const note = `SLASHED by ${item.slashedByName ?? "checker"}${item.slashReason ? ` — ${item.slashReason}` : ""}`;
    ctx.page.drawText(trunc(note, fontR, 7, CW - C_NO - COL_PAD * 2), { x: X_DATE, y: noteY, size: 7, font: fontR, color: C_RED });
    noteY -= NOTE_LINE_H;
  }
  if (item.editedBy) {
    const orig = item.originalAmountMyr ? `RM ${fmtMoney(item.originalAmountMyr)}` : null;
    const note = `Edited by ${item.editedByName ?? "checker"}${orig ? ` — was ${orig}` : ""}${item.editReason ? ` (${item.editReason})` : ""}`;
    ctx.page.drawText(trunc(note, fontR, 7, CW - C_NO - COL_PAD * 2), { x: X_DATE, y: noteY, size: 7, font: fontR, color: C_AMBER });
  }

  ctx.page.drawLine({ start: { x: ML, y: y - rowH }, end: { x: W - MR, y: y - rowH }, thickness: 0.4, color: C_LINE });
  ctx.curY -= rowH;
}

function drawLineItemsSection(ctx: Ctx, claim: ClaimApplicationWithDetails): void {
  ensureSpace(ctx, TBL_HDR_H + ROW_BASE_H * 2);
  drawTableHeader(ctx);
  claim.lineItems.forEach((item, idx) => {
    const descLines = wrapLines(item.description, ctx.fontR, 8, C_DESC - COL_PAD * 2, 2);
    const rowH = measureItemRowHeight(item, descLines);
    if (ctx.curY - rowH < MB + PAGE_FTR_H) {
      addPage(ctx);
      ctx.page.drawText("Line Items (continued)", { x: ML, y: ctx.curY - 11, size: 7.5, font: ctx.fontB, color: C_MUTED });
      ctx.curY -= 15;
      drawTableHeader(ctx);
    }
    drawLineItemRow(ctx, item, idx, idx % 2 === 1);
  });
}

// ── Entertainment details table ───────────────────────────────────────────
function drawEntertainmentSection(ctx: Ctx, claim: ClaimApplicationWithDetails): void {
  const cols: Array<[string, number]> = [["DATE", 55], ["RESTAURANT / VENUE", 105], ["CUSTOMER", 90], ["DEPT & ORG", 90], ["PURPOSE", CW - 55 - 105 - 90 - 90 - 75], ["AMOUNT (RM)", 75]];
  const xs: number[] = [];
  let cx = ML;
  for (const [, w] of cols) { xs.push(cx); cx += w; }

  ensureSpace(ctx, TBL_HDR_H + ROW_BASE_H * 2);
  const drawHdr = () => {
    ctx.page.drawRectangle({ x: ML, y: ctx.curY - TBL_HDR_H, width: CW, height: TBL_HDR_H, color: C_THDR });
    cols.forEach(([label], i) => {
      const align = label === "AMOUNT (RM)" ? "right" : "left";
      const w = cols[i][1];
      const tw = ctx.fontB.widthOfTextAtSize(label, 6.5);
      const tx = align === "right" ? xs[i] + w - COL_PAD - tw : xs[i] + COL_PAD;
      ctx.page.drawText(label, { x: tx, y: ctx.curY - TBL_HDR_H + 5, size: 6.5, font: ctx.fontB, color: C_WHITE });
    });
    ctx.curY -= TBL_HDR_H;
  };
  drawHdr();

  claim.entertainmentDetails.forEach((ed, idx) => {
    const purposeLines = wrapLines(ed.purpose, ctx.fontR, 7.5, cols[4][1] - COL_PAD * 2, 2);
    let rowH = Math.max(ROW_BASE_H, purposeLines.length * 9 + 6);
    if (ed.slashed) rowH += NOTE_LINE_H;
    if (ed.editedBy) rowH += NOTE_LINE_H;

    if (ctx.curY - rowH < MB + PAGE_FTR_H) {
      addPage(ctx);
      ctx.page.drawText("Entertainment Details (continued)", { x: ML, y: ctx.curY - 11, size: 7.5, font: ctx.fontB, color: C_MUTED });
      ctx.curY -= 15;
      drawHdr();
    }

    const y = ctx.curY;
    const textColor = ed.slashed ? C_FAINT : C_TEXT;
    if (idx % 2 === 1) ctx.page.drawRectangle({ x: ML, y: y - rowH, width: CW, height: rowH, color: C_ROW_ALT });

    ctx.page.drawText(fmtDate(ed.eventDate), { x: xs[0] + COL_PAD, y: y - 10, size: 7.5, font: ctx.fontR, color: textColor });
    ctx.page.drawText(trunc(ed.restaurantName, ctx.fontR, 7.5, cols[1][1] - COL_PAD * 2), { x: xs[1] + COL_PAD, y: y - 10, size: 7.5, font: ctx.fontR, color: textColor });
    ctx.page.drawText(trunc(ed.customerName, ctx.fontR, 7.5, cols[2][1] - COL_PAD * 2), { x: xs[2] + COL_PAD, y: y - 10, size: 7.5, font: ctx.fontR, color: textColor });
    ctx.page.drawText(trunc(ed.departmentOrganization, ctx.fontR, 7.5, cols[3][1] - COL_PAD * 2), { x: xs[3] + COL_PAD, y: y - 10, size: 7.5, font: ctx.fontR, color: textColor });
    let py = y - 10;
    for (const line of purposeLines) { ctx.page.drawText(line, { x: xs[4] + COL_PAD, y: py, size: 7.5, font: ctx.fontR, color: textColor }); py -= 9; }
    const amtStr = fmtMoney(ed.amount);
    const amtW = ctx.fontB.widthOfTextAtSize(amtStr, 8);
    ctx.page.drawText(amtStr, { x: xs[5] + cols[5][1] - COL_PAD - amtW, y: y - 10, size: 8, font: ctx.fontB, color: textColor });

    if (ed.slashed) {
      ctx.page.drawLine({ start: { x: xs[0], y: y - 7 }, end: { x: xs[5] + cols[5][1] - COL_PAD, y: y - 7 }, thickness: 0.6, color: C_RED });
    }
    let noteY = y - 10 - Math.max(purposeLines.length * 9, 9) - 2;
    if (ed.slashed) {
      const note = `SLASHED by ${ed.slashedByName ?? "checker"}${ed.slashReason ? ` — ${ed.slashReason}` : ""}`;
      ctx.page.drawText(trunc(note, ctx.fontR, 7, CW - COL_PAD * 2), { x: xs[0], y: noteY, size: 7, font: ctx.fontR, color: C_RED });
      noteY -= NOTE_LINE_H;
    }
    if (ed.editedBy) {
      const orig = ed.originalAmount ? `RM ${fmtMoney(ed.originalAmount)}` : null;
      const note = `Edited by ${ed.editedByName ?? "checker"}${orig ? ` — was ${orig}` : ""}${ed.editReason ? ` (${ed.editReason})` : ""}`;
      ctx.page.drawText(trunc(note, ctx.fontR, 7, CW - COL_PAD * 2), { x: xs[0], y: noteY, size: 7, font: ctx.fontR, color: C_AMBER });
    }

    ctx.page.drawLine({ start: { x: ML, y: y - rowH }, end: { x: W - MR, y: y - rowH }, thickness: 0.4, color: C_LINE });
    ctx.curY -= rowH;
  });
}

// ── Totals ─────────────────────────────────────────────────────────────────
function drawTotals(ctx: Ctx, claim: ClaimApplicationWithDetails): void {
  ensureSpace(ctx, 30);
  ctx.curY -= 6;
  const label = "Grand Total";
  const value = `RM ${fmtMoney(claim.amount)}`;
  ctx.page.drawLine({ start: { x: ML, y: ctx.curY + 4 }, end: { x: W - MR, y: ctx.curY + 4 }, thickness: 0.8, color: C_TEXT });
  ctx.page.drawText(label, { x: W - MR - 140, y: ctx.curY - 10, size: 10, font: ctx.fontB, color: C_TEXT });
  const vw = ctx.fontB.widthOfTextAtSize(value, 12);
  ctx.page.drawText(value, { x: W - MR - vw, y: ctx.curY - 11, size: 12, font: ctx.fontB, color: C_GREEN });
  ctx.curY -= 26;
}

// ── Approval trail ─────────────────────────────────────────────────────────
function drawApprovalTrail(ctx: Ctx, claim: ClaimApplicationWithDetails): void {
  const rows: Array<{ label: string; name: string | null; at: Date | string | null; note: string | null; color: ReturnType<typeof rgb> }> = [
    { label: "Submitted by", name: claim.applicantName, at: claim.createdAt, note: null, color: C_TEXT },
  ];
  if (claim.checkedAt) {
    rows.push({
      label: claim.status === "REJECTED" && !claim.reviewedAt ? "Rejected by checker" : "Checked by",
      name: null, at: claim.checkedAt, note: claim.checkerComment,
      color: claim.status === "REJECTED" ? C_RED : C_BLUE,
    });
  }
  if (claim.reviewedAt) {
    rows.push({
      label: claim.status === "APPROVED" ? "Approved by" : "Rejected by",
      name: null, at: claim.reviewedAt, note: claim.reviewComment,
      color: claim.status === "APPROVED" ? C_GREEN : C_RED,
    });
  }

  const rowH = 26;
  ensureSpace(ctx, 16 + rows.length * rowH);
  ctx.page.drawText("APPROVAL TRAIL", { x: ML, y: ctx.curY - 9, size: 8, font: ctx.fontB, color: C_MUTED });
  ctx.curY -= 16;

  for (const r of rows) {
    if (ctx.curY - rowH < MB + PAGE_FTR_H) addPage(ctx);
    const y = ctx.curY;
    ctx.page.drawText(r.label, { x: ML, y: y - 10, size: 8.5, font: ctx.fontB, color: r.color });
    const atStr = fmtDate(r.at);
    const atW = ctx.fontR.widthOfTextAtSize(atStr, 8);
    ctx.page.drawText(atStr, { x: W - MR - atW, y: y - 10, size: 8, font: ctx.fontR, color: C_MUTED });
    if (r.note) {
      ctx.page.drawText(trunc(r.note, ctx.fontR, 8, CW), { x: ML, y: y - 21, size: 8, font: ctx.fontR, color: C_MUTED });
    }
    ctx.page.drawLine({ start: { x: ML, y: y - rowH + 6 }, end: { x: W - MR, y: y - rowH + 6 }, thickness: 0.4, color: C_LINE });
    ctx.curY -= rowH;
  }
}

// ── Public ──────────────────────────────────────────────────────────────────
export async function generateClaimPdf(
  claim: ClaimApplicationWithDetails,
  orgProfile: FullOrganizationProfile,
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const ctx = await buildContext(pdfDoc, orgProfile);
  const formType = getFormType(claim);

  addPage(ctx);
  drawPageHeader(ctx, claim);
  drawClaimInfo(ctx, claim, formType);

  if (formType === CLAIM_FORM.ENTERTAINMENT_FORM) {
    drawEntertainmentSection(ctx, claim);
  } else {
    drawLineItemsSection(ctx, claim);
  }
  drawTotals(ctx, claim);
  drawApprovalTrail(ctx, claim);

  stampFooters(ctx);
  return pdfDoc.save();
}
