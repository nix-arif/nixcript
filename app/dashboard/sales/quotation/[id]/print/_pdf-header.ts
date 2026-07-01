/**
 * Shared PDF header drawing utilities.
 *
 * New unified header layout (all templates):
 *
 *   ┌──────────────────────────────────────────────────────────┐
 *   │ [Logo]  Company Name (accent, large)        QUOTATION    │
 *   │         Address                                          │
 *   │         SSM: NewNo (OldNo)                               │
 *   │         MDA Est: XXXX                                    │
 *   │         Email · Website · Phone                          │
 *   ├──────────────────────────────────────────────────────────┤  ← divider
 *   │ ATTENTION TO:              │  Quotation No: Q-001        │
 *   │ Customer Name              │  Date: 20 May 2026          │
 *   │ Company · Address          │  Valid Until: 20 Jun 2026   │
 *   └──────────────────────────────────────────────────────────┘
 */

import { PDFFont, PDFPage, PDFImage, rgb, Color } from "pdf-lib";

// ── Layout ─────────────────────────────────────────────────────────────────
const W  = 595.28;
const ML = 32;
const MR = 32;
const CW = W - ML - MR;

// ── Shared palette ──────────────────────────────────────────────────────────
export const C_DARK  = rgb(0.10, 0.10, 0.10);
export const C_MID   = rgb(0.40, 0.40, 0.40);
export const C_LITE  = rgb(0.62, 0.62, 0.62);
export const C_LINE  = rgb(0.88, 0.88, 0.88);
export const C_WHITE = rgb(1, 1, 1);

// ── Text helpers ────────────────────────────────────────────────────────────
export function sanitizeText(t: string): string {
  return String(t)
    .replace(/[\x00-\x1F\x7F]/g, " ")
    .replace(/[^\x00-\xFFŒœŠšŸŽžƒˆ˜–—‘’‚“”„†‡•…‰‹›€™]/g, " ");
}

export function wrap(text: string, font: PDFFont, size: number, maxW: number): string[] {
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

export function trunc(text: string, font: PDFFont, size: number, maxW: number): string {
  if (!text) return "";
  const text2 = sanitizeText(text).trim();
  if (!text2) return "";
  if (font.widthOfTextAtSize(text2, size) <= maxW) return text2;
  let s = text2;
  while (s.length > 0 && font.widthOfTextAtSize(s + "…", size) > maxW) s = s.slice(0, -1);
  return s + "…";
}

export function fmtD(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-MY", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

export function fmtM(v: string | number | null | undefined): string {
  return `RM ${Number(v ?? 0).toLocaleString("en-MY", { minimumFractionDigits: 2 })}`;
}

export function hLine(page: PDFPage, y: number, x1 = ML, x2 = W - MR, color = C_LINE, thick = 0.4) {
  page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness: thick, color });
}

// ── Company header block ────────────────────────────────────────────────────
export interface CompanyHeaderOptions {
  page: PDFPage;
  startY: number;           // top of header area
  accent: Color;
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
  mofNo?: string | null;
  // Company name style
  nameSize: number;
  nameBold: boolean;
  nameUppercase: boolean;
  headerLayout: string;
  // Document label
  docLabel: string;        // e.g. "QUOTATION"
  docLabelSize: number;
  docLabelBold: boolean;
  docLabelAlign?: "left" | "center" | "right"; // default "right"
  // Optional colour overrides (fall back to accent)
  nameColor?: Color;       // company name colour
  labelColor?: Color;      // QUOTATION label colour
  // Heights
  logoHMax: number;
  logoWMax: number;
  // Layout options
  inlineSsmMdaTax?: boolean;     // render SSM · MDA Est · Tax on one smaller line instead of stacked
  inlineSsmMdaTaxStar?: boolean; // aura style: SSM * MOF * MDA inline, bold accent *, 7pt
  inlineContactsStar?: boolean;  // aura style: email * website * phone inline, no labels, bold accent *, 7pt
}

