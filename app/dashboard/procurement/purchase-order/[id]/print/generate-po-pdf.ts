import { PDFDocument, PDFFont, PDFPage, PDFImage, rgb, StandardFonts } from "pdf-lib";
import {
  drawCompanyHeader, estimateHeaderH,
  wrap, trunc, fmtD,
  hLine, sanitizeText,
  C_DARK, C_MID, C_LITE, C_LINE, C_WHITE,
} from "@/app/dashboard/sales/quotation/[id]/print/_pdf-header";
import type { getPoForPrint } from "@/server/purchase-order";

type Data = NonNullable<Awaited<ReturnType<typeof getPoForPrint>>>;

export interface PoPdfOptions {
  /** Include a product-image column in the items table. Defaults to false. */
  withImages?: boolean;
  /**
   * Image bytes keyed by item rowNo.
   * Only used when withImages is true.
   * Values may be JPEG or PNG — the caller must know which format.
   */
  itemImages?: Map<number, { bytes: Uint8Array; format: "jpg" | "png" }>;
}

// ── A4 dimensions & margins ────────────────────────────────────────────────
const W  = 595.28;
const H  = 841.89;
const ML = 36;
const MR = 36;
const MB = 30;
const CW = W - ML - MR;

// ── Layout constants ───────────────────────────────────────────────────────
const ACCENT_BAR_H = 5;
const LOGO_H_MAX   = 50;
const LOGO_W_MAX   = 110;
const TABLE_PAD    = 6;
const BADGE_SZ     = 13;

function hexToRgb(hex: string | null | undefined, fallback: ReturnType<typeof rgb>) {
  if (!hex) return fallback;
  const h = hex.replace("#", "");
  if (h.length !== 6) return fallback;
  return rgb(
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  );
}

function dashedLine(page: PDFPage, y: number, x1 = ML, x2 = W - MR) {
  const dashLen = 4, gap = 3;
  let x = x1;
  while (x < x2) {
    const end = Math.min(x + dashLen, x2);
    page.drawLine({ start: { x, y }, end: { x: end, y }, thickness: 0.5, color: rgb(0.86, 0.86, 0.86) });
    x += dashLen + gap;
  }
}

