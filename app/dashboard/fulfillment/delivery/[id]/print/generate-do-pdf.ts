import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import {
  drawCompanyHeader, estimateHeaderH,
  sanitizeText, wrap, trunc, fmtD, fmtM, hLine,
  C_DARK, C_MID, C_LITE, C_LINE,
} from "@/app/dashboard/sales/quotation/[id]/print/_pdf-header";
import type { DoForPdfResult } from "@/server/delivery-order";

// ── A4 ─────────────────────────────────────────────────────────────────────
const W  = 595.28;
const H  = 841.89;
const ML = 32;
const MR = 32;
const MT = 30;
const MB = 30;
const CW = W - ML - MR;

const C_ALT = rgb(0.975, 0.980, 0.988);

// ── Layout constants ────────────────────────────────────────────────────────
const LOGO_H_MAX  = 44;
const LOGO_W_MAX  = 110;
const TABLE_PAD   = 6;
const TABLE_HDR_H = 20;
const FS_DESC     = 9.5;
const FS_CODE     = 9;
const LH          = 11.5;
const RH_MIN      = 17;

export interface DoPdfOptions {
  /** Include unit price / total columns and a grand total. Defaults to false. */
  withPrice?: boolean;
}

function parseHexColor(hex: string | null | undefined) {
  if (!hex) return null;
  const h = hex.replace("#", "");
  if (h.length !== 6) return null;
  return rgb(
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  );
}

