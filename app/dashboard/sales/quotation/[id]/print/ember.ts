import { getQuotationDetail } from "@/server/quotation";
import { PDFDocument, PDFFont, PDFPage, PDFImage, rgb, StandardFonts } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import fs from "fs";
import path from "path";

type Data = NonNullable<Awaited<ReturnType<typeof getQuotationDetail>>>;

// ── A4 + margins ───────────────────────────────────────────────────────────────
const W  = 595.28;
const H  = 841.89;
const ML = 32;
const MR = 32;
const MB = 30;
const CW = W - ML - MR;

// ── Neutral palette ────────────────────────────────────────────────────────────
const C_DARK  = rgb(0.10, 0.10, 0.10);
const C_MID   = rgb(0.40, 0.40, 0.40);
const C_LITE  = rgb(0.62, 0.62, 0.62);
const C_LINE  = rgb(0.88, 0.88, 0.88);
const C_WHITE = rgb(1, 1, 1);
const C_OFF   = rgb(0.975, 0.975, 0.98);
const C_GREEN = rgb(0.09, 0.40, 0.20);
const C_AMBER = rgb(0.57, 0.25, 0.05);

// Band: dim white tones for secondary text on the accent bg
const C_BAND_SEC  = rgb(0.82, 0.82, 0.87); // address / contact lines
const C_BAND_MUTE = rgb(0.65, 0.65, 0.72); // SSM / tax / muted

// ── Fixed layout constants ─────────────────────────────────────────────────────
const LOGO_H_MAX   = 44;
const LOGO_W_MAX   = 90;
const B_PADX       = ML;
const B_PADT       = 14;
const B_PADB       = 12;
const B_FS_DET     = 7.5;
const B_LH         = 11;
const B_DASH_H     = 14;   // vertical space around dashed divider
const TABLE_PAD    = 6;
const TABLE_HDR_H  = 22;
const GRAND_BAND_H = 28;
const SLIM_BAND_H  = 34;   // continuation pages

// ── Helpers ────────────────────────────────────────────────────────────────────
function fmtD(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" });
}

function fmtM(v: string | number | null | undefined): string {
  return `RM ${Number(v ?? 0).toLocaleString("en-MY", { minimumFractionDigits: 2 })}`;
}

