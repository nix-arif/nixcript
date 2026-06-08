import { getQuotationDetail } from "@/server/quotation";
import { PDFDocument, PDFFont, PDFPage, PDFImage, rgb, StandardFonts } from "pdf-lib";
import {
  drawCompanyHeader, drawInfoSection, estimateHeaderH, estimateInfoH,
} from "./_pdf-header";

type Data = NonNullable<Awaited<ReturnType<typeof getQuotationDetail>>>;

// ── A4 dimensions & margins ────────────────────────────────────────────────
const W  = 595.28;
const H  = 841.89;
const ML = 32;
const MR = 32;
const MT = 30;
const MB = 30;
const CW = W - ML - MR; // 531.28

// ── Palette ────────────────────────────────────────────────────────────────
const C_NAVY   = rgb(0.08, 0.18, 0.36);
const C_DARK   = rgb(0.10, 0.10, 0.10);
const C_MID    = rgb(0.40, 0.40, 0.40);
const C_LITE   = rgb(0.62, 0.62, 0.62);
const C_LINE   = rgb(0.88, 0.88, 0.88);
const C_ALT    = rgb(0.975, 0.980, 0.988);
const C_BOX    = rgb(0.970, 0.974, 0.984);
const C_WHITE  = rgb(1, 1, 1);
const C_GREEN  = rgb(0.09, 0.40, 0.20);
const C_AMBER  = rgb(0.57, 0.25, 0.05);

// ── Layout constants ───────────────────────────────────────────────────────
const LOGO_H_MAX = 44;
const LOGO_W_MAX = 110;
const TABLE_PAD  = 6;

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
  return String(t)
    .replace(/[\x00-\x1F\x7F]/g, " ")
    .replace(/[^\x00-\xFFŒœŠšŸŽžƒˆ˜–—‘’‚“”„†‡•…‰‹›€™]/g, " ");
}

function wrap(text: string, font: PDFFont, size: number, maxW: number): string[] {
  if (!text) return [""];
  const paragraphs = String(text).split(/\r?\n/);
  const allLines: string[] = [];
  for (const para of paragraphs) {
    const words = sanitizeText(para).split(" ").filter(Boolean);
    if (!words.length) continue;
    let cur = "";
    for (const word of words) {
      const test = cur ? `${cur} ${word}` : word;
      if (font.widthOfTextAtSize(test, size) <= maxW) {
        cur = test;
      } else {
        if (cur) allLines.push(cur);
        let remaining = word;
        while (font.widthOfTextAtSize(remaining, size) > maxW && remaining.length > 1) {
          let cut = remaining.length - 1;
          while (cut > 0 && font.widthOfTextAtSize(remaining.slice(0, cut) + "-", size) > maxW) cut--;
          if (cut === 0) break;
          allLines.push(remaining.slice(0, cut) + "-");
          remaining = remaining.slice(cut);
        }
        cur = remaining;
      }
    }
    if (cur) allLines.push(cur);
  }
  return allLines.length ? allLines : [""];
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

function hLine(
  page: PDFPage,
  y: number,
  x1 = ML,
  x2 = W - MR,
  color = C_LINE,
  thick = 0.4,
) {
  page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness: thick, color });
}