/** Draws the company info block and document label. Returns the Y after drawing. */
export function drawCompanyHeader(opts: CompanyHeaderOptions): number {
  const {
    page, startY, accent, fontR, fontB, logoImg,
    companyName, companyAddress, phone, email, website, oldSsmNo, newSsmNo, mdaEstablishmentNo, taxNo,
    nameSize, nameBold, nameUppercase, headerLayout,
    docLabel, docLabelSize, docLabelBold, docLabelAlign = "right",
    nameColor, labelColor,
    logoHMax, logoWMax,
  } = opts;

  const nameFont  = nameBold ? fontB : fontR;
  const labelFont = docLabelBold ? fontB : fontR;
  const dispName  = nameUppercase ? companyName.toUpperCase() : companyName;
  const effectiveNameColor  = nameColor  ?? accent;
  const effectiveLabelColor = labelColor ?? accent;

  // Company zone width depends on label placement; empty docLabel = no label = full width
  const hasLabel = docLabel.trim().length > 0;
  const DOC_LABEL_W = 100;
  const companyZoneW = (docLabelAlign === "center" || !hasLabel) ? CW : CW - DOC_LABEL_W - 8;

  let cy = startY;

  if (hasLabel && docLabelAlign === "center") {
    // Centered label as standalone heading above company info
    const lw = labelFont.widthOfTextAtSize(docLabel, docLabelSize);
    page.drawText(docLabel, {
      x: ML + (CW - lw) / 2, y: cy - docLabelSize,
      size: docLabelSize, font: labelFont, color: effectiveLabelColor,
    });
    cy -= docLabelSize + 12;
  } else if (hasLabel) {
    // Right-aligned label alongside company info
    const lw = labelFont.widthOfTextAtSize(docLabel, docLabelSize);
    page.drawText(docLabel, {
      x: W - MR - lw, y: startY - docLabelSize,
      size: docLabelSize, font: labelFont, color: effectiveLabelColor,
    });
  }

  // Company zone starts at ML
  let logoLh = 0, logoLw = 0;
  if (logoImg) {
    const scale = Math.min(logoHMax / logoImg.height, logoWMax / logoImg.width);
    logoLw = logoImg.width * scale;
    logoLh = logoImg.height * scale;
  }

  let textX = ML;

  if (headerLayout === "standard" && logoImg) {
    // Logo left, name right of logo
    page.drawImage(logoImg, { x: ML, y: cy - logoLh, width: logoLw, height: logoLh });
    textX = ML + logoLw + 8;
  } else if (headerLayout === "logo-top" && logoImg) {
    // Logo above name
    page.drawImage(logoImg, { x: ML, y: cy - logoLh, width: logoLw, height: logoLh });
    cy -= logoLh + 4;
  } else if (headerLayout === "centered" && logoImg) {
    // Centered logo above centered name
    const cx = ML + companyZoneW / 2;
    page.drawImage(logoImg, { x: cx - logoLw / 2, y: cy - logoLh, width: logoLw, height: logoLh });
    cy -= logoLh + 4;
    textX = cx - fontB.widthOfTextAtSize(dispName, nameSize) / 2;
    textX = Math.max(ML, textX);
  } else if (headerLayout === "logo-right" && logoImg) {
    // Company info left, logo right (space-between)
    page.drawImage(logoImg, { x: W - MR - logoLw, y: cy - logoLh, width: logoLw, height: logoLh });
    // textX stays ML; text zone computed below
  }
  // text-only: no logo, textX stays ML

  // Effective text zone width — logo-right narrows the zone so text never overlaps the logo
  const textZoneW = (headerLayout === "logo-right" && logoImg)
    ? CW - logoLw - 8
    : companyZoneW - (textX - ML);

  // Company name
  page.drawText(trunc(dispName, nameFont, nameSize, textZoneW), {
    x: textX, y: cy - nameSize, size: nameSize, font: nameFont, color: effectiveNameColor,
  });
  cy -= nameSize + 10;

  const infoSize = 8.5;
  const infoLH   = 11;
  const infoColor = C_MID;

  // Address (may wrap)
  if (companyAddress) {
    const addrLines = wrap(companyAddress, fontR, infoSize, textZoneW);
    for (const line of addrLines) {
      page.drawText(line, { x: textX, y: cy, size: infoSize, font: fontR, color: infoColor });
      cy -= infoLH;
    }
  }

  if (opts.inlineSsmMdaTaxStar) {
    // Aura style: SSM * MOF * MDA inline, bold accent *, 7pt
    const segments: string[] = [];
    if (newSsmNo || oldSsmNo) segments.push(newSsmNo && oldSsmNo ? `SSM No: ${newSsmNo} (${oldSsmNo})` : `SSM No: ${newSsmNo ?? oldSsmNo}`);
    if (opts.mofNo) segments.push(`MOF No: ${opts.mofNo}`);
    if (mdaEstablishmentNo) segments.push(`MDA No: ${mdaEstablishmentNo}`);
    if (segments.length > 0) {
      const sz   = 7;
      const sepW = fontB.widthOfTextAtSize("*", sz);
      const spW  = fontR.widthOfTextAtSize("  ", sz);
      let dx = textX;
      for (let si = 0; si < segments.length; si++) {
        const seg = segments[si];
        const segW = fontR.widthOfTextAtSize(seg, sz);
        if (dx + segW > textX + textZoneW) break;
        page.drawText(seg, { x: dx, y: cy, size: sz, font: fontR, color: infoColor });
        dx += segW;
        if (si < segments.length - 1) {
          page.drawText("  ", { x: dx, y: cy, size: sz, font: fontR, color: infoColor });
          dx += spW;
          page.drawText("*", { x: dx, y: cy, size: sz, font: fontB, color: accent });
          dx += sepW;
          page.drawText("  ", { x: dx, y: cy, size: sz, font: fontR, color: infoColor });
          dx += spW;
        }
      }
      cy -= 10;
    }
  } else if (opts.inlineSsmMdaTax) {
    // Slate layout: SSM · MDA Est · Tax on one line, smaller than address
    const parts: string[] = [];
    if (newSsmNo || oldSsmNo) parts.push(newSsmNo && oldSsmNo ? `SSM: ${newSsmNo} (${oldSsmNo})` : `SSM: ${newSsmNo ?? oldSsmNo}`);
    if (mdaEstablishmentNo) parts.push(`MDA Est: ${mdaEstablishmentNo}`);
    if (taxNo) parts.push(`Tax No: ${taxNo}`);
    if (parts.length > 0) {
      const smallSz = 7.5;
      page.drawText(trunc(parts.join("  ·  "), fontR, smallSz, textZoneW), {
        x: textX, y: cy, size: smallSz, font: fontR, color: infoColor,
      });
      cy -= 10;
    }
  } else {
    // Default: SSM, MDA Est, Tax No on separate lines
    if (newSsmNo || oldSsmNo) {
      const ssm = newSsmNo && oldSsmNo
        ? `SSM: ${newSsmNo} (${oldSsmNo})`
        : `SSM: ${newSsmNo ?? oldSsmNo}`;
      page.drawText(trunc(ssm, fontR, infoSize, textZoneW), {
        x: textX, y: cy, size: infoSize, font: fontR, color: infoColor,
      });
      cy -= infoLH;
    }
    if (mdaEstablishmentNo) {
      page.drawText(trunc(`MDA Est: ${mdaEstablishmentNo}`, fontR, infoSize, textZoneW), {
        x: textX, y: cy, size: infoSize, font: fontR, color: infoColor,
      });
      cy -= infoLH;
    }
    if (taxNo) {
      page.drawText(trunc(`Tax: ${taxNo}`, fontR, infoSize, textZoneW), {
        x: textX, y: cy, size: infoSize, font: fontR, color: infoColor,
      });
      cy -= infoLH;
    }
  }

  // Contact line: email · website · phone
  const contactVals: string[] = [
    email    ? sanitizeText(email)   : null,
    website  ? sanitizeText(website) : null,
    phone    ? sanitizeText(phone)   : null,
  ].filter(Boolean) as string[];

  if (opts.inlineContactsStar) {
    if (contactVals.length > 0) {
      const sz   = 7;
      const sepW = fontB.widthOfTextAtSize("*", sz);
      const spW  = fontR.widthOfTextAtSize("  ", sz);
      let dx = textX;
      for (let ci = 0; ci < contactVals.length; ci++) {
        const val  = contactVals[ci];
        const valW = fontR.widthOfTextAtSize(val, sz);
        if (dx + valW > textX + textZoneW) break;
        page.drawText(val, { x: dx, y: cy, size: sz, font: fontR, color: infoColor });
        dx += valW;
        if (ci < contactVals.length - 1) {
          page.drawText("  ", { x: dx, y: cy, size: sz, font: fontR, color: infoColor });
          dx += spW;
          page.drawText("*", { x: dx, y: cy, size: sz, font: fontB, color: accent });
          dx += sepW;
          page.drawText("  ", { x: dx, y: cy, size: sz, font: fontR, color: infoColor });
          dx += spW;
        }
      }
      cy -= 10;
    }
  } else {
    for (const val of contactVals) {
      const label = val === sanitizeText(email ?? "") ? "Email: " : val === sanitizeText(website ?? "") ? "Web: " : "Tel: ";
      page.drawText(trunc(label + val, fontR, infoSize - 0.5, textZoneW), {
        x: textX, y: cy, size: infoSize - 0.5, font: fontR, color: C_LITE,
      });
      cy -= infoLH;
    }
  }

  return cy;
}

