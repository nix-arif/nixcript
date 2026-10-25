import { PDFDocument, PDFFont, PDFImage, StandardFonts, rgb } from "pdf-lib";
import { wrap } from "@/app/dashboard/sales/quotation/[id]/print/_pdf-header";
import {
  code128Modules, elementText, encodedValue, qrMatrix,
  type LabelDesign, type LabelItemData,
} from "@/lib/label-design";

// Label sticker PDF — one page per sticker, each page exactly the label's
// width × height so the paper size is right regardless of browser/print dialog.

const MM = 72 / 25.4;
const LINE = 1.15;
const MIN_FONT = 4;
const BLACK = rgb(0, 0, 0);

function dataUrlBytes(url: string): { bytes: Uint8Array; png: boolean } | null {
  const m = /^data:image\/(png|jpe?g);base64,(.+)$/i.exec(url);
  if (!m) return null;
  const bin = atob(m[2]);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return { bytes, png: m[1].toLowerCase() === "png" };
}

export async function generateLabelsPdf(design: LabelDesign, labels: LabelItemData[]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pw = design.width * MM;
  const ph = design.height * MM;

  // Each distinct logo is embedded once and reused on every page.
  const images = new Map<string, PDFImage | null>();
  for (const el of design.elements) {
    if (el.kind !== "logo") continue;
    const src = el.src;
    if (!src || images.has(src)) continue;
    const parsed = dataUrlBytes(src);
    images.set(src, parsed ? (parsed.png ? await pdf.embedPng(parsed.bytes) : await pdf.embedJpg(parsed.bytes)) : null);
  }

  for (const data of labels) {
    const page = pdf.addPage([pw, ph]);
    for (const el of design.elements) {
      const x = el.x * MM;
      const w = el.w * MM;
      const h = el.h * MM;
      const yBottom = ph - (el.y + el.h) * MM; // pdf-lib's origin is bottom-left

      if (el.kind === "line") {
        page.drawRectangle({ x, y: yBottom, width: w, height: Math.max(h, 0.4), color: BLACK });
      } else if (el.kind === "box") {
        page.drawRectangle({ x, y: yBottom, width: w, height: h, borderColor: BLACK, borderWidth: 0.7 });
      } else if (el.kind === "logo") {
        const img = images.get(el.src ?? "");
        if (!img) continue;
        // Fit inside the box, keeping the aspect ratio, centred.
        const s = Math.min(w / img.width, h / img.height);
        page.drawImage(img, { x: x + (w - img.width * s) / 2, y: yBottom + (h - img.height * s) / 2, width: img.width * s, height: img.height * s });
      } else if (el.kind === "qr") {
        const value = encodedValue(el, data);
        if (!value) continue;
        const m = qrMatrix(value);
        const quiet = 2; // modules of white margin so it scans on any background
        const cell = Math.min(w, h) / (m.length + quiet * 2);
        const size = cell * m.length;
        const ox = x + (w - size) / 2;
        const oy = yBottom + (h - size) / 2;
        m.forEach((row, r) => row.forEach((on, c) => {
          if (on) page.drawRectangle({ x: ox + c * cell, y: oy + (m.length - 1 - r) * cell, width: cell, height: cell, color: BLACK });
        }));
      } else if (el.kind === "barcode") {
        const mods = code128Modules(encodedValue(el, data));
        if (!mods) continue;
        const mw = w / mods.length;
        let i = 0;
        while (i < mods.length) {
          if (!mods[i]) { i++; continue; }
          let j = i;
          while (j < mods.length && mods[j]) j++;
          page.drawRectangle({ x: x + i * mw, y: yBottom, width: (j - i) * mw, height: h, color: BLACK });
          i = j;
        }
      } else {
        const text = elementText(el, data);
        if (!text) continue;
        drawText(page, text, el.bold ? bold : regular, el.fontSize, el.align, x, ph - el.y * MM, w, h);
      }
    }
  }
  return pdf.save();
}

function drawText(
  page: ReturnType<PDFDocument["addPage"]>, text: string, font: PDFFont, fontSize: number,
  align: "left" | "center" | "right", x: number, top: number, boxW: number, boxH: number,
) {
  // Shrink the font until the wrapped text fits the box height.
  let size = fontSize;
  let lines = wrap(text, font, size, boxW);
  while (size > MIN_FONT && lines.length * size * LINE > boxH) {
    size -= 0.5;
    lines = wrap(text, font, size, boxW);
  }
  lines = lines.slice(0, Math.max(1, Math.floor(boxH / (size * LINE))));
  lines.forEach((line, i) => {
    const lw = font.widthOfTextAtSize(line, size);
    const dx = align === "center" ? (boxW - lw) / 2 : align === "right" ? boxW - lw : 0;
    page.drawText(line, { x: x + Math.max(0, dx), y: top - size * 0.9 - i * size * LINE, size, font, color: BLACK });
  });
}
