import { PDFDocument, rgb, StandardFonts, degrees } from "pdf-lib";
import { isDraftDoNo } from "@/lib/delivery/draft-no";
import {
  drawCompanyHeader, estimateHeaderH,
  sanitizeText, wrap, trunc, fmtD, fmtM, hLine,
  C_DARK, C_MID, C_LITE, C_LINE,
} from "@/app/dashboard/sales/quotation/[id]/print/_pdf-header";
import type { DoForPdfItem, DoForPdfResult } from "@/server/delivery-order";
import { appendMdaCertPages } from "@/lib/mda/cert-pages";

const C_RED = rgb(0.75, 0.1, 0.1);

// Shown in the Terms & Notes box when the company hasn't set its own
// (Organization → Document Settings → Table → Delivery order)
const DEFAULT_DO_TERMS = [
  "Goods sold are not returnable or exchangeable.",
  "Please check the goods upon delivery and report any shortage or damage within 7 days.",
];

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
  /**
   * Case DO copies. "customer": only items with a valid MDA registration, each
   * with its MDA number, plus the MDA certificates appended — items without
   * one can't be given to the customer. "internal": every item, flagged, for
   * the inventory record. Omitted = the plain delivery order.
   */
  copy?: "customer" | "internal";
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
  const { withPrice = false, copy } = options;
  const { order: do_, org } = data;
  const isCase = !!do_.isCaseDo && !!copy;
  const internal = isCase && copy === "internal";
  // Customer copy: only what may be handed to the customer, as it is to be
  // shown (another product / renamed / kits merged / hidden — see
  // customerLines), numbered as printed
  type PrintItem = DoForPdfItem & { kitParts?: DoForPdfItem[]; isPackage?: boolean };
  // Customer copy of a two-step Case DO: its customer items (from the
  // template, kept separately from the stock actually used); of an older one:
  // its actual items as the customer is to see them
  const listed: PrintItem[] = isCase && copy === "customer"
    ? (data.customerItems ? data.customerItems.filter((i) => i.mdaValid) : customerLines(data.items))
    : data.items;
  // A total-priced Case DO, printed with price: the case price as a package
  // line first (its items show as included)
  const pkg = withPrice && isCase && do_.priceMode === "total" && do_.casePrice ? packageLine(data, listed[0]) : null;
  const items = (pkg ? [pkg, ...listed] : listed).map((i, idx) => (isCase ? { ...i, rowNo: idx + 1 } : i));

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
  const C_CODE = isCase ? 82 : 65; // case copies: product codes printed in full
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
  type RowInfo = { item: DoForPdfResult["items"][number]; descLines: string[]; extra: { text: string; red: boolean }[]; rowH: number };
  const exp = (d: string | null) => (d ? fmtD(d) : null);
  const rowInfos: RowInfo[] = items.map(item => {
    const descLines = wrap(item.description ?? "—", fontR, FS_DESC, C_DESC - TABLE_PAD * 2);
    const extra: { text: string; red: boolean }[] = [];
    if (isCase && item.isPackage) {
      // the package line: no MDA of its own — its items are listed below
    } else if (isCase) {
      if (item.serialNo) extra.push({ text: `Serial No: ${item.serialNo}`, red: false });
      if (item.loanPurpose) {
        const how = item.loanReturnMode === "sold" ? "sold to the customer" : item.loanReturnMode === "stays" ? "left at the hospital" : "returned after the case";
        extra.push({ text: item.loanReturnMode === "sold" ? `Machine — ${how}` : `Machine on ${({ RENTAL: "rental", LOAN: "loan", DEMO: "demo" } as Record<string, string>)[item.loanPurpose] ?? "loan"} — ${how}`, red: false });
      }
      const mdaLine = (m: { mdaRegNo: string | null; mdaExpiredOn: string | null }, code?: string) =>
        `${code ? `${code}: ` : ""}MDA Reg. No: ${m.mdaRegNo}${m.mdaExpiredOn ? `  ·  valid until ${exp(m.mdaExpiredOn)}` : ""}`;
      if (item.kitParts) {
        // A kit: the registration of each item in it
        for (const p of item.kitParts.filter((x) => x.mdaValid)) extra.push({ text: mdaLine(p, p.productCode ?? undefined), red: false });
      } else if (item.mdaValid && item.mdaRegNo) extra.push({ text: mdaLine(item), red: false });
      else if (item.mdaValid) { /* a free-text customer line (e.g. a package name) — no MDA of its own */ }
      else if (internal && item.custShow === "hide") { /* not printed for the customer anyway */ }
      else if (internal && item.custShow === "product") { /* judged on the product shown — below */ }
      else if (item.mdaRegNo) extra.push({ text: `MDA ${item.mdaRegNo} EXPIRED ${exp(item.mdaExpiredOn) ?? ""} — not on customer copy`, red: true });
      else extra.push({ text: "NO MDA REGISTRATION — not on customer copy", red: true });
      // Internal copy: how the customer copy shows this line
      if (internal && item.custShow) {
        const qtyNote = item.custQty ? ` × ${item.custQty}` : "";
        if (item.custShow === "hide") extra.push({ text: "Customer copy: not shown", red: false });
        else if (item.custShow === "text") extra.push({ text: `Customer copy shows: ${[item.custCode, item.custDescription].filter(Boolean).join(" — ")}${qtyNote}`, red: false });
        else if (item.custShow === "kit") extra.push({ text: `Customer copy: in kit "${item.custDescription}"`, red: false });
        else if (item.custShow === "product") {
          extra.push({ text: `Customer copy shows: ${item.custCode}${item.custDescription ? ` — ${item.custDescription}` : ""}${qtyNote}${item.custReason ? ` (reason: ${item.custReason})` : ""}`, red: false });
          if (!item.custMda?.mdaValid) extra.push({ text: `${item.custCode} has no valid MDA registration — not on customer copy`, red: true });
        }
      }
    }
    const extraLines = extra.flatMap((e) => wrap(sanitizeText(e.text), fontR, 7.5, C_DESC - TABLE_PAD * 2).map((t) => ({ text: t, red: e.red })));
    const rowH = Math.max(RH_MIN, descLines.length * LH + extraLines.length * 9.5 + 6);
    return { item, descLines, extra: extraLines, rowH };
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
  const detailRowCount = isCase
    ? 2 + (do_.mrnNo ? 1 : 0) + (data.caseInfo?.categories.length ? 1 : 0) + (data.caseInfo?.specialist ? 1 : 0) + (do_.customerPoNo ? 1 : 0)
    : 2 + (do_.salesOrderNo ? 1 : 0) + (do_.customerPoNo ? 1 : 0) + (do_.deliveryDate ? 1 : 0);
  const infoRightH = 8 + detailRowCount * 13;
  const caseDescLines = isCase && do_.caseDescription ? wrap(sanitizeText(do_.caseDescription), fontR, 9, CW - 40) : [];
  const INFO_BLOCK = Math.max(infoLeftH, infoRightH) + 10
    + (internal ? 16 : 0)
    + (caseDescLines.length ? caseDescLines.length * 12 + 8 : 0);

  const noteLines   = do_.notes ? wrap(do_.notes, fontR, 9, CW) : [];
  const TOTALS_H    = hasAnyPrice ? (16 + 13 + 6 + 10 + 24) : 0;
  const NOTES_H     = do_.notes ? noteLines.length * 12 + 20 : 0;
  const FOOTER_H    = 30;

  // ── Boxes after the table (customer-facing copies, not the internal one):
  // terms / notes, payment details (primary bank account), received-by ──
  const showInfo   = !internal;
  const termLines  = (org.doFooterNotes?.trim()
    ? org.doFooterNotes.split(/\r?\n/).map((t) => t.trim()).filter(Boolean)
    : DEFAULT_DO_TERMS);
  const bank       = showInfo && org.doShowBank ? org.bank : null;
  const showRecv   = showInfo && org.doShowReceivedBy;
  const BOX_GAP = 10, BOX_TITLE_H = 16, BOX_PAD = 7, BOX_LH = 10.5;
  const termsW  = bank ? (CW - BOX_GAP) * 0.56 : CW;
  const bankW   = CW - BOX_GAP - termsW;
  const termWrapped = showInfo ? termLines.flatMap((t) => wrap(sanitizeText(t), fontR, 8, termsW - BOX_PAD * 2 - 8).map((l, k) => ({ l, bullet: k === 0 }))) : [];
  const bankRows: [string, string][] = bank ? [
    ["Bank", bank.bankName + (bank.branchName ? `, ${bank.branchName}` : "")],
    ["Account name", bank.accountHolder],
    ["Account no.", bank.accountNo],
    ...(bank.swiftCode ? [["SWIFT", bank.swiftCode] as [string, string]] : []),
  ] : [];
  const rowBoxH = showInfo && (termWrapped.length || bankRows.length)
    ? BOX_TITLE_H + BOX_PAD * 2 + Math.max(termWrapped.length, bankRows.length) * BOX_LH : 0;
  const RECV_H  = showRecv ? 64 : 0;
  const INFO_H  = (rowBoxH ? rowBoxH + 12 : 0) + (RECV_H ? RECV_H + 10 : 0);
  const BOTTOM_RESERVE = TOTALS_H + NOTES_H + INFO_H + FOOTER_H;

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
    // (P1_ROW_AVAIL already leaves BOTTOM_RESERVE free — add it back, as it's counted below)
    const lastAvail  = Math.max(isFirstPg ? P1_ROW_AVAIL + BOTTOM_RESERVE : PN_ROW_AVAIL, RH_MIN * 3);
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
    page.drawText(showRecv ? "Computer generated document." : "Computer generated document. No signature required.", {
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
        docLabel: internal ? "DELIVERY ORDER (INTERNAL)" : "DELIVERY ORDER",
        docLabelSize: 14,
        docLabelBold: true,
        docLabelAlign: "right",
        logoHMax: LOGO_H_MAX, logoWMax: LOGO_W_MAX,
      });
      curY -= HEADER_BLOCK;
      hLine(page, curY, ML, W - MR, accentColor, 1.2);
      curY -= DIVIDER_GAP;
      if (internal) {
        const msg = "INTERNAL INVENTORY RECORD — NOT FOR THE CUSTOMER";
        page.drawRectangle({ x: ML, y: curY - 13, width: CW, height: 14, color: rgb(0.99, 0.92, 0.92) });
        page.drawText(msg, { x: ML + (CW - fontB.widthOfTextAtSize(msg, 8)) / 2, y: curY - 9.5, size: 8, font: fontB, color: C_RED });
        curY -= 16;
      }

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

      page.drawText(isCase ? "CASE DETAILS" : "DELIVERY DETAILS", { x: RIGHT_X, y: curY - 8, size: 7, font: fontB, color: accentColor });
      const detailRows: [string, string][] = isCase ? [
        ["DO No", do_.doNo],
        ["Case date", fmtD(do_.caseDate ?? do_.createdAt)],
        ...(do_.mrnNo ? [["MRN", do_.mrnNo] as [string, string]] : []),
        ...(data.caseInfo?.categories.length ? [["Case type", data.caseInfo.categories.join(", ")] as [string, string]] : []),
        ...(data.caseInfo?.specialist ? [["App. specialist", data.caseInfo.specialist] as [string, string]] : []),
        ...(do_.customerPoNo ? [["Customer PO", do_.customerPoNo] as [string, string]] : []),
      ] : [
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

      curY -= INFO_BLOCK - (internal ? 16 : 0) - (caseDescLines.length ? caseDescLines.length * 12 + 8 : 0);
      if (caseDescLines.length) {
        page.drawText("CASE", { x: ML, y: curY - 2, size: 7, font: fontB, color: accentColor });
        let cy = curY - 2;
        for (const l of caseDescLines) { page.drawText(l, { x: ML + 36, y: cy, size: 9, font: fontR, color: C_DARK }); cy -= 12; }
        curY -= caseDescLines.length * 12 + 8;
      }
      curY -= DIVIDER_GAP;
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
      for (const ex of rowInfos[rowIdx].extra) {
        dy += 1.5;
        page.drawText(ex.text, { x: X_DESC + TABLE_PAD, y: dy, size: 7.5, font: ex.red ? fontB : fontR, color: ex.red ? C_RED : C_MID });
        dy -= 9.5;
      }

      const qtyStr = sanitizeText(String(item.qty ?? 0));
      const qtyW   = fontR.widthOfTextAtSize(qtyStr, FS_CODE);
      page.drawText(qtyStr, { x: X_QTY + (C_QTY - qtyW) / 2, y: textBaseline, size: FS_CODE, font: fontR, color: C_DARK });

      const uomStr = trunc(sanitizeText(item.uom ?? "—"), fontR, FS_CODE, C_UOM - 4);
      const uomW   = fontR.widthOfTextAtSize(uomStr, FS_CODE);
      page.drawText(uomStr, { x: X_UOM + (C_UOM - uomW) / 2, y: textBaseline, size: FS_CODE, font: fontR, color: C_DARK });

      if (withPrice) {
        // a total-priced case: its items are covered by the package line
        const none = pkg && !(item as { isPackage?: boolean }).isPackage ? "included" : "—";
        const upStr = item.unitPrice != null ? `RM ${Number(item.unitPrice).toFixed(2)}` : none;
        const upW   = fontR.widthOfTextAtSize(upStr, FS_CODE);
        page.drawText(upStr, { x: X_UP + C_UP - upW - TABLE_PAD, y: textBaseline, size: FS_CODE, font: fontR, color: C_DARK });

        const totStr = item.totalPrice != null ? `RM ${Number(item.totalPrice).toFixed(2)}` : none;
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

      // ── Info boxes ──────────────────────────────────────────────────────
      const tint = rgb(accentColor.red * 0.08 + 0.92, accentColor.green * 0.08 + 0.92, accentColor.blue * 0.08 + 0.92);
      const box = (x: number, top: number, w: number, h: number, title: string) => {
        page.drawRectangle({ x, y: top - h, width: w, height: h, borderColor: C_LINE, borderWidth: 0.8, color: rgb(1, 1, 1) });
        page.drawRectangle({ x, y: top - BOX_TITLE_H, width: w, height: BOX_TITLE_H, color: tint });
        page.drawRectangle({ x, y: top - h, width: 2.5, height: h, color: accentColor });
        page.drawText(title, { x: x + BOX_PAD + 2, y: top - BOX_TITLE_H + 5, size: 7.5, font: fontB, color: accentColor });
      };
      if (rowBoxH) {
        curY -= 12;
        const top = curY;
        box(ML, top, termsW, rowBoxH, "TERMS & NOTES");
        let ty = top - BOX_TITLE_H - BOX_PAD - 7;
        for (const t of termWrapped) {
          if (t.bullet) page.drawText("•", { x: ML + BOX_PAD + 2, y: ty, size: 8, font: fontB, color: accentColor });
          page.drawText(t.l, { x: ML + BOX_PAD + 10, y: ty, size: 8, font: fontR, color: C_DARK });
          ty -= BOX_LH;
        }
        if (bank) {
          const bx = ML + termsW + BOX_GAP;
          box(bx, top, bankW, rowBoxH, "PAYMENT DETAILS");
          let by = top - BOX_TITLE_H - BOX_PAD - 7;
          for (const [k, v] of bankRows) {
            page.drawText(k, { x: bx + BOX_PAD + 2, y: by, size: 7.5, font: fontR, color: C_MID });
            page.drawText(trunc(sanitizeText(v), fontB, 8, bankW - BOX_PAD * 2 - 70), { x: bx + BOX_PAD + 68, y: by, size: 8, font: fontB, color: C_DARK });
            by -= BOX_LH;
          }
        }
        curY = top - rowBoxH;
      }
      if (RECV_H) {
        curY -= 10;
        const top = curY;
        box(ML, top, CW, RECV_H, "RECEIVED IN GOOD ORDER AND CONDITION BY");
        const colW = CW / 3;
        const labels = ["Name", "Signature & company stamp", "Date"];
        labels.forEach((lbl, k) => {
          const x = ML + k * colW + BOX_PAD + 4;
          const lineY = top - RECV_H + 18;
          page.drawLine({ start: { x, y: lineY }, end: { x: x + colW - BOX_PAD * 2 - 12, y: lineY }, thickness: 0.6, color: C_MID });
          page.drawText(lbl, { x, y: lineY - 10, size: 7, font: fontR, color: C_LITE });
        });
        curY = top - RECV_H;
      }
    }
  }

  // A cancelled DO: stamped CANCELLED on every page, with when, who and why
  if (do_.status === "cancelled") {
    const when = do_.cancelledAt ? fmtD(new Date(do_.cancelledAt).toISOString()) : "";
    const note = sanitizeText(`CANCELLED${when ? ` on ${when}` : ""}${do_.cancelledByName ? ` by ${do_.cancelledByName}` : ""}${do_.cancelReason ? ` — ${do_.cancelReason}` : ""}`);
    for (const pg of pdfDoc.getPages()) {
      const { width, height } = pg.getSize();
      const size = 96;
      const tw = fontB.widthOfTextAtSize("CANCELLED", size);
      pg.drawText("CANCELLED", { x: width / 2 - (tw / 2) * Math.cos(Math.PI / 4) + 20, y: height / 2 - (tw / 2) * Math.sin(Math.PI / 4), size, font: fontB, color: C_RED, opacity: 0.18, rotate: degrees(45) });
      const lines = wrap(note, fontB, 9, width - ML - MR);
      lines.forEach((ln, k) => pg.drawText(ln, { x: ML, y: height - 18 - k * 11, size: 9, font: fontB, color: C_RED }));
    }
  }

  // A draft has no DO number yet (given when delivered): stamped DRAFT
  if (isDraftDoNo(do_.doNo) && do_.status === "draft") {
    for (const pg of pdfDoc.getPages()) {
      const { width, height } = pg.getSize();
      const size = 110;
      const tw = fontB.widthOfTextAtSize("DRAFT", size);
      pg.drawText("DRAFT", { x: width / 2 - (tw / 2) * Math.cos(Math.PI / 4) + 20, y: height / 2 - (tw / 2) * Math.sin(Math.PI / 4), size, font: fontB, color: C_LITE, opacity: 0.15, rotate: degrees(45) });
    }
  }

  // Customer copy: the MDA registration certificate of every item listed
  if (isCase && copy === "customer" && items.length) {
    try {
      await appendMdaCertPages(pdfDoc, items.flatMap((i) => i.kitParts
        ? i.kitParts.filter((p) => p.mdaValid).map((p) => ({ rowNo: String(i.rowNo), productCode: p.productCode, mdaRegNo: p.mdaRegNo }))
        : i.mdaRegNo ? [{ rowNo: String(i.rowNo), productCode: i.productCode, mdaRegNo: i.mdaRegNo }] : []), data.ownerOrgIds);
    } catch (e) { console.error("[do-pdf] MDA certificates could not be attached:", e); }
  }

  return pdfDoc.save();
}

/**
 * The customer copy's lines: each Case DO line as it is to be shown to the
 * hospital (its customer-copy setting), then only what may be handed over —
 * a valid MDA registration (a kit: at least one item in it with one).
 *   product — another catalogue product: its code, description and MDA
 *   text    — the same item renamed (hospital's own code / name)
 *   kit     — lines with the same kit name merge into one line
 *   hide    — left out
 */
function customerLines(all: DoForPdfItem[]): (DoForPdfItem & { kitParts?: DoForPdfItem[] })[] {
  const out: (DoForPdfItem & { kitParts?: DoForPdfItem[] })[] = [];
  const kits = new Map<string, DoForPdfItem & { kitParts: DoForPdfItem[] }>();
  for (const i of all) {
    const qty = i.custQty || i.qty;
    if (i.custShow === "hide") continue;
    if (i.custShow === "product") {
      out.push({ ...i, productCode: i.custCode, description: i.custDescription, qty, uom: i.custUom ?? i.uom, serialNo: null,
        mdaRegNo: i.custMda?.mdaRegNo ?? null, mdaExpiredOn: i.custMda?.mdaExpiredOn ?? null, mdaValid: !!i.custMda?.mdaValid });
    } else if (i.custShow === "text") {
      out.push({ ...i, productCode: i.custCode || i.productCode, description: i.custDescription || i.description, qty, uom: i.custUom || i.uom });
    } else if (i.custShow === "kit" && i.custDescription) {
      const k = i.custDescription.trim().toLowerCase();
      const kit = kits.get(k);
      if (kit) {
        kit.kitParts.push(i);
        if (i.custQty && !kit.custQty) kit.qty = i.custQty;
        if (i.custCode && !kit.productCode) kit.productCode = i.custCode;
      } else {
        const line = { ...i, productCode: i.custCode ?? "", description: i.custDescription, qty: i.custQty || "1", uom: i.custUom || "set",
          serialNo: null, loanPurpose: null, kitParts: [i] };
        kits.set(k, line);
        out.push(line);
      }
    } else out.push(i);
  }
  return out.filter((l) => (l.kitParts ? l.kitParts.some((p) => p.mdaValid) : l.mdaValid));
}

/** The case price as one line, for a total-priced Case DO printed with price. */
function packageLine(data: DoForPdfResult, like: DoForPdfItem | undefined): DoForPdfItem & { kitParts?: DoForPdfItem[]; isPackage: true } {
  const d = data.order;
  const name = d.caseDescription?.trim() || data.caseInfo?.categories.join(", ") || "case";
  const base = (like ?? data.items[0]) as DoForPdfItem;
  return {
    ...base, id: "case-package", productId: null, productCode: "", description: `Case package — ${name} (items below included)`,
    qty: "1", uom: "case", unitId: null, serialNo: null, loanPurpose: null, loanReturnMode: null, usageFee: null, salePrice: null,
    custShow: null, custMda: null, mdaRegNo: null, mdaExpiredOn: null, mdaValid: true,
    unitPrice: Number(d.casePrice).toFixed(2), totalPrice: Number(d.casePrice).toFixed(2), isPackage: true,
  };
}
