"use client";

import { useState, useRef } from "react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import {
  UploadIcon,
  FileSpreadsheetIcon,
  XIcon,
  DownloadIcon,
  LoaderCircleIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

export function PictureRefClient() {
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFile(f: File) {
    if (!f.name.match(/\.(xlsx|xls)$/i)) {
      toast.error("Please upload an Excel file (.xlsx or .xls)");
      return;
    }
    setFile(f);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }

  function handleDownloadTemplate() {
    const ws = XLSX.utils.aoa_to_sheet([
      ["Hospital", "Set Name", "No", "Design Brand Name to Refer", "Design Brand Code to Refer", "Best Medical Code to Emboss", "Qty"],
      ["Seberang Jaya", "Loose Items", "1.1", "medicon", "72.05.70", "Q249-21", 10],
      ["Seberang Jaya", "Loose Items", "1.2", "geister", "10-3620", "F680-18DP", 5],
      ["Alor Gajah", "Loose Items", "2.1", "medicon", "45.75.03", "Q112-08", 2],
    ]);
    ws["!cols"] = [
      { wch: 18 }, { wch: 16 }, { wch: 8 }, { wch: 24 }, { wch: 24 }, { wch: 22 }, { wch: 8 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    XLSX.writeFile(wb, "picture-ref-template.xlsx");
  }

  async function handleGenerate() {
    if (!file) return;
    setLoading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/products/picture-ref", {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? `Server error ${res.status}`);
      }
      const matched = res.headers.get("X-Match-Matched");
      const mismatch = res.headers.get("X-Match-Mismatch");
      const notFound = res.headers.get("X-Match-NotFound");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "picture-ref.xlsx";
      a.click();
      URL.revokeObjectURL(url);

      if (mismatch && notFound && (Number(mismatch) > 0 || Number(notFound) > 0)) {
        toast.warning(
          `Downloaded — ${matched} matched, ${mismatch} brand mismatch, ${notFound} not found in catalogue. See "Match Status" column.`,
        );
      } else {
        toast.success(`File downloaded — ${matched ?? "all"} items matched`);
      }
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Picture Reference"
        description="Upload a purchase spec spreadsheet to generate an output with product descriptions, pricing and images matched from the catalogue."
      />

      <div>
        <Button variant="outline" size="sm" onClick={handleDownloadTemplate}>
          <DownloadIcon className="h-4 w-4" />
          Download Template
        </Button>
      </div>

      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={cn(
          "flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-10 cursor-pointer transition-colors select-none",
          dragging
            ? "border-primary bg-primary/5"
            : "border-muted-foreground/25 hover:border-muted-foreground/50 hover:bg-muted/30",
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
        />
        <UploadIcon className="h-8 w-8 text-muted-foreground" />
        <div className="text-center">
          <p className="text-sm font-medium">Drop your spreadsheet here or click to browse</p>
          <p className="text-xs text-muted-foreground mt-1">
            Must contain a column named <span className="font-mono">Design Brand Code to Refer</span>
          </p>
        </div>
      </div>

      {/* Selected file */}
      {file && (
        <div className="flex items-center gap-3 rounded-lg border px-4 py-3">
          <FileSpreadsheetIcon className="h-5 w-5 shrink-0 text-emerald-500" />
          <span className="flex-1 truncate text-sm">{file.name}</span>
          <span className="text-xs text-muted-foreground shrink-0">
            {(file.size / 1024).toFixed(0)} KB
          </span>
          <button
            onClick={(e) => { e.stopPropagation(); setFile(null); }}
            className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>
      )}

      <Button
        onClick={handleGenerate}
        disabled={!file || loading}
        className="w-fit"
      >
        {loading ? (
          <>
            <LoaderCircleIcon className="h-4 w-4 animate-spin" />
            Generating…
          </>
        ) : (
          <>
            <DownloadIcon className="h-4 w-4" />
            Generate &amp; Download
          </>
        )}
      </Button>
    </div>
  );
}
