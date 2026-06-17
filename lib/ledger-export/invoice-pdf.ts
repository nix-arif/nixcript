import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import {
  drawCompanyHeader, estimateHeaderH,
  sanitizeText, wrap, trunc, fmtD, fmtM, hLine,
  C_DARK, C_MID, C_LITE, C_LINE, C_WHITE,
} from "@/app/dashboard/sales/quotation/[id]/print/_pdf-header";

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

// ── Column widths ───────────────────────────────────────────────────────────
const C_NO   = 22;
const C_CODE = 65;
const C_QTY  = 28;
const C_UOM  = 34;
const C_UP   = 68;
const C_TOT  = 72;
const C_DESC = CW - C_NO - C_CODE - C_QTY - C_UOM - C_UP - C_TOT;

const X_NO   = ML;
const X_CODE = X_NO   + C_NO;
const X_DESC = X_CODE + C_CODE;
const X_QTY  = X_DESC + C_DESC;
const X_UOM  = X_QTY  + C_QTY;
const X_UP   = X_UOM  + C_UOM;
const X_TOT  = X_UP   + C_UP;

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

// ── Types ───────────────────────────────────────────────────────────────────

export type InvoiceForPdf = {
  invoiceNo: string;
  invoiceDate: string | Date | null;
  dueDate: string | Date | null;
  status: string | null;
  notes: string | null;
  subtotal: string | null;
  overallDiscountAmt: string | null;
  sstPct: string | null;
  sst: string | null;
  grandTotal: string | null;
  customerSnapshot: {
    title?: string;
    name?: string;
    organizationName?: string;
    organizationAddress?: string;
    email?: string;
    contactNo?: string;
  } | null;
  items: {
    rowNo: number | null;
    productCode: string | null;
    description: string | null;
    qty: string | null;
    uom: string | null;
    unitPrice: string | null;
    totalPrice: string | null;
  }[];
  expenses: {
    description: string | null;
    amount: string | null;
  }[];
};

export type OrgForPdf = {
  companyName: string;
  companyAddress: string | null;
  taxNo: string | null;
  brandColor: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  oldSsmNo: string | null;
  newSsmNo: string | null;
  mdaEstablishmentNo: string | null;
  mofNo: string | null;
  headerLayout: string | null;
  orgNameSize: string | null;
  orgNameBold: number | null;
  orgNameUppercase: number | null;
};

// ── Main generator ──────────────────────────────────────────────────────────

