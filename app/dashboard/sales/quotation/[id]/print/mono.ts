import { getQuotationDetail } from "@/server/quotation";
import { PDFDocument, PDFFont, PDFPage, PDFImage, rgb, Color, StandardFonts } from "pdf-lib";
import {
  wrap, trunc, fmtD, fmtM, hLine, sanitizeText, C_WHITE,
} from "./_pdf-header";

function hexToColor(hex: string | null | undefined): Color | null {
  if (!hex) return null;
  const h = hex.replace("#", "");
  if (h.length !== 6) return null;
  return rgb(parseInt(h.slice(0,2),16)/255, parseInt(h.slice(2,4),16)/255, parseInt(h.slice(4,6),16)/255);
}

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
const C_BORDER = rgb(0, 0, 0);
const C_HDR_BG = rgb(0, 0, 0);
const C_TEXT   = rgb(0.10, 0.10, 0.10);
const C_MUTED  = rgb(0.40, 0.40, 0.40);
const C_FAINT  = rgb(0.60, 0.60, 0.60);
const C_GREEN  = rgb(0.09, 0.40, 0.20);
const C_AMBER  = rgb(0.57, 0.25, 0.05);

const TABLE_PAD = 6;

// ── Mono header height estimator ───────────────────────────────────────────
function estimateMonoHeaderH(opts: {
  companyAddress: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  oldSsmNo: string | null;
  newSsmNo: string | null;
  mdaEstablishmentNo: string | null;
  taxNo: string | null;
  nameSize: number;
  logoHMax: number;
  logoWMax: number;
  headerLayout: string;
  logoImg: PDFImage | null;
  fontR: PDFFont;
}): number {
  const { companyAddress, phone, email, website, nameSize, logoHMax, logoWMax, headerLayout, logoImg, fontR } = opts;

  let logoLw = 0, logoLh = 0;
  if (logoImg) {
    const scale = Math.min(logoHMax / logoImg.height, logoWMax / logoImg.width);
    logoLw = logoImg.width * scale;
    logoLh = logoImg.height * scale;
  }

  let h = 0;
  if (logoImg && (headerLayout === "logo-top" || headerLayout === "centered")) h += logoLh + 4;

  h += nameSize + 8; // name + gap
  const hasSsmMdaTax = !!(opts.oldSsmNo || opts.newSsmNo || opts.mdaEstablishmentNo || opts.taxNo);
  if (hasSsmMdaTax) h += 10; // SSM/MDA/Tax line below name

  const textZoneW = (headerLayout === "logo-right" && logoImg) ? CW - logoLw - 8
    : (headerLayout === "standard" && logoImg) ? CW - logoLw - 8
    : CW;

  const addrLines = companyAddress ? Math.min(wrap(companyAddress, fontR, 8, textZoneW).length, 3) : 0;
  h += addrLines * 10;

  if ([email, website, phone].some(Boolean)) h += 10; // all contacts on one line

  return Math.max(h, logoImg ? logoHMax : 40) + 12;
}

// ── Mono custom header drawing ─────────────────────────────────────────────
function drawMonoHeader(opts: {
  page: PDFPage;
  startY: number;
  fontR: PDFFont;
  fontB: PDFFont;
  logoImg: PDFImage | null;
  companyName: string;
  companyAddress: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  oldSsmNo: string | null;
  newSsmNo: string | null;
  mdaEstablishmentNo: string | null;
  taxNo: string | null;
  nameSize: number;
  nameBold: boolean;
  nameUppercase: boolean;
  headerLayout: string;
  logoHMax: number;
  logoWMax: number;
}): void {
  const {
    page, startY, fontR, fontB, logoImg, companyName, companyAddress,
    phone, email, website, oldSsmNo, newSsmNo, mdaEstablishmentNo, taxNo,
    nameSize, nameBold, nameUppercase, headerLayout, logoHMax, logoWMax,
  } = opts;

  const nameFont = nameBold ? fontB : fontR;
  const dispName = nameUppercase ? companyName.toUpperCase() : companyName;

  let cy    = startY;
  let textX = ML;
  let logoLw = 0;

  if (logoImg) {
    const scale = Math.min(logoHMax / logoImg.height, logoWMax / logoImg.width);
    const logoLh = logoImg.height * scale;
    logoLw = logoImg.width * scale;

    if (headerLayout === "standard") {
      page.drawImage(logoImg, { x: ML, y: cy - logoLh, width: logoLw, height: logoLh });
      textX = ML + logoLw + 8;
    } else if (headerLayout === "logo-top" || headerLayout === "centered") {
      page.drawImage(logoImg, { x: ML, y: cy - logoLh, width: logoLw, height: logoLh });
      cy -= logoLh + 4;
    } else if (headerLayout === "logo-right") {
      page.drawImage(logoImg, { x: W - MR - logoLw, y: cy - logoLh, width: logoLw, height: logoLh });
    }
  }

  const textZoneW = (headerLayout === "logo-right" && logoImg) ? CW - logoLw - 8
    : CW - (textX - ML);

  // Company name — left portion (~65% of text zone so reg numbers fit right)
  const nameY = cy - nameSize;
  page.drawText(trunc(dispName, nameFont, nameSize, textZoneW * 0.65), {
    x: textX, y: nameY, size: nameSize, font: nameFont, color: C_BLACK,
  });

  cy -= nameSize + 8;

  // SSM / MDA Est / Tax No — 6pt, black, below org name
  const regParts: string[] = [];
  if (newSsmNo || oldSsmNo) regParts.push(newSsmNo && oldSsmNo ? `SSM: ${newSsmNo} (${oldSsmNo})` : `SSM: ${newSsmNo ?? oldSsmNo}`);
  if (mdaEstablishmentNo) regParts.push(`MDA Est: ${mdaEstablishmentNo}`);
  if (taxNo) regParts.push(`Tax No: ${taxNo}`);

  if (regParts.length > 0) {
    const regSz  = 6;
    const regText = regParts.join("   ·   ");
    page.drawText(trunc(regText, fontR, regSz, textZoneW), {
      x: textX, y: cy, size: regSz, font: fontR, color: C_BLACK,
    });
    cy -= 10;
  }

  // Address
  if (companyAddress) {
    for (const line of wrap(companyAddress, fontR, 8, textZoneW).slice(0, 3)) {
      page.drawText(line, { x: textX, y: cy, size: 8, font: fontR, color: C_BLACK });
      cy -= 10;
    }
  }

  // Contacts — single compact line
  const contactParts = [
    email   ? sanitizeText(email)   : null,
    website ? sanitizeText(website) : null,
    phone   ? sanitizeText(phone)   : null,
  ].filter(Boolean) as string[];

  if (contactParts.length > 0) {
    page.drawText(trunc(contactParts.join("  ·  "), fontR, 7.5, textZoneW), {
      x: textX, y: cy, size: 7.5, font: fontR, color: C_BLACK,
    });
  }
}

// ── Mono info box height estimator ─────────────────────────────────────────
const INFO_BOX_HDR_H = 22; // height of the column-header row
const INFO_BOX_PAD   = 10; // bottom reserve
const CONTENT_PAD_Y  = 10; // top y-padding below header separator
const INFO_FS        = 7.5;  // content font size — matches table body
const INFO_LH        = 10; // line height inside the info box

function estimateMonoInfoBoxH(opts: { cust: any; title: string | null }): number {
  const { cust, title } = opts;

  let leftH = INFO_FS + 4; // name
  if (cust) {
    if (cust.position || cust.department) leftH += INFO_LH;
    if (cust.organizationName)            leftH += INFO_LH;
    if (cust.organizationAddress)         leftH += INFO_LH * 2;
    if (cust.email || cust.contactNo)     leftH += INFO_LH;
  }

  const rows   = 3 + (title ? 1 : 0);
  const rightH = rows * INFO_LH;

  return INFO_BOX_HDR_H + Math.max(leftH, rightH) + INFO_BOX_PAD + 4;
}