function sanitizeText(t: string): string {
  return String(t).replace(/[\x00-\x1F\x7F]/g, " ");
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

// ── Main export ────────────────────────────────────────────────────────────────
export async function generateQuotationEmber(data: Data): Promise<Uint8Array> {
  const {
    quotation: q, items,
    orgName, orgLogoUrl, orgBrandColor,
    orgCompanyName, orgCompanyAddress, orgTaxNo, orgPhone,
    orgEmail, orgWebsite, orgOldSsmNo, orgNewSsmNo, orgMdaEstablishmentNo,
    orgBankingInfo,
    orgMofCertUrl, orgSsmCertUrl, orgMdaCertUrl, orgTccCertUrl,
    orgBankStatementUrl, orgLampiran12Url, orgLampiran13Url,
  } = data;

  // Accent — deep indigo-charcoal default
  const accent = orgBrandColor
    ? (() => {
        const hex = orgBrandColor.replace("#", "");
        const r = parseInt(hex.slice(0, 2), 16) / 255;
        const g = parseInt(hex.slice(2, 4), 16) / 255;
        const b = parseInt(hex.slice(4, 6), 16) / 255;
        return rgb(r, g, b);
      })()
    : rgb(0.12, 0.12, 0.22);

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
  pdfDoc.registerFontkit(fontkit);
  const fontsDir = path.join(process.cwd(), "public", "fonts");
  const readFont = (name: string) => {
    try { return fs.readFileSync(path.join(fontsDir, name)); } catch { return null; }
  };
  const libR = readFont("Poppins-Regular.ttf");
  const libB = readFont("Poppins-Bold.ttf");
  const fontR = libR
    ? await pdfDoc.embedFont(libR, { subset: true })
    : await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontB = libB
    ? await pdfDoc.embedFont(libB, { subset: true })
    : await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const nameSize   = ({ small: 10, medium: 13, large: 16, xlarge: 20 } as Record<string,number>)[data.orgNameSize ?? "medium"] ?? 13;
  const nameBold   = !!(data.orgNameBold ?? 1);
  const nameFont   = nameBold ? fontB : fontR;
  const nameUpper  = !!(data.orgNameUppercase ?? 0);
  const dispName   = nameUpper ? coName.toUpperCase() : coName;
  const attnNameSz = ({ small: 10, medium: 13, large: 16, xlarge: 20 } as Record<string,number>)[data.orgAttentionNameSize ?? "medium"] ?? 13;
  const showCode   = !!Number(q.showProductCode ?? 1);
  const showMdaCerts = !!Number(q.includeMdaCerts ?? 1);
  const tableRowStyle = data.orgTableRowStyle ?? "default";
  const QL_TEXT    = !!(data.orgQuotationLabelUppercase ?? 1) ? "QUOTATION" : "Quotation";
  const QL_SIZE    = ({ small: 5.5, normal: 7, large: 10 } as Record<string,number>)[data.orgQuotationLabelSize ?? "normal"] ?? 7;
  const QL_FONT    = !!(data.orgQuotationLabelBold ?? 1) ? fontB : fontR;

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

  // ── Table font sizes ─────────────────────────────────────────────────────
  const tfs     = data.orgTableFontSize ?? "normal";
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
  const C_DISC = showDisc ? 55 : 0;
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

  // ── Band height (dynamic) ─────────────────────────────────────────────────
  // The band is split into:  top = company section  |  bottom = customer section
  // Right 38% of band = quotation metadata (no, date, valid)
  const RIGHT_X    = ML + Math.round(CW * 0.60); // left/right divider in band
  const CO_TEXT_X  = ML + (logoImg ? LOGO_W_MAX + 10 : 6) - 20;
  const CO_TEXT_W  = RIGHT_X - CO_TEXT_X - 10;
  const RIGHT_W    = W - MR - RIGHT_X;

  // Company content lines (for height estimate)
  const coAddrLines = orgCompanyAddress
    ? wrap(orgCompanyAddress, fontR, B_FS_DET, CO_TEXT_W).slice(0, 2)
    : [];
  const coContactStr = [orgPhone, orgEmail].filter(Boolean).join("  ·  ");
  const coSsmParts   = [
    orgOldSsmNo && `SSM: ${orgOldSsmNo}`,
    orgNewSsmNo ? orgNewSsmNo : null,
    orgTaxNo    && `Tax: ${orgTaxNo}`,
    (data as any).orgMofNo && `MOF: ${(data as any).orgMofNo}`,
  ].filter(Boolean) as string[];
  const coSsmStr = coSsmParts.join("  ·  ");
  const coMdaStr = orgMdaEstablishmentNo ? `MDA Est.: ${orgMdaEstablishmentNo}` : "";

  const coTextH = (nameSize + 4)
    + coAddrLines.length * B_LH
    + (coContactStr ? B_LH : 0)
    + (coSsmStr     ? B_LH : 0)
    + (coMdaStr     ? B_LH : 0);
  const CO_SECTION_H = Math.max(LOGO_H_MAX, coTextH);

  // Customer section height
  const custName = cust ? [cust.title, cust.name].filter(Boolean).join(" ") : null;
  let CU_SECTION_H = 8 + 4;   // "ATTENTION TO" label + gap
  if (custName) CU_SECTION_H += attnNameSz + 3;
  if (cust?.organizationName) CU_SECTION_H += B_LH;
  if (cust?.organizationAddress) CU_SECTION_H += B_LH;

  const BAND_H = B_PADT + CO_SECTION_H + B_DASH_H + CU_SECTION_H + B_PADB;

  // ── Row heights ───────────────────────────────────────────────────────────
  const CODE_LINE_H = LH - 2;
  type RowInfo = {
    item: typeof items[number];
    descLines: string[];
    extraLine: string | null;
    isGreenRow: boolean;
    rowH: number;
  };
  const rowInfos: RowInfo[] = items.map(item => {
    const rentalPrefix = item.lineType === "rent" && item.rentalDuration
      ? `rental for ${item.rentalDuration} ${item.rentalUnit ?? "case"} `
      : "";
    const descLines = wrap(`${rentalPrefix}${item.description ?? "—"}`.toUpperCase(), fontR, FS_DESC, C_DESC - TABLE_PAD * 2);
    const extraLine  = showMdaCerts && item.hasCert && item.mdaRegNo
      ? `MDA: ${item.mdaRegNo}${item.mdaValidity ? ` · Exp: ${fmtD(item.mdaValidity)}` : ""}`
      : (showMdaCerts && !item.hasCert ? "No MDA certificate" : null);
    const isGreenRow = !!(item.hasCert && item.mdaRegNo);
    const codeLineH  = 0;
    const hasItemDisc = showDisc && Number(item.discountPct ?? 0) > 0;
    const rowH = Math.max(hasItemDisc ? RH_MIN + 8 : RH_MIN, codeLineH + descLines.length * LH + (extraLine ? RH_MIN + MDA_GAP + 2 : 6));
    return { item, descLines, extraLine, isGreenRow, rowH };
  });

  // ── Page availability ─────────────────────────────────────────────────────
  const TITLE_BAR_H  = q.title ? 26 : 0;
  const totRowCount  = 1 + (showDisc && itemDiscPerSet > 0 ? 2 : 0) + (sets > 1 ? 1 : 0) + (discAmt > 0 ? 3 : 0) + (sstAmt > 0 ? 1 : 0);
  const noteLines    = q.notes ? wrap(q.notes, fontR, 9.5, CW - 20) : [];
  const TOTALS_H     = 14 + totRowCount * 13 + 6 + GRAND_BAND_H + 10;
  const NOTES_H      = q.notes ? noteLines.length * 12 + 30 : 0;
  const FOOTER_BLOCK = 30;
  const CLOSING_H    = 38;
  const ACCEPT_H     = 0;
  const BOTTOM_RESERVE = TOTALS_H + NOTES_H + FOOTER_BLOCK + 16 + CLOSING_H + ACCEPT_H;

  const P1_ROW_AVAIL = H - BAND_H - TITLE_BAR_H - TABLE_HDR_H - MB - 20;
  const PN_ROW_AVAIL = H - BAND_H - TABLE_HDR_H - MB - 20;

  // ── Build render entries (set headers interleaved with items) ────────────
  const SET_HDR_H = 18;
  type RenderEntry =
    | { kind: "setHeader"; label: string; qty: number; setTotal: number; rowH: number }
    | { kind: "item"; rowIdx: number; rowH: number };
  const renderItems: RenderEntry[] = [];
  {
    const seenGroups = new Set<string>();
    for (let i = 0; i < rowInfos.length; i++) {
      const it = rowInfos[i].item;
      if (it.setGroupId && !seenGroups.has(it.setGroupId)) {
        seenGroups.add(it.setGroupId);
        const setTotal = rowInfos
          .filter(r => r.item.setGroupId === it.setGroupId)
          .reduce((s, r) => s + Number(r.item.totalPrice ?? 0), 0);
        renderItems.push({ kind: "setHeader", label: it.setGroupLabel ?? "Set", qty: Number(it.setQty ?? 1), setTotal, rowH: SET_HDR_H });
      }
      renderItems.push({ kind: "item", rowIdx: i, rowH: rowInfos[i].rowH });
    }
  }

  // ── Paginate ──────────────────────────────────────────────────────────────
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

    // Footer
    hLine(page, MB + 22);
    page.drawText("Computer generated document. No signature required.", {
      x: ML, y: MB + 10, size: 7.5, font: fontR, color: C_LITE,
    });
    const pgText = `${q.quotationNo}  ·  Page ${pi + 1} of ${totalPages}`;
    page.drawText(pgText, {
      x: W - MR - fontR.widthOfTextAtSize(pgText, 7.5),
      y: MB + 10, size: 7.5, font: fontR, color: C_LITE,
    });

    let curY: number;

    // ── Page 1: full header band ───────────────────────────────────────────
    if (isFirst) {
      // Thin accent rule at top of page only
      page.drawRectangle({ x: 0, y: H - 3, width: W, height: 3, color: accent });

      // Logo
      if (logoImg) {
        const scale = Math.min(LOGO_H_MAX / logoImg.height, LOGO_W_MAX / logoImg.width, 1);
        const lw = logoImg.width  * scale;
        const lh = logoImg.height * scale;
        const logoY = H - B_PADT - (CO_SECTION_H + lh) / 2;
        page.drawImage(logoImg, { x: ML, y: logoY, width: lw, height: lh });
      }

      // Company name — brand colour; info lines — black
      let cty = H - B_PADT - nameSize;
      page.drawText(trunc(dispName, nameFont, nameSize, CO_TEXT_W), {
        x: CO_TEXT_X, y: cty, size: nameSize, font: nameFont, color: accent,
      });
      cty -= nameSize - 1;
      for (const line of coAddrLines) {
        page.drawText(line, { x: CO_TEXT_X, y: cty, size: B_FS_DET, font: fontR, color: C_DARK });
        cty -= B_LH;
      }
      if (coContactStr) {
        page.drawText(trunc(coContactStr, fontR, B_FS_DET, CO_TEXT_W), {
          x: CO_TEXT_X, y: cty, size: B_FS_DET, font: fontR, color: C_DARK,
        });
        cty -= B_LH;
      }
      if (coSsmStr) {
        page.drawText(trunc(coSsmStr, fontR, 6, CO_TEXT_W), {
          x: CO_TEXT_X, y: cty, size: 6, font: fontR, color: C_DARK,
        });
        cty -= B_LH;
      }
      if (coMdaStr) {
        page.drawText(trunc(coMdaStr, fontR, 6, CO_TEXT_W), {
          x: CO_TEXT_X, y: cty, size: 6, font: fontR, color: C_DARK,
        });
      }

      // Right: quotation label + number — number in accent colour only
      const qlW   = QL_FONT.widthOfTextAtSize(QL_TEXT, QL_SIZE);
      const qlAlign = (data.orgQuotationLabelAlign ?? "right") as "left" | "center" | "right";
      const qlX   = qlAlign === "left"   ? ML
                  : qlAlign === "center" ? ML + (W - ML - MR - qlW) / 2
                  :                        W - MR - qlW;
      page.drawText(QL_TEXT, {
        x: qlX, y: H - B_PADT - QL_SIZE,
        size: QL_SIZE, font: QL_FONT, color: C_LITE,
      });
      const qNoSize = 12;
      const qNoW    = fontB.widthOfTextAtSize(q.quotationNo, qNoSize);
      page.drawText(q.quotationNo, {
        x: W - MR - qNoW, y: H - B_PADT - QL_SIZE - 5 - qNoSize,
        size: qNoSize, font: fontB, color: accent,
      });

      // Light separator between company and customer sections
      const dashY = H - B_PADT - CO_SECTION_H - B_DASH_H / 2;
      hLine(page, dashY, ML, W - MR, C_LINE, 0.5);

      // Customer section
      const cuTop = H - B_PADT - CO_SECTION_H - B_DASH_H;
      let cuLY = cuTop;

      page.drawText("ATTENTION TO", {
        x: ML, y: cuLY, size: 7, font: fontB, color: C_LITE,
      });
      cuLY -= 7 + 4;

      if (custName) {
        page.drawText(trunc(custName, fontB, 10, RIGHT_X - ML - 10), {
          x: ML, y: cuLY, size: 10, font: fontB, color: C_DARK,
        });
        cuLY -= 10 + 1;
      }
      if (cust?.organizationName) {
        page.drawText(trunc(cust.organizationName, fontR, B_FS_DET, RIGHT_X - ML - 10), {
          x: ML, y: cuLY, size: B_FS_DET, font: fontR, color: C_MID,
        });
        cuLY -= B_LH;
      }
      if (cust?.organizationAddress) {
        const addrLine = wrap(cust.organizationAddress, fontR, B_FS_DET, RIGHT_X - ML - 10)[0] ?? "";
        page.drawText(addrLine, { x: ML, y: cuLY, size: B_FS_DET, font: fontR, color: C_LITE });
      }

      // Right: dates only — sales and prepared by omitted
      let cuRY = cuTop;
      const dateRows: [string, string][] = [
        ["Date",        fmtD(q.createdAt)],
        ["Valid Until", fmtD(q.validUntil)],
      ];
      for (const [lbl, val] of dateRows) {
        page.drawText(`${lbl}:`, { x: RIGHT_X, y: cuRY, size: 8, font: fontR, color: C_LITE });
        const vw = fontB.widthOfTextAtSize(val, 8);
        page.drawText(val, { x: W - MR - vw, y: cuRY, size: 8, font: fontB, color: C_DARK });
        cuRY -= B_LH + 1;
      }

      curY = H - BAND_H;

      // ── Title bar ──────────────────────────────────────────────────────────
      if (q.title) {
        const TITLE_H = 26;
        page.drawRectangle({ x: ML, y: curY - TITLE_H, width: CW, height: TITLE_H, color: C_OFF });
        page.drawRectangle({ x: ML, y: curY - TITLE_H, width: 3,  height: TITLE_H, color: accent });
        page.drawText(trunc(q.title.toUpperCase(), fontB, 9, CW - 20), {
          x: ML + 10, y: curY - TITLE_H + 9, size: 9, font: fontB, color: C_DARK,
        });
        curY -= TITLE_H;
      }

    } else {
      // ── Continuation: repeat full header ──────────────────────────────────
      page.drawRectangle({ x: 0, y: H - 3, width: W, height: 3, color: accent });

      if (logoImg) {
        const scale = Math.min(LOGO_H_MAX / logoImg.height, LOGO_W_MAX / logoImg.width, 1);
        const lw = logoImg.width  * scale;
        const lh = logoImg.height * scale;
        const logoY = H - B_PADT - (CO_SECTION_H + lh) / 2;
        page.drawImage(logoImg, { x: ML, y: logoY, width: lw, height: lh });
      }

      let cty2 = H - B_PADT - nameSize;
      page.drawText(trunc(dispName, nameFont, nameSize, CO_TEXT_W), {
        x: CO_TEXT_X, y: cty2, size: nameSize, font: nameFont, color: accent,
      });
      cty2 -= nameSize - 1;
      for (const line of coAddrLines) {
        page.drawText(line, { x: CO_TEXT_X, y: cty2, size: B_FS_DET, font: fontR, color: C_DARK });
        cty2 -= B_LH;
      }
      if (coContactStr) {
        page.drawText(trunc(coContactStr, fontR, B_FS_DET, CO_TEXT_W), {
          x: CO_TEXT_X, y: cty2, size: B_FS_DET, font: fontR, color: C_DARK,
        });
        cty2 -= B_LH;
      }
      if (coSsmStr) {
        page.drawText(trunc(coSsmStr, fontR, 6, CO_TEXT_W), {
          x: CO_TEXT_X, y: cty2, size: 6, font: fontR, color: C_DARK,
        });
        cty2 -= B_LH;
      }
      if (coMdaStr) {
        page.drawText(trunc(coMdaStr, fontR, 6, CO_TEXT_W), {
          x: CO_TEXT_X, y: cty2, size: 6, font: fontR, color: C_DARK,
        });
      }

      const qlW2    = QL_FONT.widthOfTextAtSize(QL_TEXT, QL_SIZE);
      const qlAlign2 = (data.orgQuotationLabelAlign ?? "right") as "left" | "center" | "right";
      const qlX2    = qlAlign2 === "left"   ? ML
                    : qlAlign2 === "center" ? ML + (W - ML - MR - qlW2) / 2
                    :                         W - MR - qlW2;
      page.drawText(QL_TEXT, { x: qlX2, y: H - B_PADT - QL_SIZE, size: QL_SIZE, font: QL_FONT, color: C_LITE });
      const qNoW2 = fontB.widthOfTextAtSize(q.quotationNo, 12);
      page.drawText(q.quotationNo, {
        x: W - MR - qNoW2, y: H - B_PADT - QL_SIZE - 5 - 12,
        size: 12, font: fontB, color: accent,
      });

      const dashY2 = H - B_PADT - CO_SECTION_H - B_DASH_H / 2;
      hLine(page, dashY2, ML, W - MR, C_LINE, 0.5);

      const cuTop2 = H - B_PADT - CO_SECTION_H - B_DASH_H;
      let cuLY2 = cuTop2;
      page.drawText("ATTENTION TO", { x: ML, y: cuLY2, size: 7, font: fontB, color: C_LITE });
      cuLY2 -= 7 + 4;
      if (custName) {
        page.drawText(trunc(custName, fontB, 10, RIGHT_X - ML - 10), {
          x: ML, y: cuLY2, size: 10, font: fontB, color: C_DARK,
        });
        cuLY2 -= 10 + 1;
      }
      if (cust?.organizationName) {
        page.drawText(trunc(cust.organizationName, fontR, B_FS_DET, RIGHT_X - ML - 10), {
          x: ML, y: cuLY2, size: B_FS_DET, font: fontR, color: C_MID,
        });
        cuLY2 -= B_LH;
      }
      if (cust?.organizationAddress) {
        const addrLine2 = wrap(cust.organizationAddress, fontR, B_FS_DET, RIGHT_X - ML - 10)[0] ?? "";
        page.drawText(addrLine2, { x: ML, y: cuLY2, size: B_FS_DET, font: fontR, color: C_LITE });
      }

      let cuRY2 = cuTop2;
      for (const [lbl, val] of [["Date", fmtD(q.createdAt)], ["Valid Until", fmtD(q.validUntil)]] as [string,string][]) {
        page.drawText(`${lbl}:`, { x: RIGHT_X, y: cuRY2, size: 8, font: fontR, color: C_LITE });
        const vw2 = fontB.widthOfTextAtSize(val, 8);
        page.drawText(val, { x: W - MR - vw2, y: cuRY2, size: 8, font: fontB, color: C_DARK });
        cuRY2 -= B_LH + 1;
      }

      curY = H - BAND_H;
    }

    // ── Table header ────────────────────────────────────────────────────────
    const tableTopY = curY;
    const tHdrY     = curY - TABLE_HDR_H;
    hLine(page, curY, ML, W - MR, C_LINE, 0.5);
    const thdrs: { label: string; x: number; w: number }[] = [
      { label: "No",          x: X_NO,   w: C_NO   },
      ...(showCode ? [{ label: "Product Code", x: X_CODE, w: C_CODE }] : []),
      { label: "Description", x: X_DESC, w: C_DESC },
      { label: "Qty",         x: X_QTY,  w: C_QTY  },
      { label: "UOM",         x: X_UOM,  w: C_UOM  },
      { label: "Unit Price",  x: X_UP,   w: C_UP   },
      ...(showDisc ? [{ label: "Discount", x: X_DISC, w: C_DISC }] : []),
      ...(showTP   ? [{ label: "Total", x: X_TOT,  w: C_TOT  }] : []),
    ];
    for (const col of thdrs) {
      const tw = fontB.widthOfTextAtSize(col.label.toUpperCase(), 7);
      page.drawText(col.label.toUpperCase(), {
        x: col.x + (col.w - tw) / 2, y: tHdrY + 7,
        size: 7, font: fontB, color: C_DARK,
      });
    }
    hLine(page, tHdrY, ML, W - MR, accent, 1.5);
    curY = tHdrY;

    // ── Item rows ────────────────────────────────────────────────────────────
    let itemRowAlt = 0;
    for (let ri = 0; ri < pageItems.length; ri++) {
      const entry = renderItems[pageItems[ri]];

      // ── Set group header ───────────────────────────────────────────────────
      if (entry.kind === "setHeader") {
        itemRowAlt = 0;
        const hdrY  = curY - SET_HDR_H;
        const textY = hdrY + (SET_HDR_H - FS_DESC) / 2;
        page.drawRectangle({ x: ML, y: hdrY, width: CW, height: SET_HDR_H, color: rgb(0.90, 0.93, 0.97) });
        const labelW = fontB.widthOfTextAtSize(entry.label, FS_DESC);
        page.drawText(entry.label, { x: ML + TABLE_PAD, y: textY, size: FS_DESC, font: fontB, color: C_DARK });
        page.drawText(`  ×  ${entry.qty} ${entry.qty === 1 ? "set" : "sets"}`, { x: ML + TABLE_PAD + labelW, y: textY, size: FS_CODE, font: fontR, color: C_LITE });
        if (showTP) {
          const totStr = `RM ${entry.setTotal.toFixed(2)}`;
          const totW = fontB.widthOfTextAtSize(totStr, FS_DESC);
          page.drawText(totStr, { x: X_TOT + C_TOT - TABLE_PAD - totW, y: textY, size: FS_DESC, font: fontB, color: C_DARK });
        }
        hLine(page, hdrY, ML, W - MR, accent, 0.5);
        curY = hdrY;
        continue;
      }

      const { rowIdx } = entry;
      const { item, descLines, extraLine, isGreenRow, rowH } = rowInfos[rowIdx];
      const rowY = curY - rowH;

      if (itemRowAlt % 2 === 0) {
        page.drawRectangle({ x: ML, y: rowY, width: CW, height: rowH, color: C_OFF });
      }
      itemRowAlt++;

      if (extraLine !== null) {
        page.drawRectangle({
          x: ML, y: rowY + 1, width: 3, height: rowH - 2,
          color: isGreenRow ? C_GREEN : C_AMBER,
        });
      }

      const textBaseline = curY - 11;

      // Row number — accent coloured
      const noW = fontB.widthOfTextAtSize(String(item.rowNo), FS_NUM);
      page.drawText(String(item.rowNo), {
        x: X_NO + (C_NO - noW) / 2, y: textBaseline,
        size: FS_NUM, font: fontB, color: C_DARK,
      });

      let dy = textBaseline;
      if (showCode) {
        page.drawText(trunc(item.productCode ?? "—", fontR, FS_CODE, C_CODE - TABLE_PAD * 2), {
          x: X_CODE + TABLE_PAD, y: dy, size: FS_CODE, font: fontR, color: C_DARK,
        });
      }

      for (const line of descLines) {
        page.drawText(line, { x: X_DESC + TABLE_PAD, y: dy, size: FS_DESC, font: fontR, color: C_DARK });
        dy -= LH;
      }
      if (extraLine) {
        dy -= MDA_GAP;
        page.drawText(extraLine, {
          x: X_DESC + TABLE_PAD, y: dy, size: FS_DETAIL, font: fontR,
          color: C_DARK,
        });
      }

      const qtyW = fontR.widthOfTextAtSize(String(item.qty ?? 0), FS_DESC);
      page.drawText(String(item.qty ?? 0), {
        x: X_QTY + (C_QTY - qtyW) / 2, y: textBaseline, size: FS_DESC, font: fontR, color: C_DARK,
      });

      const uomStr = item.uom || "—";
      const uomW   = fontR.widthOfTextAtSize(uomStr, FS_CODE);
      page.drawText(uomStr, {
        x: X_UOM + (C_UOM - uomW) / 2, y: textBaseline, size: FS_CODE, font: fontR, color: C_DARK,
      });

      const up  = `RM ${Number(item.unitPrice ?? 0).toFixed(2)}`;
      const upW = fontR.widthOfTextAtSize(up, FS_CODE);
      page.drawText(up, {
        x: X_UP + C_UP - TABLE_PAD - upW, y: textBaseline, size: FS_CODE, font: fontR, color: C_DARK,
      });

      if (showDisc) {
        const itemDiscAmt = Number(item.discountAmt ?? 0);
        const itemDiscPct = Number(item.discountPct ?? 0);
        if (itemDiscAmt > 0) {
          const amtStr  = `RM ${itemDiscAmt.toFixed(2)}`;
          const amtStrW = fontR.widthOfTextAtSize(amtStr, FS_CODE);
          page.drawText(amtStr, { x: X_DISC + (C_DISC - amtStrW) / 2, y: textBaseline, size: FS_CODE, font: fontR, color: C_DARK });
          const pctStr  = `(${itemDiscPct}%)`;
          const pctStrW = fontR.widthOfTextAtSize(pctStr, FS_CODE - 1.5);
          page.drawText(pctStr, { x: X_DISC + (C_DISC - pctStrW) / 2, y: textBaseline - 9, size: FS_CODE - 1.5, font: fontR, color: C_DARK });
        } else {
          const dash  = "—";
          const dashW = fontR.widthOfTextAtSize(dash, FS_CODE);
          page.drawText(dash, { x: X_DISC + (C_DISC - dashW) / 2, y: textBaseline, size: FS_CODE, font: fontR, color: C_DARK });
        }
      }

      if (showTP) {
        const tot  = `RM ${Number(item.totalPrice ?? 0).toFixed(2)}`;
        const totW = fontR.widthOfTextAtSize(tot, FS_DESC);
        page.drawText(tot, {
          x: X_TOT + C_TOT - TABLE_PAD - totW, y: textBaseline, size: FS_DESC, font: fontR, color: C_DARK,
        });
      }

      hLine(page, rowY, ML, W - MR, C_LINE, 0.3);
      curY = rowY;
    }

    if (tableRowStyle === "rounded") {
      const tableH = tableTopY - curY;
      const r = 6;
      page.drawSvgPath(
        `M ${r},0 L ${CW - r},0 Q ${CW},0 ${CW},${r} L ${CW},${tableH - r} Q ${CW},${tableH} ${CW - r},${tableH} L ${r},${tableH} Q 0,${tableH} 0,${tableH - r} L 0,${r} Q 0,0 ${r},0 Z`,
        { x: ML, y: tableTopY, borderColor: accent, borderWidth: 1 },
      );
    }

    // ── Last page totals ─────────────────────────────────────────────────────
    if (isLast) {
      curY -= 10;
      hLine(page, curY, ML, W - MR, C_LINE, 0.5);
      curY -= 14;

      if (bank) {
        let by = curY;
        page.drawText("PAYMENT TO", { x: ML, y: by, size: 7, font: fontB, color: C_DARK });
        by -= 13;
        for (const [lbl, val] of [
          ["Bank",         bank.bankName      ?? ""],
          ["Account Name", bank.accountHolder ?? ""],
          ["Account No.",  bank.accountNo     ?? ""],
        ] as [string, string][]) {
          page.drawText(`${lbl}:`, { x: ML, y: by, size: 9, font: fontR, color: C_LITE });
          page.drawText(trunc(String(val), fontB, 9.5, 170), { x: ML + 76, y: by, size: 9.5, font: fontB, color: C_DARK });
          by -= 13;
        }
      }

      const totColW = 220;
      const totX    = W - MR - totColW;
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
      ty -= 8;

      // Grand total — accent top border only, no fill
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
      const closeMsg = "Thank you for the opportunity to present this quotation. We look forward to your valued order. Should you have any enquiries, please do not hesitate to contact us.";
      for (const cl of wrap(closeMsg, fontR, 8, CW - 40)) {
        const clW = fontR.widthOfTextAtSize(cl, 8);
        page.drawText(cl, { x: (W - clW) / 2, y: curY, size: 8, font: fontR, color: C_LITE });
        curY -= 12;
      }

      if (q.notes) {
        curY -= 6;
        const nLines   = wrap(q.notes, fontR, 9.5, CW - 20);
        const noteBoxH = nLines.length * 12 + 24;
        page.drawRectangle({
          x: ML, y: curY - noteBoxH, width: CW, height: noteBoxH,
          color: C_OFF, borderColor: C_LINE, borderWidth: 0.4,
        });
        page.drawRectangle({ x: ML, y: curY - noteBoxH, width: 3, height: noteBoxH, color: accent });
        page.drawText("NOTES", { x: ML + 10, y: curY - 12, size: 7.5, font: fontB, color: C_DARK });
        let ny = curY - 24;
        for (const line of nLines) {
          page.drawText(line, { x: ML + 10, y: ny, size: 9.5, font: fontR, color: C_DARK });
          ny -= 12;
        }
      }

    }
  }

  // ── Catalogue pages ────────────────────────────────────────────────────────
  if (Number(q.includeCatalogue)) {
    const r2ImgBase = process.env.NEXT_PUBLIC_R2_PRODUCT_IMAGES_URL ?? "";
    const seenCodes = new Set<string>();
    const catItems  = items.filter(it => {
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
            try { img = await pdfDoc.embedJpg(buf); } catch { img = await pdfDoc.embedPng(buf); }
            imageCache.set(item.productCode, img);
            break;
          } catch { /* try next ext */ }
        }
      }

      const CAT_HDR_H    = 54;
      const CAT_COLHDR_H = 20;
      const CAT_FOOT_H   = 32;
      const CAT_COL_NO   = 26;
      const ROWS_PER_PG  = 5;
      const rowsAvail    = H - CAT_HDR_H - CAT_COLHDR_H - MB - CAT_FOOT_H;
      const CAT_ROW_H    = Math.floor(rowsAvail / ROWS_PER_PG);
      const CAT_IMG_SZ   = CAT_ROW_H - 12;
      const CAT_COL_IMG  = CAT_IMG_SZ + 22;
      const CAT_COL_DET  = CW - CAT_COL_NO - CAT_COL_IMG;
      const totalCatPgs  = Math.ceil(catItems.length / ROWS_PER_PG);

      for (let pi = 0; pi < totalCatPgs; pi++) {
        const catPage  = pdfDoc.addPage([W, H]);
        const pageRows = catItems.slice(pi * ROWS_PER_PG, (pi + 1) * ROWS_PER_PG);

        catPage.drawRectangle({ x: 0, y: H - 3, width: W, height: 3, color: accent });
        catPage.drawText("PRODUCT CATALOGUE", {
          x: ML, y: H - 22, size: 13, font: fontB, color: C_DARK,
        });
        if (q.title) {
          catPage.drawText(trunc(q.title, fontB, 8.5, CW / 2), {
            x: ML, y: H - 36, size: 8.5, font: fontB, color: C_DARK,
          });
          catPage.drawText(`${q.quotationNo}  ·  ${fmtD(q.createdAt)}`, {
            x: ML, y: H - 48, size: 7, font: fontR, color: C_LITE,
          });
        } else {
          catPage.drawText(`${q.quotationNo}  ·  ${fmtD(q.createdAt)}`, {
            x: ML, y: H - 36, size: 8, font: fontR, color: C_LITE,
          });
        }
        const pgLabel = `Page ${pi + 1} / ${totalCatPgs}`;
        catPage.drawText(pgLabel, {
          x: W - MR - fontR.widthOfTextAtSize(pgLabel, 8),
          y: H - 28, size: 8, font: fontR, color: C_MID,
        });
        hLine(catPage, H - CAT_HDR_H, ML, W - MR, C_LINE, 0.5);

        const colHdrY = H - CAT_HDR_H - CAT_COLHDR_H;
        catPage.drawRectangle({ x: ML, y: colHdrY, width: CW, height: CAT_COLHDR_H, color: C_OFF });
        const colDefs = [
          { label: "#",               x: ML,                            w: CAT_COL_NO  },
          { label: "Image",           x: ML + CAT_COL_NO,               w: CAT_COL_IMG },
          { label: "Product Details", x: ML + CAT_COL_NO + CAT_COL_IMG, w: CAT_COL_DET },
        ];
        for (const col of colDefs) {
          const tw = fontB.widthOfTextAtSize(col.label, 7);
          catPage.drawText(col.label, {
            x: col.x + (col.w - tw) / 2, y: colHdrY + 6, size: 7, font: fontB, color: C_DARK,
          });
        }
        catPage.drawRectangle({ x: ML, y: colHdrY, width: CW, height: 1.5, color: accent });

        const tableTopY    = colHdrY;
        const tableBottomY = tableTopY - pageRows.length * CAT_ROW_H;
        for (const col of colDefs.slice(1)) {
          catPage.drawLine({
            start: { x: col.x, y: tableBottomY }, end: { x: col.x, y: tableTopY },
            thickness: 0.3, color: C_LINE,
          });
        }

        let rowTopY = colHdrY;
        for (let ri = 0; ri < pageRows.length; ri++) {
          const item    = pageRows[ri];
          const rowY    = rowTopY - CAT_ROW_H;
          hLine(catPage, rowY, ML, ML + CW, C_LINE, 0.3);

          const noStr = sanitizeText(item.rowNo);
          catPage.drawText(noStr, {
            x: ML + (CAT_COL_NO - fontR.widthOfTextAtSize(noStr, 8)) / 2,
            y: rowY + CAT_ROW_H / 2 - 4, size: 8, font: fontR, color: C_LITE,
          });

          const imgColX = ML + CAT_COL_NO;
          const img = item.productCode ? imageCache.get(item.productCode) : undefined;
          if (img) {
            const scale = Math.min(CAT_IMG_SZ / img.height, CAT_IMG_SZ / img.width, 1);
            const iw = img.width  * scale;
            const ih = img.height * scale;
            catPage.drawImage(img, {
              x: imgColX + (CAT_COL_IMG - iw) / 2, y: rowY + (CAT_ROW_H - ih) / 2, width: iw, height: ih,
            });
          } else {
            catPage.drawRectangle({
              x: imgColX + (CAT_COL_IMG - CAT_IMG_SZ) / 2, y: rowY + (CAT_ROW_H - CAT_IMG_SZ) / 2,
              width: CAT_IMG_SZ, height: CAT_IMG_SZ, color: C_OFF, borderColor: C_LINE, borderWidth: 0.4,
            });
          }

          const detX    = ML + CAT_COL_NO + CAT_COL_IMG + 8;
          const detMaxW = CAT_COL_DET - 16;
          let   detY    = rowY + CAT_ROW_H - 16;
          if (showCode && item.productCode) {
            catPage.drawText(trunc(item.productCode, fontB, 8, detMaxW), {
              x: detX, y: detY, size: 8, font: fontB, color: C_DARK,
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
            catPage.drawText(item.uom, { x: detX, y: detY, size: 8, font: fontR, color: C_LITE });
            detY -= 11;
          }
          if (showMdaCerts && item.hasCert) {
            detY -= 5;
            if (item.mdaRegNo) {
              catPage.drawText(`MDA Reg No: ${item.mdaRegNo}`, {
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
          x: ML, y: tableBottomY, width: CW, height: tableTopY - tableBottomY,
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

  // ── Append company documents ───────────────────────────────────────────────
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
      const res    = await fetch(doc.url);
      if (!res.ok) continue;
      const buf    = await res.arrayBuffer();
      const srcPdf = await PDFDocument.load(buf);
      const pages  = await pdfDoc.copyPages(srcPdf, srcPdf.getPageIndices());
      pages.forEach(p => pdfDoc.addPage(p));
    } catch { /* skip */ }
  }

  return pdfDoc.save();
}
