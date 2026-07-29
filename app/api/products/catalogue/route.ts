import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/db";
import { member, product, organizationProfile } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { PDFDocument, rgb, StandardFonts, PDFImage } from "pdf-lib";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";

export const maxDuration = 60;

// ── A4 ─────────────────────────────────────────────────────────────────────
const W  = 595.28;
const H  = 841.89;
const ML = 32;
const MR = 32;
const MT = 30;
const MB = 30;
const CW = W - ML - MR;

// ── Palette ────────────────────────────────────────────────────────────────
const C_BLACK   = rgb(0, 0, 0);
const C_DARK    = rgb(0.10, 0.10, 0.10);
const C_MID     = rgb(0.40, 0.40, 0.40);
const C_LITE    = rgb(0.62, 0.62, 0.62);
const C_LINE    = rgb(0.88, 0.88, 0.88);
const C_ALT     = rgb(0.965, 0.966, 0.968);
const C_WHITE   = rgb(1, 1, 1);
const C_WHITE80 = rgb(0.85, 0.85, 0.85);
const C_GREEN   = rgb(0.09, 0.40, 0.20);
const C_AMBER   = rgb(0.57, 0.25, 0.05);

function fmtD(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" });
}

function sanitize(t: string): string {
  return String(t ?? "").replace(/[\x00-\x1F\x7F]/g, " ");
}

