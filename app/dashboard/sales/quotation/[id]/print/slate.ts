import { getQuotationDetail } from "@/server/quotation";
import { PDFDocument, PDFFont, PDFPage, PDFImage, rgb, StandardFonts } from "pdf-lib";
import {
  drawCompanyHeader, estimateHeaderH,
} from "./_pdf-header";

type Data = NonNullable<Awaited<ReturnType<typeof getQuotationDetail>>>;

// ── A4 dimensions & margins ────────────────────────────────────────────────
const W  = 595.28;
const H  = 841.89;
const ML = 36;
const MR = 36;
const MB = 30;
const CW = W - ML - MR;

// ── Palette ────────────────────────────────────────────────────────────────
const C_DARK  = rgb(0.08, 0.08, 0.08);
const C_BODY  = rgb(0.32, 0.32, 0.32);
const C_MID   = rgb(0.50, 0.50, 0.50);
const C_LITE  = rgb(0.66, 0.66, 0.66);
const C_LINE  = rgb(0.88, 0.88, 0.88);
const C_BG1   = rgb(0.955, 0.957, 0.963); // light gray band
const C_WHITE = rgb(1, 1, 1);
const C_GREEN = rgb(0.07, 0.38, 0.18);
const C_AMBER = rgb(0.55, 0.23, 0.04);

// ── Layout ─────────────────────────────────────────────────────────────────
const ACCENT_BAR_H = 5;    // thin accent line at very top
const HDR_BODY_H   = 80;   // company info area below bar
const HDR_H        = ACCENT_BAR_H + HDR_BODY_H; // total header zone page 1
const PREP_BAND_H  = 66;   // "PREPARED FOR" gray band
const TABLE_PAD    = 6;
const LOGO_H_MAX   = 50;
const LOGO_W_MAX   = 110;
const BADGE_SZ     = 13;   // row-number badge size

