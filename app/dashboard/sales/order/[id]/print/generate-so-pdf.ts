import { PDFDocument, PDFFont, PDFPage, PDFImage, rgb, StandardFonts } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import fs from "fs";
import path from "path";
import type { getSalesOrderForPrint } from "@/server/sales-order";

type Data = NonNullable<Awaited<ReturnType<typeof getSalesOrderForPrint>>>;

const W  = 595.28;
const H  = 841.89;
const ML = 32;
const MR = 32;
const MB = 30;
const CW = W - ML - MR;

const C_DARK  = rgb(0.10, 0.10, 0.10);
const C_MID   = rgb(0.40, 0.40, 0.40);
const C_LITE  = rgb(0.62, 0.62, 0.62);
const C_LINE  = rgb(0.88, 0.88, 0.88);
const C_OFF   = rgb(0.975, 0.975, 0.98);

const LOGO_H_MAX   = 44;
const LOGO_W_MAX   = 90;
const B_PADT       = 14;
const B_PADB       = 12;
const B_FS_DET     = 7.5;
const B_LH         = 11;
const B_DASH_H     = 14;
const TABLE_PAD    = 6;
const TABLE_HDR_H  = 22;
const GRAND_BAND_H = 28;

function fmtD(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" });
}

function fmtM(v: string | number | null | undefined): string {
  return `RM ${Number(v ?? 0).toLocaleString("en-MY", { minimumFractionDigits: 2 })}`;
}

function sanitizeText(t: string): string {
  return String(t)
    .replace(/[\x00-\x1F\x7F]/g, " ")
    .replace(/[^\x00-\xFFŒœŠšŸŽžƒˆ˜–—''‚""„†‡•…‰‹›€™]/g, " ");
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
        let rem = word;
        while (font.widthOfTextAtSize(rem, size) > maxW && rem.length > 1) {
          let cut = rem.length - 1;
          while (cut > 0 && font.widthOfTextAtSize(rem.slice(0, cut) + "-", size) > maxW) cut--;
          if (cut === 0) break;
          allLines.push(rem.slice(0, cut) + "-");
          rem = rem.slice(cut);
        }
        cur = rem;
      }
    }
    if (cur) allLines.push(cur);
  }
  return allLines.length ? allLines : [""];
}

function trunc(text: string, font: PDFFont, size: number, maxW: number): string {
  if (!text) return "";
  const s2 = sanitizeText(text).trim();
  if (!s2) return "";
  if (font.widthOfTextAtSize(s2, size) <= maxW) return s2;
  let s = s2;
  while (s.length > 0 && font.widthOfTextAtSize(s + "…", size) > maxW) s = s.slice(0, -1);
  return s + "…";
}

function hLine(page: PDFPage, y: number, x1 = ML, x2 = W - MR, color = C_LINE, thick = 0.4) {
  page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness: thick, color });
}

