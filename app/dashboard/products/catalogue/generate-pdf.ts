import { PDFDocument, PDFFont, PDFPage, rgb, StandardFonts } from "pdf-lib";
import { trunc, sanitizeText, hLine } from "@/app/dashboard/sales/quotation/[id]/print/_pdf-header";

type CatalogueRow = {
  no: number;
  sku?: string;
  productCode: string;
  description?: string;
  qty?: string | number;
  uom?: string;
  registrationNo?: string | null;
  validFrom?: string | null;
  expiredOn?: string | null;
  imageUrl?: string;
};

type GenerateOptions = {
  title: string;
  subtitle?: string;
  companyName?: string;
  rows: CatalogueRow[];
  options: {
    showSku: boolean;
    showProductCode: boolean;
    showRegNo: boolean;
    showValidity: boolean;
  };
};

// ── Color palette ──────────────────────────────────────────────────────────
const C_INK       = rgb(0.102, 0.122, 0.169);
const C_MUTED     = rgb(0.451, 0.49,  0.569);
const C_SUBTLE    = rgb(0.69,  0.729, 0.784);
const C_BLUE      = rgb(0.145, 0.31,  0.847);
const C_HEADER_BG = rgb(0.961, 0.965, 0.973);
const C_BORDER    = rgb(0.871, 0.882, 0.906);
const C_ROW_ALT   = rgb(0.98,  0.984, 0.992);
const C_WHITE     = rgb(1, 1, 1);
const C_ACCENT    = rgb(0.2,   0.259, 0.435);

// ── A4 geometry ────────────────────────────────────────────────────────────
const PAGE_W      = 595.28;
const PAGE_H      = 841.89;
const MARGIN      = 40;
const CONTENT_W   = PAGE_W - MARGIN * 2;
const HEADER_H    = 72;
const FOOTER_H    = 24;
const COL_HDR_H   = 24;
const IMG_SIZE    = 96;
const ROW_PAD     = 12;
const ROW_H       = IMG_SIZE + ROW_PAD * 2;
const TABLE_TOP   = PAGE_H - HEADER_H - MARGIN - COL_HDR_H;
const USABLE_H    = TABLE_TOP - FOOTER_H - ROW_PAD;
const ROWS_PER_PAGE = Math.floor(USABLE_H / ROW_H);
const COL_NO_W    = 28;
const COL_IMG_W   = IMG_SIZE + 8;
const COL_DET_W   = CONTENT_W - COL_NO_W - COL_IMG_W;

// ── Image fetch ────────────────────────────────────────────────────────────
async function fetchImageBytes(url: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  } catch {
    return null;
  }
}

// ── Per-page header ─────────────────────────────────────────────────────────
interface CatalogueHeaderOpts {
  page: PDFPage;
  pageNum: number;
  totalPages: number;
  totalItems: number;
  title: string;
  subtitle?: string;
  companyName?: string;
  fontBold: PDFFont;
  fontRegular: PDFFont;
}

function drawCatalogueHeader(opts: CatalogueHeaderOpts): void {
  const { page, pageNum, totalPages, totalItems, title, subtitle, companyName, fontBold, fontRegular } = opts;

  page.drawRectangle({ x: 0, y: PAGE_H - HEADER_H, width: PAGE_W, height: HEADER_H, color: C_HEADER_BG });
  page.drawRectangle({ x: 0, y: PAGE_H - HEADER_H, width: 4,      height: HEADER_H, color: C_ACCENT });
  hLine(page, PAGE_H - HEADER_H, 0, PAGE_W, C_BORDER, 1);

  let y = PAGE_H - 22;
  if (companyName) {
    page.drawText(companyName.toUpperCase(), { x: MARGIN, y, font: fontRegular, size: 7, color: C_MUTED });
    y -= 16;
  } else {
    y -= 4;
  }

  page.drawText(sanitizeText(title), { x: MARGIN, y, font: fontBold, size: 16, color: C_ACCENT });
  y -= 14;

  if (subtitle) {
    page.drawText(sanitizeText(subtitle), { x: MARGIN, y, font: fontRegular, size: 9, color: C_MUTED });
  }

  const dateStr = new Date().toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" });
  const rightX  = PAGE_W - MARGIN;

  const pgText = `Page ${pageNum} / ${totalPages}`;
  page.drawText(pgText, { x: rightX - fontBold.widthOfTextAtSize(pgText, 8),     y: PAGE_H - 22, font: fontBold,    size: 8,   color: C_ACCENT });
  page.drawText(dateStr, { x: rightX - fontRegular.widthOfTextAtSize(dateStr, 7.5), y: PAGE_H - 34, font: fontRegular, size: 7.5, color: C_MUTED });

  const itemsText = `${totalItems} items`;
  page.drawText(itemsText, { x: rightX - fontRegular.widthOfTextAtSize(itemsText, 7), y: PAGE_H - 46, font: fontRegular, size: 7, color: C_SUBTLE });
}

