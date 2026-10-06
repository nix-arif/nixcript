"use client";

import { Fragment, useState } from "react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { ChevronDownIcon, ChevronRightIcon, FileSpreadsheetIcon, SearchIcon, UsersIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { LeaveSummaryMember } from "@/server/leave";

type Summary = { year: number; types: { code: string; name: string }[]; members: LeaveSummaryMember[] };

const n = (v: number) => (v % 1 === 0 ? String(v) : v.toFixed(1));
const dShort = (ymd: string) => new Date(`${ymd}T00:00:00`).toLocaleDateString("en-MY", { day: "numeric", month: "short" });
const range = (a: string, b: string) => (a === b ? dShort(a) : `${dShort(a)} – ${dShort(b)}`);
const MONTHS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
const STATUS: Record<string, string> = {
  APPROVED: "text-green-700 dark:text-green-400", PENDING: "text-amber-700 dark:text-amber-400",
  REJECTED: "text-red-700 dark:text-red-400", CANCELLED: "text-muted-foreground line-through",
};

export function LeaveSummaryClient({ summary }: { summary: Summary }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const rows = summary.members.filter((m) => m.name.toLowerCase().includes(q.trim().toLowerCase()));
  const typeCodes = summary.types.map((t) => t.code);

  function exportExcel() {
    const data = summary.members.map((m) => {
      const r: Record<string, string | number> = { Member: m.name };
      for (const t of summary.types) {
        const b = m.balances.find((x) => x.code === t.code);
        r[`${t.name} — used`] = b?.used ?? 0;
        r[`${t.name} — remaining`] = b?.remaining ?? 0;
      }
      r["Taken (days)"] = m.takenDays;
      r["Pending (days)"] = m.pendingDays;
      r["Applications"] = m.applications.length;
      r["Next to weekend"] = m.nextToWeekend;
      r["Emergency"] = m.emergency;
      r["Short notice (<3 days)"] = m.shortNotice;
      return r;
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), `Leave summary ${summary.year}`);
    const apps = summary.members.flatMap((m) => m.applications.map((a) => ({
      Member: m.name, "Application no.": a.applicationNo, Type: a.leaveTypeName, From: a.startDate, To: a.endDate,
      Days: parseFloat(a.totalDays), Status: a.status, "Applied on": a.appliedOn, "Notice (days)": a.noticeDays,
    })));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(apps), "Applications");
    XLSX.writeFile(wb, `leave-summary-${summary.year}.xlsx`);
    toast.success("Excel downloaded");
  }

  return (
    <div className="p-6 flex flex-col gap-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2"><UsersIcon className="h-5 w-5 text-muted-foreground" />Leave Summary {summary.year}</h1>
          <p className="text-sm text-muted-foreground mt-1">Every member&apos;s leave this year: balance per type, what they took and have pending, and patterns. Click a member for the detail.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search member…" className="pl-8 h-8 w-48 text-sm" />
          </div>
          <Button variant="outline" size="sm" onClick={exportExcel} disabled={!summary.members.length}><FileSpreadsheetIcon className="h-4 w-4 mr-1.5" />Excel</Button>
        </div>
      </div>

      <div className="border rounded-xl overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b bg-muted/30 text-muted-foreground">
              <th className="text-left font-medium px-3 py-2 min-w-40">Member</th>
              {summary.types.map((t) => <th key={t.code} className="text-right font-medium px-3 py-2 whitespace-nowrap" title={t.name}>{t.name}<span className="block font-normal text-[10px]">left · used</span></th>)}
              <th className="text-right font-medium px-3 py-2">Taken</th>
              <th className="text-right font-medium px-3 py-2">Pending</th>
              <th className="text-left font-medium px-3 py-2 whitespace-nowrap">Next leave</th>
              <th className="text-left font-medium px-3 py-2">Patterns</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => {
              const isOpen = open === m.userId;
              return (
                <Fragment key={m.userId}>
                  <tr className={cn("border-b border-border/60 cursor-pointer hover:bg-muted/30", isOpen && "bg-muted/30")} onClick={() => setOpen(isOpen ? null : m.userId)}>
                    <td className="px-3 py-2 font-medium">
                      <span className="flex items-center gap-1.5">{isOpen ? <ChevronDownIcon className="h-3.5 w-3.5" /> : <ChevronRightIcon className="h-3.5 w-3.5" />}{m.name}</span>
                    </td>
                    {typeCodes.map((c) => {
                      const b = m.balances.find((x) => x.code === c);
                      return (
                        <td key={c} className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                          {b ? <><b className={cn(b.remaining < 0 && "text-destructive")}>{n(b.remaining)}</b><span className="text-muted-foreground"> · {n(b.used)}</span></> : "—"}
                        </td>
                      );
                    })}
                    <td className="px-3 py-2 text-right tabular-nums">{n(m.takenDays)}</td>
                    <td className={cn("px-3 py-2 text-right tabular-nums", m.pendingDays > 0 && "text-amber-700 dark:text-amber-400")}>{n(m.pendingDays)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{m.nextLeave ? <>{range(m.nextLeave.startDate, m.nextLeave.endDate)} <span className="text-muted-foreground">{m.nextLeave.leaveTypeName}</span></> : <span className="text-muted-foreground">—</span>}</td>
                    <td className="px-3 py-2"><Patterns m={m} /></td>
                  </tr>
                  {isOpen && (
                    <tr className="border-b border-border/60 bg-muted/10">
                      <td colSpan={typeCodes.length + 5} className="px-0 py-4">
                        {/* stays within the visible width while the wide table scrolls sideways */}
                        <div className="sticky left-0 px-4" style={{ width: "min(100%, calc(100vw - var(--sidebar-width, 16rem) - 3rem))" }}><MemberDetail m={m} /></div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={typeCodes.length + 5} className="px-3 py-6 text-center text-muted-foreground">No members match.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted-foreground">Left = remaining balance today (entitlement + carry-forward + earned credits − taken − pending). Patterns count approved leave this year: starting on a Monday or ending on a Friday, recorded as emergency leave, and applied for less than 3 days ahead.</p>
    </div>
  );
}

function Patterns({ m }: { m: LeaveSummaryMember }) {
  const tags = [
    m.nextToWeekend ? `${m.nextToWeekend} next to weekend` : null,
    m.emergency ? `${m.emergency} emergency` : null,
    m.shortNotice ? `${m.shortNotice} short notice` : null,
  ].filter(Boolean) as string[];
  if (!tags.length) return <span className="text-muted-foreground">—</span>;
  return <span className="flex flex-wrap gap-1">{tags.map((t) => <span key={t} className="rounded px-1.5 py-0.5 bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-300 whitespace-nowrap">{t}</span>)}</span>;
}

function MemberDetail({ m }: { m: LeaveSummaryMember }) {
  const max = Math.max(1, ...m.byMonth);
  return (
    <div className="grid lg:grid-cols-[1fr_auto] gap-5">
      <div className="space-y-4">
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-2">
          {m.balances.map((b) => (
            <div key={b.leaveTypeId} className="rounded-lg border bg-background p-3">
              <div className="flex items-baseline justify-between"><span className="text-xs font-semibold">{b.name}</span><span className={cn("text-sm font-semibold tabular-nums", b.remaining < 0 && "text-destructive")}>{n(b.remaining)} left</span></div>
              <div className="mt-1 text-[11px] text-muted-foreground tabular-nums">
                Entitled {n(b.entitled)}
                {b.carryForward ? ` · carried ${n(b.carryForward)}` : ""}
                {b.earned ? ` · earned ${n(b.earned)}` : ""}
                {b.opening ? ` · opening ${n(b.opening)}` : ""}
                {` · used ${n(b.used)}`}
                {b.pending ? ` · pending ${n(b.pending)}` : ""}
              </div>
            </div>
          ))}
        </div>
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Applications this year ({m.applications.length})</div>
          {m.applications.length === 0 ? <p className="text-xs text-muted-foreground">No leave applied for this year.</p> : (
            <table className="w-full text-xs">
              <thead><tr className="text-muted-foreground border-b"><th className="text-left font-medium py-1 pr-2">No.</th><th className="text-left font-medium py-1 pr-2">Type</th><th className="text-left font-medium py-1 pr-2">Dates</th><th className="text-right font-medium py-1 pr-2">Days</th><th className="text-left font-medium py-1 pr-2">Applied</th><th className="text-left font-medium py-1">Status</th></tr></thead>
              <tbody>
                {m.applications.map((a) => (
                  <tr key={a.id} className="border-b border-border/40">
                    <td className="py-1 pr-2 font-mono">{a.applicationNo}</td>
                    <td className="py-1 pr-2">{a.leaveTypeName}</td>
                    <td className="py-1 pr-2 whitespace-nowrap">{range(a.startDate, a.endDate)}{a.isHalfDay ? " (½)" : ""}</td>
                    <td className="py-1 pr-2 text-right tabular-nums">{n(parseFloat(a.totalDays))}</td>
                    <td className={cn("py-1 pr-2 whitespace-nowrap", !a.recordedByHr && a.noticeDays < 3 && a.status !== "CANCELLED" && "text-amber-700 dark:text-amber-400")}>{a.recordedByHr ? <>Recorded by HR {dShort(a.appliedOn)} <span className={a.acknowledgedAt ? "text-green-700 dark:text-green-400" : "text-amber-700 dark:text-amber-400"}>· {a.acknowledgedAt ? `acknowledged ${dShort(a.acknowledgedAt)}` : "not yet acknowledged"}</span></> : <>{dShort(a.appliedOn)} <span className="text-muted-foreground">({a.noticeDays < 0 ? `${-a.noticeDays}d after` : `${a.noticeDays}d ahead`})</span></>}</td>
                    <td className={cn("py-1", STATUS[a.status])}>{a.status.toLowerCase()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
      <div className="min-w-56">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Days taken by month</div>
        <div className="flex items-end gap-1 h-24 border-b border-border">
          {m.byMonth.map((v, i) => (
            <div key={i} className="flex-1 flex flex-col items-center justify-end h-full" title={`${v} day(s)`}>
              {v > 0 && <span className="text-[9px] tabular-nums text-muted-foreground">{n(v)}</span>}
              <div className="w-full rounded-t bg-primary/70" style={{ height: `${(v / max) * 80}%` }} />
            </div>
          ))}
        </div>
        <div className="flex gap-1 mt-1">{MONTHS.map((l, i) => <span key={i} className="flex-1 text-center text-[9px] text-muted-foreground">{l}</span>)}</div>
      </div>
    </div>
  );
}
