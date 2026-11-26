// Row numbering (#) for quotation items.
//
// Users may label rows however they like (1, 2, 3 / a, b, c / I, II, III / 1a ...).
// These helpers tell whether the labels still run in sequence, and renumber
// them in the style already in use when they don't (e.g. after a row is deleted).

type NumberStyle = "number" | "lower" | "upper" | "lowerRoman" | "upperRoman";

type RowItem = { rowNo?: string | null; setGroupId?: string | null };

/** Indices of items in the order the table shows them: set groups (by first appearance), then loose items. */
export function displayOrder(items: RowItem[]): number[] {
  const groupOrder: string[] = [];
  for (const it of items) {
    if (it.setGroupId && !groupOrder.includes(it.setGroupId)) groupOrder.push(it.setGroupId);
  }
  const order: number[] = [];
  for (const gid of groupOrder) items.forEach((it, i) => { if (it.setGroupId === gid) order.push(i); });
  items.forEach((it, i) => { if (!it.setGroupId) order.push(i); });
  return order;
}

const ROMAN: [number, string][] = [
  [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"],
  [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
];

function toRoman(n: number): string {
  let out = "";
  for (const [v, s] of ROMAN) while (n >= v) { out += s; n -= v; }
  return out;
}

function isRoman(label: string): boolean {
  const up = label.toUpperCase();
  if (!/^[IVXLCDM]+$/.test(up)) return false;
  // Valid only if it round-trips (rejects "IIII", "VX", ...)
  let n = 0;
  for (let i = 0; i < up.length; i++) {
    const v = ROMAN.find(([, s]) => s === up[i])![0];
    const next = i + 1 < up.length ? ROMAN.find(([, s]) => s === up[i + 1])![0] : 0;
    n += v < next ? -v : v;
  }
  return n > 0 && toRoman(n) === up;
}

// 1 → a, 26 → z, 27 → aa
function toLetters(n: number): string {
  let out = "";
  while (n > 0) { n--; out = String.fromCharCode(97 + (n % 26)) + out; n = Math.floor(n / 26); }
  return out;
}

function detectStyle(labels: string[]): NumberStyle {
  if (labels.length === 0 || labels.every((l) => /^\d+$/.test(l))) return "number";
  const first = labels[0];
  if (/^[ivxlcdm]+$/.test(first) && first.startsWith("i") && labels.every((l) => /^[ivxlcdm]+$/.test(l) && isRoman(l))) return "lowerRoman";
  if (/^[IVXLCDM]+$/.test(first) && first.startsWith("I") && labels.every((l) => /^[IVXLCDM]+$/.test(l) && isRoman(l))) return "upperRoman";
  if (labels.every((l) => /^[a-z]+$/.test(l))) return "lower";
  if (labels.every((l) => /^[A-Z]+$/.test(l))) return "upper";
  return "number";
}

function format(style: NumberStyle, n: number): string {
  switch (style) {
    case "lower": return toLetters(n);
    case "upper": return toLetters(n).toUpperCase();
    case "lowerRoman": return toRoman(n).toLowerCase();
    case "upperRoman": return toRoman(n);
    default: return String(n);
  }
}

function expectedLabels(items: RowItem[]): { order: number[]; expected: string[] } {
  const order = displayOrder(items);
  const labels = order.map((i) => String(items[i].rowNo ?? "").trim()).filter(Boolean);
  const style = detectStyle(labels);
  return { order, expected: order.map((_, pos) => format(style, pos + 1)) };
}

/** True when every row's # follows on from the previous one (in whatever style the user chose). */
export function isRowSequenceValid(items: RowItem[]): boolean {
  const { order, expected } = expectedLabels(items);
  return order.every((idx, pos) => String(items[idx].rowNo ?? "").trim() === expected[pos]);
}

/** Relabel every row in table order, keeping the style in use (numbers, letters or roman). */
export function renumberRows<T extends RowItem>(items: T[]): T[] {
  const { order, expected } = expectedLabels(items);
  const next = [...items];
  order.forEach((idx, pos) => { next[idx] = { ...items[idx], rowNo: expected[pos] }; });
  return next;
}

/** Label for a row added at the end, in the style the list already uses. */
export function nextRowLabel(items: RowItem[]): string {
  const labels = displayOrder(items).map((i) => String(items[i].rowNo ?? "").trim()).filter(Boolean);
  const style = detectStyle(labels);
  if (style === "number") return String(labels.reduce((max, l) => Math.max(max, Number(l) || 0), 0) + 1);
  return format(style, items.length + 1);
}
