// Reads the text of a PDF on the server (for customer POs made by a computer, which have real text in them).
// A scan or a photo has no text: it comes back with readable = false and the user links the quotation themselves.

export type PdfText = { text: string; pages: number; readable: boolean };

export async function extractPdfText(data: Uint8Array, maxPages = 8): Promise<PdfText> {
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
    for (let p = 1; p <= Math.min(pages, maxPages); p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
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
    return { text, pages, readable: (text.match(/[A-Za-z0-9]{2,}/g) ?? []).length >= 8 };
  } finally {
    await doc.destroy();
  }
}
