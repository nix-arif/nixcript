// Reads the text of a PDF on the server (for customer POs made by a computer, which have real text in them).
// A scan or a photo has no text: it comes back with readable = false and the user links the quotation themselves.

export type PdfText = { text: string; pages: number; readable: boolean; cells: { page: number; x: number; y: number; str: string }[] };

// The PDF reader expects browser classes that a server may not have (DOMMatrix needs a native canvas package that is not
// always installed). Reading text never draws anything, so a plain stand-in is enough to let the reader load.
function ensureDomMatrix() {
  const g = globalThis as { DOMMatrix?: unknown };
  if (g.DOMMatrix) return;
  class DOMMatrixStandIn {
    a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
    is2D = true; isIdentity = true;
    constructor(init?: number[] | string) {
      if (Array.isArray(init) && init.length >= 6) [this.a, this.b, this.c, this.d, this.e, this.f] = init;
    }
    private set(a: number, b: number, c: number, d: number, e: number, f: number) { this.a = a; this.b = b; this.c = c; this.d = d; this.e = e; this.f = f; return this; }
    multiplySelf(m: DOMMatrixStandIn) {
      return this.set(this.a * m.a + this.c * m.b, this.b * m.a + this.d * m.b, this.a * m.c + this.c * m.d, this.b * m.c + this.d * m.d, this.a * m.e + this.c * m.f + this.e, this.b * m.e + this.d * m.f + this.f);
    }
    preMultiplySelf(m: DOMMatrixStandIn) {
      return this.set(m.a * this.a + m.c * this.b, m.b * this.a + m.d * this.b, m.a * this.c + m.c * this.d, m.b * this.c + m.d * this.d, m.a * this.e + m.c * this.f + m.e, m.b * this.e + m.d * this.f + m.f);
    }
    translate(x = 0, y = 0) { return new DOMMatrixStandIn([this.a, this.b, this.c, this.d, this.e, this.f]).multiplySelf(new DOMMatrixStandIn([1, 0, 0, 1, x, y])); }
    scale(x = 1, y = x) { return new DOMMatrixStandIn([this.a, this.b, this.c, this.d, this.e, this.f]).multiplySelf(new DOMMatrixStandIn([x, 0, 0, y, 0, 0])); }
    invertSelf() {
      const det = this.a * this.d - this.b * this.c;
      if (!det) return this.set(NaN, NaN, NaN, NaN, NaN, NaN);
      return this.set(this.d / det, -this.b / det, -this.c / det, this.a / det, (this.c * this.f - this.d * this.e) / det, (this.b * this.e - this.a * this.f) / det);
    }
  }
  g.DOMMatrix = DOMMatrixStandIn;
}

export async function extractPdfText(data: Uint8Array, maxPages = 8): Promise<PdfText> {
  ensureDomMatrix();
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // load the worker in-process: a normal import is traced by the build, so no symlinked include is needed
  const g = globalThis as { pdfjsWorker?: unknown };
  if (!g.pdfjsWorker) {
    // @ts-expect-error the worker file ships without type declarations
    g.pdfjsWorker = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  }
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data), useSystemFonts: true, disableFontFace: true, verbosity: 0 }).promise;
  try {
    const pages = doc.numPages;
    const out: string[] = [];
    const cells: PdfText["cells"] = [];
    for (let p = 1; p <= Math.min(pages, maxPages); p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      for (const it of content.items as { str?: string; transform?: number[] }[]) {
        if (typeof it.str === "string" && it.str.trim() && it.transform) cells.push({ page: p, x: Math.round(it.transform[4]), y: Math.round(it.transform[5]), str: it.str });
      }
      // keep the lines of the page: a new line whenever the text moves down
      let line = "";
      let lastY: number | null = null;
      for (const it of content.items as { str?: string; transform?: number[] }[]) {
        if (typeof it.str !== "string") continue;
        const y = it.transform ? Math.round(it.transform[5]) : null;
        if (lastY !== null && y !== null && Math.abs(y - lastY) > 2) { out.push(line); line = ""; }
        line += (line && !line.endsWith(" ") && !it.str.startsWith(" ") ? " " : "") + it.str;
        lastY = y;
      }
      if (line) out.push(line);
      out.push("");
    }
    const text = out.join("\n").replace(/[ \t]+\n/g, "\n").trim();
    // a few words of real text at least; a scan gives nothing
    return { text, pages, readable: (text.match(/[A-Za-z0-9]{2,}/g) ?? []).length >= 8, cells };
  } finally {
    await doc.destroy();
  }
}
