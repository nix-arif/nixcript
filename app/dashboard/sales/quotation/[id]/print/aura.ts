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
const MT = 22;
const MB = 0;
const CW = W - ML - MR;

// ── Palette — clean editorial, accent-driven ───────────────────────────────
const C_DARK   = rgb(0.10, 0.10, 0.10);
const C_MID    = rgb(0.40, 0.40, 0.40);
const C_LITE   = rgb(0.62, 0.62, 0.62);
const C_LINE   = rgb(0.88, 0.88, 0.88);
const C_WHITE  = rgb(1, 1, 1);
const C_GREEN  = rgb(0.09, 0.40, 0.20);
const C_AMBER  = rgb(0.57, 0.25, 0.05);

// ── Layout constants ───────────────────────────────────────────────────────
const LOGO_H_MAX   = 44;
const LOGO_W_MAX   = 110;
const TABLE_PAD    = 6;

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

function toSentenceCase(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
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
export async function generateQuotationAura(data: Data): Promise<Uint8Array> {
  const {
    quotation: q, items,
    orgName, orgLogoUrl, orgBrandColor,
    orgCompanyName, orgCompanyAddress, orgTaxNo, orgMofNo, orgPhone,
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
  const showIP    = !!Number(q.showItemizedPricing ?? 1);
  const showDisc  = showIP && !!Number(q.showItemizeDiscount);
  const showTP    = !!Number(q.showTotalPrice ?? 1);
  const showTPCol = showIP && showTP;
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
  const tableRowStyle  = data.orgTableRowStyle ?? "default";
  const showCode       = !!Number(q.showProductCode ?? 1);
  const showMdaCerts   = !!Number(q.includeMdaCerts ?? 1);
  const showSetHeaders = new Set(items.map(i => i.setGroupId).filter(Boolean)).size > 1;

  // ── Column widths ─────────────────────────────────────────────────────────
  const C_NO   = 22;
  const C_CODE = showCode ? 65 : 0;
  const C_QTY  = showSetHeaders ? 38 : 28;
  const C_TQTY = showSetHeaders ? 48 : 0;
  const C_UOM  = 34;
  const C_UP   = showIP ? 64 : 0;
  const C_DISC = showDisc ? 55 : 0;
  const C_TOT  = showTPCol ? 68 : 0;
  const C_DESC = CW - C_NO - C_CODE - C_QTY - C_TQTY - C_UOM - C_UP - C_DISC - C_TOT;

  const X_NO   = ML;
  const X_CODE = X_NO   + C_NO;
  const X_DESC = X_CODE + C_CODE;
  const X_QTY  = X_DESC + C_DESC;
  const X_TQTY = X_QTY  + C_QTY;
  const X_UOM  = X_TQTY + C_TQTY;
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
  const CONT_LH   = 8;    // line height for continuation lines at 6pt
  const RH_MIN    = tfs === "small" ? 15   : tfs === "large" ? 21   : 17;
  const MDA_GAP   = 3;

  const hasBanner = true; // Aura always shows the title banner on every page
  const BANNER_H  = 20;
  const brandText = (data.itemBrands?.length ?? 0) > 0 ? data.itemBrands!.join(", ") : "As per catalogue";

  // ── Pre-compute row heights ───────────────────────────────────────────────
  type RowInfo = {
    item:               typeof items[number];
    descLines:          string[];
    codeLines:          string[];
    extraLine:          string | null;
    isGreenRow:         boolean;
    rowH:               number;
    firstParaLineCount: number;
  };

  const CODE_LINE_H = LH - 2;
  const rowInfos: RowInfo[] = items.map(item => {
    const rentalPrefix = item.lineType === "rent" && item.rentalDuration
      ? `RENTAL FOR ${item.rentalDuration} ${(item.rentalUnit ?? "case").toUpperCase()} `
      : "";
    const rawDesc    = `${rentalPrefix}${item.description ?? "—"}`;
    const descLines  = wrap(rawDesc, fontR, FS_DESC, C_DESC - TABLE_PAD * 2);
    const firstParaLineCount = /\r?\n/.test(rawDesc)
      ? Math.max(1, wrap(rawDesc.split(/\r?\n/)[0], fontR, FS_DESC, C_DESC - TABLE_PAD * 2).length)
      : descLines.length;
    const extraLine  = showMdaCerts && item.hasCert && item.mdaRegNo
      ? `MDA: ${item.mdaRegNo}${item.mdaValidity ? ` · Exp: ${fmtD(item.mdaValidity)}` : ""}`
      : null;
    const isGreenRow = !!(item.hasCert && item.mdaRegNo);
    const codeLines   = showCode ? wrap(item.productCode ?? "—", fontR, FS_CODE, C_CODE - TABLE_PAD * 2) : [];
    const codeLineH   = codeLines.length * CODE_LINE_H;
    const hasItemDisc = showDisc && Number(item.discountPct ?? 0) > 0;
    const descH = firstParaLineCount * LH + Math.max(0, descLines.length - firstParaLineCount) * CONT_LH;
    const rowH = Math.max(
      hasItemDisc ? RH_MIN + 8 : RH_MIN,
      Math.max(codeLineH + 6, descH + (extraLine ? RH_MIN + MDA_GAP + 2 : 6)),
    );
    return { item, descLines, codeLines, extraLine, isGreenRow, rowH, firstParaLineCount };
  });

  // ── Org name + header style ───────────────────────────────────────────────
  const nameSize   = ({ small: 10, medium: 13, large: 16, xlarge: 20 } as Record<string,number>)[data.orgNameSize ?? "medium"] ?? 13;
  const hLayout    = "standard";
  const QL_SIZE    = 20; // Aura identity: large centered document title
  const QL_TEXT    = !!(data.orgQuotationLabelUppercase ?? 1) ? "QUOTATION" : "Quotation";
  const attnNameSz = ({ small: 10, medium: 13, large: 16, xlarge: 20 } as Record<string,number>)[data.orgAttentionNameSize ?? "medium"] ?? 13;
  const detailFSz  = ({ small: 8, normal: 9, large: 10.5 } as Record<string,number>)[data.orgDetailFontSize ?? "normal"] ?? 9;

  // ── Height estimates ──────────────────────────────────────────────────────
  const HEADER_BLOCK = estimateHeaderH({
    companyAddress: orgCompanyAddress, phone: orgPhone, email: orgEmail,
    website: orgWebsite, oldSsmNo: orgOldSsmNo, newSsmNo: orgNewSsmNo,
    mdaEstablishmentNo: orgMdaEstablishmentNo, taxNo: orgTaxNo, mofNo: orgMofNo,
    nameSize, logoHMax: LOGO_H_MAX, logoWMax: LOGO_W_MAX, headerLayout: hLayout,
    logoImg, fontR, docLabelSize: 0, inlineSsmMdaTaxStar: true, inlineContactsStar: true,
  }) + 2;
  const DIVIDER_GAP   = 6;
  const TABLE_HDR_H   = 20;
  const INFO_BLOCK = estimateInfoH({
    cust, attentionNameSize: attnNameSz,
    salesPersonName: q.salesPersonName ?? null,
    preparedByName: q.preparedByName ?? null,
    title: q.title || null,
    detailFontSize: detailFSz, fontR,
    revisionNo: q.revisionNo ?? 0,
  }) + 6;

  const totRowCount  = 1 + (showDisc && itemDiscPerSet > 0 ? 2 : 0) + (sets > 1 ? 1 : 0) + (discAmt > 0 ? 2 : 0) + (sstAmt > 0 ? 1 : 0);
  const termsNoteLines = q.notes ? wrap(q.notes, fontR, 8.5, CW - 80) : [];
  const payOpts      = q.paymentOptions as import("@/db/schema").PaymentOption[] | null | undefined;
  const TOTALS_H     = showIP && showTP ? (26 + Math.max(bank ? 52 : 0, (totRowCount + 1) * 16) + 20)
                     : showTP           ? 54
                     : 0;
  const baseTermsRows  = 1 + (q.deliveryTerm ? 1 : 0) + (q.paymentTerm ? 1 : 0) + ((q as any).warranty ? 1 : 0);
  const totalTermsRows = baseTermsRows + (q.notes ? 1 : 0);
  const termsBoxH      = 16
    + baseTermsRows * 12
    + (q.notes ? termsNoteLines.length * 12 : 0)
    + Math.max(totalTermsRows - 1, 0) * 4
    + 8;
  const TERMS_H      = 18 + termsBoxH;
  const PAY_OPTS_H   = payOpts?.length ? 26 + payOpts.reduce((s, o) => s + (o.note ? 50 : 38), 0) : 0;
  const FOOTER_BLOCK = 30;
  const CLOSING_H    = 34;
  const ACCEPT_H     = 0;
  const BOTTOM_RESERVE = TOTALS_H + TERMS_H + PAY_OPTS_H + CLOSING_H + ACCEPT_H;

  // Header repeats on every page — same row availability for all pages
  const PAGE_ROW_AVAIL = H - MT - HEADER_BLOCK - DIVIDER_GAP - INFO_BLOCK - DIVIDER_GAP - TABLE_HDR_H - (hasBanner ? BANNER_H : 0) - MB - 30;

  // ── Build render entries (set headers interleaved with items) ────────────
  const SET_HDR_H = 18;
  type RenderEntry =
    | { kind: "setHeader"; label: string; qty: number; setTotal: number; pricePerSet: number; rowH: number }
    | { kind: "item"; rowIdx: number; rowH: number };
  const renderItems: RenderEntry[] = [];
  {
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

  // ── Paginate rows — height-based ─────────────────────────────────────────
  const avail = Math.max(PAGE_ROW_AVAIL, RH_MIN * 3);
  const pageGroups: number[][] = [];
  let curGroup: number[] = [];
  let used = 0;

  for (let i = 0; i < renderItems.length; i++) {
    const rh = renderItems[i].rowH;
    if (used + rh > avail && curGroup.length > 0) {
      pageGroups.push(curGroup);
      curGroup = [i];
      used = rh;
    } else {
      curGroup.push(i);
      used += rh;
    }
  }
  pageGroups.push(curGroup);

  // Safety-net: if items on last page leave insufficient room for bottom content, add overflow page
  let hasOverflowPage = false;
  {
    const lastGroup  = pageGroups[pageGroups.length - 1];
    const lastItemsH = lastGroup.reduce((s, i) => s + renderItems[i].rowH, 0);
    // items start at avail+28 (after header/info/dividers/banner/tHdr), end at avail+28-lastItemsH
    const curYAfterItems = avail + 28 - lastItemsH;
    if (curYAfterItems - BOTTOM_RESERVE < MB + FOOTER_BLOCK) {
      pageGroups.push([]);
      hasOverflowPage = true;
    }
  }

  const totalPages = pageGroups.length;
  // ── Draw pages ────────────────────────────────────────────────────────────
  for (let pi = 0; pi < pageGroups.length; pi++) {
    const isLast         = pi === pageGroups.length - 1;
    const isOverflowPage = hasOverflowPage && isLast;
    const page           = pdfDoc.addPage([W, H]);
    const pageItems      = pageGroups[pi];

    // ── Footer ──────────────────────────────────────────────────────────────
    hLine(page, MB + 22, ML, W - MR, accent, 0.6);
    page.drawText("Computer generated document. No signature required.", {
      x: ML, y: MB + 10, size: 7.5, font: fontR, color: C_LITE,
    });
    const pgText = `${q.quotationNo}  ·  Page ${pi + 1} of ${totalPages}`;
    const pgW    = fontR.widthOfTextAtSize(pgText, 7.5);
    page.drawText(pgText, { x: W - MR - pgW, y: MB + 10, size: 7.5, font: fontR, color: C_LITE });

    let curY = H - MT;

    // ── Header + info (every page) ───────────────────────────────────────────
    drawCompanyHeader({
      page, startY: curY, accent, fontR, fontB, logoImg,
      companyName: coName, companyAddress: orgCompanyAddress,
      phone: orgPhone, email: orgEmail, website: orgWebsite,
      oldSsmNo: orgOldSsmNo, newSsmNo: orgNewSsmNo,
      mdaEstablishmentNo: orgMdaEstablishmentNo, taxNo: orgTaxNo,
      nameSize, nameBold: !!(data.orgNameBold ?? 1),
      nameUppercase: !!(data.orgNameUppercase ?? 0),
      infoColor: C_DARK,
      headerLayout: hLayout, docLabel: "",
      docLabelSize: QL_SIZE, docLabelBold: !!(data.orgQuotationLabelBold ?? 1),
      docLabelAlign: "center",
      logoHMax: LOGO_H_MAX, logoWMax: LOGO_W_MAX,
      mofNo: orgMofNo, inlineSsmMdaTaxStar: true, inlineContactsStar: true,
    });
    curY -= HEADER_BLOCK;
    {
      const qlFont = !!(data.orgQuotationLabelBold ?? 1) ? fontB : fontR;
      const qlW    = qlFont.widthOfTextAtSize(QL_TEXT, QL_SIZE);
      page.drawText(QL_TEXT, {
        x: W - MR - qlW,
        y: curY + QL_SIZE + 2,
        size: QL_SIZE,
        font: qlFont,
        color: accent,
      });
    }
    hLine(page, curY, ML, W - MR, accent, 1.2);
    curY -= DIVIDER_GAP;

    drawInfoSection({
      page, startY: curY, accent, fontR, fontB, cust,
      attentionNameSize: attnNameSz, attentionNameBold: !!(data.orgAttentionNameBold ?? 1),
      detailFontSize: detailFSz, detailFontBold: !!(data.orgDetailFontBold ?? 0),
      detailAlignment: (data.orgDetailAlignment ?? "right") as "left" | "right",
      textColor: C_DARK,
      quotationNo: q.quotationNo, createdAt: q.createdAt,
      validUntil: q.validUntil, salesPersonName: q.salesPersonName ?? null,
      salesPersonPhone: (q as any).salesPersonPhone ?? null, revisionNo: q.revisionNo ?? 0,
      preparedByName: q.preparedByName ?? null, title: hasBanner ? null : (q.title || null),
    });
    curY -= INFO_BLOCK + DIVIDER_GAP;
    hLine(page, curY);
    curY -= 2;

    // ── Table banner (optional) — skipped on overflow page ────────────────
    let tableTopY = curY;
    if (hasBanner && !isOverflowPage) {
      const bannerY = curY - BANNER_H;
      page.drawRectangle({ x: ML, y: bannerY, width: CW, height: BANNER_H, color: C_LINE });
      const bannerText = trunc((q.title || "Quotation Items").toUpperCase(), fontB, 8.5, CW - 12);
      const bannerTextW = fontB.widthOfTextAtSize(bannerText, 8.5);
      page.drawText(bannerText, {
        x: (W - bannerTextW) / 2, y: bannerY + 6, size: 8.5, font: fontB, color: rgb(0, 0, 0),
      });
      tableTopY = bannerY;
      curY -= BANNER_H;
    }

    // ── Table header — skipped on overflow page ──────────────────────────
    const thdrs: { label: string; x: number; w: number; align: "l" | "c" | "r" }[] = [
      { label: "No",                               x: X_NO,   w: C_NO,   align: "c" },
      ...(showCode ? [{ label: "Code",             x: X_CODE, w: C_CODE, align: "l" as const }] : []),
      { label: "Description",                      x: X_DESC, w: C_DESC, align: "l" },
      { label: showSetHeaders ? "Qty/Set" : "Qty", x: X_QTY,  w: C_QTY,  align: "c" },
      ...(showSetHeaders ? [{ label: "Total Qty",  x: X_TQTY, w: C_TQTY, align: "c" as const }] : []),
      { label: "UOM",                              x: X_UOM,  w: C_UOM,  align: "c" },
      ...(showIP ? [{ label: "Unit Price",           x: X_UP,   w: C_UP,   align: "r" as const }] : []),
      ...(showDisc ? [{ label: "Discount",         x: X_DISC, w: C_DISC, align: "c" as const }] : []),
      ...(showTPCol ? [{ label: "Total",            x: X_TOT,  w: C_TOT,  align: "r" as const }] : []),
    ];

    if (!isOverflowPage) {
      const tHdrY = curY - TABLE_HDR_H;
      // Aura: thin rule above header text
      hLine(page, curY, ML, W - MR, C_LINE, 0.4);
      for (const col of thdrs) {
        const tw = fontB.widthOfTextAtSize(col.label, 7.5);
        const tx = col.x + (col.w - tw) / 2;
        page.drawText(col.label.toUpperCase(), {
          x: tx, y: tHdrY + 6, size: 7.5, font: fontB, color: accent,
        });
      }
      // Thicker accent rule below header
      page.drawLine({ start: { x: ML, y: tHdrY }, end: { x: W - MR, y: tHdrY }, thickness: 1.5, color: accent });
      curY = tHdrY;
    }

    // ── Item rows ────────────────────────────────────────────────────────────
    for (const entryIdx of pageItems) {
      const entry = renderItems[entryIdx];
      if (entry.kind === "setHeader") {
        const hdrY  = curY - SET_HDR_H;
        const textY = hdrY + (SET_HDR_H - FS_DESC) / 2;

        // "SET NAME × N set/sets" inline, pinned to left margin
        const labelUpper  = entry.label.toUpperCase();
        const setCountStr = `  ×  ${entry.qty} ${entry.qty === 1 ? "set" : "sets"}`;
        const labelW      = fontB.widthOfTextAtSize(labelUpper, FS_DESC);
        page.drawText(labelUpper,  { x: ML + TABLE_PAD,          y: textY, size: FS_DESC, font: fontB, color: C_DARK });
        page.drawText(setCountStr, { x: ML + TABLE_PAD + labelW, y: textY, size: FS_DESC, font: fontB, color: C_DARK });

        if (showTPCol) {
          // Unit Price column — price per set
          const upStr  = `RM ${entry.pricePerSet.toFixed(2)}`;
          const upStrW = fontB.widthOfTextAtSize(upStr, FS_DESC);
          page.drawText(upStr, { x: X_UP + (C_UP - upStrW) / 2, y: textY, size: FS_DESC, font: fontB, color: C_DARK });

          // Total column — set total
          const totStr  = `RM ${entry.setTotal.toFixed(2)}`;
          const totStrW = fontB.widthOfTextAtSize(totStr, FS_DESC);
          page.drawText(totStr, { x: X_TOT + C_TOT - TABLE_PAD - totStrW, y: textY, size: FS_DESC, font: fontB, color: C_DARK });
        }

        hLine(page, hdrY, ML, W - MR, accent, 0.5);
        curY = hdrY;
        continue;
      }
      const rowIdx = entry.rowIdx;
      const { item, descLines, codeLines, extraLine, isGreenRow, rowH, firstParaLineCount } = rowInfos[rowIdx];
      const rowY = curY - rowH;

      const textBaseline = curY - 11;

      // No
      const noW = fontR.widthOfTextAtSize(String(item.rowNo), FS_NUM);
      page.drawText(String(item.rowNo), {
        x: X_NO + (C_NO - noW) / 2, y: textBaseline,
        size: FS_NUM, font: fontR, color: C_DARK,
      });

      // Code column or code prefix
      let dy = textBaseline;
      if (showCode) {
        let cdy = dy;
        for (const codeLine of codeLines) {
          page.drawText(codeLine, { x: X_CODE + TABLE_PAD, y: cdy, size: FS_CODE, font: fontR, color: C_DARK });
          cdy -= CODE_LINE_H;
        }
      }

      // Description + cert line
      for (let li = 0; li < descLines.length; li++) {
        const isCont = li >= firstParaLineCount;
        page.drawText(descLines[li], { x: X_DESC + TABLE_PAD, y: dy, size: isCont ? 6 : FS_DESC, font: fontR, color: C_DARK });
        dy -= isCont ? CONT_LH : LH;
      }
      if (extraLine) {
        dy -= MDA_GAP;
        page.drawText(extraLine, {
          x: X_DESC + TABLE_PAD, y: dy,
          size: FS_DETAIL, font: fontR, color: C_DARK,
        });
      }

      // Qty / Qty per set
      const qtyW = fontR.widthOfTextAtSize(String(item.qty ?? 0), FS_DESC);
      page.drawText(String(item.qty ?? 0), {
        x: X_QTY + (C_QTY - qtyW) / 2, y: textBaseline, size: FS_DESC, font: fontR, color: C_DARK,
      });

      // Total Qty (qty/set × number of sets)
      if (showSetHeaders) {
        const totalQtyVal = Number(item.qty ?? 0) * Number(item.setQty ?? 1);
        const tqStr = String(totalQtyVal);
        const tqW   = fontR.widthOfTextAtSize(tqStr, FS_DESC);
        page.drawText(tqStr, {
          x: X_TQTY + (C_TQTY - tqW) / 2, y: textBaseline, size: FS_DESC, font: fontR, color: C_DARK,
        });
      }

      // UOM
      const uom  = sanitizeText(item.uom || "—");
      const uomW = fontR.widthOfTextAtSize(uom, FS_CODE);
      page.drawText(uom, {
        x: X_UOM + (C_UOM - uomW) / 2, y: textBaseline, size: FS_CODE, font: fontR, color: C_DARK,
      });

      // Unit Price
      if (showIP) {
        const up  = `RM ${Number(item.unitPrice ?? 0).toFixed(2)}`;
        const upW = fontR.widthOfTextAtSize(up, FS_CODE);
        page.drawText(up, {
          x: X_UP + (C_UP - upW) / 2, y: textBaseline, size: FS_CODE, font: fontR, color: C_DARK,
        });
      }

      // Discount amount + percentage
      if (showDisc) {
        const itemDiscAmt = Number(item.discountAmt ?? 0);
        const itemDiscPct = Number(item.discountPct ?? 0);
        if (itemDiscAmt > 0) {
          const amtStr  = `RM ${itemDiscAmt.toFixed(2)}`;
          const amtStrW = fontR.widthOfTextAtSize(amtStr, FS_CODE);
          page.drawText(amtStr, { x: X_DISC + (C_DISC - amtStrW) / 2, y: textBaseline, size: FS_CODE, font: fontR, color: C_DARK });
          const pctStr  = `(${itemDiscPct}%)`;
          const pctStrW = fontR.widthOfTextAtSize(pctStr, FS_CODE - 1.5);
          page.drawText(pctStr, { x: X_DISC + (C_DISC - pctStrW) / 2, y: textBaseline - 9, size: FS_CODE - 1.5, font: fontR, color: C_LITE });
        } else {
          const dash  = "—";
          const dashW = fontR.widthOfTextAtSize(dash, FS_CODE);
          page.drawText(dash, { x: X_DISC + (C_DISC - dashW) / 2, y: textBaseline, size: FS_CODE, font: fontR, color: C_LITE });
        }
      }

      // Total
      if (showTPCol) {
        const tot  = `RM ${Number(item.totalPrice ?? 0).toFixed(2)}`;
        const totW = fontR.widthOfTextAtSize(tot, FS_DESC);
        page.drawText(tot, {
          x: X_TOT + (C_TOT - totW) / 2, y: textBaseline, size: FS_DESC, font: fontR, color: C_DARK,
        });
      }

      hLine(page, rowY, ML, W - MR, C_LINE, 0.3);
      curY = rowY;
    }

    // Rounded outer table border (optional) — skipped on overflow page (no items)
    if (!isOverflowPage && tableRowStyle === "rounded") {
      const tableH = tableTopY - curY;
      const r = 6;
      page.drawSvgPath(
        `M ${r},0 L ${CW - r},0 Q ${CW},0 ${CW},${r} L ${CW},${tableH - r} Q ${CW},${tableH} ${CW - r},${tableH} L ${r},${tableH} Q 0,${tableH} 0,${tableH - r} L 0,${r} Q 0,0 ${r},0 Z`,
        { x: ML, y: tableTopY, borderColor: accent, borderWidth: 1 },
      );
    }

    // ── Last page: totals + notes ──────────────────────────────────────────
    if (isLast) {
      if (showIP && showTP) {
        curY -= 10;
        hLine(page, curY, ML, W - MR, C_LINE, 0.6);
        curY -= 16;

        // Bank info (left)
        let bankEndY = curY;
        if (bank) {
          let by = curY;
          page.drawText("PAYMENT TO", { x: ML, y: by, size: 7.5, font: fontB, color: accent });
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
          bankEndY = by;
        }

        // Totals (card style, right side)
        const TOT_ROW_H   = 20;
        const GRAND_ROW_H = 22;
        const totW  = 260;
        const totX  = W - MR - totW;
        const TPADX = 10;
        let ty = curY;
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

        const totalPanelH = totItems.length * TOT_ROW_H + GRAND_ROW_H;
        page.drawRectangle({ x: totX, y: ty - totalPanelH, width: totW, height: totalPanelH, color: rgb(1, 1, 1) });
        for (let i = 0; i < totItems.length; i++) {
          const [lbl, val] = totItems[i];
          const rowBottom  = ty - TOT_ROW_H;
          if (i % 2 === 0) {
            page.drawRectangle({ x: totX, y: rowBottom, width: totW, height: TOT_ROW_H, color: rgb(0.95, 0.95, 0.95) });
          }
          const textY = rowBottom + 6;
          page.drawText(lbl, { x: totX + TPADX, y: textY, size: 9.5, font: fontR, color: C_MID });
          const vw = fontR.widthOfTextAtSize(val, 9.5);
          page.drawText(val, { x: totX + totW - TPADX - vw, y: textY, size: 9.5, font: fontR, color: C_DARK });
          ty -= TOT_ROW_H;
        }
        const gtRowBottom = ty - GRAND_ROW_H;
        page.drawRectangle({ x: totX, y: gtRowBottom, width: totW, height: GRAND_ROW_H, color: accent });
        const gtTextY = gtRowBottom + 7;
        page.drawText(payOpts?.length ? "LIST PRICE" : "GRAND TOTAL", { x: totX + TPADX, y: gtTextY, size: 9.5, font: fontB, color: rgb(1, 1, 1) });
        const gtAmt  = fmtM(grand);
        const gtAmtW = fontB.widthOfTextAtSize(gtAmt, 9.5);
        page.drawText(gtAmt, { x: totX + totW - TPADX - gtAmtW, y: gtTextY, size: 9.5, font: fontB, color: rgb(1, 1, 1) });
        ty -= GRAND_ROW_H;
        page.drawRectangle({ x: totX, y: ty, width: totW, height: totalPanelH, borderColor: accent, borderWidth: 0.6 });
        curY = Math.min(ty, bankEndY) - 6;
      } else if (!showIP && showTP) {
        // Grand total only — no breakdown rows, no bank info
        curY -= 10;
        hLine(page, curY, ML, W - MR, C_LINE, 0.6);
        curY -= 16;

        const GRAND_ROW_H = 22;
        const totW  = 260;
        const totX  = W - MR - totW;
        const TPADX = 10;
        const gtRowBottom = curY - GRAND_ROW_H;
        page.drawRectangle({ x: totX, y: gtRowBottom, width: totW, height: GRAND_ROW_H, color: accent });
        const gtTextY = gtRowBottom + 7;
        page.drawText(payOpts?.length ? "LIST PRICE" : "GRAND TOTAL", { x: totX + TPADX, y: gtTextY, size: 9.5, font: fontB, color: rgb(1, 1, 1) });
        const gtAmt  = fmtM(grand);
        const gtAmtW = fontB.widthOfTextAtSize(gtAmt, 9.5);
        page.drawText(gtAmt, { x: totX + totW - TPADX - gtAmtW, y: gtTextY, size: 9.5, font: fontB, color: rgb(1, 1, 1) });
        page.drawRectangle({ x: totX, y: gtRowBottom, width: totW, height: GRAND_ROW_H, borderColor: accent, borderWidth: 0.6 });
        curY = gtRowBottom - 6;
      }

      // ── Terms box ────────────────────────────────────────────────────────
      curY -= 10;
      {
        const TFS = 8.5;
        const TLPAD = 10;
        const TRPAD = 10;
        const TVPAD = 8;
        const ROW_GAP = 4;
        const TLH = 12;
        const TLABELW = Math.max(
          fontB.widthOfTextAtSize("Brand",    TFS),
          fontB.widthOfTextAtSize("Delivery", TFS),
          fontB.widthOfTextAtSize("Validity", TFS),
          fontB.widthOfTextAtSize("Warranty", TFS),
          fontB.widthOfTextAtSize("Notes",    TFS),
        ) + 14;
        const TVALFITW = CW - TLPAD - TLABELW - TRPAD;
        const termsData: { label: string; value: string }[] = [
          { label: "Brand",    value: toSentenceCase(brandText) },
          ...(q.deliveryTerm ? [{ label: "Delivery", value: toSentenceCase(q.deliveryTerm) }] : []),
          ...(q.paymentTerm  ? [{ label: "Validity", value: toSentenceCase(q.paymentTerm)  }] : []),
          ...((q as any).warranty ? [{ label: "Warranty", value: toSentenceCase((q as any).warranty) }] : []),
          ...(q.notes ? [{ label: "Notes", value: q.notes }] : []),
        ];
        const termsRendered = termsData.map(r => ({
          label: r.label,
          valLines: wrap(r.value, fontR, TFS, TVALFITW),
        }));
        let termsBoxH = TVPAD + 8;
        for (let ri = 0; ri < termsRendered.length; ri++) {
          termsBoxH += termsRendered[ri].valLines.length * TLH;
          if (ri < termsRendered.length - 1) termsBoxH += ROW_GAP;
        }
        termsBoxH += TVPAD;
        const termsBoxY = curY - termsBoxH;
        page.drawRectangle({
          x: ML, y: termsBoxY, width: CW, height: termsBoxH,
          color: rgb(0.97, 0.97, 0.97), borderColor: accent, borderWidth: 0.8,
        });
        let tty = curY - TVPAD - TFS - 1;
        for (let ri = 0; ri < termsRendered.length; ri++) {
          const { label, valLines } = termsRendered[ri];
          page.drawText(label, { x: ML + TLPAD, y: tty, size: TFS, font: fontB, color: accent });
          for (let li = 0; li < valLines.length; li++) {
            page.drawText(valLines[li], {
              x: ML + TLPAD + TLABELW, y: tty - li * TLH,
              size: TFS, font: fontR, color: C_DARK,
            });
          }
          tty -= valLines.length * TLH + (ri < termsRendered.length - 1 ? ROW_GAP : 0);
        }
        curY = termsBoxY - 8;
      }

      // Payment Options
      if (payOpts?.length) {
        curY -= 8;
        const HDR_H = 18;
        const boxH  = HDR_H + payOpts.reduce((s, o) => s + (o.note ? 50 : 38), 0) + 4;

        page.drawRectangle({ x: ML, y: curY - boxH, width: CW, height: boxH, color: rgb(0.970, 0.974, 0.984), borderColor: rgb(0.88, 0.88, 0.90), borderWidth: 0.4 });
        page.drawRectangle({ x: ML, y: curY - HDR_H, width: CW, height: HDR_H, color: accent });
        page.drawText("PAYMENT OPTIONS", { x: ML + 10, y: curY - HDR_H + 5, size: 7.5, font: fontB, color: C_WHITE });

        let oy = curY - HDR_H;
        for (let oi = 0; oi < payOpts.length; oi++) {
          const opt  = payOpts[oi];
          const optH = opt.note ? 50 : 38;
          if (oi > 0) hLine(page, oy, ML + 6, W - MR - 6, rgb(0.88, 0.88, 0.90), 0.3);
          if (oi % 2 === 1) page.drawRectangle({ x: ML, y: oy - optH, width: CW, height: optH, color: rgb(0.960, 0.962, 0.970) });

          const payable = opt.type === "lump_sum"
            ? (opt.discountPct ? grand * (1 - opt.discountPct / 100) : grand)
            : (Number(opt.deposit) + Number(opt.monthly) * (opt.lastMonth ? opt.months - 1 : opt.months) + (opt.lastMonth ? Number(opt.lastMonth) : 0));
          const amtStr = fmtM(payable);
          const amtW   = fontB.widthOfTextAtSize(amtStr, 11);
          page.drawText(amtStr, { x: W - MR - amtW - 10, y: oy - 11, size: 11, font: fontB, color: accent });
          page.drawText(trunc(opt.label, fontB, 9.5, CW - amtW - 30), { x: ML + 10, y: oy - 11, size: 9.5, font: fontB, color: C_DARK });

          const detailStr = opt.type === "lump_sum"
            ? (opt.discountPct
                ? `Full payment  ·  ${opt.discountPct}% discount off RM ${grand.toLocaleString("en-MY", { minimumFractionDigits: 2 })}`
                : "Full payment")
            : opt.lastMonth
              ? `Deposit RM ${Number(opt.deposit).toLocaleString("en-MY", { minimumFractionDigits: 2 })}  +  RM ${Number(opt.monthly).toLocaleString("en-MY", { minimumFractionDigits: 2 })}/mo  ×  ${opt.months - 1} months  +  last month RM ${Number(opt.lastMonth).toLocaleString("en-MY", { minimumFractionDigits: 2 })}`
              : `Deposit RM ${Number(opt.deposit).toLocaleString("en-MY", { minimumFractionDigits: 2 })}  +  RM ${Number(opt.monthly).toLocaleString("en-MY", { minimumFractionDigits: 2 })}/mo  ×  ${opt.months} months`;
          page.drawText(trunc(detailStr, fontR, 8, CW - amtW - 32), { x: ML + 10, y: oy - 23, size: 8, font: fontR, color: C_MID });

          if (opt.note) page.drawText(trunc(opt.note, fontR, 7.5, CW - 20), { x: ML + 10, y: oy - 35, size: 7.5, font: fontR, color: C_LITE });
          oy -= optH;
        }
        curY -= boxH;
      }

      // ── Closing message ──────────────────────────────────────────────────
      curY -= 10;
      const closeMsg = "Thank you for the opportunity to present this quotation. We look forward to your valued order. Should you have any enquiries, please do not hesitate to contact us.";
      for (const cl of wrap(closeMsg, fontR, 8, CW - 40)) {
        const clW = fontR.widthOfTextAtSize(cl, 8);
        page.drawText(cl, { x: (W - clW) / 2, y: curY, size: 8, font: fontR, color: C_LITE });
        curY -= 12;
      }

    }
  }

  // ── Catalogue pages ──────────────────────────────────────────────────────
  if (Number(q.includeCatalogue)) {
    const r2ImgBase = process.env.NEXT_PUBLIC_R2_PRODUCT_IMAGES_URL ?? "";

    const codeCount = new Map<string, number>();
    const catItems = items
      .filter(it => !!it.productCode)
      .map(it => {
        const code = it.productCode!;
        const n = (codeCount.get(code) ?? 0) + 1;
        codeCount.set(code, n);
        return { item: it, displayCode: n === 1 ? code : `${code} (${n})` };
      });

    if (catItems.length > 0) {
      const imageCache = new Map<string, PDFImage>();
      for (const { item } of catItems) {
        if (!item.productCode || imageCache.has(item.productCode)) continue;
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

        // Section header — Aura: thin accent rule + large label
        catPage.drawRectangle({ x: 0, y: H - 3, width: W, height: 3, color: accent });
        catPage.drawText("PRODUCT CATALOGUE", {
          x: ML, y: H - 24, size: 14, font: fontB, color: accent,
        });
        if (q.title) {
          catPage.drawText(trunc(q.title, fontB, 8.5, CW / 2), {
            x: ML, y: H - 38, size: 8.5, font: fontR, color: C_MID,
          });
          catPage.drawText(`${q.quotationNo}  ·  ${fmtD(q.createdAt)}`, {
            x: ML, y: H - 50, size: 7, font: fontR, color: C_LITE,
          });
        } else {
          catPage.drawText(`${q.quotationNo}  ·  ${fmtD(q.createdAt)}`, {
            x: ML, y: H - 38, size: 8, font: fontR, color: C_LITE,
          });
        }
        const pgLabel = `Page ${pi + 1} / ${totalCatPgs}`;
        catPage.drawText(pgLabel, {
          x: W - MR - fontR.widthOfTextAtSize(pgLabel, 8),
          y: H - 28, size: 8, font: fontR, color: C_MID,
        });

        // Column header row — Aura: accent text + thin underline, no fill
        const colHdrY = H - CAT_HDR_H - CAT_COLHDR_H;
        hLine(catPage, colHdrY + CAT_COLHDR_H, ML, W - MR, C_LINE, 0.4);
        const colDefs: { label: string; x: number; w: number }[] = [
          { label: "#",               x: ML,                           w: CAT_COL_NO  },
          { label: "Image",           x: ML + CAT_COL_NO,              w: CAT_COL_IMG },
          { label: "Product Details", x: ML + CAT_COL_NO + CAT_COL_IMG, w: CAT_COL_DET },
        ];
        for (const col of colDefs) {
          const tw = fontB.widthOfTextAtSize(col.label, 7);
          catPage.drawText(col.label.toUpperCase(), {
            x: col.x + (col.w - tw) / 2,
            y: colHdrY + 8, size: 7, font: fontB, color: accent,
          });
        }
        catPage.drawLine({ start: { x: ML, y: colHdrY }, end: { x: W - MR, y: colHdrY }, thickness: 1.2, color: accent });

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
          const { item, displayCode } = pageRows[ri];
          const rowY    = rowTopY - CAT_ROW_H;
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

          if (showCode && displayCode) {
            catPage.drawText(trunc(displayCode, fontB, 8, detMaxW), {
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

        hLine(catPage, MB + 22, ML, W - MR, accent, 0.6);
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