export async function generateDeliveryOrderPdf(data: DoForPdfResult, options: DoPdfOptions = {}): Promise<Uint8Array> {
  const { withPrice = false } = options;
  const { order: do_, items, org } = data;

  const accentColor   = parseHexColor(org.brandColor) ?? rgb(0.08, 0.18, 0.36);
  const nameSize      = ({ small: 10, medium: 13, large: 16, xlarge: 20 } as Record<string, number>)[org.orgNameSize ?? "medium"] ?? 13;
  const nameBold      = !!Number(org.orgNameBold ?? 1);
  const nameUppercase = !!Number(org.orgNameUppercase ?? 0);
  const hLayout       = org.headerLayout ?? "standard";

  const pdfDoc = await PDFDocument.create();
  const fontR  = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontB  = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const cust = (do_.customerSnapshot ?? {}) as {
    title?: string; name?: string; organizationName?: string;
    organizationAddress?: string; email?: string; contactNo?: string;
  };

  // ── Column layout ─────────────────────────────────────────────────────────
  const C_NO   = 22;
  const C_CODE = 65;
  const C_QTY  = 34;
  const C_UOM  = 40;
  const C_UP   = withPrice ? 68 : 0;
  const C_TOT  = withPrice ? 72 : 0;
  const C_DESC = CW - C_NO - C_CODE - C_QTY - C_UOM - C_UP - C_TOT;

  const X_NO   = ML;
  const X_CODE = X_NO   + C_NO;
  const X_DESC = X_CODE + C_CODE;
  const X_QTY  = X_DESC + C_DESC;
  const X_UOM  = X_QTY  + C_QTY;
  const X_UP   = X_UOM  + C_UOM;
  const X_TOT  = X_UP   + C_UP;

  // ── Pre-compute row heights ──────────────────────────────────────────────
  type RowInfo = { item: DoForPdfResult["items"][number]; descLines: string[]; rowH: number };
  const rowInfos: RowInfo[] = items.map(item => {
    const descLines = wrap(item.description ?? "—", fontR, FS_DESC, C_DESC - TABLE_PAD * 2);
    const rowH = Math.max(RH_MIN, descLines.length * LH + 6);
    return { item, descLines, rowH };
  });

  const hasAnyPrice = withPrice && items.some((i) => i.totalPrice != null);
  const grandAmt = hasAnyPrice
    ? items.reduce((sum, i) => sum + Number(i.totalPrice ?? 0), 0)
    : null;

  // ── Height estimates ─────────────────────────────────────────────────────
  const HEADER_BLOCK = estimateHeaderH({
    companyAddress: org.companyAddress, phone: org.phone, email: org.email,
    website: org.website, oldSsmNo: org.oldSsmNo, newSsmNo: org.newSsmNo,
    mdaEstablishmentNo: org.mdaEstablishmentNo, taxNo: org.taxNo,
    nameSize, logoHMax: LOGO_H_MAX, logoWMax: LOGO_W_MAX,
    headerLayout: hLayout, logoImg: null, fontR,
  }) + 6;

  const DIVIDER_GAP = 10;

  let infoLeftH = 8 + nameSize + 4;
  if (cust.organizationName) infoLeftH += 12;
  if (cust.organizationAddress) infoLeftH += 33;
  if (do_.deliveryAddress) infoLeftH += 22;
  if (cust.email || cust.contactNo) infoLeftH += 11;
  const detailRowCount = 2 + (do_.salesOrderNo ? 1 : 0) + (do_.customerPoNo ? 1 : 0) + (do_.deliveryDate ? 1 : 0);
  const infoRightH = 8 + detailRowCount * 13;
  const INFO_BLOCK = Math.max(infoLeftH, infoRightH) + 10;

  const noteLines   = do_.notes ? wrap(do_.notes, fontR, 9, CW) : [];
  const TOTALS_H    = hasAnyPrice ? (16 + 13 + 6 + 10 + 24) : 0;
  const NOTES_H     = do_.notes ? noteLines.length * 12 + 20 : 0;
  const FOOTER_H    = 30;
  const BOTTOM_RESERVE = TOTALS_H + NOTES_H + FOOTER_H;

  const P1_ROW_AVAIL = H - MT - HEADER_BLOCK - DIVIDER_GAP - INFO_BLOCK - DIVIDER_GAP - TABLE_HDR_H - MB - BOTTOM_RESERVE;
  const PN_ROW_AVAIL = H - MT - 28 - TABLE_HDR_H - MB - 28;

  // ── Paginate item rows ───────────────────────────────────────────────────
  const pageGroups: number[][] = [];
  let curGroup: number[] = [];
  let used = 0;
  let onFirst = true;

  for (let i = 0; i < rowInfos.length; i++) {
    const rh = rowInfos[i].rowH;
    const avail = onFirst ? Math.max(P1_ROW_AVAIL, RH_MIN * 3) : Math.max(PN_ROW_AVAIL, RH_MIN * 3);
    if (used + rh > avail && curGroup.length > 0) {
      pageGroups.push(curGroup);
      curGroup = [i];
      used = rh;
      onFirst = false;
    } else {
      curGroup.push(i);
      used += rh;
    }
  }
  pageGroups.push(curGroup);

  // Ensure last page has room for totals/notes
  {
    const lastGroup  = pageGroups[pageGroups.length - 1];
    const isFirstPg  = pageGroups.length === 1;
    const lastAvail  = Math.max(isFirstPg ? P1_ROW_AVAIL : PN_ROW_AVAIL, RH_MIN * 3);
    const lastItemsH = lastGroup.reduce((s, i) => s + rowInfos[i].rowH, 0);
    if (lastItemsH + BOTTOM_RESERVE > lastAvail && lastGroup.length > 1) {
      let fitH = 0, splitAt = 0;
      for (const idx of lastGroup) {
        if (fitH + rowInfos[idx].rowH + BOTTOM_RESERVE <= lastAvail) {
          fitH += rowInfos[idx].rowH;
          splitAt++;
        } else break;
      }
      splitAt = Math.max(1, splitAt);
      if (splitAt < lastGroup.length) {
        pageGroups[pageGroups.length - 1] = lastGroup.slice(0, splitAt);
        pageGroups.push(lastGroup.slice(splitAt));
      }
    }
  }

  const totalPages = pageGroups.length;

  // ── Helper: draw table header row ────────────────────────────────────────
  function drawTableHeader(page: ReturnType<typeof pdfDoc.addPage>, y: number): number {
    const tHdrY = y - TABLE_HDR_H;
    const cols: { label: string; x: number; w: number }[] = [
      { label: "NO",          x: X_NO,   w: C_NO   },
      { label: "CODE",        x: X_CODE, w: C_CODE  },
      { label: "DESCRIPTION", x: X_DESC, w: C_DESC  },
      { label: "QTY",         x: X_QTY,  w: C_QTY   },
      { label: "UOM",         x: X_UOM,  w: C_UOM   },
      ...(withPrice ? [
        { label: "UNIT PRICE", x: X_UP,  w: C_UP  },
        { label: "TOTAL",      x: X_TOT, w: C_TOT },
      ] : []),
    ];
    for (const col of cols) {
      const tw = fontB.widthOfTextAtSize(col.label, 7.5);
      const tx = col.x + (col.w - tw) / 2;
      page.drawText(col.label, { x: tx, y: tHdrY + 5, size: 7.5, font: fontB, color: accentColor });
    }
    hLine(page, tHdrY - 1, ML, W - MR, accentColor, 1.5);
    return tHdrY - 2;
  }

  // ── Draw pages ────────────────────────────────────────────────────────────
  for (let pi = 0; pi < pageGroups.length; pi++) {
    const isFirst   = pi === 0;
    const isLast    = pi === pageGroups.length - 1;
    const page      = pdfDoc.addPage([W, H]);
    const pageItems = pageGroups[pi];

    // Footer (every page)
    hLine(page, MB + 22);
    page.drawText("Computer generated document. No signature required.", {
      x: ML, y: MB + 10, size: 7.5, font: fontR, color: C_LITE,
    });
    const pgText = `${do_.doNo}  ·  Page ${pi + 1} of ${totalPages}`;
    const pgW    = fontR.widthOfTextAtSize(pgText, 7.5);
    page.drawText(pgText, { x: W - MR - pgW, y: MB + 10, size: 7.5, font: fontR, color: C_LITE });

    let curY = H - MT;

    if (isFirst) {
      drawCompanyHeader({
        page, startY: curY, accent: accentColor, fontR, fontB, logoImg: null,
        companyName: org.companyName, companyAddress: org.companyAddress,
        phone: org.phone, email: org.email, website: org.website,
        oldSsmNo: org.oldSsmNo, newSsmNo: org.newSsmNo,
        mdaEstablishmentNo: org.mdaEstablishmentNo, taxNo: org.taxNo,
        mofNo: org.mofNo,
        nameSize, nameBold, nameUppercase,
        headerLayout: hLayout,
        docLabel: "DELIVERY ORDER",
        docLabelSize: 14,
        docLabelBold: true,
        docLabelAlign: "right",
        logoHMax: LOGO_H_MAX, logoWMax: LOGO_W_MAX,
      });
      curY -= HEADER_BLOCK;
      hLine(page, curY, ML, W - MR, accentColor, 1.2);
      curY -= DIVIDER_GAP;

      // ── Info section: DELIVER TO | DELIVERY DETAILS ───────────────────────
      const LEFT_W  = CW * 0.55;
      const RIGHT_X = ML + LEFT_W;

      page.drawText("DELIVER TO", { x: ML, y: curY - 8, size: 7, font: fontB, color: accentColor });
      let ly = curY - 21;
      const custName = [cust.title, cust.name].filter(Boolean).join(" ");
      if (custName) {
        page.drawText(trunc(custName, fontB, nameSize, LEFT_W - 8), {
          x: ML, y: ly, size: nameSize, font: fontB, color: C_DARK,
        });
        ly -= nameSize + 4;
      }
      if (cust.organizationName) {
        page.drawText(trunc(cust.organizationName, fontR, 9, LEFT_W - 8), {
          x: ML, y: ly, size: 9, font: fontR, color: C_MID,
        });
        ly -= 12;
      }
      const addrLine = do_.deliveryAddress || cust.organizationAddress;
      if (addrLine) {
        for (const l of wrap(addrLine, fontR, 8.5, LEFT_W - 8).slice(0, 3)) {
          page.drawText(l, { x: ML, y: ly, size: 8.5, font: fontR, color: C_LITE });
          ly -= 11;
        }
      }
      const contactLine = [cust.email, cust.contactNo].filter(Boolean).join("  ·  ");
      if (contactLine) {
        page.drawText(trunc(contactLine, fontR, 8.5, LEFT_W - 8), {
          x: ML, y: ly, size: 8.5, font: fontR, color: C_LITE,
        });
        ly -= 11;
      }

      page.drawText("DELIVERY DETAILS", { x: RIGHT_X, y: curY - 8, size: 7, font: fontB, color: accentColor });
      const detailRows: [string, string][] = [
        ["DO No", do_.doNo],
        ["Date",  fmtD(do_.deliveryDate ?? do_.createdAt)],
        ...(do_.salesOrderNo ? [["Sales Order", do_.salesOrderNo] as [string, string]] : []),
        ...(do_.customerPoNo ? [["Customer PO", do_.customerPoNo] as [string, string]] : []),
        ["Status", (do_.status ?? "DRAFT").toUpperCase()],
      ];
      let ry = curY - 21;
      for (const [lbl, val] of detailRows) {
        page.drawText(`${lbl}:`, { x: RIGHT_X, y: ry, size: 9, font: fontR, color: C_MID });
        const vw = fontB.widthOfTextAtSize(val, 9);
        page.drawText(val, { x: W - MR - vw, y: ry, size: 9, font: fontB, color: C_DARK });
        ry -= 13;
      }

      curY -= INFO_BLOCK + DIVIDER_GAP;
      hLine(page, curY);
      curY -= 4;

    } else {
      page.drawText(`${do_.doNo} (continued)`, {
        x: ML, y: curY - 12, size: 9, font: fontR, color: C_LITE,
      });
      hLine(page, curY - 20);
      curY -= 28;
    }

    // ── Table header ─────────────────────────────────────────────────────
    curY = drawTableHeader(page, curY);

    // ── Item rows ─────────────────────────────────────────────────────────
    for (const rowIdx of pageItems) {
      const { item, descLines, rowH } = rowInfos[rowIdx];
      const rowY = curY - rowH;

      if (rowIdx % 2 === 1) {
        page.drawRectangle({ x: ML, y: rowY, width: CW, height: rowH, color: C_ALT });
      }

      const textBaseline = curY - 11;

      const noStr = String(item.rowNo ?? rowIdx + 1);
      const noW   = fontR.widthOfTextAtSize(noStr, FS_CODE);
      page.drawText(noStr, { x: X_NO + (C_NO - noW) / 2, y: textBaseline, size: FS_CODE, font: fontR, color: C_MID });

      const code = trunc(sanitizeText(item.productCode ?? ""), fontR, FS_CODE, C_CODE - TABLE_PAD * 2);
      page.drawText(code, { x: X_CODE + TABLE_PAD, y: textBaseline, size: FS_CODE, font: fontR, color: C_MID });

      let dy = textBaseline;
      for (const line of descLines) {
        page.drawText(line, { x: X_DESC + TABLE_PAD, y: dy, size: FS_DESC, font: fontR, color: C_DARK });
        dy -= LH;
      }

      const qtyStr = sanitizeText(String(item.qty ?? 0));
      const qtyW   = fontR.widthOfTextAtSize(qtyStr, FS_CODE);
      page.drawText(qtyStr, { x: X_QTY + (C_QTY - qtyW) / 2, y: textBaseline, size: FS_CODE, font: fontR, color: C_DARK });

      const uomStr = trunc(sanitizeText(item.uom ?? "—"), fontR, FS_CODE, C_UOM - 4);
      const uomW   = fontR.widthOfTextAtSize(uomStr, FS_CODE);
      page.drawText(uomStr, { x: X_UOM + (C_UOM - uomW) / 2, y: textBaseline, size: FS_CODE, font: fontR, color: C_DARK });

      if (withPrice) {
        const upStr = item.unitPrice != null ? `RM ${Number(item.unitPrice).toFixed(2)}` : "—";
        const upW   = fontR.widthOfTextAtSize(upStr, FS_CODE);
        page.drawText(upStr, { x: X_UP + C_UP - upW - TABLE_PAD, y: textBaseline, size: FS_CODE, font: fontR, color: C_DARK });

        const totStr = item.totalPrice != null ? `RM ${Number(item.totalPrice).toFixed(2)}` : "—";
        const totW   = fontB.widthOfTextAtSize(totStr, FS_DESC);
        page.drawText(totStr, { x: X_TOT + C_TOT - totW - TABLE_PAD, y: textBaseline, size: FS_DESC, font: fontB, color: C_DARK });
      }

      hLine(page, rowY, ML, W - MR, C_LINE, 0.3);
      curY = rowY;
    }

    // ── Last page: totals + notes ──────────────────────────────────────────
    if (isLast) {
      if (hasAnyPrice) {
        curY -= 8;
        hLine(page, curY, ML, W - MR, C_LINE, 0.6);
        curY -= 16;

        const TOT_W = 200;
        const TOT_X = W - MR - TOT_W;
        const ty = curY;

        page.drawText("GRAND TOTAL", { x: TOT_X, y: ty, size: 12, font: fontB, color: accentColor });
        const gtStr = fmtM(grandAmt ?? 0);
        const gtW   = fontB.widthOfTextAtSize(gtStr, 14);
        page.drawText(gtStr, { x: W - MR - gtW, y: ty - 1, size: 14, font: fontB, color: accentColor });
        curY = ty - 24;
      }

      if (do_.notes) {
        curY -= 8;
        page.drawText("Notes:", { x: ML, y: curY, size: 8, font: fontB, color: C_MID });
        curY -= 12;
        for (const l of noteLines.slice(0, 4)) {
          page.drawText(l, { x: ML, y: curY, size: 9, font: fontR, color: C_LITE });
          curY -= 12;
        }
      }
    }
  }

  return pdfDoc.save();
}
