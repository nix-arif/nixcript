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
 *
 * Line items are grouped by category (1.1 Travel Expenses, 1.2.1 Toll, etc.)
 * with a per-section subtotal, mirroring the numbering and grouping the
 * submitter/checker already see in the in-app claim views — the PDF should
 * look like the form they filled in, not a generic invoice table.
 */

import { PDFDocument, PDFPage, PDFFont, PDFImage, rgb, StandardFonts } from "pdf-lib";
import { type FullOrganizationProfile } from "@/server/organization-profile";
import { type ClaimApplicationDetailForPdf } from "@/server/claim";
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
const C_CARD_BG     = rgb(0.975, 0.98, 0.985);
const C_CARD_BORDER = rgb(0.84, 0.87, 0.90);
const C_GROUP_BG    = rgb(0.93, 0.94, 0.96);
const C_SLASH_BG    = rgb(0.99, 0.93, 0.93);
const C_EDIT_BG     = rgb(0.995, 0.97, 0.90);
const C_TOTAL_BG    = rgb(0.91, 0.96, 0.93);

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Draft", PENDING: "Pending", CHECKED: "Checked",
  APPROVED: "Approved", REJECTED: "Rejected", CANCELLED: "Cancelled",
};
const STATUS_COLOR: Record<string, ReturnType<typeof rgb>> = {
  DRAFT: C_MUTED, PENDING: C_AMBER, CHECKED: C_BLUE,
  APPROVED: C_GREEN, REJECTED: C_RED, CANCELLED: C_FAINT,
};

// Display order + numbering for line-item groups — mirrors the section
// numbering used in the in-app claim form / read-only views (my-claim-client,
// checker-client) so the PDF reads as the same document the submitter filled
// in, not a re-invented table.
const SECTION_ORDER: string[] = [
  LINE_CATEGORY.TRAVEL,
  LINE_CATEGORY.TRAVEL_ACCOMMODATION,
  LINE_CATEGORY.TRAVEL_DAILY_ALLOWANCE,
  LINE_CATEGORY.TRAVEL_ENTERTAINMENT,
  LINE_CATEGORY.TOLL,
  LINE_CATEGORY.PARKING,
  LINE_CATEGORY.MOBILE,
  LINE_CATEGORY.IN_BASE_ENT,
  LINE_CATEGORY.OTHER_LOCAL,
  LINE_CATEGORY.OVERSEAS_MYR,
  LINE_CATEGORY.OVERSEAS_FX,
  LINE_CATEGORY.OVERSEAS_OTHER,
];
const SECTION_LABELS: Record<string, string> = {
  [LINE_CATEGORY.TRAVEL]:                "1.1   Travel Expenses",
  [LINE_CATEGORY.TRAVEL_ACCOMMODATION]:  "1.1.1   Accommodation",
  [LINE_CATEGORY.TRAVEL_DAILY_ALLOWANCE]:"1.1.2   Daily Allowance",
  [LINE_CATEGORY.TRAVEL_ENTERTAINMENT]:  "1.1.3   Travel Entertainment",
  [LINE_CATEGORY.TOLL]:                  "1.2.1   Toll / Touch N Go",
  [LINE_CATEGORY.PARKING]:               "1.2.2   Parking",
  [LINE_CATEGORY.MOBILE]:                "1.2.3   Mobile Phone",
  [LINE_CATEGORY.IN_BASE_ENT]:           "1.3   In-Base Entertainment",
  [LINE_CATEGORY.OTHER_LOCAL]:           "1.4   Other Expenses",
  [LINE_CATEGORY.OVERSEAS_MYR]:          "2.1   Travel (MYR)",
  [LINE_CATEGORY.OVERSEAS_FX]:           "2.2   Travel (Foreign Currency)",
  [LINE_CATEGORY.OVERSEAS_OTHER]:        "2.3   Other Expenses",
};

// ── String / format helpers ───────────────────────────────────────────────────
// pdf-lib's Standard fonts (Helvetica/HelveticaBold) use WinAnsi (Windows-1252)
// encoding and THROW on any character outside it — not just exotic ones like "→",
// but anything a user might type or paste into a name/comment/reason: emoji,
// CJK/Arabic/etc. script, or even "smart" punctuation outside the small set
// Windows-1252 happens to support. A single bad character anywhere in a claim's
// free text (or even someone's display name) would 500 the whole PDF. Every
// string that reaches drawText must go through this first.
// Codepoints above U+00FF that Windows-1252 still maps to a real glyph (smart
// quotes, em/en dash, ellipsis, trademark, etc.) — pdf-lib renders these fine,
// so they pass through unchanged rather than being degraded to ASCII.
const WINANSI_SAFE_HIGH = new Set([
  0x20AC, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021, 0x02C6, 0x2030, 0x0160,
  0x2039, 0x0152, 0x017D, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014,
  0x02DC, 0x2122, 0x0161, 0x203A, 0x0153, 0x017E, 0x0178,
]);
// Everything else gets a readable ASCII substitute where one makes sense, else "?"
const ASCII_FALLBACK: Record<number, string> = {
  0x2192: "->", 0x2190: "<-", 0x2194: "<->", 0x2713: "v", 0x2717: "x", 0x00D7: "x",
};

function san(t: string | null | undefined): string {
  const s = String(t ?? "").replace(/[\x00-\x1F\x7F]/g, " ");
  let out = "";
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp <= 0xFF || WINANSI_SAFE_HIGH.has(cp)) out += ch; // ASCII + Latin-1 supplement are byte-identical to WinAnsi
    else out += ASCII_FALLBACK[cp] ?? "?";
  }
  return out;
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

