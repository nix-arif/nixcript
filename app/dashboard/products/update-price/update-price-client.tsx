"use client";

import { useState, useRef } from "react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import {
  UploadIcon, FileSpreadsheetIcon, XIcon, InfoIcon, CheckCircleIcon,
  AlertCircleIcon, DownloadIcon, RefreshCwIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getProductPriceDetails, updateProductSellingPrices } from "@/server/products";

type ParsedRow = {
  productCode: string;
  newPrice: string;
  currency: string;
};

type ProductDetail = {
  productCode: string;
  description: string | null;
  sellingUnitPrice: string | null;
  uom: string | null;
};

const CURRENCIES = ["MYR", "USD", "SGD", "EUR", "GBP", "AUD", "JPY"];

function normalizeKey(k: string) {
  return k.toLowerCase().replace(/[\s_\-\.]/g, "");
}

function extractField(row: Record<string, any>, targets: string[]): string {
  const set = new Set(targets);
  for (const k of Object.keys(row)) {
    if (set.has(normalizeKey(k)) && row[k] !== undefined && row[k] !== "") {
      return String(row[k]).trim();
    }
  }
  return "";
}

export function UpdatePriceClient() {
  const [file, setFile]       = useState<File | null>(null);
  const [rows, setRows]       = useState<ParsedRow[]>([]);
  const [details, setDetails] = useState<Map<string, ProductDetail>>(new Map());
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [drag, setDrag]       = useState(false);
  const [applied, setApplied] = useState(false);
  const [result, setResult]   = useState<{ updated: number; notFound: string[] } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(f: File) {
    setFile(f);
    setRows([]);
    setDetails(new Map());
    setError(null);
    setApplied(false);
    setResult(null);
    setLoading(true);
    try {
      const buf = await f.arrayBuffer();
      const wb  = XLSX.read(buf, { type: "array" });
      const ws  = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json(ws, { defval: "" }) as Record<string, any>[];

      const parsed: ParsedRow[] = raw.map((row) => {
        const productCode = extractField(row, ["productcode", "code", "itemcode", "kodproduk", "productno"]);
        const rawPrice    = extractField(row, ["sellingprice", "sellingunitprice", "unitprice", "price", "harga", "saleprice"]);
        const currency    = extractField(row, ["currency", "matawang", "ccy"]) || "MYR";
        const priceNum    = parseFloat(rawPrice.replace(/[^0-9.]/g, ""));
        return { productCode, newPrice: isNaN(priceNum) ? "" : priceNum.toFixed(2), currency };
      }).filter((r) => r.productCode && r.newPrice);

      if (!parsed.length)
        throw new Error("No valid rows found — spreadsheet needs a 'product code' column and a 'selling price' / 'price' column");

      setRows(parsed);
      const codes = [...new Set(parsed.map((r) => r.productCode))];
      const dbRows = await getProductPriceDetails(codes);
      setDetails(new Map(dbRows.map((r) => [r.productCode, r])));
    } catch (e: any) {
      setError(e.message);
      setFile(null);
    } finally {
      setLoading(false);
    }
  }

  async function handleApply() {
    const valid = rows.filter((r) => r.newPrice && parseFloat(r.newPrice) > 0);
    if (!valid.length) { toast.error("No valid prices to apply"); return; }
    setApplying(true);
    try {
      const res = await updateProductSellingPrices(
        valid.map((r) => ({ productCode: r.productCode, sellingUnitPrice: r.newPrice, currency: r.currency })),
      );
      setResult(res);
      setApplied(true);
      toast.success(`Updated ${res.updated} product${res.updated !== 1 ? "s" : ""}`);
      if (res.notFound.length) toast.warning(`${res.notFound.length} product code${res.notFound.length !== 1 ? "s" : ""} not found in database`);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setApplying(false);
    }
  }

  function handleExportTemplate() {
    const ws = XLSX.utils.aoa_to_sheet([
      ["Product Code", "Selling Price", "Currency"],
      ["SAMPLE001", "125.00", "MYR"],
      ["SAMPLE002", "88.50", "MYR"],
    ]);
    ws["!cols"] = [{ wch: 20 }, { wch: 16 }, { wch: 10 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Price Update");
    XLSX.writeFile(wb, "price-update-template.xlsx");
    toast.success("Template downloaded");
  }

  function reset() {
    setFile(null); setRows([]); setDetails(new Map()); setError(null);
    setApplied(false); setResult(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  const matchedRows  = rows.filter((r) => details.has(r.productCode));
  const unmatchedRows = rows.filter((r) => !details.has(r.productCode));
  const validPrices  = rows.filter((r) => r.newPrice && parseFloat(r.newPrice) > 0).length;

  return (
    <div className="p-6 max-w-5xl">
      <PageHeader
        title="Update Selling Price"
        description="Download the template, fill in the prices, then upload the completed file."
      />

      {/* ── Template guide ── */}
      {!file && (
        <div className="border border-border rounded-xl overflow-hidden mb-5">
          <div className="flex items-center justify-between px-4 py-3 bg-muted/30 border-b border-border">
            <div>
              <div className="text-sm font-semibold">Step 1 — Download the template</div>
              <div className="text-xs text-muted-foreground mt-0.5">Fill in the selling prices, then upload the completed file below.</div>
            </div>
            <Button size="sm" className="gap-1.5 shrink-0" onClick={handleExportTemplate}>
              <DownloadIcon className="w-3.5 h-3.5" /> Download Template (.xlsx)
            </Button>
          </div>
          {/* Format preview */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-muted/20 border-b border-border">
                  <th className="px-4 py-2 text-left font-semibold text-foreground">Product Code</th>
                  <th className="px-4 py-2 text-left font-semibold text-foreground">Selling Price</th>
                  <th className="px-4 py-2 text-left font-semibold text-foreground">Currency</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {[
                  { code: "BMS-001", price: "125.00", ccy: "MYR" },
                  { code: "BMS-002", price: "88.50",  ccy: "MYR" },
                  { code: "BMS-003", price: "210.00", ccy: "MYR" },
                ].map((row) => (
                  <tr key={row.code} className="text-muted-foreground">
                    <td className="px-4 py-2 font-mono">{row.code}</td>
                    <td className="px-4 py-2 tabular-nums">{row.price}</td>
                    <td className="px-4 py-2">{row.ccy}</td>
                  </tr>
                ))}
                <tr className="text-muted-foreground/40 italic">
                  <td className="px-4 py-2 font-mono">…</td>
                  <td className="px-4 py-2">…</td>
                  <td className="px-4 py-2">…</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2.5 border-t border-border bg-muted/10 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1"><InfoIcon className="w-3 h-3 shrink-0" /><strong className="text-foreground">Product Code</strong> — must match exactly what is in the system</span>
            <span><strong className="text-foreground">Selling Price</strong> — numeric value, e.g. 125.00</span>
            <span><strong className="text-foreground">Currency</strong> — optional, defaults to MYR</span>
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-destructive/10 border border-destructive/20 text-sm text-destructive mb-4">
          <AlertCircleIcon className="w-4 h-4 mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      {applied && result && (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-sm text-green-700 dark:text-green-400 mb-4">
          <CheckCircleIcon className="w-4 h-4 mt-0.5 shrink-0" />
          <div>
            <span className="font-semibold">{result.updated} product{result.updated !== 1 ? "s" : ""} updated.</span>
            {result.notFound.length > 0 && (
              <span className="text-green-600 dark:text-green-500 ml-1.5">
                {result.notFound.length} code{result.notFound.length !== 1 ? "s" : ""} not found: {result.notFound.slice(0, 5).join(", ")}{result.notFound.length > 5 ? "…" : ""}
              </span>
            )}
          </div>
        </div>
      )}

      {/* ── Step 2 label ── */}
      {!file && (
        <div className="text-sm font-semibold mb-2">Step 2 — Upload the completed file</div>
      )}

      <div className="grid grid-cols-2 gap-3 mb-4">
        {/* Upload zone */}
        <div
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
          className={cn(
            "border-2 border-dashed rounded-xl p-7 flex flex-col items-center justify-center gap-3 cursor-pointer transition-all text-center",
            drag ? "border-primary bg-primary/5" : file ? "border-border bg-muted/10 opacity-60 hover:opacity-100" : "border-border hover:border-primary/40 hover:bg-muted/20",
          )}
        >
          <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
          <div className="w-11 h-11 rounded-full bg-muted flex items-center justify-center">
            <FileSpreadsheetIcon className="w-5 h-5 text-muted-foreground" />
          </div>
          <div>
            <div className="text-sm font-medium">{loading ? "Reading file…" : file ? "Change file" : "Click or drag & drop"}</div>
            <div className="text-xs text-muted-foreground mt-1">.xlsx · .xls · .csv</div>
          </div>
          <div className="text-xs text-muted-foreground/70">Needs "product code" + "selling price" columns</div>
        </div>

        {/* Summary card */}
        {!file ? (
          <div className="border border-dashed border-border rounded-xl flex items-center justify-center p-7 text-center">
            <div className="text-xs text-muted-foreground/50">Upload a file to preview changes</div>
          </div>
        ) : (
          <div className="bg-background border border-green-200 dark:border-green-800 rounded-xl p-5 flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-green-50 dark:bg-green-900/30 flex items-center justify-center shrink-0">
                <FileSpreadsheetIcon className="w-4 h-4 text-green-600 dark:text-green-400" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{file.name}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{rows.length} rows · {validPrices} with valid prices</div>
              </div>
              <button onClick={(e) => { e.stopPropagation(); reset(); }} className="text-muted-foreground hover:text-foreground p-1">
                <XIcon className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="bg-muted/40 rounded-lg p-3">
                <div className="text-xs text-muted-foreground mb-1">Matched</div>
                <div className="text-xl font-semibold text-green-600 dark:text-green-400">{matchedRows.length}</div>
              </div>
              <div className="bg-muted/40 rounded-lg p-3">
                <div className="text-xs text-muted-foreground mb-1">Not found</div>
                <div className={cn("text-xl font-semibold", unmatchedRows.length > 0 ? "text-amber-600 dark:text-amber-400" : "")}>
                  {unmatchedRows.length}
                </div>
              </div>
              <div className="bg-muted/40 rounded-lg p-3">
                <div className="text-xs text-muted-foreground mb-1">Total</div>
                <div className="text-xl font-semibold">{rows.length}</div>
              </div>
            </div>
          </div>
        )}
      </div>

      {rows.length > 0 && (
        <>
          <div className="bg-background border border-border rounded-xl overflow-hidden mb-3">
            <div className="px-4 py-2.5 border-b border-border bg-muted/20 flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">{rows.length} rows from file</span>
              <span className="text-xs text-muted-foreground">{matchedRows.length} matched · {unmatchedRows.length} not found</span>
            </div>
            <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted/30">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground border-b border-border w-10">#</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground border-b border-border">Product Code</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground border-b border-border">Description</th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground border-b border-border w-28">Current Price</th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground border-b border-border w-28">New Price</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground border-b border-border w-14">CCY</th>
                    <th className="px-3 py-2 text-center font-medium text-muted-foreground border-b border-border w-20">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => {
                    const d = details.get(row.productCode);
                    const unchanged = d?.sellingUnitPrice &&
                      parseFloat(d.sellingUnitPrice).toFixed(2) === parseFloat(row.newPrice).toFixed(2);
                    return (
                      <tr key={i} className={cn("border-b border-border/40 last:border-0", !d && "opacity-50")}>
                        <td className="px-3 py-2 text-muted-foreground tabular-nums">{i + 1}</td>
                        <td className="px-3 py-2 font-mono font-medium">{row.productCode}</td>
                        <td className="px-3 py-2 text-muted-foreground max-w-xs truncate">
                          {d?.description ?? <span className="italic text-muted-foreground/40">not found</span>}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums font-mono text-muted-foreground">
                          {d?.sellingUnitPrice
                            ? Number(d.sellingUnitPrice).toLocaleString("en-MY", { minimumFractionDigits: 2 })
                            : <span className="italic text-muted-foreground/40">—</span>}
                        </td>
                        <td className={cn("px-3 py-2 text-right tabular-nums font-mono font-semibold",
                          d && !unchanged ? "text-blue-600 dark:text-blue-400" : "")}>
                          {row.newPrice
                            ? Number(row.newPrice).toLocaleString("en-MY", { minimumFractionDigits: 2 })
                            : <span className="italic text-muted-foreground/40">—</span>}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{row.currency}</td>
                        <td className="px-3 py-2 text-center">
                          {!d ? (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">Not found</span>
                          ) : unchanged ? (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted/60 text-muted-foreground">No change</span>
                          ) : (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400">Update</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex items-center justify-between p-4 bg-background border border-border rounded-xl">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <InfoIcon className="w-3.5 h-3.5 shrink-0" />
              {matchedRows.length > 0
                ? `${matchedRows.length} product${matchedRows.length !== 1 ? "s" : ""} will be updated`
                : "No matching products — check that codes match the database"}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={reset}>Cancel</Button>
              <Button
                size="sm" onClick={handleApply}
                disabled={applying || matchedRows.length === 0 || applied}
                className="gap-2 min-w-40"
              >
                {applying ? (
                  <><RefreshCwIcon className="w-3.5 h-3.5 animate-spin" /> Applying…</>
                ) : applied ? (
                  <><CheckCircleIcon className="w-3.5 h-3.5" /> Applied</>
                ) : (
                  <><UploadIcon className="w-3.5 h-3.5" /> Apply {matchedRows.length} Update{matchedRows.length !== 1 ? "s" : ""}</>
                )}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
