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
const CW = W - ML - MR;

// ── Palette — dark charcoal neutral ───────────────────────────────────────
const C_CHARCOAL = rgb(0.06, 0.06, 0.06);
const C_DARK     = rgb(0.10, 0.10, 0.10);
const C_MID      = rgb(0.40, 0.40, 0.40);
const C_LITE     = rgb(0.62, 0.62, 0.62);
const C_LINE     = rgb(0.88, 0.88, 0.88);
const C_ALT      = rgb(0.965, 0.966, 0.968);
const C_WHITE    = rgb(1, 1, 1);
const C_WHITE80  = rgb(0.85, 0.85, 0.85);
const C_GREEN    = rgb(0.09, 0.40, 0.20);
const C_AMBER    = rgb(0.57, 0.25, 0.05);

// ── Layout constants ───────────────────────────────────────────────────────
const ZINC_HDR_H = 96;
const STAMP_W    = 152;
const LOGO_H_MAX = 42;
const LOGO_W_MAX = 108;
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
export async function generateQuotationZinc(data: Data): Promise<Uint8Array> {
  const {
    quotation: q, items,
    orgName, orgLogoUrl, orgBrandColor,
    orgCompanyName, orgCompanyAddress, orgTaxNo, orgPhone,
    orgEmail, orgWebsite, orgOldSsmNo, orgNewSsmNo, orgMdaEstablishmentNo,
    orgBankingInfo,
    orgMofCertUrl, orgSsmCertUrl, orgMdaCertUrl, orgTccCertUrl,
    orgBankStatementUrl, orgLampiran12Url, orgLampiran13Url,
  } = data;

  const accent = orgBrandColor
    ? (() => {
        const hex = orgBrandColor.replace("#", "");
        const r = parseInt(hex.slice(0, 2), 16) / 255;
        const g = parseInt(hex.slice(2, 4), 16) / 255;
        const b = parseInt(hex.slice(4, 6), 16) / 255;
        return rgb(r, g, b);
      })()
    : rgb(0.08, 0.18, 0.36);

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

  // ── Font size + layout from org settings ─────────────────────────────────
  const tfs       = data.orgTableFontSize ?? "normal";
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
    codeLines:  string[];
    extraLine:  string | null;
    isGreenRow: boolean;
    rowH:       number;
  };

  const CODE_LINE_H = LH - 2;
  const rowInfos: RowInfo[] = items.map(item => {
    const rentalPrefix = item.lineType === "rent" && item.rentalDuration
      ? `rental for ${item.rentalDuration} ${item.rentalUnit ?? "case"} `
      : "";
    const descLines  = wrap(`${rentalPrefix}${item.description ?? "—"}`, fontR, FS_DESC, C_DESC - TABLE_PAD * 2);
    const extraLine  = showMdaCerts && item.hasCert && item.mdaRegNo
      ? `MDA: ${item.mdaRegNo}${item.mdaValidity ? ` · Exp: ${fmtD(item.mdaValidity)}` : ""}`
      : null;
    const isGreenRow = !!(item.hasCert && item.mdaRegNo);
    const codeLines  = showCode ? wrap(item.productCode ?? "—", fontR, FS_CODE, C_CODE - TABLE_PAD * 2) : [];
    const codeLineH  = codeLines.length * CODE_LINE_H;
    const rowH = Math.max(
      RH_MIN,
      Math.max(codeLineH + 6, descLines.length * LH + (extraLine ? RH_MIN + MDA_GAP + 2 : 6)),
    );
    return { item, descLines, codeLines, extraLine, isGreenRow, rowH };
  });

  // ── Org name style ────────────────────────────────────────────────────────
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

  // ── Address wrap (kept for drawCompanyInfoOnDark local rendering) ────────
  const addrMaxW  = CW - STAMP_W - 20;
  const addrLines = orgCompanyAddress ? wrap(orgCompanyAddress, fontR, 9, addrMaxW) : [];

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
    title: q.title || null,
    detailFontSize: detailFSz, fontR,
    revisionNo: q.revisionNo ?? 0,
  }) + 10;

  const totRowCount  = 1 + (showDisc && itemDiscPerSet > 0 ? 2 : 0) + (sets > 1 ? 1 : 0) + (discAmt > 0 ? 3 : 0) + (sstAmt > 0 ? 1 : 0);
  const noteLines    = q.notes ? wrap(q.notes, fontR, 9.5, CW - 20) : [];
  const TOTALS_H     = 16 + totRowCount * 13 + 6 + 1.5 + 10 + 24 + 8;
  const NOTES_H      = q.notes ? noteLines.length * 12 + 30 : 0;
  const FOOTER_BLOCK = 30;
  const CLOSING_H    = 38;
  const ACCEPT_H     = 0;
  const BOTTOM_RESERVE = TOTALS_H + NOTES_H + FOOTER_BLOCK + 16 + CLOSING_H + ACCEPT_H;

  const P1_ROW_AVAIL = H - MT - HEADER_BLOCK - DIVIDER_GAP - INFO_BLOCK - DIVIDER_GAP - TABLE_HDR_H - (hasBanner ? BANNER_H : 0) - MB - 32;
  const PN_ROW_AVAIL = H - MT - 28 - TABLE_HDR_H - MB - 28;

  // ── Build render entries (set headers interleaved with items) ────────────
  const SET_HDR_H = 18;
  type RenderEntry =
    | { kind: "setHeader"; label: string; qty: number; setTotal: number; pricePerSet: number; rowH: number }
    | { kind: "item"; rowIdx: number; rowH: number };
  const renderItems: RenderEntry[] = [];
  {
    const uniqueSetIds = new Set(rowInfos.map(r => r.item.setGroupId).filter(Boolean));
    const showSetHeaders = uniqueSetIds.size > 1;
    const seenGroups = new Set<string>();
    for (let i = 0; i < rowInfos.length; i++) {
      const it = rowInfos[i].item;
      if (showSetHeaders && it.setGroupId && !seenGroups.has(it.setGroupId)) {
        seenGroups.add(it.setGroupId);
        const setTotal = rowInfos
          .filter(r => r.item.setGroupId === it.setGroupId)
          .reduce((s, r) => s + Number(r.item.totalPrice ?? 0), 0);
        const qty = Number(it.setQty ?? 1); const _lbl = it.setGroupLabel ?? "Set"; renderItems.push({ kind: "setHeader", label: _lbl.toLowerCase() === "not-as-set" ? "Loose Items" : _lbl, qty, setTotal, pricePerSet: qty > 0 ? setTotal / qty : 0, rowH: SET_HDR_H });
      }
      renderItems.push({ kind: "item", rowIdx: i, rowH: rowInfos[i].rowH });
    }
  }

  // ── Paginate rows ─────────────────────────────────────────────────────────
  const pageGroups: number[][] = [];
  let curGroup: number[] = [];
  let used = 0;
  let firstPage = true;

  for (let i = 0; i < renderItems.length; i++) {
    const rh = renderItems[i].rowH;
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
    const lastItemsH  = lastGroup.reduce((s, i) => s + renderItems[i].rowH, 0);
    if (lastItemsH + BOTTOM_RESERVE > lastAvail && lastGroup.length > 1) {
      let fitH = 0, splitAt = 0;
      for (const idx of lastGroup) {
        if (fitH + renderItems[idx].rowH + BOTTOM_RESERVE <= lastAvail) { fitH += renderItems[idx].rowH; splitAt++; }
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
        page, startY: curY, accent, fontR, fontB, logoImg,
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
      hLine(page, curY, ML, W - MR, accent, 1.2);
      curY -= DIVIDER_GAP;

      drawInfoSection({
        page, startY: curY, accent, fontR, fontB, cust,
        attentionNameSize: attnNameSz, attentionNameBold: !!(data.orgAttentionNameBold ?? 1),
        detailFontSize: detailFSz, detailFontBold: !!(data.orgDetailFontBold ?? 0),
        detailAlignment: (data.orgDetailAlignment ?? "right") as "left" | "right",
        quotationNo: q.quotationNo, createdAt: q.createdAt,
        validUntil: q.validUntil, salesPersonName: q.salesPersonName ?? null,
        salesPersonPhone: (q as any).salesPersonPhone ?? null, revisionNo: q.revisionNo ?? 0,
        preparedByName: q.preparedByName ?? null, title: q.title || null,
      });
      curY -= INFO_BLOCK + DIVIDER_GAP;
      hLine(page, curY);
      curY -= 4;

    } else {
      // ── Continuation header ──────────────────────────────────────────────
      page.drawRectangle({ x: 0, y: H - MT - 28, width: W, height: 28 + MT, color: C_CHARCOAL });
      page.drawRectangle({ x: 0, y: H - MT - 28, width: W, height: 2, color: accent });
      page.drawText(`${q.quotationNo} (continued)`, {
        x: ML, y: curY - 14, size: 9, font: fontR, color: C_WHITE80,
      });
      curY -= 28;
    }

    // ── Table banner (optional) ────────────────────────────────────────────
    let tableTopY = curY;
    if (hasBanner) {
      const bannerY = curY - BANNER_H;
      page.drawRectangle({ x: ML, y: bannerY, width: CW, height: BANNER_H, color: rgb(0.14, 0.14, 0.14) });
      page.drawText(trunc(q.title || "Quotation Items", fontB, 8.5, CW - 12), {
        x: ML + 6, y: bannerY + 6, size: 8.5, font: fontB, color: C_WHITE,
      });
      tableTopY = bannerY;
      curY -= BANNER_H;
    }

    // ── Table header — charcoal fill with white text ───────────────────────
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

    const tHdrY = curY - TABLE_HDR_H;
    page.drawRectangle({ x: ML, y: tHdrY, width: CW, height: TABLE_HDR_H, color: C_CHARCOAL });
    // Thin accent strip on left edge of header
    page.drawRectangle({ x: ML, y: tHdrY, width: 3, height: TABLE_HDR_H, color: accent });
    for (const col of thdrs) {
      const tw = fontB.widthOfTextAtSize(col.label, 7.5);
      const tx = col.x + (col.w - tw) / 2;
      page.drawText(col.label.toUpperCase(), {
        x: tx, y: tHdrY + 6, size: 7.5, font: fontB, color: C_WHITE,
      });
    }
    curY = tHdrY;

    // ── Item rows ────────────────────────────────────────────────────────────
    for (const entryIdx of pageItems) {
      const entry = renderItems[entryIdx];
      if (entry.kind === "setHeader") {
        const hdrY  = curY - SET_HDR_H;
        const textY = hdrY + (SET_HDR_H - FS_DESC) / 2;
        page.drawRectangle({ x: ML, y: hdrY, width: CW, height: SET_HDR_H, color: rgb(0.90, 0.93, 0.97) });
        const labelW = fontB.widthOfTextAtSize(entry.label, FS_DESC);
        page.drawText(entry.label.toUpperCase(), { x: ML + TABLE_PAD, y: textY, size: FS_DESC, font: fontB, color: C_DARK });
        const qtyText = `  ×  ${entry.qty} ${entry.qty === 1 ? "set" : "sets"}`;
        page.drawText(qtyText, { x: ML + TABLE_PAD + labelW, y: textY, size: FS_CODE, font: fontR, color: C_LITE });
        if (showTP && entry.qty > 1) {
          const qtyTextW = fontR.widthOfTextAtSize(qtyText, FS_CODE);
          const ppsStr = `  ·  RM ${entry.pricePerSet.toFixed(2)} / set`;
          page.drawText(ppsStr, { x: ML + TABLE_PAD + labelW + qtyTextW, y: textY, size: FS_CODE, font: fontR, color: C_LITE });
        }
        if (showTP) {
          const totStr = `RM ${entry.setTotal.toFixed(2)}`;
          const totW = fontB.widthOfTextAtSize(totStr, FS_DESC);
          page.drawText(totStr, { x: X_TOT + C_TOT - TABLE_PAD - totW, y: textY, size: FS_DESC, font: fontB, color: C_DARK });
        }
        hLine(page, hdrY, ML, W - MR, accent, 0.5);
        curY = hdrY;
        continue;
      }
      const rowIdx = entry.rowIdx;
      const { item, descLines, codeLines, extraLine, isGreenRow, rowH } = rowInfos[rowIdx];
      const rowY = curY - rowH;

      if (rowIdx % 2 === 1 && tableRowStyle === "default") {
        page.drawRectangle({ x: ML, y: rowY, width: CW, height: rowH, color: C_ALT });
      }

      const textBaseline = curY - 11;

      // No
      const noW = fontR.widthOfTextAtSize(String(item.rowNo), FS_NUM);
      page.drawText(String(item.rowNo), {
        x: X_NO + (C_NO - noW) / 2, y: textBaseline,
        size: FS_NUM, font: fontR, color: C_LITE,
      });

      // Code column or code prefix
      let dy = textBaseline;
      if (showCode) {
        let cdy = dy;
        for (const codeLine of codeLines) {
          page.drawText(codeLine, { x: X_CODE + TABLE_PAD, y: cdy, size: FS_CODE, font: fontR, color: C_MID });
          cdy -= CODE_LINE_H;
        }
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
        x: X_UOM + (C_UOM - uomW) / 2, y: textBaseline, size: FS_CODE, font: fontR, color: C_LITE,
      });

      // Unit Price
      const up  = `RM ${Number(item.unitPrice ?? 0).toFixed(2)}`;
      const upW = fontR.widthOfTextAtSize(up, FS_CODE);
      page.drawText(up, {
        x: X_UP + C_UP - TABLE_PAD - upW, y: textBaseline, size: FS_CODE, font: fontR, color: C_DARK,
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
        const totW = fontB.widthOfTextAtSize(tot, FS_DESC);
        page.drawText(tot, {
          x: X_TOT + C_TOT - TABLE_PAD - totW, y: textBaseline, size: FS_DESC, font: fontB, color: C_DARK,
        });
      }

      hLine(page, rowY, ML, W - MR, rgb(0.90, 0.90, 0.90), 0.3);
      curY = rowY;
    }

    // Rounded outer border (optional)
    if (tableRowStyle === "rounded") {
      const tableH = tableTopY - curY;
      const r = 6;
      page.drawSvgPath(
        `M ${r},0 L ${CW - r},0 Q ${CW},0 ${CW},${r} L ${CW},${tableH - r} Q ${CW},${tableH} ${CW - r},${tableH} L ${r},${tableH} Q 0,${tableH} 0,${tableH - r} L 0,${r} Q 0,0 ${r},0 Z`,
        { x: ML, y: tableTopY, borderColor: C_CHARCOAL, borderWidth: 1 },
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
        page.drawText("PAYMENT TO", { x: ML, y: by, size: 7.5, font: fontB, color: C_MID });
        by -= 13;
        for (const [lbl, val] of [
          ["Bank", bank.bankName ?? ""],
          ["Branch", (bank as any).branchName ?? ""],
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

      // Totals (right-aligned)
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
        totItems.push([Number(q.overallDiscountPct ?? 0) > 0 ? `Discount (${q.overallDiscountPct}%)` : "Special Discount", `- ${fmtM(discAmt)}`]);
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
      // Zinc: charcoal grand total band
      const GRAND_BAND_H = 28;
      page.drawRectangle({ x: totX - 8, y: ty - GRAND_BAND_H, width: totW + 8, height: GRAND_BAND_H, color: C_CHARCOAL });
      page.drawRectangle({ x: totX - 8, y: ty - GRAND_BAND_H, width: 3, height: GRAND_BAND_H, color: accent });
      page.drawText("Grand Total", {
        x: totX, y: ty - 18, size: 10, font: fontB, color: C_WHITE80,
      });
      const gtAmt = fmtM(grand);
      const gtAmtW = fontB.widthOfTextAtSize(gtAmt, 12);
      page.drawText(gtAmt, {
        x: W - MR - gtAmtW, y: ty - 18, size: 12, font: fontB, color: C_WHITE,
      });
      curY = ty - GRAND_BAND_H - 10;

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
        const nl    = wrap(q.notes, fontR, 9.5, CW - 20);
        const noteH = nl.length * 12 + 24;
        page.drawRectangle({ x: ML, y: curY - noteH, width: CW, height: noteH, color: rgb(0.97, 0.97, 0.97) });
        page.drawRectangle({ x: ML, y: curY - noteH, width: 3, height: noteH, color: C_CHARCOAL });
        page.drawText("NOTES", {
          x: ML + 10, y: curY - 12, size: 7.5, font: fontB, color: C_DARK,
        });
        let ny = curY - 24;
        for (const line of nl) {
          page.drawText(line, { x: ML + 10, y: ny, size: 9.5, font: fontR, color: C_DARK });
          ny -= 12;
        }
      }

    }
  }

  // ── Catalogue pages ──────────────────────────────────────────────────────
  if (Number(q.includeCatalogue)) {
    const r2ImgBase = process.env.NEXT_PUBLIC_R2_PRODUCT_IMAGES_URL ?? "";

    const seenCodes = new Set<string>();
    const catItems = items.filter(it => {
      if (!it.productCode || seenCodes.has(it.productCode)) return false;
      seenCodes.add(it.productCode);
      return true;
    });

    if (catItems.length > 0) {
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

      const CAT_HDR_H    = 64;
      const CAT_COLHDR_H = 20;
      const CAT_FOOT_H   = 32;
      const CAT_COL_NO   = 26;
      const ROWS_PER_PG  = 5;
      const rowsAvail    = H - MT - CAT_HDR_H - CAT_COLHDR_H - MB - CAT_FOOT_H;
      const CAT_ROW_H    = Math.floor(rowsAvail / ROWS_PER_PG);
      const CAT_IMG_SZ   = CAT_ROW_H - 12;
      const CAT_COL_IMG  = CAT_IMG_SZ + 22;
      const CAT_COL_DET  = CW - CAT_COL_NO - CAT_COL_IMG;
      const totalCatPgs  = Math.ceil(catItems.length / ROWS_PER_PG);

      for (let pi = 0; pi < totalCatPgs; pi++) {
        const catPage  = pdfDoc.addPage([W, H]);
        const pageRows = catItems.slice(pi * ROWS_PER_PG, (pi + 1) * ROWS_PER_PG);

        // Section header — Zinc: charcoal strip
        catPage.drawRectangle({ x: 0, y: H - CAT_HDR_H, width: W, height: CAT_HDR_H, color: C_CHARCOAL });
        catPage.drawRectangle({ x: 0, y: H - CAT_HDR_H, width: 4, height: CAT_HDR_H, color: accent });
        catPage.drawText("PRODUCT CATALOGUE", {
          x: ML, y: H - 22, size: 13, font: fontB, color: C_WHITE,
        });
        if (q.title) {
          catPage.drawText(trunc(q.title, fontB, 8.5, CW / 2), {
            x: ML, y: H - 36, size: 8.5, font: fontB, color: C_WHITE80,
          });
          catPage.drawText(`${q.quotationNo}  ·  ${fmtD(q.createdAt)}`, {
            x: ML, y: H - 46, size: 7, font: fontR, color: rgb(0.5, 0.5, 0.5),
          });
        } else {
          catPage.drawText(`${q.quotationNo}  ·  ${fmtD(q.createdAt)}`, {
            x: ML, y: H - 37, size: 8, font: fontR, color: C_WHITE80,
          });
        }
        const pgLabel = `Page ${pi + 1} / ${totalCatPgs}`;
        catPage.drawText(pgLabel, {
          x: W - MR - fontR.widthOfTextAtSize(pgLabel, 8),
          y: H - 28, size: 8, font: fontR, color: rgb(0.5, 0.5, 0.5),
        });

        // Column header — charcoal fill
        const colHdrY = H - CAT_HDR_H - CAT_COLHDR_H;
        catPage.drawRectangle({
          x: ML, y: colHdrY, width: CW, height: CAT_COLHDR_H, color: C_CHARCOAL,
        });
        const colDefs: { label: string; x: number; w: number }[] = [
          { label: "#",               x: ML,                           w: CAT_COL_NO  },
          { label: "Image",           x: ML + CAT_COL_NO,              w: CAT_COL_IMG },
          { label: "Product Details", x: ML + CAT_COL_NO + CAT_COL_IMG, w: CAT_COL_DET },
        ];
        for (const col of colDefs) {
          const tw = fontB.widthOfTextAtSize(col.label, 7);
          catPage.drawText(col.label, {
            x: col.x + (col.w - tw) / 2,
            y: colHdrY + 6, size: 7, font: fontB, color: C_WHITE,
          });
        }

        const tableTopY    = colHdrY;
        const tableBottomY = tableTopY - pageRows.length * CAT_ROW_H;
        for (const col of colDefs.slice(1)) {
          catPage.drawLine({
            start: { x: col.x, y: tableBottomY },
            end:   { x: col.x, y: tableTopY },
            thickness: 0.3, color: C_LINE,
          });
        }

        let rowTopY = colHdrY;
        for (let ri = 0; ri < pageRows.length; ri++) {
          const item    = pageRows[ri];
          const rowY    = rowTopY - CAT_ROW_H;
          if (ri % 2 === 1) {
            catPage.drawRectangle({ x: ML, y: rowY, width: CW, height: CAT_ROW_H, color: C_ALT });
          }
          hLine(catPage, rowY, ML, ML + CW, C_LINE, 0.3);

          const noStr = sanitizeText(item.rowNo);
          catPage.drawText(noStr, {
            x: ML + (CAT_COL_NO - fontR.widthOfTextAtSize(noStr, 8)) / 2,
            y: rowY + CAT_ROW_H / 2 - 4,
            size: 8, font: fontR, color: C_LITE,
          });

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

          const detX    = ML + CAT_COL_NO + CAT_COL_IMG + 8;
          const detMaxW = CAT_COL_DET - 16;
          let   detY    = rowY + CAT_ROW_H - 16;

          if (showCode && item.productCode) {
            catPage.drawText(trunc(item.productCode, fontB, 8, detMaxW), {
              x: detX, y: detY, size: 8, font: fontB, color: accent,
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
            catPage.drawText(sanitizeText(item.uom), { x: detX, y: detY, size: 8, font: fontR, color: C_LITE });
            detY -= 11;
          }
          if (showMdaCerts && item.hasCert) {
            detY -= 5;
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

        catPage.drawRectangle({
          x: ML, y: tableBottomY,
          width: CW, height: tableTopY - tableBottomY,
          borderColor: C_LINE, borderWidth: 0.4,
        });

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
      const pages  = await pdfDoc.copyPages(srcPdf, srcPdf.getPageIndices());
      pages.forEach((p) => pdfDoc.addPage(p));
    } catch { /* skip unavailable documents */ }
  }

  return pdfDoc.save();
}
