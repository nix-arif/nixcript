"use client";

import { useState, useRef, useCallback } from "react";
import * as XLSX from "xlsx";

// ── Types ─────────────────────────────────────────────────────────────────────
type LogEntry = { msg: string; level: string; time: string };
type Stats = {
  rows: number;
  pages: number;
  matched: number;
  unmatched: number;
  pdfDone: number;
  pdfTotal: number;
};
type PreviewRow = Record<string, any>;

// ── PDF text extractor — runs in main thread where pdfjs works ────────────────
type PageData = {
  pageNum: number;
  text: string;
  fileName: string;
  items: {
    str: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }[];
  pageWidth: number;
  pageHeight: number;
};

async function extractPdfText(file: File): Promise<PageData[]> {
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const pages: PageData[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();

    const items = (content.items as any[]).map((item) => ({
      str: item.str,
      x: Math.round(item.transform[4]),
      y: Math.round(item.transform[5]),
      width: Math.round(item.width),
      height: Math.round(item.height),
    }));

    const text = items.map((it) => it.str).join(" ");

    pages.push({
      pageNum: i,
      text,
      fileName: file.name,
      items,
      pageWidth: Math.round(viewport.width),
      pageHeight: Math.round(viewport.height),
    });
  }

  return pages;
}

// ── Constants ─────────────────────────────────────────────────────────────────
const STATUS = {
  IDLE: "idle",
  PROCESSING: "processing",
  DONE: "done",
  ERROR: "error",
} as const;
type StatusType = (typeof STATUS)[keyof typeof STATUS];
const NEW_COLS = [
  "Registration No",
  "Page No",
  "Valid From",
  "Expired On",
  "PDF File",
];

// ── FileZone component ────────────────────────────────────────────────────────
interface FileZoneProps {
  label: string;
  accept: string[];
  multiple: boolean;
  files: File[];
  onAdd: (files: File[]) => void;
  onRemove: (index: number) => void;
}

