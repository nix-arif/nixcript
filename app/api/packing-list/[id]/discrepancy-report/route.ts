import { getPackingListDetail, getPackingListDetailCentralized } from "@/server/packing-list";
import { getOrganizationBranding } from "@/server/organization-profile";
import { db } from "@/db";
import { purchaseOrderItem } from "@/db/schema";
import { inArray } from "drizzle-orm";
import { PDFDocument, rgb, StandardFonts, PDFImage, PDFFont, PDFPage, PDFString } from "pdf-lib";
import ExcelJS from "exceljs";
import JSZip from "jszip";

export const maxDuration = 60;

interface Props {
  params: Promise<{ id: string }>;
}

// Same fallback the on-screen item thumbnail uses (ItemImageThumb in the
// packing-list clients) — a supplier's own uploaded return photo wins when
// there is one, but most items never get a photo attached during
// inspection, so without this fallback the report would show no image at
// all for the common case. Keyed by product code, same as the UI.
const R2_PRODUCT_IMAGES = process.env.NEXT_PUBLIC_R2_PRODUCT_IMAGES_URL ?? "";

// ── A4 ─────────────────────────────────────────────────────────────────────
const W  = 595.28;
const H  = 841.89;
const ML = 32;
const MR = 32;
const MT = 30;
const MB = 30;
const CW = W - ML - MR;

const C_DARK   = rgb(0.10, 0.10, 0.10);
const C_MID    = rgb(0.40, 0.40, 0.40);
const C_LITE   = rgb(0.62, 0.62, 0.62);
const C_LINE   = rgb(0.88, 0.88, 0.88);
const C_ALT    = rgb(0.965, 0.966, 0.968);
const C_WHITE  = rgb(1, 1, 1);
const C_AMBER  = rgb(0.57, 0.25, 0.05);
const C_RED    = rgb(0.55, 0.13, 0.13);
const C_BRAND  = rgb(0.36, 0.27, 0.56);

function sanitize(t: string): string {
  return String(t ?? "").replace(/[\x00-\x1F\x7F]/g, " ");
}

