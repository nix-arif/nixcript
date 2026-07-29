importScripts(
  "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js",
);

self.postMessage({ type: "log", msg: "Ready", level: "success" });

// Characters that are considered part of a product code identifier.
// Hyphens, slashes and dots are included because they appear inside codes
// (e.g. AKM-1234567-1, AKM/1234/2024) — treating them as "outside" would
// cause partial-prefix false positives.
function isWordChar(c) {
  return /[a-z0-9\-\/\.]/.test(c);
}

// Check every occurrence of `code` in `text`, returning true the first time
// both surrounding characters are non-word-chars (i.e. a clean boundary).
function exactMatch(text, code) {
  if (!code) return false;
  const lowerCode = code.toLowerCase().trim();
  if (!lowerCode) return false;
  const lowerText = text.toLowerCase();

  let start = 0;
  while (true) {
    const idx = lowerText.indexOf(lowerCode, start);
    if (idx === -1) break;
    const before = idx === 0 ? "\0" : lowerText[idx - 1];
    const after =
      idx + lowerCode.length >= lowerText.length
        ? "\0"
        : lowerText[idx + lowerCode.length];
    if (!isWordChar(before) && !isWordChar(after)) return true;
    start = idx + 1;
  }
  return false;
}

// Search a list of PDF text items for a code, with optional x-band filtering.
// Returns true if the code is found (with word boundaries) in any qualifying item.
function matchInItems(items, code, colBand) {
  const lowerCode = code.toLowerCase().trim();
  if (!lowerCode) return false;

  const candidates = colBand
    ? items.filter(
        (it) => it.x >= colBand.xMin - 15 && it.x <= colBand.xMax + 15,
      )
    : items;

  for (const item of candidates) {
    if (!item.str.trim()) continue;
    if (exactMatch(item.str, lowerCode)) return true;
  }
  return false;
}

// Find the PDF text item that contains the code (within an optional x-band)
// and return its coordinates.
function findMatchCoord(items, code, colBand) {
  const lowerCode = code.toLowerCase().trim();
  const candidates = colBand
    ? items.filter(
        (it) => it.x >= colBand.xMin - 15 && it.x <= colBand.xMax + 15,
      )
    : items;

  for (const item of candidates) {
    if (!item.str.trim()) continue;
    const itemLower = item.str.toLowerCase();
    let start = 0;
    while (true) {
      const idx = itemLower.indexOf(lowerCode, start);
      if (idx === -1) break;
      const before = idx === 0 ? "\0" : itemLower[idx - 1];
      const after =
        idx + lowerCode.length >= itemLower.length
          ? "\0"
          : itemLower[idx + lowerCode.length];
      if (!isWordChar(before) && !isWordChar(after)) {
        return { x: item.x, y: item.y, height: item.height };
      }
      start = idx + 1;
    }
  }
  return null;
}

// For a given PDF file, find the x-band of the identifier column by locating
// the column header text.  Returns { xMin, xMax } or null if not found.
function detectColumnBand(allPages, fileName, headerKeyword) {
  if (!headerKeyword) return null;
  const lowerHeader = headerKeyword.toLowerCase().trim();

  for (const page of allPages) {
    if (page.fileName !== fileName) continue;
    for (const item of page.items) {
      if (!item.str.trim()) continue;
      const itemLower = item.str.toLowerCase().trim();
      // Accept exact match or the header being fully contained in the item
      if (itemLower === lowerHeader || itemLower.includes(lowerHeader)) {
        const w = Math.max(item.width || 0, 80); // at least 80 pts wide
        return { xMin: item.x, xMax: item.x + w };
      }
    }
  }
  return null;
}

function parseValidityRange(text) {
  const m = text.match(
    /(\d{2}\/\d{2}\/\d{4})\s*[-–—]+\s*(\d{2}\/\d{2}\/\d{4})/,
  );
  return m
    ? { validFrom: m[1], expiredOn: m[2] }
    : { validFrom: "", expiredOn: "" };
}

function findRegistrationNo(text) {
  const lower = text.toLowerCase();
  const patterns = [
    "no. pendaftaran:",
    "no pendaftaran:",
    "registration no.:",
    "reg. no.:",
  ];
  for (const p of patterns) {
    const idx = lower.indexOf(p);
    if (idx === -1) continue;
    const after = text.slice(idx + p.length, idx + p.length + 80);
    const m = after.match(/([A-Z]{2}\d{7,}-\d+)/i);
    if (m) return m[1].trim().toUpperCase();
  }
  return "";
}