// ── Attention + Detail info section ─────────────────────────────────────────
export interface InfoSectionOptions {
  page: PDFPage;
  startY: number;
  accent: Color;
  fontR: PDFFont;
  fontB: PDFFont;
  // Customer
  cust: any;
  // Style
  attentionNameSize: number;
  attentionNameBold: boolean;
  detailFontSize: number;
  detailFontBold: boolean;
  detailAlignment: "left" | "right";
  textColor?: Color; // overrides C_MID and C_LITE for body text (e.g. pass C_DARK for all-black)
  // Quotation details
  quotationNo: string;
  createdAt: Date | string | null;
  validUntil: Date | string | null;
  salesPersonName: string | null;
  preparedByName: string | null;
  title: string | null;
}

/**
 * Draws the two-column info section (Attention | Quotation Detail).
 * Returns the Y after the section.
 */
export function drawInfoSection(opts: InfoSectionOptions): number {
  const {
    page, startY, accent, fontR, fontB, cust,
    attentionNameSize, attentionNameBold,
    detailFontSize, detailFontBold, detailAlignment,
    textColor,
    quotationNo, createdAt, validUntil, salesPersonName, preparedByName, title,
  } = opts;

  const bodyColor  = textColor ?? C_MID;
  const mutedColor = textColor ?? C_LITE;

  const LEFT_W  = CW * 0.55;
  const RIGHT_W = CW * 0.45;
  const RIGHT_X = ML + LEFT_W;
  const nameFont   = attentionNameBold ? fontB : fontR;
  const detailFont = detailFontBold ? fontB : fontR;

  // Left: ATTENTION TO
  page.drawText("ATTENTION TO", {
    x: ML, y: startY - 8, size: 7, font: fontB, color: accent,
  });
  let ly = startY - 21;

  if (cust) {
    const custName = [cust.title, cust.name].filter(Boolean).join(" ");
    if (custName) {
      page.drawText(trunc(custName, nameFont, attentionNameSize, LEFT_W - 8), {
        x: ML, y: ly, size: attentionNameSize, font: nameFont, color: C_DARK,
      });
      ly -= attentionNameSize + 4;
    }
    if (cust.position || cust.department) {
      const pos = [cust.position, cust.department].filter(Boolean).join(", ");
      page.drawText(trunc(pos, fontR, 9, LEFT_W - 8), {
        x: ML, y: ly, size: 9, font: fontR, color: bodyColor,
      });
      ly -= 12;
    }
    if (cust.organizationName) {
      page.drawText(trunc(cust.organizationName, fontR, 9, LEFT_W - 8), {
        x: ML, y: ly, size: 9, font: fontR, color: bodyColor,
      });
      ly -= 12;
    }
    if (cust.organizationAddress) {
      for (const l of wrap(cust.organizationAddress, fontR, 8.5, LEFT_W - 8).slice(0, 2)) {
        page.drawText(l, { x: ML, y: ly, size: 8.5, font: fontR, color: mutedColor });
        ly -= 11;
      }
    }
    if (cust.email || cust.contactNo) {
      const contact = [cust.email, cust.contactNo].filter(Boolean).join("  ·  ");
      page.drawText(trunc(contact, fontR, 8.5, LEFT_W - 8), {
        x: ML, y: ly, size: 8.5, font: fontR, color: mutedColor,
      });
      ly -= 11;
    }
  } else {
    page.drawText("—", { x: ML, y: ly, size: 9, font: fontR, color: mutedColor });
    ly -= 12;
  }

  // Right: Quotation detail
  page.drawText("QUOTATION DETAILS", {
    x: RIGHT_X, y: startY - 8, size: 7, font: fontB, color: accent,
  });

  const detailRows: [string, string][] = [
    ["Quotation No", quotationNo],
    ["Date",         fmtD(createdAt)],
    ["Valid Until",  fmtD(validUntil)],
    ...(title ? [["Subject", title]] as [string,string][] : []),
  ];

  let ry = startY - 21;
  for (const [lbl, val] of detailRows) {
    const lblW = fontR.widthOfTextAtSize(`${lbl}: `, detailFontSize);
    const valStr = trunc(val, detailFont, detailFontSize, RIGHT_W - lblW - 8);

    if (detailAlignment === "right") {
      page.drawText(`${lbl}:`, {
        x: RIGHT_X, y: ry, size: detailFontSize, font: fontR, color: mutedColor,
      });
      const vw = detailFont.widthOfTextAtSize(valStr, detailFontSize);
      page.drawText(valStr, {
        x: W - MR - vw, y: ry, size: detailFontSize, font: detailFont, color: C_DARK,
      });
    } else {
      page.drawText(`${lbl}: `, { x: RIGHT_X, y: ry, size: detailFontSize, font: fontR, color: mutedColor });
      page.drawText(valStr, {
        x: RIGHT_X + lblW, y: ry, size: detailFontSize, font: detailFont, color: C_DARK,
      });
    }
    ry -= detailFontSize + 4;
  }

  return Math.min(ly, ry);
}