// Wraps to fit maxW — never drops content. A single word wider than maxW on
// its own gets hard-broken character by character rather than overflowing,
// so long unbroken strings (e.g. a code with no spaces) still show in full.
function wrap(text: string, font: PDFFont, size: number, maxW: number): string[] {
  if (!text) return [];
  const words = sanitize(text).split(" ").filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const word of words) {
    const test = cur ? `${cur} ${word}` : word;
    if (font.widthOfTextAtSize(test, size) <= maxW) {
      cur = test;
      continue;
    }
    if (cur) lines.push(cur);
    if (font.widthOfTextAtSize(word, size) <= maxW) {
      cur = word;
    } else {
      let piece = "";
      for (const ch of word) {
        const next = piece + ch;
        if (font.widthOfTextAtSize(next, size) > maxW && piece) {
          lines.push(piece);
          piece = ch;
        } else {
          piece = next;
        }
      }
      cur = piece;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

// Only ever used on the fixed decorative footer line below, never on report
// data — every field pulled from the packing list itself is wrapped in
// full via wrap() above, not truncated.
function trunc(text: string, font: PDFFont, size: number, maxW: number): string {
  if (!text) return "";
  const t = sanitize(text).trim();
  if (font.widthOfTextAtSize(t, size) <= maxW) return t;
  let s = t;
  while (s.length > 0 && font.widthOfTextAtSize(s + "…", size) > maxW) s = s.slice(0, -1);
  return s + "…";
}

type IssueItem = {
  // Sequential position of this row within the report (1, 2, 3…) — distinct
  // from poLineNo below, since a packing list can span multiple POs and a
  // reader needs both "which row in this document" and "which line on the
  // supplier's own PO" to actually locate the item.
  no: number;
  poLabel: string;
  // The line/row number on the ORIGINAL Supplier PO this item came from —
  // null only if the item somehow has no linked PO item (shouldn't happen
  // in practice, every packing list item is created from one).
  poLineNo: number | null;
  productCode: string;
  designBrandName: string | null;
  designBrandCode: string | null;
  description: string;
  uom: string;
  expected: number;
  received: number;
  shortfall: number;
  returned: number;
  returnNotes: string;
  // Product identification photo — the item's own uploaded image, falling
  // back to the catalogue reference photo. Kept separate from evidence
  // photos below: this one shows WHAT the product is, not what's wrong
  // with this particular shipment.
  identityImageUrl: string | null;
  // Every photo actually attached during inspection for this line's return
  // — previously only the first one was ever shown and the rest silently
  // dropped; all of them are report-worthy evidence of the finding.
  evidenceImageUrls: string[];
};

type CachedImage = { buffer: Buffer; extension: "jpeg" | "png" | "gif" };

// Fetched once, shared between the PDF and Excel builders — best-effort per
// image, a failed fetch just means that one row renders without a picture
// rather than failing the whole report.
async function fetchImages(urls: (string | null)[]): Promise<Map<string, CachedImage>> {
  const cache = new Map<string, CachedImage>();
  const unique = [...new Set(urls.filter((u): u is string => !!u))];
  await Promise.all(unique.map(async (url) => {
    try {
      const res = await fetch(url);
      if (!res.ok) return;
      const contentType = res.headers.get("content-type") ?? "";
      const buffer = Buffer.from(await res.arrayBuffer());
      let extension: CachedImage["extension"] = "jpeg";
      if (contentType.includes("png") || /\.png(\?|$)/i.test(url)) extension = "png";
      else if (contentType.includes("gif") || /\.gif(\?|$)/i.test(url)) extension = "gif";
      cache.set(url, { buffer, extension });
    } catch { /* best-effort — skip this image */ }
  }));
  return cache;
}

// ── Full-res image bundling ─────────────────────────────────────────────
// The PDF only ever shows small thumbnails (limited page space), so the
// same images fetched for those thumbnails are also handed out as
// full-resolution files alongside the PDF, named to match the caption
// printed under/on each thumbnail — a reader can go straight from a photo
// in the report to its full-size file without guessing which is which.
function extOf(cached: CachedImage): string {
  return cached.extension === "jpeg" ? "jpg" : cached.extension;
}

function identityFilename(issue: IssueItem, images: Map<string, CachedImage>): string | null {
  if (!issue.identityImageUrl) return null;
  const cached = images.get(issue.identityImageUrl);
  if (!cached) return null;
  return `item-${issue.no}-photo.${extOf(cached)}`;
}

function evidenceFilename(issue: IssueItem, idx: number, images: Map<string, CachedImage>): string | null {
  const cached = images.get(issue.evidenceImageUrls[idx]);
  if (!cached) return null;
  return `item-${issue.no}-evidence-${idx + 1}.${extOf(cached)}`;
}

function buildImageZipEntries(issues: IssueItem[], images: Map<string, CachedImage>): { name: string; buffer: Buffer }[] {
  const entries: { name: string; buffer: Buffer }[] = [];
  for (const issue of issues) {
    const idFn = identityFilename(issue, images);
    if (idFn) entries.push({ name: `images/${idFn}`, buffer: images.get(issue.identityImageUrl!)!.buffer });
    issue.evidenceImageUrls.forEach((url, idx) => {
      const fn = evidenceFilename(issue, idx, images);
      if (fn) entries.push({ name: `images/${fn}`, buffer: images.get(url)!.buffer });
    });
  }
  return entries;
}

// ── Excel ────────────────────────────────────────────────────────────────

async function buildXlsxResponse(
  packingListNo: string,
  supplierRefNo: string | null,
  supplierName: string,
  companyName: string,
  brandColorHex: string,
  issues: IssueItem[],
  images: Map<string, CachedImage>,
): Promise<Response> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Discrepancies");
  const accentArgb = `FF${brandColorHex.replace("#", "").toUpperCase()}`;
  const thinBorder: Partial<ExcelJS.Borders> = {
    top: { style: "thin", color: { argb: "FFD1D5DB" } },
    left: { style: "thin", color: { argb: "FFD1D5DB" } },
    bottom: { style: "thin", color: { argb: "FFD1D5DB" } },
    right: { style: "thin", color: { argb: "FFD1D5DB" } },
  };

  const maxEvidence = issues.reduce((max, i) => Math.max(max, i.evidenceImageUrls.length), 0);
  const baseHeaders = ["No.", "Image", "PO", "PO Line", "Product Code", "Design Brand", "Design Code", "Description", "UOM", "Expected", "Received", "Short", "Returned", "Return Notes"];
  const evidenceHeaders = Array.from({ length: maxEvidence }, (_, i) => `Evidence Photo ${i + 1}`);
  const headers = [...baseHeaders, ...evidenceHeaders];
  const totalCols = headers.length;

  sheet.mergeCells(1, 1, 1, totalCols);
  sheet.getCell(1, 1).value = "SUPPLIER DISCREPANCY REPORT";
  sheet.getCell(1, 1).font = { bold: true, size: 14 };

  sheet.mergeCells(2, 1, 2, totalCols);
  sheet.getCell(2, 1).value = `Packing List ${packingListNo}${supplierRefNo ? `  ·  Supplier ref ${supplierRefNo}` : ""}`;
  sheet.getCell(2, 1).font = { size: 10, color: { argb: "FF666666" } };

  sheet.mergeCells(3, 1, 3, totalCols);
  const dateStr = new Date().toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" });
  sheet.getCell(3, 1).value = `To: ${supplierName}  ·  From: ${companyName}  ·  ${dateStr}`;
  sheet.getCell(3, 1).font = { size: 9, color: { argb: "FF888888" } };

  sheet.addRow([]);

  const headerRow = sheet.addRow(headers);
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: accentArgb } };
    cell.alignment = { vertical: "middle", horizontal: "center" };
    cell.border = thinBorder;
  });

  const IMG_PX = 80;
  const ROW_HEIGHT_PT = 62; // ~80px tall image plus a little breathing room
  const IMAGE_COL = baseHeaders.indexOf("Image");
  const DESC_COL = baseHeaders.indexOf("Description");
  const NOTES_COL = baseHeaders.indexOf("Return Notes");
  const EVIDENCE_START_COL = baseHeaders.length;

  function embedImage(url: string | null | undefined, colIndex0: number, rowIndex0: number) {
    const cached = url ? images.get(url) : undefined;
    if (!cached) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- exceljs's Buffer type doesn't line up with Node's here; same cast used in app/api/products/picture-ref/route.ts
    const imageId = workbook.addImage({ buffer: cached.buffer as any, extension: cached.extension === "gif" ? "png" : cached.extension });
    sheet.addImage(imageId, {
      tl: { col: colIndex0 + 0.1, row: rowIndex0 + 0.1 },
      ext: { width: IMG_PX, height: IMG_PX },
    });
  }

  issues.forEach((issue, i) => {
    const row = sheet.addRow([
      issue.no,
      "",
      issue.poLabel,
      issue.poLineNo ?? "",
      issue.productCode,
      issue.designBrandName ?? "",
      issue.designBrandCode ?? "",
      issue.description,
      issue.uom,
      issue.expected,
      issue.received,
      issue.shortfall || null,
      issue.returned || null,
      issue.returnNotes,
      ...issue.evidenceImageUrls.map(() => ""),
    ]);
    row.height = ROW_HEIGHT_PT;
    row.eachCell((cell, colNum) => {
      cell.border = thinBorder;
      const colIndex0 = colNum - 1;
      const isTextCol = colIndex0 === DESC_COL || colIndex0 === NOTES_COL;
      cell.alignment = { vertical: "middle", wrapText: isTextCol, horizontal: isTextCol ? "left" : "center" };
    });
    row.getCell(baseHeaders.indexOf("No.") + 1).font = { bold: true };
    if (issue.shortfall > 0) row.getCell(baseHeaders.indexOf("Short") + 1).font = { bold: true, color: { argb: "FF92400E" } };
    if (issue.returned > 0) row.getCell(baseHeaders.indexOf("Returned") + 1).font = { bold: true, color: { argb: "FFB91C1C" } };

    // header(row1) + pl-no(row2) + to/from(row3) + blank(row4) + col-header(row5) + this row (1-indexed) -> 0-indexed anchor row
    const rowIndex0 = 5 + i;
    embedImage(issue.identityImageUrl, IMAGE_COL, rowIndex0);
    issue.evidenceImageUrls.forEach((url, ei) => embedImage(url, EVIDENCE_START_COL + ei, rowIndex0));
  });

  sheet.columns = [
    { width: 6 },   // No.
    { width: 12 },  // Image
    { width: 12 },  // PO
    { width: 9 },   // PO Line
    { width: 14 },  // Product Code
    { width: 16 },  // Design Brand
    { width: 14 },  // Design Code
    { width: 40 },  // Description
    { width: 7 },   // UOM
    { width: 9 },   // Expected
    { width: 9 },   // Received
    { width: 7 },   // Short
    { width: 9 },   // Returned
    { width: 32 },  // Return Notes
    ...evidenceHeaders.map(() => ({ width: 12 })),
  ];

  const buf = await workbook.xlsx.writeBuffer();
  const safeNo = packingListNo.replace(/[^a-z0-9]/gi, "_");
  return new Response(buf as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${safeNo}_discrepancy_report.xlsx"`,
    },
  });
}