self.onmessage = async (e) => {
  const { xlsxData, allPages, productCodeColumn, pdfIdentifierColumn } = e.data;

  try {
    // Parse xlsx
    self.postMessage({ type: "log", msg: "Reading spreadsheet...", level: "info" });
    const wb = XLSX.read(new Uint8Array(xlsxData), { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
    const origHeaders = Object.keys(rows[0] || {});
    self.postMessage({ type: "log", msg: "Found " + rows.length + " rows", level: "success" });
    self.postMessage({ type: "stats", rows: rows.length });
    self.postMessage({
      type: "log",
      msg: "Received " + allPages.length + " pages from main thread",
      level: "info",
    });

    // Build first page map (for registration no + validity extraction)
    const firstPageMap = {};
    for (const page of allPages) {
      if (page.pageNum === 1 && !firstPageMap[page.fileName]) {
        firstPageMap[page.fileName] = page.text;
      }
    }

    // ── Per-file identifier column band ────────────────────────────────────
    // For each unique PDF file, locate the identifier column header to get
    // its x-range.  All product-code matching is then restricted to items
    // within that band.  Falls back to searching all items when no header is
    // found or no column is specified.
    const fileColBands = new Map(); // Map<fileName, { xMin, xMax } | null>
    if (pdfIdentifierColumn) {
      const uniqueFiles = [...new Set(allPages.map((p) => p.fileName))];
      for (const fileName of uniqueFiles) {
        const band = detectColumnBand(allPages, fileName, pdfIdentifierColumn);
        fileColBands.set(fileName, band);
        if (band) {
          self.postMessage({
            type: "log",
            msg:
              "  Column '" +
              pdfIdentifierColumn +
              "' in " +
              fileName +
              " → x " +
              band.xMin +
              "–" +
              band.xMax,
            level: "info",
          });
        } else {
          self.postMessage({
            type: "log",
            msg:
              "  Column header '" +
              pdfIdentifierColumn +
              "' not found in " +
              fileName +
              " — searching all items",
            level: "warn",
          });
        }
      }
    }

    // ── Match rows ──────────────────────────────────────────────────────────
    self.postMessage({
      type: "log",
      msg: "Matching " + rows.length + " codes...",
      level: "info",
    });
    let matched = 0;
    const enriched = [];

    for (let ri = 0; ri < rows.length; ri++) {
      const row = rows[ri];
      const code = String(row[productCodeColumn] ?? "").trim();
      let regNo = "",
        pageNo = "",
        validFrom = "",
        expiredOn = "",
        pdfFile = "",
        matchX = "",
        matchY = "",
        rowHeight = "",
        pageWidth = "",
        pageHeight = "";

      if (code) {
        // Match only within the identifier column band (or all items if no
        // band was detected / specified).
        const hits = allPages.filter((p) => {
          const colBand = fileColBands.get(p.fileName) ?? null;
          return matchInItems(p.items, code, colBand);
        });

        if (hits.length > 0) {
          matched++;
          const best = hits[0];
          pageNo = String(best.pageNum);
          pdfFile = best.fileName;

          const colBand = fileColBands.get(best.fileName) ?? null;
          const coord = best.items
            ? findMatchCoord(best.items, code, colBand)
            : null;
          matchX = coord ? String(coord.x) : "";
          matchY = coord ? String(coord.y) : "";
          rowHeight = coord ? String(coord.height) : "";
          pageWidth = String(best.pageWidth || "");
          pageHeight = String(best.pageHeight || "");

          const fp = firstPageMap[best.fileName] || "";
          regNo = findRegistrationNo(fp);
          const { validFrom: vf, expiredOn: eo } = parseValidityRange(fp);
          validFrom = vf;
          expiredOn = eo;
        } else {
          self.postMessage({ type: "log", msg: "  No match: " + code, level: "warn" });
        }
      }

      enriched.push({
        ...row,
        "MDA Registration No": regNo,
        "MDA Page No": pageNo,
        "MDA Valid From": validFrom,
        "MDA Expired On": expiredOn,
        "MDA PDF File": pdfFile,
        "MDA Match X": matchX,
        "MDA Match Y": matchY,
        "MDA Row Height": rowHeight,
        "MDA Page Width": pageWidth,
        "MDA Page Height": pageHeight,
      });

      if (ri % 20 === 0) {
        self.postMessage({
          type: "matchProgress",
          current: ri + 1,
          total: rows.length,
          matched,
        });
      }
    }

    self.postMessage({
      type: "log",
      msg: "Matched " + matched + " of " + rows.length,
      level: matched > 0 ? "success" : "warn",
    });

    // Generate output
    const NEW_COLS = [
      "MDA Registration No",
      "MDA Page No",
      "MDA Valid From",
      "MDA Expired On",
      "MDA PDF File",
      "MDA Match X",
      "MDA Match Y",
      "MDA Row Height",
      "MDA Page Width",
      "MDA Page Height",
    ];
    const outWb = XLSX.utils.book_new();
    const outWs = XLSX.utils.json_to_sheet(enriched);
    outWs["!cols"] = [...origHeaders, ...NEW_COLS].map((h) => ({
      wch: Math.max(h.length + 4, 14),
    }));

    XLSX.utils.book_append_sheet(outWb, outWs, "Results");
    const outBuf = XLSX.write(outWb, { bookType: "xlsx", type: "array" });

    self.postMessage({
      type: "done",
      buffer: outBuf,
      matched,
      total: rows.length,
      preview: enriched.slice(0, 5),
      headers: [...origHeaders, ...NEW_COLS],
    });
  } catch (err) {
    self.postMessage({ type: "error", msg: err.message });
  }
};