function getFormType(claim: ClaimApplicationDetailForPdf): string {
  if (claim.entertainmentDetails.length > 0) return CLAIM_FORM.ENTERTAINMENT_FORM;
  const cat = claim.lineItems[0]?.category ?? "";
  return cat.startsWith("OVERSEAS") ? CLAIM_FORM.OVERSEAS : CLAIM_FORM.LOCAL;
}

// ── Column layout (line items table) ──────────────────────────────────────────
// No category column — the row's group header already says what section it's
// in, so that space goes to a wider description column instead.
const C_NO   = 20;
const C_DATE = 62;
const C_AMT  = 80;
const C_DESC = CW - C_NO - C_DATE - C_AMT;
const X_NO   = ML;
const X_DATE = X_NO + C_NO;
const X_DESC = X_DATE + C_DATE;
const X_AMT  = X_DESC + C_DESC;

const TBL_HDR_H  = 16;
const GROUP_HDR_H = 17;
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
function drawPageHeader(ctx: Ctx, claim: ClaimApplicationDetailForPdf): void {
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
  ctx.curY -= 14;
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

// ── Claim summary card ──────────────────────────────────────────────────────
// A bordered card (status-colored accent bar, divider between the detail
// fields and the status/amount block) instead of bare label:value text — the
// single most important facts (status, total) should read at a glance.
function drawClaimInfo(ctx: Ctx, claim: ClaimApplicationDetailForPdf, formType: string): void {
  const { fontR, fontB } = ctx;
  const period = formType === CLAIM_FORM.ENTERTAINMENT_FORM ? fmtDate(claim.claimDate) : fmtPeriod(claim.claimDate);

  const rows: Array<[string, string]> = [
    ["Applicant", claim.applicantName ?? "—"],
    ["Department", claim.applicantDepartment ?? "—"],
    ["Claim Type", claim.claimTypeName],
    ["Period", period],
    ["Submitted", fmtDate(claim.createdAt)],
  ];
  if (claim.description) rows.push(["Note", claim.description]);

  const PAD = 12;
  const ROWH = 14;
  const leftColW = CW * 0.58;
  const rightBlockH = 54; // status badge + total amount stack
  const cardH = Math.max(rows.length * ROWH, rightBlockH) + PAD * 2;

  ensureSpace(ctx, cardH + 14);
  const cardTop = ctx.curY;
  const cardBottom = cardTop - cardH;

  const statusColor = STATUS_COLOR[claim.status] ?? C_MUTED;
  ctx.page.drawRectangle({ x: ML, y: cardBottom, width: CW, height: cardH, color: C_CARD_BG, borderColor: C_CARD_BORDER, borderWidth: 0.75 });
  ctx.page.drawRectangle({ x: ML, y: cardBottom, width: 3, height: cardH, color: statusColor });

  const dividerX = ML + leftColW;
  ctx.page.drawLine({ start: { x: dividerX, y: cardTop - 6 }, end: { x: dividerX, y: cardBottom + 6 }, thickness: 0.5, color: C_CARD_BORDER });

  let ty = cardTop - PAD;
  const labelW = 74;
  for (const [label, value] of rows) {
    ctx.page.drawText(label, { x: ML + PAD, y: ty - 9, size: 8, font: fontR, color: C_MUTED });
    ctx.page.drawText(trunc(value, fontB, 9, leftColW - PAD - labelW - 8), { x: ML + PAD + labelW, y: ty - 9, size: 9, font: fontB, color: C_TEXT });
    ty -= ROWH;
  }

  // Right block: status badge (top) + total amount (below), right-aligned.
  const statusLabel = (STATUS_LABEL[claim.status] ?? claim.status).toUpperCase();
  const badgeSz = 9;
  const badgeW = fontB.widthOfTextAtSize(statusLabel, badgeSz) + 16;
  const badgeH = 17;
  const badgeX = ML + CW - PAD - badgeW;
  const badgeY = cardTop - PAD - badgeH;
  ctx.page.drawRectangle({ x: badgeX, y: badgeY, width: badgeW, height: badgeH, color: statusColor, opacity: 0.15, borderColor: statusColor, borderWidth: 0.75, borderOpacity: 0.55 });
  ctx.page.drawText(statusLabel, { x: badgeX + 8, y: badgeY + 5.5, size: badgeSz, font: fontB, color: statusColor });

  const amtLabel = "Total Amount";
  const amtStr = `RM ${fmtMoney(claim.amount)}`;
  const amtSz = 16;
  ctx.page.drawText(amtLabel, { x: ML + CW - PAD - fontR.widthOfTextAtSize(amtLabel, 8), y: badgeY - 13, size: 8, font: fontR, color: C_MUTED });
  ctx.page.drawText(amtStr, { x: ML + CW - PAD - fontB.widthOfTextAtSize(amtStr, amtSz), y: badgeY - 32, size: amtSz, font: fontB, color: C_GREEN });

  ctx.curY = cardBottom - 16;
}

// ── Line items — grouped table ────────────────────────────────────────────
// Lightweight column-label row (not a heavy black bar) — the group headers
// below carry the visual weight; this just orients DATE / DESCRIPTION / AMOUNT.
function drawColumnLabels(ctx: Ctx): void {
  const y = ctx.curY;
  const sz = 6.5;
  ctx.page.drawText("DATE", { x: X_DATE + COL_PAD, y: y - 8, size: sz, font: ctx.fontB, color: C_FAINT });
  ctx.page.drawText("DESCRIPTION", { x: X_DESC + COL_PAD, y: y - 8, size: sz, font: ctx.fontB, color: C_FAINT });
  const amtLabelW = ctx.fontB.widthOfTextAtSize("AMOUNT (RM)", sz);
  ctx.page.drawText("AMOUNT (RM)", { x: X_AMT + C_AMT - COL_PAD - amtLabelW, y: y - 8, size: sz, font: ctx.fontB, color: C_FAINT });
  ctx.page.drawLine({ start: { x: ML, y: y - 11 }, end: { x: W - MR, y: y - 11 }, thickness: 0.5, color: C_LINE });
  ctx.curY -= 13;
}

function drawGroupHeader(ctx: Ctx, label: string, subtotal: number | null): void {
  const y = ctx.curY;
  ctx.page.drawRectangle({ x: ML, y: y - GROUP_HDR_H, width: CW, height: GROUP_HDR_H, color: C_GROUP_BG });
  ctx.page.drawText(san(label), { x: ML + COL_PAD, y: y - GROUP_HDR_H + 5.5, size: 8, font: ctx.fontB, color: C_TEXT });
  if (subtotal !== null) {
    const amtStr = `RM ${fmtMoney(subtotal)}`;
    const amtW = ctx.fontB.widthOfTextAtSize(amtStr, 8);
    ctx.page.drawText(amtStr, { x: X_AMT + C_AMT - COL_PAD - amtW, y: y - GROUP_HDR_H + 5.5, size: 8, font: ctx.fontB, color: C_TEXT });
  }
  ctx.curY -= GROUP_HDR_H;
}

function measureItemRowHeight(item: ClaimApplicationDetailForPdf["lineItems"][number], descLines: string[]): number {
  let h = Math.max(ROW_BASE_H, descLines.length * 9 + 6);
  if (item.slashed) h += NOTE_LINE_H;
  if (item.editedBy) h += NOTE_LINE_H;
  return h;
}

// Mirrors the in-app rendering (checker/approvals/my-claim views): a TRAVEL row's
// route (from → to, + distance) is far more useful than its fallback description
// ("Own Vehicle" etc.), and OVERSEAS_FX rows are better read as destination + FX math.
function lineItemDisplayText(item: ClaimApplicationDetailForPdf["lineItems"][number], cat: string): string {
  if (cat === LINE_CATEGORY.TRAVEL && (item.fromLocation || item.toLocation)) {
    // "->" not "→" — pdf-lib's Standard fonts use WinAnsi encoding, which cannot render U+2192
    const route = `${item.fromLocation || "—"} -> ${item.toLocation || "—"}`;
    return item.distanceKm ? `${route} (${item.distanceKm} km)` : route;
  }
  if (cat === LINE_CATEGORY.OVERSEAS_FX && item.destination) {
    const fx = [item.amountForeign, item.currency, item.exchangeRate && `× ${item.exchangeRate}`].filter(Boolean).join(" ");
    return fx ? `${item.destination} — ${fx}` : item.destination;
  }
  if (item.venue) return item.description ? `${item.venue} — ${item.description}` : item.venue;
  if (item.destination) return item.description ? `${item.destination} — ${item.description}` : item.destination;
  return item.description ?? "";
}

function drawLineItemRow(ctx: Ctx, item: ClaimApplicationDetailForPdf["lineItems"][number], idx: number, isAlt: boolean): void {
  const { fontR, fontB } = ctx;
  const cat = item.category;
  const descLines = wrapLines(lineItemDisplayText(item, cat), fontR, 8, C_DESC - COL_PAD * 2, 2);
  const rowH = measureItemRowHeight(item, descLines);
  const y = ctx.curY;

  // Slashed/edited rows get a tinted background so a reviewer spots them
  // without reading every note — a stronger signal than the inline text alone.
  const bg = item.slashed ? C_SLASH_BG : item.editedBy ? C_EDIT_BG : isAlt ? C_ROW_ALT : null;
  if (bg) ctx.page.drawRectangle({ x: ML, y: y - rowH, width: CW, height: rowH, color: bg });

  const textColor = item.slashed ? C_FAINT : C_TEXT;
  ctx.page.drawText(String(idx + 1), { x: X_NO + (C_NO - fontR.widthOfTextAtSize(String(idx + 1), 8)) / 2, y: y - 10, size: 8, font: fontR, color: textColor });
  ctx.page.drawText(fmtDate(item.lineDate), { x: X_DATE + COL_PAD, y: y - 10, size: 7.5, font: fontR, color: textColor });

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

function drawLineItemsSection(ctx: Ctx, claim: ClaimApplicationDetailForPdf): void {
  const byCategory = new Map<string, ClaimApplicationDetailForPdf["lineItems"]>();
  for (const item of claim.lineItems) {
    if (!byCategory.has(item.category)) byCategory.set(item.category, []);
    byCategory.get(item.category)!.push(item);
  }
  // Any category not in the known display order still gets shown, just after the known ones.
  const order = [...SECTION_ORDER, ...[...byCategory.keys()].filter((c) => !SECTION_ORDER.includes(c))];

  ensureSpace(ctx, GROUP_HDR_H + 13 + ROW_BASE_H);
  drawColumnLabels(ctx);

  for (const cat of order) {
    const items = byCategory.get(cat);
    if (!items || items.length === 0) continue;
    const subtotal = items.reduce((s, i) => s + (i.slashed ? 0 : parseFloat(i.amountMyr)), 0);
    const label = SECTION_LABELS[cat] ?? cat;

    ensureSpace(ctx, GROUP_HDR_H + ROW_BASE_H);
    drawGroupHeader(ctx, label, subtotal);

    items.forEach((item, idx) => {
      const descLines = wrapLines(lineItemDisplayText(item, item.category), ctx.fontR, 8, C_DESC - COL_PAD * 2, 2);
      const rowH = measureItemRowHeight(item, descLines);
      if (ctx.curY - rowH < MB + PAGE_FTR_H) {
        addPage(ctx);
        ctx.page.drawText(`${san(label)} — continued`, { x: ML, y: ctx.curY - 11, size: 7.5, font: ctx.fontB, color: C_MUTED });
        ctx.curY -= 15;
        drawColumnLabels(ctx);
      }
      drawLineItemRow(ctx, item, idx, idx % 2 === 1);
    });
  }
}

// ── Entertainment details table ───────────────────────────────────────────
function drawEntertainmentSection(ctx: Ctx, claim: ClaimApplicationDetailForPdf): void {
  const cols: Array<[string, number]> = [["DATE", 55], ["RESTAURANT / VENUE", 100], ["CUSTOMER", 85], ["DEPT & ORG", 85], ["PURPOSE", CW - 55 - 100 - 85 - 85 - 75], ["AMOUNT (RM)", 75]];
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

  // Draws a wrapped column's lines top-anchored at (x, y), one per 9pt step.
  const drawCol = (lines: string[], x: number, y: number, color: ReturnType<typeof rgb>) => {
    let cy = y;
    for (const line of lines) {
      ctx.page.drawText(line, { x, y: cy, size: 7.5, font: ctx.fontR, color });
      cy -= 9;
    }
  };

  claim.entertainmentDetails.forEach((ed, idx) => {
    const restLines = wrapLines(ed.restaurantName, ctx.fontR, 7.5, cols[1][1] - COL_PAD * 2, 2);
    const custLines = wrapLines(ed.customerName, ctx.fontR, 7.5, cols[2][1] - COL_PAD * 2, 2);
    const deptLines = wrapLines(ed.departmentOrganization, ctx.fontR, 7.5, cols[3][1] - COL_PAD * 2, 2);
    const purposeLines = wrapLines(ed.purpose, ctx.fontR, 7.5, cols[4][1] - COL_PAD * 2, 2);
    const maxLines = Math.max(1, restLines.length, custLines.length, deptLines.length, purposeLines.length);
    let rowH = Math.max(ROW_BASE_H, maxLines * 9 + 6);
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
    const bg = ed.slashed ? C_SLASH_BG : ed.editedBy ? C_EDIT_BG : idx % 2 === 1 ? C_ROW_ALT : null;
    if (bg) ctx.page.drawRectangle({ x: ML, y: y - rowH, width: CW, height: rowH, color: bg });

    ctx.page.drawText(fmtDate(ed.eventDate), { x: xs[0] + COL_PAD, y: y - 10, size: 7.5, font: ctx.fontR, color: textColor });
    drawCol(restLines, xs[1] + COL_PAD, y - 10, textColor);
    drawCol(custLines, xs[2] + COL_PAD, y - 10, textColor);
    drawCol(deptLines, xs[3] + COL_PAD, y - 10, textColor);
    drawCol(purposeLines, xs[4] + COL_PAD, y - 10, textColor);
    const amtStr = fmtMoney(ed.amount);
    const amtW = ctx.fontB.widthOfTextAtSize(amtStr, 8);
    ctx.page.drawText(amtStr, { x: xs[5] + cols[5][1] - COL_PAD - amtW, y: y - 10, size: 8, font: ctx.fontB, color: textColor });

    if (ed.slashed) {
      ctx.page.drawLine({ start: { x: xs[0], y: y - 7 }, end: { x: xs[5] + cols[5][1] - COL_PAD, y: y - 7 }, thickness: 0.6, color: C_RED });
    }
    let noteY = y - 10 - Math.max(maxLines * 9, 9) - 2;
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

// ── LOCAL claim form — modelled on the org's own paper reimbursement form ──
// (Appendix I travel grid, Miscellaneous/In-Base/Other tables, Totals block)
// so the PDF matches the document the applicant already knows, rather than
// the generic grouped-table layout used for Overseas / Entertainment claims.
type LineItem = ClaimApplicationDetailForPdf["lineItems"][number];

const MISC_FIXED_LABELS: Record<string, string> = {
  [LINE_CATEGORY.TOLL]:   "Toll / Touch N' Go",
  [LINE_CATEGORY.PARKING]:"Parking",
  [LINE_CATEGORY.MOBILE]: "Mobile Phone",
};

// Short remark summarising a checker slash/edit — shown in the Remarks
// column instead of the multi-line note style used by the grouped layout,
// since this form's Remarks column is narrow and shared across all sections.
function itemRemark(item: LineItem): string {
  if (item.slashed) return `SLASHED${item.slashReason ? ` — ${item.slashReason}` : ""}`;
  if (item.editedBy) {
    const orig = item.originalAmountMyr ? ` (was RM ${fmtMoney(item.originalAmountMyr)})` : "";
    return `Edited${orig}${item.editReason ? ` — ${item.editReason}` : ""}`;
  }
  return "";
}

interface TripRow {
  lineDate: string;
  travelItem: LineItem | null;
  dailyItem: LineItem | null;
  accomItem: LineItem | null;
  tEntItem: LineItem | null;
}

// Reconstructs one grid row per "trip" by walking the sorted line items and
// starting a new row whenever a TRAVEL item appears — mirroring exactly how
// the in-app form builds a TravelRow's sub-items (daily/accommodation/travel
// entertainment) under one shared lineDate. Falls back to starting a row on
// whichever sub-item appears first if a TRAVEL item is missing (the app only
// creates one when a route/mode was actually filled in).
function buildTripRows(items: LineItem[]): TripRow[] {
  const travelCats = new Set<string>([
    LINE_CATEGORY.TRAVEL, LINE_CATEGORY.TRAVEL_ACCOMMODATION,
    LINE_CATEGORY.TRAVEL_DAILY_ALLOWANCE, LINE_CATEGORY.TRAVEL_ENTERTAINMENT,
  ]);
  const sorted = items.filter((i) => travelCats.has(i.category));
  const rows: TripRow[] = [];
  let current: TripRow | null = null;
  for (const item of sorted) {
    if (item.category === LINE_CATEGORY.TRAVEL) {
      current = { lineDate: item.lineDate, travelItem: item, dailyItem: null, accomItem: null, tEntItem: null };
      rows.push(current);
      continue;
    }
    if (!current) {
      current = { lineDate: item.lineDate, travelItem: null, dailyItem: null, accomItem: null, tEntItem: null };
      rows.push(current);
    }
    if (item.category === LINE_CATEGORY.TRAVEL_DAILY_ALLOWANCE) current.dailyItem = item;
    else if (item.category === LINE_CATEGORY.TRAVEL_ACCOMMODATION) current.accomItem = item;
    else if (item.category === LINE_CATEGORY.TRAVEL_ENTERTAINMENT) current.tEntItem = item;
  }
  return rows;
}

function tripDestination(travelItem: LineItem | null): string {
  if (!travelItem) return "—";
  if (travelItem.fromLocation || travelItem.toLocation) {
    const route = `${travelItem.fromLocation || "—"} -> ${travelItem.toLocation || "—"}`;
    return travelItem.distanceKm ? `${route} (${travelItem.distanceKm} km)` : route;
  }
  return travelItem.description || "—";
}

// amt(x): 0 if slashed (excluded from totals, matching the rest of the app), else the stored amount.
function amt(item: LineItem | null): number {
  return item && !item.slashed ? parseFloat(item.amountMyr) : 0;
}

const TG_DATE  = 48;
const TG_DEST  = 152;
const TG_NUM   = 48; // Travel / Daily Allowance / Accommodation / Travel Entertainment
const TG_REM   = CW - TG_DATE - TG_DEST - TG_NUM * 4;
const TG_COLS: Array<[string, number]> = [
  ["DATE", TG_DATE], ["DESTINATION", TG_DEST], ["TRAVEL", TG_NUM],
  ["DAILY", TG_NUM], ["ACCOM.", TG_NUM], ["ENTERT.", TG_NUM], ["PURPOSE", TG_REM],
];

function tgColX(idx: number): number {
  let x = ML;
  for (let i = 0; i < idx; i++) x += TG_COLS[i][1];
  return x;
}

function drawTravelGridHeader(ctx: Ctx): void {
  const y = ctx.curY;
  ctx.page.drawRectangle({ x: ML, y: y - TBL_HDR_H, width: CW, height: TBL_HDR_H, color: C_THDR });
  TG_COLS.forEach(([label, w], i) => {
    const x = tgColX(i);
    const align = label === "PURPOSE" || label === "DESTINATION" ? "left" : label === "DATE" ? "left" : "right";
    const sz = 6;
    const text = trunc(label, ctx.fontB, sz, w - COL_PAD * 2);
    const tw = ctx.fontB.widthOfTextAtSize(text, sz);
    const tx = align === "right" ? x + w - COL_PAD - tw : x + COL_PAD;
    ctx.page.drawText(text, { x: tx, y: y - TBL_HDR_H + 5, size: sz, font: ctx.fontB, color: C_WHITE });
  });
  ctx.curY -= TBL_HDR_H;
}

// Returns the total travel expenses (sum of all four buckets, slashed excluded).
function drawTravelGrid(ctx: Ctx, claim: ClaimApplicationDetailForPdf): number {
  const rows = buildTripRows(claim.lineItems);
  if (rows.length === 0) return 0;

  ctx.page.drawText("1.1   Travel Expenses", { x: ML, y: ctx.curY - 9, size: 9, font: ctx.fontB, color: C_TEXT });
  ctx.curY -= 15;
  ensureSpace(ctx, TBL_HDR_H + ROW_BASE_H);
  drawTravelGridHeader(ctx);

  let total = 0;
  rows.forEach((r) => {
    const remarks = r.travelItem?.description ?? "";
    const remarksLines = wrapLines(remarks, ctx.fontR, 6.5, TG_REM - COL_PAD * 2, 2);
    const destLines = wrapLines(tripDestination(r.travelItem), ctx.fontR, 7, TG_DEST - COL_PAD * 2, 2);
    const rowH = Math.max(ROW_BASE_H, Math.max(remarksLines.length, destLines.length) * 8.5 + 6);

    if (ctx.curY - rowH < MB + PAGE_FTR_H) {
      addPage(ctx);
      ctx.page.drawText("1.1   Travel Expenses — continued", { x: ML, y: ctx.curY - 11, size: 7.5, font: ctx.fontB, color: C_MUTED });
      ctx.curY -= 15;
      drawTravelGridHeader(ctx);
    }

    const y = ctx.curY;
    const anySlashed = [r.travelItem, r.dailyItem, r.accomItem, r.tEntItem].some((i) => i?.slashed);
    const anyEdited = [r.travelItem, r.dailyItem, r.accomItem, r.tEntItem].some((i) => i?.editedBy);
    const bg = anySlashed ? C_SLASH_BG : anyEdited ? C_EDIT_BG : null;
    if (bg) ctx.page.drawRectangle({ x: ML, y: y - rowH, width: CW, height: rowH, color: bg });

    ctx.page.drawText(fmtDate(r.lineDate), { x: tgColX(0) + COL_PAD, y: y - 10, size: 7, font: ctx.fontR, color: C_TEXT });
    let dy = y - 10;
    for (const line of destLines) { ctx.page.drawText(line, { x: tgColX(1) + COL_PAD, y: dy, size: 7, font: ctx.fontR, color: C_TEXT }); dy -= 8.5; }

    const vals = [amt(r.travelItem), amt(r.dailyItem), amt(r.accomItem), amt(r.tEntItem)];
    vals.forEach((v, i) => {
      const s = v > 0 ? fmtMoney(v) : "-";
      const w = ctx.fontR.widthOfTextAtSize(s, 7.5);
      ctx.page.drawText(s, { x: tgColX(2 + i) + TG_NUM - COL_PAD - w, y: y - 10, size: 7.5, font: ctx.fontR, color: C_TEXT });
    });
    let ry = y - 10;
    for (const line of remarksLines) { ctx.page.drawText(line, { x: tgColX(6) + COL_PAD, y: ry, size: 6.5, font: ctx.fontR, color: C_TEXT }); ry -= 8; }

    ctx.page.drawLine({ start: { x: ML, y: y - rowH }, end: { x: W - MR, y: y - rowH }, thickness: 0.4, color: C_LINE });
    ctx.curY -= rowH;
    total += vals.reduce((s, v) => s + v, 0);
  });

  // Sub-Total row, one figure per numeric column.
  ensureSpace(ctx, ROW_BASE_H);
  const y = ctx.curY;
  ctx.page.drawRectangle({ x: ML, y: y - ROW_BASE_H, width: CW, height: ROW_BASE_H, color: C_GROUP_BG });
  ctx.page.drawText("Sub-Total", { x: tgColX(1) + COL_PAD, y: y - 10, size: 7.5, font: ctx.fontB, color: C_TEXT });
  const colTotals = [
    rows.reduce((s, r) => s + amt(r.travelItem), 0),
    rows.reduce((s, r) => s + amt(r.dailyItem), 0),
    rows.reduce((s, r) => s + amt(r.accomItem), 0),
    rows.reduce((s, r) => s + amt(r.tEntItem), 0),
  ];
  colTotals.forEach((v, i) => {
    const s = fmtMoney(v);
    const w = ctx.fontB.widthOfTextAtSize(s, 7.5);
    ctx.page.drawText(s, { x: tgColX(2 + i) + TG_NUM - COL_PAD - w, y: y - 10, size: 7.5, font: ctx.fontB, color: C_TEXT });
  });
  ctx.curY -= ROW_BASE_H + 12;

  return total;
}

// ── Generic Description / RM / Remarks table (Misc, In-Base, Other) ────────
interface ExpenseRow {
  letter?: string;
  date?: string;
  description: string;
  amountMyr: number;
  remarks: string;
  slashed: boolean;
  edited: boolean;
}

function drawSimpleExpenseTable(
  ctx: Ctx,
  title: string,
  rows: ExpenseRow[],
  opts: { showDate: boolean; showLetter: boolean },
): number {
  if (rows.length === 0) return 0;

  const letterW = opts.showLetter ? 20 : 0;
  const dateW = opts.showDate ? 55 : 0;
  const amtW = 65;
  const remW = 110;
  const descW = CW - letterW - dateW - amtW - remW;
  const cols: Array<[string, number]> = [
    ...(opts.showLetter ? [["NO", letterW] as [string, number]] : []),
    ...(opts.showDate ? [["DATE", dateW] as [string, number]] : []),
    ["DESCRIPTION", descW], ["RM", amtW], ["REMARKS", remW],
  ];
  const colX = (idx: number) => { let x = ML; for (let i = 0; i < idx; i++) x += cols[i][1]; return x; };

  ctx.page.drawText(title, { x: ML, y: ctx.curY - 9, size: 9, font: ctx.fontB, color: C_TEXT });
  ctx.curY -= 15;

  const drawHdr = () => {
    const y = ctx.curY;
    ctx.page.drawRectangle({ x: ML, y: y - TBL_HDR_H, width: CW, height: TBL_HDR_H, color: C_THDR });
    cols.forEach(([label], i) => {
      const align = label === "RM" ? "right" : "left";
      const w = cols[i][1];
      const sz = 6.5;
      const tw = ctx.fontB.widthOfTextAtSize(label, sz);
      const tx = align === "right" ? colX(i) + w - COL_PAD - tw : colX(i) + COL_PAD;
      ctx.page.drawText(label, { x: tx, y: y - TBL_HDR_H + 5, size: sz, font: ctx.fontB, color: C_WHITE });
    });
    ctx.curY -= TBL_HDR_H;
  };
  ensureSpace(ctx, TBL_HDR_H + ROW_BASE_H);
  drawHdr();

  const descColIdx = cols.length - 3;
  const remColIdx = cols.length - 1;
  let total = 0;
  rows.forEach((r, idx) => {
    const descLines = wrapLines(r.description, ctx.fontR, 7.5, descW - COL_PAD * 2, 2);
    const remarksLines = wrapLines(r.remarks, ctx.fontR, 6.5, remW - COL_PAD * 2, 2);
    const rowH = Math.max(ROW_BASE_H, Math.max(descLines.length, remarksLines.length) * 9 + 6);

    if (ctx.curY - rowH < MB + PAGE_FTR_H) {
      addPage(ctx);
      ctx.page.drawText(`${san(title)} — continued`, { x: ML, y: ctx.curY - 11, size: 7.5, font: ctx.fontB, color: C_MUTED });
      ctx.curY -= 15;
      drawHdr();
    }

    const y = ctx.curY;
    const bg = r.slashed ? C_SLASH_BG : r.edited ? C_EDIT_BG : idx % 2 === 1 ? C_ROW_ALT : null;
    if (bg) ctx.page.drawRectangle({ x: ML, y: y - rowH, width: CW, height: rowH, color: bg });

    let ci = 0;
    if (opts.showLetter) { ctx.page.drawText(r.letter ?? "", { x: colX(ci) + COL_PAD, y: y - 10, size: 7.5, font: ctx.fontR, color: C_TEXT }); ci++; }
    if (opts.showDate) { ctx.page.drawText(fmtDate(r.date), { x: colX(ci) + COL_PAD, y: y - 10, size: 7.5, font: ctx.fontR, color: C_TEXT }); ci++; }
    let dy = y - 10;
    for (const line of descLines) { ctx.page.drawText(line, { x: colX(descColIdx) + COL_PAD, y: dy, size: 7.5, font: ctx.fontR, color: C_TEXT }); dy -= 9; }
    if (descLines.length === 0) ctx.page.drawText("—", { x: colX(descColIdx) + COL_PAD, y: y - 10, size: 7.5, font: ctx.fontR, color: C_FAINT });

    const amtStr = fmtMoney(r.amountMyr);
    const amtColIdx = cols.length - 2;
    const aw = ctx.fontB.widthOfTextAtSize(amtStr, 8);
    ctx.page.drawText(amtStr, { x: colX(amtColIdx) + cols[amtColIdx][1] - COL_PAD - aw, y: y - 10, size: 8, font: ctx.fontB, color: C_TEXT });

    let ry = y - 10;
    for (const line of remarksLines) { ctx.page.drawText(line, { x: colX(remColIdx) + COL_PAD, y: ry, size: 6.5, font: ctx.fontR, color: C_AMBER }); ry -= 8; }

    ctx.page.drawLine({ start: { x: ML, y: y - rowH }, end: { x: W - MR, y: y - rowH }, thickness: 0.4, color: C_LINE });
    ctx.curY -= rowH;
    total += r.amountMyr;
  });

  ctx.curY -= 12;
  return total;
}

function localExpenseRows(items: LineItem[], category: string, useLetters: boolean): ExpenseRow[] {
  const matches = items.filter((i) => i.category === category);
  const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  return matches.map((item, idx) => ({
    letter: useLetters ? LETTERS[idx] ?? String(idx + 1) : undefined,
    date: item.lineDate,
    description: item.venue
      ? (item.description ? `${item.venue} — ${item.description}` : item.venue)
      : (item.description ?? MISC_FIXED_LABELS[category] ?? ""),
    amountMyr: amt(item),
    remarks: itemRemark(item),
    slashed: item.slashed,
    edited: !!item.editedBy,
  }));
}

// ── Totals block — mirrors the org's paper form's bottom summary ──────────
function drawLocalTotalsBlock(ctx: Ctx, claim: ClaimApplicationDetailForPdf, travelTotal: number, miscTotal: number): void {
  const rows: Array<[string, string, boolean]> = [
    ["Total Travel Expenses", `RM ${fmtMoney(travelTotal)}`, false],
    ["Total Miscellaneous Expenses", `RM ${fmtMoney(miscTotal)}`, false],
    ["Total Expenses", `RM ${fmtMoney(travelTotal + miscTotal)}`, false],
    ["Less Cash Advance (If Any)", "—", false],
    ["Total Reimbursement", `RM ${fmtMoney(claim.amount)}`, true],
  ];
  const rowH = 16;
  const boxH = rows.length * rowH + 12;
  ensureSpace(ctx, boxH + 10);
  const y0 = ctx.curY;
  ctx.page.drawRectangle({ x: ML + CW * 0.42, y: y0 - boxH, width: CW * 0.58, height: boxH, color: C_TOTAL_BG, borderColor: C_GREEN, borderWidth: 0.75, borderOpacity: 0.4 });

  let y = y0 - 10;
  for (const [label, value, emphasize] of rows) {
    ctx.page.drawText(label, { x: ML + CW * 0.42 + 10, y: y - 8, size: emphasize ? 9.5 : 8.5, font: emphasize ? ctx.fontB : ctx.fontR, color: emphasize ? C_TEXT : C_MUTED });
    const font = emphasize ? ctx.fontB : ctx.fontR;
    const sz = emphasize ? 11 : 9;
    const vw = font.widthOfTextAtSize(value, sz);
    ctx.page.drawText(value, { x: ML + CW - 10 - vw, y: y - (emphasize ? 9 : 8), size: sz, font, color: emphasize ? C_GREEN : C_TEXT });
    y -= rowH;
  }
  ctx.curY = y0 - boxH - 16;
}

function drawLocalClaimBody(ctx: Ctx, claim: ClaimApplicationDetailForPdf): void {
  const travelTotal = drawTravelGrid(ctx, claim);

  const miscCats = [LINE_CATEGORY.TOLL, LINE_CATEGORY.PARKING, LINE_CATEGORY.MOBILE];
  const miscRows = miscCats.flatMap((cat) => localExpenseRows(claim.lineItems, cat, false));
  const miscSubtotal = miscRows.length > 0 ? drawSimpleExpenseTable(ctx, "1.2   Miscellaneous Expenses", miscRows, { showDate: false, showLetter: false }) : 0;

  const inBaseRows = localExpenseRows(claim.lineItems, LINE_CATEGORY.IN_BASE_ENT, false);
  const inBaseSubtotal = inBaseRows.length > 0 ? drawSimpleExpenseTable(ctx, "1.3   In-Base Entertainment", inBaseRows, { showDate: true, showLetter: false }) : 0;

  const otherRows = localExpenseRows(claim.lineItems, LINE_CATEGORY.OTHER_LOCAL, true);
  const otherSubtotal = otherRows.length > 0 ? drawSimpleExpenseTable(ctx, "1.4   Other Expenses", otherRows, { showDate: true, showLetter: true }) : 0;

  drawLocalTotalsBlock(ctx, claim, travelTotal, miscSubtotal + inBaseSubtotal + otherSubtotal);
}

// ── Totals ─────────────────────────────────────────────────────────────────
function drawTotals(ctx: Ctx, claim: ClaimApplicationDetailForPdf): void {
  const h = 30;
  ensureSpace(ctx, h + 16);
  ctx.curY -= 6;
  const y = ctx.curY;
  ctx.page.drawRectangle({ x: ML, y: y - h, width: CW, height: h, color: C_TOTAL_BG, borderColor: C_GREEN, borderWidth: 0.75, borderOpacity: 0.45 });
  const label = "GRAND TOTAL";
  ctx.page.drawText(label, { x: ML + 12, y: y - h / 2 - 4, size: 10, font: ctx.fontB, color: C_TEXT });
  const value = `RM ${fmtMoney(claim.amount)}`;
  const vw = ctx.fontB.widthOfTextAtSize(value, 14);
  ctx.page.drawText(value, { x: ML + CW - 12 - vw, y: y - h / 2 - 5, size: 14, font: ctx.fontB, color: C_GREEN });
  ctx.curY -= h + 16;
}

// ── Approval trail ─────────────────────────────────────────────────────────
// A vertical timeline (dot marker + connecting line per step) reads as a
// process at a glance, rather than a flat stack of label/name/date lines.
function drawApprovalTrail(ctx: Ctx, claim: ClaimApplicationDetailForPdf): void {
  const rows: Array<{ label: string; name: string | null; at: Date | string | null; note: string | null; color: ReturnType<typeof rgb> }> = [
    { label: "Submitted by", name: claim.applicantName, at: claim.createdAt, note: null, color: C_TEXT },
  ];
  if (claim.checkedAt) {
    rows.push({
      label: claim.status === "REJECTED" && !claim.reviewedAt ? "Rejected by checker" : "Checked by",
      name: claim.checkedByName, at: claim.checkedAt, note: claim.checkerComment,
      color: claim.status === "REJECTED" ? C_RED : C_BLUE,
    });
  }
  if (claim.reviewedAt) {
    rows.push({
      label: claim.status === "APPROVED" ? "Approved by" : "Rejected by",
      name: claim.reviewedByName, at: claim.reviewedAt, note: claim.reviewComment,
      color: claim.status === "APPROVED" ? C_GREEN : C_RED,
    });
  }
  if (claim.cancelledAt) {
    rows.push({
      label: "Cancelled by", name: claim.cancelledByName, at: claim.cancelledAt, note: claim.cancelReason,
      color: C_FAINT,
    });
  }

  const rowH = 28;
  ensureSpace(ctx, 20 + rows.length * rowH);
  ctx.page.drawText("APPROVAL TRAIL", { x: ML, y: ctx.curY - 9, size: 8, font: ctx.fontB, color: C_MUTED });
  ctx.curY -= 20;

  const dotX = ML + 4;
  const textX = dotX + 12;
  rows.forEach((r, i) => {
    if (ctx.curY - rowH < MB + PAGE_FTR_H) addPage(ctx);
    const y = ctx.curY;
    const dotY = y - 9;

    if (i < rows.length - 1) {
      ctx.page.drawLine({ start: { x: dotX, y: dotY - 3.5 }, end: { x: dotX, y: y - rowH + 3 }, thickness: 1, color: C_LINE });
    }
    ctx.page.drawCircle({ x: dotX, y: dotY, size: 3, color: r.color });

    ctx.page.drawText(r.label, { x: textX, y: y - 10, size: 8.5, font: ctx.fontB, color: r.color });
    const atStr = fmtDate(r.at);
    const atW = ctx.fontR.widthOfTextAtSize(atStr, 8);
    if (r.name) {
      const labelW = ctx.fontB.widthOfTextAtSize(`${r.label} `, 8.5);
      const nameMaxW = W - MR - atW - 10 - (textX + labelW);
      ctx.page.drawText(trunc(r.name, ctx.fontR, 8.5, nameMaxW), { x: textX + labelW, y: y - 10, size: 8.5, font: ctx.fontR, color: C_TEXT });
    }
    ctx.page.drawText(atStr, { x: W - MR - atW, y: y - 10, size: 8, font: ctx.fontR, color: C_MUTED });
    if (r.note) {
      ctx.page.drawText(trunc(r.note, ctx.fontR, 8, W - MR - textX), { x: textX, y: y - 21, size: 8, font: ctx.fontR, color: C_MUTED });
    }
    ctx.curY -= rowH;
  });
}

// ── Public ──────────────────────────────────────────────────────────────────
export async function generateClaimPdf(
  claim: ClaimApplicationDetailForPdf,
  orgProfile: FullOrganizationProfile,
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const ctx = await buildContext(pdfDoc, orgProfile);
  const formType = getFormType(claim);

  addPage(ctx);
  drawPageHeader(ctx, claim);
  drawClaimInfo(ctx, claim, formType);

  if (formType === CLAIM_FORM.LOCAL) {
    // Modelled on the org's own paper reimbursement form (Appendix I travel
    // grid + Misc/In-Base/Other tables + Totals block) — its own totals
    // block replaces the generic Grand Total box below.
    drawLocalClaimBody(ctx, claim);
  } else {
    if (formType === CLAIM_FORM.ENTERTAINMENT_FORM) {
      drawEntertainmentSection(ctx, claim);
    } else {
      drawLineItemsSection(ctx, claim);
    }
    drawTotals(ctx, claim);
  }
  drawApprovalTrail(ctx, claim);

  stampFooters(ctx);
  return pdfDoc.save();
}
