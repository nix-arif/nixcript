import { getPackingListDetail } from "@/server/packing-list";
import { getFullOrganizationProfile } from "@/server/organization-profile";
import { PDFDocument, rgb, StandardFonts, PDFImage } from "pdf-lib";

export const maxDuration = 60;

interface Props {
  params: Promise<{ id: string }>;
}

// ── A4 ─────────────────────────────────────────────────────────────────────
const W  = 595.28;
const H  = 841.89;
const ML = 32;
const MR = 32;
const MT = 30;
const MB = 30;
const CW = W - ML - MR;

const C_DARK  = rgb(0.10, 0.10, 0.10);
const C_MID   = rgb(0.40, 0.40, 0.40);
const C_LITE  = rgb(0.62, 0.62, 0.62);
const C_LINE  = rgb(0.88, 0.88, 0.88);
const C_ALT   = rgb(0.965, 0.966, 0.968);
const C_WHITE = rgb(1, 1, 1);
const C_AMBER = rgb(0.57, 0.25, 0.05);
const C_RED   = rgb(0.55, 0.13, 0.13);

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

type IssueItem = {
  poLabel: string;
  productCode: string;
  description: string;
  uom: string;
  expected: number;
  received: number;
  shortfall: number;
  returned: number;
  returnNotes: string;
  imageUrl: string | null;
};