function FileZone({
  label,
  accept,
  multiple,
  files,
  onAdd,
  onRemove,
}: FileZoneProps) {
  const [drag, setDrag] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const filled = files.length > 0;

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDrag(false);
      const dropped = Array.from(e.dataTransfer.files).filter((f) =>
        accept.some((a) => f.name.toLowerCase().endsWith(a)),
      );
      if (dropped.length) onAdd(dropped);
    },
    [accept, onAdd],
  );

  return (
    <div
      onClick={() => ref.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={handleDrop}
      style={{
        border: `1.5px dashed ${drag ? "#6366f1" : filled ? "#22c55e" : "#374151"}`,
        borderRadius: 12,
        padding: "20px 14px",
        cursor: "pointer",
        background: drag
          ? "rgba(99,102,241,0.06)"
          : filled
            ? "rgba(34,197,94,0.06)"
            : "rgba(17,24,39,0.6)",
        textAlign: "center",
        transition: "all 0.15s",
        minHeight: 110,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
      }}
    >
      <input
        ref={ref}
        type="file"
        accept={accept.join(",")}
        multiple={multiple}
        style={{ display: "none" }}
        onChange={(e) => onAdd(Array.from(e.target.files ?? []))}
      />
      <div style={{ fontSize: 28 }}>
        {filled ? "✅" : accept.includes(".pdf") ? "📄" : "📊"}
      </div>
      {!filled ? (
        <>
          <div style={{ fontSize: 13, fontWeight: 500, color: "#9ca3af" }}>
            {label}
          </div>
          <div style={{ fontSize: 11, color: "#4b5563" }}>
            Click or drag & drop
          </div>
        </>
      ) : (
        <>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#22c55e" }}>
            {files.length} file{files.length > 1 ? "s" : ""} selected
          </div>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 4,
              justifyContent: "center",
              maxHeight: 72,
              overflowY: "auto",
            }}
          >
            {files.slice(0, 20).map((f, i) => (
              <span
                key={i}
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(i);
                }}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 3,
                  background: "rgba(255,255,255,0.06)",
                  border: "0.5px solid #374151",
                  borderRadius: 6,
                  padding: "2px 7px",
                  fontSize: 10,
                  color: "#9ca3af",
                  cursor: "pointer",
                }}
              >
                {f.name.length > 22 ? f.name.slice(0, 20) + "…" : f.name} ×
              </span>
            ))}
            {files.length > 20 && (
              <span
                style={{ fontSize: 11, color: "#6b7280", padding: "2px 4px" }}
              >
                +{files.length - 20} more
              </span>
            )}
          </div>
          <div style={{ fontSize: 10, color: "#4b5563" }}>
            Click to add more
          </div>
        </>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export function CertificateMatcher() {
  const [xlsxFiles, setXlsxFiles] = useState<File[]>([]);
  const [pdfFiles, setPdfFiles] = useState<File[]>([]);
  const [colName, setColName] = useState<string>("");
  const [detectedCols, setDetectedCols] = useState<string[]>([]);
  const [colStatus, setColStatus] = useState<"found" | "notfound" | null>(null);
  const [pdfColName, setPdfColName] = useState<string>("");
  const [status, setStatus] = useState<StatusType>(STATUS.IDLE);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [stats, setStats] = useState<Stats>({
    rows: 0,
    pages: 0,
    matched: 0,
    unmatched: 0,
    pdfDone: 0,
    pdfTotal: 0,
  });
  const [preview, setPreview] = useState<PreviewRow[]>([]);
  const [previewHeaders, setPreviewHeaders] = useState<string[]>([]);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [downloadName, setDownloadName] = useState<string>("");
  const [progress, setProgress] = useState<number>(0);
  const logRef = useRef<HTMLDivElement>(null);
  const workerRef = useRef<Worker | null>(null);

  const addLog = useCallback((msg: string, level = "info") => {
    const time = new Date().toLocaleTimeString("en-GB", { hour12: false });
    setLogs((prev) => {
      const next = [...prev, { msg, level, time }];
      setTimeout(() => {
        if (logRef.current)
          logRef.current.scrollTop = logRef.current.scrollHeight;
      }, 10);
      return next;
    });
  }, []);

  const handleXlsxAdd = async (files: File[]) => {
    const f = files[0];
    setXlsxFiles([f]);
    setColStatus(null);
    setDetectedCols([]);
    try {
      const buf = await f.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array", sheetRows: 2 });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: "" }) as Record<
        string,
        unknown
      >[];
      if (rows.length) {
        const cols = Object.keys(rows[0] as object);
        setDetectedCols(cols);
        const guess = cols.find((c) =>
          /product.?code|kod.?produk|item.?code|part.?no/i.test(c),
        );
        if (guess) {
          setColName(guess);
          setColStatus("found");
        } else setColStatus("notfound");
      }
    } catch {
      setColStatus("notfound");
    }
  };

  const handleColChange = (val: string) => {
    setColName(val);
    if (!detectedCols.length) {
      setColStatus(null);
      return;
    }
    const found = detectedCols.find(
      (c) => c.toLowerCase() === val.toLowerCase().trim(),
    );
    setColStatus(found ? "found" : val.trim() ? "notfound" : null);
  };

  const handleProcess = async () => {
    setStatus(STATUS.PROCESSING);
    setLogs([]);
    setPreview([]);
    setDownloadUrl(null);
    setProgress(0);
    setStats({
      rows: 0,
      pages: 0,
      matched: 0,
      unmatched: 0,
      pdfDone: 0,
      pdfTotal: pdfFiles.length,
    });

    try {
      const xlsxBuffer = await xlsxFiles[0].arrayBuffer();

      // Extract PDF text in main thread where pdfjs works fine
      addLog("Extracting PDF text...", "info");
      const allPages: PageData[] = [];

      for (let fi = 0; fi < pdfFiles.length; fi++) {
        const f = pdfFiles[fi];
        addLog(`Extracting: ${f.name} (${fi + 1}/${pdfFiles.length})`, "info");
        try {
          const pages = await extractPdfText(f);
          allPages.push(...pages);
          addLog(`  → ${pages.length} pages extracted`, "success");
        } catch (err: any) {
          addLog(`  → Failed: ${err.message}`, "error");
        }
        setStats((prev) => ({
          ...prev,
          pdfDone: fi + 1,
          pages: allPages.length,
        }));
        setProgress(Math.round(((fi + 1) / pdfFiles.length) * 50));
      }

      addLog(`Total pages: ${allPages.length}`, "info");

      // Send pre-extracted text to worker for matching + xlsx generation
      const worker = new Worker("/workers/certificate-matcher-worker.js");
      workerRef.current = worker;
      addLog("Matching product codes...", "info");

      worker.onerror = (err: ErrorEvent) => {
        addLog(`Worker error: ${err.message}`, "error");
        setStatus(STATUS.ERROR);
      };

      worker.onmessage = (e: MessageEvent) => {
        const data = e.data as Record<string, any>;

        if (data.type === "log") {
          addLog(data.msg as string, data.level as string);
        } else if (data.type === "stats") {
          setStats((prev) => ({ ...prev, rows: data.rows as number }));
        } else if (data.type === "matchProgress") {
          setStats((prev) => ({
            ...prev,
            matched: data.matched,
            unmatched: (data.current as number) - (data.matched as number),
          }));
          setProgress(50 + Math.round((data.current / data.total) * 45));
        } else if (data.type === "done") {
          setStats((prev) => ({
            ...prev,
            matched: data.matched,
            unmatched: (data.total as number) - (data.matched as number),
          }));
          setPreviewHeaders(data.headers as string[]);
          setPreview(data.preview as PreviewRow[]);
          const outBlob = new Blob([data.buffer as ArrayBuffer], {
            type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          });
          const url = URL.createObjectURL(outBlob);
          const fname = `mda_matched_${Date.now()}.xlsx`;
          setDownloadUrl(url);
          setDownloadName(fname);
          setProgress(100);
          addLog(
            `Done! ${data.matched} of ${data.total} rows matched.`,
            "success",
          );
          setStatus(STATUS.DONE);
          worker.terminate();
        } else if (data.type === "error") {
          addLog(`Error: ${data.msg as string}`, "error");
          setStatus(STATUS.ERROR);
          worker.terminate();
        }
      };

      worker.postMessage(
        {
          xlsxData: xlsxBuffer,
          allPages,
          productCodeColumn: colName,
          pdfIdentifierColumn: pdfColName.trim() || null,
        },
        [],
      );
    } catch (err: any) {
      addLog(`Error: ${err.message}`, "error");
      setStatus(STATUS.ERROR);
    }
  };

  const reset = () => {
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }
    setXlsxFiles([]);
    setPdfFiles([]);
    setColName("");
    setPdfColName("");
    setDetectedCols([]);
    setColStatus(null);
    setStatus(STATUS.IDLE);
    setLogs([]);
    setProgress(0);
    setStats({
      rows: 0,
      pages: 0,
      matched: 0,
      unmatched: 0,
      pdfDone: 0,
      pdfTotal: 0,
    });
    setPreview([]);
    setPreviewHeaders([]);
    setDownloadUrl(null);
    setDownloadName("");
  };

  const canProcess =
    xlsxFiles.length > 0 && pdfFiles.length > 0 && colStatus === "found";
  const isProcessing = status === STATUS.PROCESSING;
  const isDone = status === STATUS.DONE;

  const logColor = (level: string): string => {
    const colors: Record<string, string> = {
      success: "#4ade80",
      error: "#f87171",
      warn: "#fbbf24",
      info: "#6b7280",
    };
    return colors[level] ?? "#6b7280";
  };

  return (
    <div
      className="matcher-root"
      style={{
        background: "#0a0a0f",
        color: "#e2e8f0",
        fontFamily: "'DM Sans', 'Segoe UI', sans-serif",
        padding: "24px",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&family=DM+Mono:wght@400;500&display=swap');
        .matcher-root * { box-sizing: border-box; }
        .matcher-root input { background: rgba(255,255,255,0.05); border: 1px solid #1f2937; border-radius: 8px; padding: 8px 12px; color: #e2e8f0; font-family: inherit; font-size: 13px; width: 100%; outline: none; transition: border-color 0.15s; }
        .matcher-root input:focus { border-color: #6366f1; }
        .matcher-root input::placeholder { color: #4b5563; }
        .matcher-root ::-webkit-scrollbar { width: 4px; height: 4px; }
        .matcher-root ::-webkit-scrollbar-track { background: transparent; }
        .matcher-root ::-webkit-scrollbar-thumb { background: #1f2937; border-radius: 2px; }
        .matcher-root .btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 9px 18px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; border: none; font-family: inherit; transition: all 0.15s; }
        .matcher-root .btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .matcher-root .btn-primary { background: linear-gradient(135deg, #6366f1, #8b5cf6); color: #fff; }
        .matcher-root .btn-primary:hover:not(:disabled) { opacity: 0.9; transform: translateY(-1px); }
        .matcher-root .btn-ghost { background: rgba(255,255,255,0.04); border: 1px solid #1f2937; color: #9ca3af; }
        .matcher-root .btn-ghost:hover:not(:disabled) { background: rgba(255,255,255,0.08); }
        .matcher-root .card { background: rgba(255,255,255,0.02); border: 1px solid #1a1f2e; border-radius: 12px; padding: 16px; }
        .matcher-root .stat { background: rgba(255,255,255,0.03); border: 1px solid #1a1f2e; border-radius: 10px; padding: 12px 14px; }
        .matcher-root a { color: inherit; text-decoration: none; }
      `}</style>

      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        {/* Header */}
        <div style={{ marginBottom: 28 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginBottom: 6,
            }}
          >
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: "linear-gradient(135deg,#6366f1,#8b5cf6)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 16,
              }}
            >
              ⚡
            </div>
            <h1
              style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.4px" }}
            >
              MDA Certificate Matcher
            </h1>
          </div>
          <p style={{ fontSize: 13, color: "#4b5563", lineHeight: 1.6 }}>
            Matches product codes against MDA certificate PDFs. Extracts{" "}
            <code
              style={{
                fontSize: 11,
                background: "rgba(255,255,255,0.06)",
                padding: "1px 5px",
                borderRadius: 4,
              }}
            >
              No. Pendaftaran
            </code>{" "}
            and validity dates. Runs entirely in your browser — nothing is
            uploaded.
          </p>
        </div>

        {/* Upload zones */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 12,
            marginBottom: 14,
          }}
        >
          <div>
            <div
              style={{
                fontSize: 10,
                fontWeight: 600,
                color: "#4b5563",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                marginBottom: 7,
              }}
            >
              Spreadsheet
            </div>
            <FileZone
              label="Upload .xlsx or .csv"
              accept={[".xlsx", ".xls", ".csv"]}
              multiple={false}
              files={xlsxFiles}
              onAdd={handleXlsxAdd}
              onRemove={() => {
                setXlsxFiles([]);
                setDetectedCols([]);
                setColStatus(null);
              }}
            />
          </div>
          <div>
            <div
              style={{
                fontSize: 10,
                fontWeight: 600,
                color: "#4b5563",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                marginBottom: 7,
              }}
            >
              MDA Certificate PDFs
            </div>
            <FileZone
              label="Upload one or more PDFs"
              accept={[".pdf"]}
              multiple={true}
              files={pdfFiles}
              onAdd={(f) => setPdfFiles((prev) => [...prev, ...f])}
              onRemove={(i) =>
                setPdfFiles((prev) => prev.filter((_, idx) => idx !== i))
              }
            />
          </div>
        </div>

        {/* Column selector */}
        <div className="card" style={{ marginBottom: 14 }}>
          <div
            style={{
              fontSize: 10,
              fontWeight: 600,
              color: "#4b5563",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              marginBottom: 8,
            }}
          >
            Product code column
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              value={colName}
              onChange={(e) => handleColChange(e.target.value)}
              placeholder="e.g. product code, Kod Produk, Item Code…"
            />
            {colStatus === "found" && (
              <span
                style={{
                  fontSize: 12,
                  color: "#4ade80",
                  whiteSpace: "nowrap",
                  flexShrink: 0,
                }}
              >
                ✓ Found
              </span>
            )}
            {colStatus === "notfound" && (
              <span
                style={{
                  fontSize: 12,
                  color: "#f87171",
                  whiteSpace: "nowrap",
                  flexShrink: 0,
                }}
              >
                ✗ Not found
              </span>
            )}
          </div>
          {detectedCols.length > 0 && (
            <div
              style={{
                marginTop: 8,
                display: "flex",
                gap: 5,
                flexWrap: "wrap",
                alignItems: "center",
              }}
            >
              <span style={{ fontSize: 10, color: "#374151" }}>Detected:</span>
              {detectedCols.slice(0, 8).map((c) => (
                <button
                  key={c}
                  onClick={() => handleColChange(c)}
                  style={{
                    fontSize: 10,
                    fontFamily: "'DM Mono', monospace",
                    color:
                      c.toLowerCase() === colName.toLowerCase()
                        ? "#818cf8"
                        : "#4b5563",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    padding: "1px 3px",
                    textDecoration:
                      c.toLowerCase() === colName.toLowerCase()
                        ? "underline"
                        : "none",
                  }}
                >
                  {c}
                </button>
              ))}
              {detectedCols.length > 8 && (
                <span style={{ fontSize: 10, color: "#374151" }}>
                  +{detectedCols.length - 8}
                </span>
              )}
            </div>
          )}
        </div>

        {/* PDF identifier column selector */}
        <div className="card" style={{ marginBottom: 14 }}>
          <div
            style={{
              fontSize: 10,
              fontWeight: 600,
              color: "#4b5563",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              marginBottom: 8,
            }}
          >
            Identifier column header in PDF{" "}
            <span style={{ fontWeight: 400, textTransform: "none", color: "#374151" }}>
              (optional — restricts matching to that column only)
            </span>
          </div>
          <input
            value={pdfColName}
            onChange={(e) => setPdfColName(e.target.value)}
            placeholder="e.g. Product Code, Kod Produk, Identifier…"
          />
          <div
            style={{
              marginTop: 8,
              display: "flex",
              gap: 5,
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
            <span style={{ fontSize: 10, color: "#374151" }}>Suggestions:</span>
            {["Product Code", "Kod Produk", "Product Name", "Nama Produk", "Identifier", "Pengenal"].map((s) => (
              <button
                key={s}
                onClick={() => setPdfColName(s)}
                style={{
                  fontSize: 10,
                  fontFamily: "'DM Mono', monospace",
                  color: pdfColName === s ? "#818cf8" : "#4b5563",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: "1px 3px",
                  textDecoration: pdfColName === s ? "underline" : "none",
                }}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* Stats */}
        {(isProcessing || isDone) && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, 1fr)",
              gap: 8,
              marginBottom: 14,
            }}
          >
            {(
              [
                { label: "Rows", value: stats.rows, color: undefined },
                { label: "Pages", value: stats.pages, color: undefined },
                { label: "Matched", value: stats.matched, color: "#4ade80" },
                {
                  label: "Not found",
                  value: stats.unmatched,
                  color: stats.unmatched > 0 ? "#fbbf24" : undefined,
                },
              ] as { label: string; value: number; color?: string }[]
            ).map((s) => (
              <div key={s.label} className="stat">
                <div
                  style={{ fontSize: 11, color: "#4b5563", marginBottom: 3 }}
                >
                  {s.label}
                </div>
                <div
                  style={{
                    fontSize: 20,
                    fontWeight: 600,
                    color: s.color ?? "#e2e8f0",
                  }}
                >
                  {s.value}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Ready summary */}
        {canProcess && !isProcessing && !isDone && (
          <div
            style={{
              background: "rgba(99,102,241,0.06)",
              border: "1px solid rgba(99,102,241,0.2)",
              borderRadius: 10,
              padding: "10px 14px",
              marginBottom: 14,
              fontSize: 13,
              color: "#818cf8",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <div
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "#6366f1",
                flexShrink: 0,
              }}
            />
            Ready —{" "}
            <strong style={{ color: "#e2e8f0" }}>{xlsxFiles[0]?.name}</strong> ×{" "}
            <strong style={{ color: "#e2e8f0" }}>
              {pdfFiles.length} PDF{pdfFiles.length > 1 ? "s" : ""}
            </strong>{" "}
            using column{" "}
            <code
              style={{
                fontSize: 11,
                background: "rgba(255,255,255,0.06)",
                padding: "1px 5px",
                borderRadius: 4,
              }}
            >
              {colName}
            </code>
          </div>
        )}

        {/* Actions */}
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <button
            className="btn btn-primary"
            onClick={handleProcess}
            disabled={isProcessing || !canProcess}
            style={{ flex: 1 }}
          >
            {isProcessing ? `Processing… ${progress}%` : "⚡ Process files"}
          </button>
          <button className="btn btn-ghost" onClick={reset}>
            ↺ Reset
          </button>
        </div>

        {/* Progress bar */}
        {isProcessing && (
          <div
            style={{
              height: 3,
              background: "#1f2937",
              borderRadius: 2,
              overflow: "hidden",
              marginBottom: 14,
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${progress}%`,
                background: "linear-gradient(90deg,#6366f1,#8b5cf6)",
                borderRadius: 2,
                transition: "width 0.4s ease",
              }}
            />
          </div>
        )}

        {/* Log */}
        {logs.length > 0 && (
          <div className="card" style={{ marginBottom: 14 }}>
            <div
              style={{
                fontSize: 10,
                fontWeight: 600,
                color: "#374151",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                marginBottom: 10,
              }}
            >
              Log
            </div>
            <div ref={logRef} style={{ maxHeight: 180, overflowY: "auto" }}>
              {logs.map((l, i) => (
                <div
                  key={i}
                  style={{
                    fontSize: 12,
                    fontFamily: "'DM Mono', monospace",
                    display: "flex",
                    gap: 8,
                    padding: "1px 0",
                    lineHeight: 1.7,
                    color: logColor(l.level),
                  }}
                >
                  <span style={{ color: "#1f2937", flexShrink: 0 }}>
                    {l.time}
                  </span>
                  {l.msg}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Preview */}
        {preview.length > 0 && (
          <div
            className="card"
            style={{ marginBottom: 14, padding: 0, overflow: "hidden" }}
          >
            <div
              style={{
                padding: "10px 14px",
                borderBottom: "1px solid #1a1f2e",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  color: "#374151",
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                }}
              >
                Preview — first {preview.length} rows
              </div>
              <span style={{ fontSize: 10, color: "#374151" }}>
                5 new columns highlighted
              </span>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: 11,
                }}
              >
                <thead>
                  <tr style={{ background: "rgba(255,255,255,0.02)" }}>
                    {previewHeaders.map((h) => (
                      <th
                        key={h}
                        style={{
                          padding: "7px 10px",
                          textAlign: "left",
                          fontWeight: 500,
                          borderBottom: "1px solid #1a1f2e",
                          whiteSpace: "nowrap",
                          color: NEW_COLS.includes(h) ? "#818cf8" : "#4b5563",
                          background: NEW_COLS.includes(h)
                            ? "rgba(99,102,241,0.08)"
                            : undefined,
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.map((row, ri) => (
                    <tr
                      key={ri}
                      style={{
                        borderBottom:
                          ri < preview.length - 1
                            ? "1px solid #0d1117"
                            : "none",
                      }}
                    >
                      {previewHeaders.map((h) => (
                        <td
                          key={h}
                          style={{
                            padding: "7px 10px",
                            whiteSpace: "nowrap",
                            maxWidth: 160,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            color: NEW_COLS.includes(h)
                              ? row[h]
                                ? "#a5b4fc"
                                : "#374151"
                              : "#9ca3af",
                            fontFamily: ["Registration No", "Page No"].includes(
                              h,
                            )
                              ? "'DM Mono', monospace"
                              : "inherit",
                            fontStyle:
                              NEW_COLS.includes(h) && !row[h]
                                ? "italic"
                                : "normal",
                            background: NEW_COLS.includes(h)
                              ? "rgba(99,102,241,0.04)"
                              : undefined,
                          }}
                        >
                          {row[h] !== undefined && row[h] !== ""
                            ? String(row[h])
                            : "—"}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Download */}
        {isDone && downloadUrl && (
          <a
            href={downloadUrl}
            download={downloadName}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              padding: "11px",
              borderRadius: 10,
              background: "linear-gradient(135deg,#6366f1,#8b5cf6)",
              color: "#fff",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            ⬇ Download {downloadName}
          </a>
        )}

        {/* How it works */}
        {status === STATUS.IDLE && (
          <div className="card" style={{ marginTop: 8 }}>
            <div
              style={{
                fontSize: 10,
                fontWeight: 600,
                color: "#374151",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                marginBottom: 12,
              }}
            >
              How it works
            </div>
            {(
              [
                [
                  "📊",
                  "Upload your product spreadsheet",
                  "All original columns are preserved. Auto-detects the product code column.",
                ],
                [
                  "📄",
                  "Upload MDA certificate PDFs",
                  "Multiple PDFs supported. Each can have hundreds of pages.",
                ],
                [
                  "🔍",
                  "Exact match, case-insensitive",
                  "Runs in a background thread — your browser stays responsive.",
                ],
                [
                  "⬇",
                  "Download enriched output",
                  "Adds: Registration No, Page No, Valid From, Expired On, PDF File.",
                ],
              ] as [string, string, string][]
            ).map(([icon, title, desc], i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  gap: 10,
                  marginBottom: i < 3 ? 10 : 0,
                }}
              >
                <span style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>
                  {icon}
                </span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{title}</div>
                  <div
                    style={{
                      fontSize: 12,
                      color: "#4b5563",
                      marginTop: 2,
                      lineHeight: 1.5,
                    }}
                  >
                    {desc}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
