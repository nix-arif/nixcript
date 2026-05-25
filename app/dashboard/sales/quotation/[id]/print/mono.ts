import { getQuotationDetail } from "@/server/quotation";
import { PDFDocument, PDFFont, PDFPage, PDFImage, rgb, StandardFonts } from "pdf-lib";
import {
  drawCompanyHeader, drawInfoSection, estimateHeaderH, estimateInfoH,
  wrap, trunc, fmtD, fmtM, hLine, sanitizeText,
  C_DARK, C_MID, C_LITE, C_LINE, C_WHITE,
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

// ── Pure black/white palette ───────────────────────────────────────────────
const C_BLACK  = rgb(0, 0, 0);
const C_BORDER = rgb(0, 0, 0);          // table borders
const C_HDR_BG = rgb(0, 0, 0);          // table header background
const C_ROW_BG = rgb(1, 1, 1);          // row background (plain white)
const C_TEXT   = rgb(0.10, 0.10, 0.10);
const C_MUTED  = rgb(0.40, 0.40, 0.40);
const C_FAINT  = rgb(0.60, 0.60, 0.60);
const C_GREEN  = rgb(0.09, 0.40, 0.20);
const C_AMBER  = rgb(0.57, 0.25, 0.05);

const TABLE_PAD = 6;

// ── Main export ────────────────────────────────────────────────────────────
export async function generateQuotationMono(data: Data): Promise<Uint8Array> {
  const {
    quotation: q, items,
    orgName, orgLogoUrl, orgBrandColor,
    orgCompanyName, orgCompanyAddress, orgTaxNo, orgPhone,
    orgEmail, orgWebsite, orgOldSsmNo, orgNewSsmNo, orgMdaEstablishmentNo,
    orgBankingInfo,
    orgMofCertUrl, orgSsmCertUrl, orgMdaCertUrl, orgTccCertUrl,
    orgBankStatementUrl, orgLampiran12Url, orgLampiran13Url,
  } = data;

  // Mono ignores brand colour — everything is black
  const accent = C_BLACK;

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
    } catch { /* generate without logo */ }
  }

  // ── Layout settings ───────────────────────────────────────────────────────
  const LOGO_H_MAX = 42;
  const LOGO_W_MAX = 108;

  const showCode  = !!(data.orgShowCodeColumn ?? 1);
  const tfs       = data.orgTableFontSize ?? "normal";
  const FS_DESC   = tfs === "small" ? 8    : tfs === "large" ? 11   : 9.5;
  const FS_DETAIL = tfs === "small" ? 7.5  : tfs === "large" ? 10   : 8.5;
  const FS_CODE   = tfs === "small" ? 7.5  : tfs === "large" ? 10   : 9;
  const FS_NUM    = tfs === "small" ? 7.5  : tfs === "large" ? 9.5  : 8.5;
  const LH        = tfs === "small" ? 10   : tfs === "large" ? 13.5 : 11.5;
  const RH_MIN    = tfs === "small" ? 15   : tfs === "large" ? 21   : 17;
  const MDA_GAP   = 3;

  // ── Column widths ─────────────────────────────────────────────────────────
  const C_NO   = 22;
  const C_CODE = showCode ? 65 : 0;
  const C_QTY  = 28;
  const C_UOM  = 34;
  const C_UP   = 64;
  const C_DISC = showDisc ? 34 : 0;
  const C_TOT  = showTP ? 68 : 0;
  const C_DESCA = CW - C_NO - C_CODE - C_QTY - C_UOM - C_UP - C_DISC - C_TOT;

  const X_NO   = ML;
  const X_CODE = X_NO   + C_NO;
  const X_DESC = X_CODE + C_CODE;
  const X_QTY  = X_DESC + C_DESCA;
  const X_UOM  = X_QTY  + C_QTY;
  const X_UP   = X_UOM  + C_UOM;
  const X_DISC = X_UP   + C_UP;
  const X_TOT  = X_DISC + C_DISC;

  // ── Org name style ────────────────────────────────────────────────────────
  const nameSize  = ({ small: 10, medium: 13, large: 16, xlarge: 20 } as Record<string,number>)[data.orgNameSize ?? "medium"] ?? 13;
  const nameFont  = !!(data.orgNameBold ?? 1) ? fontB : fontR;
  const dispName  = !!(data.orgNameUppercase ?? 0) ? coName.toUpperCase() : coName;
  const hLayout   = data.orgHeaderLayout ?? "standard";
  const QL_SIZE   = ({ small: 5.5, normal: 7, large: 10 } as Record<string,number>)[data.orgQuotationLabelSize ?? "normal"] ?? 7;
  const attnNameSz = ({ small: 10, medium: 13, large: 16, xlarge: 20 } as Record<string,number>)[data.orgAttentionNameSize ?? "medium"] ?? 13;
  const detailFSz  = ({ small: 8, normal: 9, large: 10.5 } as Record<string,number>)[data.orgDetailFontSize ?? "normal"] ?? 9;

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
    const descLines  = wrap(item.description ?? "—", fontR, FS_DESC, C_DESCA - TABLE_PAD * 2);
    const extraLine  = item.hasCert && item.mdaRegNo
      ? `MDA: ${item.mdaRegNo}${item.mdaValidity ? ` · Exp: ${fmtD(item.mdaValidity)}` : ""}`
      : (!item.hasCert ? "No MDA certificate" : null);
    const isGreenRow = !!(item.hasCert && item.mdaRegNo);
    const codeLineH  = !showCode && item.productCode ? CODE_LINE_H : 0;
    const rowH = Math.max(
      RH_MIN,
      codeLineH + descLines.length * LH + (extraLine ? RH_MIN + MDA_GAP + 2 : 6),
    );
    return { item, descLines, extraLine, isGreenRow, rowH };
  });

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

  const totRowCount  = 1 + (showDisc && itemDiscPerSet > 0 ? 2 : 0) + (sets > 1 ? 1 : 0) + (discAmt > 0 ? 3 : 0) + (sstAmt > 0 ? 1 : 0);
  const noteLines    = q.notes ? wrap(q.notes, fontR, 9.5, CW - 20) : [];
  const TOTALS_H     = 16 + totRowCount * 13 + 6 + 1.5 + 10 + 24 + 8;
  const NOTES_H      = q.notes ? noteLines.length * 12 + 30 : 0;
  const FOOTER_BLOCK = 30;
  const CLOSING_H    = 38;
  const BOTTOM_RESERVE = TOTALS_H + NOTES_H + FOOTER_BLOCK + 16 + CLOSING_H;

  const P1_ROW_AVAIL = H - MT - HEADER_BLOCK - DIVIDER_GAP - INFO_BLOCK - DIVIDER_GAP - TABLE_HDR_H - MB - 20;
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

  // Ensure last page fits totals
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
    hLine(page, MB + 22, ML, W - MR, C_BORDER, 0.5);
    page.drawText("Computer generated document. No signature required.", {
      x: ML, y: MB + 10, size: 7.5, font: fontR, color: C_FAINT,
    });
    const pgText = `${q.quotationNo}  ·  Page ${pi + 1} of ${totalPages}`;
    const pgW    = fontR.widthOfTextAtSize(pgText, 7.5);
    page.drawText(pgText, { x: W - MR - pgW, y: MB + 10, size: 7.5, font: fontR, color: C_FAINT });

    let curY = H - MT;

    // ── Page 1: header + info ────────────────────────────────────────────────
    if (isFirst) {
      // Mono: plain header, black text, no accent fill
      drawCompanyHeader({
        page, startY: curY, accent: C_BLACK, fontR, fontB, logoImg,
        companyName: coName, companyAddress: orgCompanyAddress,
        phone: orgPhone, email: orgEmail, website: orgWebsite,
        oldSsmNo: orgOldSsmNo, newSsmNo: orgNewSsmNo,
        mdaEstablishmentNo: orgMdaEstablishmentNo, taxNo: orgTaxNo,
        nameSize, nameBold: !!(data.orgNameBold ?? 1),
        nameUppercase: !!(data.orgNameUppercase ?? 0),
        headerLayout: hLayout, docLabel: "QUOTATION",
        docLabelSize: QL_SIZE, docLabelBold: true,
        nameColor: C_BLACK, labelColor: C_BLACK,
        logoHMax: LOGO_H_MAX, logoWMax: LOGO_W_MAX,
      });
      curY -= HEADER_BLOCK;
      hLine(page, curY, ML, W - MR, C_BLACK, 1.0);
      curY -= DIVIDER_GAP;

      drawInfoSection({
        page, startY: curY, accent: C_BLACK, fontR, fontB, cust,
        attentionNameSize: attnNameSz, attentionNameBold: !!(data.orgAttentionNameBold ?? 1),
        detailFontSize: detailFSz, detailFontBold: !!(data.orgDetailFontBold ?? 0),
        detailAlignment: (data.orgDetailAlignment ?? "right") as "left" | "right",
        textColor: C_MUTED,
        quotationNo: q.quotationNo, createdAt: q.createdAt,
        validUntil: q.validUntil, salesPersonName: q.salesPersonName ?? null,
        preparedByName: q.preparedByName ?? null, title: q.title ?? null,
      });
      curY -= INFO_BLOCK + DIVIDER_GAP;
      hLine(page, curY, ML, W - MR, C_BLACK, 0.5);
      curY -= 4;

    } else {
      // ── Continuation header ──────────────────────────────────────────────
      hLine(page, curY, ML, W - MR, C_BLACK, 1.0);
      page.drawText(`${q.quotationNo} (continued)`, {
        x: ML, y: curY - 18, size: 9, font: fontR, color: C_MUTED,
      });
      page.drawText(`Page ${pi + 1} of ${totalPages}`, {
        x: W - MR - fontR.widthOfTextAtSize(`Page ${pi + 1} of ${totalPages}`, 9),
        y: curY - 18, size: 9, font: fontR, color: C_MUTED,
      });
      curY -= 28;
    }

    // ── Table header — black fill with white text ──────────────────────────
    const thdrs: { label: string; x: number; w: number }[] = [
      { label: "No",          x: X_NO,   w: C_NO   },
      ...(showCode ? [{ label: "Code",       x: X_CODE, w: C_CODE  }] : []),
      { label: "Description", x: X_DESC, w: C_DESCA },
      { label: "Qty",         x: X_QTY,  w: C_QTY  },
      { label: "UOM",         x: X_UOM,  w: C_UOM  },
      { label: "Unit Price",  x: X_UP,   w: C_UP   },
      ...(showDisc ? [{ label: "Disc%",      x: X_DISC, w: C_DISC  }] : []),
      ...(showTP   ? [{ label: "Total",      x: X_TOT,  w: C_TOT   }] : []),
    ];

    const tHdrY = curY - TABLE_HDR_H;
    // Outer border around table header
    page.drawRectangle({ x: ML, y: tHdrY, width: CW, height: TABLE_HDR_H, color: C_HDR_BG });

    for (const col of thdrs) {
      const tw = fontB.widthOfTextAtSize(col.label.toUpperCase(), 7.5);
      const tx = col.x + (col.w - tw) / 2;
      page.drawText(col.label.toUpperCase(), {
        x: tx, y: tHdrY + 6, size: 7.5, font: fontB, color: C_WHITE,
      });
    }

    // Vertical separator lines inside header
    for (const col of thdrs.slice(1)) {
      page.drawLine({
        start: { x: col.x, y: tHdrY },
        end:   { x: col.x, y: tHdrY + TABLE_HDR_H },
        thickness: 0.4, color: rgb(0.3, 0.3, 0.3),
      });
    }

    curY = tHdrY;

    // Draw top outer border line
    page.drawLine({
      start: { x: ML, y: curY + TABLE_HDR_H },
      end:   { x: W - MR, y: curY + TABLE_HDR_H },
      thickness: 0.8, color: C_BORDER,
    });
    // Left border
    page.drawLine({ start: { x: ML, y: curY + TABLE_HDR_H }, end: { x: ML, y: curY }, thickness: 0.8, color: C_BORDER });
    // Right border
    page.drawLine({ start: { x: W - MR, y: curY + TABLE_HDR_H }, end: { x: W - MR, y: curY }, thickness: 0.8, color: C_BORDER });

    // ── Item rows ────────────────────────────────────────────────────────────
    for (const rowIdx of pageItems) {
      const { item, descLines, extraLine, isGreenRow, rowH } = rowInfos[rowIdx];
      const rowY = curY - rowH;

      const textBaseline = curY - 11;

      // Bottom border for each row
      page.drawLine({ start: { x: ML, y: rowY }, end: { x: W - MR, y: rowY }, thickness: 0.3, color: C_BORDER });
      // Left / right outer borders
      page.drawLine({ start: { x: ML, y: rowY }, end: { x: ML, y: curY }, thickness: 0.8, color: C_BORDER });
      page.drawLine({ start: { x: W - MR, y: rowY }, end: { x: W - MR, y: curY }, thickness: 0.8, color: C_BORDER });

      // Vertical separators between columns
      for (const col of thdrs.slice(1)) {
        page.drawLine({
          start: { x: col.x, y: rowY },
          end:   { x: col.x, y: curY },
          thickness: 0.3, color: rgb(0.75, 0.75, 0.75),
        });
      }

      // No
      const noW = fontR.widthOfTextAtSize(String(item.rowNo), FS_NUM);
      page.drawText(String(item.rowNo), {
        x: X_NO + (C_NO - noW) / 2, y: textBaseline,
        size: FS_NUM, font: fontR, color: C_FAINT,
      });

      // Code column or code prefix
      let dy = textBaseline;
      if (showCode) {
        page.drawText(trunc(item.productCode ?? "—", fontR, FS_CODE, C_CODE - TABLE_PAD * 2), {
          x: X_CODE + TABLE_PAD, y: dy, size: FS_CODE, font: fontR, color: C_MUTED,
        });
      } else if (item.productCode) {
        page.drawText(trunc(item.productCode, fontB, FS_CODE - 1, C_DESCA - TABLE_PAD * 2), {
          x: X_DESC + TABLE_PAD, y: dy, size: FS_CODE - 1, font: fontB, color: C_TEXT,
        });
        dy -= CODE_LINE_H;
      }

      // Description + cert line
      for (const line of descLines) {
        page.drawText(line, { x: X_DESC + TABLE_PAD, y: dy, size: FS_DESC, font: fontR, color: C_TEXT });
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
        x: X_QTY + (C_QTY - qtyW) / 2, y: textBaseline, size: FS_DESC, font: fontR, color: C_TEXT,
      });

      // UOM
      const uom  = item.uom || "—";
      const uomW = fontR.widthOfTextAtSize(uom, FS_CODE);
      page.drawText(uom, {
        x: X_UOM + (C_UOM - uomW) / 2, y: textBaseline, size: FS_CODE, font: fontR, color: C_MUTED,
      });

      // Unit Price
      const up  = `RM ${Number(item.unitPrice ?? 0).toFixed(2)}`;
      const upW = fontR.widthOfTextAtSize(up, FS_CODE);
      page.drawText(up, {
        x: X_UP + C_UP - TABLE_PAD - upW, y: textBaseline, size: FS_CODE, font: fontR, color: C_TEXT,
      });

      // Disc%
      if (showDisc) {
        const disc  = Number(item.discountPct ?? 0) > 0 ? `${item.discountPct}%` : "—";
        const discW = fontR.widthOfTextAtSize(disc, FS_CODE);
        page.drawText(disc, {
          x: X_DISC + (C_DISC - discW) / 2, y: textBaseline, size: FS_CODE, font: fontR, color: C_MUTED,
        });
      }

      // Total
      if (showTP) {
        const tot  = `RM ${Number(item.totalPrice ?? 0).toFixed(2)}`;
        const totW = fontB.widthOfTextAtSize(tot, FS_DESC);
        page.drawText(tot, {
          x: X_TOT + C_TOT - TABLE_PAD - totW, y: textBaseline, size: FS_DESC, font: fontB, color: C_TEXT,
        });
      }

      curY = rowY;
    }

    // Close bottom border of table
    page.drawLine({ start: { x: ML, y: curY }, end: { x: W - MR, y: curY }, thickness: 0.8, color: C_BORDER });

    // ── Last page: totals + notes ──────────────────────────────────────────
    if (isLast) {
      curY -= 14;

      // Bank info (left)
      if (bank) {
        let by = curY;
        page.drawText("PAYMENT TO", { x: ML, y: by, size: 7.5, font: fontB, color: C_TEXT });
        by -= 13;
        for (const [lbl, val] of [
          ["Bank", bank.bankName ?? ""],
          ["Account Name", bank.accountHolder ?? ""],
          ["Account No.", bank.accountNo ?? ""],
        ] as [string,string][]) {
          page.drawText(`${lbl}:`, { x: ML, y: by, size: 9, font: fontR, color: C_FAINT });
          page.drawText(trunc(String(val), fontB, 9.5, 170), {
            x: ML + 76, y: by, size: 9.5, font: fontB, color: C_TEXT,
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
        totItems.push([`Discount (${q.overallDiscountPct}%)`, `- ${fmtM(discAmt)}`]);
        totItems.push(["After Discount", fmtM(afterDisc)]);
      }
      if (sstAmt > 0) totItems.push([`SST (${q.sstPct}%)`, fmtM(sstAmt)]);

      for (const [lbl, val] of totItems) {
        page.drawText(lbl, { x: totX, y: ty, size: 9.5, font: fontR, color: C_MUTED });
        const vw = fontR.widthOfTextAtSize(val, 9.5);
        page.drawText(val, { x: W - MR - vw, y: ty, size: 9.5, font: fontR, color: C_TEXT });
        ty -= 13;
      }

      // Separator before grand total
      ty -= 4;
      page.drawLine({ start: { x: totX - 8, y: ty }, end: { x: W - MR, y: ty }, thickness: 1.2, color: C_BLACK });
      ty -= 14;
      page.drawText("Grand Total", { x: totX, y: ty, size: 11, font: fontB, color: C_BLACK });
      const gtAmt  = fmtM(grand);
      const gtAmtW = fontB.widthOfTextAtSize(gtAmt, 12);
      page.drawText(gtAmt, { x: W - MR - gtAmtW, y: ty, size: 12, font: fontB, color: C_BLACK });
      ty -= 4;
      page.drawLine({ start: { x: totX - 8, y: ty }, end: { x: W - MR, y: ty }, thickness: 1.2, color: C_BLACK });

      curY = ty - 20;

      // ── Closing message ──────────────────────────────────────────────────
      curY -= 10;
      const closeMsg = "Thank you for the opportunity to present this quotation. We look forward to your valued order.";
      for (const cl of wrap(closeMsg, fontR, 8, CW - 40)) {
        const clW = fontR.widthOfTextAtSize(cl, 8);
        page.drawText(cl, { x: (W - clW) / 2, y: curY, size: 8, font: fontR, color: C_FAINT });
        curY -= 12;
      }

      // Notes
      if (q.notes) {
        curY -= 6;
        const nl    = wrap(q.notes, fontR, 9.5, CW - 20);
        const noteH = nl.length * 12 + 24;
        // Plain border box, no fill
        page.drawRectangle({
          x: ML, y: curY - noteH, width: CW, height: noteH,
          borderColor: C_BORDER, borderWidth: 0.8,
        });
        page.drawText("NOTES", {
          x: ML + 8, y: curY - 12, size: 7.5, font: fontB, color: C_TEXT,
        });
        let ny = curY - 24;
        for (const line of nl) {
          page.drawText(line, { x: ML + 8, y: ny, size: 9.5, font: fontR, color: C_TEXT });
          ny -= 12;
        }
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