// ── Main export ────────────────────────────────────────────────────────────
export async function generateQuotationAffirma(data: Data): Promise<Uint8Array> {
  const {
    quotation: q, items,
    orgName, orgLogoUrl, orgBrandColor,
    orgCompanyName, orgCompanyAddress, orgTaxNo, orgPhone,
    orgEmail, orgWebsite, orgOldSsmNo, orgNewSsmNo, orgMdaEstablishmentNo,
    orgBankingInfo,
    orgMofCertUrl, orgSsmCertUrl, orgMdaCertUrl, orgTccCertUrl,
    orgBankStatementUrl, orgLampiran12Url, orgLampiran13Url,
  } = data;

  const accentColor = orgBrandColor
    ? (() => {
        const hex = orgBrandColor.replace("#", "");
        const r = parseInt(hex.slice(0, 2), 16) / 255;
        const g = parseInt(hex.slice(2, 4), 16) / 255;
        const b = parseInt(hex.slice(4, 6), 16) / 255;
        return rgb(r, g, b);
      })()
    : C_NAVY;

  const cust     = q.customerSnapshot as any;
  const bankList = (orgBankingInfo ?? []) as any[];
  const bank     = bankList.find(b => b.isPrimary) ?? bankList[0] ?? null;
  const showDisc = !!Number(q.showItemizeDiscount);
  const showTP   = !!Number(q.showTotalPrice);
  const coName   = orgCompanyName ?? orgName;

  const sets           = Number(q.sets ?? 1);
  const subtotal       = Number(q.subtotal  ?? 0);
  const discAmt        = Number(q.overallDiscountAmt ?? 0);
  const sstAmt         = Number(q.sst       ?? 0);
  const grand          = Number(q.grandTotal ?? 0);
  const subtotalPerSet = subtotal / sets;
  const itemDiscPerSet = items.reduce((s, i) => s + Number(i.discountAmt ?? 0), 0);
  const itemDiscTotal  = itemDiscPerSet * sets;
  const rawSubtotalPerSet = subtotalPerSet + itemDiscPerSet;
  const afterDisc      = subtotal - discAmt;

  const pdfDoc = await PDFDocument.create();
  const fontR  = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontB  = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

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
    } catch { /* PDF generates without logo */ }
  }

  // ── Table style ──────────────────────────────────────────────────────────
  const tableRowStyle = data.orgTableRowStyle ?? "default";
  const showCode      = !!Number(q.showProductCode ?? 1);
  const showMdaCerts = !!Number(q.includeMdaCerts ?? 1);

  // ── Column widths ─────────────────────────────────────────────────────────
  const C_NO   = 22;
  const C_CODE = showCode ? 65 : 0;
  const C_QTY  = 28;
  const C_UOM  = 34;
  const C_UP   = 64;
  const C_DISC = showDisc ? 34 : 0;
  const C_TOT  = showTP ? 68 : 0;
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
  const RH_MIN    = tfs === "small" ? 15   : tfs === "large" ? 21   : 17;
  const MDA_GAP   = 3;

  const hasBanner = (data.orgTitlePosition ?? "stamp") === "table-banner";
  const BANNER_H  = 20;

  // ── Pre-compute row heights ───────────────────────────────────────────────
  type RowInfo = {
    item:       typeof items[number];
    descLines:  string[];
    extraLine:  string | null;
    isGreenRow: boolean;
    rowH:       number;
  };

  const CODE_LINE_H = LH - 2;
  const rowInfos: RowInfo[] = items.map(item => {
    const descLines  = wrap(item.description ?? "—", fontR, FS_DESC, C_DESC - TABLE_PAD * 2);
    const extraLine  = showMdaCerts && item.hasCert && item.mdaRegNo
      ? `MDA: ${item.mdaRegNo}${item.mdaValidity ? ` · Exp: ${fmtD(item.mdaValidity)}` : ""}`
      : (showMdaCerts && !item.hasCert ? "No MDA certificate" : null);
    const isGreenRow = !!(item.hasCert && item.mdaRegNo);
    const codeLineH  = 0;
    const rowH = Math.max(
      RH_MIN,
      codeLineH + descLines.length * LH + (extraLine ? RH_MIN + MDA_GAP + 2 : 6),
    );
    return { item, descLines, extraLine, isGreenRow, rowH };
  });

  // ── Style from profile ────────────────────────────────────────────────────
  const nameSize   = ({ small: 10, medium: 13, large: 16, xlarge: 20 } as Record<string,number>)[data.orgNameSize ?? "medium"] ?? 13;
  const hLayout    = data.orgHeaderLayout ?? "standard";
  const QL_SIZE    = ({ small: 5.5, normal: 7, large: 10 } as Record<string,number>)[data.orgQuotationLabelSize ?? "normal"] ?? 7;
  const QL_TEXT    = !!(data.orgQuotationLabelUppercase ?? 1) ? "QUOTATION" : "Quotation";
  const attnNameSz = ({ small: 10, medium: 13, large: 16, xlarge: 20 } as Record<string,number>)[data.orgAttentionNameSize ?? "medium"] ?? 13;
  const detailFSz  = ({ small: 8, normal: 9, large: 10.5 } as Record<string,number>)[data.orgDetailFontSize ?? "normal"] ?? 9;

  // ── Height estimates ──────────────────────────────────────────────────────
  const HEADER_BLOCK = estimateHeaderH({
    companyAddress: orgCompanyAddress, phone: orgPhone, email: orgEmail,
    website: orgWebsite, oldSsmNo: orgOldSsmNo, newSsmNo: orgNewSsmNo,
    mdaEstablishmentNo: orgMdaEstablishmentNo, taxNo: orgTaxNo,
    nameSize, logoHMax: LOGO_H_MAX, logoWMax: LOGO_W_MAX, headerLayout: hLayout,
    logoImg, fontR,
  }) + 6;
  const DIVIDER_GAP   = 10;
  const TABLE_HDR_H   = 20;
  const INFO_BLOCK = estimateInfoH({
    cust, attentionNameSize: attnNameSz,
    salesPersonName: q.salesPersonName ?? null,
    preparedByName: q.preparedByName ?? null,
    title: q.title ?? null,
    detailFontSize: detailFSz, fontR,
  }) + 10;

  // Totals + notes + footer
  const totRowCount  = 1 + (showDisc && itemDiscPerSet > 0 ? 2 : 0) + (sets > 1 ? 1 : 0) + (discAmt > 0 ? 3 : 0) + (sstAmt > 0 ? 1 : 0);
  const noteLines    = q.notes ? wrap(q.notes, fontR, 9.5, CW - 20) : [];
  const TOTALS_H     = 16 + totRowCount * 13 + 6 + 1.5 + 10 + 18 + 8;
  const NOTES_H      = q.notes ? noteLines.length * 12 + 30 : 0;
  const FOOTER_BLOCK = 30;
  const CLOSING_H    = 38;
  const ACCEPT_H     = 0;
  const BOTTOM_RESERVE = TOTALS_H + NOTES_H + FOOTER_BLOCK + 16 + CLOSING_H + ACCEPT_H;

  const P1_ROW_AVAIL = H - MT - HEADER_BLOCK - DIVIDER_GAP - INFO_BLOCK - DIVIDER_GAP - TABLE_HDR_H - (hasBanner ? BANNER_H : 0) - MB - 20;
  const PN_ROW_AVAIL = H - MT - 28 - TABLE_HDR_H - MB - 20;

  // ── Paginate rows ─────────────────────────────────────────────────────────
  const pageGroups: number[][] = [];
  let curGroup: number[] = [];
  let used = 0;
  let firstPage = true;

  for (let i = 0; i < rowInfos.length; i++) {
    const rh = rowInfos[i].rowH;
    const avail = firstPage ? Math.max(P1_ROW_AVAIL, RH_MIN * 3) : Math.max(PN_ROW_AVAIL, RH_MIN * 3);
    if (used + rh > avail && curGroup.length > 0) {
      pageGroups.push(curGroup);
      curGroup = [i];
      used = rh;
      firstPage = false;
    } else {
      curGroup.push(i);
      used += rh;
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

    // ── Footer ──────────────────────────────────────────────────────────────
    hLine(page, MB + 22);
    page.drawText("Computer generated document. No signature required.", {
      x: ML, y: MB + 10, size: 7.5, font: fontR, color: C_LITE,
    });
    const pgText = `${q.quotationNo}  ·  Page ${pi + 1} of ${totalPages}`;
    const pgW    = fontR.widthOfTextAtSize(pgText, 7.5);
    page.drawText(pgText, { x: W - MR - pgW, y: MB + 10, size: 7.5, font: fontR, color: C_LITE });

    let curY = H - MT;

    // ── Page 1: header + info ────────────────────────────────────────────────
    if (isFirst) {
      drawCompanyHeader({
        page, startY: curY, accent: accentColor, fontR, fontB, logoImg,
        companyName: coName, companyAddress: orgCompanyAddress,
        phone: orgPhone, email: orgEmail, website: orgWebsite,
        oldSsmNo: orgOldSsmNo, newSsmNo: orgNewSsmNo,
        mdaEstablishmentNo: orgMdaEstablishmentNo, taxNo: orgTaxNo,
        nameSize, nameBold: !!(data.orgNameBold ?? 1),
        nameUppercase: !!(data.orgNameUppercase ?? 0),
        headerLayout: hLayout, docLabel: QL_TEXT,
        docLabelSize: QL_SIZE, docLabelBold: !!(data.orgQuotationLabelBold ?? 1), docLabelAlign: (data.orgQuotationLabelAlign ?? "right") as "left" | "center" | "right",
        logoHMax: LOGO_H_MAX, logoWMax: LOGO_W_MAX,
      });
      curY -= HEADER_BLOCK;
      hLine(page, curY, ML, W - MR, accentColor, 1.2);
      curY -= DIVIDER_GAP;

      drawInfoSection({
        page, startY: curY, accent: accentColor, fontR, fontB, cust,
        attentionNameSize: attnNameSz, attentionNameBold: !!(data.orgAttentionNameBold ?? 1),
        detailFontSize: detailFSz, detailFontBold: !!(data.orgDetailFontBold ?? 0),
        detailAlignment: (data.orgDetailAlignment ?? "right") as "left" | "right",
        quotationNo: q.quotationNo, createdAt: q.createdAt,
        validUntil: q.validUntil, salesPersonName: q.salesPersonName ?? null,
        preparedByName: q.preparedByName ?? null, title: q.title ?? null,
      });
      curY -= INFO_BLOCK + DIVIDER_GAP;
      hLine(page, curY);
      curY -= 4;

    } else {
      // ── Continuation header ──────────────────────────────────────────────
      page.drawText(`${q.quotationNo} (continued)`, {
        x: ML, y: curY - 12, size: 9, font: fontR, color: C_LITE,
      });
      hLine(page, curY - 20);
      curY -= 28;
    }

    // ── Title banner (optional merged row above column headers) ───────────────
    const tableTopY = curY;
    if (hasBanner && isFirst) {
      page.drawRectangle({ x: ML, y: curY - BANNER_H, width: CW, height: BANNER_H, color: C_BOX });
      page.drawText(q.title ?? "Loose Items", {
        x: ML + TABLE_PAD, y: curY - BANNER_H + 6,
        size: 9, font: fontB, color: accentColor,
      });
      curY -= BANNER_H;
    }

    // ── Table header ────────────────────────────────────────────────────────
    const thdrs: { label: string; x: number; w: number; align: "l"|"c"|"r" }[] = [
      { label: "No",          x: X_NO,   w: C_NO,   align: "c" },
      ...(showCode ? [{ label: "Code", x: X_CODE, w: C_CODE, align: "l" as const }] : []),
      { label: "Description", x: X_DESC, w: C_DESC, align: "l" },
      { label: "Qty",         x: X_QTY,  w: C_QTY,  align: "c" },
      { label: "UOM",         x: X_UOM,  w: C_UOM,  align: "c" },
      { label: "Unit Price", x: X_UP,   w: C_UP,   align: "r" as const },
      ...(showDisc ? [{ label: "Disc%", x: X_DISC, w: C_DISC, align: "c" as const }] : []),
      ...(showTP ? [{ label: "Total",      x: X_TOT,  w: C_TOT,  align: "r" as const }] : []),
    ];

    const tHdrY = curY - TABLE_HDR_H;
    for (const col of thdrs) {
      const tw = fontB.widthOfTextAtSize(col.label, 7.5);
      const tx = col.x + (col.w - tw) / 2;
      page.drawText(col.label.toUpperCase(), {
        x: tx, y: tHdrY + 5, size: 7.5, font: fontB, color: accentColor,
      });
    }
    hLine(page, tHdrY - 1, ML, W - MR, accentColor, 1.5);
    curY = tHdrY - 2;

    // ── Item rows ────────────────────────────────────────────────────────────
    for (const rowIdx of pageItems) {
      const { item, descLines, extraLine, isGreenRow, rowH } = rowInfos[rowIdx];
      const rowY = curY - rowH;

      if (rowIdx % 2 === 1 && tableRowStyle === "default") {
        page.drawRectangle({ x: ML, y: rowY, width: CW, height: rowH, color: C_ALT });
      }

      const textBaseline = curY - 11;

      // No
      const noW = fontR.widthOfTextAtSize(String(item.rowNo), FS_NUM);
      page.drawText(String(item.rowNo), {
        x: X_NO + (C_NO - noW) / 2, y: textBaseline,
        size: FS_NUM, font: fontR, color: C_DARK,
      });

      // Code column (separate) or code prefix inside description
      let dy = textBaseline;
      if (showCode) {
        page.drawText(trunc(item.productCode ?? "—", fontR, FS_CODE, C_CODE - TABLE_PAD * 2), {
          x: X_CODE + TABLE_PAD, y: dy, size: FS_CODE, font: fontR, color: C_MID,
        });
      }

      // Description + cert line
      for (const line of descLines) {
        page.drawText(line, { x: X_DESC + TABLE_PAD, y: dy, size: FS_DESC, font: fontR, color: C_DARK });
        dy -= LH;
      }
      if (extraLine) {
        dy -= MDA_GAP;
        page.drawText(extraLine, {
          x: X_DESC + TABLE_PAD, y: dy,
          size: FS_DETAIL, font: fontR, color: isGreenRow ? C_GREEN : C_AMBER,
        });
      }

      // Qty
      const qtyW = fontR.widthOfTextAtSize(String(item.qty ?? 0), FS_DESC);
      page.drawText(String(item.qty ?? 0), {
        x: X_QTY + (C_QTY - qtyW) / 2, y: textBaseline, size: FS_DESC, font: fontR, color: C_DARK,
      });

      // UOM
      const uom  = sanitizeText(item.uom || "—");
      const uomW = fontR.widthOfTextAtSize(uom, FS_CODE);
      page.drawText(uom, {
        x: X_UOM + (C_UOM - uomW) / 2, y: textBaseline, size: FS_CODE, font: fontR, color: C_DARK,
      });

      // Unit Price (always shown)
      const up  = `RM ${Number(item.unitPrice ?? 0).toFixed(2)}`;
      const upW = fontR.widthOfTextAtSize(up, FS_CODE);
      page.drawText(up, {
        x: X_UP + (C_UP - upW) / 2, y: textBaseline, size: FS_CODE, font: fontR, color: C_DARK,
      });

      // Disc%
      if (showDisc) {
        const disc  = Number(item.discountPct ?? 0) > 0 ? `${item.discountPct}%` : "—";
        const discW = fontR.widthOfTextAtSize(disc, FS_CODE);
        page.drawText(disc, {
          x: X_DISC + (C_DISC - discW) / 2, y: textBaseline, size: FS_CODE, font: fontR, color: C_LITE,
        });
      }

      // Total
      if (showTP) {
        const tot  = `RM ${Number(item.totalPrice ?? 0).toFixed(2)}`;
        const totW = fontR.widthOfTextAtSize(tot, FS_DESC);
        page.drawText(tot, {
          x: X_TOT + (C_TOT - totW) / 2, y: textBaseline, size: FS_DESC, font: fontR, color: C_DARK,
        });
      }

      hLine(page, rowY, ML, W - MR, rgb(0.93, 0.93, 0.93), 0.3);
      curY = rowY;
    }

    // Rounded outer table border
    if (tableRowStyle === "rounded") {
      const tableH = tableTopY - curY;
      const r = 6;
      page.drawSvgPath(
        `M ${r},0 L ${CW - r},0 Q ${CW},0 ${CW},${r} L ${CW},${tableH - r} Q ${CW},${tableH} ${CW - r},${tableH} L ${r},${tableH} Q 0,${tableH} 0,${tableH - r} L 0,${r} Q 0,0 ${r},0 Z`,
        { x: ML, y: tableTopY, borderColor: accentColor, borderWidth: 1 },
      );
    }

    // ── Last page: totals + notes ──────────────────────────────────────────
    if (isLast) {
      curY -= 10;
      hLine(page, curY, ML, W - MR, C_LINE, 0.6);
      curY -= 16;

      // Bank info (left)
      if (bank) {
        let by = curY;
        page.drawText("PAYMENT TO", { x: ML, y: by, size: 7.5, font: fontB, color: accentColor });
        by -= 13;
        for (const [lbl, val] of [
          ["Bank", bank.bankName ?? ""],
          ["Account Name", bank.accountHolder ?? ""],
          ["Account No.", bank.accountNo ?? ""],
        ] as [string,string][]) {
          page.drawText(`${lbl}:`, { x: ML, y: by, size: 9, font: fontR, color: C_LITE });
          page.drawText(trunc(String(val), fontB, 9.5, 170), {
            x: ML + 76, y: by, size: 9.5, font: fontB, color: C_DARK,
          });
          by -= 13;
        }
      }

      // Totals (right-aligned block)
      const totW  = 220;
      const totX  = W - MR - totW;
      let ty      = curY;
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
        page.drawText(val, { x: W - MR - vw, y: ty, size: 9.5, font: fontR, color: C_DARK });
        ty -= 13;
      }

      ty -= 4;
      hLine(page, ty, totX, W - MR, accentColor, 1.5);
      ty -= 12;

      page.drawText("Grand Total", { x: totX, y: ty, size: 12, font: fontB, color: accentColor });
      const gtw = fontB.widthOfTextAtSize(fmtM(grand), 14);
      page.drawText(fmtM(grand), {
        x: W - MR - gtw, y: ty - 1, size: 14, font: fontB, color: accentColor,
      });
      curY = ty - 20;

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
        curY -= 6;
        const noteLines = wrap(q.notes, fontR, 9.5, CW - 20);
        const noteBoxH  = noteLines.length * 12 + 24;

        page.drawRectangle({
          x: ML, y: curY - noteBoxH, width: CW, height: noteBoxH,
          color: C_BOX, borderColor: rgb(0.88, 0.90, 0.94), borderWidth: 0.4,
        });
        page.drawRectangle({
          x: ML, y: curY - noteBoxH, width: 3, height: noteBoxH, color: accentColor,
        });
        page.drawText("NOTES", {
          x: ML + 10, y: curY - 12, size: 7.5, font: fontB, color: accentColor,
        });
        let ny = curY - 24;
        for (const line of noteLines) {
          page.drawText(line, { x: ML + 10, y: ny, size: 9.5, font: fontR, color: C_DARK });
          ny -= 12;
        }
      }

    }
  }

  // ── Catalogue pages ──────────────────────────────────────────────────────
  if (Number(q.includeCatalogue)) {
    const r2ImgBase = process.env.NEXT_PUBLIC_R2_PRODUCT_IMAGES_URL ?? "";

    // Deduplicate by productCode, preserving order
    const seenCodes = new Set<string>();
    const catItems = items.filter(it => {
      if (!it.productCode || seenCodes.has(it.productCode)) return false;
      seenCodes.add(it.productCode);
      return true;
    });

    if (catItems.length === 0) {
      // nothing to catalogue
    } else {
      // Pre-fetch all images before drawing
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
            try { img = await pdfDoc.embedJpg(buf); }
            catch { img = await pdfDoc.embedPng(buf); }
            imageCache.set(item.productCode, img);
            break;
          } catch { /* try next ext */ }
        }
      }

      // ── Table layout constants ─────────────────────────────────────────
      const CAT_HDR_H    = 64;   // section title strip
      const CAT_COLHDR_H = 20;   // column labels row
      const CAT_FOOT_H   = 32;   // footer zone
      const CAT_COL_NO   = 26;   // "#" column
      const ROWS_PER_PG  = 5;
      const rowsAvail    = H - MT - CAT_HDR_H - CAT_COLHDR_H - MB - CAT_FOOT_H;
      const CAT_ROW_H    = Math.floor(rowsAvail / ROWS_PER_PG);
      const CAT_IMG_SZ   = CAT_ROW_H - 12;  // image fills most of the row
      const CAT_COL_IMG  = CAT_IMG_SZ + 22; // image column = image + horizontal padding
      const CAT_COL_DET  = CW - CAT_COL_NO - CAT_COL_IMG;
      const totalCatPgs  = Math.ceil(catItems.length / ROWS_PER_PG);

      for (let pi = 0; pi < totalCatPgs; pi++) {
        const catPage  = pdfDoc.addPage([W, H]);
        const pageRows = catItems.slice(pi * ROWS_PER_PG, (pi + 1) * ROWS_PER_PG);

        // ── Section header strip ─────────────────────────────────────────
        catPage.drawRectangle({
          x: 0, y: H - CAT_HDR_H, width: W, height: CAT_HDR_H, color: C_BOX,
        });
        catPage.drawRectangle({
          x: 0, y: H - CAT_HDR_H, width: 4, height: CAT_HDR_H, color: accentColor,
        });
        catPage.drawText("PRODUCT CATALOGUE", {
          x: ML, y: H - 22, size: 13, font: fontB, color: accentColor,
        });
        if (q.title) {
          catPage.drawText(trunc(q.title, fontB, 8.5, CW / 2), {
            x: ML, y: H - 36, size: 8.5, font: fontB, color: C_DARK,
          });
          catPage.drawText(`${q.quotationNo}  ·  ${fmtD(q.createdAt)}`, {
            x: ML, y: H - 46, size: 7, font: fontR, color: C_LITE,
          });
        } else {
          catPage.drawText(`${q.quotationNo}  ·  ${fmtD(q.createdAt)}`, {
            x: ML, y: H - 37, size: 8, font: fontR, color: C_LITE,
          });
        }
        const pgLabel = `Page ${pi + 1} / ${totalCatPgs}`;
        catPage.drawText(pgLabel, {
          x: W - MR - fontR.widthOfTextAtSize(pgLabel, 8),
          y: H - 28, size: 8, font: fontR, color: C_MID,
        });

        // ── Column header row ────────────────────────────────────────────
        const colHdrY = H - CAT_HDR_H - CAT_COLHDR_H;
        catPage.drawRectangle({
          x: ML, y: colHdrY, width: CW, height: CAT_COLHDR_H, color: accentColor,
        });
        const colDefs: { label: string; x: number; w: number }[] = [
          { label: "#",               x: ML,                                     w: CAT_COL_NO  },
          { label: "Image",           x: ML + CAT_COL_NO,                        w: CAT_COL_IMG },
          { label: "Product Details", x: ML + CAT_COL_NO + CAT_COL_IMG,          w: CAT_COL_DET },
        ];
        for (const col of colDefs) {
          const tw = fontB.widthOfTextAtSize(col.label, 7);
          catPage.drawText(col.label, {
            x: col.x + (col.w - tw) / 2,
            y: colHdrY + 6, size: 7, font: fontB, color: C_WHITE,
          });
        }

        // ── Vertical column separators ───────────────────────────────────
        const tableTopY    = colHdrY;
        const tableBottomY = tableTopY - pageRows.length * CAT_ROW_H;
        for (const col of colDefs.slice(1)) {
          catPage.drawLine({
            start: { x: col.x, y: tableBottomY },
            end:   { x: col.x, y: tableTopY },
            thickness: 0.3, color: C_LINE,
          });
        }

        // ── Product rows ─────────────────────────────────────────────────
        let rowTopY = colHdrY;
        for (let ri = 0; ri < pageRows.length; ri++) {
          const item    = pageRows[ri];
          const rowY    = rowTopY - CAT_ROW_H;
          // Alternating background
          if (ri % 2 === 1) {
            catPage.drawRectangle({
              x: ML, y: rowY, width: CW, height: CAT_ROW_H, color: C_ALT,
            });
          }
          hLine(catPage, rowY, ML, ML + CW, C_LINE, 0.3);

          // — No column —
          const noStr = sanitizeText(item.rowNo);
          catPage.drawText(noStr, {
            x: ML + (CAT_COL_NO - fontR.widthOfTextAtSize(noStr, 8)) / 2,
            y: rowY + CAT_ROW_H / 2 - 4,
            size: 8, font: fontR, color: C_LITE,
          });

          // — Image column —
          const imgColX = ML + CAT_COL_NO;
          const img = item.productCode ? imageCache.get(item.productCode) : undefined;
          if (img) {
            const scale = Math.min(CAT_IMG_SZ / img.height, CAT_IMG_SZ / img.width, 1);
            const iw = img.width  * scale;
            const ih = img.height * scale;
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
              color: C_LINE,
            });
          }

          // — Product details column —
          const detX    = ML + CAT_COL_NO + CAT_COL_IMG + 8;
          const detMaxW = CAT_COL_DET - 16;
          let   detY    = rowY + CAT_ROW_H - 16;

          if (showCode && item.productCode) {
            catPage.drawText(trunc(item.productCode, fontB, 8, detMaxW), {
              x: detX, y: detY, size: 8, font: fontB, color: accentColor,
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
            catPage.drawText(sanitizeText(item.uom), {
              x: detX, y: detY, size: 8, font: fontR, color: C_LITE,
            });
            detY -= 11;
          }

          if (showMdaCerts && item.hasCert) {
            detY -= 5; // gap between description and MDA details
            if (item.mdaRegNo) {
              catPage.drawText(sanitizeText(`MDA Reg No: ${item.mdaRegNo}`), {
                x: detX, y: detY, size: 7.5, font: fontR, color: C_MID,
              });
              detY -= 10;
            }
            if (item.mdaValidity) {
              catPage.drawText(`MDA Validity: ${fmtD(item.mdaValidity)}`, {
                x: detX, y: detY, size: 7.5, font: fontR, color: C_MID,
              });
            }
          }

          rowTopY = rowY;
        }

        // Table outer border
        catPage.drawRectangle({
          x: ML, y: tableBottomY,
          width: CW, height: tableTopY - tableBottomY,
          borderColor: C_LINE, borderWidth: 0.4,
        });

        // ── Footer ───────────────────────────────────────────────────────
        hLine(catPage, MB + 22);
        catPage.drawText("Product Catalogue  ·  Computer generated document.", {
          x: ML, y: MB + 10, size: 7.5, font: fontR, color: C_LITE,
        });
        catPage.drawText(q.quotationNo, {
          x: W - MR - fontR.widthOfTextAtSize(q.quotationNo, 7.5),
          y: MB + 10, size: 7.5, font: fontR, color: C_LITE,
        });
      }
    }
  }

  // ── Append company documents ──────────────────────────────────────────────
  const docAppends: { incl: number | null; url: string | null }[] = [
    { incl: q.inclMof,              url: orgMofCertUrl         ?? null },
    { incl: q.inclSsm,              url: orgSsmCertUrl         ?? null },
    { incl: q.inclTcc,              url: orgTccCertUrl         ?? null },
    { incl: q.inclBankStatement,    url: orgBankStatementUrl   ?? null },
    { incl: q.inclMdaEstablishment, url: orgMdaCertUrl         ?? null },
    { incl: q.inclLampiran12,       url: orgLampiran12Url      ?? null },
    { incl: q.inclLampiran13,       url: orgLampiran13Url      ?? null },
  ];
  for (const doc of docAppends) {
    if (!Number(doc.incl) || !doc.url) continue;
    try {
      const res = await fetch(doc.url);
      if (!res.ok) continue;
      const buf = await res.arrayBuffer();
      const srcPdf = await PDFDocument.load(buf);
      const pages = await pdfDoc.copyPages(srcPdf, srcPdf.getPageIndices());
      pages.forEach((p) => pdfDoc.addPage(p));
    } catch { /* skip unavailable documents */ }
  }

  return pdfDoc.save();
}
