import QRCode from "qrcode";

// Sticker label design — shared by the on-screen designer, the saved per-
// organisation template and the PDF generator. Positions are in mm from the
// label's top-left.

export type LabelFieldKey =
  | "code" | "description" | "mda" | "qty" | "uom" | "brand" | "supplier"
  | "plNo" | "company" | "address" | "establishment" | "date";

export const FIELD_LABEL: Record<LabelFieldKey, string> = {
  code: "Emboss code",
  description: "Description",
  mda: "MDA reg. no.",
  qty: "Packed qty",
  uom: "UOM",
  brand: "Brand",
  supplier: "Supplier",
  plNo: "Packing list no.",
  company: "Company name",
  address: "Company address",
  establishment: "MDA establishment no.",
  date: "Print date",
};

export type LabelElementKind = "field" | "text" | "logo" | "qr" | "barcode" | "line" | "box";

export type LabelElement = {
  id: string;
  kind: LabelElementKind;
  field?: LabelFieldKey; // field / qr / barcode: which value to show or encode
  text?: string; // text: the static content
  prefix?: string; // field: printed before the value (value-less fields print nothing)
  src?: string; // logo: the uploaded image as a PNG/JPEG data URL
  x: number; y: number; w: number; h: number;
  fontSize: number; // pt
  bold: boolean;
  align: "left" | "center" | "right";
};

export type LabelDesign = { width: number; height: number; elements: LabelElement[] };

export type LabelItemData = Record<LabelFieldKey, string>;

export const newId = () => Math.random().toString(36).slice(2, 10);

const base = { fontSize: 8, bold: false, align: "left" as const };

export const DEFAULT_DESIGN: LabelDesign = {
  width: 70,
  height: 40,
  elements: [
    { id: "code", kind: "field", field: "code", x: 3, y: 3, w: 64, h: 9, ...base, fontSize: 13, bold: true },
    { id: "desc", kind: "field", field: "description", x: 3, y: 13, w: 64, h: 17, ...base },
    { id: "mda", kind: "field", field: "mda", prefix: "MDA Reg. No: ", x: 3, y: 31, w: 64, h: 6, ...base },
  ],
};

// Sensible starting size/content for each thing the "Add" menu can create.
export function newElement(kind: LabelElementKind, extra: Partial<LabelElement> = {}): LabelElement {
  const sizes: Record<LabelElementKind, Pick<LabelElement, "w" | "h">> = {
    field: { w: 30, h: 5 }, text: { w: 30, h: 5 }, logo: { w: 15, h: 10 },
    qr: { w: 12, h: 12 }, barcode: { w: 35, h: 8 }, line: { w: 40, h: 0.3 }, box: { w: 40, h: 20 },
  };
  return { id: newId(), kind, x: 3, y: 3, ...sizes[kind], ...base, ...extra };
}

export function elementText(el: LabelElement, data: LabelItemData): string {
  if (el.kind === "text") return el.text ?? "";
  if (el.kind !== "field" || !el.field) return "";
  const v = data[el.field];
  return v ? `${el.prefix ?? ""}${v}` : "";
}

export function encodedValue(el: LabelElement, data: LabelItemData): string {
  return el.field ? data[el.field] ?? "" : "";
}

// ── QR ──────────────────────────────────────────────────────────────────────
export function qrMatrix(value: string): boolean[][] {
  const qr = QRCode.create(value, { errorCorrectionLevel: "M" });
  const n = qr.modules.size;
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => !!qr.modules.get(r, c)));
}

// ── Code 128 (set B) ────────────────────────────────────────────────────────
const C128 = [
  "212222","222122","222221","121223","121322","131222","122213","122312","132212","221213","221312","231212","112232","122132","122231","113222","123122","123221","223211","221132","221231","213212","223112","312131","311222","321122","321221","312212","322112","322211","212123","212321","232121","111323","131123","131321","112313","132113","132311","211313","231113","231311","112133","112331","132131","113123","113321","133121","313121","211331","231131","213113","213311","213131","311123","311321","331121","312113","312311","332111","314111","221411","431111","111224","111422","121124","121421","141122","141221","112214","112412","122114","122411","142112","142211","241211","221114","413111","241112","134111","111242","121142","121241","114212","124112","124211","411212","421112","421211","212141","214121","412121","111143","111341","131141","114113","114311","411113","411311","113141","114131","311141","411131","211412","211214","211232","2331112",
];

