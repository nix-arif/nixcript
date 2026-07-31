import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";

const EXTS = ["jpg", "jpeg", "png"] as const;
const ROW_HEIGHT = 195;  // points — all data rows are this height
const COL_WIDTH = 39;    // characters — "Picture Ref" column width
const PADDING_PX = 8;    // padding between image and cell border (pixels)

// EMU (English Metric Units): 1 pixel at 96 DPI = 9525 EMU
// Row height: 1 pt = 96/72 px → 1 pt = 12700 EMU
// Col width:  1 char unit ≈ 7 px (Calibri 11pt) → 1 char unit ≈ 66675 EMU
// NOTE: ExcelJS's fractional col/row setter uses width*10000 as its scale,
// which is 6.7× off for columns. We bypass it by writing nativeColOff/nativeRowOff
// directly in EMU so Excel positions images exactly where we intend.
const EMU = 9525;                          // px → EMU factor
const CELL_H_PX = ROW_HEIGHT * (96 / 72); // row height in pixels
const CELL_W_PX = COL_WIDTH * 7 + 5;      // col width in pixels (OOXML formula)

function colIndexToLetter(n: number): string {
  let s = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// Read pixel dimensions from a PNG or JPEG buffer without any extra library.
// PNG: width/height are big-endian uint32 at bytes 16–23 (inside the IHDR chunk).
// JPEG: scan for SOF0/SOF1/SOF2 markers (0xFF 0xC0–0xC2) which hold h then w.
function getImageDimensions(buf: Uint8Array): { w: number; h: number } | null {
  // PNG
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    const w = ((buf[16] << 24) | (buf[17] << 16) | (buf[18] << 8) | buf[19]) >>> 0;
    const h = ((buf[20] << 24) | (buf[21] << 16) | (buf[22] << 8) | buf[23]) >>> 0;
    return { w, h };
  }
  // JPEG
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length - 8) {
      if (buf[i] !== 0xff) break;
      const marker = buf[i + 1];
      const segLen = (buf[i + 2] << 8) | buf[i + 3];
      if (marker >= 0xc0 && marker <= 0xc3) {
        const h = (buf[i + 5] << 8) | buf[i + 6];
        const w = (buf[i + 7] << 8) | buf[i + 8];
        return { w, h };
      }
      i += 2 + segLen;
    }
  }
  return null;
}

