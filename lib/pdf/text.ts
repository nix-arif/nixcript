// Text helpers for pdf-lib documents drawn with the Standard fonts (Helvetica / Helvetica-Bold).
//
// Those fonts use WinAnsi (Windows-1252) and THROW on any character outside it: emoji, CJK / Arabic script, arrows,
// even some "smart" punctuation pasted from Word. One such character in a name or a comment would fail the whole
// PDF, so every string that reaches drawText goes through safeText() (or one of the helpers below, which call it).
// The same rule as app/dashboard/human-resources/claim/generate-claim-pdf.ts.
import type { PDFFont } from "pdf-lib";

// Codepoints above U+00FF that Windows-1252 still has a glyph for (smart quotes, dashes, ellipsis, bullet, euro ...)
const WINANSI_SAFE_HIGH = new Set([
  0x20AC, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021, 0x02C6, 0x2030, 0x0160,
  0x2039, 0x0152, 0x017D, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014,
  0x02DC, 0x2122, 0x0161, 0x203A, 0x0153, 0x017E, 0x0178,
]);
// a readable substitute where there is one, else "?"
const ASCII_FALLBACK: Record<number, string> = {
  0x2192: "->", 0x2190: "<-", 0x2194: "<->", 0x2713: "v", 0x2714: "v", 0x2717: "x", 0x2718: "x", 0x00D7: "x",
  0x2264: "<=", 0x2265: ">=", 0x2212: "-", 0x00A0: " ", 0x202F: " ", 0x2009: " ",
};

// one line of text, safe for the Standard fonts (line breaks and other control characters become spaces)
export function safeText(t: string | null | undefined): string {
  const s = String(t ?? "").replace(/[\x00-\x1F\x7F]/g, " ");
  let out = "";
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (ASCII_FALLBACK[cp] !== undefined) out += ASCII_FALLBACK[cp];
    else if (cp <= 0xFF || WINANSI_SAFE_HIGH.has(cp)) out += ch;
    else out += "?";
  }
  return out;
}

// the text cut to fit maxW, with "…" when it had to be cut
export function fitText(text: string | null | undefined, font: PDFFont, size: number, maxW: number): string {
  const t = safeText(text).trim();
  if (!t || maxW <= 0) return "";
  if (font.widthOfTextAtSize(t, size) <= maxW) return t;
  let s = t;
  while (s.length > 0 && font.widthOfTextAtSize(s + "…", size) > maxW) s = s.slice(0, -1);
  return s.length ? s + "…" : "";
}

// Word-wraps text to lines no wider than maxW. Line breaks in the text are kept (each paragraph wraps on its own);
// a word longer than a line is broken. With maxLines, the last line is cut with "…" when there is more.
export function wrapText(text: string | null | undefined, font: PDFFont, size: number, maxW: number, maxLines = Infinity): string[] {
  const out: string[] = [];
  const fits = (s: string) => font.widthOfTextAtSize(s, size) <= maxW;
  for (const para of String(text ?? "").replace(/\r\n?/g, "\n").split("\n")) {
    const words = safeText(para).split(/\s+/).filter(Boolean);
    if (words.length === 0) { if (out.length) out.push(""); continue; }
    let line = "";
    for (let word of words) {
      // a word wider than the whole line is broken into pieces that fit
      while (!fits(word)) {
        let cut = word.length - 1;
        while (cut > 1 && !fits(word.slice(0, cut))) cut--;
        if (line) { out.push(line); line = ""; }
        out.push(word.slice(0, cut));
        word = word.slice(cut);
      }
      const next = line ? `${line} ${word}` : word;
      if (fits(next)) line = next;
      else { out.push(line); line = word; }
    }
    if (line) out.push(line);
  }
  while (out.length && out[out.length - 1] === "") out.pop(); // no blank line at the end
  if (out.length > maxLines) {
    const kept = out.slice(0, maxLines);
    kept[maxLines - 1] = fitText(kept[maxLines - 1] + " …", font, size, maxW);
    return kept;
  }
  return out;
}

// Wraps text made of parts, breaking between parts where it can and inside one only when a part is wider than a line.
// Nothing is cut. Line breaks in the text are kept.
//  - "address": parts end after each comma, so "47810 Petaling Jaya," stays together on one line
//  - "list":    parts are separated by "·" (as in "SSM: 123  ·  Tax: C456"), so a number is never split
export function wrapParts(text: string | null | undefined, font: PDFFont, size: number, maxW: number, kind: "address" | "list"): string[] {
  const out: string[] = [];
  const joiner = kind === "list" ? "  ·  " : " ";
  const fits = (s: string) => font.widthOfTextAtSize(s, size) <= maxW;
  for (const para of String(text ?? "").replace(/\r\n?/g, "\n").split("\n")) {
    const clean = safeText(para).replace(/\s+/g, " ").trim();
    if (!clean) continue;
    const parts = kind === "list"
      ? clean.split(/\s*·\s*/).filter(Boolean)
      : clean.split(/(?<=,)\s+/).filter(Boolean); // keep the comma with the part before it
    let line = "";
    for (const part of parts) {
      const next = line ? line + joiner + part : part;
      if (fits(next)) { line = next; continue; }
      if (line) out.push(line);
      if (fits(part)) { line = part; continue; }
      // one part wider than a whole line (a long street name ...): word-wrap it, carry on after its last line
      const pieces = wrapText(part, font, size, maxW);
      out.push(...pieces.slice(0, -1));
      line = pieces[pieces.length - 1] ?? "";
    }
    if (line) out.push(line);
  }
  return out;
}

// "#1a56db" -> [r, g, b] in 0..1; anything else gives the fallback
export function hexToRgb01(hex: string | null | undefined, fallback: [number, number, number] = [0.1, 0.34, 0.86]): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? "").trim());
  if (!m) return fallback;
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
