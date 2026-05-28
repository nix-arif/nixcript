"use client";

import { useState, useRef } from "react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  FileSpreadsheetIcon,
  XIcon,
  FileTextIcon,
  InfoIcon,
  CheckCircleIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";

type SpreadsheetRow = {
  no?: string;          // as-is from spreadsheet — may be roman numerals
  sku?: string;
  productCode: string;
  description?: string;
  qty?: string | number;
  uom?: string;
  unitPrice?: string | number;
  totalPrice?: string | number;
};

function mapSpreadsheetRow(row: Record<string, any>): SpreadsheetRow | null {
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

  const productCode = get("productcode", "product code", "code", "item code");
  if (!productCode) return null;

  return {
    no: get("no", "number", "#"),   // string — preserves roman numerals
    sku: get("sku", "item sku"),
    productCode,
    description: get("description", "desc", "item name", "name"),
    qty: get("qty", "quantity", "kuantiti"),
    uom: get("uom", "oum", "unit"),
    unitPrice: get("unitprice", "unit price", "harga unit"),
    totalPrice: get("totalprice", "total price", "jumlah"),
  };
}

export function CatalogueGenerator() {
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<SpreadsheetRow[]>([]);
  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [showCompany, setShowCompany] = useState(true);
  const [showSku, setShowSku] = useState(true);
  const [showProductCode, setShowProductCode] = useState(true);
  const [showRegNo, setShowRegNo] = useState(true);
  const [showValidity, setShowValidity] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (f: File) => {
    setFile(f);
    setRows([]);
    try {
      const buf = await f.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json(ws, { defval: "" }) as Record<
        string,
        any
      >[];
      const mapped = raw
        .map(mapSpreadsheetRow)
        .filter(Boolean) as SpreadsheetRow[];
      setRows(mapped);
      toast.success(`${mapped.length} rows loaded`);
    } catch (e: any) {
      toast.error("Failed to read file: " + e.message);
      setFile(null);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDrag(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  };

  const hasSku = rows.some((r) => r.sku);

  const handleGenerate = async () => {
    if (!rows.length) return toast.error("No rows to generate");
    if (!title.trim()) return toast.error("Please enter a catalogue title");

    setGenerating(true);
    try {
      const res = await fetch("/api/products/catalogue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: rows.map((r, i) => ({
            no: r.no ?? String(i + 1),   // use spreadsheet value; fallback to 1-based index
            productCode: r.productCode,
            sku: r.sku,
            description: r.description,
            qty: r.qty != null ? String(r.qty) : undefined,
            uom: r.uom,
          })),
          title: title.trim(),
          subtitle: subtitle.trim() || undefined,
          companyName: companyName.trim() || undefined,
          options: {
            showSku: showSku && hasSku,
            showProductCode,
            showRegNo,
            showValidity,
            showCompany,   // controls whether any company name appears
          },
        }),
      });

      if (!res.ok) {
        const msg = await res.text();
        throw new Error(msg || `Server error ${res.status}`);
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `catalogue_${Date.now()}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success("PDF generated successfully");
    } catch (e: any) {
      toast.error("Failed to generate PDF: " + e.message);
    } finally {
      setGenerating(false);
    }
  };

  const reset = () => {
    setFile(null);
    setRows([]);
    if (inputRef.current) inputRef.current.value = "";
  };

  const canGenerate = rows.length > 0 && title.trim().length > 0;

  return (
    <div className="p-6">
      <PageHeader
        title="Catalogue generator"
        description="Upload a product spreadsheet and export a formatted PDF catalogue"
      />

      <div className="grid grid-cols-[280px_1fr] gap-5 items-start">
        {/* Config panel */}
        <div className="bg-background border border-border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border bg-muted/30">
            <div className="text-sm font-medium">Configuration</div>
          </div>

          <div className="p-4 space-y-4">
            {/* File upload */}
            <div>
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                Spreadsheet
              </div>
              {!file ? (
                <div
                  onClick={() => inputRef.current?.click()}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDrag(true);
                  }}
                  onDragLeave={() => setDrag(false)}
                  onDrop={handleDrop}
                  className={cn(
                    "border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-all",
                    drag
                      ? "border-primary bg-primary/5"
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
                  <FileSpreadsheetIcon className="w-6 h-6 mx-auto mb-2 text-muted-foreground/50" />
                  <div className="text-xs font-medium">
                    Click or drag & drop
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    .xlsx · .xls · .csv
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
                  <CheckCircleIcon className="w-4 h-4 text-green-600 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium truncate">
                      {file.name}
                    </div>
                    <div className="text-xs text-green-600 dark:text-green-400">
                      {rows.length} rows loaded
                    </div>
                  </div>
                  <button
                    onClick={reset}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <XIcon className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>

            {/* Title */}
            <div>
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                Catalogue title <span className="text-destructive">*</span>
              </div>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Medical Device Catalogue 2025"
                className="h-9 text-sm"
              />
            </div>

            {/* Subtitle */}
            <div>
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                Subtitle{" "}
                <span className="text-muted-foreground/50 normal-case font-normal">
                  (optional)
                </span>
              </div>
              <Input
                value={subtitle}
                onChange={(e) => setSubtitle(e.target.value)}
                placeholder="e.g. Surgical Instruments Division"
                className="h-9 text-sm"
              />
            </div>

            {/* Company name */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Checkbox
                  id="showCompany"
                  checked={showCompany}
                  onCheckedChange={(v) => setShowCompany(v as boolean)}
                />
                <label
                  htmlFor="showCompany"
                  className="text-xs font-medium text-muted-foreground uppercase tracking-wider cursor-pointer"
                >
                  Show company name
                </label>
              </div>
              {showCompany && (
                <Input
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="e.g. Bio Mech Supply Sdn. Bhd."
                  className="h-9 text-sm"
                />
              )}
            </div>

            {/* Optional columns */}
            <div>
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                Optional columns
              </div>
              <div className="space-y-2.5">
                {[
                  {
                    id: "sku",
                    label: "SKU",
                    checked: showSku && hasSku,
                    onChange: setShowSku,
                    disabled: !hasSku,
                    hint: !hasSku ? "No SKU in file" : undefined,
                  },
                  {
                    id: "code",
                    label: "Product code",
                    checked: showProductCode,
                    onChange: setShowProductCode,
                  },
                  {
                    id: "regno",
                    label: "MDA registration no.",
                    checked: showRegNo,
                    onChange: setShowRegNo,
                  },
                  {
                    id: "validity",
                    label: "MDA validity",
                    checked: showValidity,
                    onChange: setShowValidity,
                  },
                ].map((opt) => (
                  <div key={opt.id} className="flex items-center gap-2">
                    <Checkbox
                      id={opt.id}
                      checked={opt.checked}
                      disabled={opt.disabled}
                      onCheckedChange={(v) => opt.onChange(v as boolean)}
                    />
                    <label
                      htmlFor={opt.id}
                      className={cn(
                        "text-sm cursor-pointer select-none",
                        opt.disabled && "text-muted-foreground/40",
                      )}
                    >
                      {opt.label}
                    </label>
                    {opt.hint && (
                      <span className="text-xs text-muted-foreground/50">
                        {opt.hint}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Generate button */}
            <Button
              onClick={handleGenerate}
              disabled={!canGenerate || generating}
              className="w-full gap-2"
            >
              {generating ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                  Generating…
                </>
              ) : (
                <>
                  <FileTextIcon className="w-4 h-4" />
                  Generate PDF
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Preview panel */}
        <div className="bg-background border border-border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border bg-muted/30 flex items-center justify-between">
            <div className="text-sm font-medium">Data preview</div>
            {rows.length > 0 && (
              <span className="text-xs text-muted-foreground">
                {rows.length} rows · first 5 shown
              </span>
            )}
          </div>

          {rows.length === 0 ? (
            <div className="py-20 text-center text-muted-foreground">
              <FileSpreadsheetIcon className="w-8 h-8 mx-auto mb-3 opacity-20" />
              <div className="text-sm">
                Upload a spreadsheet to preview rows
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-muted/30">
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground border-b border-border w-8">
                      No
                    </th>
                    {hasSku && showSku && (
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground border-b border-border">
                        SKU
                      </th>
                    )}
                    {showProductCode && (
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground border-b border-border">
                        Product code
                      </th>
                    )}
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground border-b border-border">
                      Description
                    </th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground border-b border-border w-12">
                      Qty
                    </th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground border-b border-border w-12">
                      UOM
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 5).map((row, i) => (
                    <tr
                      key={i}
                      className={i < 4 ? "border-b border-border" : ""}
                    >
                      <td className="px-3 py-2 text-muted-foreground">
                        {row.no ?? i + 1}
                      </td>
                      {hasSku && showSku && (
                        <td className="px-3 py-2 font-mono">
                          {row.sku || "—"}
                        </td>
                      )}
                      {showProductCode && (
                        <td className="px-3 py-2 font-mono text-blue-600 dark:text-blue-400">
                          {row.productCode}
                        </td>
                      )}
                      <td className="px-3 py-2 max-w-xs overflow-hidden text-ellipsis whitespace-nowrap">
                        {row.description || (
                          <span className="text-muted-foreground/50 italic">
                            from DB
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">{row.qty || "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {row.uom || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Info note */}
          <div className="px-4 py-3 border-t border-border bg-muted/10 flex items-start gap-2">
            <InfoIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
            <p className="text-xs text-muted-foreground">
              Empty description cells will use the value from the product
              database. Product images are fetched from R2 automatically.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