export async function generateInvoicePdf(inv: InvoiceForPdf, org: OrgForPdf): Promise<Uint8Array> {
  const accentColor   = parseHexColor(org.brandColor) ?? rgb(0.08, 0.18, 0.36);
  const nameSize      = ({ small: 10, medium: 13, large: 16, xlarge: 20 } as Record<string, number>)[org.orgNameSize ?? "medium"] ?? 13;
  const nameBold      = !!Number(org.orgNameBold ?? 1);
  const nameUppercase = !!Number(org.orgNameUppercase ?? 0);
  const hLayout       = org.headerLayout ?? "standard";

  const pdfDoc = await PDFDocument.create();
  const fontR  = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontB  = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const cust = inv.customerSnapshot ?? {};

  // ── Pre-compute row heights ──────────────────────────────────────────────
  type RowInfo = { item: InvoiceForPdf["items"][number]; descLines: string[]; rowH: number };
  const rowInfos: RowInfo[] = inv.items.map(item => {
    const descLines = wrap(item.description ?? "—", fontR, FS_DESC, C_DESC - TABLE_PAD * 2);
    const rowH = Math.max(RH_MIN, descLines.length * LH + 6);
    return { item, descLines, rowH };
  });

  // ── Height estimates ─────────────────────────────────────────────────────
  const HEADER_BLOCK = estimateHeaderH({
    companyAddress: org.companyAddress, phone: org.phone, email: org.email,
    website: org.website, oldSsmNo: org.oldSsmNo, newSsmNo: org.newSsmNo,
    mdaEstablishmentNo: org.mdaEstablishmentNo, taxNo: org.taxNo,
    nameSize, logoHMax: LOGO_H_MAX, logoWMax: LOGO_W_MAX,
    headerLayout: hLayout, logoImg: null, fontR,
  }) + 6;

  const DIVIDER_GAP = 10;

  // Info section: left (BILL TO) + right (INVOICE DETAILS)
  let infoLeftH = 8 + nameSize + 4;
  if (cust.organizationName) infoLeftH += 12;
  if (cust.organizationAddress) infoLeftH += 33;
  if (cust.email || cust.contactNo) infoLeftH += 11;
  const detailRowCount = 3 + (inv.dueDate ? 1 : 0);
  const infoRightH = 8 + detailRowCount * 13;
  const INFO_BLOCK = Math.max(infoLeftH, infoRightH) + 10;

  const subtotalAmt = Number(inv.subtotal ?? 0);
  const discAmt     = Number(inv.overallDiscountAmt ?? 0);
  const sstAmt      = Number(inv.sst ?? 0);
  const grandAmt    = Number(inv.grandTotal ?? 0);

  const totRowCount = 1 + (discAmt > 0 ? 1 : 0) + (sstAmt > 0 ? 1 : 0);
  const noteLines   = inv.notes ? wrap(inv.notes, fontR, 9, CW) : [];
  const TOTALS_H    = 16 + totRowCount * 13 + 6 + 10 + 24;
  const NOTES_H     = inv.notes ? noteLines.length * 12 + 20 : 0;
  const FOOTER_H    = 30;
  const BOTTOM_RESERVE = TOTALS_H + NOTES_H + FOOTER_H;

  // Expense rows always appended to last page
  const expRowsH = inv.expenses.length * RH_MIN;

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

  // Ensure last page has room for totals + expenses
  {
    const lastGroup  = pageGroups[pageGroups.length - 1];
    const isFirstPg  = pageGroups.length === 1;
    const lastAvail  = Math.max(isFirstPg ? P1_ROW_AVAIL : PN_ROW_AVAIL, RH_MIN * 3);
    const lastItemsH = lastGroup.reduce((s, i) => s + rowInfos[i].rowH, 0);
    if (lastItemsH + expRowsH + BOTTOM_RESERVE > lastAvail && lastGroup.length > 1) {
      let fitH = 0, splitAt = 0;
      for (const idx of lastGroup) {
        if (fitH + rowInfos[idx].rowH + expRowsH + BOTTOM_RESERVE <= lastAvail) {
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
      { label: "UNIT PRICE",  x: X_UP,   w: C_UP    },
      { label: "TOTAL",       x: X_TOT,  w: C_TOT   },
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
    const pgText = `${inv.invoiceNo}  ·  Page ${pi + 1} of ${totalPages}`;
    const pgW    = fontR.widthOfTextAtSize(pgText, 7.5);
    page.drawText(pgText, { x: W - MR - pgW, y: MB + 10, size: 7.5, font: fontR, color: C_LITE });

    let curY = H - MT;

    if (isFirst) {
      // ── Company header ───────────────────────────────────────────────────
      drawCompanyHeader({
        page, startY: curY, accent: accentColor, fontR, fontB, logoImg: null,
        companyName: org.companyName, companyAddress: org.companyAddress,
        phone: org.phone, email: org.email, website: org.website,
        oldSsmNo: org.oldSsmNo, newSsmNo: org.newSsmNo,
        mdaEstablishmentNo: org.mdaEstablishmentNo, taxNo: org.taxNo,
        mofNo: org.mofNo,
        nameSize, nameBold, nameUppercase,
        headerLayout: hLayout,
        docLabel: "TAX INVOICE",
        docLabelSize: 14,
        docLabelBold: true,
        docLabelAlign: "right",
        logoHMax: LOGO_H_MAX, logoWMax: LOGO_W_MAX,
      });
      curY -= HEADER_BLOCK;
      hLine(page, curY, ML, W - MR, accentColor, 1.2);
      curY -= DIVIDER_GAP;

      // ── Info section: BILL TO | INVOICE DETAILS ──────────────────────────
      const LEFT_W  = CW * 0.55;
      const RIGHT_W = CW * 0.45;
      const RIGHT_X = ML + LEFT_W;

      // Left: BILL TO
      page.drawText("BILL TO", { x: ML, y: curY - 8, size: 7, font: fontB, color: accentColor });
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
      if (cust.organizationAddress) {
        for (const l of wrap(cust.organizationAddress, fontR, 8.5, LEFT_W - 8).slice(0, 3)) {
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

      // Right: INVOICE DETAILS
      page.drawText("INVOICE DETAILS", { x: RIGHT_X, y: curY - 8, size: 7, font: fontB, color: accentColor });
      const detailRows: [string, string][] = [
        ["Invoice No", inv.invoiceNo],
        ["Date",       fmtD(inv.invoiceDate)],
        ...(inv.dueDate ? [["Due Date", fmtD(inv.dueDate)] as [string, string]] : []),
        ["Status",     (inv.status ?? "DRAFT").toUpperCase()],
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
      // Continuation header
      page.drawText(`${inv.invoiceNo} (continued)`, {
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

      // No
      const noStr = String(item.rowNo ?? rowIdx + 1);
      const noW   = fontR.widthOfTextAtSize(noStr, FS_CODE);
      page.drawText(noStr, { x: X_NO + (C_NO - noW) / 2, y: textBaseline, size: FS_CODE, font: fontR, color: C_MID });

      // Code
      const code = trunc(sanitizeText(item.productCode ?? ""), fontR, FS_CODE, C_CODE - TABLE_PAD * 2);
      page.drawText(code, { x: X_CODE + TABLE_PAD, y: textBaseline, size: FS_CODE, font: fontR, color: C_MID });

      // Description (possibly multi-line)
      let dy = textBaseline;
      for (const line of descLines) {
        page.drawText(line, { x: X_DESC + TABLE_PAD, y: dy, size: FS_DESC, font: fontR, color: C_DARK });
        dy -= LH;
      }

      // Qty (center)
      const qtyStr = sanitizeText(String(item.qty ?? 0));
      const qtyW   = fontR.widthOfTextAtSize(qtyStr, FS_CODE);
      page.drawText(qtyStr, { x: X_QTY + (C_QTY - qtyW) / 2, y: textBaseline, size: FS_CODE, font: fontR, color: C_DARK });

      // UOM (center)
      const uomStr = trunc(sanitizeText(item.uom ?? "—"), fontR, FS_CODE, C_UOM - 4);
      const uomW   = fontR.widthOfTextAtSize(uomStr, FS_CODE);
      page.drawText(uomStr, { x: X_UOM + (C_UOM - uomW) / 2, y: textBaseline, size: FS_CODE, font: fontR, color: C_DARK });

      // Unit Price (right-aligned)
      const upStr = `RM ${Number(item.unitPrice ?? 0).toFixed(2)}`;
      const upW   = fontR.widthOfTextAtSize(upStr, FS_CODE);
      page.drawText(upStr, { x: X_UP + C_UP - upW - TABLE_PAD, y: textBaseline, size: FS_CODE, font: fontR, color: C_DARK });

      // Total (right-aligned, bold)
      const totStr = `RM ${Number(item.totalPrice ?? 0).toFixed(2)}`;
      const totW   = fontB.widthOfTextAtSize(totStr, FS_DESC);
      page.drawText(totStr, { x: X_TOT + C_TOT - totW - TABLE_PAD, y: textBaseline, size: FS_DESC, font: fontB, color: C_DARK });

      hLine(page, rowY, ML, W - MR, C_LINE, 0.3);
      curY = rowY;
    }

    // ── Last page: expenses + totals + notes ──────────────────────────────
    if (isLast) {
      // Expense rows (additional charges, shipping, etc.)
      if (inv.expenses.length > 0) {
        for (const exp of inv.expenses) {
          const expDesc = trunc(sanitizeText(exp.description ?? ""), fontR, FS_DESC, C_DESC - TABLE_PAD * 2);
          const textBaseline = curY - 11;
          page.drawText(expDesc, { x: X_DESC + TABLE_PAD, y: textBaseline, size: FS_DESC, font: fontR, color: C_LITE });
          const expAmt  = `RM ${Number(exp.amount ?? 0).toFixed(2)}`;
          const expAmtW = fontR.widthOfTextAtSize(expAmt, FS_CODE);
          page.drawText(expAmt, { x: X_TOT + C_TOT - expAmtW - TABLE_PAD, y: textBaseline, size: FS_CODE, font: fontR, color: C_MID });
          hLine(page, curY - RH_MIN, ML, W - MR, C_LINE, 0.3);
          curY -= RH_MIN;
        }
      }

      curY -= 8;
      hLine(page, curY, ML, W - MR, C_LINE, 0.6);
      curY -= 16;

      // Totals (right-aligned block)
      const TOT_W = 200;
      const TOT_X = W - MR - TOT_W;
      let ty = curY;

      const totRows: [string, string][] = [
        ["Subtotal", fmtM(subtotalAmt)],
      ];
      if (discAmt > 0) totRows.push(["Discount", `- ${fmtM(discAmt)}`]);
      if (sstAmt  > 0) totRows.push([`SST (${inv.sstPct ?? 0}%)`, fmtM(sstAmt)]);

      for (const [lbl, val] of totRows) {
        page.drawText(lbl, { x: TOT_X, y: ty, size: 9.5, font: fontR, color: C_MID });
        const vw = fontR.widthOfTextAtSize(val, 9.5);
        page.drawText(val, { x: W - MR - vw, y: ty, size: 9.5, font: fontR, color: C_DARK });
        ty -= 13;
      }

      ty -= 4;
      hLine(page, ty, TOT_X, W - MR, accentColor, 1.5);
      ty -= 12;

      page.drawText("GRAND TOTAL", { x: TOT_X, y: ty, size: 12, font: fontB, color: accentColor });
      const gtStr = fmtM(grandAmt);
      const gtW   = fontB.widthOfTextAtSize(gtStr, 14);
      page.drawText(gtStr, { x: W - MR - gtW, y: ty - 1, size: 14, font: fontB, color: accentColor });
      curY = ty - 24;

      // Notes
      if (inv.notes) {
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