// ── Per-page footer ─────────────────────────────────────────────────────────
interface CatalogueFooterOpts {
  page: PDFPage;
  pageNum: number;
  totalPages: number;
  companyName?: string;
  fontRegular: PDFFont;
}

function drawCatalogueFooter(opts: CatalogueFooterOpts): void {
  const { page, pageNum, totalPages, companyName, fontRegular } = opts;

  hLine(page, FOOTER_H, MARGIN, PAGE_W - MARGIN, C_BORDER, 0.5);

  const leftText  = companyName ? `${companyName.toUpperCase()} · CONFIDENTIAL` : "CONFIDENTIAL";
  const pageText  = `${pageNum} / ${totalPages}`;

  page.drawText(leftText, { x: MARGIN,                                                              y: FOOTER_H - 14, font: fontRegular, size: 6.5, color: C_SUBTLE });
  page.drawText(pageText, { x: PAGE_W - MARGIN - fontRegular.widthOfTextAtSize(pageText, 6.5),      y: FOOTER_H - 14, font: fontRegular, size: 6.5, color: C_SUBTLE });
}

// ── Column header row ───────────────────────────────────────────────────────
interface CatalogueColHeaderOpts {
  page: PDFPage;
  fontBold: PDFFont;
}

function drawCatalogueColHeader(opts: CatalogueColHeaderOpts): void {
  const { page, fontBold } = opts;

  page.drawRectangle({ x: MARGIN, y: TABLE_TOP, width: CONTENT_W, height: COL_HDR_H, color: C_ACCENT });

  const cols = [
    { label: "No",             x: MARGIN + 6 },
    { label: "Product detail", x: MARGIN + COL_NO_W + 8 },
    { label: "Image",          x: PAGE_W - MARGIN - COL_IMG_W + 8 },
  ];

  for (const col of cols) {
    page.drawText(col.label.toUpperCase(), { x: col.x, y: TABLE_TOP + 8, font: fontBold, size: 6.5, color: C_WHITE });
  }
}

