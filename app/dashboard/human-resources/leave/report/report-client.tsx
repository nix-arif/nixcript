"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getLeaveReport, type LeaveReportColumn, type LeaveReportRow } from "@/server/leave";
import { FileSpreadsheetIcon, FileTextIcon, ClipboardListIcon } from "lucide-react";

interface Report {
  year: number;
  columns: LeaveReportColumn[];
  rows: LeaveReportRow[];
}

interface Props {
  initialReport: Report;
}

function fmtDays(v: string | undefined): string {
  if (v === undefined) return "—";
  const n = parseFloat(v);
  return n % 1 === 0 ? String(n) : n.toFixed(1);
}

function currentYearOptions(): number[] {
  const now = new Date().getFullYear();
  return [now, now - 1, now - 2, now - 3, now - 4];
}

export function LeaveReportClient({ initialReport }: Props) {
  const [, startTransition] = useTransition();
  const [report, setReport] = useState<Report>(initialReport);
  const [loading, setLoading] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);

  async function handleYearChange(value: string) {
    const year = parseInt(value, 10);
    setLoading(true);
    try {
      const fresh = await getLeaveReport(year);
      startTransition(() => setReport(fresh));
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to load report");
    } finally {
      setLoading(false);
    }
  }

  function handleExportExcel() {
    const { columns, rows, year } = report;
    const data = rows.map((r) => {
      const rowData: Record<string, string | number> = { Employee: r.memberName };
      for (const col of columns) {
        const header = col.parentCode ? `↳ ${col.name}` : col.name;
        rowData[header] = r.totals[col.code] ? parseFloat(r.totals[col.code]) : 0;
      }
      rowData["Total"] = parseFloat(r.grandTotal);
      return rowData;
    });
    const ws = XLSX.utils.json_to_sheet(data);
    ws["!cols"] = [{ wch: 24 }, ...columns.map(() => ({ wch: 12 })), { wch: 10 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `Leave ${year}`);
    XLSX.writeFile(wb, `leave-report-${year}.xlsx`);
    toast.success("Excel report downloaded");
  }

  async function handleExportPdf() {
    setExportingPdf(true);
    try {
      const res = await fetch(`/api/leave/report-pdf?year=${report.year}`);
      if (!res.ok) {
        const msg = await res.text();
        throw new Error(msg || `Server error ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `leave-report-${report.year}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("PDF report downloaded");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to generate PDF");
    } finally {
      setExportingPdf(false);
    }
  }

  return (
    <div className="p-6 flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <ClipboardListIcon className="h-5 w-5 text-muted-foreground" />
            Leave Report
          </h1>
          <p className="text-sm text-muted-foreground">
            Total approved leave taken per employee, broken down by leave type, for the selected year.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={String(report.year)} onValueChange={handleYearChange}>
            <SelectTrigger className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {currentYearOptions().map((y) => (
                <SelectItem key={y} value={String(y)}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={handleExportExcel} disabled={loading || report.rows.length === 0}>
            <FileSpreadsheetIcon className="h-4 w-4 mr-1.5" />
            Excel
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportPdf} disabled={loading || exportingPdf || report.rows.length === 0}>
            <FileTextIcon className="h-4 w-4 mr-1.5" />
            {exportingPdf ? "Generating…" : "PDF"}
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40">
                <TableHead className="min-w-48">Employee</TableHead>
                {report.columns.map((col) => (
                  <TableHead
                    key={col.code}
                    className="text-right whitespace-nowrap"
                    title={col.parentCode ? `${col.name} — drawn from the same balance as its parent column, not tracked separately` : col.name}
                  >
                    {col.parentCode && <span className="text-muted-foreground mr-0.5">↳</span>}
                    {col.name}
                  </TableHead>
                ))}
                <TableHead className="text-right font-semibold">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={report.columns.length + 2} className="text-center text-sm text-muted-foreground py-10">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : report.rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={report.columns.length + 2} className="text-center text-sm text-muted-foreground py-10">
                    No members found.
                  </TableCell>
                </TableRow>
              ) : (
                report.rows.map((row) => (
                  <TableRow key={row.userId}>
                    <TableCell className="text-sm font-medium">{row.memberName}</TableCell>
                    {report.columns.map((col) => (
                      <TableCell
                        key={col.code}
                        className={`text-right text-sm text-muted-foreground ${col.parentCode ? "italic bg-muted/20" : ""}`}
                      >
                        {fmtDays(row.totals[col.code])}
                      </TableCell>
                    ))}
                    <TableCell className="text-right text-sm font-semibold">{fmtDays(row.grandTotal)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {report.columns.length === 0 && !loading && (
        <p className="text-xs text-muted-foreground">No active leave types configured yet.</p>
      )}
    </div>
  );
}