// ── Helpers ────────────────────────────────────────────────────────────────
function fmtD(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-MY", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

function fmtM(v: string | number | null | undefined): string {
  return `RM ${Number(v ?? 0).toLocaleString("en-MY", { minimumFractionDigits: 2 })}`;
}

function sanitizeText(t: string): string {
  return String(t).replace(/[\x00-\x1F\x7F]/g, " ");
}

function wrap(text: string, font: PDFFont, size: number, maxW: number): string[] {
  if (!text) return [""];
  const words = sanitizeText(text).split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const word of words) {
    const test = cur ? `${cur} ${word}` : word;
    if (font.widthOfTextAtSize(test, size) <= maxW) {
      cur = test;
    } else {
      if (cur) lines.push(cur);
      let rem = word;
      while (font.widthOfTextAtSize(rem, size) > maxW && rem.length > 1) {
        let cut = rem.length - 1;
        while (cut > 0 && font.widthOfTextAtSize(rem.slice(0, cut) + "-", size) > maxW) cut--;
        if (cut === 0) break;
        lines.push(rem.slice(0, cut) + "-");
        rem = rem.slice(cut);
      }
      cur = rem;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

function trunc(text: string, font: PDFFont, size: number, maxW: number): string {
  if (!text) return "";
  const text2 = sanitizeText(text).trim();
  if (!text2) return "";
  if (font.widthOfTextAtSize(text2, size) <= maxW) return text2;
  let s = text2;
  while (s.length > 0 && font.widthOfTextAtSize(s + "…", size) > maxW) s = s.slice(0, -1);
  return s + "…";
}

function hLine(page: PDFPage, y: number, x1 = ML, x2 = W - MR, color = C_LINE, thick = 0.4) {
  page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness: thick, color });
}

function dashedLine(page: PDFPage, y: number, x1 = ML, x2 = W - MR, color = C_LINE) {
  const dashLen = 4;
  const gap     = 3;
  let x = x1;
  while (x < x2) {
    const end = Math.min(x + dashLen, x2);
    page.drawLine({ start: { x, y }, end: { x: end, y }, thickness: 0.5, color });
    x += dashLen + gap;
  }
}

// drawBox: draws a rectangle (optionally rounded) given top-left corner coords.
// yTop = PDF y-coordinate of the TOP of the box.
function drawBox(
  page: PDFPage,
  x: number, yTop: number, width: number, height: number,
  opts: {
    fillColor?: ReturnType<typeof rgb>;
    borderColor?: ReturnType<typeof rgb>;
    borderWidth?: number;
    rounded?: boolean;
    r?: number;
  },
) {
  const { fillColor, borderColor, borderWidth = 0.5, rounded = false, r = 5 } = opts;
  if (rounded) {
    const W = width, H = height;
    const path = `M ${r},0 L ${W - r},0 Q ${W},0 ${W},${r} L ${W},${H - r} Q ${W},${H} ${W - r},${H} L ${r},${H} Q 0,${H} 0,${H - r} L 0,${r} Q 0,0 ${r},0 Z`;
    page.drawSvgPath(path, {
      x, y: yTop,
      ...(fillColor   ? { color: fillColor }                 : {}),
      ...(borderColor ? { borderColor, borderWidth } : {}),
    });
  } else {
    page.drawRectangle({
      x, y: yTop - height, width, height,
      ...(fillColor   ? { color: fillColor }                 : {}),
      ...(borderColor ? { borderColor, borderWidth } : {}),
    });
  }
}

// ── Main export ────────────────────────────────────────────────────────────
function hexToColor(hex: string | null | undefined, fallback: ReturnType<typeof rgb>): ReturnType<typeof rgb> {
  if (!hex) return fallback;
  const h = hex.replace("#", "");
  if (h.length !== 6) return fallback;
  return rgb(
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  );
}

function muteColor(c: ReturnType<typeof rgb>, factor = 0.48): ReturnType<typeof rgb> {
  return rgb(
    c.red   + (1 - c.red)   * factor,
    c.green + (1 - c.green) * factor,
    c.blue  + (1 - c.blue)  * factor,
  );
}

export async function generateQuotationSlate(data: Data): Promise<Uint8Array> {
  const {
    quotation: q, items,
    orgName, orgLogoUrl, orgBrandColor,
    orgSlateTextColor, orgSlateHeadingColor, orgSlateInfoFontSize,
    orgCompanyName, orgCompanyAddress, orgTaxNo, orgPhone,
    orgEmail, orgWebsite, orgOldSsmNo, orgNewSsmNo, orgMdaEstablishmentNo,
    orgBankingInfo,
    orgMofCertUrl, orgSsmCertUrl, orgMdaCertUrl, orgTccCertUrl,
    orgBankStatementUrl, orgLampiran12Url, orgLampiran13Url,
  } = data;

  const DEFAULT_ACCENT = rgb(0.05, 0.14, 0.30);
  // accent  = line/box/badge colour (brandColor)
  // accentT = text accent colour (slateTextColor ?? accent)
  // accentH = heading colour for company name + QUOTATION (slateHeadingColor ?? accentT)
  const accent  = hexToColor(orgBrandColor,       DEFAULT_ACCENT);
  const accentT = hexToColor(orgSlateTextColor,   accent);
  const accentH = hexToColor(orgSlateHeadingColor, accentT);
  const accentMDA = muteColor(accentT, 0.48); // muted text for MDA line

  const cust     = q.customerSnapshot as any;
  const bankList = (orgBankingInfo ?? []) as any[];
  const bank     = bankList.find(b => b.isPrimary) ?? bankList[0] ?? null;
  const showDisc = !!Number(q.showItemizeDiscount);
  const showTP   = !!Number(q.showTotalPrice);
  const coName   = orgCompanyName ?? orgName;

  const sets           = Number(q.sets ?? 1);
  const subtotal       = Number(q.subtotal        ?? 0);
  const discAmt        = Number(q.overallDiscountAmt ?? 0);
  const sstAmt         = Number(q.sst              ?? 0);
  const grand          = Number(q.grandTotal       ?? 0);
  const subtotalPerSet = subtotal / sets;
  const itemDiscPerSet = items.reduce((s, i) => s + Number(i.discountAmt ?? 0), 0);
  const itemDiscTotal  = itemDiscPerSet * sets;
  const rawSubtotalPerSet = subtotalPerSet + itemDiscPerSet;
  const afterDisc      = subtotal - discAmt;

  const pdfDoc = await PDFDocument.create();
  const fontR  = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontB  = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const nameSize   = ({ small: 10, medium: 13, large: 16, xlarge: 20 } as Record<string,number>)[data.orgNameSize ?? "medium"] ?? 13;
  const nameFont   = !!(data.orgNameBold ?? 1) ? fontB : fontR;
  const dispName   = !!(data.orgNameUppercase ?? 0) ? coName.toUpperCase() : coName;
  const hLayout    = data.orgHeaderLayout ?? "standard";
  const QL_SIZE    = ({ small: 5.5, normal: 7, large: 10 } as Record<string,number>)[data.orgQuotationLabelSize ?? "normal"] ?? 7;
  const QL_FONT    = !!(data.orgQuotationLabelBold ?? 1) ? fontB : fontR;
  const QL_TEXT    = !!(data.orgQuotationLabelUppercase ?? 1) ? "QUOTATION" : "Quotation";
  const orgInfoSide = data.orgInfoSide ?? "left";
  const attnNameSz = ({ small: 10, medium: 13, large: 16, xlarge: 20 } as Record<string,number>)[data.orgAttentionNameSize ?? "medium"] ?? 13;
  const detailFSz  = ({ small: 8, normal: 9, large: 10.5 } as Record<string,number>)[data.orgDetailFontSize ?? "normal"] ?? 9;
  const slateInfoFS = ({ small: 8, normal: 9, large: 10 } as Record<string,number>)[orgSlateInfoFontSize ?? "normal"] ?? 9;
  const slateInfoLH = slateInfoFS + 3;  // line height for info section
  const IPAD_H = 10; // horizontal padding inside info boxes
  const IPAD_T = 10; // top padding inside info boxes
  const IPAD_B = 8;  // bottom padding inside info boxes

  // ── Logo ──────────────────────────────────────────────────────────────────
  let logoImg: PDFImage | null = null;
  if (orgLogoUrl) {
    try {
      const res = await fetch(orgLogoUrl);
      if (res.ok) {
        const buf = await res.arrayBuffer();
        logoImg = orgLogoUrl.toLowerCase().endsWith(".png")
          ? await pdfDoc.embedPng(buf)
          : await pdfDoc.embedJpg(buf);
      }
    } catch { /* no logo */ }
  }

  // ── Table style ──────────────────────────────────────────────────────────
  const tableRowStyle = data.orgTableRowStyle ?? "default";
  const showCode      = !!(data.orgShowCodeColumn ?? 1);

  // ── Column widths ─────────────────────────────────────────────────────────
  const C_NO   = 24;
  const C_CODE = showCode ? 64 : 0;
  const C_QTY  = 28;
  const C_UOM  = 32;
  const C_UP   = 64;
  const C_DISC = showDisc ? 32 : 0;
  const C_TOT  = showTP  ? 70 : 0;
  const C_DESC = CW - C_NO - C_CODE - C_QTY - C_UOM - C_UP - C_DISC - C_TOT;

  const X_NO   = ML;
  const X_CODE = X_NO   + C_NO;
  const X_DESC = X_CODE + C_CODE;
  const X_QTY  = X_DESC + C_DESC;
  const X_UOM  = X_QTY  + C_QTY;
  const X_UP   = X_UOM  + C_UOM;
  const X_DISC = X_UP   + C_UP;
  const X_TOT  = X_DISC + C_DISC;

  // ── Font size + layout from org table font size ───────────────────────────
  const tfs    = data.orgTableFontSize ?? "normal";
  const FS_DESC   = tfs === "small" ? 8    : tfs === "large" ? 11   : 9.5;
  const FS_DETAIL = tfs === "small" ? 7.5  : tfs === "large" ? 10   : 8.5;
  const FS_CODE   = tfs === "small" ? 7.5  : tfs === "large" ? 10   : 9;
  const FS_NUM    = tfs === "small" ? 7.5  : tfs === "large" ? 9.5  : 8.5;
  const LH        = tfs === "small" ? 10   : tfs === "large" ? 13.5 : 11.5;
  const RH_MIN    = tfs === "small" ? 20   : tfs === "large" ? 27   : 24;
  const MDA_GAP   = 3;

  const hasBanner = (data.orgTitlePosition ?? "stamp") === "table-banner";
  const BANNER_H  = 20;

  // ── Pre-compute row heights ───────────────────────────────────────────────
  type RowInfo = {
    item: typeof items[number];
    descLines: string[];
    extraLine: string | null;
    isGreenRow: boolean;
    rowH: number;
  };

  const CODE_LINE_H = LH - 2;
  const rowInfos: RowInfo[] = items.map(item => {
    const descLines = wrap(item.description ?? "—", fontR, FS_DESC, C_DESC - TABLE_PAD * 2);
    const extraLine = item.hasCert && item.mdaRegNo
      ? `MDA: ${item.mdaRegNo}${item.mdaValidity ? ` · Exp: ${fmtD(item.mdaValidity)}` : ""}`
      : (!item.hasCert ? "No MDA certificate" : null);
    const isGreenRow = !!(item.hasCert && item.mdaRegNo);
    const codeLineH  = !showCode && item.productCode ? CODE_LINE_H : 0;
    const rowH = Math.max(
      RH_MIN,
      codeLineH + descLines.length * LH + (extraLine ? RH_MIN + MDA_GAP + 2 : 10),
    );
    return { item, descLines, extraLine, isGreenRow, rowH };
  });

  // ── Height estimates ──────────────────────────────────────────────────────
  const QL_BAND_H = 34; // space reserved below company info for the QUOTATION label
  const HEADER_BLOCK = estimateHeaderH({
    companyAddress: orgCompanyAddress, phone: orgPhone, email: orgEmail,
    website: orgWebsite, oldSsmNo: orgOldSsmNo, newSsmNo: orgNewSsmNo,
    mdaEstablishmentNo: orgMdaEstablishmentNo, taxNo: orgTaxNo,
    nameSize, logoHMax: LOGO_H_MAX, logoWMax: LOGO_W_MAX, headerLayout: hLayout,
    logoImg, fontR, skipDocLabel: true, inlineSsmMdaTax: true,
  }) + 6 + QL_BAND_H;
  const DIVIDER_GAP   = 18;
  const TABLE_HDR_H   = 22;

  // ── Slate-specific info section height estimate ───────────────────────────
  const custName = cust ? [cust.title, cust.name].filter(Boolean).join(" ") : null;
  let leftH = IPAD_T + slateInfoFS + 6; // "ATTENTION TO" label
  if (cust) {
    if (custName) leftH += slateInfoFS + 4;
    if (cust.position || cust.department) leftH += slateInfoLH;
    if (cust.organizationName) leftH += slateInfoLH;
    if (cust.organizationAddress) leftH += slateInfoLH * 2;
    if (cust.email || cust.contactNo) leftH += slateInfoLH;
  } else { leftH += slateInfoLH; }
  leftH += IPAD_B;

  const detailRowCount = 3 + (q.title ? 1 : 0);
  const rightH = IPAD_T + slateInfoFS + 6 + detailRowCount * slateInfoLH + IPAD_B;
  const INFO_BLOCK = Math.max(leftH, rightH);

  const totRowCount = 1 + (showDisc && itemDiscPerSet > 0 ? 2 : 0) + (sets > 1 ? 1 : 0) + (discAmt > 0 ? 3 : 0) + (sstAmt > 0 ? 1 : 0);
  const noteLines   = q.notes ? wrap(q.notes, fontR, 9.5, CW - 20) : [];
  const TOTALS_H      = 14 + totRowCount * 13 + 14 + 50 + 18;
  const NOTES_H       = q.notes ? noteLines.length * 12 + 30 : 0;
  const FOOTER_BLOCK  = 32;
  const CLOSING_H     = 38;
  const ACCEPT_H      = q.status === "final" ? 70 : 0;
  const BOTTOM_RESERVE = TOTALS_H + NOTES_H + FOOTER_BLOCK + 12 + CLOSING_H + ACCEPT_H;

  const P1_ROW_AVAIL = H - MB - HEADER_BLOCK - DIVIDER_GAP - INFO_BLOCK - DIVIDER_GAP - TABLE_HDR_H - (hasBanner ? BANNER_H : 0) - 20;
  const PN_HDR_H     = q.title ? 38 : 26; // continuation header height varies with title
  const PN_ROW_AVAIL = H - ACCENT_BAR_H - PN_HDR_H - TABLE_HDR_H - MB - 20;

  // ── Paginate rows ─────────────────────────────────────────────────────────
  const pageGroups: number[][] = [];
  let curGroup: number[] = [];
  let usedH = 0;
  let firstPage = true;

  for (let i = 0; i < rowInfos.length; i++) {
    const rh    = rowInfos[i].rowH;
    const avail = firstPage
      ? Math.max(P1_ROW_AVAIL, RH_MIN * 3)
      : Math.max(PN_ROW_AVAIL, RH_MIN * 3);
    if (usedH + rh > avail && curGroup.length > 0) {
      pageGroups.push(curGroup);
      curGroup  = [i];
      usedH     = rh;
      firstPage = false;
    } else {
      curGroup.push(i);
      usedH += rh;
    }
  }
  pageGroups.push(curGroup);

  // ── Ensure last page fits totals; split rather than leave totals alone ────
  {
    const lastGroup   = pageGroups[pageGroups.length - 1];
    const lastIsFirst = pageGroups.length === 1;
    const lastAvail   = Math.max(lastIsFirst ? P1_ROW_AVAIL : PN_ROW_AVAIL, RH_MIN * 3);
    const lastItemsH  = lastGroup.reduce((s, i) => s + rowInfos[i].rowH, 0);
    if (lastItemsH + BOTTOM_RESERVE > lastAvail && lastGroup.length > 1) {
      let fitH = 0, splitAt = 0;
      for (const idx of lastGroup) {
        if (fitH + rowInfos[idx].rowH + BOTTOM_RESERVE <= lastAvail) { fitH += rowInfos[idx].rowH; splitAt++; }
        else break;
      }
      splitAt = Math.max(1, splitAt);
      if (splitAt < lastGroup.length) {
        pageGroups[pageGroups.length - 1] = lastGroup.slice(0, splitAt);
        pageGroups.push(lastGroup.slice(splitAt));
      }
    }
  }

  const totalPages = pageGroups.length;

  // ── Draw pages ────────────────────────────────────────────────────────────
  for (let pi = 0; pi < pageGroups.length; pi++) {
    const isFirst   = pi === 0;
    const isLast    = pi === pageGroups.length - 1;
    const page      = pdfDoc.addPage([W, H]);
    const pageItems = pageGroups[pi];

    // ── Footer: bottom accent bar + text ──────────────────────────────────
    page.drawRectangle({ x: 0, y: MB + 14, width: W, height: 2, color: accent });
    page.drawText(q.quotationNo, {
      x: ML, y: MB + 4, size: 7, font: fontR, color: C_LITE,
    });
    const pgText = `Page ${pi + 1} of ${totalPages}`;
    const pgCenter = (W - fontR.widthOfTextAtSize(pgText, 7)) / 2;
    page.drawText(pgText, { x: pgCenter, y: MB + 4, size: 7, font: fontR, color: C_LITE });
    page.drawText("Confidential", {
      x: W - MR - fontR.widthOfTextAtSize("Confidential", 7),
      y: MB + 4, size: 7, font: fontR, color: C_LITE,
    });

    let curY = H - MB; // slate footer uses MB-based layout; header starts from top

    // ── Page 1: header + info ────────────────────────────────────────────────
    if (isFirst) {
      curY = H - MB; // reset to top margin area (slate uses no MT constant)
      drawCompanyHeader({
        page, startY: H - 15, accent, fontR, fontB, logoImg,
        companyName: coName, companyAddress: orgCompanyAddress,
        phone: orgPhone, email: orgEmail, website: orgWebsite,
        oldSsmNo: orgOldSsmNo, newSsmNo: orgNewSsmNo,
        mdaEstablishmentNo: orgMdaEstablishmentNo, taxNo: orgTaxNo,
        nameSize, nameBold: !!(data.orgNameBold ?? 1),
        nameUppercase: !!(data.orgNameUppercase ?? 0),
        headerLayout: hLayout, docLabel: "",  // label drawn separately below
        docLabelSize: QL_SIZE, docLabelBold: !!(data.orgQuotationLabelBold ?? 1), docLabelAlign: (data.orgQuotationLabelAlign ?? "right") as "left" | "center" | "right",
        nameColor: accentH, labelColor: accentH,
        logoHMax: LOGO_H_MAX, logoWMax: LOGO_W_MAX,
        inlineSsmMdaTax: true,
      });
      curY = H - 5 - HEADER_BLOCK;

      // QUOTATION label sits between company info and the divider line
      page.drawText(QL_TEXT, {
        x: ML, y: curY + QL_BAND_H - 24,
        size: 16, font: fontB, color: accentH,
      });

      hLine(page, curY, ML, W - MR, accent, 1.2);
      curY -= DIVIDER_GAP;

      // ── Info section: two boxes + content ──────────────────────────────
      {
        const isRounded   = tableRowStyle === "rounded";
        const INFO_LEFT_W  = CW * 0.55;
        const INFO_RIGHT_X = ML + INFO_LEFT_W;
        const INFO_RIGHT_W = CW * 0.45;
        const boxTop = curY + 4;
        const boxH   = INFO_BLOCK + 6;

        // Draw boxes (rounded if table is rounded)
        drawBox(page, ML,                boxTop, INFO_LEFT_W  - 3, boxH, { borderColor: accent, borderWidth: 0.6, rounded: isRounded });
        drawBox(page, INFO_RIGHT_X + 3,  boxTop, INFO_RIGHT_W - 3, boxH, { borderColor: accent, borderWidth: 0.6, rounded: isRounded });

        // ── Left box: ATTENTION TO ──────────────────────────────────────
        const leftX    = ML + IPAD_H;
        const leftMaxW = INFO_LEFT_W - 3 - IPAD_H * 2;
        let ly = boxTop - IPAD_T - slateInfoFS;

        page.drawText("ATTENTION TO", { x: leftX, y: ly, size: slateInfoFS, font: fontB, color: accentT });
        ly -= slateInfoFS + 6;

        if (cust) {
          if (custName) {
            page.drawText(trunc(custName, fontB, slateInfoFS, leftMaxW), {
              x: leftX, y: ly, size: slateInfoFS, font: fontB, color: C_DARK,
            });
            ly -= slateInfoFS + 4;
          }
          if (cust.position || cust.department) {
            const pos = [cust.position, cust.department].filter(Boolean).join(", ");
            page.drawText(trunc(pos, fontR, slateInfoFS, leftMaxW), {
              x: leftX, y: ly, size: slateInfoFS, font: fontR, color: C_BODY,
            });
            ly -= slateInfoLH;
          }
          if (cust.organizationName) {
            page.drawText(trunc(cust.organizationName, fontR, slateInfoFS, leftMaxW), {
              x: leftX, y: ly, size: slateInfoFS, font: fontR, color: C_BODY,
            });
            ly -= slateInfoLH;
          }
          if (cust.organizationAddress) {
            for (const line of wrap(cust.organizationAddress, fontR, slateInfoFS, leftMaxW).slice(0, 2)) {
              page.drawText(line, { x: leftX, y: ly, size: slateInfoFS, font: fontR, color: C_MID });
              ly -= slateInfoLH;
            }
          }
          if (cust.email || cust.contactNo) {
            const contact = [cust.email, cust.contactNo].filter(Boolean).join("  ·  ");
            page.drawText(trunc(contact, fontR, slateInfoFS, leftMaxW), {
              x: leftX, y: ly, size: slateInfoFS, font: fontR, color: C_MID,
            });
          }
        } else {
          page.drawText("—", { x: leftX, y: ly, size: slateInfoFS, font: fontR, color: C_MID });
        }

        // ── Right box: QUOTATION DETAILS ────────────────────────────────
        const rightX    = INFO_RIGHT_X + 3 + IPAD_H;
        const rightMaxW = INFO_RIGHT_W - 3 - IPAD_H * 2;
        let ry = boxTop - IPAD_T - slateInfoFS;

        page.drawText("QUOTATION DETAILS", { x: rightX, y: ry, size: slateInfoFS, font: fontB, color: accentT });
        ry -= slateInfoFS + 6;

        const detailRows: [string, string][] = [
          ["Quotation No", q.quotationNo],
          ["Date",         fmtD(q.createdAt)],
          ["Valid Until",  fmtD(q.validUntil)],
          ...(q.title           ? [["Subject",     q.title]]           as [string,string][] : []),
        ];
        const rightAlign = (data.orgDetailAlignment ?? "right") === "right";
        const rightEdgeX = INFO_RIGHT_X + 3 + INFO_RIGHT_W - 3 - IPAD_H; // inner right edge of box
        for (const [lbl, val] of detailRows) {
          const lblStr = `${lbl}:`;
          if (rightAlign) {
            // Label flush-left, value flush-right inside the box
            page.drawText(lblStr, { x: rightX, y: ry, size: slateInfoFS, font: fontR, color: C_MID });
            const valStr = trunc(val, fontB, slateInfoFS, rightMaxW * 0.55);
            const valW   = fontB.widthOfTextAtSize(valStr, slateInfoFS);
            page.drawText(valStr, { x: rightEdgeX - valW, y: ry, size: slateInfoFS, font: fontB, color: C_DARK });
          } else {
            // Left-aligned: label + value inline
            const lblW = fontR.widthOfTextAtSize(`${lblStr} `, slateInfoFS);
            page.drawText(`${lblStr} `, { x: rightX, y: ry, size: slateInfoFS, font: fontR, color: C_MID });
            page.drawText(trunc(val, fontB, slateInfoFS, rightMaxW - lblW), {
              x: rightX + lblW, y: ry, size: slateInfoFS, font: fontB, color: C_DARK,
            });
          }
          ry -= slateInfoLH;
        }
      }
      curY -= INFO_BLOCK + DIVIDER_GAP;
      hLine(page, curY);
      curY -= 10;

    } else {
      // ── Continuation header ────────────────────────────────────────────
      page.drawRectangle({ x: 0, y: H - ACCENT_BAR_H, width: W, height: ACCENT_BAR_H, color: accent });
      curY = H - ACCENT_BAR_H - 10;
      // Quotation no + "continued" on the first meta line
      page.drawText(`${q.quotationNo}`, {
        x: ML, y: curY - 8, size: 8, font: fontR, color: C_MID,
      });
      page.drawText("continued", {
        x: ML + fontR.widthOfTextAtSize(`${q.quotationNo}  `, 8),
        y: curY - 8, size: 8, font: fontR, color: C_LITE,
      });
      // Title on a second line (if present)
      if (q.title) {
        page.drawText(trunc(q.title, fontB, 11, CW), {
          x: ML, y: curY - 22, size: 11, font: fontB, color: accentT,
        });
        curY -= 38;
      } else {
        curY -= 26;
      }
    }

    // ── Title banner (optional merged row above column headers) ───────────────
    const tableTopY = curY;
    if (hasBanner && isFirst) {
      page.drawRectangle({ x: ML, y: curY - BANNER_H, width: CW, height: BANNER_H, color: C_BG1 });
      page.drawText(q.title ?? "Loose Items", {
        x: ML + TABLE_PAD, y: curY - BANNER_H + 6,
        size: 9, font: fontB, color: accent,
      });
      curY -= BANNER_H;
    }

    // ── Table headers (accent-colored text + underline, no background) ───
    const TABLE_HDR_H = 22;
    const tHdrY = curY - TABLE_HDR_H;

    const thdrs: { label: string; x: number; w: number; align: "l" | "c" | "r" }[] = [
      { label: "No",          x: X_NO,   w: C_NO,   align: "c" },
      ...(showCode ? [{ label: "Code", x: X_CODE, w: C_CODE, align: "l" as const }] : []),
      { label: "Description", x: X_DESC, w: C_DESC, align: "l" },
      { label: "Qty",         x: X_QTY,  w: C_QTY,  align: "c" },
      { label: "UOM",         x: X_UOM,  w: C_UOM,  align: "c" },
      { label: "Unit Price",  x: X_UP,   w: C_UP,   align: "r" as const },
      ...(showDisc ? [{ label: "Disc%", x: X_DISC, w: C_DISC, align: "c" as const }] : []),
      ...(showTP   ? [{ label: "Total", x: X_TOT,  w: C_TOT,  align: "r" as const }] : []),
    ];

    for (const col of thdrs) {
      const tw = fontB.widthOfTextAtSize(col.label, 7.5);
      const tx = col.x + (col.w - tw) / 2;
      page.drawText(col.label.toUpperCase(), {
        x: tx, y: tHdrY + 8, size: 7.5, font: fontB, color: accentT,
      });
    }
    // Underline the column headers with a solid accent rule (line colour)
    page.drawRectangle({ x: ML, y: tHdrY, width: CW, height: 1.8, color: accent });
    curY = tHdrY;

    // ── Item rows ────────────────────────────────────────────────────────
    for (const rowIdx of pageItems) {
      const { item, descLines, extraLine, isGreenRow, rowH } = rowInfos[rowIdx];
      const rowY = curY - rowH;

      const textBaseline = curY - 11;

      // Row number: small badge square (line colour background)
      const badgeX = X_NO + (C_NO - BADGE_SZ) / 2;
      const badgeY = textBaseline - 3;
      page.drawRectangle({ x: badgeX, y: badgeY, width: BADGE_SZ, height: BADGE_SZ, color: accent });
      const noStr = String(item.rowNo);
      const noW   = fontB.widthOfTextAtSize(noStr, 7);
      page.drawText(noStr, {
        x: badgeX + (BADGE_SZ - noW) / 2, y: badgeY + 3,
        size: 7, font: fontB, color: C_WHITE,
      });

      // Code column or code prefix in description (text colour)
      let dy = textBaseline;
      if (showCode) {
        page.drawText(trunc(item.productCode ?? "—", fontB, FS_CODE, C_CODE - TABLE_PAD), {
          x: X_CODE + TABLE_PAD, y: dy, size: FS_CODE, font: fontB, color: accentT,
        });
      } else if (item.productCode) {
        page.drawText(trunc(item.productCode, fontB, FS_CODE - 1, C_DESC - TABLE_PAD * 2), {
          x: X_DESC + TABLE_PAD, y: dy, size: FS_CODE - 1, font: fontB, color: accentT,
        });
        dy -= CODE_LINE_H;
      }

      // Description
      for (const line of descLines) {
        page.drawText(line, { x: X_DESC + TABLE_PAD, y: dy, size: FS_DESC, font: fontR, color: C_DARK });
        dy -= LH;
      }
      // MDA line — muted text colour
      if (extraLine) {
        dy -= MDA_GAP;
        page.drawText(extraLine, {
          x: X_DESC + TABLE_PAD, y: dy, size: FS_DETAIL, font: fontR,
          color: accentMDA,
        });
      }

      // Qty
      const qtyW = fontR.widthOfTextAtSize(String(item.qty ?? 0), FS_DESC);
      page.drawText(String(item.qty ?? 0), {
        x: X_QTY + (C_QTY - qtyW) / 2, y: textBaseline, size: FS_DESC, font: fontR, color: C_DARK,
      });

      // UOM
      const uomStr = item.uom || "—";
      const uomW   = fontR.widthOfTextAtSize(uomStr, FS_CODE);
      page.drawText(uomStr, {
        x: X_UOM + (C_UOM - uomW) / 2, y: textBaseline, size: FS_CODE, font: fontR, color: C_MID,
      });

      // Unit price — thin left border + centred normal-weight text
      page.drawRectangle({ x: X_UP, y: rowY, width: 2, height: rowH, color: rgb(0.88, 0.90, 0.95) });
      const up  = `RM ${Number(item.unitPrice ?? 0).toFixed(2)}`;
      const upW = fontR.widthOfTextAtSize(up, FS_CODE);
      page.drawText(up, {
        x: X_UP + (C_UP - upW) / 2, y: textBaseline, size: FS_CODE, font: fontR, color: C_BODY,
      });

      // Disc%
      if (showDisc) {
        const disc  = Number(item.discountPct ?? 0) > 0 ? `${item.discountPct}%` : "—";
        const discW = fontR.widthOfTextAtSize(disc, FS_CODE);
        page.drawText(disc, {
          x: X_DISC + (C_DISC - discW) / 2, y: textBaseline, size: FS_CODE, font: fontR, color: C_MID,
        });
      }

      // Total — normal-weight, centred, slightly tinted column
      if (showTP) {
        page.drawRectangle({ x: X_TOT, y: rowY, width: C_TOT, height: rowH, color: rgb(0.965, 0.967, 0.975) });
        const tot  = `RM ${Number(item.totalPrice ?? 0).toFixed(2)}`;
        const totW = fontR.widthOfTextAtSize(tot, FS_DESC);
        page.drawText(tot, {
          x: X_TOT + (C_TOT - totW) / 2, y: textBaseline, size: FS_DESC, font: fontR, color: C_DARK,
        });
      }

      // Dashed separator between rows
      dashedLine(page, rowY, ML, W - MR, rgb(0.86, 0.86, 0.86));
      curY = rowY;
    }

    // Rounded outer table border
    if (tableRowStyle === "rounded") {
      const tableH = tableTopY - curY;
      const r = 6;
      page.drawSvgPath(
        `M ${r},0 L ${CW - r},0 Q ${CW},0 ${CW},${r} L ${CW},${tableH - r} Q ${CW},${tableH} ${CW - r},${tableH} L ${r},${tableH} Q 0,${tableH} 0,${tableH - r} L 0,${r} Q 0,0 ${r},0 Z`,
        { x: ML, y: tableTopY, borderColor: accent, borderWidth: 1 },
      );
    }

    // ── Last page: totals + notes ──────────────────────────────────────────
    if (isLast) {
      curY -= 16;
      hLine(page, curY, ML, W - MR, C_LINE, 0.5);
      curY -= 14;

      // Bank info — gray box left
      if (bank) {
        const bBoxH = 58;
        const bBoxW = CW * 0.46;
        drawBox(page, ML, curY, bBoxW, bBoxH, {
          fillColor: C_BG1, borderColor: C_LINE, borderWidth: 0.4,
          rounded: tableRowStyle === "rounded",
        });
        page.drawText("PAYMENT TO", {
          x: ML + 10, y: curY - 13, size: 6.5, font: fontB, color: accentT,
        });
        let by = curY - 28;
        for (const [lbl, val] of [
          ["Bank",         bank.bankName      ?? ""],
          ["Account Name", bank.accountHolder ?? ""],
          ["Account No.",  bank.accountNo     ?? ""],
        ] as [string, string][]) {
          const lw = fontR.widthOfTextAtSize(`${lbl}: `, 8.5);
          page.drawText(`${lbl}: `, { x: ML + 10, y: by, size: 8.5, font: fontR, color: C_MID });
          page.drawText(trunc(String(val), fontB, 9, bBoxW - lw - 24), {
            x: ML + 10 + lw, y: by, size: 9, font: fontB, color: C_DARK,
          });
          by -= 13;
        }
      }

      // Subtotals — right side
      const totColW = 200;
      const totX    = W - MR - totColW;
      let ty        = curY;

      const totItems: [string, string][] = [];
      if (showDisc && itemDiscPerSet > 0) {
        totItems.push([sets > 1 ? "Subtotal before disc (1 set)" : "Subtotal (before disc)", fmtM(rawSubtotalPerSet)]);
        totItems.push([sets > 1 ? "Item Discount (1 set)"        : "Item Discount",          `- ${fmtM(itemDiscPerSet)}`]);
        totItems.push([sets > 1 ? "Subtotal (1 set)"             : "Subtotal",               fmtM(subtotalPerSet)]);
      } else {
        totItems.push([sets > 1 ? "Subtotal (1 set)" : "Subtotal", fmtM(subtotalPerSet)]);
      }
      if (sets > 1) totItems.push([`× ${sets} sets`, fmtM(subtotal)]);
      if (discAmt > 0) {
        totItems.push([`Discount (${q.overallDiscountPct}%)`, `- ${fmtM(discAmt)}`]);
        totItems.push(["After Discount", fmtM(afterDisc)]);
      }
      if (sstAmt > 0) totItems.push([`SST (${q.sstPct}%)`, fmtM(sstAmt)]);

      for (const [lbl, val] of totItems) {
        page.drawText(lbl, { x: totX, y: ty, size: 9.5, font: fontR, color: C_MID });
        const vw = fontR.widthOfTextAtSize(val, 9.5);
        page.drawText(val, { x: W - MR - vw, y: ty, size: 9.5, font: fontR, color: C_BODY });
        ty -= 13;
      }

      // Dashed separator before grand total
      ty -= 8;
      dashedLine(page, ty, totX, W - MR, accent);
      ty -= 14;

      // Grand total — pure typography, oversized text colour
      page.drawText("GRAND TOTAL", {
        x: totX, y: ty, size: 8, font: fontB, color: accentT,
      });
      ty -= 22;
      const gtStr = fmtM(grand);
      const gtW   = fontB.widthOfTextAtSize(gtStr, 18);
      page.drawText(gtStr, {
        x: W - MR - gtW, y: ty, size: 18, font: fontB, color: accentT,
      });

      curY = Math.min(curY - 60, ty - 14);

      // ── Closing message ──────────────────────────────────────────────────
      curY -= 14;
      const closeMsg = "Thank you for the opportunity to present this quotation. We look forward to your valued order. Should you have any enquiries, please do not hesitate to contact us.";
      for (const cl of wrap(closeMsg, fontR, 8, CW - 40)) {
        const clW = fontR.widthOfTextAtSize(cl, 8);
        page.drawText(cl, { x: (W - clW) / 2, y: curY, size: 8, font: fontR, color: C_LITE });
        curY -= 12;
      }

      // Notes
      if (q.notes) {
        curY -= 10;
        const nLines   = wrap(q.notes, fontR, 9.5, CW - 24);
        const noteBoxH = nLines.length * 12 + 26;

        drawBox(page, ML, curY, CW, noteBoxH, {
          fillColor: C_BG1, borderColor: C_LINE, borderWidth: 0.4,
          rounded: tableRowStyle === "rounded",
        });
        page.drawRectangle({ x: ML, y: curY - noteBoxH, width: 3, height: noteBoxH, color: accent });
        page.drawText("NOTES", {
          x: ML + 10, y: curY - 12, size: 7, font: fontB, color: accentT,
        });
        let ny = curY - 26;
        for (const line of nLines) {
          page.drawText(line, { x: ML + 10, y: ny, size: 9.5, font: fontR, color: C_DARK });
          ny -= 12;
        }
      }

      if (q.status === "final") {
        curY -= 10;
        const ACCEPT_BOX_H = 60;
        page.drawRectangle({ x: ML, y: curY - ACCEPT_BOX_H, width: CW, height: ACCEPT_BOX_H, borderColor: C_LINE, borderWidth: 0.5 });
        page.drawRectangle({ x: ML, y: curY - 16, width: CW, height: 16, color: accent });
        page.drawText("ACCEPTANCE", { x: ML + 8, y: curY - 11, size: 7.5, font: fontB, color: C_WHITE });
        const cbY = curY - 30;
        page.drawRectangle({ x: ML + 10, y: cbY, width: 7, height: 7, borderColor: C_LINE, borderWidth: 0.5 });
        page.drawText("I / We confirm acceptance of the above quotation and agree to the stated terms and conditions.", { x: ML + 20, y: cbY + 1, size: 7.5, font: fontR, color: C_DARK });
        const sigY = curY - 50;
        for (const [lx, lw, lbl] of [[ML + 8, 130, "Signature"], [ML + 158, 100, "Date"], [ML + 278, 175, "Name / Designation"]] as [number, number, string][]) {
          page.drawLine({ start: { x: lx, y: sigY }, end: { x: lx + lw, y: sigY }, thickness: 0.4, color: C_LINE });
          page.drawText(lbl, { x: lx, y: sigY - 8, size: 6.5, font: fontR, color: C_LITE });
        }
      }
    }
  }

  // ── Catalogue pages ────────────────────────────────────────────────────────
  if (Number(q.includeCatalogue)) {
    const r2ImgBase = process.env.NEXT_PUBLIC_R2_PRODUCT_IMAGES_URL ?? "";

    const seenCodes = new Set<string>();
    const catItems  = items.filter(it => {
      if (!it.productCode || seenCodes.has(it.productCode)) return false;
      seenCodes.add(it.productCode);
      return true;
    });

    if (catItems.length > 0) {
      // Pre-fetch images
      const imageCache = new Map<string, PDFImage>();
      for (const item of catItems) {
        if (!item.productCode) continue;
        for (const ext of ["jpg", "jpeg", "png", "webp"]) {
          try {
            const url = `${r2ImgBase}/${encodeURIComponent(item.productCode)}.${ext}`;
            const res = await fetch(url);
            if (!res.ok) continue;
            const buf = await res.arrayBuffer();
            let img: PDFImage;
            try { img = await pdfDoc.embedJpg(buf); } catch { img = await pdfDoc.embedPng(buf); }
            imageCache.set(item.productCode, img);
            break;
          } catch { /* next ext */ }
        }
      }

      const CAT_HDR_H    = 64;
      const CAT_COLHDR_H = 22;
      const CAT_FOOT_H   = 34;
      const CAT_COL_NO   = 26;
      const ROWS_PER_PG  = 5;
      const rowsAvail    = H - CAT_HDR_H - CAT_COLHDR_H - MB - CAT_FOOT_H;
      const CAT_ROW_H    = Math.floor(rowsAvail / ROWS_PER_PG);
      const CAT_IMG_SZ   = CAT_ROW_H - 12;
      const CAT_COL_IMG  = CAT_IMG_SZ + 22;
      const CAT_COL_DET  = CW - CAT_COL_NO - CAT_COL_IMG;
      const totalCatPgs  = Math.ceil(catItems.length / ROWS_PER_PG);

      for (let pi = 0; pi < totalCatPgs; pi++) {
        const catPage  = pdfDoc.addPage([W, H]);
        const pageRows = catItems.slice(pi * ROWS_PER_PG, (pi + 1) * ROWS_PER_PG);

        // ── Slate catalogue header ─────────────────────────────────────
        // Top accent bar
        catPage.drawRectangle({ x: 0, y: H - ACCENT_BAR_H, width: W, height: ACCENT_BAR_H, color: accent });
        // Light gray header body
        catPage.drawRectangle({ x: 0, y: H - CAT_HDR_H, width: W, height: CAT_HDR_H - ACCENT_BAR_H, color: C_BG1 });

        catPage.drawText("PRODUCT CATALOGUE", {
          x: ML, y: H - 22, size: 14, font: fontB, color: accentT,
        });
        if (q.title) {
          catPage.drawText(trunc(q.title, fontR, 9, CW / 2), {
            x: ML, y: H - 36, size: 9, font: fontR, color: C_BODY,
          });
          catPage.drawText(`${q.quotationNo}  ·  ${fmtD(q.createdAt)}`, {
            x: ML, y: H - 48, size: 7.5, font: fontR, color: C_MID,
          });
        } else {
          catPage.drawText(`${q.quotationNo}  ·  ${fmtD(q.createdAt)}`, {
            x: ML, y: H - 36, size: 8.5, font: fontR, color: C_BODY,
          });
        }
        const pgLabel = `${pi + 1} / ${totalCatPgs}`;
        catPage.drawText(pgLabel, {
          x: W - MR - fontB.widthOfTextAtSize(pgLabel, 10),
          y: H - 30, size: 10, font: fontB, color: accentT,
        });
        // Bottom accent rule under header
        catPage.drawRectangle({ x: 0, y: H - CAT_HDR_H, width: W, height: 1, color: accent });

        // ── Column headers row ────────────────────────────────────────
        const colHdrY = H - CAT_HDR_H - CAT_COLHDR_H;
        const colDefs = [
          { label: "#",               x: ML,                            w: CAT_COL_NO  },
          { label: "Image",           x: ML + CAT_COL_NO,               w: CAT_COL_IMG },
          { label: "Product Details", x: ML + CAT_COL_NO + CAT_COL_IMG, w: CAT_COL_DET },
        ];
        for (const col of colDefs) {
          const tw = fontB.widthOfTextAtSize(col.label, 7.5);
          catPage.drawText(col.label, {
            x: col.x + (col.w - tw) / 2, y: colHdrY + 8,
            size: 7.5, font: fontB, color: accentT,
          });
        }
        // Underline for column headers (line colour)
        catPage.drawRectangle({ x: ML, y: colHdrY, width: CW, height: 1.5, color: accent });

        // Vertical separators
        const tableTopY    = colHdrY;
        const tableBottomY = tableTopY - pageRows.length * CAT_ROW_H;
        for (const col of colDefs.slice(1)) {
          catPage.drawLine({
            start: { x: col.x, y: tableBottomY }, end: { x: col.x, y: tableTopY },
            thickness: 0.4, color: C_LINE,
          });
        }

        // ── Product rows ──────────────────────────────────────────────
        let rowTopY = colHdrY;
        for (let ri = 0; ri < pageRows.length; ri++) {
          const item    = pageRows[ri];
          const rowY    = rowTopY - CAT_ROW_H;
          const globalN = pi * ROWS_PER_PG + ri + 1;

          dashedLine(catPage, rowY, ML, ML + CW, rgb(0.86, 0.86, 0.86));

          // No — line-colour badge
          const bx = ML + (CAT_COL_NO - BADGE_SZ) / 2;
          const by = rowY + CAT_ROW_H / 2 - BADGE_SZ / 2;
          catPage.drawRectangle({ x: bx, y: by, width: BADGE_SZ, height: BADGE_SZ, color: accent });
          const noStr = String(globalN);
          const noW   = fontB.widthOfTextAtSize(noStr, 7);
          catPage.drawText(noStr, {
            x: bx + (BADGE_SZ - noW) / 2, y: by + 3,
            size: 7, font: fontB, color: C_WHITE,
          });

          // Image
          const imgColX = ML + CAT_COL_NO;
          const img     = item.productCode ? imageCache.get(item.productCode) : undefined;
          if (img) {
            const scale = Math.min(CAT_IMG_SZ / img.height, CAT_IMG_SZ / img.width, 1);
            const iw    = img.width  * scale;
            const ih    = img.height * scale;
            catPage.drawImage(img, {
              x: imgColX + (CAT_COL_IMG - iw) / 2,
              y: rowY    + (CAT_ROW_H  - ih) / 2,
              width: iw, height: ih,
            });
          } else {
            catPage.drawRectangle({
              x: imgColX + (CAT_COL_IMG - CAT_IMG_SZ) / 2,
              y: rowY    + (CAT_ROW_H   - CAT_IMG_SZ) / 2,
              width: CAT_IMG_SZ, height: CAT_IMG_SZ,
              color: C_BG1, borderColor: C_LINE, borderWidth: 0.4,
            });
            const ni  = "No image";
            const niW = fontR.widthOfTextAtSize(ni, 7);
            catPage.drawText(ni, {
              x: imgColX + (CAT_COL_IMG - niW) / 2,
              y: rowY + CAT_ROW_H / 2 - 3,
              size: 7, font: fontR, color: C_LITE,
            });
          }

          // Product details
          const detX    = ML + CAT_COL_NO + CAT_COL_IMG + 8;
          const detMaxW = CAT_COL_DET - 16;
          let   detY    = rowY + CAT_ROW_H - 16;

          if (item.productCode) {
            catPage.drawText(trunc(item.productCode, fontB, 8, detMaxW), {
              x: detX, y: detY, size: 8, font: fontB, color: accentT,
            });
            detY -= 11;
          }
          if (item.description) {
            for (const line of wrap(String(item.description), fontR, 8, detMaxW).slice(0, 4)) {
              catPage.drawText(line, { x: detX, y: detY, size: 8, font: fontR, color: C_DARK });
              detY -= 10;
            }
          }
          if (item.uom) {
            catPage.drawText(item.uom, { x: detX, y: detY, size: 8, font: fontR, color: C_MID });
            detY -= 11;
          }
          if (item.hasCert) {
            detY -= 5;
            if (item.mdaRegNo) {
              catPage.drawText(`MDA Reg No: ${item.mdaRegNo}`, {
                x: detX, y: detY, size: 7.5, font: fontR, color: C_BODY,
              });
              detY -= 10;
            }
            if (item.mdaValidity) {
              catPage.drawText(`MDA Validity: ${fmtD(item.mdaValidity)}`, {
                x: detX, y: detY, size: 7.5, font: fontR, color: C_BODY,
              });
            }
          }
          rowTopY = rowY;
        }

        // Table outer border
        catPage.drawRectangle({
          x: ML, y: tableBottomY, width: CW, height: tableTopY - tableBottomY,
          borderColor: C_LINE, borderWidth: 0.4,
        });

        // Catalogue footer
        catPage.drawRectangle({ x: 0, y: MB + 14, width: W, height: 2, color: accent });
        catPage.drawText("Product Catalogue  ·  Computer generated document.", {
          x: ML, y: MB + 4, size: 7, font: fontR, color: C_LITE,
        });
        catPage.drawText(q.quotationNo, {
          x: W - MR - fontR.widthOfTextAtSize(q.quotationNo, 7),
          y: MB + 4, size: 7, font: fontR, color: C_LITE,
        });
      }
    }
  }

  // ── Append company documents ───────────────────────────────────────────────
  const docAppends: { incl: number | null; url: string | null }[] = [
    { incl: q.inclMof,              url: orgMofCertUrl       ?? null },
    { incl: q.inclSsm,              url: orgSsmCertUrl       ?? null },
    { incl: q.inclTcc,              url: orgTccCertUrl       ?? null },
    { incl: q.inclBankStatement,    url: orgBankStatementUrl ?? null },
    { incl: q.inclMdaEstablishment, url: orgMdaCertUrl       ?? null },
    { incl: q.inclLampiran12,       url: orgLampiran12Url    ?? null },
    { incl: q.inclLampiran13,       url: orgLampiran13Url    ?? null },
  ];
  for (const doc of docAppends) {
    if (!Number(doc.incl) || !doc.url) continue;
    try {
      const res    = await fetch(doc.url);
      if (!res.ok) continue;
      const buf    = await res.arrayBuffer();
      const srcPdf = await PDFDocument.load(buf);
      const pages  = await pdfDoc.copyPages(srcPdf, srcPdf.getPageIndices());
      pages.forEach(p => pdfDoc.addPage(p));
    } catch { /* skip */ }
  }

  return pdfDoc.save();
}
