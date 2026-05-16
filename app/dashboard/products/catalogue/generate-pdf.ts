import { PDFDocument, rgb, StandardFonts, RGB } from "pdf-lib";

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

async function fetchImageBytes(url: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  } catch {
    return null;
  }
}

export async function generateCataloguePdf(config: GenerateOptions) {
  const { title, subtitle, companyName, rows, options } = config;

  const pdfDoc = await PDFDocument.create();
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);

  // ── Page geometry ──────────────────────────────────────────────────────────
  const PAGE_W = 595.28;
  const PAGE_H = 841.89;
  const MARGIN = 40;
  const CONTENT_W = PAGE_W - MARGIN * 2;
  const HEADER_H = 72;
  const FOOTER_H = 24;
  const IMG_SIZE = 96; // ~2.5x bigger
  const ROW_PADDING = 12;
  const ROW_H = IMG_SIZE + ROW_PADDING * 2;
  const TABLE_TOP = PAGE_H - HEADER_H - MARGIN - 24; // 24 = col header height
  const USABLE_H = TABLE_TOP - FOOTER_H - ROW_PADDING;
  const ROWS_PER_PAGE = Math.floor(USABLE_H / ROW_H);

  // ── Color palette ──────────────────────────────────────────────────────────
  const C_INK = rgb(0.102, 0.122, 0.169); // near-black text
  const C_MUTED = rgb(0.451, 0.49, 0.569); // secondary text
  const C_SUBTLE = rgb(0.69, 0.729, 0.784); // hints / placeholders
  const C_BLUE = rgb(0.145, 0.31, 0.847); // product code accent
  const C_HEADER_BG = rgb(0.961, 0.965, 0.973); // light grey header
  const C_BORDER = rgb(0.871, 0.882, 0.906); // table borders
  const C_ROW_ALT = rgb(0.98, 0.984, 0.992); // alternating row tint
  const C_WHITE = rgb(1, 1, 1);
  const C_ACCENT = rgb(0.2, 0.259, 0.435); // dark navy for header text

  const totalPages = Math.ceil(rows.length / ROWS_PER_PAGE);

  // ── Pre-fetch images ───────────────────────────────────────────────────────
  const imageCache: Record<string, Uint8Array | null> = {};
  const base = process.env.NEXT_PUBLIC_R2_PRODUCT_IMAGES_URL ?? "";
  for (const row of rows) {
    const exts = ["jpg", "jpeg", "png", "webp"];
    for (const ext of exts) {
      const url = `${base}/${encodeURIComponent(row.productCode)}.${ext}`;
      const bytes = await fetchImageBytes(url);
      if (bytes) {
        imageCache[row.productCode] = bytes;
        break;
      }
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  const truncate = (str: string, max: number) =>
    str.length > max ? str.slice(0, max - 1) + "…" : str;

  const drawLine = (
    page: Awaited<ReturnType<typeof pdfDoc.addPage>>,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    color: RGB = C_BORDER,
    thickness = 0.5,
  ) =>
    page.drawLine({
      start: { x: x1, y: y1 },
      end: { x: x2, y: y2 },
      thickness,
      color,
    });

  // ── Draw header (repeats every page) ──────────────────────────────────────
  const drawHeader = (
    page: Awaited<ReturnType<typeof pdfDoc.addPage>>,
    pageNum: number,
  ) => {
    // Light background
    page.drawRectangle({
      x: 0,
      y: PAGE_H - HEADER_H,
      width: PAGE_W,
      height: HEADER_H,
      color: C_HEADER_BG,
    });

    // Left accent bar
    page.drawRectangle({
      x: 0,
      y: PAGE_H - HEADER_H,
      width: 4,
      height: HEADER_H,
      color: C_ACCENT,
    });

    // Bottom border line
    drawLine(
      page,
      0,
      PAGE_H - HEADER_H,
      PAGE_W,
      PAGE_H - HEADER_H,
      C_BORDER,
      1,
    );

    let y = PAGE_H - 22;

    // Company name
    if (companyName) {
      page.drawText(companyName.toUpperCase(), {
        x: MARGIN,
        y,
        font: fontRegular,
        size: 7,
        color: C_MUTED,
      });
      y -= 16;
    } else {
      y -= 4;
    }

    // Title
    page.drawText(title, {
      x: MARGIN,
      y,
      font: fontBold,
      size: 16,
      color: C_ACCENT,
    });
    y -= 14;

    // Subtitle
    if (subtitle) {
      page.drawText(subtitle, {
        x: MARGIN,
        y,
        font: fontRegular,
        size: 9,
        color: C_MUTED,
      });
    }

    // Right side info
    const dateStr = new Date().toLocaleDateString("en-MY", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
    const rightX = PAGE_W - MARGIN;

    page.drawText(`Page ${pageNum} / ${totalPages}`, {
      x:
        rightX -
        fontBold.widthOfTextAtSize(`Page ${pageNum} / ${totalPages}`, 8),
      y: PAGE_H - 22,
      font: fontBold,
      size: 8,
      color: C_ACCENT,
    });
    page.drawText(dateStr, {
      x: rightX - fontRegular.widthOfTextAtSize(dateStr, 7.5),
      y: PAGE_H - 34,
      font: fontRegular,
      size: 7.5,
      color: C_MUTED,
    });
    page.drawText(`${rows.length} items`, {
      x: rightX - fontRegular.widthOfTextAtSize(`${rows.length} items`, 7),
      y: PAGE_H - 46,
      font: fontRegular,
      size: 7,
      color: C_SUBTLE,
    });
  };

  // ── Draw footer (repeats every page) ──────────────────────────────────────
  const drawFooter = (
    page: Awaited<ReturnType<typeof pdfDoc.addPage>>,
    pageNum: number,
  ) => {
    drawLine(page, MARGIN, FOOTER_H, PAGE_W - MARGIN, FOOTER_H, C_BORDER, 0.5);

    const leftText = companyName
      ? `${companyName.toUpperCase()} · CONFIDENTIAL`
      : "CONFIDENTIAL";

    page.drawText(leftText, {
      x: MARGIN,
      y: FOOTER_H - 14,
      font: fontRegular,
      size: 6.5,
      color: C_SUBTLE,
    });

    const pageText = `${pageNum} / ${totalPages}`;
    page.drawText(pageText, {
      x: PAGE_W - MARGIN - fontRegular.widthOfTextAtSize(pageText, 6.5),
      y: FOOTER_H - 14,
      font: fontRegular,
      size: 6.5,
      color: C_SUBTLE,
    });
  };

  // ── Draw column header row ─────────────────────────────────────────────────
  const COL_NO_W = 28;
  const COL_IMG_W = IMG_SIZE + 8;
  const COL_DET_W = CONTENT_W - COL_NO_W - COL_IMG_W;

  const drawColHeader = (page: Awaited<ReturnType<typeof pdfDoc.addPage>>) => {
    const y = TABLE_TOP + 24;
    page.drawRectangle({
      x: MARGIN,
      y: TABLE_TOP,
      width: CONTENT_W,
      height: 24,
      color: C_ACCENT,
    });
    const cols = [
      { label: "No", x: MARGIN + 6 },
      { label: "Product detail", x: MARGIN + COL_NO_W + 8 },
      { label: "Image", x: PAGE_W - MARGIN - COL_IMG_W + 8 },
    ];
    for (const col of cols) {
      page.drawText(col.label.toUpperCase(), {
        x: col.x,
        y: TABLE_TOP + 8,
        font: fontBold,
        size: 6.5,
        color: C_WHITE,
      });
    }
  };

  // ── Build pages ────────────────────────────────────────────────────────────
  for (let pageIdx = 0; pageIdx < totalPages; pageIdx++) {
    const page = pdfDoc.addPage([PAGE_W, PAGE_H]);
    const pageNum = pageIdx + 1;
    const pageRows = rows.slice(
      pageIdx * ROWS_PER_PAGE,
      (pageIdx + 1) * ROWS_PER_PAGE,
    );

    // White background
    page.drawRectangle({
      x: 0,
      y: 0,
      width: PAGE_W,
      height: PAGE_H,
      color: C_WHITE,
    });

    drawHeader(page, pageNum);
    drawFooter(page, pageNum);
    drawColHeader(page);

    // Table outer border
    const tableBottom = TABLE_TOP - pageRows.length * ROW_H;
    page.drawRectangle({
      x: MARGIN,
      y: tableBottom,
      width: CONTENT_W,
      height: TABLE_TOP - tableBottom,
      borderColor: C_BORDER,
      borderWidth: 0.5,
    });

    // Vertical column dividers
    drawLine(
      page,
      MARGIN + COL_NO_W,
      tableBottom,
      MARGIN + COL_NO_W,
      TABLE_TOP,
      C_BORDER,
    );
    drawLine(
      page,
      PAGE_W - MARGIN - COL_IMG_W,
      tableBottom,
      PAGE_W - MARGIN - COL_IMG_W,
      TABLE_TOP,
      C_BORDER,
    );

    // ── Rows ────────────────────────────────────────────────────────────────
    for (let ri = 0; ri < pageRows.length; ri++) {
      const row = pageRows[ri];
      const rowY = TABLE_TOP - ROW_H * (ri + 1);
      const rowTopY = rowY + ROW_H;

      // Alternating row bg
      if (ri % 2 !== 0) {
        page.drawRectangle({
          x: MARGIN + 0.5,
          y: rowY + 0.5,
          width: CONTENT_W - 1,
          height: ROW_H - 1,
          color: C_ROW_ALT,
        });
      }

      // Row bottom border
      drawLine(page, MARGIN, rowY, MARGIN + CONTENT_W, rowY, C_BORDER);

      // ── Col 1 — No ────────────────────────────────────────────────────────
      const rowNo = String(row.no || ri + 1 + pageIdx * ROWS_PER_PAGE);
      page.drawText(rowNo, {
        x: MARGIN + 6,
        y: rowTopY - ROW_PADDING - 10,
        font: fontBold,
        size: 9,
        color: C_INK,
      });

      // ── Col 2 — Product detail ────────────────────────────────────────────
      const detX = MARGIN + COL_NO_W + 10;
      const detMaxW = COL_DET_W - 16;
      let detY = rowTopY - ROW_PADDING - 2;

      // Description — bold, larger
      const desc = truncate(row.description ?? row.productCode, 60);
      page.drawText(desc, {
        x: detX,
        y: detY,
        font: fontBold,
        size: 9.5,
        color: C_INK,
        maxWidth: detMaxW,
      });
      detY -= 14;

      // Product code + SKU on same line
      if (options.showProductCode && row.productCode) {
        page.drawText(row.productCode, {
          x: detX,
          y: detY,
          font: fontRegular,
          size: 8,
          color: C_BLUE,
        });
        const codeW = fontRegular.widthOfTextAtSize(row.productCode, 8);

        if (options.showSku && row.sku) {
          page.drawText(`· ${row.sku}`, {
            x: detX + codeW + 4,
            y: detY,
            font: fontRegular,
            size: 8,
            color: C_MUTED,
          });
        }
        detY -= 12;
      } else if (options.showSku && row.sku) {
        page.drawText(row.sku, {
          x: detX,
          y: detY,
          font: fontRegular,
          size: 8,
          color: C_MUTED,
        });
        detY -= 12;
      }

      // Qty + UOM
      if (row.qty !== undefined && row.qty !== "") {
        const qtyStr = `Qty  ${row.qty}${row.uom ? "  " + row.uom : ""}`;
        page.drawText(qtyStr, {
          x: detX,
          y: detY,
          font: fontRegular,
          size: 8,
          color: C_MUTED,
        });
        detY -= 12;
      }

      // Reg no
      if (options.showRegNo) {
        if (row.registrationNo) {
          page.drawText(`Reg.  `, {
            x: detX,
            y: detY,
            font: fontRegular,
            size: 8,
            color: C_MUTED,
          });
          const labelW = fontRegular.widthOfTextAtSize("Reg.  ", 8);
          page.drawText(row.registrationNo, {
            x: detX + labelW,
            y: detY,
            font: fontRegular,
            size: 8,
            color: C_BLUE,
          });
        } else {
          page.drawText("Not registered", {
            x: detX,
            y: detY,
            font: fontRegular,
            size: 8,
            color: C_SUBTLE,
          });
        }
        detY -= 12;
      }

      // Validity
      if (options.showValidity && row.validFrom && row.expiredOn) {
        page.drawText(`Valid  ${row.validFrom} – ${row.expiredOn}`, {
          x: detX,
          y: detY,
          font: fontRegular,
          size: 8,
          color: C_MUTED,
        });
      }

      // ── Col 3 — Image ─────────────────────────────────────────────────────
      const imgX = PAGE_W - MARGIN - COL_IMG_W + (COL_IMG_W - IMG_SIZE) / 2;
      const imgY = rowY + (ROW_H - IMG_SIZE) / 2;

      const imgBytes = imageCache[row.productCode];
      if (imgBytes) {
        try {
          let embeddedImg;
          try {
            embeddedImg = await pdfDoc.embedJpg(imgBytes);
          } catch {
            embeddedImg = await pdfDoc.embedPng(imgBytes);
          }
          const dims = embeddedImg.scaleToFit(IMG_SIZE, IMG_SIZE);
          page.drawImage(embeddedImg, {
            x: imgX + (IMG_SIZE - dims.width) / 2,
            y: imgY + (IMG_SIZE - dims.height) / 2,
            width: dims.width,
            height: dims.height,
          });
        } catch {}
      } else {
        // No image placeholder — just subtle dashed box
        page.drawRectangle({
          x: imgX,
          y: imgY,
          width: IMG_SIZE,
          height: IMG_SIZE,
          borderColor: C_BORDER,
          borderWidth: 0.5,
        });
        page.drawText("No image", {
          x:
            imgX +
            IMG_SIZE / 2 -
            fontRegular.widthOfTextAtSize("No image", 6.5) / 2,
          y: imgY + IMG_SIZE / 2 - 3,
          font: fontRegular,
          size: 6.5,
          color: C_SUBTLE,
        });
      }
    }
  }

  // ── Download ───────────────────────────────────────────────────────────────
  const pdfBytes = await pdfDoc.save();
  const blob = new Blob([new Uint8Array(pdfBytes)], {
    type: "application/pdf",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `catalogue_${Date.now()}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}