// ── Mono 2-column bordered info box ───────────────────────────────────────
function drawMonoInfoBox(opts: {
  page: PDFPage;
  startY: number;
  boxH: number;
  fontR: PDFFont;
  fontB: PDFFont;
  cust: any;
  quotationNo: string;
  createdAt: Date | string | null;
  validUntil: Date | string | null;
  title: string | null;
  accentColor: Color;
}): void {
  const {
    page, startY, boxH, fontR, fontB, cust,
    quotationNo, createdAt, validUntil, title,
    accentColor,
  } = opts;

  const DIVX = ML + CW * 0.5;
  const PAD  = 8;

  // Outer box
  page.drawRectangle({
    x: ML, y: startY - boxH, width: CW, height: boxH,
    borderColor: C_BLACK, borderWidth: 0.8,
  });

  // Header row — accent fill
  page.drawRectangle({
    x: ML, y: startY - INFO_BOX_HDR_H, width: CW, height: INFO_BOX_HDR_H,
    color: accentColor,
  });

  // Vertical centre divider (full height)
  page.drawLine({
    start: { x: DIVX, y: startY - boxH },
    end:   { x: DIVX, y: startY },
    thickness: 0.6, color: C_BLACK,
  });

  // Horizontal separator beneath column headers
  page.drawLine({
    start: { x: ML,  y: startY - INFO_BOX_HDR_H },
    end:   { x: ML + CW, y: startY - INFO_BOX_HDR_H },
    thickness: 0.5, color: C_BLACK,
  });

  // Column header labels — black text on accent, vertically centred
  const lblY = startY - INFO_BOX_HDR_H / 2 - INFO_FS / 2 + 1;
  page.drawText("CUSTOMER DETAIL", {
    x: ML + PAD, y: lblY, size: INFO_FS, font: fontB, color: C_BLACK,
  });
  page.drawText("QUOTATION DETAIL", {
    x: DIVX + PAD, y: lblY, size: INFO_FS, font: fontB, color: C_BLACK,
  });

  // ── LEFT: customer detail — all INFO_FS, C_BLACK ─────────────────────────
  const leftW = DIVX - ML - PAD * 2;
  let ly = startY - INFO_BOX_HDR_H - CONTENT_PAD_Y;

  const up = (s: string) => s.toUpperCase();

  if (cust) {
    const custName = [cust.title, cust.name].filter(Boolean).join(" ");
    if (custName) {
      page.drawText(trunc(up(custName), fontR, INFO_FS, leftW), {
        x: ML + PAD, y: ly, size: INFO_FS, font: fontR, color: C_BLACK,
      });
      ly -= INFO_LH;
    }
    if (cust.position || cust.department) {
      page.drawText(trunc(up([cust.position, cust.department].filter(Boolean).join(", ")), fontR, INFO_FS, leftW), {
        x: ML + PAD, y: ly, size: INFO_FS, font: fontR, color: C_BLACK,
      });
      ly -= INFO_LH;
    }
    if (cust.organizationName) {
      page.drawText(trunc(up(cust.organizationName), fontR, INFO_FS, leftW), {
        x: ML + PAD, y: ly, size: INFO_FS, font: fontR, color: C_BLACK,
      });
      ly -= INFO_LH;
    }
    if (cust.organizationAddress) {
      for (const l of wrap(up(cust.organizationAddress), fontR, INFO_FS, leftW).slice(0, 2)) {
        page.drawText(l, { x: ML + PAD, y: ly, size: INFO_FS, font: fontR, color: C_BLACK });
        ly -= INFO_LH;
      }
    }
    if (cust.email || cust.contactNo) {
      page.drawText(trunc(up([cust.email, cust.contactNo].filter(Boolean).join("  ·  ")), fontR, INFO_FS, leftW), {
        x: ML + PAD, y: ly, size: INFO_FS, font: fontR, color: C_BLACK,
      });
    }
  } else {
    page.drawText("—", { x: ML + PAD, y: ly, size: INFO_FS, font: fontR, color: C_BLACK });
  }

  // ── RIGHT: quotation detail — labels left-aligned, ":" at fixed column ───
  const rightW = W - MR - DIVX - PAD * 2;
  let ry = startY - INFO_BOX_HDR_H - CONTENT_PAD_Y;

  const detailRows: [string, string][] = [
    ["Quotation No", quotationNo],
    ["Date",         fmtD(createdAt)],
    ["Valid Until",  fmtD(validUntil)],
    ...(title ? [["Subject", title]] as [string, string][] : []),
  ];

  const uRows = detailRows.map(([l, v]) => [up(l), up(v)] as [string, string]);
  const maxLblW  = Math.max(...uRows.map(([l]) => fontR.widthOfTextAtSize(l, INFO_FS)));
  const colonX   = DIVX + PAD + maxLblW + 5;
  const colonW   = fontR.widthOfTextAtSize(":", INFO_FS);
  const valStartX = colonX + colonW + 2;

  for (const [lbl, val] of uRows) {
    page.drawText(lbl, { x: DIVX + PAD, y: ry, size: INFO_FS, font: fontR, color: C_BLACK });
    page.drawText(":", { x: colonX, y: ry, size: INFO_FS, font: fontR, color: C_BLACK });
    page.drawText(trunc(val, fontR, INFO_FS, rightW - maxLblW - colonW - 6), {
      x: valStartX, y: ry, size: INFO_FS, font: fontR, color: C_BLACK,
    });
    ry -= INFO_LH;
  }
}

// ── Number to words (Malaysian currency) ──────────────────────────────────
function numberToWords(n: number): string {
  const ONES = ["","ONE","TWO","THREE","FOUR","FIVE","SIX","SEVEN","EIGHT","NINE",
    "TEN","ELEVEN","TWELVE","THIRTEEN","FOURTEEN","FIFTEEN","SIXTEEN","SEVENTEEN","EIGHTEEN","NINETEEN"];
  const TENS = ["","","TWENTY","THIRTY","FORTY","FIFTY","SIXTY","SEVENTY","EIGHTY","NINETY"];
  function h(x: number): string {
    if (x === 0) return "";
    if (x < 20) return ONES[x];
    if (x < 100) return TENS[Math.floor(x/10)] + (x%10 ? "-"+ONES[x%10] : "");
    return ONES[Math.floor(x/100)]+" HUNDRED"+(x%100 ? " AND "+h(x%100) : "");
  }
  const ringgit = Math.floor(n);
  const sen = Math.round((n - ringgit) * 100);
  let w = "";
  if (ringgit >= 1000000) w += h(Math.floor(ringgit/1000000))+" MILLION ";
  const thou = Math.floor((ringgit%1000000)/1000);
  if (thou > 0) w += h(thou)+" THOUSAND ";
  const rem = ringgit%1000;
  if (rem > 0) w += h(rem)+" ";
  w = (w.trim() || "ZERO")+" RINGGIT";
  if (sen > 0) w += " AND "+h(sen)+" SEN";
  return w+" ONLY";
}