export async function generatePurchaseOrderPdf(data: Data, options: PoPdfOptions = {}): Promise<Uint8Array> {
  const { withImages = false, itemImages = new Map() } = options;

  const {
    order: po, items,
    createdByName, salesOrderNo,
    orgName, orgLogoUrl, orgBrandColor,
    orgCompanyName, orgCompanyAddress, orgTaxNo, orgPhone, orgEmail, orgWebsite,
    orgOldSsmNo, orgNewSsmNo, orgMdaEstablishmentNo,
    orgPdfTemplate, orgHeaderLayout, orgTableRowStyle, orgTableFontSize, orgNameSize,
  } = data;

  const poNoDisplay = po.poNo ?? po.prNo ?? "";

  const DEFAULT_ACCENT = rgb(0.05, 0.14, 0.30);
  const accent  = hexToRgb(orgBrandColor, DEFAULT_ACCENT);
  const coName  = orgCompanyName ?? orgName;
  const snap    = po.supplierSnapshot as any;

  const currency = po.currency ?? "MYR";
  const fmtC = (v: string | number | null | undefined) =>
    `${currency} ${Number(v ?? 0).toLocaleString("en-MY", { minimumFractionDigits: 2 })}`;

  const subtotal = Number(po.subtotal ?? 0);
  const sstAmt   = Number(po.sst ?? 0);
  const grand    = Number(po.grandTotal ?? 0);

  // ── Template-driven style parameters ─────────────────────────────────────
  const tpl         = orgPdfTemplate ?? "affirma";
  const hLayout     = orgHeaderLayout ?? "standard";
  const rowStyle    = orgTableRowStyle ?? "default";
  const tfs         = orgTableFontSize ?? "normal";
  const nameSize    = ({ small: 10, medium: 13, large: 16, xlarge: 20 } as Record<string, number>)[orgNameSize ?? "medium"] ?? 13;

  // Table header rendering style per template
  // "filled-dark"  — nexus/mono: dark accent band, white labels
  // "accent-line"  — ember/affirma/aura: accent underline only, no band
  // "shaded-band"  — zinc/slate: light grey band, accent labels
  const tHdrStyle: "filled-dark" | "accent-line" | "shaded-band" =
    ["nexus", "nexus-ocean", "nexus-wine", "mono"].includes(tpl) ? "filled-dark" :
    ["ember", "affirma", "aura"].includes(tpl)                   ? "accent-line" :
    "shaded-band"; // zinc, slate, default

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
    } catch { /* no logo */ }
  }

  // ── Pre-embed item images ─────────────────────────────────────────────────
  const embeddedItemImgs = new Map<number, PDFImage>();
  if (withImages) {
    for (const [rowNo, img] of itemImages.entries()) {
      try {
        const embedded = img.format === "png"
          ? await pdfDoc.embedPng(img.bytes)
          : await pdfDoc.embedJpg(img.bytes);
        embeddedItemImgs.set(rowNo, embedded);
      } catch { /* skip bad image */ }
    }
  }

  // ── Column widths ─────────────────────────────────────────────────────────
  const C_NO   = 22;
  const C_IMG  = withImages ? 126 : 0;   // image column (0 when disabled)
  const C_CODE = 62;
  const C_QTY  = 32;
  const C_UOM  = 36;
  const C_UP   = 72;
  const C_TOT  = 76;
  const C_DESC = CW - C_NO - C_IMG - C_CODE - C_QTY - C_UOM - C_UP - C_TOT;

  const X_NO   = ML;
  const X_IMG  = X_NO   + C_NO;
  const X_CODE = X_IMG  + C_IMG;
  const X_DESC = X_CODE + C_CODE;
  const X_QTY  = X_DESC + C_DESC;
  const X_UOM  = X_QTY  + C_QTY;
  const X_UP   = X_UOM  + C_UOM;
  const X_TOT  = X_UP   + C_UP;

  const FS_DESC = tfs === "small" ? 8   : tfs === "large" ? 11   : 9.5;
  const FS_CODE = tfs === "small" ? 7.5 : tfs === "large" ? 10   : 9;
  const FS_NUM  = tfs === "small" ? 7.5 : tfs === "large" ? 9.5  : 8.5;
  const LH      = tfs === "small" ? 10  : tfs === "large" ? 13.5 : 11.5;
  // Minimum row height: taller when images are shown so the thumbnail fits
  const IMG_SZ  = 108;
  const RH_MIN  = withImages ? IMG_SZ + 12 : 24;

  // ── Pre-compute row heights ───────────────────────────────────────────────
  type RowInfo = { item: typeof items[number]; descLines: string[]; rowH: number };
  const rowInfos: RowInfo[] = items.map(item => {
    const descLines = wrap(item.description ?? "—", fontR, FS_DESC, C_DESC - TABLE_PAD * 2);
    const rowH = Math.max(RH_MIN, descLines.length * LH + 10);
    return { item, descLines, rowH };
  });

  // ── Heights ───────────────────────────────────────────────────────────────
  const QL_BAND_H = 30;
  const HEADER_BLOCK = estimateHeaderH({
    companyAddress: orgCompanyAddress, phone: orgPhone, email: orgEmail,
    website: orgWebsite, oldSsmNo: orgOldSsmNo, newSsmNo: orgNewSsmNo,
    mdaEstablishmentNo: orgMdaEstablishmentNo, taxNo: orgTaxNo,
    nameSize, logoHMax: LOGO_H_MAX, logoWMax: LOGO_W_MAX, headerLayout: hLayout,
    logoImg, fontR, skipDocLabel: true, inlineSsmMdaTax: true,
  }) + 6 + QL_BAND_H;

  const DIVIDER_GAP  = 18;
  const TABLE_HDR_H  = 22;
  const INFO_FS      = 9;
  const INFO_LH      = INFO_FS + 3;
  const IPAD_T       = 10;
  const IPAD_B       = 8;

  let leftH = IPAD_T + INFO_FS + 6;
  if (snap) {
    if (snap.name) leftH += INFO_FS + 4;
    if (snap.registrationNo) leftH += INFO_LH;
    if (snap.contactPerson) leftH += INFO_LH;
    if (snap.address) leftH += INFO_LH * 2;
    if (snap.email || snap.contactNo) leftH += INFO_LH;
  } else { leftH += INFO_LH; }
  leftH += IPAD_B;

  const detailRowCount = 2
    + (po.expectedDeliveryDate ? 1 : 0)
    + (salesOrderNo ? 1 : 0)
    + (po.deliveryAddress ? 1 : 0);
  const rightH = IPAD_T + INFO_FS + 6 + detailRowCount * INFO_LH + IPAD_B;
  const INFO_BLOCK = Math.max(leftH, rightH);

  const noteLines = po.notes ? wrap(po.notes, fontR, 9.5, CW - 24) : [];
  const totRowCount = 1 + (sstAmt > 0 ? 1 : 0);
  const TOTALS_H       = 14 + totRowCount * 13 + 14 + 50 + 16;
  const NOTES_H        = po.notes ? noteLines.length * 12 + 30 : 0;
  const TRAIL_H        = createdByName ? 28 : 0;
  const BOTTOM_RESERVE = TOTALS_H + NOTES_H + TRAIL_H + 32;

  const P1_ROW_AVAIL = H - MB - HEADER_BLOCK - DIVIDER_GAP - INFO_BLOCK - DIVIDER_GAP - TABLE_HDR_H - 20;
  const PN_HDR_H     = 26;
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
  if (curGroup.length > 0 || pageGroups.length === 0) pageGroups.push(curGroup);

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

    // ── Footer ────────────────────────────────────────────────────────────
    page.drawRectangle({ x: 0, y: MB + 14, width: W, height: 2, color: accent });
    page.drawText(poNoDisplay, { x: ML, y: MB + 4, size: 7, font: fontR, color: C_LITE });
    const pgText   = `Page ${pi + 1} of ${totalPages}`;
    const pgCenter = (W - fontR.widthOfTextAtSize(pgText, 7)) / 2;
    page.drawText(pgText, { x: pgCenter, y: MB + 4, size: 7, font: fontR, color: C_LITE });
    page.drawText("Confidential", {
      x: W - MR - fontR.widthOfTextAtSize("Confidential", 7),
      y: MB + 4, size: 7, font: fontR, color: C_LITE,
    });

    let curY = H - MB;

    if (isFirst) {
      // ── Company header ─────────────────────────────────────────────────
      drawCompanyHeader({
        page, startY: H - 15, accent, fontR, fontB, logoImg,
        companyName: coName, companyAddress: orgCompanyAddress,
        phone: orgPhone, email: orgEmail, website: orgWebsite,
        oldSsmNo: orgOldSsmNo, newSsmNo: orgNewSsmNo,
        mdaEstablishmentNo: orgMdaEstablishmentNo, taxNo: orgTaxNo,
        nameSize, nameBold: true, nameUppercase: false,
        headerLayout: hLayout, docLabel: "",
        docLabelSize: 7, docLabelBold: true,
        logoHMax: LOGO_H_MAX, logoWMax: LOGO_W_MAX,
        inlineSsmMdaTax: true,
      });
      curY = H - 5 - HEADER_BLOCK;

      // "PURCHASE ORDER" label
      page.drawText("PURCHASE ORDER", {
        x: ML, y: curY + QL_BAND_H - 22,
        size: 16, font: fontB, color: accent,
      });
      const poNoW = fontB.widthOfTextAtSize(poNoDisplay, 11);
      page.drawText(poNoDisplay, {
        x: W - MR - poNoW, y: curY + QL_BAND_H - 22,
        size: 11, font: fontB, color: accent,
      });
      hLine(page, curY, ML, W - MR, accent, 1.2);
      page.drawText(fmtD(po.createdAt), {
        x: W - MR - fontR.widthOfTextAtSize(fmtD(po.createdAt), 8.5),
        y: curY - 10,
        size: 8.5, font: fontR, color: C_MID,
      });
      curY -= DIVIDER_GAP;

      // ── Info section ─────────────────────────────────────────────────────
      {
        const INFO_LEFT_W  = CW * 0.55;
        const INFO_RIGHT_X = ML + INFO_LEFT_W;
        const INFO_RIGHT_W = CW * 0.45;
        const IPAD_H       = 10;
        const boxTop       = curY + 4;
        const boxH         = INFO_BLOCK + 6;

        page.drawRectangle({ x: ML, y: boxTop - boxH, width: INFO_LEFT_W - 3, height: boxH, borderColor: accent, borderWidth: 0.6 });
        page.drawRectangle({ x: INFO_RIGHT_X + 3, y: boxTop - boxH, width: INFO_RIGHT_W - 3, height: boxH, borderColor: accent, borderWidth: 0.6 });

        const leftX    = ML + IPAD_H;
        const leftMaxW = INFO_LEFT_W - 3 - IPAD_H * 2;
        let ly = boxTop - IPAD_T - INFO_FS;

        page.drawText("SUPPLIER", { x: leftX, y: ly, size: INFO_FS, font: fontB, color: accent });
        ly -= INFO_FS + 6;

        if (snap) {
          if (snap.name) {
            page.drawText(trunc(snap.name, fontB, INFO_FS, leftMaxW), { x: leftX, y: ly, size: INFO_FS, font: fontB, color: C_DARK });
            ly -= INFO_FS + 4;
          }
          if (snap.registrationNo) {
            page.drawText(trunc(`Reg: ${snap.registrationNo}`, fontR, INFO_FS, leftMaxW), { x: leftX, y: ly, size: INFO_FS, font: fontR, color: C_MID });
            ly -= INFO_LH;
          }
          if (snap.contactPerson) {
            page.drawText(trunc(snap.contactPerson, fontR, INFO_FS, leftMaxW), { x: leftX, y: ly, size: INFO_FS, font: fontR, color: C_MID });
            ly -= INFO_LH;
          }
          if (snap.address) {
            for (const line of wrap(snap.address, fontR, INFO_FS, leftMaxW).slice(0, 2)) {
              page.drawText(line, { x: leftX, y: ly, size: INFO_FS, font: fontR, color: C_LITE });
              ly -= INFO_LH;
            }
          }
          if (snap.email || snap.contactNo) {
            const contact = [snap.email, snap.contactNo].filter(Boolean).join("  ·  ");
            page.drawText(trunc(contact, fontR, INFO_FS, leftMaxW), { x: leftX, y: ly, size: INFO_FS, font: fontR, color: C_LITE });
          }
        } else {
          page.drawText("—", { x: leftX, y: ly, size: INFO_FS, font: fontR, color: C_LITE });
        }

        const rightX    = INFO_RIGHT_X + 3 + IPAD_H;
        const rightMaxW = INFO_RIGHT_W - 3 - IPAD_H * 2;
        const rightEdge = INFO_RIGHT_X + 3 + INFO_RIGHT_W - 3 - IPAD_H;
        let ry = boxTop - IPAD_T - INFO_FS;

        page.drawText("PURCHASE ORDER DETAILS", { x: rightX, y: ry, size: INFO_FS, font: fontB, color: accent });
        ry -= INFO_FS + 6;

        const detailRows: [string, string][] = [
          ["PO No",  poNoDisplay],
          ["Date",   fmtD(po.createdAt)],
          ...(po.expectedDeliveryDate ? [["Expected Delivery", fmtD(po.expectedDeliveryDate)]] as [string, string][] : []),
          ...(salesOrderNo            ? [["Linked SO",         salesOrderNo]]                   as [string, string][] : []),
          ...(po.deliveryAddress      ? [["Delivery Address",  po.deliveryAddress]]              as [string, string][] : []),
        ];

        for (const [lbl, val] of detailRows) {
          const lblStr = `${lbl}:`;
          page.drawText(lblStr, { x: rightX, y: ry, size: INFO_FS, font: fontR, color: C_MID });
          const valStr = trunc(val, fontB, INFO_FS, rightMaxW * 0.58);
          const valW   = fontB.widthOfTextAtSize(valStr, INFO_FS);
          page.drawText(valStr, { x: rightEdge - valW, y: ry, size: INFO_FS, font: fontB, color: C_DARK });
          ry -= INFO_LH;
        }
      }

      curY -= INFO_BLOCK + DIVIDER_GAP;
      hLine(page, curY);
      curY -= 10;

    } else {
      // ── Continuation header ───────────────────────────────────────────────
      page.drawRectangle({ x: 0, y: H - ACCENT_BAR_H, width: W, height: ACCENT_BAR_H, color: accent });
      curY = H - ACCENT_BAR_H - 10;
      page.drawText(`${poNoDisplay}  ·  continued`, { x: ML, y: curY - 8, size: 8, font: fontR, color: C_MID });
      curY -= 26;
    }

    // ── Table header ──────────────────────────────────────────────────────────
    const tHdrY = curY - TABLE_HDR_H;

    // Band background
    if (tHdrStyle === "filled-dark") {
      page.drawRectangle({ x: ML, y: tHdrY, width: CW, height: TABLE_HDR_H, color: accent });
    } else if (tHdrStyle === "shaded-band") {
      page.drawRectangle({ x: ML, y: tHdrY, width: CW, height: TABLE_HDR_H, color: rgb(0.96, 0.965, 0.975) });
    }
    // "accent-line" — no band fill, label text + underline only

    const labelColor = tHdrStyle === "filled-dark" ? C_WHITE : accent;

    const thdrs = [
      { label: "No",          x: X_NO,   w: C_NO   },
      ...(withImages ? [{ label: "Image", x: X_IMG, w: C_IMG }] : []),
      { label: "Code",        x: X_CODE, w: C_CODE  },
      { label: "Description", x: X_DESC, w: C_DESC  },
      { label: "Qty",         x: X_QTY,  w: C_QTY   },
      { label: "UOM",         x: X_UOM,  w: C_UOM   },
      { label: "Unit Price",  x: X_UP,   w: C_UP    },
      { label: "Total",       x: X_TOT,  w: C_TOT   },
    ];
    for (const col of thdrs) {
      const tw = fontB.widthOfTextAtSize(col.label, 7.5);
      const tx = col.x + (col.w - tw) / 2;
      page.drawText(col.label.toUpperCase(), { x: tx, y: tHdrY + 8, size: 7.5, font: fontB, color: labelColor });
    }
    // Bottom rule (all styles)
    page.drawRectangle({ x: ML, y: tHdrY, width: CW, height: tHdrStyle === "filled-dark" ? 0 : 1.8, color: accent });
    curY = tHdrY;

    // ── Item rows ──────────────────────────────────────────────────────────────
    for (const rowIdx of pageItems) {
      const { item, descLines, rowH } = rowInfos[rowIdx];
      const rowY         = curY - rowH;
      const textBaseline = curY - 11;

      // Alternate row tint (skip for "simple" row style)
      if (rowIdx % 2 === 1 && rowStyle !== "simple") {
        page.drawRectangle({ x: ML, y: rowY, width: CW, height: rowH, color: rgb(0.975, 0.977, 0.983) });
      }

      // Row number badge
      const badgeX = X_NO + (C_NO - BADGE_SZ) / 2;
      const badgeY = textBaseline - 3;
      page.drawRectangle({ x: badgeX, y: badgeY, width: BADGE_SZ, height: BADGE_SZ, color: accent });
      const noStr = String(item.rowNo);
      const noW   = fontB.widthOfTextAtSize(noStr, 7);
      page.drawText(noStr, { x: badgeX + (BADGE_SZ - noW) / 2, y: badgeY + 3, size: 7, font: fontB, color: C_WHITE });

      // ── Product image ────────────────────────────────────────────────────
      if (withImages && C_IMG > 0) {
        const img = embeddedItemImgs.get(item.rowNo);
        const IMG_TOP_PAD = 6;
        if (img) {
          const scale = Math.min(IMG_SZ / img.height, IMG_SZ / img.width, 1);
          const iw = img.width  * scale;
          const ih = img.height * scale;
          page.drawImage(img, {
            x: X_IMG + (C_IMG - iw) / 2, y: curY - IMG_TOP_PAD - ih,
            width: iw, height: ih,
          });
        } else {
          // Placeholder box when no image
          const bx = X_IMG + (C_IMG - IMG_SZ) / 2;
          const by = curY - IMG_TOP_PAD - IMG_SZ;
          page.drawRectangle({
            x: bx, y: by, width: IMG_SZ, height: IMG_SZ,
            color: rgb(0.95, 0.95, 0.95), borderColor: C_LINE, borderWidth: 0.5,
          });
        }
      }

      // Code
      page.drawText(trunc(item.productCode ?? "—", fontB, FS_CODE, C_CODE - TABLE_PAD), {
        x: X_CODE + TABLE_PAD, y: textBaseline, size: FS_CODE, font: fontB, color: accent,
      });

      // Description
      let dy = textBaseline;
      for (const line of descLines) {
        page.drawText(line, { x: X_DESC + TABLE_PAD, y: dy, size: FS_DESC, font: fontR, color: C_DARK });
        dy -= LH;
      }

      // Qty
      const qtyW = fontR.widthOfTextAtSize(String(item.qty ?? 0), FS_DESC);
      page.drawText(String(item.qty ?? 0), { x: X_QTY + (C_QTY - qtyW) / 2, y: textBaseline, size: FS_DESC, font: fontR, color: C_DARK });

      // UOM
      const uomStr = item.uom || "—";
      const uomW   = fontR.widthOfTextAtSize(uomStr, FS_CODE);
      page.drawText(uomStr, { x: X_UOM + (C_UOM - uomW) / 2, y: textBaseline, size: FS_CODE, font: fontR, color: C_MID });

      // Unit price
      page.drawRectangle({ x: X_UP, y: rowY, width: 2, height: rowH, color: rgb(0.88, 0.90, 0.95) });
      const up  = fmtC(item.unitPrice);
      const upW = fontR.widthOfTextAtSize(up, FS_NUM);
      page.drawText(up, { x: X_UP + (C_UP - upW) / 2, y: textBaseline, size: FS_NUM, font: fontR, color: C_MID });

      // Total
      page.drawRectangle({ x: X_TOT, y: rowY, width: C_TOT, height: rowH, color: rgb(0.965, 0.967, 0.975) });
      const tot  = fmtC(item.totalPrice);
      const totW = fontR.widthOfTextAtSize(tot, FS_DESC);
      page.drawText(tot, { x: X_TOT + (C_TOT - totW) / 2, y: textBaseline, size: FS_DESC, font: fontR, color: C_DARK });

      dashedLine(page, rowY);
      curY = rowY;
    }

    // ── Last page: totals + notes + trail ──────────────────────────────────────
    if (isLast) {
      curY -= 16;
      hLine(page, curY, ML, W - MR, C_LINE, 0.5);
      curY -= 14;

      // Totals
      const totColW = 200;
      const totX    = W - MR - totColW;
      let ty        = curY;

      const totItems: [string, string][] = [
        ["Subtotal", fmtC(subtotal)],
        ...(sstAmt > 0 ? [[`SST (${po.sstPct}%)`, fmtC(sstAmt)]] as [string, string][] : []),
      ];

      for (const [lbl, val] of totItems) {
        page.drawText(lbl, { x: totX, y: ty, size: 9.5, font: fontR, color: C_MID });
        const vw = fontR.widthOfTextAtSize(val, 9.5);
        page.drawText(val, { x: W - MR - vw, y: ty, size: 9.5, font: fontR, color: C_MID });
        ty -= 13;
      }

      ty -= 8;
      let dx = totX;
      while (dx < W - MR) {
        const end = Math.min(dx + 4, W - MR);
        page.drawLine({ start: { x: dx, y: ty }, end: { x: end, y: ty }, thickness: 0.5, color: accent });
        dx += 7;
      }
      ty -= 14;

      page.drawText("GRAND TOTAL", { x: totX, y: ty, size: 8, font: fontB, color: accent });
      ty -= 22;
      const gtStr = fmtC(grand);
      const gtW   = fontB.widthOfTextAtSize(gtStr, 18);
      page.drawText(gtStr, { x: W - MR - gtW, y: ty, size: 18, font: fontB, color: accent });

      curY = Math.min(curY - 60, ty - 14);

      // Notes
      if (po.notes) {
        curY -= 10;
        const nLines   = wrap(po.notes, fontR, 9.5, CW - 24);
        const noteBoxH = nLines.length * 12 + 26;
        page.drawRectangle({ x: ML, y: curY - noteBoxH, width: CW, height: noteBoxH, color: rgb(0.955, 0.957, 0.963), borderColor: C_LINE, borderWidth: 0.4 });
        page.drawRectangle({ x: ML, y: curY - noteBoxH, width: 3, height: noteBoxH, color: accent });
        page.drawText("NOTES", { x: ML + 10, y: curY - 12, size: 7, font: fontB, color: accent });
        let ny = curY - 26;
        for (const line of nLines) {
          page.drawText(line, { x: ML + 10, y: ny, size: 9.5, font: fontR, color: C_DARK });
          ny -= 12;
        }
        curY -= noteBoxH + 10;
      }

      // Approval trail
      if (createdByName) {
        curY -= 10;
        const trailStr = `Prepared by: ${createdByName}`;
        page.drawText(trunc(sanitizeText(trailStr), fontR, 7.5, CW), {
          x: ML, y: curY, size: 7.5, font: fontR, color: C_LITE,
        });
      }
    }
  }

  return pdfDoc.save();
}