// ── Height estimators ───────────────────────────────────────────────────────
export function estimateHeaderH(opts: {
  companyAddress: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  oldSsmNo: string | null;
  newSsmNo: string | null;
  mdaEstablishmentNo: string | null;
  taxNo: string | null;
  mofNo?: string | null;
  nameSize: number;
  logoHMax: number;
  logoWMax: number;
  headerLayout: string;
  logoImg: PDFImage | null;
  fontR: PDFFont;
  docLabelSize?: number;
  docLabelAlign?: "left" | "center" | "right";
  skipDocLabel?: boolean;
  inlineSsmMdaTax?: boolean;
  inlineSsmMdaTaxStar?: boolean;
  inlineContactsStar?: boolean;
}): number {
  const { companyAddress, phone, email, website, oldSsmNo, newSsmNo, mdaEstablishmentNo, taxNo, nameSize, logoHMax, logoWMax, headerLayout, logoImg, fontR, docLabelSize = 0, docLabelAlign = "right", skipDocLabel = false, inlineSsmMdaTax = false, inlineSsmMdaTaxStar = false, inlineContactsStar = false } = opts;

  const DOC_LABEL_W = 100;
  const companyZoneW = (docLabelAlign === "center" || skipDocLabel) ? CW : CW - DOC_LABEL_W - 8;

  // Compute the same effective text width as drawCompanyHeader
  let logoLw = 0;
  if (logoImg) {
    const scale = Math.min(logoHMax / logoImg.height, logoWMax / logoImg.width);
    logoLw = logoImg.width * scale;
  }
  const textOffsetX = (headerLayout === "standard" && logoImg) ? logoLw + 8 : 0;
  const textZoneW = (headerLayout === "logo-right" && logoImg)
    ? CW - logoLw - 8
    : companyZoneW - textOffsetX;

  let h = 0;
  // Centered doc label sits above company info as its own row
  if (docLabelAlign === "center" && docLabelSize > 0) h += docLabelSize + 12;
  // Logo height (only adds vertical space for stacked layouts; logo-right is beside text)
  if (logoImg && (headerLayout === "logo-top" || headerLayout === "centered")) {
    const scale = Math.min(logoHMax / logoImg.height, logoWMax / logoImg.width);
    h += logoImg.height * scale + 4;
  }
  h += nameSize + 10; // name + gap
  // Address lines — use same wrap width as drawCompanyHeader
  const addrLines = companyAddress ? Math.min(wrap(companyAddress, fontR, 8.5, textZoneW).length, 6) : 0;
  h += addrLines * 11;
  if (inlineSsmMdaTaxStar || inlineSsmMdaTax) {
    // All three on one compact line (star or dot style)
    const hasSsmMdaTax = !!(newSsmNo || oldSsmNo || opts.mofNo || mdaEstablishmentNo || taxNo);
    if (hasSsmMdaTax) h += 10;
  } else {
    if (newSsmNo || oldSsmNo) h += 11;
    if (mdaEstablishmentNo) h += 11;
    if (taxNo) h += 11;
  }
  const contactCount = [email, website, phone].filter(Boolean).length;
  if (inlineContactsStar) {
    if (contactCount > 0) h += 10;
  } else {
    h += contactCount * 10.5;
  }
  return Math.max(h, logoImg ? logoHMax : 40) + 12;
}

export function estimateInfoH(opts: {
  cust: any;
  attentionNameSize: number;
  salesPersonName: string | null;
  preparedByName: string | null;
  title: string | null;
  detailFontSize: number;
  fontR: PDFFont;
}): number {
  const { cust, attentionNameSize, salesPersonName, preparedByName, title, detailFontSize } = opts;

  let leftH = 8 + attentionNameSize + 4; // label + name
  if (cust) {
    if (cust.position || cust.department) leftH += 12;
    if (cust.organizationName) leftH += 12;
    if (cust.organizationAddress) leftH += 22;
    if (cust.email || cust.contactNo) leftH += 11;
  }

  let rightH = 8; // label
  const rows = 3 + (title ? 1 : 0);
  rightH += rows * (detailFontSize + 4);

  return Math.max(leftH, rightH) + 6;
}