// ── PDF ──────────────────────────────────────────────────────────────────

type Measured = {
  issue: IssueItem;
  headerLines: string[];
  brandLine: string[];
  descLines: string[];
  returnLines: string[];
  evidenceRows: number;
  evidenceThumbsPerRow: number;
  height: number;
};

const NO_COL_W = 24;
const IMG_COL_W = 92;
const IMG_SZ = 72;
const IMG_CAPTION_GAP = 3;
const IMG_CAPTION_SIZE = 5.5;
// Image + its filename caption, stacked as one centered block within the row.
const IMG_BLOCK_H = IMG_SZ + IMG_CAPTION_GAP + IMG_CAPTION_SIZE;
const HEADER_LINE_H = 12;
const TEXT_LINE_H = 10.5;
const RETURN_LINE_H = 9.5;
const ROW_V_PAD = 14;
const ROW_MIN_H = IMG_BLOCK_H + ROW_V_PAD;
const EVID_THUMB = 34;
const EVID_GAP = 5;
const EVID_LABEL_H = 11;

function measure(issue: IssueItem, fontR: PDFFont, fontB: PDFFont, detMaxW: number): Measured {
  const poLineText = issue.poLineNo !== null ? `  ·  PO Line ${issue.poLineNo}` : "";
  const headerLines = wrap(`[${issue.poLabel}]  ${issue.productCode}${poLineText}`, fontB, 8.5, detMaxW);

  const brandBits: string[] = [];
  if (issue.designBrandName) brandBits.push(`Design Brand: ${issue.designBrandName}`);
  if (issue.designBrandCode) brandBits.push(`Code: ${issue.designBrandCode}`);
  const brandLine = brandBits.length > 0 ? wrap(brandBits.join("  ·  "), fontR, 8, detMaxW) : [];

  const descLines = wrap(issue.description, fontR, 8, detMaxW);
  const returnLine = issue.returned > 0
    ? `Returned: ${issue.returned} ${issue.uom} to supplier${issue.returnNotes ? ` — ${issue.returnNotes}` : ""}`
    : "";
  const returnLines = returnLine ? wrap(returnLine, fontR, 7.5, detMaxW) : [];

  const evidenceThumbsPerRow = Math.max(1, Math.floor(detMaxW / (EVID_THUMB + EVID_GAP)));
  const evidenceRows = issue.evidenceImageUrls.length > 0
    ? Math.ceil(issue.evidenceImageUrls.length / evidenceThumbsPerRow)
    : 0;

  const textH = headerLines.length * HEADER_LINE_H
    + brandLine.length * TEXT_LINE_H
    + descLines.length * TEXT_LINE_H
    + TEXT_LINE_H // expected/received line, always present
    + (issue.shortfall > 0 ? TEXT_LINE_H : 0)
    + returnLines.length * RETURN_LINE_H
    + (evidenceRows > 0 ? EVID_LABEL_H + evidenceRows * (EVID_THUMB + EVID_GAP) : 0)
    + ROW_V_PAD;

  return { issue, headerLines, brandLine, descLines, returnLines, evidenceRows, evidenceThumbsPerRow, height: Math.max(textH, ROW_MIN_H) };
}