function wrap(text: string, font: Awaited<ReturnType<PDFDocument["embedFont"]>>, size: number, maxW: number): string[] {
  if (!text) return [""];
  const words = sanitize(text).split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const word of words) {
    const test = cur ? `${cur} ${word}` : word;
    if (font.widthOfTextAtSize(test, size) <= maxW) {
      cur = test;
    } else {
      if (cur) lines.push(cur);
      cur = word;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

function trunc(text: string, font: Awaited<ReturnType<PDFDocument["embedFont"]>>, size: number, maxW: number): string {
  if (!text) return "";
  const t = sanitize(text).trim();
  if (font.widthOfTextAtSize(t, size) <= maxW) return t;
  let s = t;
  while (s.length > 0 && font.widthOfTextAtSize(s + "…", size) > maxW) s = s.slice(0, -1);
  return s + "…";
}

async function getAllOwnerOrgIds(userId: string, currentOrgId: string): Promise<string[]> {
  const [ownerMember] = await db
    .select({ userId: member.userId })
    .from(member)
    .where(and(eq(member.organizationId, currentOrgId), eq(member.role, "owner")))
    .limit(1);

  if (!ownerMember) return [currentOrgId];

  const ownedOrgs = await db
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(and(eq(member.userId, ownerMember.userId), eq(member.role, "owner")));

  const ids = ownedOrgs.map((o) => o.organizationId);
  return ids.length ? ids : [currentOrgId];
}

export type CatalogueRequestBody = {
  items: Array<{ no: string; productCode: string; sku?: string; description?: string; qty?: string; uom?: string }>;
  title: string;
  subtitle?: string;
  companyName?: string;
  options: {
    showSku: boolean;
    showProductCode: boolean;
    showRegNo: boolean;
    showValidity: boolean;
    showCompany: boolean;
  };
};

export async function POST(req: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return new Response("Unauthorized", { status: 401 });

    const orgId = session.session.activeOrganizationId;
    if (!orgId) return new Response("No active organization", { status: 400 });

    const perms = await getUserPermissions(session.user.id, orgId);
    if (!hasAccess(perms, "product:read")) return new Response("Forbidden", { status: 403 });

    const body: CatalogueRequestBody = await req.json();
    const { items, title, subtitle, companyName, options } = body;

    if (!items?.length) return new Response("No items provided", { status: 400 });
    if (!title?.trim()) return new Response("Title is required", { status: 400 });

    // ── DB lookup ──────────────────────────────────────────────────────────
    const ownerOrgIds = await getAllOwnerOrgIds(session.user.id, orgId);
    const codes = [...new Set(items.map((i) => i.productCode).filter(Boolean))];

    const dbRows = await db
      .select({
        productCode: product.productCode,
        description: product.description,
        uom: product.uom,
        mdaRegistrationNo: product.mdaRegistrationNo,
        mdaExpiredOn: product.mdaExpiredOn,
        mdaPdfFile: product.mdaPdfFile,
      })
      .from(product)
      .where(and(inArray(product.organizationId, ownerOrgIds), inArray(product.productCode, codes)));

    const dbMap = new Map<string, typeof dbRows[number]>();
    for (const row of dbRows) {
      if (!dbMap.has(row.productCode)) dbMap.set(row.productCode, row);
    }

    // ── Org profile (logo + brand color + template) ────────────────────────
    const [orgProfile] = await db
      .select({ brandColor: organizationProfile.brandColor, logoKey: organizationProfile.logoKey, companyName: organizationProfile.companyName, pdfTemplate: organizationProfile.pdfTemplate })
      .from(organizationProfile)
      .where(eq(organizationProfile.organizationId, orgId))
      .limit(1);

    const isMono = (orgProfile?.pdfTemplate ?? "affirma") === "mono";

    const brandHex = orgProfile?.brandColor ?? "#141414";
    const accent = (() => {
      const hex = brandHex.replace("#", "");
      const r = parseInt(hex.slice(0, 2), 16) / 255;
      const g = parseInt(hex.slice(2, 4), 16) / 255;
      const b = parseInt(hex.slice(4, 6), 16) / 255;
      return rgb(r, g, b);
    })();
    const accentDark = (() => {
      const hex = brandHex.replace("#", "");
      const r = parseInt(hex.slice(0, 2), 16) / 255;
      const g = parseInt(hex.slice(2, 4), 16) / 255;
      const b = parseInt(hex.slice(4, 6), 16) / 255;
      return rgb(Math.max(0, r * 0.55), Math.max(0, g * 0.55), Math.max(0, b * 0.55));
    })();

    const effectiveCompanyName = options.showCompany
      ? (companyName?.trim() || orgProfile?.companyName || null)
      : null;

    // ── Build enriched item list ────────────────────────────────────────────
    type EnrichedItem = {
      no: string;
      productCode: string;
      sku?: string;
      description: string;
      uom: string | null;
      mdaRegNo: string | null;
      mdaValidity: string | null;
      hasCert: boolean;
      qty?: string;
    };

    const enrichedItems: EnrichedItem[] = items.map((item, idx) => {
      const db = dbMap.get(item.productCode);
      return {
        no: item.no || String(idx + 1),
        productCode: item.productCode,
        sku: item.sku,
        description: item.description || db?.description || item.productCode,
        uom: item.uom || db?.uom || null,
        mdaRegNo: db?.mdaRegistrationNo ?? null,
        mdaValidity: db?.mdaExpiredOn ?? null,
        hasCert: !!(db?.mdaPdfFile),
        qty: item.qty,
      };
    });

    // ── Fetch product images from R2 ───────────────────────────────────────
    const r2ImgBase = process.env.NEXT_PUBLIC_R2_PRODUCT_IMAGES_URL ?? "";
    const imageCache = new Map<string, PDFImage>();

    const pdfDoc = await PDFDocument.create();
    const fontR  = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontB  = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    for (const item of enrichedItems) {
      if (!item.productCode || imageCache.has(item.productCode)) continue;
      for (const ext of ["jpg", "jpeg", "png", "webp"]) {
        try {
          const url = `${r2ImgBase}/${encodeURIComponent(item.productCode.replace(/\//g, ":"))}.${ext}`;
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

    // ── Layout constants ───────────────────────────────────────────────────
    const ROWS_PER_PG  = 5;
    const CAT_HDR_H    = 60;
    const CAT_COLHDR_H = 18;
    const CAT_FOOT_H   = 28;
    const CAT_COL_NO   = 24;

    const rowsAvail    = H - MT - CAT_HDR_H - CAT_COLHDR_H - MB - CAT_FOOT_H;
    const CAT_ROW_H    = Math.floor(rowsAvail / ROWS_PER_PG);
    const CAT_IMG_SZ   = CAT_ROW_H - 14;
    const CAT_COL_IMG  = CAT_IMG_SZ + 20;
    const CAT_COL_DET  = CW - CAT_COL_NO - CAT_COL_IMG;

    const totalCatPgs  = Math.ceil(enrichedItems.length / ROWS_PER_PG);
    const dateStr      = new Date().toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" });

    // ── Draw pages ─────────────────────────────────────────────────────────
    for (let pi = 0; pi < totalCatPgs; pi++) {
      const catPage  = pdfDoc.addPage([W, H]);
      const pageRows = enrichedItems.slice(pi * ROWS_PER_PG, (pi + 1) * ROWS_PER_PG);

      const tableTopY    = H - CAT_HDR_H - CAT_COLHDR_H;
      const tableBottomY = tableTopY - pageRows.length * CAT_ROW_H;
      const colHdrY      = tableTopY;

      if (isMono) {
        // ── Mono design: white bg, black borders, accent column header ────────
        catPage.drawText("PRODUCT CATALOGUE", { x: ML, y: H - 22, size: 13, font: fontB, color: C_BLACK });
        if (subtitle) {
          catPage.drawText(trunc(subtitle, fontR, 8.5, CW * 0.65), { x: ML, y: H - 36, size: 8.5, font: fontR, color: C_BLACK });
          catPage.drawText(trunc(title, fontR, 7, CW * 0.65), { x: ML, y: H - 46, size: 7, font: fontR, color: C_BLACK });
        } else {
          catPage.drawText(trunc(title, fontR, 8, CW * 0.65), { x: ML, y: H - 37, size: 8, font: fontR, color: C_BLACK });
        }
        if (effectiveCompanyName) {
          catPage.drawText(trunc(effectiveCompanyName.toUpperCase(), fontR, 7, CW * 0.65), {
            x: ML, y: H - (subtitle ? 56 : 48), size: 7, font: fontR, color: C_BLACK,
          });
        }

        const pgLabelM = `PAGE ${pi + 1} / ${totalCatPgs}`;
        catPage.drawText(pgLabelM, { x: W - MR - fontR.widthOfTextAtSize(pgLabelM, 8), y: H - 28, size: 8, font: fontR, color: C_BLACK });

        // Thick divider below header — matches mono quotation style
        catPage.drawLine({ start: { x: ML, y: H - CAT_HDR_H }, end: { x: ML + CW, y: H - CAT_HDR_H }, thickness: 1.5, color: C_BLACK });

        // Column header — accent fill + black border + black text all-caps
        catPage.drawRectangle({ x: ML, y: colHdrY, width: CW, height: CAT_COLHDR_H, color: accent, borderColor: C_BLACK, borderWidth: 0.8 });
        const monoColDefs = [
          { label: "#",               x: ML,                             w: CAT_COL_NO  },
          { label: "IMAGE",           x: ML + CAT_COL_NO,                w: CAT_COL_IMG },
          { label: "PRODUCT DETAILS", x: ML + CAT_COL_NO + CAT_COL_IMG, w: CAT_COL_DET },
        ];
        for (const col of monoColDefs) {
          const tw = fontB.widthOfTextAtSize(col.label, 7);
          catPage.drawText(col.label, { x: col.x + (col.w - tw) / 2, y: colHdrY + 5, size: 7, font: fontB, color: C_BLACK });
        }

        // Vertical separators — black
        catPage.drawLine({ start: { x: ML + CAT_COL_NO,               y: tableBottomY }, end: { x: ML + CAT_COL_NO,               y: tableTopY }, thickness: 0.4, color: C_BLACK });
        catPage.drawLine({ start: { x: ML + CAT_COL_NO + CAT_COL_IMG, y: tableBottomY }, end: { x: ML + CAT_COL_NO + CAT_COL_IMG, y: tableTopY }, thickness: 0.4, color: C_BLACK });

        let rowTopY = colHdrY;
        for (let ri = 0; ri < pageRows.length; ri++) {
          const item = pageRows[ri];
          const rowY = rowTopY - CAT_ROW_H;

          catPage.drawLine({ start: { x: ML, y: rowY }, end: { x: ML + CW, y: rowY }, thickness: 0.4, color: C_BLACK });

          const noStr = sanitize(item.no);
          catPage.drawText(noStr, { x: ML + (CAT_COL_NO - fontR.widthOfTextAtSize(noStr, 8)) / 2, y: rowY + CAT_ROW_H / 2 - 4, size: 8, font: fontR, color: C_BLACK });

          const imgColX = ML + CAT_COL_NO;
          const img = imageCache.get(item.productCode);
          if (img) {
            const scale = Math.min(CAT_IMG_SZ / img.height, CAT_IMG_SZ / img.width, 1);
            catPage.drawImage(img, { x: imgColX + (CAT_COL_IMG - img.width * scale) / 2, y: rowY + (CAT_ROW_H - img.height * scale) / 2, width: img.width * scale, height: img.height * scale });
          } else {
            catPage.drawRectangle({ x: imgColX + (CAT_COL_IMG - CAT_IMG_SZ) / 2, y: rowY + (CAT_ROW_H - CAT_IMG_SZ) / 2, width: CAT_IMG_SZ, height: CAT_IMG_SZ, borderColor: C_BLACK, borderWidth: 0.4 });
          }

          const detX    = ML + CAT_COL_NO + CAT_COL_IMG + 8;
          const detMaxW = CAT_COL_DET - 16;
          let   detY    = rowY + CAT_ROW_H - 14;

          if (options.showSku && item.sku) {
            catPage.drawText(trunc(`SKU: ${sanitize(item.sku)}`.toUpperCase(), fontR, 7.5, detMaxW), { x: detX, y: detY, size: 7.5, font: fontR, color: C_BLACK });
            detY -= 10;
          }
          if (options.showProductCode) {
            catPage.drawText(trunc(sanitize(item.productCode).toUpperCase(), fontB, 8, detMaxW), { x: detX, y: detY, size: 8, font: fontB, color: C_BLACK });
            detY -= 11;
          }
          if (item.description) {
            for (const line of wrap(sanitize(item.description).toUpperCase(), fontR, 8, detMaxW).slice(0, 3)) {
              catPage.drawText(line, { x: detX, y: detY, size: 8, font: fontR, color: C_BLACK });
              detY -= 10;
            }
          }
          if (item.uom || item.qty) {
            const uomStr = [item.qty && `QTY: ${item.qty}`, item.uom && sanitize(item.uom).toUpperCase()].filter(Boolean).join("  ·  ");
            catPage.drawText(uomStr, { x: detX, y: detY, size: 7.5, font: fontR, color: C_BLACK });
            detY -= 10;
          }
          if (options.showRegNo) {
            if (item.mdaRegNo) {
              catPage.drawText(sanitize(`MDA REG NO: ${item.mdaRegNo}`).toUpperCase(), { x: detX, y: detY, size: 7.5, font: fontR, color: C_BLACK });
              detY -= 10;
            }
            if (options.showValidity && item.mdaValidity) {
              catPage.drawText(`MDA VALIDITY: ${fmtD(item.mdaValidity).toUpperCase()}`, { x: detX, y: detY, size: 7.5, font: fontR, color: C_BLACK });
            }
          }

          rowTopY = rowY;
        }

        catPage.drawRectangle({ x: ML, y: tableBottomY, width: CW, height: tableTopY - tableBottomY, borderColor: C_BLACK, borderWidth: 0.8 });

        // Footer
        catPage.drawLine({ start: { x: ML, y: MB + 18 }, end: { x: ML + CW, y: MB + 18 }, thickness: 0.8, color: C_BLACK });
        const monoFootLeft = effectiveCompanyName ? `${effectiveCompanyName.toUpperCase()}  ·  PRODUCT CATALOGUE  ·  COMPUTER GENERATED DOCUMENT.` : "PRODUCT CATALOGUE  ·  COMPUTER GENERATED DOCUMENT.";
        catPage.drawText(trunc(monoFootLeft, fontR, 7.5, CW * 0.75), { x: ML, y: MB + 8, size: 7.5, font: fontR, color: C_BLACK });
        const monoFootRight = `${pi + 1} / ${totalCatPgs}`;
        catPage.drawText(monoFootRight, { x: W - MR - fontR.widthOfTextAtSize(monoFootRight, 7.5), y: MB + 8, size: 7.5, font: fontR, color: C_BLACK });

      } else {
        // ── Default design: coloured header band, alternating rows ────────────
        catPage.drawRectangle({ x: 0, y: H - CAT_HDR_H, width: W, height: CAT_HDR_H, color: accentDark });
        catPage.drawRectangle({ x: 0, y: H - CAT_HDR_H, width: W, height: 3, color: accent });

        catPage.drawText(trunc(title, fontB, 13, CW * 0.65), { x: ML, y: H - 22, size: 13, font: fontB, color: C_WHITE });
        if (subtitle) {
          catPage.drawText(trunc(subtitle, fontR, 8.5, CW * 0.65), { x: ML, y: H - 36, size: 8.5, font: fontR, color: C_WHITE80 });
        }
        if (effectiveCompanyName) {
          catPage.drawText(trunc(effectiveCompanyName, fontR, 7.5, CW * 0.65), {
            x: ML, y: H - (subtitle ? 48 : 38), size: 7.5, font: fontR, color: rgb(0.55, 0.55, 0.60),
          });
        }

        const pgLabel = `Page ${pi + 1} / ${totalCatPgs}`;
        catPage.drawText(pgLabel, { x: W - MR - fontB.widthOfTextAtSize(pgLabel, 9), y: H - 22, size: 9, font: fontB, color: C_WHITE80 });
        catPage.drawText(dateStr, { x: W - MR - fontR.widthOfTextAtSize(dateStr, 7.5), y: H - 34, size: 7.5, font: fontR, color: rgb(0.5, 0.5, 0.55) });
        const countLabel = `${enrichedItems.length} item${enrichedItems.length !== 1 ? "s" : ""}`;
        catPage.drawText(countLabel, { x: W - MR - fontR.widthOfTextAtSize(countLabel, 7), y: H - 45, size: 7, font: fontR, color: rgb(0.45, 0.45, 0.50) });

        catPage.drawRectangle({ x: ML, y: colHdrY, width: CW, height: CAT_COLHDR_H, color: accent });
        for (const col of [
          { label: "#",               x: ML + 4 },
          { label: "Image",           x: ML + CAT_COL_NO + CAT_COL_IMG / 2 - 10 },
          { label: "Product Details", x: ML + CAT_COL_NO + CAT_COL_IMG + 8 },
        ]) {
          catPage.drawText(col.label.toUpperCase(), { x: col.x, y: colHdrY + 5, size: 6.5, font: fontB, color: C_WHITE });
        }

        catPage.drawLine({ start: { x: ML + CAT_COL_NO,               y: tableBottomY }, end: { x: ML + CAT_COL_NO,               y: tableTopY }, thickness: 0.3, color: C_LINE });
        catPage.drawLine({ start: { x: ML + CAT_COL_NO + CAT_COL_IMG, y: tableBottomY }, end: { x: ML + CAT_COL_NO + CAT_COL_IMG, y: tableTopY }, thickness: 0.3, color: C_LINE });

        let rowTopY = colHdrY;
        for (let ri = 0; ri < pageRows.length; ri++) {
          const item = pageRows[ri];
          const rowY = rowTopY - CAT_ROW_H;

          if (ri % 2 === 1) catPage.drawRectangle({ x: ML, y: rowY, width: CW, height: CAT_ROW_H, color: C_ALT });
          catPage.drawLine({ start: { x: ML, y: rowY }, end: { x: ML + CW, y: rowY }, thickness: 0.3, color: C_LINE });

          const noStr = sanitize(item.no);
          catPage.drawText(noStr, { x: ML + (CAT_COL_NO - fontR.widthOfTextAtSize(noStr, 8)) / 2, y: rowY + CAT_ROW_H / 2 - 4, size: 8, font: fontR, color: C_LITE });

          const imgColX = ML + CAT_COL_NO;
          const img = imageCache.get(item.productCode);
          if (img) {
            const scale = Math.min(CAT_IMG_SZ / img.height, CAT_IMG_SZ / img.width, 1);
            catPage.drawImage(img, { x: imgColX + (CAT_COL_IMG - img.width * scale) / 2, y: rowY + (CAT_ROW_H - img.height * scale) / 2, width: img.width * scale, height: img.height * scale });
          } else {
            const ph = CAT_IMG_SZ * 0.7;
            catPage.drawRectangle({ x: imgColX + (CAT_COL_IMG - ph) / 2, y: rowY + (CAT_ROW_H - ph) / 2, width: ph, height: ph, color: C_LINE });
          }

          const detX    = ML + CAT_COL_NO + CAT_COL_IMG + 8;
          const detMaxW = CAT_COL_DET - 16;
          let   detY    = rowY + CAT_ROW_H - 14;

          if (options.showSku && item.sku) {
            catPage.drawText(trunc(`SKU: ${item.sku}`, fontR, 7.5, detMaxW), { x: detX, y: detY, size: 7.5, font: fontR, color: C_MID });
            detY -= 10;
          }
          if (options.showProductCode) {
            catPage.drawText(trunc(item.productCode, fontB, 8, detMaxW), { x: detX, y: detY, size: 8, font: fontB, color: accent });
            detY -= 11;
          }
          if (item.description) {
            for (const line of wrap(item.description, fontR, 8.5, detMaxW).slice(0, 3)) {
              catPage.drawText(line, { x: detX, y: detY, size: 8.5, font: fontR, color: C_DARK });
              detY -= 11;
            }
          }
          if (item.uom || item.qty) {
            const uomStr = [item.qty && `Qty: ${item.qty}`, item.uom].filter(Boolean).join("  ·  ");
            catPage.drawText(uomStr, { x: detX, y: detY, size: 7.5, font: fontR, color: C_MID });
            detY -= 10;
          }
          if (options.showRegNo) {
            if (item.mdaRegNo) {
              catPage.drawText(`MDA: ${item.mdaRegNo}`, { x: detX, y: detY, size: 7.5, font: fontR, color: C_GREEN });
            } else {
              catPage.drawText("No MDA certificate", { x: detX, y: detY, size: 7.5, font: fontR, color: C_AMBER });
            }
            detY -= 10;
          }
          if (options.showValidity && item.mdaValidity) {
            catPage.drawText(`Exp: ${fmtD(item.mdaValidity)}`, { x: detX, y: detY, size: 7.5, font: fontR, color: C_LITE });
          }

          rowTopY = rowY;
        }

        catPage.drawRectangle({ x: ML, y: tableBottomY, width: CW, height: tableTopY - tableBottomY, borderColor: C_LINE, borderWidth: 0.4 });

        catPage.drawLine({ start: { x: ML, y: MB + 18 }, end: { x: W - MR, y: MB + 18 }, thickness: 0.6, color: accent });
        const footLeft = effectiveCompanyName ? `${effectiveCompanyName.toUpperCase()}  ·  ${title}` : title;
        catPage.drawText(trunc(footLeft, fontR, 7, CW * 0.7), { x: ML, y: MB + 8, size: 7, font: fontR, color: C_LITE });
        const footRight = `${pi + 1} / ${totalCatPgs}`;
        catPage.drawText(footRight, { x: W - MR - fontR.widthOfTextAtSize(footRight, 7), y: MB + 8, size: 7, font: fontR, color: C_LITE });
      }
    }

    const bytes = await pdfDoc.save();

    const safeName = title.replace(/[^a-z0-9]/gi, "_").toLowerCase();
    return new Response(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${safeName}_catalogue.pdf"`,
      },
    });
  } catch (e) {
    console.error("[catalogue/route] error:", e);
    return new Response("Internal Server Error", { status: 500 });
  }
}