export async function generateSalesOrderPdf(data: Data): Promise<Uint8Array> {
  const {
    order: so, items, cpoCustomers,
    createdByName, submittedByName, approvedByName,
    orgName, orgLogoUrl, orgBrandColor,
    orgCompanyName, orgCompanyAddress, orgTaxNo, orgPhone, orgEmail,
    orgOldSsmNo, orgNewSsmNo, orgMdaEstablishmentNo,
    orgBankingInfo,
  } = data;

  const accent = orgBrandColor
    ? (() => {
        const hex = orgBrandColor.replace("#", "");
        const r = parseInt(hex.slice(0, 2), 16) / 255;
        const g = parseInt(hex.slice(2, 4), 16) / 255;
        const b = parseInt(hex.slice(4, 6), 16) / 255;
        return rgb(r, g, b);
      })()
    : rgb(0.12, 0.12, 0.22);

  const cust     = so.customerSnapshot as any;
  const bankList = (orgBankingInfo ?? []) as any[];
  const bank     = bankList.find((b: any) => b.isPrimary) ?? bankList[0] ?? null;
  const coName   = orgCompanyName ?? orgName;

  const sets      = Number(so.sets ?? 1);
  const subtotal  = Number(so.subtotal ?? 0);
  const discAmt   = Number(so.overallDiscountAmt ?? 0);
  const sstAmt    = Number(so.sst ?? 0);
  const grand     = Number(so.grandTotal ?? 0);
  const subtotalPerSet    = sets > 0 ? subtotal / sets : subtotal;
  const itemDiscPerSet    = items.reduce((s, i) => s + Number(i.discountAmt ?? 0), 0);
  const rawSubtotalPerSet = subtotalPerSet + itemDiscPerSet;
  const afterDisc = subtotal - discAmt;

  // ── Customer & CPO data ────────────────────────────────────────────────────
  //
  // Grouping priority:
  //   1. CPO-based  — when SO has linked CPOs → group items by sourceCustomerPoId
  //   2. Quotation-based — group items by sourceQuotationId (multiple quotations)
  //   3. Single / direct — no section headers
  //
  const hasCpos = cpoCustomers.length > 0;

  // Map: cpoId → CpoCustomer (for quick lookup when building section headers)
  const cpoById = new Map(cpoCustomers.map((c) => [c.customerPoId, c]));

  // Distinct CPO IDs that actually appear on items (ordered by first occurrence)
  const itemCpoIds: string[] = [];
  const itemCpoIdSet = new Set<string>();
  for (const item of items) {
    const id = (item as any).sourceCustomerPoId as string | null;
    if (id && !itemCpoIdSet.has(id)) { itemCpoIdSet.add(id); itemCpoIds.push(id); }
  }

  // Distinct quotation IDs that appear on items without a CPO link
  const lqJson = (so.linkedQuotations ?? []) as {
    id: string; quotationNo: string;
    customerSnapshot?: {
      title?: string; name: string;
      organizationName?: string; organizationAddress?: string;
    } | null;
  }[];
  const qtById = new Map(lqJson.map((lq) => [lq.id, lq]));

  const itemQtIds: string[] = [];
  const itemQtIdSet = new Set<string>();
  for (const item of items) {
    const qtId = (item as any).sourceQuotationId as string | null;
    const hasCpo = !!(item as any).sourceCustomerPoId;
    if (!hasCpos && qtId && !hasCpo && !itemQtIdSet.has(qtId)) {
      itemQtIdSet.add(qtId); itemQtIds.push(qtId);
    }
  }

  const showCpoSections = hasCpos && itemCpoIds.length > 1;
  const showQtSections  = !hasCpos && itemQtIds.length > 1;
  const showSections    = showCpoSections || showQtSections;

  // ── Band "ATTENTION TO" — all unique customers ─────────────────────────────
  //
  //   CPO mode  → derive customers from cpoCustomers (each CPO has its own snapshot)
  //   Qt mode   → derive from linkedQuotations
  //   Fallback  → primary customerSnapshot on SO
  //
  type CustBand = { name: string; org: string | null; addr: string | null; cpoNo: string | null };
  const allCustomers: CustBand[] = [];
  {
    const seen = new Set<string>();

    if (hasCpos) {
      for (const cpo of cpoCustomers) {
        const snap = cpo.customerSnapshot;
        const n    = snap ? [snap.title, snap.name].filter(Boolean).join(" ") : null;
        if (!n) continue;
        if (seen.has(n)) {
          // same customer, different CPO — add CPO to existing entry's label if distinct
          const existing = allCustomers.find((c) => c.name === n);
          if (existing && existing.cpoNo && cpo.customerPoNo !== existing.cpoNo) {
            existing.cpoNo += `, ${cpo.customerPoNo}`;
          }
          continue;
        }
        seen.add(n);
        allCustomers.push({
          name: n,
          org:   snap?.organizationName  ?? null,
          addr:  snap?.organizationAddress ?? null,
          cpoNo: cpo.customerPoNo ?? null,
        });
      }
    } else {
      for (const lq of lqJson) {
        const snap = lq.customerSnapshot;
        const n    = snap ? [snap.title, snap.name].filter(Boolean).join(" ") : null;
        if (!n || seen.has(n)) continue;
        seen.add(n);
        allCustomers.push({ name: n, org: snap?.organizationName ?? null, addr: snap?.organizationAddress ?? null, cpoNo: null });
      }
    }

    // Fallback
    if (allCustomers.length === 0) {
      const n = cust ? [cust.title, cust.name].filter(Boolean).join(" ") : null;
      if (n) allCustomers.push({ name: n, org: cust?.organizationName ?? null, addr: cust?.organizationAddress ?? null, cpoNo: so.customerPoNo ?? null });
    }
  }

  // ── Fonts ──────────────────────────────────────────────────────────────────
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);
  const fontsDir = path.join(process.cwd(), "public", "fonts");
  const readFont = (name: string) => {
    try { return fs.readFileSync(path.join(fontsDir, name)); } catch { return null; }
  };
  const libL = readFont("nunito.light.ttf");
  const libR = readFont("nunito.regular.ttf");
  const libS = readFont("nunito.semibold.ttf");
  const libB = readFont("nunito.bold.ttf");
  const fontL = libL ? await pdfDoc.embedFont(libL, { subset: true }) : await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontR = libR ? await pdfDoc.embedFont(libR, { subset: true }) : await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontS = libS ? await pdfDoc.embedFont(libS, { subset: true }) : await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontB = libB ? await pdfDoc.embedFont(libB, { subset: true }) : await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const nameSize = 13;
  const nameFont = fontB;
  const dispName = coName;

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

  // ── Table font sizes ───────────────────────────────────────────────────────
  const FS_DESC  = 8.5;
  const FS_CODE  = 8;
  const FS_NUM   = 7.5;
  const LH       = 10.5;
  const CONT_LH  = 7.5;
  const RH_MIN   = 15;

  // ── Column widths ──────────────────────────────────────────────────────────
  const showSetHeaders = new Set(items.map(i => i.setGroupId).filter(Boolean)).size > 1;
  const C_NO   = 22;
  const C_CODE = 65;
  const C_QTY  = showSetHeaders ? 38 : 28;
  const C_TQTY = showSetHeaders ? 48 : 0;
  const C_UOM  = 34;
  const C_UP   = 64;
  const C_DISC = 55;
  const C_TOT  = 68;
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

  // ── Band layout ────────────────────────────────────────────────────────────
  const RIGHT_X   = ML + Math.round(CW * 0.60);
  const CO_TEXT_X = ML + (logoImg ? LOGO_W_MAX + 10 : 6) - 20;
  const CO_TEXT_W = RIGHT_X - CO_TEXT_X - 10;

  const coAddrLines  = orgCompanyAddress ? wrap(orgCompanyAddress, fontR, B_FS_DET, CO_TEXT_W).slice(0, 2) : [];
  const coContactStr = [orgPhone, orgEmail].filter(Boolean).join("  ·  ");
  const coSsmParts   = [
    orgOldSsmNo && `SSM: ${orgOldSsmNo}`,
    orgNewSsmNo ? orgNewSsmNo : null,
    orgTaxNo    && `Tax: ${orgTaxNo}`,
  ].filter(Boolean) as string[];
  const coSsmStr   = coSsmParts.join("  ·  ");
  const coSsmLines = coSsmStr ? wrap(coSsmStr, fontL, 6, CO_TEXT_W) : [];
  const coMdaStr   = orgMdaEstablishmentNo ? `MDA Est.: ${orgMdaEstablishmentNo}` : "";

  const coTextH = (nameSize + 4)
    + coAddrLines.length * B_LH
    + (coContactStr ? B_LH : 0)
    + coSsmLines.length * B_LH
    + (coMdaStr ? B_LH : 0);
  const CO_SECTION_H = Math.max(LOGO_H_MAX, coTextH);

  // Customer section height — all customers stacked
  //   Each customer: name (13+3 height padding) + org (B_LH) + addr (B_LH) + CPO line (B_LH if present)
  //   Separator between customers: 6px
  let CU_SECTION_H = 8 + 4;  // "ATTENTION TO" label + gap
  for (let ci = 0; ci < allCustomers.length; ci++) {
    const c = allCustomers[ci];
    CU_SECTION_H += 13 + 3;
    if (c.org)   CU_SECTION_H += B_LH;
    if (c.addr)  CU_SECTION_H += B_LH;
    if (c.cpoNo) CU_SECTION_H += B_LH;
    if (ci < allCustomers.length - 1) CU_SECTION_H += 6;
  }

  // Right column rows (no CPO here — CPO shown per-customer in left column)
  const rightColRows: [string, string][] = [
    ["Date", fmtD(so.createdAt)],
    ...(so.deliveryDate    ? [["Delivery Date", fmtD(so.deliveryDate)]]  as [string, string][] : []),
    ...(so.salesPersonName ? [["Sales Person",  so.salesPersonName]]     as [string, string][] : []),
  ];
  CU_SECTION_H = Math.max(CU_SECTION_H, rightColRows.length * (B_LH + 1));

  const BAND_H = B_PADT + CO_SECTION_H + B_DASH_H + CU_SECTION_H + B_PADB;

  // ── Row heights ────────────────────────────────────────────────────────────
  const CODE_LINE_H = LH - 2;
  type RowInfo = {
    item: typeof items[number];
    descLines: string[];
    codeLines: string[];
    rowH: number;
    firstParaLineCount: number;
  };
  const rowInfos: RowInfo[] = items.map(item => {
    const rentalPrefix = item.lineType === "rent" && item.rentalDuration
      ? `rental for ${item.rentalDuration} ${item.rentalUnit ?? "case"} `
      : "";
    const rawDesc  = `${rentalPrefix}${item.description ?? "—"}`.toUpperCase();
    const descLines = wrap(rawDesc, fontR, FS_DESC, C_DESC - TABLE_PAD * 2);
    const firstParaLineCount = /\r?\n/.test(rawDesc)
      ? Math.max(1, wrap(rawDesc.split(/\r?\n/)[0], fontR, FS_DESC, C_DESC - TABLE_PAD * 2).length)
      : descLines.length;
    const codeLines = wrap(item.productCode ?? "—", fontR, FS_CODE, C_CODE - TABLE_PAD * 2);
    const codeLineH = codeLines.length * CODE_LINE_H;
    const hasItemDisc = Number(item.discountPct ?? 0) > 0;
    const descH = firstParaLineCount * LH + Math.max(0, descLines.length - firstParaLineCount) * CONT_LH;
    const rowH  = Math.max(hasItemDisc ? RH_MIN + 8 : RH_MIN, Math.max(codeLineH + 6, descH + 6));
    return { item, descLines, codeLines, rowH, firstParaLineCount };
  });

  // ── Bottom reserve ─────────────────────────────────────────────────────────
  const totRowCount  = 1 + (itemDiscPerSet > 0 ? 2 : 0) + (sets > 1 ? 1 : 0) + (discAmt > 0 ? 2 : 0) + (sstAmt > 0 ? 1 : 0);
  const noteLines    = so.notes ? wrap(so.notes, fontR, 9.5, CW - 20) : [];
  const TOTALS_H     = 14 + totRowCount * 13 + 6 + GRAND_BAND_H + 10;
  const NOTES_H      = so.notes ? noteLines.length * 12 + 30 : 0;
  const trailCount   = [createdByName, submittedByName, approvedByName].filter(Boolean).length;
  const TRAIL_H      = trailCount > 0 ? trailCount * 16 + 24 : 0;
  const BOTTOM_RESERVE = TOTALS_H + NOTES_H + 30 + 16 + 38 + TRAIL_H;

  const P1_ROW_AVAIL = H - BAND_H - TABLE_HDR_H - MB - 26;
  const PN_ROW_AVAIL = H - BAND_H - TABLE_HDR_H - MB - 26;

  // ── Build render entries ───────────────────────────────────────────────────
  //
  //   section    — customer + CPO grouping header (one per CPO or per quotation)
  //   setHeader  — set group header (within a section)
  //   item       — line item row
  //
  const SET_HDR_H     = 16;
  const SECTION_HDR_H = 18;  // slightly taller than set headers for readability
  type RenderEntry =
    | { kind: "section";   label: string; subLabel: string | null; rowH: number }
    | { kind: "setHeader"; label: string; qty: number; setTotal: number; pricePerSet: number; rowH: number }
    | { kind: "item";      rowIdx: number; rowH: number };

  const renderItems: RenderEntry[] = [];
  {
    let lastSectionKey: string | null = null;
    const seenGroups = new Set<string>();

    for (let i = 0; i < rowInfos.length; i++) {
      const it       = rowInfos[i].item;
      const cpoId    = (it as any).sourceCustomerPoId as string | null;
      const qtId     = (it as any).sourceQuotationId  as string | null;

      // Determine the section key for this item
      const sectionKey = showCpoSections ? (cpoId ?? "__none__")
                       : showQtSections  ? (qtId  ?? "__none__")
                       : null;

      if (sectionKey !== null && sectionKey !== lastSectionKey) {
        lastSectionKey = sectionKey;
        seenGroups.clear();

        // Build the section label
        let label    = "Other Items";
        let subLabel: string | null = null;

        if (showCpoSections && cpoId) {
          const cpoCust = cpoById.get(cpoId);
          const snap    = cpoCust?.customerSnapshot;
          const custN   = snap ? [snap.title, snap.name].filter(Boolean).join(" ") : null;
          label    = custN ?? "Customer";
          subLabel = `CPO: ${cpoCust?.customerPoNo ?? (it as any).sourceCustomerPoNo ?? cpoId}`;
        } else if (showQtSections && qtId) {
          const lq    = qtById.get(qtId);
          const snap  = lq?.customerSnapshot;
          label = snap ? [snap.title, snap.name].filter(Boolean).join(" ") || lq?.quotationNo || "Customer"
                       : lq?.quotationNo ?? "Customer";
        }

        renderItems.push({ kind: "section", label, subLabel, rowH: SECTION_HDR_H });
      }

      // Set group header — scoped to current section key so sets restart per section
      const setGroupKey = `${sectionKey ?? ""}::${it.setGroupId ?? ""}`;
      if (showSetHeaders && it.setGroupId && !seenGroups.has(setGroupKey)) {
        seenGroups.add(setGroupKey);
        const setTotal = rowInfos
          .filter(r => r.item.setGroupId === it.setGroupId
            && (showCpoSections ? (r.item as any).sourceCustomerPoId === cpoId
              : showQtSections  ? (r.item as any).sourceQuotationId  === qtId
              : true))
          .reduce((s, r) => s + Number(r.item.totalPrice ?? 0), 0);
        const setQty     = Number(it.setQty ?? 1);
        const displayQty = setQty * sets;
        const pricePerSet = setQty > 0 ? setTotal / setQty : 0;
        const _lbl = it.setGroupLabel ?? "Set";
        renderItems.push({
          kind: "setHeader",
          label: _lbl.toLowerCase() === "not-as-set" ? "Loose Items" : _lbl,
          qty: displayQty,
          setTotal: setTotal * sets,
          pricePerSet,
          rowH: SET_HDR_H,
        });
      }

      renderItems.push({ kind: "item", rowIdx: i, rowH: rowInfos[i].rowH });
    }
  }

  // ── Paginate ───────────────────────────────────────────────────────────────
  const pageGroups: number[][] = [];
  let curGroup: number[] = [];
  let usedH = 0;
  let firstPage = true;

  for (let i = 0; i < renderItems.length; i++) {
    const rh    = renderItems[i].rowH;
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

  let hasOverflowPage = false;
  {
    const lastGroup   = pageGroups[pageGroups.length - 1];
    const lastIsFirst = pageGroups.length === 1;
    const lastAvail   = Math.max(lastIsFirst ? P1_ROW_AVAIL : PN_ROW_AVAIL, RH_MIN * 3);
    const lastItemsH  = lastGroup.reduce((s, i) => s + renderItems[i].rowH, 0);
    if (lastItemsH + BOTTOM_RESERVE > lastAvail) {
      pageGroups.push([]);
      hasOverflowPage = true;
    }
  }

  const totalPages = pageGroups.length;

  // ── Band header helper ─────────────────────────────────────────────────────
  const drawBandHeader = (page: PDFPage) => {
    page.drawRectangle({ x: 0, y: H - 3, width: W, height: 3, color: accent });

    if (logoImg) {
      const scale = Math.min(LOGO_H_MAX / logoImg.height, LOGO_W_MAX / logoImg.width, 1);
      const lw = logoImg.width  * scale;
      const lh = logoImg.height * scale;
      page.drawImage(logoImg, { x: ML, y: H - B_PADT - (CO_SECTION_H + lh) / 2, width: lw, height: lh });
    }

    let cty = H - B_PADT - nameSize;
    page.drawText(trunc(dispName, nameFont, nameSize, CO_TEXT_W), {
      x: CO_TEXT_X, y: cty, size: nameSize, font: nameFont, color: accent,
    });
    cty -= nameSize - 1;
    for (const line of coAddrLines) {
      page.drawText(line, { x: CO_TEXT_X, y: cty, size: B_FS_DET, font: fontL, color: C_DARK });
      cty -= B_LH;
    }
    if (coContactStr) {
      page.drawText(trunc(coContactStr, fontL, B_FS_DET, CO_TEXT_W), {
        x: CO_TEXT_X, y: cty, size: B_FS_DET, font: fontL, color: C_DARK,
      });
      cty -= B_LH;
    }
    for (const line of coSsmLines) {
      page.drawText(line, { x: CO_TEXT_X, y: cty, size: 6, font: fontL, color: C_DARK });
      cty -= B_LH;
    }
    if (coMdaStr) {
      page.drawText(trunc(coMdaStr, fontL, 6, CO_TEXT_W), {
        x: CO_TEXT_X, y: cty, size: 6, font: fontL, color: C_DARK,
      });
    }

    // Right: "SALES ORDER" label + SO number
    const soLabelW = fontS.widthOfTextAtSize("SALES ORDER", 7);
    page.drawText("SALES ORDER", {
      x: W - MR - soLabelW, y: H - B_PADT - 7,
      size: 7, font: fontS, color: C_LITE,
    });
    const soNoSize = 12;
    const soNoW    = fontB.widthOfTextAtSize(so.soNo, soNoSize);
    page.drawText(so.soNo, {
      x: W - MR - soNoW, y: H - B_PADT - 7 - 5 - soNoSize,
      size: soNoSize, font: fontB, color: accent,
    });

    // Dashed divider
    hLine(page, H - B_PADT - CO_SECTION_H - B_DASH_H / 2, ML, W - MR, C_LINE, 0.5);

    // Left column — ATTENTION TO: all customers, each with CPO if applicable
    const cuTop = H - B_PADT - CO_SECTION_H - B_DASH_H;
    let cuLY = cuTop;
    page.drawText("ATTENTION TO", { x: ML, y: cuLY, size: 7, font: fontL, color: C_DARK });
    cuLY -= 7 + 4;

    for (let ci = 0; ci < allCustomers.length; ci++) {
      const c = allCustomers[ci];
      page.drawText(trunc(c.name, fontB, 9, RIGHT_X - ML - 10), {
        x: ML, y: cuLY, size: 9, font: fontB, color: C_DARK,
      });
      cuLY -= 9 + 2;
      if (c.org) {
        page.drawText(trunc(c.org, fontB, 9, RIGHT_X - ML - 10), {
          x: ML, y: cuLY, size: 9, font: fontB, color: C_DARK,
        });
        cuLY -= B_LH;
      }
      if (c.addr) {
        const addrLine = wrap(c.addr, fontL, 9, RIGHT_X - ML - 10)[0] ?? "";
        page.drawText(addrLine, { x: ML, y: cuLY, size: 9, font: fontL, color: C_DARK });
        cuLY -= B_LH;
      }
      if (c.cpoNo) {
        page.drawText(`CPO: ${c.cpoNo}`, { x: ML, y: cuLY, size: 7.5, font: fontL, color: C_MID });
        cuLY -= B_LH;
      }
      if (ci < allCustomers.length - 1) {
        hLine(page, cuLY + 2, ML, RIGHT_X - 10, C_LINE, 0.3);
        cuLY -= 6;
      }
    }

    // Right column — Date / Delivery Date / Sales Person
    let cuRY = cuTop;
    for (const [lbl, val] of rightColRows) {
      page.drawText(`${lbl}:`, { x: RIGHT_X, y: cuRY, size: 8, font: fontL, color: C_DARK });
      const vw = fontS.widthOfTextAtSize(val, 8);
      page.drawText(val, { x: W - MR - vw, y: cuRY, size: 8, font: fontS, color: C_DARK });
      cuRY -= B_LH + 1;
    }
  };

  // ── Draw pages ─────────────────────────────────────────────────────────────
  for (let pi = 0; pi < pageGroups.length; pi++) {
    const isLast    = pi === pageGroups.length - 1;
    const page      = pdfDoc.addPage([W, H]);
    const pageItems = pageGroups[pi];

    // Footer
    hLine(page, MB + 22);
    page.drawText("Computer generated document. No signature required.", {
      x: ML, y: MB + 10, size: 7.5, font: fontL, color: C_LITE,
    });
    const pgText = `${so.soNo}  ·  Page ${pi + 1} of ${totalPages}`;
    page.drawText(pgText, {
      x: W - MR - fontL.widthOfTextAtSize(pgText, 7.5),
      y: MB + 10, size: 7.5, font: fontL, color: C_LITE,
    });

    // Band header on every page
    drawBandHeader(page);

    let curY = H - BAND_H;

    // ── Table header ────────────────────────────────────────────────────────
    const isOverflowPage = hasOverflowPage && pi === pageGroups.length - 1;
    const tableTopY = curY;
    if (!isOverflowPage) {
      const tHdrY = curY - TABLE_HDR_H;
      hLine(page, curY, ML, W - MR, C_LINE, 0.5);
      const thdrs: { label: string; x: number; w: number }[] = [
        { label: "No",                                   x: X_NO,   w: C_NO   },
        { label: "Product Code",                         x: X_CODE, w: C_CODE },
        { label: "Description",                          x: X_DESC, w: C_DESC },
        { label: showSetHeaders ? "Qty/Set" : "Qty",     x: X_QTY,  w: C_QTY  },
        ...(showSetHeaders ? [{ label: "Total Qty", x: X_TQTY, w: C_TQTY }] : []),
        { label: "UOM",                                  x: X_UOM,  w: C_UOM  },
        { label: "Unit Price",                           x: X_UP,   w: C_UP   },
        { label: "Discount",                             x: X_DISC, w: C_DISC },
        { label: "Total",                                x: X_TOT,  w: C_TOT  },
      ];
      for (const col of thdrs) {
        const tw = fontS.widthOfTextAtSize(col.label.toUpperCase(), 7);
        page.drawText(col.label.toUpperCase(), {
          x: col.x + (col.w - tw) / 2, y: tHdrY + 7,
          size: 7, font: fontS, color: C_DARK,
        });
      }
      hLine(page, tHdrY, ML, W - MR, accent, 1.5);
      curY = tHdrY;
    }

    // ── Item rows ────────────────────────────────────────────────────────────
    let itemRowAlt = 0;
    for (let ri = 0; ri < pageItems.length; ri++) {
      const entry = renderItems[pageItems[ri]];

      // Section header (customer + CPO or quotation grouping)
      if (entry.kind === "section") {
        itemRowAlt = 0;
        const hdrY  = curY - entry.rowH;
        page.drawRectangle({ x: ML, y: hdrY, width: CW, height: entry.rowH, color: rgb(0.90, 0.93, 0.97) });
        page.drawRectangle({ x: ML, y: hdrY, width: 3,  height: entry.rowH, color: accent });
        const labelUpper = entry.label.toUpperCase();
        const labelW     = fontS.widthOfTextAtSize(labelUpper, FS_DESC);
        const textY      = hdrY + (entry.rowH + FS_DESC) / 2 - FS_DESC;
        page.drawText(labelUpper, { x: ML + TABLE_PAD + 3, y: textY, size: FS_DESC, font: fontS, color: C_DARK });
        if (entry.subLabel) {
          page.drawText(entry.subLabel, {
            x: ML + TABLE_PAD + 3 + labelW + 6, y: textY,
            size: FS_CODE, font: fontL, color: C_MID,
          });
        }
        hLine(page, hdrY, ML, W - MR, accent, 0.5);
        curY = hdrY;
        continue;
      }

      // Set group header
      if (entry.kind === "setHeader") {
        itemRowAlt = 0;
        const hdrY  = curY - SET_HDR_H;
        const textY = hdrY + (SET_HDR_H - FS_DESC) / 2;
        page.drawRectangle({ x: ML, y: hdrY, width: CW, height: SET_HDR_H, color: rgb(0.93, 0.95, 0.98) });
        const labelUpper = entry.label.toUpperCase();
        const labelW     = fontS.widthOfTextAtSize(labelUpper, FS_DESC);
        page.drawText(labelUpper, { x: ML + TABLE_PAD, y: textY, size: FS_DESC, font: fontS, color: C_DARK });
        const qtyText = `  ×  ${entry.qty} ${entry.qty === 1 ? "set" : "sets"}`;
        page.drawText(qtyText, { x: ML + TABLE_PAD + labelW, y: textY, size: FS_CODE, font: fontL, color: C_DARK });
        if (entry.qty > 1) {
          const qtyTextW = fontL.widthOfTextAtSize(qtyText, FS_CODE);
          const ppsStr   = `  ·  RM ${entry.pricePerSet.toFixed(2)} / set`;
          page.drawText(ppsStr, { x: ML + TABLE_PAD + labelW + qtyTextW, y: textY, size: FS_CODE, font: fontL, color: C_DARK });
        }
        const setTotStr = `RM ${entry.setTotal.toFixed(2)}`;
        const setTotW   = fontB.widthOfTextAtSize(setTotStr, FS_DESC);
        page.drawText(setTotStr, { x: X_TOT + C_TOT - TABLE_PAD - setTotW, y: textY, size: FS_DESC, font: fontB, color: C_DARK });
        hLine(page, hdrY, ML, W - MR, accent, 0.5);
        curY = hdrY;
        continue;
      }

      // Item row
      const { rowIdx } = entry;
      const { item, descLines, codeLines, rowH, firstParaLineCount } = rowInfos[rowIdx];
      const rowY = curY - rowH;

      if (itemRowAlt % 2 === 0) {
        page.drawRectangle({ x: ML, y: rowY, width: CW, height: rowH, color: C_OFF });
      }
      itemRowAlt++;

      const textBaseline = curY - 10;

      const noW = fontS.widthOfTextAtSize(String(item.rowNo), FS_NUM);
      page.drawText(String(item.rowNo), {
        x: X_NO + (C_NO - noW) / 2, y: textBaseline, size: FS_NUM, font: fontS, color: C_DARK,
      });

      let cdy = textBaseline;
      for (const codeLine of codeLines) {
        page.drawText(codeLine, { x: X_CODE + TABLE_PAD, y: cdy, size: FS_CODE, font: fontR, color: C_DARK });
        cdy -= CODE_LINE_H;
      }

      let dy = textBaseline;
      for (let li = 0; li < descLines.length; li++) {
        const isCont = li >= firstParaLineCount;
        page.drawText(descLines[li], {
          x: X_DESC + TABLE_PAD, y: dy,
          size: isCont ? 6 : FS_DESC, font: fontR, color: C_DARK,
        });
        dy -= isCont ? CONT_LH : LH;
      }

      const qtyW = fontR.widthOfTextAtSize(String(item.qty ?? 0), FS_DESC);
      page.drawText(String(item.qty ?? 0), {
        x: X_QTY + (C_QTY - qtyW) / 2, y: textBaseline, size: FS_DESC, font: fontR, color: C_DARK,
      });

      if (showSetHeaders) {
        const totalQtyVal = Number(item.qty ?? 0) * Number(item.setQty ?? 1);
        const tqStr = String(totalQtyVal);
        const tqW   = fontR.widthOfTextAtSize(tqStr, FS_DESC);
        page.drawText(tqStr, { x: X_TQTY + (C_TQTY - tqW) / 2, y: textBaseline, size: FS_DESC, font: fontR, color: C_DARK });
      }

      const uomStr = sanitizeText(item.uom || "—");
      const uomW   = fontR.widthOfTextAtSize(uomStr, FS_CODE);
      page.drawText(uomStr, {
        x: X_UOM + (C_UOM - uomW) / 2, y: textBaseline, size: FS_CODE, font: fontR, color: C_DARK,
      });

      const up  = `RM ${Number(item.unitPrice ?? 0).toFixed(2)}`;
      const upW = fontR.widthOfTextAtSize(up, FS_CODE);
      page.drawText(up, {
        x: X_UP + C_UP - TABLE_PAD - upW, y: textBaseline, size: FS_CODE, font: fontR, color: C_DARK,
      });

      const itemDiscAmt = Number(item.discountAmt ?? 0);
      const itemDiscPct = Number(item.discountPct ?? 0);
      if (itemDiscAmt > 0) {
        const amtStr  = `RM ${itemDiscAmt.toFixed(2)}`;
        const amtStrW = fontR.widthOfTextAtSize(amtStr, FS_CODE);
        page.drawText(amtStr, { x: X_DISC + (C_DISC - amtStrW) / 2, y: textBaseline, size: FS_CODE, font: fontR, color: C_DARK });
        const pctStr  = `(${itemDiscPct}%)`;
        const pctStrW = fontR.widthOfTextAtSize(pctStr, FS_CODE - 1.5);
        page.drawText(pctStr, { x: X_DISC + (C_DISC - pctStrW) / 2, y: textBaseline - 8, size: FS_CODE - 1.5, font: fontR, color: C_DARK });
      } else {
        const dash  = "—";
        const dashW = fontR.widthOfTextAtSize(dash, FS_CODE);
        page.drawText(dash, { x: X_DISC + (C_DISC - dashW) / 2, y: textBaseline, size: FS_CODE, font: fontR, color: C_DARK });
      }

      const tot  = `RM ${Number(item.totalPrice ?? 0).toFixed(2)}`;
      const totW = fontR.widthOfTextAtSize(tot, FS_DESC);
      page.drawText(tot, {
        x: X_TOT + C_TOT - TABLE_PAD - totW, y: textBaseline, size: FS_DESC, font: fontR, color: C_DARK,
      });

      hLine(page, rowY, ML, W - MR, C_LINE, 0.3);
      curY = rowY;
    }

    const tableH = tableTopY - curY;
    if (!isOverflowPage && tableH > 0) {
      const r = 6;
      page.drawSvgPath(
        `M ${r},0 L ${CW - r},0 Q ${CW},0 ${CW},${r} L ${CW},${tableH - r} Q ${CW},${tableH} ${CW - r},${tableH} L ${r},${tableH} Q 0,${tableH} 0,${tableH - r} L 0,${r} Q 0,0 ${r},0 Z`,
        { x: ML, y: tableTopY, borderColor: accent, borderWidth: 1 },
      );
    }

    // ── Last page: totals + bank + notes + approval trail ─────────────────────
    if (isLast) {
      curY -= 10;
      hLine(page, curY, ML, W - MR, C_LINE, 0.5);
      curY -= 14;

      const totColW = 220;
      const totX    = W - MR - totColW;
      let ty = curY;

      const totItems: [string, string][] = [];
      if (itemDiscPerSet > 0) {
        totItems.push([sets > 1 ? "Subtotal before disc (1 set)" : "Subtotal (before disc)", fmtM(rawSubtotalPerSet)]);
        totItems.push([sets > 1 ? "Item Discount (1 set)"        : "Item Discount",          `- ${fmtM(itemDiscPerSet)}`]);
        totItems.push([sets > 1 ? "Subtotal (1 set)"             : "Subtotal",               fmtM(subtotalPerSet)]);
      } else {
        totItems.push([sets > 1 ? "Subtotal (1 set)" : "Subtotal", fmtM(subtotalPerSet)]);
      }
      if (sets > 1) totItems.push([`× ${sets} sets`, fmtM(subtotal)]);
      if (discAmt > 0) {
        totItems.push([Number(so.overallDiscountPct ?? 0) > 0 ? `Discount (${so.overallDiscountPct}%)` : "Special Discount", `- ${fmtM(discAmt)}`]);
        totItems.push(["After Discount", fmtM(afterDisc)]);
      }
      if (sstAmt > 0) totItems.push([`SST (${so.sstPct}%)`, fmtM(sstAmt)]);

      for (const [lbl, val] of totItems) {
        page.drawText(lbl, { x: totX, y: ty, size: 9.5, font: fontR, color: C_MID });
        const vw = fontR.widthOfTextAtSize(val, 9.5);
        page.drawText(val, { x: W - MR - vw, y: ty, size: 9.5, font: fontR, color: C_DARK });
        ty -= 13;
      }
      ty -= 8;

      hLine(page, ty, ML, W - MR, accent, 1.5);
      page.drawText("GRAND TOTAL", {
        x: ML + 12, y: ty - GRAND_BAND_H + 9, size: 8, font: fontB, color: C_DARK,
      });
      const gtStr = fmtM(grand);
      const gtW   = fontB.widthOfTextAtSize(gtStr, 14);
      page.drawText(gtStr, {
        x: W - MR - gtW - 10, y: ty - GRAND_BAND_H + 7, size: 14, font: fontB, color: accent,
      });
      hLine(page, ty - GRAND_BAND_H, ML, W - MR, C_LINE, 0.5);
      curY = ty - GRAND_BAND_H - 14;

      curY -= 14;
      if (bank) {
        const bankParts: string[] = [];
        if (bank.bankName) bankParts.push(bank.bankName);
        if ((bank as any).branchName) bankParts.push(`(${(bank as any).branchName})`);
        if (bank.accountHolder) bankParts.push(`account name ${bank.accountHolder}`);
        if (bank.accountNo) bankParts.push(`account number ${bank.accountNo}`);
        const paymentSentence = `Payment can be made to ${bankParts.join(", ")}.`;
        for (const cl of wrap(paymentSentence, fontL, 8, CW)) {
          page.drawText(cl, { x: ML, y: curY, size: 8, font: fontL, color: C_LITE });
          curY -= 12;
        }
        curY -= 4;
      }
      const closeMsg = "Thank you for your valued order. Should you have any enquiries, please do not hesitate to contact us.";
      for (const cl of wrap(closeMsg, fontL, 8, CW)) {
        page.drawText(cl, { x: ML, y: curY, size: 8, font: fontL, color: C_LITE });
        curY -= 12;
      }

      // Notes
      if (so.notes) {
        curY -= 6;
        const nLines   = wrap(so.notes, fontR, 9.5, CW - 20);
        const noteBoxH = nLines.length * 12 + 24;
        page.drawRectangle({
          x: ML, y: curY - noteBoxH, width: CW, height: noteBoxH,
          color: C_OFF, borderColor: C_LINE, borderWidth: 0.4,
        });
        page.drawRectangle({ x: ML, y: curY - noteBoxH, width: 3, height: noteBoxH, color: accent });
        page.drawText("NOTES", { x: ML + 10, y: curY - 12, size: 7.5, font: fontS, color: C_DARK });
        let ny = curY - 24;
        for (const line of nLines) {
          page.drawText(line, { x: ML + 10, y: ny, size: 9.5, font: fontR, color: C_DARK });
          ny -= 12;
        }
        curY -= noteBoxH + 10;
      }

      // Approval trail
      const trailParts: [string, string][] = [];
      if (createdByName)   trailParts.push(["Prepared by",  createdByName]);
      if (submittedByName) trailParts.push(["Submitted by", submittedByName]);
      if (approvedByName)  trailParts.push(["Approved by",  approvedByName + (so.approvedAt ? `  (${fmtD(so.approvedAt)})` : "")]);
      if (trailParts.length > 0) {
        curY -= 10;
        const trailBoxH = trailParts.length * 16 + 16;
        page.drawRectangle({
          x: ML, y: curY - trailBoxH, width: CW, height: trailBoxH,
          color: C_OFF, borderColor: C_LINE, borderWidth: 0.4,
        });
        let ty2 = curY - 12;
        for (const [lbl, val] of trailParts) {
          page.drawText(`${lbl}:`, { x: ML + 10, y: ty2, size: 7.5, font: fontL, color: C_MID });
          page.drawText(sanitizeText(val), { x: ML + 84, y: ty2, size: 7.5, font: fontS, color: C_DARK });
          ty2 -= 16;
        }
      }
    }
  }

  return pdfDoc.save();
}
