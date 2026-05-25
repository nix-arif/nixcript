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
const C_BLACK   = rgb(0.06, 0.06, 0.06);
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
  /** Ordered list from the spreadsheet (de-duped by caller, but API de-dupes again) */
  items: Array<{ no: number; productCode: string; description?: string; qty?: string; uom?: string }>;
  title: string;
  subtitle?: string;
  companyName?: string;
  options: {
    showProductCode: boolean;
    showRegNo: boolean;
    showValidity: boolean;
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

    // De-dup by productCode (same code may exist in multiple owner orgs)
    const dbMap = new Map<string, typeof dbRows[number]>();
    for (const row of dbRows) {
      if (!dbMap.has(row.productCode)) dbMap.set(row.productCode, row);
    }

    // ── Org profile (logo + brand color) ───────────────────────────────────
    const [orgProfile] = await db
      .select({ brandColor: organizationProfile.brandColor, logoKey: organizationProfile.logoKey, companyName: organizationProfile.companyName })
      .from(organizationProfile)
      .where(eq(organizationProfile.organizationId, orgId))
      .limit(1);

    const brandHex = orgProfile?.brandColor ?? "#141414";
    const accent = (() => {
      const hex = brandHex.replace("#", "");
      return rgb(parseInt(hex.slice(0, 2), 16) / 255, parseInt(hex.slice(2, 4), 16) / 255, parseInt(hex.slice(4, 6), 16) / 255);
    })();

    const effectiveCompanyName = companyName?.trim() || orgProfile?.companyName || null;

    // ── Build enriched item list ────────────────────────────────────────────
    type EnrichedItem = {
      no: number;
      productCode: string;
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
        no: item.no || idx + 1,
        productCode: item.productCode,
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

    // Create doc early so we can embed images
    const pdfDoc = await PDFDocument.create();
    const fontR  = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontB  = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    for (const item of enrichedItems) {
      if (!item.productCode || imageCache.has(item.productCode)) continue;
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

    // ── Layout constants (mirrors zinc.ts catalogue section) ───────────────
    const ROWS_PER_PG  = 5;
    const CAT_HDR_H    = 60;   // page header band
    const CAT_COLHDR_H = 18;   // column label row
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

      // ── Header band ──────────────────────────────────────────────────────
      catPage.drawRectangle({ x: 0, y: H - CAT_HDR_H, width: W, height: CAT_HDR_H, color: C_BLACK });
      catPage.drawRectangle({ x: 0, y: H - CAT_HDR_H, width: 4, height: CAT_HDR_H, color: accent });

      // Title (left)
      catPage.drawText(trunc(title, fontB, 13, CW * 0.65), {
        x: ML, y: H - 22, size: 13, font: fontB, color: C_WHITE,
      });
      if (subtitle) {
        catPage.drawText(trunc(subtitle, fontR, 8.5, CW * 0.65), {
          x: ML, y: H - 36, size: 8.5, font: fontR, color: C_WHITE80,
        });
      }
      if (effectiveCompanyName) {
        catPage.drawText(trunc(effectiveCompanyName, fontR, 7.5, CW * 0.65), {
          x: ML, y: H - (subtitle ? 48 : 38), size: 7.5, font: fontR, color: rgb(0.55, 0.55, 0.60),
        });
      }

      // Right side: page / date / count
      const pgLabel = `Page ${pi + 1} / ${totalCatPgs}`;
      catPage.drawText(pgLabel, {
        x: W - MR - fontB.widthOfTextAtSize(pgLabel, 9),
        y: H - 22, size: 9, font: fontB, color: C_WHITE80,
      });
      catPage.drawText(dateStr, {
        x: W - MR - fontR.widthOfTextAtSize(dateStr, 7.5),
        y: H - 34, size: 7.5, font: fontR, color: rgb(0.5, 0.5, 0.55),
      });
      const countLabel = `${enrichedItems.length} item${enrichedItems.length !== 1 ? "s" : ""}`;
      catPage.drawText(countLabel, {
        x: W - MR - fontR.widthOfTextAtSize(countLabel, 7),
        y: H - 45, size: 7, font: fontR, color: rgb(0.45, 0.45, 0.50),
      });

      // ── Column header ─────────────────────────────────────────────────────
      const colHdrY = H - CAT_HDR_H - CAT_COLHDR_H;
      catPage.drawRectangle({ x: ML, y: colHdrY, width: CW, height: CAT_COLHDR_H, color: rgb(0.14, 0.14, 0.14) });

      for (const col of [
        { label: "#",               x: ML + 4                                },
        { label: "Image",           x: ML + CAT_COL_NO + CAT_COL_IMG / 2 - 10 },
        { label: "Product Details", x: ML + CAT_COL_NO + CAT_COL_IMG + 8   },
      ]) {
        catPage.drawText(col.label.toUpperCase(), {
          x: col.x, y: colHdrY + 5, size: 6.5, font: fontB, color: C_WHITE,
        });
      }

      // ── Table outer border ────────────────────────────────────────────────
      const tableTopY    = colHdrY;
      const tableBottomY = tableTopY - pageRows.length * CAT_ROW_H;

      // Vertical col dividers
      catPage.drawLine({
        start: { x: ML + CAT_COL_NO, y: tableBottomY },
        end:   { x: ML + CAT_COL_NO, y: tableTopY },
        thickness: 0.3, color: C_LINE,
      });
      catPage.drawLine({
        start: { x: ML + CAT_COL_NO + CAT_COL_IMG, y: tableBottomY },
        end:   { x: ML + CAT_COL_NO + CAT_COL_IMG, y: tableTopY },
        thickness: 0.3, color: C_LINE,
      });

      // ── Rows ──────────────────────────────────────────────────────────────
      let rowTopY = colHdrY;
      for (let ri = 0; ri < pageRows.length; ri++) {
        const item = pageRows[ri];
        const rowY = rowTopY - CAT_ROW_H;

        // Alternating row bg
        if (ri % 2 === 1) {
          catPage.drawRectangle({ x: ML, y: rowY, width: CW, height: CAT_ROW_H, color: C_ALT });
        }

        // Bottom separator
        catPage.drawLine({ start: { x: ML, y: rowY }, end: { x: ML + CW, y: rowY }, thickness: 0.3, color: C_LINE });

        // Row number
        const noStr = String(item.no);
        catPage.drawText(noStr, {
          x: ML + (CAT_COL_NO - fontR.widthOfTextAtSize(noStr, 8)) / 2,
          y: rowY + CAT_ROW_H / 2 - 4,
          size: 8, font: fontR, color: C_LITE,
        });

        // Image
        const imgColX = ML + CAT_COL_NO;
        const img = imageCache.get(item.productCode);
        if (img) {
          const scale = Math.min(CAT_IMG_SZ / img.height, CAT_IMG_SZ / img.width, 1);
          const iw = img.width  * scale;
          const ih = img.height * scale;
          catPage.drawImage(img, {
            x: imgColX + (CAT_COL_IMG - iw) / 2,
            y: rowY    + (CAT_ROW_H  - ih) / 2,
            width: iw, height: ih,
          });
        } else {
          // Placeholder box
          const ph = CAT_IMG_SZ * 0.7;
          catPage.drawRectangle({
            x: imgColX + (CAT_COL_IMG - ph) / 2,
            y: rowY    + (CAT_ROW_H   - ph) / 2,
            width: ph, height: ph, color: C_LINE,
          });
        }

        // Product details
        const detX    = ML + CAT_COL_NO + CAT_COL_IMG + 8;
        const detMaxW = CAT_COL_DET - 16;
        let   detY    = rowY + CAT_ROW_H - 14;

        // Code (if enabled)
        if (options.showProductCode) {
          catPage.drawText(trunc(item.productCode, fontB, 8, detMaxW), {
            x: detX, y: detY, size: 8, font: fontB, color: accent,
          });
          detY -= 11;
        }

        // Description
        if (item.description) {
          for (const line of wrap(item.description, fontR, 8.5, detMaxW).slice(0, 3)) {
            catPage.drawText(line, { x: detX, y: detY, size: 8.5, font: fontR, color: C_DARK });
            detY -= 11;
          }
        }

        // UOM / qty
        if (item.uom || item.qty) {
          const uomStr = [item.qty && `Qty: ${item.qty}`, item.uom].filter(Boolean).join("  ·  ");
          catPage.drawText(uomStr, { x: detX, y: detY, size: 7.5, font: fontR, color: C_MID });
          detY -= 10;
        }

        // MDA reg
        if (options.showRegNo) {
          if (item.mdaRegNo) {
            catPage.drawText(`MDA: ${item.mdaRegNo}`, {
              x: detX, y: detY, size: 7.5, font: fontR, color: C_GREEN,
            });
          } else {
            catPage.drawText("No MDA certificate", {
              x: detX, y: detY, size: 7.5, font: fontR, color: C_AMBER,
            });
          }
          detY -= 10;
        }

        // MDA validity
        if (options.showValidity && item.mdaValidity) {
          catPage.drawText(`Exp: ${fmtD(item.mdaValidity)}`, {
            x: detX, y: detY, size: 7.5, font: fontR, color: C_LITE,
          });
        }

        rowTopY = rowY;
      }

      // Outer border
      catPage.drawRectangle({
        x: ML, y: tableBottomY,
        width: CW, height: tableTopY - tableBottomY,
        borderColor: C_LINE, borderWidth: 0.4,
      });

      // ── Footer ────────────────────────────────────────────────────────────
      catPage.drawLine({ start: { x: ML, y: MB + 18 }, end: { x: W - MR, y: MB + 18 }, thickness: 0.4, color: C_LINE });
      const footLeft = effectiveCompanyName ? `${effectiveCompanyName.toUpperCase()}  ·  ${title}` : title;
      catPage.drawText(trunc(footLeft, fontR, 7, CW * 0.7), {
        x: ML, y: MB + 8, size: 7, font: fontR, color: C_LITE,
      });
      const footRight = `${pi + 1} / ${totalCatPgs}`;
      catPage.drawText(footRight, {
        x: W - MR - fontR.widthOfTextAtSize(footRight, 7),
        y: MB + 8, size: 7, font: fontR, color: C_LITE,
      });
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