// ── Main export ────────────────────────────────────────────────────────────
export async function generateQuotationMono(data: Data): Promise<Uint8Array> {
  const {
    quotation: q, items,
    orgName, orgLogoUrl,
    orgCompanyName, orgCompanyAddress, orgTaxNo, orgPhone,
    orgEmail, orgWebsite, orgOldSsmNo, orgNewSsmNo, orgMdaEstablishmentNo,
    orgBankingInfo,
    orgMofCertUrl, orgSsmCertUrl, orgMdaCertUrl, orgTccCertUrl,
    orgBankStatementUrl, orgLampiran12Url, orgLampiran13Url,
  } = data;

  const fmtAcct = (n: number) => {
    const [int, dec] = n.toFixed(2).split(".");
    return `${int.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${dec}`;
  };

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

  const accentColor = hexToColor(data.orgBrandColor) ?? C_HDR_BG;

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
  const LOGO_H_MAX = 51;   // 42 × 1.2
  const LOGO_W_MAX = 130;  // 108 × 1.2

  const showCode  = !!Number(q.showProductCode ?? 1);
  const showMdaCerts = !!Number(q.includeMdaCerts ?? 1);
  // All body text matches the 7.5pt table header — uniform, no bold
  const FS_BODY   = 7.5;
  const LH        = 10;   // line height for wrapped description
  const RH_MIN    = 14;   // minimum row height
  const MDA_GAP   = 3;

  // ── Column widths ─────────────────────────────────────────────────────────
  const C_NO   = 22;
  const C_CODE = showCode ? 65 : 0;
  const C_QTY  = 28;
  const C_UOM  = 34;
  const C_UP   = 64;
  const C_DISC = showDisc ? 55 : 0;
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
  const hLayout   = data.orgHeaderLayout ?? "standard";
  const QL_SIZE   = ({ small: 5.5, normal: 7, large: 10 } as Record<string,number>)[data.orgQuotationLabelSize ?? "normal"] ?? 7;

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
    const rentalPrefix = item.lineType === "rent" && item.rentalDuration
      ? `rental for ${item.rentalDuration} ${item.rentalUnit ?? "case"} `
      : "";
    const descLines  = wrap(`${rentalPrefix}${item.description ?? "—"}`.toUpperCase(), fontR, FS_BODY, C_DESCA - TABLE_PAD * 2);
    const extraLine  = showMdaCerts && item.hasCert && item.mdaRegNo
      ? `MDA: ${item.mdaRegNo}${item.mdaValidity ? ` · Exp: ${fmtD(item.mdaValidity)}` : ""}`
      : (showMdaCerts && !item.hasCert ? "No MDA certificate" : null);
    const isGreenRow = !!(item.hasCert && item.mdaRegNo);
    const codeLineH  = 0;
    const hasItemDisc = showDisc && Number(item.discountPct ?? 0) > 0;
    const rowH = Math.max(
      hasItemDisc ? 22 : RH_MIN,
      codeLineH + descLines.length * LH + (extraLine ? RH_MIN + MDA_GAP + 2 : 6),
    );
    return { item, descLines, extraLine, isGreenRow, rowH };
  });

  // ── Height estimates ──────────────────────────────────────────────────────
  const HEADER_BLOCK = estimateMonoHeaderH({
    companyAddress: orgCompanyAddress, phone: orgPhone, email: orgEmail,
    website: orgWebsite, nameSize, logoHMax: LOGO_H_MAX, logoWMax: LOGO_W_MAX,
    headerLayout: hLayout, logoImg, fontR,
    oldSsmNo: orgOldSsmNo, newSsmNo: orgNewSsmNo,
    mdaEstablishmentNo: orgMdaEstablishmentNo, taxNo: orgTaxNo,
  }) + 6;

  const DIVIDER_GAP   = 10;
  const TABLE_HDR_H   = 20;
  const INFO_BLOCK    = estimateMonoInfoBoxH({ cust, title: q.title ?? null });

  const totRowCount  = 1 + (showDisc && itemDiscPerSet > 0 ? 2 : 0) + (sets > 1 ? 1 : 0) + (discAmt > 0 ? 3 : 0) + (sstAmt > 0 ? 1 : 0);
  const noteLines    = q.notes ? wrap(q.notes, fontR, 9.5, CW - 20) : [];
  const SUMMARY_ROW_H = TABLE_HDR_H;             // subtotal & grand total rows inside the table
  const BTM_TABLE_H   = TABLE_HDR_H + 42;         // 2-col footer table (header + 3 right-col rows)
  const TOTALS_H      = (2 + (sets > 1 ? 1 : 0) + (discAmt > 0 ? 1 : 0)) * SUMMARY_ROW_H + 8 + BTM_TABLE_H + 8;
  const TOT_PAD       = 5;                        // inner padding for summary / footer rows
  const NOTES_H      = q.notes ? noteLines.length * 12 + 30 : 0;
  const FOOTER_BLOCK = 30;
  const CLOSING_H    = 38;
  const ACCEPT_H     = 0;
  const SUB_HDR_H = 14;
  const BPAD      = 8;
  const BHALF_W   = CW * 0.5 - BPAD * 2;
  const BCOLON_W  = fontR.widthOfTextAtSize(":", FS_BODY);

  // Bank Detail — pre-wrap values for dynamic height
  const bLLabels = ["BANK NAME", "BRANCH"];
  const bRLabels = ["ACCOUNT NO.", "ACCOUNT NAME"];
  let bLMaxW = 0, bRMaxW = 0;
  let bPreL: string[][] = [];
  let bPreR: string[][] = [];
  let BANK_BOX_H = 0;
  if (bank) {
    bLMaxW = Math.max(...bLLabels.map(l => fontR.widthOfTextAtSize(l, FS_BODY)));
    bRMaxW = Math.max(...bRLabels.map(l => fontR.widthOfTextAtSize(l, FS_BODY)));
    const bLValW = BHALF_W - bLMaxW - BCOLON_W - 8;
    const bRValW = BHALF_W - bRMaxW - BCOLON_W - 8;
    bPreL = [
      wrap(String((bank as any).bankName      ?? "—").toUpperCase(), fontR, FS_BODY, bLValW),
      wrap(String((bank as any).branch        ?? "—").toUpperCase(), fontR, FS_BODY, bLValW),
    ];
    bPreR = [
      wrap(String((bank as any).accountNo     ?? "—").toUpperCase(), fontR, FS_BODY, bRValW),
      wrap(String((bank as any).accountHolder ?? "—").toUpperCase(), fontR, FS_BODY, bRValW),
    ];
    const bConH = Math.max(
      bPreL.reduce((s, ls) => s + ls.length, 0),
      bPreR.reduce((s, ls) => s + ls.length, 0),
    ) * INFO_LH + 8;
    BANK_BOX_H = TABLE_HDR_H + SUB_HDR_H + bConH;
  }

  // Terms & Conditions — pre-wrap values for dynamic height
  const tLLabels = ["PRICE VALIDITY", "DELIVERY"];
  const tRLabels = ["PAYMENT TERM", ...((q as any).warranty ? ["WARRANTY"] : []), "RETURN POLICY"];
  const tLMaxW = Math.max(...tLLabels.map(l => fontR.widthOfTextAtSize(l, FS_BODY)));
  const tRMaxW = Math.max(...tRLabels.map(l => fontR.widthOfTextAtSize(l, FS_BODY)));
  const tLValW = BHALF_W - tLMaxW - BCOLON_W - 8;
  const tRValW = BHALF_W - tRMaxW - BCOLON_W - 8;
  const tPreL = [
    wrap(fmtD(q.validUntil).toUpperCase(),                      fontR, FS_BODY, tLValW),
    wrap(String((q as any).deliveryTerm  ?? "—").toUpperCase(), fontR, FS_BODY, tLValW),
  ];
  const tPreR = [
    wrap(String((q as any).paymentTerm  ?? "—").toUpperCase(), fontR, FS_BODY, tRValW),
    ...((q as any).warranty ? [wrap(String((q as any).warranty).toUpperCase(), fontR, FS_BODY, tRValW)] : []),
    wrap(String((q as any).returnPolicy ?? "—").toUpperCase(), fontR, FS_BODY, tRValW),
  ];
  const tConH = Math.max(
    tPreL.reduce((s, ls) => s + ls.length, 0),
    tPreR.reduce((s, ls) => s + ls.length, 0),
  ) * INFO_LH + 8;
  const TERMS_BOX_H = TABLE_HDR_H + SUB_HDR_H + tConH;

  const BOTTOM_RESERVE = TOTALS_H + NOTES_H + FOOTER_BLOCK + 16 + CLOSING_H + (bank ? BANK_BOX_H + 8 : 0) + TERMS_BOX_H + 8 + ACCEPT_H;

  const P1_ROW_AVAIL = H - MT - HEADER_BLOCK - DIVIDER_GAP - INFO_BLOCK - DIVIDER_GAP - TABLE_HDR_H - MB - 30;
  const PN_ROW_AVAIL = H - MT - 28 - TABLE_HDR_H - MB - 26;

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

  // Ensure last page fits totals
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
    hLine(page, MB + 22, ML, W - MR, C_BORDER, 0.5);
    page.drawText("Computer generated document. No signature required.", {
      x: ML, y: MB + 10, size: 7.5, font: fontR, color: C_FAINT,
    });
    const pgText = `${q.quotationNo}  ·  Page ${pi + 1} of ${totalPages}`;
    const pgW    = fontR.widthOfTextAtSize(pgText, 7.5);
    page.drawText(pgText, { x: W - MR - pgW, y: MB + 10, size: 7.5, font: fontR, color: C_FAINT });

    let curY = H - MT;

    // ── Page 1: header + info box ────────────────────────────────────────────
    if (isFirst) {
      drawMonoHeader({
        page, startY: curY, fontR, fontB, logoImg,
        companyName: coName, companyAddress: orgCompanyAddress,
        phone: orgPhone, email: orgEmail, website: orgWebsite,
        oldSsmNo: orgOldSsmNo, newSsmNo: orgNewSsmNo,
        mdaEstablishmentNo: orgMdaEstablishmentNo, taxNo: orgTaxNo,
        nameSize, nameBold: !!(data.orgNameBold ?? 1),
        nameUppercase: !!(data.orgNameUppercase ?? 0),
        headerLayout: hLayout, logoHMax: LOGO_H_MAX, logoWMax: LOGO_W_MAX,
      });
      curY -= HEADER_BLOCK;

      // Document label — sits just above the divider line
      {
        const qlFont  = !!(data.orgQuotationLabelBold ?? 1) ? fontB : fontR;
        const qlText  = !!(data.orgQuotationLabelUppercase ?? 1)
          ? "QUOTATION"
          : "Quotation";
        const qlW     = qlFont.widthOfTextAtSize(qlText, QL_SIZE);
        const qlAlign = (data.orgQuotationLabelAlign as string | null) ?? "right";
        const qlX     = qlAlign === "left"   ? ML
                      : qlAlign === "center" ? ML + (CW - qlW) / 2
                      :                        W - MR - qlW;
        page.drawText(qlText, {
          x: qlX, y: curY + QL_SIZE + 2,
          size: QL_SIZE, font: qlFont, color: C_BLACK,
        });
      }

      hLine(page, curY, ML, W - MR, C_BLACK, 1.0);
      curY -= DIVIDER_GAP;

      // 2-column bordered info box
      drawMonoInfoBox({
        page, startY: curY, boxH: INFO_BLOCK, fontR, fontB, cust,
        quotationNo: q.quotationNo, createdAt: q.createdAt,
        validUntil: q.validUntil, title: q.title ?? null,
        accentColor,
      });
      curY -= INFO_BLOCK + DIVIDER_GAP + 4;

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

    // ── Table header — black fill, white text ─────────────────────────────
    const thdrs: { label: string; x: number; w: number }[] = [
      { label: "No",                          x: X_NO,   w: C_NO   },
      ...(showCode ? [{ label: "Catalog No", x: X_CODE, w: C_CODE  }] : []),
      { label: "Name of Product / Service",  x: X_DESC, w: C_DESCA },
      { label: "Qty",         x: X_QTY,  w: C_QTY  },
      { label: "UOM",         x: X_UOM,  w: C_UOM  },
      { label: "Unit Price",  x: X_UP,   w: C_UP   },
      ...(showDisc ? [{ label: "Discount",    x: X_DISC, w: C_DISC  }] : []),
      ...(showTP   ? [{ label: "Total",      x: X_TOT,  w: C_TOT   }] : []),
    ];

    const tHdrY = curY - TABLE_HDR_H;
    page.drawRectangle({ x: ML, y: tHdrY, width: CW, height: TABLE_HDR_H, color: accentColor });

    for (const col of thdrs) {
      const tw = fontB.widthOfTextAtSize(col.label.toUpperCase(), FS_BODY);
      page.drawText(col.label.toUpperCase(), {
        x: col.x + (col.w - tw) / 2, y: tHdrY + 6, size: FS_BODY, font: fontB, color: C_BLACK,
      });
    }

    for (const col of thdrs.slice(1)) {
      page.drawLine({
        start: { x: col.x, y: tHdrY },
        end:   { x: col.x, y: tHdrY + TABLE_HDR_H },
        thickness: 0.4, color: C_BLACK,
      });
    }

    curY = tHdrY;

    page.drawLine({
      start: { x: ML, y: curY + TABLE_HDR_H },
      end:   { x: W - MR, y: curY + TABLE_HDR_H },
      thickness: 0.8, color: C_BORDER,
    });
    page.drawLine({ start: { x: ML,     y: curY + TABLE_HDR_H }, end: { x: ML,     y: curY }, thickness: 0.8, color: C_BORDER });
    page.drawLine({ start: { x: W - MR, y: curY + TABLE_HDR_H }, end: { x: W - MR, y: curY }, thickness: 0.8, color: C_BORDER });

    // ── Item rows ────────────────────────────────────────────────────────────
    for (const entryIdx of pageItems) {
      const entry = renderItems[entryIdx];
      if (entry.kind === "setHeader") {
        const hdrY  = curY - SET_HDR_H;
        const textY = hdrY + (SET_HDR_H - FS_BODY) / 2;
        page.drawRectangle({ x: ML, y: hdrY, width: CW, height: SET_HDR_H, color: rgb(0.90, 0.93, 0.97) });
        const labelW = fontB.widthOfTextAtSize(entry.label.toUpperCase(), FS_BODY);
        page.drawText(entry.label.toUpperCase(), { x: ML + TABLE_PAD, y: textY, size: FS_BODY, font: fontB, color: C_BLACK });
        page.drawText(`  x  ${entry.qty} ${entry.qty === 1 ? "SET" : "SETS"}`, { x: ML + TABLE_PAD + labelW, y: textY, size: FS_BODY, font: fontR, color: C_FAINT });
        if (showTP) {
          const totStr = `RM ${entry.setTotal.toFixed(2)}`;
          const totW = fontB.widthOfTextAtSize(totStr, FS_BODY);
          page.drawText(totStr, { x: X_TOT + C_TOT - TABLE_PAD - totW, y: textY, size: FS_BODY, font: fontB, color: C_BLACK });
        }
        hLine(page, hdrY, ML, W - MR, C_BLACK, 0.5);
        curY = hdrY;
        continue;
      }
      const rowIdx = entry.rowIdx;
      const { item, descLines, extraLine, isGreenRow, rowH } = rowInfos[rowIdx];
      const rowY = curY - rowH;
      const textBaseline = curY - 11;

      page.drawLine({ start: { x: ML,     y: rowY }, end: { x: W - MR, y: rowY }, thickness: 0.3, color: C_BORDER });
      page.drawLine({ start: { x: ML,     y: rowY }, end: { x: ML,     y: curY }, thickness: 0.8, color: C_BORDER });
      page.drawLine({ start: { x: W - MR, y: rowY }, end: { x: W - MR, y: curY }, thickness: 0.8, color: C_BORDER });

      for (const col of thdrs.slice(1)) {
        page.drawLine({
          start: { x: col.x, y: rowY },
          end:   { x: col.x, y: curY },
          thickness: 0.3, color: C_BLACK,
        });
      }

      // No
      const noW = fontR.widthOfTextAtSize(String(item.rowNo), FS_BODY);
      page.drawText(String(item.rowNo), {
        x: X_NO + (C_NO - noW) / 2, y: textBaseline,
        size: FS_BODY, font: fontR, color: C_BLACK,
      });

      // Code column or inline code
      let dy = textBaseline;
      if (showCode) {
        page.drawText(trunc(item.productCode ?? "—", fontR, FS_BODY, C_CODE - TABLE_PAD * 2), {
          x: X_CODE + TABLE_PAD, y: dy, size: FS_BODY, font: fontR, color: C_BLACK,
        });
      }

      // Description + cert line — all FS_BODY, all black
      for (const line of descLines) {
        page.drawText(line, { x: X_DESC + TABLE_PAD, y: dy, size: FS_BODY, font: fontR, color: C_BLACK });
        dy -= LH;
      }
      if (extraLine) {
        dy -= MDA_GAP;
        page.drawText(extraLine, {
          x: X_DESC + TABLE_PAD, y: dy,
          size: FS_BODY, font: fontR, color: C_BLACK,
        });
      }

      // Qty
      const qtyW = fontR.widthOfTextAtSize(String(item.qty ?? 0), FS_BODY);
      page.drawText(String(item.qty ?? 0), {
        x: X_QTY + (C_QTY - qtyW) / 2, y: textBaseline, size: FS_BODY, font: fontR, color: C_BLACK,
      });

      // UOM
      const uom  = item.uom || "—";
      const uomW = fontR.widthOfTextAtSize(uom, FS_BODY);
      page.drawText(uom, {
        x: X_UOM + (C_UOM - uomW) / 2, y: textBaseline, size: FS_BODY, font: fontR, color: C_BLACK,
      });

      // Unit Price — "RM" left, value right-aligned (accounting format)
      const upNum  = fmtAcct(Number(item.unitPrice ?? 0));
      const upNumW = fontR.widthOfTextAtSize(upNum, FS_BODY);
      page.drawText("RM", { x: X_UP + TABLE_PAD, y: textBaseline, size: FS_BODY, font: fontR, color: C_BLACK });
      page.drawText(upNum, { x: X_UP + C_UP - TABLE_PAD - upNumW, y: textBaseline, size: FS_BODY, font: fontR, color: C_BLACK });

      // Discount amount + percentage
      if (showDisc) {
        const itemDiscAmt = Number(item.discountAmt ?? 0);
        const itemDiscPct = Number(item.discountPct ?? 0);
        if (itemDiscAmt > 0) {
          const discNum  = fmtAcct(itemDiscAmt);
          const discNumW = fontR.widthOfTextAtSize(discNum, FS_BODY);
          page.drawText("RM", { x: X_DISC + TABLE_PAD, y: textBaseline, size: FS_BODY, font: fontR, color: C_BLACK });
          page.drawText(discNum, { x: X_DISC + C_DISC - TABLE_PAD - discNumW, y: textBaseline, size: FS_BODY, font: fontR, color: C_BLACK });
          const pctStr  = `(${itemDiscPct}%)`;
          const pctStrW = fontR.widthOfTextAtSize(pctStr, FS_BODY - 1);
          page.drawText(pctStr, { x: X_DISC + (C_DISC - pctStrW) / 2, y: textBaseline - 9, size: FS_BODY - 1, font: fontR, color: C_BLACK });
        } else {
          const dash  = "—";
          const dashW = fontR.widthOfTextAtSize(dash, FS_BODY);
          page.drawText(dash, { x: X_DISC + (C_DISC - dashW) / 2, y: textBaseline, size: FS_BODY, font: fontR, color: C_BLACK });
        }
      }

      // Total — "RM" left, value right-aligned (accounting format)
      if (showTP) {
        const totNum  = fmtAcct(Number(item.totalPrice ?? 0));
        const totNumW = fontR.widthOfTextAtSize(totNum, FS_BODY);
        page.drawText("RM", { x: X_TOT + TABLE_PAD, y: textBaseline, size: FS_BODY, font: fontR, color: C_BLACK });
        page.drawText(totNum, { x: X_TOT + C_TOT - TABLE_PAD - totNumW, y: textBaseline, size: FS_BODY, font: fontR, color: C_BLACK });
      }

      curY = rowY;
    }

    // ── On last page: subtotal + grand total rows inside the items table ───────
    if (isLast) {
      const totalQtyPerSet = items.reduce((s, i) => s + parseFloat(i.qty ?? "0"), 0);
      const fmtQty = (n: number) => n % 1 === 0 ? String(n) : n.toFixed(2);
      const amtAreaW = W - MR - X_UP; // width of merged cols 6-7 amount area

      // ── Subtotal row ────────────────────────────────────────────────────────
      const subLabel = sets > 1 ? `SUBTOTAL × 1 SET` : "SUBTOTAL";
      const subRowY  = curY - SUMMARY_ROW_H;
      // Borders
      page.drawLine({ start: { x: ML,     y: subRowY }, end: { x: W - MR, y: subRowY }, thickness: 0.8, color: C_BLACK });
      page.drawLine({ start: { x: ML,     y: curY    }, end: { x: ML,     y: subRowY }, thickness: 0.8, color: C_BLACK });
      page.drawLine({ start: { x: W - MR, y: curY    }, end: { x: W - MR, y: subRowY }, thickness: 0.8, color: C_BLACK });
      // Column dividers: after col-3, before amount area (cols 4&5 merged, no X_UOM divider)
      page.drawLine({ start: { x: X_QTY, y: curY }, end: { x: X_QTY, y: subRowY }, thickness: 0.3, color: C_BLACK });
      page.drawLine({ start: { x: X_UP,  y: curY }, end: { x: X_UP,  y: subRowY }, thickness: 0.3, color: C_BLACK });
      // Label cols 1-3
      page.drawText(subLabel, { x: X_NO + TOT_PAD, y: subRowY + 6, size: FS_BODY, font: fontB, color: C_BLACK });
      // Qty cols 4-5 merged — centered in X_QTY to X_UP
      const subQtyStr = fmtQty(totalQtyPerSet);
      const subQtyW   = fontR.widthOfTextAtSize(subQtyStr, FS_BODY);
      page.drawText(subQtyStr, { x: X_QTY + ((C_QTY + C_UOM) - subQtyW) / 2, y: subRowY + 6, size: FS_BODY, font: fontR, color: C_BLACK });
      // Amount cols 6-7 — centered in merged area (1-set amount)
      const subStr  = fmtM(subtotalPerSet);
      const subStrW = fontR.widthOfTextAtSize(subStr, FS_BODY);
      page.drawText(subStr, { x: X_UP + (amtAreaW - subStrW) / 2, y: subRowY + 6, size: FS_BODY, font: fontR, color: C_BLACK });
      curY = subRowY;

      // ── Subtotal × N sets row ───────────────────────────────────────────────
      if (sets > 1) {
        const snsRowY = curY - SUMMARY_ROW_H;
        page.drawLine({ start: { x: ML,     y: snsRowY }, end: { x: W - MR, y: snsRowY }, thickness: 0.8, color: C_BLACK });
        page.drawLine({ start: { x: ML,     y: curY    }, end: { x: ML,     y: snsRowY }, thickness: 0.8, color: C_BLACK });
        page.drawLine({ start: { x: W - MR, y: curY    }, end: { x: W - MR, y: snsRowY }, thickness: 0.8, color: C_BLACK });
        page.drawLine({ start: { x: X_QTY, y: curY }, end: { x: X_QTY, y: snsRowY }, thickness: 0.3, color: C_BLACK });
        page.drawLine({ start: { x: X_UP,  y: curY }, end: { x: X_UP,  y: snsRowY }, thickness: 0.3, color: C_BLACK });
        page.drawText(`SUBTOTAL × ${sets} SETS`, { x: X_NO + TOT_PAD, y: snsRowY + 6, size: FS_BODY, font: fontB, color: C_BLACK });
        const snsQtyStr = fmtQty(totalQtyPerSet * sets);
        const snsQtyW   = fontR.widthOfTextAtSize(snsQtyStr, FS_BODY);
        page.drawText(snsQtyStr, { x: X_QTY + ((C_QTY + C_UOM) - snsQtyW) / 2, y: snsRowY + 6, size: FS_BODY, font: fontR, color: C_BLACK });
        const snsStr  = fmtM(subtotal);
        const snsStrW = fontR.widthOfTextAtSize(snsStr, FS_BODY);
        page.drawText(snsStr, { x: X_UP + (amtAreaW - snsStrW) / 2, y: snsRowY + 6, size: FS_BODY, font: fontR, color: C_BLACK });
        curY = snsRowY;
      }

      // ── Overall discount row ────────────────────────────────────────────────
      if (discAmt > 0) {
        const odRowY = curY - SUMMARY_ROW_H;
        page.drawLine({ start: { x: ML,     y: odRowY }, end: { x: W - MR, y: odRowY }, thickness: 0.8, color: C_BLACK });
        page.drawLine({ start: { x: ML,     y: curY   }, end: { x: ML,     y: odRowY }, thickness: 0.8, color: C_BLACK });
        page.drawLine({ start: { x: W - MR, y: curY   }, end: { x: W - MR, y: odRowY }, thickness: 0.8, color: C_BLACK });
        page.drawLine({ start: { x: X_QTY, y: curY }, end: { x: X_QTY, y: odRowY }, thickness: 0.3, color: C_BLACK });
        page.drawLine({ start: { x: X_UP,  y: curY }, end: { x: X_UP,  y: odRowY }, thickness: 0.3, color: C_BLACK });
        page.drawText("OVERALL DISCOUNT", { x: X_NO + TOT_PAD, y: odRowY + 6, size: FS_BODY, font: fontB, color: C_BLACK });
        const odPctStr  = `(${q.overallDiscountPct}%)`;
        const odPctW    = fontR.widthOfTextAtSize(odPctStr, FS_BODY);
        page.drawText(odPctStr, { x: X_QTY + ((C_QTY + C_UOM) - odPctW) / 2, y: odRowY + 6, size: FS_BODY, font: fontR, color: C_BLACK });
        const odStr  = `- ${fmtM(discAmt)}`;
        const odStrW = fontR.widthOfTextAtSize(odStr, FS_BODY);
        page.drawText(odStr, { x: X_UP + (amtAreaW - odStrW) / 2, y: odRowY + 6, size: FS_BODY, font: fontR, color: C_BLACK });
        curY = odRowY;
      }

      // ── Grand total row (accent fill) ───────────────────────────────────────
      const gtLabel       = sets > 1 ? `TOTAL BEFORE TAX × ${sets} SETS` : "TOTAL BEFORE TAX";
      const totalQtyAllSets = totalQtyPerSet * sets;
      const gtRowY        = curY - SUMMARY_ROW_H;
      page.drawRectangle({ x: ML, y: gtRowY, width: CW, height: SUMMARY_ROW_H, color: accentColor });
      // Borders
      page.drawLine({ start: { x: ML,     y: gtRowY }, end: { x: W - MR, y: gtRowY }, thickness: 0.8, color: C_BLACK });
      page.drawLine({ start: { x: ML,     y: curY   }, end: { x: ML,     y: gtRowY }, thickness: 0.8, color: C_BLACK });
      page.drawLine({ start: { x: W - MR, y: curY   }, end: { x: W - MR, y: gtRowY }, thickness: 0.8, color: C_BLACK });
      // Column dividers: after col-3, before amount area (cols 4&5 merged, no X_UOM divider)
      page.drawLine({ start: { x: X_QTY, y: curY }, end: { x: X_QTY, y: gtRowY }, thickness: 0.3, color: C_BLACK });
      page.drawLine({ start: { x: X_UP,  y: curY }, end: { x: X_UP,  y: gtRowY }, thickness: 0.3, color: C_BLACK });
      // Label cols 1-3
      page.drawText(gtLabel, { x: X_NO + TOT_PAD, y: gtRowY + 6, size: FS_BODY, font: fontB, color: C_BLACK });
      // Qty cols 4-5 merged — centered in X_QTY to X_UP
      const gtQtyStr = fmtQty(totalQtyAllSets);
      const gtQtyW   = fontB.widthOfTextAtSize(gtQtyStr, FS_BODY);
      page.drawText(gtQtyStr, { x: X_QTY + ((C_QTY + C_UOM) - gtQtyW) / 2, y: gtRowY + 6, size: FS_BODY, font: fontB, color: C_BLACK });
      // Amount cols 6-7 merged — centered in merged area
      const gtAmtStr = fmtM(afterDisc);
      const gtAmtW   = fontB.widthOfTextAtSize(gtAmtStr, FS_BODY);
      page.drawText(gtAmtStr, { x: X_UP + (amtAreaW - gtAmtW) / 2, y: gtRowY + 6, size: FS_BODY, font: fontB, color: C_BLACK });
      curY = gtRowY;
    }

    // Close table bottom border (after summary rows on last page)
    page.drawLine({ start: { x: ML, y: curY }, end: { x: W - MR, y: curY }, thickness: 0.8, color: C_BORDER });

    // ── Last page: footer content ──────────────────────────────────────────
    if (isLast) {
      // ── 2-column footer table ───────────────────────────────────────────────
      curY -= 8;
      const LEFT_COL_W  = CW * 0.65;
      const RIGHT_COL_X = ML + LEFT_COL_W;
      const BTM_HDR_H   = TABLE_HDR_H;
      const wordsText   = numberToWords(grand);
      const RIGHT_ROW_H = 14; // height of each right-column sub-row
      const wordsLines  = wrap(wordsText, fontR, FS_BODY, LEFT_COL_W - TOT_PAD * 2).slice(0, 4);
      const btmConH     = Math.max(wordsLines.length * INFO_LH + 6, 3 * RIGHT_ROW_H);
      const btmTotalH   = BTM_HDR_H + btmConH;

      // Outer border
      page.drawRectangle({
        x: ML, y: curY - btmTotalH, width: CW, height: btmTotalH,
        borderColor: C_BLACK, borderWidth: 0.8,
      });

      // Header row — accent fill
      page.drawRectangle({
        x: ML, y: curY - BTM_HDR_H, width: CW, height: BTM_HDR_H,
        color: accentColor,
      });

      // Vertical divider (full height)
      page.drawLine({
        start: { x: RIGHT_COL_X, y: curY - btmTotalH },
        end:   { x: RIGHT_COL_X, y: curY },
        thickness: 0.6, color: C_BLACK,
      });

      // Horizontal separator below header
      page.drawLine({
        start: { x: ML,      y: curY - BTM_HDR_H },
        end:   { x: ML + CW, y: curY - BTM_HDR_H },
        thickness: 0.5, color: C_BLACK,
      });

      // Header labels (black text)
      const btmLblY = curY - BTM_HDR_H / 2 - FS_BODY / 2 + 1;
      page.drawText("TOTAL IN WORDS", {
        x: ML + TOT_PAD, y: btmLblY, size: FS_BODY, font: fontB, color: C_BLACK,
      });
      page.drawText("AMOUNT SUMMARY", {
        x: RIGHT_COL_X + TOT_PAD, y: btmLblY, size: FS_BODY, font: fontB, color: C_BLACK,
      });

      // Content — total in words (left column, vertically centred)
      const wordsTextH = wordsLines.length * INFO_LH;
      let wy = (curY - BTM_HDR_H) - Math.floor((btmConH - wordsTextH) / 2);
      for (const line of wordsLines) {
        page.drawText(line, { x: ML + TOT_PAD, y: wy, size: FS_BODY, font: fontR, color: C_BLACK });
        wy -= INFO_LH;
      }

      // Right column — 3 sub-rows: Taxable Amount | SST | Total After Tax
      const rTop    = curY - BTM_HDR_H; // top of right content area
      const rightW  = W - MR - RIGHT_COL_X - TOT_PAD;

      // Row 1: taxable amount — label left, amount right
      page.drawLine({ start: { x: RIGHT_COL_X, y: rTop - RIGHT_ROW_H }, end: { x: W - MR, y: rTop - RIGHT_ROW_H }, thickness: 0.3, color: C_BLACK });
      page.drawText("TAXABLE AMOUNT (MYR)", { x: RIGHT_COL_X + TOT_PAD, y: rTop - RIGHT_ROW_H + 4, size: FS_BODY, font: fontR, color: C_BLACK });
      const taxStr  = fmtM(afterDisc);
      const taxStrW = fontR.widthOfTextAtSize(taxStr, FS_BODY);
      page.drawText(taxStr, { x: W - MR - TOT_PAD - taxStrW, y: rTop - RIGHT_ROW_H + 4, size: FS_BODY, font: fontR, color: C_BLACK });

      // Row 2: SST (X%) — label left, amount right
      const sstLabel = `SST (${q.sstPct ?? "0"}%)`;
      page.drawLine({ start: { x: RIGHT_COL_X, y: rTop - 2 * RIGHT_ROW_H }, end: { x: W - MR, y: rTop - 2 * RIGHT_ROW_H }, thickness: 0.3, color: C_BLACK });
      page.drawText(sstLabel, { x: RIGHT_COL_X + TOT_PAD, y: rTop - 2 * RIGHT_ROW_H + 4, size: FS_BODY, font: fontR, color: C_BLACK });
      const sstValStr = fmtM(sstAmt);
      const sstValW   = fontR.widthOfTextAtSize(sstValStr, FS_BODY);
      page.drawText(sstValStr, { x: W - MR - TOT_PAD - sstValW, y: rTop - 2 * RIGHT_ROW_H + 4, size: FS_BODY, font: fontR, color: C_BLACK });

      // Row 3: TOTAL AFTER TAX — label left, grand total right, bold
      page.drawText("TOTAL AFTER TAX", { x: RIGHT_COL_X + TOT_PAD, y: rTop - 3 * RIGHT_ROW_H + 4, size: FS_BODY, font: fontB, color: C_BLACK });
      const tatStr  = fmtM(grand);
      const tatStrW = fontB.widthOfTextAtSize(tatStr, FS_BODY);
      page.drawText(tatStr, { x: W - MR - TOT_PAD - tatStrW, y: rTop - 3 * RIGHT_ROW_H + 4, size: FS_BODY, font: fontB, color: C_BLACK });

      curY -= btmTotalH;

      // ── Bank Detail table ──────────────────────────────────────────────────
      if (bank) {
        const DIVX2  = ML + CW * 0.5;
        const bLColX = ML    + BPAD + bLMaxW + 4;
        const bRColX = DIVX2 + BPAD + bRMaxW + 4;
        const bValLX = bLColX + BCOLON_W + 3;
        const bValRX = bRColX + BCOLON_W + 3;

        page.drawRectangle({ x: ML, y: curY - BANK_BOX_H, width: CW, height: BANK_BOX_H, borderColor: C_BLACK, borderWidth: 0.8 });
        page.drawRectangle({ x: ML, y: curY - TABLE_HDR_H, width: CW, height: TABLE_HDR_H, color: accentColor });
        page.drawLine({ start: { x: ML, y: curY - TABLE_HDR_H }, end: { x: ML + CW, y: curY - TABLE_HDR_H }, thickness: 0.5, color: C_BLACK });
        page.drawText("BANK DETAIL", { x: ML + BPAD, y: curY - TABLE_HDR_H / 2 - FS_BODY / 2 + 1, size: FS_BODY, font: fontB, color: C_BLACK });

        const bSubTop  = curY - TABLE_HDR_H;
        page.drawLine({ start: { x: ML, y: bSubTop - SUB_HDR_H }, end: { x: ML + CW, y: bSubTop - SUB_HDR_H }, thickness: 0.4, color: C_BLACK });
        page.drawLine({ start: { x: DIVX2, y: curY - BANK_BOX_H }, end: { x: DIVX2, y: curY - TABLE_HDR_H }, thickness: 0.6, color: C_BLACK });
        const bSubLblY = bSubTop - SUB_HDR_H / 2 - FS_BODY / 2 + 1;
        page.drawText("BANK INFO",       { x: ML    + BPAD, y: bSubLblY, size: FS_BODY, font: fontB, color: C_BLACK });
        page.drawText("ACCOUNT DETAILS", { x: DIVX2 + BPAD, y: bSubLblY, size: FS_BODY, font: fontB, color: C_BLACK });

        let bLy = bSubTop - SUB_HDR_H - 8;
        for (let i = 0; i < bLLabels.length; i++) {
          page.drawText(bLLabels[i], { x: ML + BPAD, y: bLy, size: FS_BODY, font: fontR, color: C_BLACK });
          page.drawText(":", { x: bLColX, y: bLy, size: FS_BODY, font: fontR, color: C_BLACK });
          for (const line of bPreL[i]) {
            page.drawText(line, { x: bValLX, y: bLy, size: FS_BODY, font: fontR, color: C_BLACK });
            bLy -= INFO_LH;
          }
        }
        let bRy = bSubTop - SUB_HDR_H - 8;
        for (let i = 0; i < bRLabels.length; i++) {
          page.drawText(bRLabels[i], { x: DIVX2 + BPAD, y: bRy, size: FS_BODY, font: fontR, color: C_BLACK });
          page.drawText(":", { x: bRColX, y: bRy, size: FS_BODY, font: fontR, color: C_BLACK });
          for (const line of bPreR[i]) {
            page.drawText(line, { x: bValRX, y: bRy, size: FS_BODY, font: fontR, color: C_BLACK });
            bRy -= INFO_LH;
          }
        }
        curY -= BANK_BOX_H;
      }

      // ── Terms & Conditions table ───────────────────────────────────────────
      {
        const DIVX2  = ML + CW * 0.5;
        const tLColX = ML    + BPAD + tLMaxW + 4;
        const tRColX = DIVX2 + BPAD + tRMaxW + 4;
        const tValLX = tLColX + BCOLON_W + 3;
        const tValRX = tRColX + BCOLON_W + 3;

        page.drawRectangle({ x: ML, y: curY - TERMS_BOX_H, width: CW, height: TERMS_BOX_H, borderColor: C_BLACK, borderWidth: 0.8 });
        page.drawRectangle({ x: ML, y: curY - TABLE_HDR_H, width: CW, height: TABLE_HDR_H, color: accentColor });
        page.drawLine({ start: { x: ML, y: curY - TABLE_HDR_H }, end: { x: ML + CW, y: curY - TABLE_HDR_H }, thickness: 0.5, color: C_BLACK });
        page.drawText("TERMS & CONDITIONS", { x: ML + BPAD, y: curY - TABLE_HDR_H / 2 - FS_BODY / 2 + 1, size: FS_BODY, font: fontB, color: C_BLACK });

        const tSubTop  = curY - TABLE_HDR_H;
        page.drawLine({ start: { x: ML, y: tSubTop - SUB_HDR_H }, end: { x: ML + CW, y: tSubTop - SUB_HDR_H }, thickness: 0.4, color: C_BLACK });
        page.drawLine({ start: { x: DIVX2, y: curY - TERMS_BOX_H }, end: { x: DIVX2, y: curY - TABLE_HDR_H }, thickness: 0.6, color: C_BLACK });
        const tSubLblY = tSubTop - SUB_HDR_H / 2 - FS_BODY / 2 + 1;
        page.drawText("PRICING & DELIVERY", { x: ML    + BPAD, y: tSubLblY, size: FS_BODY, font: fontB, color: C_BLACK });
        page.drawText("PAYMENT & POLICY",   { x: DIVX2 + BPAD, y: tSubLblY, size: FS_BODY, font: fontB, color: C_BLACK });

        let tLy = tSubTop - SUB_HDR_H - 8;
        for (let i = 0; i < tLLabels.length; i++) {
          page.drawText(tLLabels[i], { x: ML + BPAD, y: tLy, size: FS_BODY, font: fontR, color: C_BLACK });
          page.drawText(":", { x: tLColX, y: tLy, size: FS_BODY, font: fontR, color: C_BLACK });
          for (const line of tPreL[i]) {
            page.drawText(line, { x: tValLX, y: tLy, size: FS_BODY, font: fontR, color: C_BLACK });
            tLy -= INFO_LH;
          }
        }
        let tRy = tSubTop - SUB_HDR_H - 8;
        for (let i = 0; i < tRLabels.length; i++) {
          page.drawText(tRLabels[i], { x: DIVX2 + BPAD, y: tRy, size: FS_BODY, font: fontR, color: C_BLACK });
          page.drawText(":", { x: tRColX, y: tRy, size: FS_BODY, font: fontR, color: C_BLACK });
          for (const line of tPreR[i]) {
            page.drawText(line, { x: tValRX, y: tRy, size: FS_BODY, font: fontR, color: C_BLACK });
            tRy -= INFO_LH;
          }
        }
        curY -= TERMS_BOX_H + 10;
      }

      // Closing message
      curY -= 10;
      const closeMsg = "We trust the above quotation meets your requirements. Should you have any queries, please do not hesitate to contact us. We look forward to your kind confirmation.";
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
        page.drawRectangle({
          x: ML, y: curY - noteH, width: CW, height: noteH,
          borderColor: C_BORDER, borderWidth: 0.8,
        });
        page.drawText("NOTES", { x: ML + 8, y: curY - 12, size: 7.5, font: fontB, color: C_TEXT });
        let ny = curY - 24;
        for (const line of nl) {
          page.drawText(line, { x: ML + 8, y: ny, size: 9.5, font: fontR, color: C_TEXT });
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

      const C_CAT_LINE = rgb(0.88, 0.88, 0.88); // kept for image placeholder only
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

        // Header — white, all text black, all caps
        catPage.drawText("PRODUCT CATALOGUE", { x: ML, y: H - 22, size: 13, font: fontB, color: C_BLACK });
        if (q.title) {
          catPage.drawText(trunc((q.title ?? "").toUpperCase(), fontB, 8.5, CW / 2), { x: ML, y: H - 36, size: 8.5, font: fontB, color: C_BLACK });
          catPage.drawText(`${q.quotationNo}  ·  ${fmtD(q.createdAt)}`.toUpperCase(), { x: ML, y: H - 46, size: 7, font: fontR, color: C_BLACK });
        } else {
          catPage.drawText(`${q.quotationNo}  ·  ${fmtD(q.createdAt)}`.toUpperCase(), { x: ML, y: H - 37, size: 8, font: fontR, color: C_BLACK });
        }
        const pgLabel = `PAGE ${pi + 1} / ${totalCatPgs}`;
        catPage.drawText(pgLabel, { x: W - MR - fontR.widthOfTextAtSize(pgLabel, 8), y: H - 28, size: 8, font: fontR, color: C_BLACK });

        // Column header row — no fill, black border, black text, all caps
        const colHdrY = H - CAT_HDR_H - CAT_COLHDR_H;
        catPage.drawRectangle({ x: ML, y: colHdrY, width: CW, height: CAT_COLHDR_H, borderColor: C_BLACK, borderWidth: 0.8 });
        const colDefs: { label: string; x: number; w: number }[] = [
          { label: "#",               x: ML,                               w: CAT_COL_NO  },
          { label: "IMAGE",           x: ML + CAT_COL_NO,                  w: CAT_COL_IMG },
          { label: "PRODUCT DETAILS", x: ML + CAT_COL_NO + CAT_COL_IMG,   w: CAT_COL_DET },
        ];
        for (const col of colDefs) {
          const tw = fontB.widthOfTextAtSize(col.label, 7);
          catPage.drawText(col.label, { x: col.x + (col.w - tw) / 2, y: colHdrY + 6, size: 7, font: fontB, color: C_BLACK });
        }

        // Vertical separators — black
        const tableTopY    = colHdrY;
        const tableBottomY = tableTopY - pageRows.length * CAT_ROW_H;
        for (const col of colDefs.slice(1)) {
          catPage.drawLine({ start: { x: col.x, y: tableBottomY }, end: { x: col.x, y: tableTopY }, thickness: 0.4, color: C_BLACK });
        }

        // Product rows — no fill, black row borders, all text black and all caps
        let rowTopY = colHdrY;
        for (let ri = 0; ri < pageRows.length; ri++) {
          const item    = pageRows[ri];
          const rowY    = rowTopY - CAT_ROW_H;
          catPage.drawLine({ start: { x: ML, y: rowY }, end: { x: ML + CW, y: rowY }, thickness: 0.4, color: C_BLACK });

          const noStr = sanitizeText(item.rowNo);
          catPage.drawText(noStr, { x: ML + (CAT_COL_NO - fontR.widthOfTextAtSize(noStr, 8)) / 2, y: rowY + CAT_ROW_H / 2 - 4, size: 8, font: fontR, color: C_BLACK });

          const imgColX = ML + CAT_COL_NO;
          const img = item.productCode ? imageCache.get(item.productCode) : undefined;
          if (img) {
            const scale = Math.min(CAT_IMG_SZ / img.height, CAT_IMG_SZ / img.width, 1);
            const iw = img.width * scale;
            const ih = img.height * scale;
            catPage.drawImage(img, { x: imgColX + (CAT_COL_IMG - iw) / 2, y: rowY + (CAT_ROW_H - ih) / 2, width: iw, height: ih });
          } else {
            catPage.drawRectangle({ x: imgColX + (CAT_COL_IMG - CAT_IMG_SZ) / 2, y: rowY + (CAT_ROW_H - CAT_IMG_SZ) / 2, width: CAT_IMG_SZ, height: CAT_IMG_SZ, borderColor: C_BLACK, borderWidth: 0.4 });
          }

          const detX    = ML + CAT_COL_NO + CAT_COL_IMG + 8;
          const detMaxW = CAT_COL_DET - 16;
          let   detY    = rowY + CAT_ROW_H - 16;

          if (showCode && item.productCode) {
            catPage.drawText(trunc(item.productCode.toUpperCase(), fontB, 8, detMaxW), { x: detX, y: detY, size: 8, font: fontB, color: C_BLACK });
            detY -= 11;
          }
          if (item.description) {
            for (const line of wrap(String(item.description).toUpperCase(), fontR, 8, detMaxW).slice(0, 4)) {
              catPage.drawText(line, { x: detX, y: detY, size: 8, font: fontR, color: C_BLACK });
              detY -= 10;
            }
          }
          if (item.uom) {
            catPage.drawText(sanitizeText(item.uom).toUpperCase(), { x: detX, y: detY, size: 8, font: fontR, color: C_BLACK });
            detY -= 11;
          }
          if (showMdaCerts && item.hasCert) {
            detY -= 5;
            if (item.mdaRegNo) {
              catPage.drawText(sanitizeText(`MDA REG NO: ${item.mdaRegNo}`).toUpperCase(), { x: detX, y: detY, size: 7.5, font: fontR, color: C_BLACK });
              detY -= 10;
            }
            if (item.mdaValidity) {
              catPage.drawText(`MDA VALIDITY: ${fmtD(item.mdaValidity).toUpperCase()}`, { x: detX, y: detY, size: 7.5, font: fontR, color: C_BLACK });
            }
          }
          rowTopY = rowY;
        }

        catPage.drawRectangle({ x: ML, y: tableBottomY, width: CW, height: tableTopY - tableBottomY, borderColor: C_BLACK, borderWidth: 0.8 });

        hLine(catPage, MB + 22);
        catPage.drawText("PRODUCT CATALOGUE  ·  COMPUTER GENERATED DOCUMENT.", { x: ML, y: MB + 10, size: 7.5, font: fontR, color: C_BLACK });
        catPage.drawText(q.quotationNo.toUpperCase(), { x: W - MR - fontR.widthOfTextAtSize(q.quotationNo.toUpperCase(), 7.5), y: MB + 10, size: 7.5, font: fontR, color: C_BLACK });
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
    } catch { /* skip */ }
  }

  return pdfDoc.save();
}