// Returns the bar/space module sequence (true = bar), or null if the value
// has characters Code 128-B can't represent.
export function code128Modules(value: string): boolean[] | null {
  if (!value || /[^\x20-\x7e]/.test(value)) return null;
  const codes = [104, ...[...value].map((ch) => ch.charCodeAt(0) - 32)];
  const sum = codes.reduce((acc, c, i) => acc + c * (i === 0 ? 1 : i), 0);
  codes.push(sum % 103, 106);
  const mods: boolean[] = [];
  for (const c of codes) {
    [...C128[c]].forEach((w, i) => { for (let k = 0; k < Number(w); k++) mods.push(i % 2 === 0); });
  }
  return mods;
}

// ── Ready-made templates ────────────────────────────────────────────────────
const t = (x: number, y: number, w: number, h: number, text: string, extra: Partial<LabelElement> = {}) =>
  newElement("text", { x, y, w, h, text, fontSize: 7, ...extra });
const f = (x: number, y: number, w: number, h: number, field: LabelFieldKey, extra: Partial<LabelElement> = {}) =>
  newElement("field", { x, y, w, h, field, prefix: "", fontSize: 7, ...extra });

// Modelled on the principal's (best medical) English product label example:
// customer / order / date block, REF + description, QTY / LOT / Rx ONLY / MD,
// data code, regulatory symbols strip, manufacturer line and CE mark. The
// logo and symbols are image slots — upload the artwork into them.
export const BEST_MEDICAL_ENGLISH: LabelDesign = {
  width: 100,
  height: 55,
  elements: [
    t(2, 2, 17, 4, "Customer:", { bold: true }),
    t(19, 2, 45, 4, "00000  CUSTOMER NAME"),
    newElement("logo", { x: 70, y: 1.5, w: 28, h: 10 }),
    t(2, 7, 17, 4, "Order:", { bold: true }),
    t(19, 7, 30, 4, "00.00. / Prof. 00000"),
    t(51, 7, 12, 4, "Date:"),
    f(58, 7, 20, 4, "date"),
    newElement("box", { x: 2, y: 12.5, w: 8.5, h: 4 }),
    t(2, 13, 8.5, 3.5, "REF", { bold: true, fontSize: 6.5, align: "center" }),
    f(12, 13, 45, 4, "code", { bold: true, fontSize: 8 }),
    f(2, 18, 72, 8, "description", { fontSize: 7.5 }),
    t(2, 27, 9, 4, "QTY:", { bold: true }),
    f(10, 27, 8, 4, "qty"),
    f(18, 27, 8, 4, "uom"),
    newElement("box", { x: 29, y: 26.5, w: 8, h: 4 }),
    t(29, 27, 8, 3.5, "LOT", { bold: true, fontSize: 6.5, align: "center" }),
    t(38, 27, 22, 4, "00000000"),
    t(64, 27, 14, 4, "Rx ONLY", { bold: true }),
    newElement("box", { x: 85, y: 25.5, w: 12, h: 6.5 }),
    t(85, 26.2, 12, 5.5, "MD", { bold: true, fontSize: 12, align: "center" }),
    newElement("qr", { field: "code", x: 2, y: 32.5, w: 15, h: 15 }),
    f(21, 34, 40, 4, "mda", { prefix: "MDA Reg. No: " }),
    newElement("logo", { x: 50, y: 34, w: 47, h: 10 }), // symbols strip
    t(10, 49, 60, 5, "best medical GmbH - Heudorfer Str. 32 - D-78576 Emmingen-Liptingen\nfon: +49 7465 91230 - fax: +49 7465 91232 - www.bestmedical.biz", { fontSize: 4.5 }),
    t(78, 46, 20, 7, "CE 0483", { bold: true, fontSize: 11, align: "center" }),
  ],
};

export const LABEL_TEMPLATES: { key: string; label: string; design: LabelDesign }[] = [
  { key: "default", label: "Simple (code, description, MDA)", design: DEFAULT_DESIGN },
  { key: "best-medical-en", label: "Best Medical – English", design: BEST_MEDICAL_ENGLISH },
];
