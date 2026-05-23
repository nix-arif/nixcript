"use client";

import { useState, useRef } from "react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import {
  UploadIcon,
  FileSpreadsheetIcon,
  XIcon,
  InfoIcon,
  ShieldCheckIcon,
  CheckCircle2Icon,
  CircleIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getProductDetailsByCodes } from "@/server/products";

type ParsedRow = {
  no: number;
  productCode: string;
};

type ProductDetail = {
  productCode: string;
  description: string | null;
  mdaRegistrationNo: string | null;
  mdaValidFrom: string | null;
  mdaExpiredOn: string | null;
  hasPdf: string | null;
};

function extractProductCode(row: Record<string, any>): string {
  const normalize = (k: string) => k.toLowerCase().replace(/[\s_\-]/g, "");
  const targets = new Set(["productcode", "code", "itemcode", "kodproduk"]);
  for (const k of Object.keys(row)) {
    if (targets.has(normalize(k)) && row[k] !== undefined && row[k] !== "") {
      return String(row[k]).trim();
    }
  }
  return "";
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function MdaCertGeneratorClient() {
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [details, setDetails] = useState<Map<string, ProductDetail>>(new Map());
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (f: File) => {
    setFile(f);
    setRows([]);
    setDetails(new Map());
    setError(null);
    setLoading(true);
    try {
      const buf = await f.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json(ws, { defval: "" }) as Record<string, any>[];
      const parsed: ParsedRow[] = raw
        .map((row, i) => ({ no: i + 1, productCode: extractProductCode(row) }))
        .filter((r) => r.productCode);
      if (!parsed.length)
        throw new Error("No valid product codes found — make sure there is a 'product code' column");
      setRows(parsed);

      // Fetch details from DB
      const codes = [...new Set(parsed.map((r) => r.productCode))];
      const dbRows = await getProductDetailsByCodes(codes);
      setDetails(new Map(dbRows.map((r) => [r.productCode, r])));
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

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/products/mda-cert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Failed to generate MDA certificates");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "mda-certificates.pdf";
      a.click();
      URL.revokeObjectURL(url);
      toast.success("MDA certificates downloaded");
    } catch (e: any) {
      setError(e.message);
      toast.error(e.message);
    } finally {
      setGenerating(false);
    }
  };

  const reset = () => {
    setFile(null);
    setRows([]);
    setDetails(new Map());
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const withCert = rows.filter((r) => details.get(r.productCode)?.hasPdf).length;
  const uniqueCodes = new Set(rows.map((r) => r.productCode)).size;

  return (
    <div className="p-6 max-w-4xl">
      <PageHeader
        title="MDA Certificate Generator"
        description="Upload a spreadsheet with product codes to generate a merged MDA certificate PDF with highlighted rows"
      />

      {error && (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-destructive/10 border border-destructive/20 text-sm text-destructive mb-4">
          <InfoIcon className="w-4 h-4 mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 mb-3">
        {/* Upload zone */}
        <div
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
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
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
          />
          <div className="w-11 h-11 rounded-full bg-muted flex items-center justify-center">
            <FileSpreadsheetIcon className="w-5 h-5 text-muted-foreground" />
          </div>
          <div>
            <div className="text-sm font-medium">
              {loading ? "Reading file…" : file ? "Change file" : "Click or drag & drop"}
            </div>
            <div className="text-xs text-muted-foreground mt-1">.xlsx · .xls · .csv</div>
          </div>
          <div className="text-xs text-muted-foreground/70">Needs a "product code" column</div>
        </div>

        {/* File info */}
        {!file ? (
          <div className="border border-dashed border-border rounded-xl flex items-center justify-center p-7 text-center">
            <div className="text-xs text-muted-foreground/50">File details will appear here</div>
          </div>
        ) : (
          <div className="bg-background border border-green-200 dark:border-green-800 rounded-xl p-5 flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-green-50 dark:bg-green-900/30 flex items-center justify-center shrink-0">
                <FileSpreadsheetIcon className="w-4 h-4 text-green-600 dark:text-green-400" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{file.name}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{rows.length} rows · {uniqueCodes} unique product codes</div>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); reset(); }}
                className="text-muted-foreground hover:text-foreground transition-colors p-1"
                aria-label="Remove file"
              >
                <XIcon className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-muted/40 rounded-lg p-3">
                <div className="text-xs text-muted-foreground mb-1">With MDA cert</div>
                <div className="text-2xl font-semibold text-green-600 dark:text-green-400">{withCert}</div>
              </div>
              <div className="bg-muted/40 rounded-lg p-3">
                <div className="text-xs text-muted-foreground mb-1">No cert PDF</div>
                <div className={cn("text-2xl font-semibold", rows.length - withCert > 0 ? "text-amber-600 dark:text-amber-400" : "")}>
                  {rows.length - withCert}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Detail table */}
      {rows.length > 0 && (
        <div className="bg-background border border-border rounded-xl overflow-hidden mb-3">
          <div className="px-4 py-2.5 border-b border-border bg-muted/20 flex items-center justify-between">
            <div className="text-xs font-medium text-muted-foreground">
              {loading ? "Loading product details…" : `${rows.length} rows`}
            </div>
            <div className="text-xs text-muted-foreground">
              {withCert} with MDA cert PDF
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-muted/20">
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground border-b border-border w-10">No.</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground border-b border-border w-28">Product Code</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground border-b border-border">Description</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground border-b border-border w-36">Certificate No.</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground border-b border-border w-24">Valid From</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground border-b border-border w-24">Expires</th>
                  <th className="px-3 py-2 text-center font-medium text-muted-foreground border-b border-border w-12">PDF</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => {
                  const d = details.get(row.productCode);
                  return (
                    <tr key={i} className={cn(i < rows.length - 1 ? "border-b border-border" : "", !d?.hasPdf && "opacity-50")}>
                      <td className="px-3 py-2 text-muted-foreground tabular-nums">{row.no}</td>
                      <td className="px-3 py-2 font-mono font-medium">{row.productCode}</td>
                      <td className="px-3 py-2 text-muted-foreground max-w-50 truncate">
                        {d?.description ?? <span className="italic text-muted-foreground/40">—</span>}
                      </td>
                      <td className="px-3 py-2 font-mono text-blue-600 dark:text-blue-400">
                        {d?.mdaRegistrationNo ?? <span className="italic text-muted-foreground/40 font-sans">—</span>}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground tabular-nums">{formatDate(d?.mdaValidFrom ?? null)}</td>
                      <td className="px-3 py-2 text-muted-foreground tabular-nums">{formatDate(d?.mdaExpiredOn ?? null)}</td>
                      <td className="px-3 py-2 text-center">
                        {d?.hasPdf
                          ? <CheckCircle2Icon className="w-3.5 h-3.5 text-green-500 inline" />
                          : <CircleIcon className="w-3.5 h-3.5 text-muted-foreground/30 inline" />
                        }
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Action bar */}
      {rows.length > 0 && (
        <div className="flex items-center justify-between p-4 bg-background border border-border rounded-xl">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <InfoIcon className="w-3.5 h-3.5 shrink-0" />
            {withCert > 0
              ? `${withCert} product${withCert > 1 ? "s" : ""} will be included in the PDF`
              : "No products have MDA certificate data — seed the products first"}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={reset} disabled={generating}>Cancel</Button>
            <Button
              size="sm"
              onClick={handleGenerate}
              disabled={generating || withCert === 0}
              className="gap-2 min-w-44"
            >
              {generating ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                  Generating…
                </>
              ) : (
                <>
                  <ShieldCheckIcon className="w-3.5 h-3.5" />
                  Generate MDA Certificates
                </>
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