// Invisible link over a thumbnail that opens the matching full-res file from
// the bundled zip's images/ folder. Best-effort by nature: most browser PDF
// viewers (Chrome/Edge's built-in viewer, Firefox's pdf.js) don't implement
// Launch actions at all and will just do nothing on click, and desktop
// Acrobat/Reader shows its own "allow this document to open a file?" prompt
// first — the filename caption/badge stays the reliable fallback either way.
function addOpenFileLink(
  pdfDoc: PDFDocument,
  page: PDFPage,
  rect: { x: number; y: number; width: number; height: number },
  relativePath: string,
): void {
  const { context } = pdfDoc;
  const annot = context.obj({
    Type: "Annot",
    Subtype: "Link",
    Rect: [rect.x, rect.y, rect.x + rect.width, rect.y + rect.height],
    Border: [0, 0, 0],
    A: {
      Type: "Action",
      S: "Launch",
      F: PDFString.of(relativePath),
      NewWindow: true,
    },
  });
  page.node.addAnnot(context.register(annot));
}

export async function GET(req: Request, { params }: Props) {
  try {
    const { id } = await params;
    const format = new URL(req.url).searchParams.get("format") === "xlsx" ? "xlsx" : "pdf";

    // Own-org first, falling back to the cross-org (centralized) read —
    // without this fallback, anyone viewing this packing list through the
    // centralized page (its own org differs from the viewer's currently
    // active org) always got a 404 here, no matter their permissions,
    // because getPackingListDetail only ever matches organizationId against
    // the caller's active org.
    //
    // The two calls are tried in SEPARATE try/catches on purpose: a caller
    // who holds packing-list:read:centralized but not the plain
    // purchase-order:read (a real, valid combination — see
    // packing-list:read:centralized vs. purchase-order:read:centralized,
    // two different keys) makes getPackingListDetail throw immediately.
    // Catching both calls in one try means that throw skips the centralized
    // fallback entirely and wrongly reports 403 — only report Forbidden once
    // BOTH paths have actually failed.
    let pl = null;
    try {
      pl = await getPackingListDetail(id);
    } catch { /* no purchase-order:read in the active org — try centralized below */ }
    if (!pl) {
      try {
        pl = await getPackingListDetailCentralized(id);
      } catch {
        return new Response("Forbidden", { status: 403 });
      }
    }
    if (!pl) return new Response("Not Found", { status: 404 });
    if (pl.status === "pending") {
      return new Response("Inspection hasn't been completed yet — nothing to report", { status: 400 });
    }

    const poLabelById = new Map(pl.purchaseOrders.map((p) => [p.id, p.poNo ?? p.prNo ?? p.id]));

    // The packing list item's own rowNo is just its position within THIS
    // packing list — to say which line of the supplier's actual PO an item
    // came from, we need the linked purchase_order_item's own rowNo instead.
    const poItemIds = [...new Set(pl.items.map((i) => i.purchaseOrderItemId).filter((v): v is string => !!v))];
    const poItemRows = poItemIds.length > 0
      ? await db.select({ id: purchaseOrderItem.id, rowNo: purchaseOrderItem.rowNo }).from(purchaseOrderItem).where(inArray(purchaseOrderItem.id, poItemIds))
      : [];
    const poLineNoById = new Map(poItemRows.map((r) => [r.id, r.rowNo]));

    const issues: IssueItem[] = pl.items
      .map((item): Omit<IssueItem, "no"> | null => {
        const expected = parseFloat(item.qtyExpected) || 0;
        const received = parseFloat(item.draftQtyReceived ?? item.qtyExpected) || 0;
        const returned = parseFloat(item.draftQtyReturn ?? "0") || 0;
        const shortfall = Math.max(0, expected - received);
        if (shortfall <= 0 && returned <= 0) return null;

        const evidencePhotos = item.photos.filter((p) => p.category === "return");
        const catalogImageUrl = R2_PRODUCT_IMAGES && item.productCode
          ? `${R2_PRODUCT_IMAGES}/${encodeURIComponent(item.productCode)}.jpg`
          : null;
        return {
          poLabel: poLabelById.get(item.purchaseOrderId) ?? item.purchaseOrderId,
          poLineNo: item.purchaseOrderItemId ? (poLineNoById.get(item.purchaseOrderItemId) ?? null) : null,
          productCode: item.productCode ?? "",
          designBrandName: item.designBrandName?.trim() ? item.designBrandName : null,
          designBrandCode: item.designBrandCode?.trim() ? item.designBrandCode : null,
          description: item.description ?? item.productCode ?? "",
          uom: item.uom ?? "",
          expected,
          received,
          shortfall,
          returned,
          returnNotes: item.draftReturnNotes ?? "",
          identityImageUrl: item.imageUrl ?? catalogImageUrl,
          evidenceImageUrls: evidencePhotos.map((p) => p.url),
        };
      })
      .filter((i): i is Omit<IssueItem, "no"> => i !== null)
      // Numbered only after filtering, so the sequence is 1..N over what the
      // report actually shows, not the packing list's full item list.
      .map((issue, idx) => ({ ...issue, no: idx + 1 }));

    if (issues.length === 0) {
      return new Response("No discrepancies to report — every item was received in full", { status: 400 });
    }

    // Branding must reflect the org that issued the Supplier PO (the packing
    // list's own org), not whichever org the downloader currently has active
    // — relevant when this is fetched via the centralized/cross-org fallback.
    const orgProfile = await getOrganizationBranding(pl.organizationId);
    const allImageUrls = issues.flatMap((i) => [i.identityImageUrl, ...i.evidenceImageUrls]);
    const images = await fetchImages(allImageUrls);

    if (format === "xlsx") {
      const supplierName = (pl.supplierSnapshot as { name?: string } | null)?.name ?? "Supplier";
      return buildXlsxResponse(pl.packingListNo, pl.supplierRefNo, supplierName, orgProfile.companyName, orgProfile.brandColor, issues, images);
    }

    // The PDF can only ever show small thumbnails, so when there's at least
    // one photo, ship a zip with the PDF plus every photo at full size —
    // named to match the caption/number printed on its thumbnail.
    const imageEntries = buildImageZipEntries(issues, images);
    const hasBundledImages = imageEntries.length > 0;

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

    // Embed each cached image once as a PDF XObject (pdf-lib embeds jpg/png
    // only — a gif source, rare, just renders without a picture).
    const pdfImageCache = new Map<string, PDFImage>();
    for (const [url, cached] of images) {
      try {
        const img = cached.extension === "png" ? await pdfDoc.embedPng(cached.buffer) : await pdfDoc.embedJpg(cached.buffer);
        pdfImageCache.set(url, img);
      } catch { /* unsupported format — skip */ }
    }

    // ── Layout ─────────────────────────────────────────────────────────────
    // One extra line of header room to explain the images/ folder naming
    // convention, only when there's actually a zip with photos in it.
    const HDR_H = hasBundledImages ? 90 : 78;
    const COLHDR_H = 18;
    const FOOTER_H = 20;
    const availH = H - MT - HDR_H - COLHDR_H - MB - FOOTER_H;
    const COL_DET = CW - NO_COL_W - IMG_COL_W;
    const detMaxW = COL_DET - 16;

    const measured = issues.map((issue) => measure(issue, fontR, fontB, detMaxW));

    // Paginate by accumulated row height rather than a fixed row count, so
    // no row's text, images, or evidence photos are ever cut off to fit a
    // preset grid.
    const pages: Measured[][] = [];
    let current: Measured[] = [];
    let currentH = 0;
    for (const m of measured) {
      if (current.length > 0 && currentH + m.height > availH) {
        pages.push(current);
        current = [];
        currentH = 0;
      }
      current.push(m);
      currentH += m.height;
    }
    if (current.length > 0) pages.push(current);

    const totalPgs = pages.length;
    const dateStr  = new Date().toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" });
    const supplierName = (pl.supplierSnapshot as { name?: string } | null)?.name ?? "Supplier";

    for (let pi = 0; pi < totalPgs; pi++) {
      const page = pdfDoc.addPage([W, H]);
      const pageRows = pages[pi];
      const pageH = pageRows.reduce((sum, m) => sum + m.height, 0);

      // Header band
      page.drawRectangle({ x: 0, y: H - HDR_H, width: W, height: HDR_H, color: accentDark });
      page.drawRectangle({ x: 0, y: H - HDR_H, width: W, height: 3, color: accent });
      page.drawText("SUPPLIER DISCREPANCY REPORT", { x: ML, y: H - 24, size: 13, font: fontB, color: C_WHITE });
      page.drawText(`Packing List ${pl.packingListNo}${pl.supplierRefNo ? `  ·  Supplier ref ${pl.supplierRefNo}` : ""}`, {
        x: ML, y: H - 40, size: 8.5, font: fontR, color: rgb(0.88, 0.88, 0.9),
      });
      page.drawText(`To: ${sanitize(supplierName)}`, { x: ML, y: H - 54, size: 9, font: fontB, color: C_WHITE });
      page.drawText(orgProfile.companyName, { x: ML, y: H - 66, size: 7.5, font: fontR, color: rgb(0.7, 0.7, 0.75) });
      if (hasBundledImages) {
        const legend = "Full-resolution photos are bundled with this download in an images/ folder — item-<No.>-photo.jpg and item-<No.>-evidence-<n>.jpg (n = the numbered badge on each thumbnail below); some PDF viewers let you click a thumbnail to open its file directly.";
        page.drawText(trunc(legend, fontR, 6.5, CW), { x: ML, y: H - 78, size: 6.5, font: fontR, color: rgb(0.75, 0.75, 0.8) });
      }

      const pgLabel = `Page ${pi + 1} / ${totalPgs}`;
      page.drawText(pgLabel, { x: W - MR - fontB.widthOfTextAtSize(pgLabel, 9), y: H - 24, size: 9, font: fontB, color: rgb(0.85, 0.85, 0.9) });
      page.drawText(dateStr, { x: W - MR - fontR.widthOfTextAtSize(dateStr, 7.5), y: H - 38, size: 7.5, font: fontR, color: rgb(0.7, 0.7, 0.75) });
      const countLabel = `${issues.length} line${issues.length !== 1 ? "s" : ""} with issues`;
      page.drawText(countLabel, { x: W - MR - fontR.widthOfTextAtSize(countLabel, 7), y: H - 50, size: 7, font: fontR, color: rgb(0.65, 0.65, 0.7) });

      // Column header
      const tableTopY = H - HDR_H - COLHDR_H;
      const tableBottomY = tableTopY - pageH;
      page.drawRectangle({ x: ML, y: tableTopY, width: CW, height: COLHDR_H, color: accent });
      page.drawText("NO.", { x: ML + (NO_COL_W - fontB.widthOfTextAtSize("NO.", 6.5)) / 2, y: tableTopY + 5, size: 6.5, font: fontB, color: C_WHITE });
      page.drawText("IMAGE", { x: ML + NO_COL_W + (IMG_COL_W - fontB.widthOfTextAtSize("IMAGE", 6.5)) / 2, y: tableTopY + 5, size: 6.5, font: fontB, color: C_WHITE });
      page.drawText("ITEM / ISSUE", { x: ML + NO_COL_W + IMG_COL_W + 8, y: tableTopY + 5, size: 6.5, font: fontB, color: C_WHITE });

      page.drawLine({ start: { x: ML + NO_COL_W, y: tableBottomY }, end: { x: ML + NO_COL_W, y: tableTopY }, thickness: 0.3, color: C_LINE });
      page.drawLine({ start: { x: ML + NO_COL_W + IMG_COL_W, y: tableBottomY }, end: { x: ML + NO_COL_W + IMG_COL_W, y: tableTopY }, thickness: 0.3, color: C_LINE });

      let rowTopY = tableTopY;
      for (let ri = 0; ri < pageRows.length; ri++) {
        const m = pageRows[ri];
        const issue = m.issue;
        const rowH = m.height;
        const rowY = rowTopY - rowH;

        if (ri % 2 === 1) page.drawRectangle({ x: ML, y: rowY, width: CW, height: rowH, color: C_ALT });
        page.drawLine({ start: { x: ML, y: rowY }, end: { x: ML + CW, y: rowY }, thickness: 0.3, color: C_LINE });

        const noStr = String(issue.no);
        page.drawText(noStr, { x: ML + (NO_COL_W - fontB.widthOfTextAtSize(noStr, 9)) / 2, y: rowY + rowH / 2 - 3, size: 9, font: fontB, color: C_MID });

        // Image + its filename caption sit together as one centered block —
        // the caption only appears when that file actually made it into the
        // bundled zip (a fetch failure just means no thumbnail, no caption).
        const img = issue.identityImageUrl ? pdfImageCache.get(issue.identityImageUrl) : undefined;
        const idFn = identityFilename(issue, images);
        const blockY = rowY + (rowH - IMG_BLOCK_H) / 2;
        const imgAreaY = idFn ? blockY + IMG_CAPTION_GAP + IMG_CAPTION_SIZE : blockY;
        const imgAreaH = idFn ? IMG_SZ : IMG_BLOCK_H;
        if (img) {
          const scale = Math.min(IMG_SZ / img.height, IMG_SZ / img.width, 1);
          const imgW = img.width * scale;
          const imgH = img.height * scale;
          page.drawImage(img, {
            x: ML + NO_COL_W + (IMG_COL_W - imgW) / 2,
            y: imgAreaY + (imgAreaH - imgH) / 2,
            width: imgW,
            height: imgH,
          });
        } else {
          const ph = Math.min(IMG_SZ * 0.7, imgAreaH);
          page.drawRectangle({ x: ML + NO_COL_W + (IMG_COL_W - ph) / 2, y: imgAreaY + (imgAreaH - ph) / 2, width: ph, height: ph, color: C_LINE });
        }
        if (idFn) {
          const capText = trunc(idFn, fontR, IMG_CAPTION_SIZE, IMG_COL_W - 8);
          page.drawText(capText, {
            x: ML + NO_COL_W + (IMG_COL_W - fontR.widthOfTextAtSize(capText, IMG_CAPTION_SIZE)) / 2,
            y: blockY,
            size: IMG_CAPTION_SIZE,
            font: fontR,
            color: C_LITE,
          });
          addOpenFileLink(
            pdfDoc,
            page,
            { x: ML + NO_COL_W, y: rowY, width: IMG_COL_W, height: rowH },
            `images/${idFn}`,
          );
        }

        const detX = ML + NO_COL_W + IMG_COL_W + 8;
        let detY = rowY + rowH - 12;

        for (const line of m.headerLines) {
          page.drawText(line, { x: detX, y: detY, size: 8.5, font: fontB, color: accent });
          detY -= HEADER_LINE_H;
        }

        for (const line of m.brandLine) {
          page.drawText(line, { x: detX, y: detY, size: 8, font: fontR, color: C_BRAND });
          detY -= TEXT_LINE_H;
        }

        for (const line of m.descLines) {
          page.drawText(line, { x: detX, y: detY, size: 8, font: fontR, color: C_DARK });
          detY -= TEXT_LINE_H;
        }

        const qtyStr = `Expected ${issue.expected}${issue.uom}  ·  Received ${issue.received}${issue.uom}`;
        page.drawText(qtyStr, { x: detX, y: detY, size: 7.5, font: fontR, color: C_MID });
        detY -= TEXT_LINE_H;

        if (issue.shortfall > 0) {
          page.drawText(`Short by ${issue.shortfall} ${issue.uom}`, { x: detX, y: detY, size: 8, font: fontB, color: C_AMBER });
          detY -= TEXT_LINE_H;
        }

        for (const line of m.returnLines) {
          page.drawText(line, { x: detX, y: detY, size: 7.5, font: fontB, color: C_RED });
          detY -= RETURN_LINE_H;
        }

        if (issue.evidenceImageUrls.length > 0) {
          page.drawText(`Photos attached (${issue.evidenceImageUrls.length}):`, { x: detX, y: detY, size: 7, font: fontB, color: C_MID });
          detY -= EVID_LABEL_H;

          issue.evidenceImageUrls.forEach((url, ei) => {
            const col = ei % m.evidenceThumbsPerRow;
            const rowInGroup = Math.floor(ei / m.evidenceThumbsPerRow);
            const thumbX = detX + col * (EVID_THUMB + EVID_GAP);
            const thumbTopY = detY - rowInGroup * (EVID_THUMB + EVID_GAP);
            const thumbY = thumbTopY - EVID_THUMB;

            const evImg = pdfImageCache.get(url);
            if (evImg) {
              const scale = Math.min(EVID_THUMB / evImg.height, EVID_THUMB / evImg.width, 1);
              page.drawImage(evImg, {
                x: thumbX + (EVID_THUMB - evImg.width * scale) / 2,
                y: thumbY + (EVID_THUMB - evImg.height * scale) / 2,
                width: evImg.width * scale,
                height: evImg.height * scale,
              });
              page.drawRectangle({ x: thumbX, y: thumbY, width: EVID_THUMB, height: EVID_THUMB, borderColor: C_LINE, borderWidth: 0.4 });
            } else {
              page.drawRectangle({ x: thumbX, y: thumbY, width: EVID_THUMB, height: EVID_THUMB, color: C_LINE });
            }

            // Numbered badge matching the file's "-evidence-<n>" suffix in
            // the bundled zip, so a thumbnail here maps straight to its file.
            const evFn = evidenceFilename(issue, ei, images);
            if (evFn) {
              const label = String(ei + 1);
              const lblW = fontB.widthOfTextAtSize(label, 5.5) + 3;
              page.drawRectangle({ x: thumbX, y: thumbY, width: lblW, height: 7.5, color: C_WHITE, opacity: 0.85 });
              page.drawText(label, { x: thumbX + 1.5, y: thumbY + 1.8, size: 5.5, font: fontB, color: C_DARK });
              addOpenFileLink(pdfDoc, page, { x: thumbX, y: thumbY, width: EVID_THUMB, height: EVID_THUMB }, `images/${evFn}`);
            }
          });
          detY -= m.evidenceRows * (EVID_THUMB + EVID_GAP);
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

    if (!hasBundledImages) {
      return new Response(Buffer.from(bytes), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${safeNo}_discrepancy_report.pdf"`,
        },
      });
    }

    const zip = new JSZip();
    zip.file(`${safeNo}_discrepancy_report.pdf`, Buffer.from(bytes));
    for (const entry of imageEntries) zip.file(entry.name, entry.buffer);
    const zipBuf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });

    return new Response(zipBuf as unknown as ArrayBuffer, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${safeNo}_discrepancy_report.zip"`,
      },
    });
  } catch (e) {
    console.error("[packing-list discrepancy-report] error:", e);
    return new Response("Internal Server Error", { status: 500 });
  }
}
