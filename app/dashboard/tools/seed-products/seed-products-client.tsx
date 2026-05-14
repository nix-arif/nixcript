"use client";

import { useState, useRef } from "react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { seedProducts } from "@/server/products";
import { Button } from "@/components/ui/button";
import {
  UploadIcon,
  FileSpreadsheetIcon,
  DatabaseIcon,
  XIcon,
  InfoIcon,
  CheckCircleIcon,
  RefreshCwIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

type ProductRow = {
  productCode: string;
  description?: string;
  unitPrice?: string;
  uom?: string;
  supplier?: string;
  brand?: string;
  registrationNo?: string;
  pageNo?: string;
  validFrom?: string;
  expiredOn?: string;
  pdfFile?: string;
  matchX?: string;
  matchY?: string;
  rowHeight?: string;
  pageWidth?: string;
  pageHeight?: string;
};

type SeedResult = { inserted: number; updated: number; total: number };

function mapRow(row: Record<string, any>): ProductRow {
  const get = (...keys: string[]) => {
    for (const key of keys) {
      const found = Object.keys(row).find(
        (k) =>
          k.toLowerCase().replace(/[\s_\-]/g, "") ===
          key.toLowerCase().replace(/[\s_\-]/g, ""),
      );
      if (
        found !== undefined &&
        row[found] !== undefined &&
        row[found] !== ""
      ) {
        return String(row[found]).trim();
      }
    }
    return undefined;
  };

  return {
    productCode:
      get("productcode", "product code", "code", "item code", "kod produk") ??
      "",
    description: get("description", "desc", "name", "item name"),
    unitPrice: get("unitprice", "unit price", "price", "harga"),
    uom: get("uom", "oum", "unit", "unit of measure"),
    supplier: get("supplier", "vendor", "pembekal"),
    brand: get("brand", "jenama", "make"),
    registrationNo: get(
      "registrationno",
      "registration no",
      "no pendaftaran",
      "reg no",
    ),
    pageNo: get("pageno", "page no", "page", "halaman"),
    validFrom: get("validfrom", "valid from", "tarikh mula"),
    expiredOn: get("expiredon", "expired on", "expiry", "tarikh luput"),
    pdfFile: get("pdffile", "pdf file", "pdf", "file"),
    matchX: get("matchx", "match x", "x"),
    matchY: get("matchy", "match y", "y"),
    rowHeight: get("rowheight", "row height", "height"),
    pageWidth: get("pagewidth", "page width", "width"),
    pageHeight: get("pageheight", "page height"),
  };
}

const PREVIEW_COLS = [
  {
    key: "productCode" as keyof ProductRow,
    label: "Product code",
    mono: true,
    width: "w-28",
  },
  {
    key: "description" as keyof ProductRow,
    label: "Description",
    mono: false,
    width: "w-48",
  },
  {
    key: "unitPrice" as keyof ProductRow,
    label: "Price",
    mono: false,
    width: "w-20",
  },
  {
    key: "registrationNo" as keyof ProductRow,
    label: "Reg. no",
    mono: true,
    width: "w-36",
  },
  {
    key: "validFrom" as keyof ProductRow,
    label: "Valid from",
    mono: false,
    width: "w-24",
  },
  {
    key: "expiredOn" as keyof ProductRow,
    label: "Expired on",
    mono: false,
    width: "w-24",
  },
];

export function SeedProductsClient() {
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [result, setResult] = useState<SeedResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const [seedProgress, setSeedProgress] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (f: File) => {
    setFile(f);
    setRows([]);
    setResult(null);
    setError(null);
    setLoading(true);
    try {
      const buf = await f.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json(ws, { defval: "" }) as Record<
        string,
        any
      >[];
      const mapped = raw.map(mapRow).filter((r) => r.productCode);
      if (!mapped.length)
        throw new Error(
          "No valid rows found — make sure the file has a 'product code' column",
        );
      setRows(mapped);
    } catch (e: any) {
      setError(e.message);
      setFile(null);
    } finally {
      setLoading(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDrag(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  };

  // seed-products-client.tsx — replace handleSeed
  const handleSeed = async () => {
    setSeeding(true);
    setError(null);
    setSeedProgress(0);

    try {
      const BATCH_SIZE = 500; // 500 rows per request — still under 1MB
      let total = 0;
      const totalBatches = Math.ceil(rows.length / BATCH_SIZE);

      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const batch = rows.slice(i, i + BATCH_SIZE);
        const batchNum = Math.floor(i / BATCH_SIZE) + 1;

        const res = await fetch("/api/products/seed", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rows: batch }),
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error ?? "Seed failed");
        }

        const data = await res.json();
        total += data.total;
        setSeedProgress(Math.round((batchNum / totalBatches) * 100));
      }

      setResult({ inserted: total, updated: 0, total });
      toast.success(`Done — ${total} rows seeded`);
    } catch (e: any) {
      setError(e.message);
      toast.error(e.message);
    } finally {
      setSeeding(false);
      setSeedProgress(0);
    }
  };

  const reset = () => {
    setFile(null);
    setRows([]);
    setResult(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const matched = rows.filter((r) => r.registrationNo).length;
  const unmatched = rows.length - matched;

  // ── Success state ──────────────────────────────────────────────────────────
  if (result) {
    return (
      <div className="p-6 max-w-3xl">
        <div className="mb-6">
          <h1 className="text-xl font-semibold tracking-tight">
            Seed products
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Upload the MDA matcher output to seed product & certificate data
            into the database.
          </p>
        </div>

        <div className="bg-background border border-border rounded-xl overflow-hidden">
          <div className="p-6 flex items-start gap-4 border-b border-border">
            <div className="w-10 h-10 rounded-full bg-green-50 dark:bg-green-900/30 flex items-center justify-center shrink-0">
              <CheckCircleIcon className="w-5 h-5 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <div className="font-medium text-sm">Seeding complete</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {result.total} rows processed successfully
              </div>
            </div>
          </div>
          <div className="grid grid-cols-3 divide-x divide-border">
            {[
              { label: "Total processed", value: result.total, color: "" },
              {
                label: "Inserted",
                value: result.inserted,
                color: "text-green-600 dark:text-green-400",
              },
              {
                label: "Updated",
                value: result.updated,
                color: "text-blue-600 dark:text-blue-400",
              },
            ].map((s) => (
              <div key={s.label} className="p-5 text-center">
                <div className="text-xs text-muted-foreground mb-1.5">
                  {s.label}
                </div>
                <div className={cn("text-3xl font-semibold", s.color)}>
                  {s.value}
                </div>
              </div>
            ))}
          </div>
          <div className="p-4 border-t border-border bg-muted/20">
            <Button variant="outline" onClick={reset} className="gap-2">
              <UploadIcon className="w-3.5 h-3.5" /> Upload another file
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">Seed products</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Upload the MDA matcher output to seed product & certificate data into
          the database.
        </p>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-destructive/10 border border-destructive/20 text-sm text-destructive mb-4">
          <InfoIcon className="w-4 h-4 mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      {/* Top row — upload zone + file info */}
      <div className="grid grid-cols-2 gap-3 mb-3">
        {/* Upload zone */}
        <div
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={handleDrop}
          className={cn(
            "border-2 border-dashed rounded-xl p-7 flex flex-col items-center justify-center gap-3 cursor-pointer transition-all text-center",
            drag
              ? "border-primary bg-primary/5"
              : file
                ? "border-border bg-muted/10 opacity-60 hover:opacity-100"
                : "border-border hover:border-primary/40 hover:bg-muted/20",
          )}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
          />
          <div className="w-11 h-11 rounded-full bg-muted flex items-center justify-center">
            <FileSpreadsheetIcon className="w-5 h-5 text-muted-foreground" />
          </div>
          <div>
            <div className="text-sm font-medium">
              {loading
                ? "Reading file…"
                : file
                  ? "Change file"
                  : "Click or drag & drop"}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              .xlsx · .xls · .csv
            </div>
          </div>
          <div className="text-xs text-muted-foreground/70">
            Output from MDA Certificate Matcher
          </div>
        </div>

        {/* File info card */}
        {!file ? (
          <div className="border border-dashed border-border rounded-xl flex items-center justify-center p-7 text-center">
            <div className="text-xs text-muted-foreground/50">
              File details will appear here
            </div>
          </div>
        ) : (
          <div className="bg-background border border-green-200 dark:border-green-800 rounded-xl p-5 flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-green-50 dark:bg-green-900/30 flex items-center justify-center shrink-0">
                <FileSpreadsheetIcon className="w-4 h-4 text-green-600 dark:text-green-400" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{file.name}</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {rows.length} rows detected
                </div>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  reset();
                }}
                className="text-muted-foreground hover:text-foreground transition-colors p-1"
                aria-label="Remove file"
              >
                <XIcon className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-muted/40 rounded-lg p-3">
                <div className="text-xs text-muted-foreground mb-1">
                  With certificate
                </div>
                <div className="text-2xl font-semibold text-green-600 dark:text-green-400">
                  {matched}
                </div>
              </div>
              <div className="bg-muted/40 rounded-lg p-3">
                <div className="text-xs text-muted-foreground mb-1">
                  Without certificate
                </div>
                <div
                  className={cn(
                    "text-2xl font-semibold",
                    unmatched > 0 ? "text-amber-600 dark:text-amber-400" : "",
                  )}
                >
                  {unmatched}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Preview table */}
      {rows.length > 0 && (
        <div className="bg-background border border-border rounded-xl overflow-hidden mb-3">
          <div className="px-4 py-2.5 border-b border-border bg-muted/20 flex items-center justify-between">
            <div className="text-xs font-medium text-muted-foreground">
              Preview — first {Math.min(rows.length, 5)} of {rows.length} rows
            </div>
            <div className="text-xs text-muted-foreground">
              Coordinate columns hidden
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-muted/20">
                  {PREVIEW_COLS.map((col) => (
                    <th
                      key={col.key}
                      className={cn(
                        "px-3 py-2 text-left font-medium text-muted-foreground border-b border-border whitespace-nowrap",
                        col.width,
                      )}
                    >
                      {col.label}
                    </th>
                  ))}
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground border-b border-border w-20">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 5).map((row, i) => (
                  <tr
                    key={i}
                    className={
                      i < Math.min(rows.length, 5) - 1
                        ? "border-b border-border"
                        : ""
                    }
                  >
                    {PREVIEW_COLS.map((col) => (
                      <td
                        key={col.key}
                        className={cn(
                          "px-3 py-2 whitespace-nowrap overflow-hidden text-ellipsis",
                          col.mono ? "font-mono" : "",
                          col.key === "productCode"
                            ? "font-medium text-foreground"
                            : col.key === "registrationNo" && row[col.key]
                              ? "text-blue-600 dark:text-blue-400"
                              : "text-muted-foreground",
                          !row[col.key] && "text-muted-foreground/40 italic",
                          col.width,
                        )}
                      >
                        {row[col.key] || "—"}
                      </td>
                    ))}
                    <td className="px-3 py-2">
                      {row.registrationNo ? (
                        <span className="inline-flex items-center text-[10px] font-medium bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800 rounded-md px-2 py-0.5">
                          Matched
                        </span>
                      ) : (
                        <span className="inline-flex items-center text-[10px] font-medium bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800 rounded-md px-2 py-0.5">
                          No match
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2 border-t border-border bg-muted/10 flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              Showing {Math.min(rows.length, 5)} of {rows.length} rows
            </span>
            <span className="text-xs text-muted-foreground">
              {matched} matched · {unmatched} unmatched
            </span>
          </div>
        </div>
      )}

      {/* Footer action bar */}
      {rows.length > 0 && (
        <div className="flex items-center justify-between p-4 bg-background border border-border rounded-xl">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <InfoIcon className="w-3.5 h-3.5 shrink-0" />
            Existing product codes will be updated · New ones will be inserted
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={reset}
              disabled={seeding}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSeed}
              disabled={seeding}
              className="gap-2 min-w-36"
            >
              {seeding ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                  {seedProgress > 0 ? `Seeding… ${seedProgress}%` : "Starting…"}
                </>
              ) : (
                <>
                  <DatabaseIcon className="w-3.5 h-3.5" />
                  Seed {rows.length.toLocaleString()} rows to database
                </>
              )}
            </Button>
            {seeding && seedProgress > 0 && (
              <div className="mt-3">
                <div className="flex justify-between text-xs text-muted-foreground mb-1.5">
                  <span>
                    Seeding {rows.length.toLocaleString()} rows in batches of
                    500
                  </span>
                  <span>{seedProgress}%</span>
                </div>
                <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full transition-all duration-300"
                    style={{ width: `${seedProgress}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
