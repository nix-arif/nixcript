"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { getLeaveReport, type LeaveReportColumn, type LeaveReportRow } from "@/server/leave";
import { FileSpreadsheetIcon, FileTextIcon, ClipboardListIcon } from "lucide-react";

interface Report {
  year: number;
  columns: LeaveReportColumn[];
  rows: LeaveReportRow[];
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const num = (v: string | number | undefined) => (typeof v === "number" ? v : parseFloat(v ?? "0") || 0);
const fmt = (v: number) => (v % 1 === 0 ? String(v) : v.toFixed(1));

function yearOptions(): number[] {
  const now = new Date().getFullYear();
  return [now, now - 1, now - 2, now - 3, now - 4];
}

export function LeaveReportClient({ initialReport }: { initialReport: Report }) {
  const [, startTransition] = useTransition();
  const [report, setReport] = useState<Report>(initialReport);
  const [loading, setLoading] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [view, setView] = useState<"type" | "month">("type");
  const [showAllTypes, setShowAllTypes] = useState(false);
  const [onlyTook, setOnlyTook] = useState(false);
  const [sort, setSort] = useState<"name" | "most">("name");

  const { columns, rows, year } = report;
  const usedCols = columns.filter((c) => rows.some((r) => num(r.totals[c.code]) > 0));
  const cols = showAllTypes ? columns : usedCols;
  const shown = rows
    .filter((r) => !onlyTook || num(r.grandTotal) > 0)
    .sort((a, b) => (sort === "most" ? num(b.grandTotal) - num(a.grandTotal) : a.memberName.localeCompare(b.memberName)));

  // Headline figures
  const totalDays = rows.reduce((s, r) => s + num(r.grandTotal), 0);
  const tookLeave = rows.filter((r) => num(r.grandTotal) > 0).length;
  const typeTotals = columns.map((c) => ({ c, d: rows.reduce((s, r) => s + num(r.totals[c.code]), 0) })).sort((a, b) => b.d - a.d);
  const monthTotals = MONTHS.map((_, i) => rows.reduce((s, r) => s + (r.byMonth[i] ?? 0), 0));
  const busiest = monthTotals.reduce((bi, v, i) => (v > monthTotals[bi] ? i : bi), 0);

  async function changeYear(value: string) {
    setLoading(true);
    try {
      const fresh = await getLeaveReport(parseInt(value, 10));
      startTransition(() => setReport(fresh));
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to load report");
    } finally {
      setLoading(false);
    }
  }

  function exportExcel() {
    const byType = rows.map((r) => {
      const o: Record<string, string | number> = { Member: r.memberName, "Total days": num(r.grandTotal) };
      for (const c of usedCols) {
        o[`${c.name} — taken`] = num(r.totals[c.code]);
        if (r.emergency[c.code]) o[`${c.name} — of which emergency`] = num(r.emergency[c.code]);
        o[`${c.name} — had`] = num(r.entitled[c.code]);
      }
      return o;
    });
    const byMonth = rows.map((r) => ({ Member: r.memberName, ...Object.fromEntries(MONTHS.map((m, i) => [m, r.byMonth[i] ?? 0])), Total: num(r.grandTotal) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(byType), `By leave type ${year}`);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(byMonth), `By month ${year}`);
    XLSX.writeFile(wb, `leave-report-${year}.xlsx`);
    toast.success("Excel report downloaded");
  }

  async function exportPdf() {
    setExportingPdf(true);
    try {
      const res = await fetch(`/api/leave/report-pdf?year=${year}`);
      if (!res.ok) throw new Error((await res.text()) || `Server error ${res.status}`);
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url; a.download = `leave-report-${year}.pdf`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("PDF report downloaded");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to generate PDF");
    } finally {
      setExportingPdf(false);
    }
  }

  const chip = (on: boolean) => cn("px-2.5 h-7 text-xs rounded-md border transition-colors", on ? "bg-foreground text-background border-foreground" : "hover:bg-muted");

  return (
    <div className="p-6 flex flex-col gap-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold flex items-center gap-2"><ClipboardListIcon className="h-5 w-5 text-muted-foreground" />Leave Report — {year}</h1>
          <p className="text-sm text-muted-foreground">Days of <b className="text-foreground">approved</b> leave each member took in {year}. Pending, rejected and cancelled leave isn&apos;t counted.</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={String(year)} onValueChange={changeYear}>
            <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
            <SelectContent>{yearOptions().map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={exportExcel} disabled={loading || rows.length === 0}><FileSpreadsheetIcon className="h-4 w-4 mr-1.5" />Excel</Button>
          <Button variant="outline" size="sm" onClick={exportPdf} disabled={loading || exportingPdf || rows.length === 0}><FileTextIcon className="h-4 w-4 mr-1.5" />{exportingPdf ? "Generating…" : "PDF"}</Button>
        </div>
      </div>

      {/* Headline figures */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          ["Days taken", fmt(totalDays), `across ${rows.length} members`],
          ["Members who took leave", `${tookLeave} of ${rows.length}`, tookLeave ? `${fmt(totalDays / tookLeave)} days each on average` : "nobody yet"],
          ["Most-used leave type", typeTotals[0]?.d ? typeTotals[0].c.name : "—", typeTotals[0]?.d ? `${fmt(typeTotals[0].d)} days` : ""],
          ["Busiest month", monthTotals[busiest] ? MONTHS[busiest] : "—", monthTotals[busiest] ? `${fmt(monthTotals[busiest])} days` : ""],
        ].map(([label, value, sub]) => (
          <div key={label} className="rounded-xl border p-3">
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="text-lg font-semibold mt-0.5">{value}</div>
            <div className="text-[11px] text-muted-foreground">{sub}</div>
          </div>
        ))}
      </div>

      {/* View options */}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={chip(view === "type")} onClick={() => setView("type")}>By leave type</button>
        <button type="button" className={chip(view === "month")} onClick={() => setView("month")}>By month</button>
        <span className="w-px h-5 bg-border mx-1" />
        <button type="button" className={chip(onlyTook)} onClick={() => setOnlyTook((v) => !v)}>Only members who took leave</button>
        {view === "type" && <button type="button" className={chip(showAllTypes)} onClick={() => setShowAllTypes((v) => !v)}>Show unused leave types{columns.length > usedCols.length ? ` (${columns.length - usedCols.length})` : ""}</button>}
        <select value={sort} onChange={(e) => setSort(e.target.value as "name" | "most")} className="ml-auto h-7 rounded-md border bg-background px-2 text-xs">
          <option value="name">Sort: name</option>
          <option value="most">Sort: most leave first</option>
        </select>
      </div>

      <div className="rounded-lg border overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted text-xs text-muted-foreground">
              <th className="text-left font-medium px-3 py-2 min-w-44 sticky left-0 bg-muted">Member</th>
              <th className="text-right font-semibold px-3 py-2 text-foreground">Total</th>
              {view === "type"
                ? cols.map((c) => <th key={c.code} className="text-right font-medium px-3 py-2 whitespace-nowrap">{c.name}<span className="block font-normal text-[10px]">taken of what they had</span></th>)
                : MONTHS.map((m) => <th key={m} className="text-right font-medium px-2 py-2">{m}</th>)}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={99} className="text-center text-muted-foreground py-10">Loading…</td></tr>
            ) : shown.length === 0 ? (
              <tr><td colSpan={99} className="text-center text-muted-foreground py-10">{onlyTook ? "Nobody took approved leave in this year." : "No members found."}</td></tr>
            ) : shown.map((r) => (
              <tr key={r.userId} className="border-t border-border/60">
                <td className="px-3 py-2 font-medium sticky left-0 bg-background">{r.memberName}</td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums">{num(r.grandTotal) ? fmt(num(r.grandTotal)) : <span className="text-muted-foreground font-normal">0</span>}</td>
                {view === "type" ? cols.map((c) => {
                  const t = num(r.totals[c.code]), had = num(r.entitled[c.code]), em = num(r.emergency[c.code]);
                  return (
                    <td key={c.code} className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                      {t ? <b>{fmt(t)}</b> : <span className="text-muted-foreground">0</span>}
                      {had ? <span className="text-muted-foreground"> of {fmt(had)}</span> : null}
                      {em ? <span className="block text-[10px] text-amber-700 dark:text-amber-400">{fmt(em)} emergency</span> : null}
                    </td>
                  );
                }) : MONTHS.map((_, i) => (
                  <td key={i} className={cn("px-2 py-2 text-right tabular-nums", !r.byMonth[i] && "text-muted-foreground/50")}>{r.byMonth[i] ? fmt(r.byMonth[i]) : "·"}</td>
                ))}
              </tr>
            ))}
          </tbody>
          {!loading && shown.length > 0 && (
            <tfoot>
              <tr className="border-t-2 bg-muted font-semibold text-xs">
                <td className="px-3 py-2 sticky left-0 bg-muted">All members</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmt(shown.reduce((s, r) => s + num(r.grandTotal), 0))}</td>
                {view === "type"
                  ? cols.map((c) => <td key={c.code} className="px-3 py-2 text-right tabular-nums">{fmt(shown.reduce((s, r) => s + num(r.totals[c.code]), 0))}</td>)
                  : MONTHS.map((_, i) => <td key={i} className="px-2 py-2 text-right tabular-nums">{fmt(shown.reduce((s, r) => s + (r.byMonth[i] ?? 0), 0))}</td>)}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <p className="text-[11px] text-muted-foreground">
        &ldquo;Of&rdquo; = what the member had for that type in {year} (entitlement + carried forward + opening balance). Emergency leave is leave of that type applied for at short notice — it comes out of the same balance, so it is counted in the type and shown underneath. By month counts each leave in the month it starts. For balances left and each member&apos;s applications, see Leave Summary.
      </p>
    </div>
  );
}