// ── Main export ────────────────────────────────────────────────────────────
export async function generateCataloguePdf(config: GenerateOptions) {
  const { title, subtitle, companyName, rows, options } = config;

  const pdfDoc      = await PDFDocument.create();
  const fontBold    = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const totalPages = Math.ceil(rows.length / ROWS_PER_PAGE);

  // ── Pre-fetch images ───────────────────────────────────────────────────────
  const imageCache: Record<string, Uint8Array | null> = {};
  const base = process.env.NEXT_PUBLIC_R2_PRODUCT_IMAGES_URL ?? "";
  for (const row of rows) {
    for (const ext of ["jpg", "jpeg", "png", "webp"]) {
      const bytes = await fetchImageBytes(`${base}/${encodeURIComponent(row.productCode)}.${ext}`);
      if (bytes) { imageCache[row.productCode] = bytes; break; }
    }
  }

  // ── Build pages ────────────────────────────────────────────────────────────
  for (let pageIdx = 0; pageIdx < totalPages; pageIdx++) {
    const page     = pdfDoc.addPage([PAGE_W, PAGE_H]);
    const pageNum  = pageIdx + 1;
    const pageRows = rows.slice(pageIdx * ROWS_PER_PAGE, (pageIdx + 1) * ROWS_PER_PAGE);

    page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: C_WHITE });

    drawCatalogueHeader({ page, pageNum, totalPages, totalItems: rows.length, title, subtitle, companyName, fontBold, fontRegular });
    drawCatalogueFooter({ page, pageNum, totalPages, companyName, fontRegular });
    drawCatalogueColHeader({ page, fontBold });

    // Table outer border + vertical column dividers
    const tableBottom = TABLE_TOP - pageRows.length * ROW_H;
    page.drawRectangle({ x: MARGIN, y: tableBottom, width: CONTENT_W, height: TABLE_TOP - tableBottom, borderColor: C_BORDER, borderWidth: 0.5 });
    page.drawLine({ start: { x: MARGIN + COL_NO_W,         y: tableBottom }, end: { x: MARGIN + COL_NO_W,         y: TABLE_TOP }, thickness: 0.5, color: C_BORDER });
    page.drawLine({ start: { x: PAGE_W - MARGIN - COL_IMG_W, y: tableBottom }, end: { x: PAGE_W - MARGIN - COL_IMG_W, y: TABLE_TOP }, thickness: 0.5, color: C_BORDER });

    // ── Rows ─────────────────────────────────────────────────────────────────
    for (let ri = 0; ri < pageRows.length; ri++) {
      const row     = pageRows[ri];
      const rowY    = TABLE_TOP - ROW_H * (ri + 1);
      const rowTopY = rowY + ROW_H;

      if (ri % 2 !== 0) {
        page.drawRectangle({ x: MARGIN + 0.5, y: rowY + 0.5, width: CONTENT_W - 1, height: ROW_H - 1, color: C_ROW_ALT });
      }

      hLine(page, rowY, MARGIN, MARGIN + CONTENT_W, C_BORDER);

      // Col 1 — No
      const rowNo = String(row.no || ri + 1 + pageIdx * ROWS_PER_PAGE);
      page.drawText(rowNo, { x: MARGIN + 6, y: rowTopY - ROW_PAD - 10, font: fontBold, size: 9, color: C_INK });

      // Col 2 — Product detail
      const detX    = MARGIN + COL_NO_W + 10;
      const detMaxW = COL_DET_W - 16;
      let   detY    = rowTopY - ROW_PAD - 2;

      page.drawText(trunc(sanitizeText(row.description ?? row.productCode), fontBold, 9.5, detMaxW), {
        x: detX, y: detY, font: fontBold, size: 9.5, color: C_INK,
      });
      detY -= 14;

      if (options.showProductCode && row.productCode) {
        page.drawText(row.productCode, { x: detX, y: detY, font: fontRegular, size: 8, color: C_BLUE });
        const codeW = fontRegular.widthOfTextAtSize(row.productCode, 8);
        if (options.showSku && row.sku) {
          page.drawText(`· ${row.sku}`, { x: detX + codeW + 4, y: detY, font: fontRegular, size: 8, color: C_MUTED });
        }
        detY -= 12;
      } else if (options.showSku && row.sku) {
        page.drawText(row.sku, { x: detX, y: detY, font: fontRegular, size: 8, color: C_MUTED });
        detY -= 12;
      }

      if (row.qty !== undefined && row.qty !== "") {
        const qtyStr = `Qty  ${row.qty}${row.uom ? "  " + row.uom : ""}`;
        page.drawText(qtyStr, { x: detX, y: detY, font: fontRegular, size: 8, color: C_MUTED });
        detY -= 12;
      }

      if (options.showRegNo) {
        if (row.registrationNo) {
          const labelW = fontRegular.widthOfTextAtSize("Reg.  ", 8);
          page.drawText("Reg.  ", { x: detX, y: detY, font: fontRegular, size: 8, color: C_MUTED });
          page.drawText(row.registrationNo, { x: detX + labelW, y: detY, font: fontRegular, size: 8, color: C_BLUE });
        } else {
          page.drawText("Not registered", { x: detX, y: detY, font: fontRegular, size: 8, color: C_SUBTLE });
        }
        detY -= 12;
      }

      if (options.showValidity && row.validFrom && row.expiredOn) {
        page.drawText(`Valid  ${row.validFrom} – ${row.expiredOn}`, { x: detX, y: detY, font: fontRegular, size: 8, color: C_MUTED });
      }

      // Col 3 — Image
      const imgX     = PAGE_W - MARGIN - COL_IMG_W + (COL_IMG_W - IMG_SIZE) / 2;
      const imgY     = rowY + (ROW_H - IMG_SIZE) / 2;
      const imgBytes = imageCache[row.productCode];

      if (imgBytes) {
        try {
          let embeddedImg;
          try { embeddedImg = await pdfDoc.embedJpg(imgBytes); }
          catch { embeddedImg = await pdfDoc.embedPng(imgBytes); }
          const dims = embeddedImg.scaleToFit(IMG_SIZE, IMG_SIZE);
          page.drawImage(embeddedImg, { x: imgX + (IMG_SIZE - dims.width) / 2, y: imgY + (IMG_SIZE - dims.height) / 2, width: dims.width, height: dims.height });
        } catch {}
      } else {
        page.drawRectangle({ x: imgX, y: imgY, width: IMG_SIZE, height: IMG_SIZE, borderColor: C_BORDER, borderWidth: 0.5 });
        page.drawText("No image", {
          x: imgX + IMG_SIZE / 2 - fontRegular.widthOfTextAtSize("No image", 6.5) / 2,
          y: imgY + IMG_SIZE / 2 - 3,
          font: fontRegular, size: 6.5, color: C_SUBTLE,
        });
      }
    }
  }

  // ── Download ───────────────────────────────────────────────────────────────
  const pdfBytes = await pdfDoc.save();
  const blob     = new Blob([new Uint8Array(pdfBytes)], { type: "application/pdf" });
  const url      = URL.createObjectURL(blob);
  const a        = document.createElement("a");
  a.href         = url;
  a.download     = `catalogue_${Date.now()}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}
