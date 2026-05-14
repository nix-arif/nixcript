importScripts(
  "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js",
);

self.postMessage({ type: "log", msg: "Ready", level: "success" });

function findMatchCoord(items, code) {
  const lower = code.toLowerCase();
  for (const item of items) {
    if (item.str.toLowerCase().includes(lower)) {
      return { x: item.x, y: item.y, height: item.height };
    }
  }
  return null;
}

function exactMatch(text, code) {
  if (!code) return false;
  const lowerText = text.toLowerCase();
  const lowerCode = code.toLowerCase().trim();
  const idx = lowerText.indexOf(lowerCode);
  if (idx === -1) return false;
  const before = idx === 0 ? " " : lowerText[idx - 1];
  const after =
    idx + lowerCode.length >= lowerText.length
      ? " "
      : lowerText[idx + lowerCode.length];
  const isBoundary = (c) => /[a-z0-9]/.test(c);
  return !isBoundary(before) && !isBoundary(after);
}

function parseValidityRange(text) {
  const m = text.match(
    /(\d{2}\/\d{2}\/\d{4})\s*[-\u2013\u2014]+\s*(\d{2}\/\d{2}\/\d{4})/,
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
  const { xlsxData, allPages, productCodeColumn } = e.data;

  try {
    // Parse xlsx
    self.postMessage({
      type: "log",
      msg: "Reading spreadsheet...",
      level: "info",
    });
    const wb = XLSX.read(new Uint8Array(xlsxData), { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
    const origHeaders = Object.keys(rows[0] || {});
    self.postMessage({
      type: "log",
      msg: "Found " + rows.length + " rows",
      level: "success",
    });
    self.postMessage({ type: "stats", rows: rows.length });
    self.postMessage({
      type: "log",
      msg: "Received " + allPages.length + " pages from main thread",
      level: "info",
    });

    // Build first page map
    const firstPageMap = {};
    for (const page of allPages) {
      if (page.pageNum === 1 && !firstPageMap[page.fileName]) {
        firstPageMap[page.fileName] = page.text;
      }
    }

    // Match rows
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
        const hits = allPages.filter((p) => exactMatch(p.text, code));
        if (hits.length > 0) {
          matched++;
          pageNo = hits.map((p) => p.pageNum).join(", ");
          const best = hits[0];
          pdfFile = best.fileName;

          // Get coordinates
          const coord = best.items ? findMatchCoord(best.items, code) : null;
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
          self.postMessage({
            type: "log",
            msg: "  No match: " + code,
            level: "warn",
          });
        }
      }

      enriched.push({
        ...row,
        "Registration No": regNo,
        "Page No": pageNo,
        "Valid From": validFrom,
        "Expired On": expiredOn,
        "PDF File": pdfFile,
        "Match X": matchX,
        "Match Y": matchY,
        "Row Height": rowHeight,
        "Page Width": pageWidth,
        "Page Height": pageHeight,
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
      "Registration No",
      "Page No",
      "Valid From",
      "Expired On",
      "PDF File",
      "Match X",
      "Match Y",
      "Row Height",
      "Page Width",
      "Page Height",
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