export async function GET(_req: Request, { params }: Props) {
  try {
    const { id } = await params;

    let pl;
    try {
      pl = await getPackingListDetail(id);
    } catch {
      return new Response("Forbidden", { status: 403 });
    }
    if (!pl) return new Response("Not Found", { status: 404 });
    if (pl.status === "pending") {
      return new Response("Inspection hasn't been completed yet — nothing to report", { status: 400 });
    }

    const poLabelById = new Map(pl.purchaseOrders.map((p) => [p.id, p.poNo ?? p.prNo ?? p.id]));

    const issues: IssueItem[] = pl.items
      .map((item): IssueItem | null => {
        const expected = parseFloat(item.qtyExpected) || 0;
        const received = parseFloat(item.draftQtyReceived ?? item.qtyExpected) || 0;
        const returned = parseFloat(item.draftQtyReturn ?? "0") || 0;
        const shortfall = Math.max(0, expected - received);
        if (shortfall <= 0 && returned <= 0) return null;

        const returnPhoto = item.photos.find((p) => p.category === "return") ?? item.photos[0];
        return {
          poLabel: poLabelById.get(item.purchaseOrderId) ?? item.purchaseOrderId,
          productCode: item.productCode ?? "",
          description: item.description ?? item.productCode ?? "",
          uom: item.uom ?? "",
          expected,
          received,
          shortfall,
          returned,
          returnNotes: item.draftReturnNotes ?? "",
          imageUrl: returnPhoto?.url ?? item.imageUrl ?? null,
        };
      })
      .filter((i): i is IssueItem => i !== null);

    if (issues.length === 0) {
      return new Response("No discrepancies to report — every item was received in full", { status: 400 });
    }

    const orgProfile = await getFullOrganizationProfile();
    const accent = (() => {
      const hex = orgProfile.brandColor.replace("#", "");
      const r = parseInt(hex.slice(0, 2), 16) / 255;
      const g = parseInt(hex.slice(2, 4), 16) / 255;
      const b = parseInt(hex.slice(4, 6), 16) / 255;
      return rgb(r, g, b);
    })();
    const accentDark = (() => {
      const hex = orgProfile.brandColor.replace("#", "");
      const r = parseInt(hex.slice(0, 2), 16) / 255;
      const g = parseInt(hex.slice(2, 4), 16) / 255;
      const b = parseInt(hex.slice(4, 6), 16) / 255;
      return rgb(Math.max(0, r * 0.55), Math.max(0, g * 0.55), Math.max(0, b * 0.55));
    })();

    const pdfDoc = await PDFDocument.create();
    const fontR = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontB = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    // Embed each issue's photo (best-effort — a failed fetch just omits the image).
    const imageCache = new Map<string, PDFImage>();
    await Promise.all(
      issues.map(async (issue) => {
        if (!issue.imageUrl || imageCache.has(issue.imageUrl)) return;
        try {
          const res = await fetch(issue.imageUrl);
          if (!res.ok) return;
          const buf = await res.arrayBuffer();
          let img: PDFImage;
          try { img = await pdfDoc.embedJpg(buf); }
          catch { img = await pdfDoc.embedPng(buf); }
          imageCache.set(issue.imageUrl, img);
        } catch { /* skip */ }
      }),
    );

    // ── Layout ─────────────────────────────────────────────────────────────
    const HDR_H     = 78;
    const COLHDR_H  = 18;
    const ROWS_PER_PG = 5;
    const rowsAvail  = H - MT - HDR_H - COLHDR_H - MB - 20;
    const ROW_H      = Math.floor(rowsAvail / ROWS_PER_PG);
    const IMG_SZ     = ROW_H - 14;
    const COL_IMG    = IMG_SZ + 20;
    const COL_DET    = CW - COL_IMG;

    const totalPgs = Math.ceil(issues.length / ROWS_PER_PG);
    const dateStr  = new Date().toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" });
    const supplierName = (pl.supplierSnapshot as { name?: string } | null)?.name ?? "Supplier";

    for (let pi = 0; pi < totalPgs; pi++) {
      const page = pdfDoc.addPage([W, H]);
      const pageRows = issues.slice(pi * ROWS_PER_PG, (pi + 1) * ROWS_PER_PG);

      // Header band
      page.drawRectangle({ x: 0, y: H - HDR_H, width: W, height: HDR_H, color: accentDark });
      page.drawRectangle({ x: 0, y: H - HDR_H, width: W, height: 3, color: accent });
      page.drawText("SUPPLIER DISCREPANCY REPORT", { x: ML, y: H - 24, size: 13, font: fontB, color: C_WHITE });
      page.drawText(`Packing List ${pl.packingListNo}${pl.supplierRefNo ? `  ·  Supplier ref ${pl.supplierRefNo}` : ""}`, {
        x: ML, y: H - 40, size: 8.5, font: fontR, color: rgb(0.88, 0.88, 0.9),
      });
      page.drawText(`To: ${sanitize(supplierName)}`, { x: ML, y: H - 54, size: 9, font: fontB, color: C_WHITE });
      page.drawText(orgProfile.companyName, { x: ML, y: H - 66, size: 7.5, font: fontR, color: rgb(0.7, 0.7, 0.75) });

      const pgLabel = `Page ${pi + 1} / ${totalPgs}`;
      page.drawText(pgLabel, { x: W - MR - fontB.widthOfTextAtSize(pgLabel, 9), y: H - 24, size: 9, font: fontB, color: rgb(0.85, 0.85, 0.9) });
      page.drawText(dateStr, { x: W - MR - fontR.widthOfTextAtSize(dateStr, 7.5), y: H - 38, size: 7.5, font: fontR, color: rgb(0.7, 0.7, 0.75) });
      const countLabel = `${issues.length} line${issues.length !== 1 ? "s" : ""} with issues`;
      page.drawText(countLabel, { x: W - MR - fontR.widthOfTextAtSize(countLabel, 7), y: H - 50, size: 7, font: fontR, color: rgb(0.65, 0.65, 0.7) });

      // Column header
      const tableTopY = H - HDR_H - COLHDR_H;
      const tableBottomY = tableTopY - pageRows.length * ROW_H;
      page.drawRectangle({ x: ML, y: tableTopY, width: CW, height: COLHDR_H, color: accent });
      page.drawText("IMAGE", { x: ML + (COL_IMG - fontB.widthOfTextAtSize("IMAGE", 6.5)) / 2, y: tableTopY + 5, size: 6.5, font: fontB, color: C_WHITE });
      page.drawText("ITEM / ISSUE", { x: ML + COL_IMG + 8, y: tableTopY + 5, size: 6.5, font: fontB, color: C_WHITE });

      page.drawLine({ start: { x: ML + COL_IMG, y: tableBottomY }, end: { x: ML + COL_IMG, y: tableTopY }, thickness: 0.3, color: C_LINE });

      let rowTopY = tableTopY;
      for (let ri = 0; ri < pageRows.length; ri++) {
        const issue = pageRows[ri];
        const rowY = rowTopY - ROW_H;

        if (ri % 2 === 1) page.drawRectangle({ x: ML, y: rowY, width: CW, height: ROW_H, color: C_ALT });
        page.drawLine({ start: { x: ML, y: rowY }, end: { x: ML + CW, y: rowY }, thickness: 0.3, color: C_LINE });

        const img = issue.imageUrl ? imageCache.get(issue.imageUrl) : undefined;
        if (img) {
          const scale = Math.min(IMG_SZ / img.height, IMG_SZ / img.width, 1);
          page.drawImage(img, {
            x: ML + (COL_IMG - img.width * scale) / 2,
            y: rowY + (ROW_H - img.height * scale) / 2,
            width: img.width * scale,
            height: img.height * scale,
          });
        } else {
          const ph = IMG_SZ * 0.7;
          page.drawRectangle({ x: ML + (COL_IMG - ph) / 2, y: rowY + (ROW_H - ph) / 2, width: ph, height: ph, color: C_LINE });
        }

        const detX = ML + COL_IMG + 8;
        const detMaxW = COL_DET - 16;
        let detY = rowY + ROW_H - 13;

        page.drawText(trunc(`[${issue.poLabel}]  ${issue.productCode}`, fontB, 8.5, detMaxW), { x: detX, y: detY, size: 8.5, font: fontB, color: accent });
        detY -= 11;

        for (const line of wrap(issue.description, fontR, 8, detMaxW).slice(0, 2)) {
          page.drawText(line, { x: detX, y: detY, size: 8, font: fontR, color: C_DARK });
          detY -= 10;
        }

        const qtyStr = `Expected ${issue.expected}${issue.uom}  ·  Received ${issue.received}${issue.uom}`;
        page.drawText(qtyStr, { x: detX, y: detY, size: 7.5, font: fontR, color: C_MID });
        detY -= 11;

        if (issue.shortfall > 0) {
          page.drawText(`Short by ${issue.shortfall} ${issue.uom}`, { x: detX, y: detY, size: 8, font: fontB, color: C_AMBER });
          detY -= 10;
        }
        if (issue.returned > 0) {
          const returnLine = `Returned: ${issue.returned} ${issue.uom} to supplier${issue.returnNotes ? ` — ${issue.returnNotes}` : ""}`;
          for (const line of wrap(returnLine, fontR, 7.5, detMaxW).slice(0, 2)) {
            page.drawText(line, { x: detX, y: detY, size: 7.5, font: fontB, color: C_RED });
            detY -= 9;
          }
        }

        rowTopY = rowY;
      }

      page.drawRectangle({ x: ML, y: tableBottomY, width: CW, height: tableTopY - tableBottomY, borderColor: C_LINE, borderWidth: 0.4 });

      page.drawLine({ start: { x: ML, y: MB + 18 }, end: { x: W - MR, y: MB + 18 }, thickness: 0.6, color: accent });
      const footLeft = `${orgProfile.companyName.toUpperCase()}  ·  SUPPLIER DISCREPANCY REPORT  ·  COMPUTER GENERATED DOCUMENT`;
      page.drawText(trunc(footLeft, fontR, 7, CW * 0.75), { x: ML, y: MB + 8, size: 7, font: fontR, color: C_LITE });
      const footRight = `${pi + 1} / ${totalPgs}`;
      page.drawText(footRight, { x: W - MR - fontR.widthOfTextAtSize(footRight, 7), y: MB + 8, size: 7, font: fontR, color: C_LITE });
    }

    const bytes = await pdfDoc.save();
    const safeNo = pl.packingListNo.replace(/[^a-z0-9]/gi, "_");

    return new Response(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${safeNo}_discrepancy_report.pdf"`,
      },
    });
  } catch (e) {
    console.error("[packing-list discrepancy-report] error:", e);
    return new Response("Internal Server Error", { status: 500 });
  }
}
