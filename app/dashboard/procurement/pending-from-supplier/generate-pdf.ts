// "Pending from Supplier" as a PDF, built in the browser from exactly what the
// page is showing: the same lines after the condition / supplier / company /
// search filters. Only the ticked conditions get a column. A4 landscape.

import { PDFDocument, PDFString, rgb, StandardFonts, type PDFFont, type PDFImage, type PDFPage, type RGB } from "pdf-lib";
import type { PendingLine } from "@/server/pending-from-supplier";

export type PdfCond = "notShipped" | "short" | "replacement";

export type PendingPdfInput = {
  title: string;
  companyLabel: string;             // e.g. "Affirma Sdn Bhd" or "All companies"
  filtersLabel: string;             // e.g. "Conditions: Short on packing list, Awaiting replacement · Supplier: MedSupply"
  conds: PdfCond[];                 // ticked conditions, in display order
  condLabel: Record<PdfCond, string>;
  groups: { supplierName: string; organizationName: string | null; lines: PendingLine[]; oldest: Date }[];
  showOrg: boolean;                 // centralized: name the company on each supplier
  // What the user chose to print (the PDF options dialog)
  show: { customer: boolean; short: boolean; replacement: boolean };
  // Defect photos, already shrunk to JPEG in the browser, by photo id
  photos?: Map<string, Uint8Array>;
};

const W = 842, H = 595, M = 32, CW = W - 2 * M;
const INK = rgb(0.1, 0.1, 0.12), MID = rgb(0.4, 0.4, 0.45), LINE = rgb(0.85, 0.85, 0.88), SOFT = rgb(0.95, 0.95, 0.97);
const AMBER = rgb(0.72, 0.45, 0.02), RED = rgb(0.75, 0.12, 0.12);

// the standard PDF fonts can't print every character: replace what they can't
const safe = (t: unknown) => String(t ?? "").replace(/[\r\t\n]+/g, " ").replace(/[^\x20-\x7E -ÿ]/g, "?");
const fmtQty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));
// the line's unit of measure for "Short by 2 pc" — "pc" when it has none
const unitOf = (l: PendingLine) => (l.uom?.trim() || "pc").toLowerCase();
const fmtDate = (d: Date) => new Date(d).toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" });
const daysSince = (d: Date) => Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000));

function wrap(text: string, font: PDFFont, size: number, maxW: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of safe(text).split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= maxW) { line = next; continue; }
    if (line) out.push(line);
    let w = word;
    while (font.widthOfTextAtSize(w, size) > maxW && w.length > 1) {
      let n = w.length;
      while (n > 1 && font.widthOfTextAtSize(w.slice(0, n), size) > maxW) n--;
      out.push(w.slice(0, n)); w = w.slice(n);
    }
    line = w;
  }
  if (line) out.push(line);
  return out.length ? out : [""];
}

// A cell is plain text lines — or, for the short / replacement columns, pieces:
// styled text (wrapped to the column) and rows of defect-photo thumbnails.
type PdfMedia = { id: string; kind: "image" | "video"; shareUrl: string };
type Piece = { text: string; font: "regular" | "bold"; color: "ink" | "mid" | "amber" | "red" } | { photos: PdfMedia[] };
type Col = { key: string; label: string; width: number; align?: "right"; cell: (l: PendingLine) => string[]; pieces?: (l: PendingLine) => Piece[] };
const THUMB = 40, PHOTOS_PER_RETURN = 4;

