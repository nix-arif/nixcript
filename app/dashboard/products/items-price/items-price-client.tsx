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
  DownloadIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getProductPriceDetails } from "@/server/products";

type ParsedRow = {
  no: number;
  productCode: string;
};

type ProductDetail = {
  productCode: string;
  description: string | null;
  unitPrice: string | null;
  uom: string | null;
  mdaRegistrationNo: string | null;
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

export function ItemsPriceClient() {
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [details, setDetails] = useState<Map<string, ProductDetail>>(new Map());
  const [loading, setLoading] = useState(false);
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

      const codes = [...new Set(parsed.map((r) => r.productCode))];
      const dbRows = await getProductPriceDetails(codes);
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

  const reset = () => {
    setFile(null);
    setRows([]);
    setDetails(new Map());
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const handleExport = () => {
    const sheetData = [
      ["No.", "Product Code", "Description", "Unit Price (RM)", "UOM", "MDA Reg No."],
      ...rows.map((row) => {
        const d = details.get(row.productCode);
        return [
          row.no,
          row.productCode,
          d?.description ?? "",
          d?.unitPrice ? Number(d.unitPrice) : "",
          d?.uom ?? "",
          d?.mdaRegistrationNo ?? "",
        ];
      }),
    ];

    const ws = XLSX.utils.aoa_to_sheet(sheetData);

    // Column widths
    ws["!cols"] = [
      { wch: 6 },   // No.
      { wch: 18 },  // Product Code
      { wch: 40 },  // Description
      { wch: 16 },  // Unit Price
      { wch: 10 },  // UOM
      { wch: 20 },  // MDA Reg No
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Items Price");
    const filename = file ? file.name.replace(/\.[^.]+$/, "") + "_price.xlsx" : "items-price.xlsx";
    XLSX.writeFile(wb, filename);
    toast.success("Excel file downloaded");
  };

  const foundCount = rows.filter((r) => details.has(r.productCode)).length;
  const notFoundCount = rows.length - foundCount;

  return (
    <div className="p-6">
      <PageHeader
        title="Items Price Check"
        description="Upload a spreadsheet with product codes to retrieve pricing and product details"
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
                <div className="text-xs text-muted-foreground mt-0.5">
                  {rows.length} rows · {new Set(rows.map(r => r.productCode)).size} unique codes
                </div>
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
                <div className="text-xs text-muted-foreground mb-1">Found in DB</div>
                <div className="text-2xl font-semibold text-green-600 dark:text-green-400">{foundCount}</div>
              </div>
              <div className="bg-muted/40 rounded-lg p-3">
                <div className="text-xs text-muted-foreground mb-1">Not found</div>
                <div className={cn("text-2xl font-semibold", notFoundCount > 0 ? "text-amber-600 dark:text-amber-400" : "")}>
                  {notFoundCount}
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
              {foundCount} matched · {notFoundCount} not found
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-muted/20">
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground border-b border-border w-10">No.</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground border-b border-border w-28">Product Code</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground border-b border-border">Description</th>
                  <th className="px-3 py-2 text-right font-medium text-muted-foreground border-b border-border w-28">Unit Price (RM)</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground border-b border-border w-16">UOM</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground border-b border-border w-36">MDA Reg No.</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => {
                  const d = details.get(row.productCode);
                  return (
                    <tr
                      key={i}
                      className={cn(
                        i < rows.length - 1 ? "border-b border-border" : "",
                        !d && "opacity-40",
                      )}
                    >
                      <td className="px-3 py-2 text-muted-foreground tabular-nums">{row.no}</td>
                      <td className="px-3 py-2 font-mono font-medium">{row.productCode}</td>
                      <td className="px-3 py-2 text-muted-foreground max-w-xs truncate">
                        {d?.description ?? <span className="italic text-muted-foreground/40">—</span>}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">
                        {d?.unitPrice
                          ? Number(d.unitPrice).toLocaleString("en-MY", { minimumFractionDigits: 2 })
                          : <span className="italic text-muted-foreground/40">—</span>}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {d?.uom ?? <span className="italic text-muted-foreground/40">—</span>}
                      </td>
                      <td className="px-3 py-2 font-mono text-blue-600 dark:text-blue-400">
                        {d?.mdaRegistrationNo ?? <span className="italic text-muted-foreground/40 font-sans">—</span>}
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
            {foundCount > 0
              ? `${foundCount} product${foundCount > 1 ? "s" : ""} will be exported`
              : "No products found — check that your product codes match the database"}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={reset}>Cancel</Button>
            <Button
              size="sm"
              onClick={handleExport}
              disabled={foundCount === 0}
              className="gap-2 min-w-36"
            >
              <DownloadIcon className="w-3.5 h-3.5" />
              Export to Excel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