async function fetchImageBuffer(
  productCode: string,
): Promise<{ buffer: Uint8Array; ext: "jpeg" | "png" } | null> {
  const base = process.env.NEXT_PUBLIC_R2_PRODUCT_IMAGES_URL ?? "";
  const encoded = encodeURIComponent(productCode.replace(/\//g, ":"));
  for (const ext of EXTS) {
    const url = `${base}/${encoded}.${ext}`;
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const buf = new Uint8Array(await res.arrayBuffer());
      return { buffer: buf, ext: ext === "png" ? "png" : "jpeg" };
    } catch {
      // try next ext
    }
  }
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "No file uploaded" }, { status: 400 });

    const inputBuffer = Buffer.from(await file.arrayBuffer());

    // ── Read input workbook ──────────────────────────────────────────────────
    const inWb = new ExcelJS.Workbook();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await inWb.xlsx.load(inputBuffer as any);
    const inWs = inWb.worksheets[0];
    if (!inWs) return NextResponse.json({ error: "Spreadsheet has no sheets" }, { status: 400 });

    // ── Find the "design brand code to refer" column ─────────────────────────
    const headerRow = inWs.getRow(1);
    let codeColIdx = -1;
    headerRow.eachCell((cell, colNumber) => {
      if (
        typeof cell.value === "string" &&
        cell.value.toLowerCase().includes("design brand code to refer")
      ) {
        codeColIdx = colNumber;
      }
    });
    if (codeColIdx === -1) {
      return NextResponse.json(
        { error: 'No column header containing "design brand code to refer" found' },
        { status: 400 },
      );
    }

    // ── Build output workbook — copy the input sheet ─────────────────────────
    const outWb = new ExcelJS.Workbook();
    const outWs = outWb.addWorksheet(inWs.name || "Sheet1");

    // Copy column widths
    inWs.columns.forEach((col, i) => {
      outWs.getColumn(i + 1).width = col.width ?? 12;
    });

    // Copy all rows (values + styles), normalize data row heights
    inWs.eachRow({ includeEmpty: true }, (row, rowNum) => {
      const outRow = outWs.getRow(rowNum);
      outRow.height = rowNum === 1 ? (row.height ?? 15) : ROW_HEIGHT;
      row.eachCell({ includeEmpty: true }, (cell, colNum) => {
        const outCell = outWs.getRow(rowNum).getCell(colNum);
        outCell.value = cell.value;
        outCell.style = { ...cell.style };
      });
      outRow.commit();
    });

    // ── Add "Picture Ref" header ─────────────────────────────────────────────
    const totalCols = inWs.columnCount;
    const picColIdx = totalCols + 1;
    outWs.getColumn(picColIdx).width = COL_WIDTH;

    const headerCell = outWs.getRow(1).getCell(picColIdx);
    headerCell.value = "Picture Ref";
    const firstHeader = inWs.getRow(1).getCell(1);
    if (firstHeader.style) headerCell.style = { ...firstHeader.style };
    outWs.getRow(1).commit();

    // ── Embed images row by row ──────────────────────────────────────────────
    const availW = CELL_W_PX - 2 * PADDING_PX;
    const availH = CELL_H_PX - 2 * PADDING_PX;

    for (let r = 2; r <= inWs.rowCount; r++) {
      const cell = inWs.getRow(r).getCell(codeColIdx);
      const code = cell.value != null ? String(cell.value).trim() : "";
      if (!code) continue;

      const result = await fetchImageBuffer(code);
      if (!result) continue;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const imageId = outWb.addImage({ buffer: result.buffer as any, extension: result.ext });

      const dims = getImageDimensions(result.buffer);

      if (dims && dims.w > 0 && dims.h > 0) {
        // Scale to fit within available space while preserving aspect ratio
        const scale = Math.min(availW / dims.w, availH / dims.h);
        const imgW = dims.w * scale;
        const imgH = dims.h * scale;

        // Center within the padded cell area, then convert px → EMU directly.
        // We bypass ExcelJS's fractional col/row setter (which uses width*10000
        // as its scale — 6.7× off for columns) and write nativeColOff/nativeRowOff
        // in real EMU so Excel places the image exactly where intended.
        const offsetX = PADDING_PX + (availW - imgW) / 2;
        const offsetY = PADDING_PX + (availH - imgH) / 2;

        outWs.addImage(imageId, {
          tl: {
            nativeCol: picColIdx - 1,
            nativeColOff: Math.round(offsetX * EMU),
            nativeRow: r - 1,
            nativeRowOff: Math.round(offsetY * EMU),
          },
          ext: { width: imgW, height: imgH },
          editAs: "oneCell",
        } as any);
      } else {
        // Fallback: fill cell with padding, using EMU offsets
        outWs.addImage(imageId, {
          tl: {
            nativeCol: picColIdx - 1,
            nativeColOff: Math.round(PADDING_PX * EMU),
            nativeRow: r - 1,
            nativeRowOff: Math.round(PADDING_PX * EMU),
          },
          br: {
            nativeCol: picColIdx,
            nativeColOff: -Math.round(PADDING_PX * EMU),
            nativeRow: r,
            nativeRowOff: -Math.round(PADDING_PX * EMU),
          },
          editAs: "oneCell",
        } as any);
      }
    }

    // ── Write output ─────────────────────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const outBuffer = await outWb.xlsx.writeBuffer() as any;

    return new NextResponse(outBuffer, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="picture-ref.xlsx"',
      },
    });
  } catch (err: any) {
    console.error("[picture-ref]", err);
    return NextResponse.json({ error: err.message ?? "Unknown error" }, { status: 500 });
  }
}
