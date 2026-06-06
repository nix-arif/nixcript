import { PDFDocument, PDFFont, PDFPage, PDFImage, rgb, StandardFonts } from "pdf-lib";
import {
  drawCompanyHeader, estimateHeaderH,
  wrap, trunc, fmtD, fmtM,
  hLine, sanitizeText,
  C_DARK, C_MID, C_LITE, C_LINE, C_WHITE,
} from "@/app/dashboard/sales/quotation/[id]/print/_pdf-header";
import type { getSalesOrderForPrint } from "@/server/sales-order";

type Data = NonNullable<Awaited<ReturnType<typeof getSalesOrderForPrint>>>;

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

export async function generateSalesOrderPdf(data: Data): Promise<Uint8Array> {
  const {
    order: so, items,
    createdByName, submittedByName, approvedByName,
    orgName, orgLogoUrl, orgBrandColor,
    orgCompanyName, orgCompanyAddress, orgTaxNo, orgPhone, orgEmail, orgWebsite,
    orgOldSsmNo, orgNewSsmNo, orgMdaEstablishmentNo,
    orgBankingInfo,
  } = data;

  const DEFAULT_ACCENT = rgb(0.05, 0.14, 0.30);
  const accent  = hexToRgb(orgBrandColor, DEFAULT_ACCENT);
  const coName  = orgCompanyName ?? orgName;
  const cust    = so.customerSnapshot as any;
  const bank    = orgBankingInfo.find((b: any) => b.isPrimary) ?? orgBankingInfo[0] ?? null;

  // ── Multi-customer data ────────────────────────────────────────────────────
  type CustEntry = { name: string; org: string | null; qtNo: string };
  const lqJson = (so.linkedQuotations ?? []) as { id: string; quotationNo: string; customerSnapshot?: { title?: string; name: string; organizationName?: string } | null }[];
  const allCustomers: CustEntry[] = lqJson
    .filter((lq) => lq.customerSnapshot)
    .map((lq) => ({
      name: [lq.customerSnapshot!.title, lq.customerSnapshot!.name].filter(Boolean).join(" "),
      org: lq.customerSnapshot!.organizationName ?? null,
      qtNo: lq.quotationNo,
    }))
    .filter((c) => c.name);
  if (allCustomers.length === 0 && cust) {
    const name = [cust.title, cust.name].filter(Boolean).join(" ");
    if (name) allCustomers.push({ name, org: cust.organizationName ?? null, qtNo: "" });
  }

  // Map quotation id → customer name for item section headers
  const customerByQtId = new Map<string, string>();
  for (const lq of lqJson) {
    if (lq.customerSnapshot) {
      const n = [lq.customerSnapshot.title, lq.customerSnapshot.name].filter(Boolean).join(" ");
      if (n) customerByQtId.set(lq.id, n);
    }
  }

  const subtotal  = Number(so.subtotal ?? 0);
  const discAmt   = Number(so.overallDiscountAmt ?? 0);
  const sstAmt    = Number(so.sst ?? 0);
  const grand     = Number(so.grandTotal ?? 0);
  const afterDisc = subtotal - discAmt;

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

  // ── Column widths ─────────────────────────────────────────────────────────
  const C_NO   = 22;
  const C_CODE = 62;
  const C_QTY  = 28;
  const C_UOM  = 32;
  const C_UP   = 64;
  const C_DISC = 30;
  const C_TOT  = 68;
  const C_DESC = CW - C_NO - C_CODE - C_QTY - C_UOM - C_UP - C_DISC - C_TOT;

  const X_NO   = ML;
  const X_CODE = X_NO   + C_NO;
  const X_DESC = X_CODE + C_CODE;
  const X_QTY  = X_DESC + C_DESC;
  const X_UOM  = X_QTY  + C_QTY;
  const X_UP   = X_UOM  + C_UOM;
  const X_DISC = X_UP   + C_UP;
  const X_TOT  = X_DISC + C_DISC;

  const FS_DESC = 9.5;
  const FS_CODE = 9;
  const FS_NUM  = 8.5;
  const LH      = 11.5;
  const RH_MIN  = 24;

  // ── Pre-compute row entries (items + customer section headers) ───────────
  const SECTION_ROW_H = 16;
  type RowEntry =
    | { kind: "item"; item: typeof items[number]; descLines: string[]; rowH: number }
    | { kind: "section"; label: string; rowH: number };

  const uniqueCustQts = new Set(
    items.filter((i) => i.sourceQuotationId && customerByQtId.has(i.sourceQuotationId)).map((i) => i.sourceQuotationId!),
  );
  const showSections = uniqueCustQts.size > 1;

  const rowEntries: RowEntry[] = [];
  let lastQtId: string | null = null;
  for (const item of items) {
    const qtId = item.sourceQuotationId ?? null;
    if (showSections && qtId !== lastQtId) {
      const label = (qtId ? customerByQtId.get(qtId) : null) ?? "Other items";
      rowEntries.push({ kind: "section", label, rowH: SECTION_ROW_H });
      lastQtId = qtId;
    }
    const descLines = wrap(item.description ?? "—", fontR, FS_DESC, C_DESC - TABLE_PAD * 2);
    const rowH = Math.max(RH_MIN, descLines.length * LH + 10);
    rowEntries.push({ kind: "item", item, descLines, rowH });
  }

  // ── Heights ───────────────────────────────────────────────────────────────
  const QL_BAND_H = 30;
  const HEADER_BLOCK = estimateHeaderH({
    companyAddress: orgCompanyAddress, phone: orgPhone, email: orgEmail,
    website: orgWebsite, oldSsmNo: orgOldSsmNo, newSsmNo: orgNewSsmNo,
    mdaEstablishmentNo: orgMdaEstablishmentNo, taxNo: orgTaxNo,
    nameSize: 13, logoHMax: LOGO_H_MAX, logoWMax: LOGO_W_MAX, headerLayout: "standard",
    logoImg, fontR, skipDocLabel: true, inlineSsmMdaTax: true,
  }) + 6 + QL_BAND_H;

  const DIVIDER_GAP = 18;
  const TABLE_HDR_H = 22;

  // ── Info section heights (CUSTOMER left / SO DETAILS right) ──────────────
  const INFO_FS   = 9;
  const INFO_LH   = INFO_FS + 3;
  const IPAD_T    = 10;
  const IPAD_B    = 8;

  let leftH = IPAD_T + INFO_FS + 6; // "CUSTOMER" label
  if (allCustomers.length > 0) {
    for (let i = 0; i < allCustomers.length; i++) {
      leftH += INFO_FS + 4;                              // name
      if (allCustomers[i].org) leftH += INFO_LH;        // org
      if (allCustomers[i].qtNo) leftH += INFO_LH - 1;   // via ref
      if (i < allCustomers.length - 1) leftH += 6;      // separator gap
    }
  } else {
    leftH += INFO_LH;
  }
  leftH += IPAD_B;

  const detailRowCount = 2 + (so.deliveryDate ? 1 : 0) + (so.deliveryAddress ? 1 : 0) + (so.salesPersonName ? 1 : 0);
  const rightH = IPAD_T + INFO_FS + 6 + detailRowCount * INFO_LH + IPAD_B;
  const INFO_BLOCK = Math.max(leftH, rightH);

  const noteLines = so.notes ? wrap(so.notes, fontR, 9.5, CW - 20) : [];
  const totRowCount = 1 + (discAmt > 0 ? 2 : 0) + (sstAmt > 0 ? 1 : 0);
  const TOTALS_H      = 14 + totRowCount * 13 + 14 + 50 + 16;
  const NOTES_H       = so.notes ? noteLines.length * 12 + 30 : 0;
  const TRAIL_H       = [createdByName, submittedByName, approvedByName].some(Boolean) ? 28 : 0;
  const BOTTOM_RESERVE = TOTALS_H + NOTES_H + TRAIL_H + 32;

  const P1_ROW_AVAIL = H - MB - HEADER_BLOCK - DIVIDER_GAP - INFO_BLOCK - DIVIDER_GAP - TABLE_HDR_H - 20;
  const PN_HDR_H     = 26;
  const PN_ROW_AVAIL = H - ACCENT_BAR_H - PN_HDR_H - TABLE_HDR_H - MB - 20;

  // ── Paginate rows ─────────────────────────────────────────────────────────
  const pageGroups: number[][] = [];
  let curGroup: number[] = [];
  let usedH = 0;
  let firstPage = true;

  for (let i = 0; i < rowEntries.length; i++) {
    const rh    = rowEntries[i].rowH;
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
    const lastItemsH  = lastGroup.reduce((s, i) => s + rowEntries[i].rowH, 0);
    if (lastItemsH + BOTTOM_RESERVE > lastAvail && lastGroup.length > 1) {
      let fitH = 0, splitAt = 0;
      for (const idx of lastGroup) {
        if (fitH + rowEntries[idx].rowH + BOTTOM_RESERVE <= lastAvail) { fitH += rowEntries[idx].rowH; splitAt++; }
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
    const isFirst    = pi === 0;
    const isLast     = pi === pageGroups.length - 1;
    const page       = pdfDoc.addPage([W, H]);
    const pageItems  = pageGroups[pi];

    // ── Footer ────────────────────────────────────────────────────────────
    page.drawRectangle({ x: 0, y: MB + 14, width: W, height: 2, color: accent });
    page.drawText(so.soNo, { x: ML, y: MB + 4, size: 7, font: fontR, color: C_LITE });
    const pgText   = `Page ${pi + 1} of ${totalPages}`;
    const pgCenter = (W - fontR.widthOfTextAtSize(pgText, 7)) / 2;
    page.drawText(pgText, { x: pgCenter, y: MB + 4, size: 7, font: fontR, color: C_LITE });
    page.drawText("Confidential", {
      x: W - MR - fontR.widthOfTextAtSize("Confidential", 7),
      y: MB + 4, size: 7, font: fontR, color: C_LITE,
    });

    let curY = H - MB;

    if (isFirst) {
      // ── Company header ───────────────────────────────────────────────────
      drawCompanyHeader({
        page, startY: H - 15, accent, fontR, fontB, logoImg,
        companyName: coName, companyAddress: orgCompanyAddress,
        phone: orgPhone, email: orgEmail, website: orgWebsite,
        oldSsmNo: orgOldSsmNo, newSsmNo: orgNewSsmNo,
        mdaEstablishmentNo: orgMdaEstablishmentNo, taxNo: orgTaxNo,
        nameSize: 13, nameBold: true, nameUppercase: false,
        headerLayout: "standard", docLabel: "",
        docLabelSize: 7, docLabelBold: true,
        logoHMax: LOGO_H_MAX, logoWMax: LOGO_W_MAX,
        inlineSsmMdaTax: true,
      });
      curY = H - 5 - HEADER_BLOCK;

      // "SALES ORDER" label
      page.drawText("SALES ORDER", {
        x: ML, y: curY + QL_BAND_H - 10,
        size: 16, font: fontB, color: accent,
      });
      // SO number (right-aligned)
      const soNoW = fontB.widthOfTextAtSize(so.soNo, 11);
      page.drawText(so.soNo, {
        x: W - MR - soNoW, y: curY + QL_BAND_H - 10,
        size: 11, font: fontB, color: accent,
      });
      // Date on second line, above the divider
      page.drawText(fmtD(so.createdAt), {
        x: W - MR - fontR.widthOfTextAtSize(fmtD(so.createdAt), 8.5),
        y: curY + 6,
        size: 8.5, font: fontR, color: C_MID,
      });

      hLine(page, curY, ML, W - MR, accent, 1.2);
      curY -= DIVIDER_GAP;

      // ── Info section ──────────────────────────────────────────────────────
      {
        const INFO_LEFT_W  = CW * 0.55;
        const INFO_RIGHT_X = ML + INFO_LEFT_W;
        const INFO_RIGHT_W = CW * 0.45;
        const IPAD_H       = 10;
        const boxTop       = curY + 4;
        const boxH         = INFO_BLOCK + 6;

        // Boxes
        page.drawRectangle({ x: ML, y: boxTop - boxH, width: INFO_LEFT_W - 3, height: boxH, borderColor: accent, borderWidth: 0.6 });
        page.drawRectangle({ x: INFO_RIGHT_X + 3, y: boxTop - boxH, width: INFO_RIGHT_W - 3, height: boxH, borderColor: accent, borderWidth: 0.6 });

        // ── Left: CUSTOMER(S) ────────────────────────────────────────────
        const leftX    = ML + IPAD_H;
        const leftMaxW = INFO_LEFT_W - 3 - IPAD_H * 2;
        let ly = boxTop - IPAD_T - INFO_FS;

        page.drawText(allCustomers.length > 1 ? "CUSTOMERS" : "CUSTOMER", { x: leftX, y: ly, size: INFO_FS, font: fontB, color: accent });
        ly -= INFO_FS + 6;

        if (allCustomers.length > 0) {
          for (let ci = 0; ci < allCustomers.length; ci++) {
            const c = allCustomers[ci];
            page.drawText(trunc(c.name, fontB, INFO_FS, leftMaxW), { x: leftX, y: ly, size: INFO_FS, font: fontB, color: C_DARK });
            ly -= INFO_FS + 4;
            if (c.org) {
              page.drawText(trunc(c.org, fontR, INFO_FS, leftMaxW), { x: leftX, y: ly, size: INFO_FS, font: fontR, color: C_MID });
              ly -= INFO_LH;
            }
            if (c.qtNo) {
              page.drawText(`via ${c.qtNo}`, { x: leftX, y: ly, size: INFO_FS - 1, font: fontR, color: C_LITE });
              ly -= INFO_LH - 1;
            }
            if (ci < allCustomers.length - 1) {
              hLine(page, ly + 3, leftX, leftX + leftMaxW, C_LINE, 0.3);
              ly -= 6;
            }
          }
        } else {
          page.drawText("—", { x: leftX, y: ly, size: INFO_FS, font: fontR, color: C_LITE });
        }

        // ── Right: SALES ORDER DETAILS ────────────────────────────────────
        const rightX    = INFO_RIGHT_X + 3 + IPAD_H;
        const rightMaxW = INFO_RIGHT_W - 3 - IPAD_H * 2;
        const rightEdge = INFO_RIGHT_X + 3 + INFO_RIGHT_W - 3 - IPAD_H;
        let ry = boxTop - IPAD_T - INFO_FS;

        page.drawText("SALES ORDER DETAILS", { x: rightX, y: ry, size: INFO_FS, font: fontB, color: accent });
        ry -= INFO_FS + 6;

        const detailRows: [string, string][] = [
          ["SO No",  so.soNo],
          ["Date",   fmtD(so.createdAt)],
          ...(so.deliveryDate    ? [["Delivery Date",    fmtD(so.deliveryDate)]]    as [string,string][] : []),
          ...(so.deliveryAddress ? [["Delivery Address", so.deliveryAddress]]        as [string,string][] : []),
          ...(so.salesPersonName ? [["Sales Person",     so.salesPersonName]]        as [string,string][] : []),
          ...(createdByName      ? [["Prepared By",      createdByName]]             as [string,string][] : []),
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
      page.drawText(`${so.soNo}  ·  continued`, { x: ML, y: curY - 8, size: 8, font: fontR, color: C_MID });
      curY -= 26;
    }

    // ── Table header ─────────────────────────────────────────────────────────
    const TABLE_HDR_H = 22;
    const tHdrY = curY - TABLE_HDR_H;

    const thdrs = [
      { label: "No",          x: X_NO,   w: C_NO   },
      { label: "Code",        x: X_CODE, w: C_CODE  },
      { label: "Description", x: X_DESC, w: C_DESC  },
      { label: "Qty",         x: X_QTY,  w: C_QTY   },
      { label: "UOM",         x: X_UOM,  w: C_UOM   },
      { label: "Unit Price",  x: X_UP,   w: C_UP    },
      { label: "Disc%",       x: X_DISC, w: C_DISC  },
      { label: "Total",       x: X_TOT,  w: C_TOT   },
    ];
    for (const col of thdrs) {
      const tw = fontB.widthOfTextAtSize(col.label, 7.5);
      const tx = col.x + (col.w - tw) / 2;
      page.drawText(col.label.toUpperCase(), { x: tx, y: tHdrY + 8, size: 7.5, font: fontB, color: accent });
    }
    page.drawRectangle({ x: ML, y: tHdrY, width: CW, height: 1.8, color: accent });
    curY = tHdrY;

    // ── Item rows ─────────────────────────────────────────────────────────────
    const tableTopY = curY + TABLE_HDR_H;
    for (const rowIdx of pageItems) {
      const entry = rowEntries[rowIdx];

      // ── Section header row ───────────────────────────────────────────────
      if (entry.kind === "section") {
        const sY = curY - entry.rowH;
        page.drawRectangle({ x: ML, y: sY, width: CW, height: entry.rowH, color: rgb(0.945, 0.947, 0.958) });
        page.drawRectangle({ x: ML, y: sY, width: 3, height: entry.rowH, color: accent });
        page.drawText(entry.label.toUpperCase(), { x: ML + 8, y: sY + 5, size: 7.5, font: fontB, color: accent });
        curY = sY;
        continue;
      }

      const { item, descLines, rowH } = entry;
      const rowY        = curY - rowH;
      const textBaseline = curY - 11;

      // Row number badge
      const badgeX = X_NO + (C_NO - BADGE_SZ) / 2;
      const badgeY = textBaseline - 3;
      page.drawRectangle({ x: badgeX, y: badgeY, width: BADGE_SZ, height: BADGE_SZ, color: accent });
      const noStr = String(item.rowNo);
      const noW   = fontB.widthOfTextAtSize(noStr, 7);
      page.drawText(noStr, { x: badgeX + (BADGE_SZ - noW) / 2, y: badgeY + 3, size: 7, font: fontB, color: C_WHITE });

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
      const up  = `RM ${Number(item.unitPrice ?? 0).toFixed(2)}`;
      const upW = fontR.widthOfTextAtSize(up, FS_NUM);
      page.drawText(up, { x: X_UP + (C_UP - upW) / 2, y: textBaseline, size: FS_NUM, font: fontR, color: C_MID });

      // Disc%
      const disc  = Number(item.discountPct ?? 0) > 0 ? `${item.discountPct}%` : "—";
      const discW = fontR.widthOfTextAtSize(disc, FS_NUM);
      page.drawText(disc, { x: X_DISC + (C_DISC - discW) / 2, y: textBaseline, size: FS_NUM, font: fontR, color: C_MID });

      // Total
      page.drawRectangle({ x: X_TOT, y: rowY, width: C_TOT, height: rowH, color: rgb(0.965, 0.967, 0.975) });
      const tot  = `RM ${Number(item.totalPrice ?? 0).toFixed(2)}`;
      const totW = fontR.widthOfTextAtSize(tot, FS_DESC);
      page.drawText(tot, { x: X_TOT + (C_TOT - totW) / 2, y: textBaseline, size: FS_DESC, font: fontR, color: C_DARK });

      dashedLine(page, rowY);
      curY = rowY;
    }

    // ── Last page: totals + notes + trail ─────────────────────────────────────
    if (isLast) {
      curY -= 16;
      hLine(page, curY, ML, W - MR, C_LINE, 0.5);
      curY -= 14;

      // Bank info
      if (bank) {
        const bBoxH = 58;
        const bBoxW = CW * 0.46;
        page.drawRectangle({ x: ML, y: curY - bBoxH, width: bBoxW, height: bBoxH, color: rgb(0.955, 0.957, 0.963), borderColor: C_LINE, borderWidth: 0.4 });
        page.drawText("PAYMENT TO", { x: ML + 10, y: curY - 13, size: 6.5, font: fontB, color: accent });
        let by = curY - 28;
        for (const [lbl, val] of [["Bank", bank.bankName ?? ""], ["Account Name", bank.accountHolder ?? ""], ["Account No.", bank.accountNo ?? ""]] as [string, string][]) {
          const lw = fontR.widthOfTextAtSize(`${lbl}: `, 8.5);
          page.drawText(`${lbl}: `, { x: ML + 10, y: by, size: 8.5, font: fontR, color: C_MID });
          page.drawText(trunc(String(val), fontB, 9, bBoxW - lw - 24), { x: ML + 10 + lw, y: by, size: 9, font: fontB, color: C_DARK });
          by -= 13;
        }
      }

      // Totals
      const totColW = 200;
      const totX    = W - MR - totColW;
      let ty        = curY;

      const totItems: [string, string][] = [
        ["Subtotal", fmtM(subtotal)],
        ...(discAmt > 0 ? [
          [`Discount (${so.overallDiscountPct}%)`, `- ${fmtM(discAmt)}`],
          ["After Discount", fmtM(afterDisc)],
        ] as [string, string][] : []),
        ...(sstAmt > 0 ? [[`SST (${so.sstPct}%)`, fmtM(sstAmt)]] as [string, string][] : []),
      ];

      for (const [lbl, val] of totItems) {
        page.drawText(lbl, { x: totX, y: ty, size: 9.5, font: fontR, color: C_MID });
        const vw = fontR.widthOfTextAtSize(val, 9.5);
        page.drawText(val, { x: W - MR - vw, y: ty, size: 9.5, font: fontR, color: C_MID });
        ty -= 13;
      }

      ty -= 8;
      // Dashed separator
      let dx = totX;
      while (dx < W - MR) {
        const end = Math.min(dx + 4, W - MR);
        page.drawLine({ start: { x: dx, y: ty }, end: { x: end, y: ty }, thickness: 0.5, color: accent });
        dx += 7;
      }
      ty -= 14;

      page.drawText("GRAND TOTAL", { x: totX, y: ty, size: 8, font: fontB, color: accent });
      ty -= 22;
      const gtStr = fmtM(grand);
      const gtW   = fontB.widthOfTextAtSize(gtStr, 18);
      page.drawText(gtStr, { x: W - MR - gtW, y: ty, size: 18, font: fontB, color: accent });

      curY = Math.min(curY - 60, ty - 14);

      // Notes
      if (so.notes) {
        curY -= 10;
        const nLines   = wrap(so.notes, fontR, 9.5, CW - 24);
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
      const trailParts: string[] = [];
      if (createdByName)   trailParts.push(`Prepared by: ${createdByName}`);
      if (submittedByName) trailParts.push(`Submitted by: ${submittedByName}`);
      if (approvedByName)  trailParts.push(`Approved by: ${approvedByName}${so.approvedAt ? `  (${fmtD(so.approvedAt)})` : ""}`);
      if (trailParts.length > 0) {
        curY -= 10;
        const trailStr = trailParts.join("    ·    ");
        page.drawText(trunc(sanitizeText(trailStr), fontR, 7.5, CW), {
          x: ML, y: curY, size: 7.5, font: fontR, color: C_LITE,
        });
      }
    }
  }

  return pdfDoc.save();
}
