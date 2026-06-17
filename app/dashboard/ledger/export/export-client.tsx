"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DownloadIcon,
  FileSpreadsheetIcon,
  ArchiveIcon,
  Loader2Icon,
} from "lucide-react";

const THIS_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 6 }, (_, i) => String(THIS_YEAR - i));

export function LedgerExportClient() {
  const [mode, setMode] = useState<"year" | "range">("year");
  const [year, setYear] = useState(String(THIS_YEAR));
  const [from, setFrom] = useState(`${THIS_YEAR}-01-01`);
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [includeAttachments, setIncludeAttachments] = useState(true);
  const [loading, setLoading] = useState(false);

  async function handleDownload() {
    const fromDate = mode === "year" ? `${year}-01-01` : from;
    const toDate = mode === "year" ? `${year}-12-31` : to;

    if (fromDate > toDate) {
      toast.error("'From' date must be on or before 'To' date");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/ledger/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: fromDate, to: toDate, includeAttachments }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Export failed");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Ledger_Export_${fromDate}_to_${toDate}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("Export downloaded");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-6 max-w-2xl flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <ArchiveIcon className="h-5 w-5 text-muted-foreground" />
          Export Ledger Reports
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Download journal entries, trial balance, and subsidiary ledger as an Excel workbook, bundled with supporting documents in a ZIP file.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <FileSpreadsheetIcon className="h-4 w-4" />
            What&apos;s included
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground flex flex-col gap-1.5">
          <p>
            <span className="font-medium text-foreground">Journal Entries</span> — entry-level summary for the selected period
          </p>
          <p>
            <span className="font-medium text-foreground">Journal Lines</span> — line-by-line detail with FX info (currency, foreign amount, rate)
          </p>
          <p>
            <span className="font-medium text-foreground">Trial Balance</span> — cumulative account balances as of the end date
          </p>
          <p>
            <span className="font-medium text-foreground">Subsidiary Ledger</span> — per-stakeholder balances (AP Suppliers, AR Customers, Members) as of end date
          </p>
          <p>
            <span className="font-medium text-foreground">Supporting Documents</span> (optional) — all attached files named by entry number, e.g. <span className="font-mono text-xs">JE-2026-0001_invoice.pdf</span>
          </p>
        </CardContent>
      </Card>

      {/* Period mode toggle */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant={mode === "year" ? "default" : "outline"}
            size="sm"
            onClick={() => setMode("year")}
          >
            By Year
          </Button>
          <Button
            type="button"
            variant={mode === "range" ? "default" : "outline"}
            size="sm"
            onClick={() => setMode("range")}
          >
            Date Range
          </Button>
        </div>

        {mode === "year" ? (
          <div className="flex flex-col gap-1.5">
            <Label>Year</Label>
            <Select value={year} onValueChange={setYear}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {YEARS.map((y) => (
                  <SelectItem key={y} value={y}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : (
          <div className="flex flex-wrap gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>From</Label>
              <Input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="w-40"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>To</Label>
              <Input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="w-40"
              />
            </div>
          </div>
        )}
      </div>

      {/* Options */}
      <div className="flex items-center gap-2">
        <Checkbox
          id="attachments"
          checked={includeAttachments}
          onCheckedChange={(v) => setIncludeAttachments(!!v)}
        />
        <Label htmlFor="attachments" className="font-normal cursor-pointer">
          Include supporting documents{" "}
          <span className="text-muted-foreground text-xs">(adds attached PDFs and images — may take longer)</span>
        </Label>
      </div>

      <Button onClick={handleDownload} disabled={loading} className="w-fit">
        {loading ? (
          <>
            <Loader2Icon className="h-4 w-4 mr-2 animate-spin" />
            Generating…
          </>
        ) : (
          <>
            <DownloadIcon className="h-4 w-4 mr-2" />
            Generate &amp; Download
          </>
        )}
      </Button>
    </div>
  );
}