export async function generatePendingFromSupplierPdf(input: PendingPdfInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const generatedAt = new Date().toLocaleString("en-MY", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

  // Columns: fixed ones + one per ticked condition; the item column takes the rest.
  const fixed: Col[] = [
    // PO no., its line no. (drawn as a badge, see the row loop), PO date
    { key: "po", label: "PO", width: 92, cell: (l) => [l.poNo ?? "(unnumbered)", `Line ${l.rowNo}`, fmtDate(l.poDate)] },
    { key: "item", label: "Item", width: 0, cell: (l) => [
      ...(l.productCode ? [l.productCode] : []),
      l.description ?? "-",
      ...(input.show.customer && (l.customerName || l.customerOrganization || l.customerPoNo)
        ? [`for ${[l.customerName, l.customerOrganization, l.customerPoNo ? `CPO ${l.customerPoNo}` : null].filter(Boolean).join(" · ")}`]
        : []),
    ] },
    { key: "ordered", label: "Ordered", width: 52, align: "right", cell: (l) => [`${fmtQty(l.qtyOrdered)} ${l.uom ?? ""}`.trim()] },
  ];
  const condCols: Record<PdfCond, Col> = {
    notShipped: { key: "notShipped", label: input.condLabel.notShipped, width: 62, align: "right", cell: (l) => [l.qtyNotShipped > 0 ? fmtQty(l.qtyNotShipped) : "-"] },
    short: {
      key: "short", label: input.condLabel.short, width: 170, cell: () => ["-"],
      pieces: (l) => (l.shortPls.length ? l.shortPls.flatMap((p): Piece[] => [
        { text: `Short by ${fmtQty(p.pending)} ${unitOf(l)}`, font: "bold", color: "amber" },
        { text: `on ${p.packingListNo} · ${p.received === 0 && p.plStatus === "pending" ? "awaiting receipt" : `${fmtQty(p.received)}/${fmtQty(p.expected)} received`}`, font: "regular", color: "mid" },
      ]) : [{ text: "-", font: "regular", color: "ink" }]),
    },
    replacement: {
      key: "replacement", label: input.condLabel.replacement, width: 170, cell: () => ["-"],
      pieces: (l) => (l.returns.length ? l.returns.flatMap((r): Piece[] => {
        // photos that loaded, and videos (shown as a tile) — each one a link to view it full size
        const photos = r.photos
          .filter((ph) => ph.kind === "video" || input.photos?.has(ph.id))
          .slice(0, PHOTOS_PER_RETURN)
          .map((ph) => ({ id: ph.id, kind: ph.kind, shareUrl: ph.shareUrl }));
        return [
          { text: `Awaiting replacement: ${fmtQty(r.outstanding)} ${unitOf(l)}`, font: "bold", color: "red" },
          { text: `rejected on ${r.grNo}${r.packingListNo ? ` (${r.packingListNo})` : ""} · ${r.shippedAt ? `sent back ${fmtDate(r.shippedAt)}` : "not sent back yet"}`, font: "regular", color: "mid" },
          ...(photos.length ? [{ photos }, { text: "click a photo to view it full size", font: "regular" as const, color: "mid" as const }] : []),
        ];
      }) : [{ text: "-", font: "regular", color: "ink" }]),
    },
  };
  // Which lines are in, and what Pending / the totals count, follow the page's
  // condition cards (input.conds) — exactly as on screen. The dialog's choices
  // only show or hide information: "Not shipped" is a column when its card is
  // ticked; the short / replacement columns when ticked in the dialog.
  const shownConds: PdfCond[] = [
    ...(input.conds.includes("notShipped") ? ["notShipped" as const] : []),
    ...(input.show.short ? ["short" as const] : []),
    ...(input.show.replacement ? ["replacement" as const] : []),
  ];
  const qtyOf = (l: PendingLine, c: PdfCond) => (c === "notShipped" ? l.qtyNotShipped : c === "short" ? l.qtyShort : l.qtyAwaitingReplacement);
  const pendingOf = (l: PendingLine) => input.conds.reduce((s, c) => s + qtyOf(l, c), 0);
  const groups = input.groups;
  const tail: Col[] = [
    { key: "pending", label: "Pending", width: 50, align: "right", cell: (l) => [fmtQty(pendingOf(l))] },
    { key: "age", label: "Age", width: 38, align: "right", cell: (l) => [`${daysSince(l.since)}d`] },
  ];
  const cols: Col[] = [...fixed, ...shownConds.map((c) => condCols[c]), ...tail];
  const used = cols.reduce((s, c) => s + c.width, 0);
  cols[1].width = Math.max(140, CW - used);   // item column takes what's left
  const PAD = 4, SIZE = 7.5, LH = 9.5;

  // A clickable area opening `url` in the reader's browser
  const addLink = (pg: PDFPage, lx: number, ly: number, lw: number, lh: number, url: string) => {
    const annot = pdf.context.obj({
      Type: "Annot", Subtype: "Link", Rect: [lx, ly, lx + lw, ly + lh], Border: [0, 0, 0],
      A: { Type: "Action", S: "URI", URI: PDFString.of(url) },
    });
    pg.node.addAnnot(pdf.context.register(annot));
  };

  // defect photos, embedded once each
  const embedded = new Map<string, PDFImage>();
  for (const [id, bytes] of input.photos ?? []) {
    try { embedded.set(id, await pdf.embedJpg(bytes)); } catch { /* a photo that won't embed is left out */ }
  }

  let page: PDFPage = pdf.addPage([W, H]);
  let y = H - M;
  const text = (p: PDFPage, t: string, x: number, yy: number, f: PDFFont, size: number, color = INK) => p.drawText(safe(t), { x, y: yy, size, font: f, color });

  const drawTableHeader = () => {
    page.drawRectangle({ x: M, y: y - 14, width: CW, height: 14, color: SOFT });
    let x = M;
    for (const c of cols) {
      const lbl = wrap(c.label, bold, SIZE, c.width - 2 * PAD)[0];
      const tx = c.align === "right" ? x + c.width - PAD - bold.widthOfTextAtSize(lbl, SIZE) : x + PAD;
      text(page, lbl, tx, y - 10, bold, SIZE, MID);
      x += c.width;
    }
    y -= 14;
  };
  const newPage = (withHeader: boolean, continuing?: string) => {
    page = pdf.addPage([W, H]);
    y = H - M;
    if (continuing) { text(page, `${continuing} (continued)`, M, y - 10, bold, 9); y -= 16; }
    if (withHeader) drawTableHeader();
  };

  // ── Title block ──
  text(page, input.title, M, y - 16, bold, 16);
  y -= 24;
  text(page, `${input.companyLabel} · generated ${generatedAt}`, M, y - 9, font, 9, MID);
  y -= 14;
  for (const ln of wrap(input.filtersLabel, font, 9, CW)) { text(page, ln, M, y - 9, font, 9, MID); y -= 12; }

  // ── Totals ──
  const all = groups.flatMap((g) => g.lines);
  const tot = (c: PdfCond) => all.reduce((s, l) => s + qtyOf(l, c), 0);
  const boxes: [string, string][] = [
    ["Suppliers", `${groups.length}  (${all.length} line${all.length === 1 ? "" : "s"})`],
    ...input.conds.map((c) => [input.condLabel[c], `${fmtQty(tot(c))} units`] as [string, string]),
  ];
  y -= 6;
  const bw = (CW - (boxes.length - 1) * 8) / boxes.length;
  boxes.forEach(([label, value], i) => {
    const x = M + i * (bw + 8);
    page.drawRectangle({ x, y: y - 36, width: bw, height: 36, borderColor: LINE, borderWidth: 0.8 });
    text(page, label, x + 8, y - 13, font, 8, MID);
    text(page, value, x + 8, y - 29, bold, 12);
  });
  y -= 50;

  // Supplier POs involved: how many, and every number
  const spoNos = [...new Map(all.map((l) => [l.purchaseOrderId, l.poNo ?? "(unnumbered)"])).values()].sort((a, b) => a.localeCompare(b));
  if (spoNos.length > 0) {
    text(page, `Supplier POs involved: ${spoNos.length}`, M, y - 9, bold, 9);
    y -= 13;
    for (const ln of wrap(spoNos.join(",  "), font, 8, CW)) {
      if (y < M + 40) newPage(false);
      text(page, ln, M, y - 8, font, 8, MID);
      y -= 11;
    }
    y -= 8;
  }

  if (groups.length === 0) {
    text(page, "Nothing pending for these filters.", M, y - 10, font, 10, MID);
  }

  // ── One section per supplier ──
  for (const g of groups) {
    const heading = `${g.supplierName}${input.showOrg && g.organizationName ? `  ·  ${g.organizationName}` : ""}`;
    const units = g.lines.reduce((s, l) => s + pendingOf(l), 0);
    if (y < M + 70) newPage(false);
    y -= 6;
    text(page, heading, M, y - 11, bold, 11);
    const poCount = new Set(g.lines.map((l) => l.purchaseOrderId)).size;
    const meta = `${g.lines.length} line${g.lines.length === 1 ? "" : "s"} · ${poCount} PO${poCount === 1 ? "" : "s"} · ${fmtQty(units)} units · oldest ${daysSince(g.oldest)}d`;
    text(page, meta, M + CW - font.widthOfTextAtSize(safe(meta), 8.5), y - 11, font, 8.5, MID);
    y -= 17;
    drawTableHeader();

    for (const l of g.lines) {
      const cells = cols.map((c) => c.cell(l).flatMap((t) => wrap(t, font, SIZE, c.width - 2 * PAD)));
      // pieces columns: each text piece wrapped; photo rows take one thumbnail row
      const laid = cols.map((c) => c.pieces?.(l).map((pc) => ("photos" in pc
        ? { photos: pc.photos, h: THUMB + 3 }
        : { lines: wrap(pc.text, pc.font === "bold" ? bold : font, SIZE, c.width - 2 * PAD), pc, h: 0 })) ?? null);
      const heightOf = (ci: number) => {
        const L = laid[ci];
        if (!L) return cells[ci].length * LH;
        return L.reduce((s, it) => s + ("photos" in it ? it.h : it.lines.length * LH), 0);
      };
      const rowH = Math.max(...cols.map((_, ci) => heightOf(ci))) + 2 * PAD - 2;
      if (y - rowH < M + 16) newPage(true, heading);
      let x = M;
      cols.forEach((c, ci) => {
        const L = laid[ci];
        if (L) {
          let cy = y - PAD - 6;
          for (const it of L) {
            if ("photos" in it) {
              let px = x + PAD;
              for (const m of it.photos ?? []) {
                const img = m.kind === "image" ? embedded.get(m.id) : undefined;
                // top-aligned just under the text above it
                const w = img ? img.width * Math.min(THUMB / img.width, THUMB / img.height) : THUMB;
                const h = img ? img.height * Math.min(THUMB / img.width, THUMB / img.height) : THUMB;
                const by = cy + 4 - h;
                if (img) {
                  page.drawImage(img, { x: px, y: by, width: w, height: h });
                } else {
                  page.drawRectangle({ x: px, y: by, width: w, height: h, color: rgb(0.15, 0.15, 0.17) });
                  const lbl = "> VIDEO";
                  page.drawText(lbl, { x: px + (w - bold.widthOfTextAtSize(lbl, 6.5)) / 2, y: by + h / 2 - 2, size: 6.5, font: bold, color: rgb(1, 1, 1) });
                }
                page.drawRectangle({ x: px, y: by, width: w, height: h, borderColor: LINE, borderWidth: 0.5 });
                addLink(page, px, by, w, h, m.shareUrl);
                px += w + 3;
              }
              cy -= it.h;
            } else {
              const f = it.pc.font === "bold" ? bold : font;
              const color: RGB = { ink: INK, mid: MID, amber: AMBER, red: RED }[it.pc.color];
              for (const ln of it.lines) { text(page, ln, x + PAD, cy, f, SIZE, color); cy -= LH; }
            }
          }
          x += c.width;
          return;
        }
        cells[ci].forEach((ln, li) => {
          const f = c.key === "pending" || (c.key === "po" && li === 0) ? bold : font;
          const color = c.key === "age" ? (daysSince(l.since) > 60 ? RED : daysSince(l.since) > 30 ? AMBER : MID)
            : c.key === "po" && li > 0 ? MID : c.key === "item" && ln.startsWith("for ") ? MID : INK;
          const tx = c.align === "right" ? x + c.width - PAD - f.widthOfTextAtSize(ln, SIZE) : x + PAD;
          if (c.key === "po" && li === 1) {
            // the PO line no. as a small shaded badge
            page.drawRectangle({ x: tx - 2, y: y - PAD - 6 - li * LH - 2, width: font.widthOfTextAtSize(safe(ln), SIZE - 0.5) + 4, height: SIZE + 1.5, color: SOFT });
            text(page, ln, tx, y - PAD - 6 - li * LH, font, SIZE - 0.5, MID);
            return;
          }
          text(page, ln, tx, y - PAD - 6 - li * LH, f, SIZE, color);
        });
        x += c.width;
      });
      y -= rowH;
      page.drawLine({ start: { x: M, y }, end: { x: M + CW, y }, thickness: 0.5, color: LINE });
    }
    y -= 10;
  }

  // ── Page numbers ──
  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    const label = `${input.title} · page ${i + 1} of ${pages.length}`;
    p.drawText(safe(label), { x: W - M - font.widthOfTextAtSize(safe(label), 7.5), y: M / 2, size: 7.5, font, color: MID });
  });

  return pdf.save();
}
