"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { AlertTriangleIcon, ChevronDownIcon, ChevronRightIcon, ClockIcon, FileSpreadsheetIcon, PlaneIcon, SearchIcon, UsersIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { LeaveSummaryMember } from "@/server/leave";

type Summary = { year: number; types: { code: string; name: string }[]; members: LeaveSummaryMember[] };

const n = (v: number) => (v % 1 === 0 ? String(v) : v.toFixed(1));
const dShort = (ymd: string) => new Date(`${ymd}T00:00:00`).toLocaleDateString("en-MY", { day: "numeric", month: "short" });
const range = (a: string, b: string) => (a === b ? dShort(a) : `${dShort(a)} – ${dShort(b)}`);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const myToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuala_Lumpur" }).format(new Date());
const daysBetween = (fromYmd: string, toYmd: string) => Math.round((new Date(`${toYmd}T00:00:00`).getTime() - new Date(`${fromYmd}T00:00:00`).getTime()) / 86_400_000);
const inDays = (d: number) => (d <= 0 ? "today" : d === 1 ? "tomorrow" : `in ${d} days`);
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("");

type Bal = LeaveSummaryMember["balances"][number];
const totalOf = (b: Bal) => b.entitled + b.carryForward + b.earned + b.opening;
const isLow = (b: Bal) => totalOf(b) > 0 && b.remaining <= 0;
const flags = (m: LeaveSummaryMember) => m.nextToWeekend + m.emergency + m.shortNotice;

type Filter = "all" | "now" | "pending" | "low" | "patterns";
type Sort = "name" | "taken" | "pending" | "balance";
const STATUS: Record<string, string> = {
  APPROVED: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  PENDING: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  REJECTED: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  CANCELLED: "bg-muted text-muted-foreground line-through",
};

export function LeaveSummaryClient({ summary }: { summary: Summary }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("name");
  const [today, setToday] = useState<string | null>(null);
  useEffect(() => setToday(myToday()), []); // client-side, so SSR and browser can't disagree on the date
  const typeCodes = summary.types.map((t) => t.code);

  // Who is away today, from approved applications covering today's date
  const onLeaveNow = useMemo(() => {
    const ids = new Set<string>();
    if (!today) return ids;
    for (const m of summary.members)
      if (m.applications.some((a) => a.status === "APPROVED" && a.startDate <= today && today <= a.endDate)) ids.add(m.userId);
    return ids;
  }, [summary.members, today]);

  const counts = {
    all: summary.members.length,
    now: onLeaveNow.size,
    pending: summary.members.filter((m) => m.pendingDays > 0).length,
    low: summary.members.filter((m) => m.balances.some(isLow)).length,
    patterns: summary.members.filter((m) => flags(m) > 0).length,
  };
  const totalTaken = summary.members.reduce((t, m) => t + m.takenDays, 0);
  const totalPending = summary.members.reduce((t, m) => t + m.pendingDays, 0);

  const rows = useMemo(() => {
    const matches: Record<Filter, (m: LeaveSummaryMember) => boolean> = {
      all: () => true,
      now: (m) => onLeaveNow.has(m.userId),
      pending: (m) => m.pendingDays > 0,
      low: (m) => m.balances.some(isLow),
      patterns: (m) => flags(m) > 0,
    };
    const lowest = (m: LeaveSummaryMember) => Math.min(...m.balances.filter((b) => totalOf(b) > 0).map((b) => b.remaining), Infinity);
    return summary.members
      .filter((m) => m.name.toLowerCase().includes(q.trim().toLowerCase()) && matches[filter](m))
      .sort((a, b) =>
        sort === "taken" ? b.takenDays - a.takenDays
        : sort === "pending" ? b.pendingDays - a.pendingDays
        : sort === "balance" ? lowest(a) - lowest(b)
        : a.name.localeCompare(b.name));
  }, [summary.members, q, filter, sort, onLeaveNow]);

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

  const stat = (key: Filter, icon: React.ReactNode, label: string, value: string, hint: string, tone?: string) => (
    <button
      type="button"
      onClick={() => setFilter(filter === key ? "all" : key)}
      className={cn("text-left rounded-xl border p-4 transition-colors hover:bg-muted/40", filter === key && key !== "all" && "ring-2 ring-primary/40 bg-muted/30")}
    >
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">{icon}{label}</div>
      <div className={cn("mt-1 text-2xl font-semibold tabular-nums", tone)}>{value}</div>
      <div className="text-[11px] text-muted-foreground mt-0.5">{hint}</div>
    </button>
  );

  const chip = (key: Filter, label: string) => (
    <button
      key={key}
      type="button"
      onClick={() => setFilter(key)}
      className={cn("rounded-full border px-3 py-1 text-xs transition-colors", filter === key ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted/50")}
    >
      {label} <span className={cn("ml-0.5 tabular-nums", filter === key ? "opacity-80" : "text-muted-foreground")}>{counts[key]}</span>
    </button>
  );

  const colSpan = typeCodes.length + 5;

  return (
    <div className="p-6 flex flex-col gap-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2"><UsersIcon className="h-5 w-5 text-muted-foreground" />Leave Summary {summary.year}</h1>
          <p className="text-sm text-muted-foreground mt-1">See at a glance who is away, who is running low on leave, and who has requests waiting. Click a member to see their full leave history.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search member…" className="pl-8 h-8 w-48 text-sm" />
          </div>
          <Button variant="outline" size="sm" onClick={exportExcel} disabled={!summary.members.length}><FileSpreadsheetIcon className="h-4 w-4 mr-1.5" />Excel</Button>
        </div>
      </div>

      {/* Overview — click a card to filter the table */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {stat("all", <UsersIcon className="h-3.5 w-3.5" />, "Team members", String(counts.all), `${n(totalTaken)} leave days taken this year`)}
        {stat("now", <PlaneIcon className="h-3.5 w-3.5" />, "Away today", String(counts.now), counts.now ? "on approved leave right now" : "everyone is in")}
        {stat("pending", <ClockIcon className="h-3.5 w-3.5" />, "Waiting for approval", `${n(totalPending)} day${totalPending === 1 ? "" : "s"}`, `from ${counts.pending} member${counts.pending === 1 ? "" : "s"}`, counts.pending ? "text-amber-700 dark:text-amber-400" : undefined)}
        {stat("low", <AlertTriangleIcon className="h-3.5 w-3.5" />, "No leave left", String(counts.low), "used up at least one leave type", counts.low ? "text-destructive" : undefined)}
      </div>

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {chip("all", "Everyone")}
          {chip("now", "Away today")}
          {chip("pending", "Has pending")}
          {chip("low", "No leave left")}
          {chip("patterns", "Leave patterns")}
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Sort by
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="h-8 rounded-md border bg-background px-2 text-sm text-foreground">
            <option value="name">Name (A–Z)</option>
            <option value="taken">Most days taken</option>
            <option value="pending">Most pending</option>
            <option value="balance">Least leave left</option>
          </select>
        </label>
      </div>

      <div className="border rounded-xl overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b bg-muted/30 text-muted-foreground">
              <th className="text-left font-medium px-3 py-2 min-w-48">Member</th>
              {summary.types.map((t) => <th key={t.code} className="text-left font-medium px-3 py-2 whitespace-nowrap min-w-28" title={`${t.name}: days left out of the year's total`}>{t.name}<span className="block font-normal text-[10px]">days left</span></th>)}
              <th className="text-right font-medium px-3 py-2 whitespace-nowrap" title="Approved leave days taken this year">Taken<span className="block font-normal text-[10px]">days</span></th>
              <th className="text-right font-medium px-3 py-2 whitespace-nowrap" title="Days requested but not yet approved">Pending<span className="block font-normal text-[10px]">days</span></th>
              <th className="text-left font-medium px-3 py-2 whitespace-nowrap">Next leave</th>
              <th className="text-left font-medium px-3 py-2">Leave patterns</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => {
              const isOpen = open === m.userId;
              const away = onLeaveNow.has(m.userId);
              return (
                <Fragment key={m.userId}>
                  <tr className={cn("border-b border-border/60 cursor-pointer hover:bg-muted/30", isOpen && "bg-muted/30")} onClick={() => setOpen(isOpen ? null : m.userId)}>
                    <td className="px-3 py-2.5 font-medium">
                      <span className="flex items-center gap-2">
                        {isOpen ? <ChevronDownIcon className="h-3.5 w-3.5 shrink-0" /> : <ChevronRightIcon className="h-3.5 w-3.5 shrink-0" />}
                        <span className="h-7 w-7 shrink-0 rounded-full bg-muted text-[10px] font-semibold flex items-center justify-center text-muted-foreground">{initials(m.name)}</span>
                        <span className="flex flex-col leading-tight">
                          <span>{m.name}</span>
                          {away && <span className="text-[10px] font-normal text-blue-700 dark:text-blue-400">Away today</span>}
                        </span>
                      </span>
                    </td>
                    {typeCodes.map((c) => {
                      const b = m.balances.find((x) => x.code === c);
                      return <td key={c} className="px-3 py-2.5 whitespace-nowrap">{b ? <BalanceCell b={b} /> : <span className="text-muted-foreground">—</span>}</td>;
                    })}
                    <td className="px-3 py-2.5 text-right tabular-nums">{n(m.takenDays)}</td>
                    <td className={cn("px-3 py-2.5 text-right tabular-nums", m.pendingDays > 0 && "font-medium text-amber-700 dark:text-amber-400")}>{n(m.pendingDays)}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {m.nextLeave ? (
                        <span className="flex flex-col leading-tight">
                          <span>{range(m.nextLeave.startDate, m.nextLeave.endDate)} <span className="text-muted-foreground">· {m.nextLeave.leaveTypeName}</span></span>
                          {today && <span className="text-[10px] text-muted-foreground">{inDays(daysBetween(today, m.nextLeave.startDate))}</span>}
                        </span>
                      ) : <span className="text-muted-foreground">None booked</span>}
                    </td>
                    <td className="px-3 py-2.5"><Patterns m={m} /></td>
                  </tr>
                  {isOpen && (
                    <tr className="border-b border-border/60 bg-muted/10">
                      <td colSpan={colSpan} className="px-0 py-4">
                        {/* stays within the visible width while the wide table scrolls sideways */}
                        <div className="sticky left-0 px-4" style={{ width: "min(100%, calc(100vw - var(--sidebar-width, 16rem) - 3rem))" }}><MemberDetail m={m} /></div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={colSpan} className="px-3 py-8 text-center text-muted-foreground">{summary.members.length === 0 ? "No members yet." : "No members match this filter."}</td></tr>}
          </tbody>
        </table>
      </div>

      <details className="rounded-xl border p-4 text-xs text-muted-foreground">
        <summary className="cursor-pointer font-medium text-foreground">How to read this page</summary>
        <ul className="mt-2 space-y-1.5 list-disc pl-4">
          <li><b className="text-foreground">Days left</b> is what the member can still take today: their entitlement + carried-forward days + earned credits, minus what they have taken and what is waiting for approval. The bar shows the share already taken (dark) and pending (amber).</li>
          <li><b className="text-foreground">Taken</b> counts approved leave this year. <b className="text-foreground">Pending</b> is requested but not yet approved.</li>
          <li><b className="text-foreground">Away today</b> means an approved leave that covers today&apos;s date.</li>
          <li><b className="text-foreground">Leave patterns</b> are only a prompt to look closer, based on approved leave this year: <i>Mon/Fri leave</i> starts on a Monday or ends on a Friday, <i>Emergency</i> was recorded as emergency leave, and <i>Short notice</i> was applied for less than 3 days ahead.</li>
        </ul>
      </details>
    </div>
  );
}

// Days left for one leave type, with a bar of how much of the year's total is gone.
function BalanceCell({ b }: { b: Bal }) {
  const total = totalOf(b);
  const pct = (v: number) => (total > 0 ? Math.min(100, Math.max(0, (v / total) * 100)) : 0);
  const over = b.remaining < 0;
  return (
    <div className="min-w-24" title={`${b.name}: ${n(b.remaining)} left of ${n(total)} · taken ${n(b.used)}${b.pending ? ` · pending ${n(b.pending)}` : ""}`}>
      <div className="flex items-baseline gap-1 tabular-nums">
        <b className={cn("text-sm", over && "text-destructive", !over && total > 0 && b.remaining === 0 && "text-amber-700 dark:text-amber-400")}>{n(b.remaining)}</b>
        {total > 0 && <span className="text-muted-foreground">of {n(total)}</span>}
      </div>
      {total > 0 && (
        <div className="mt-1 h-1.5 w-full rounded-full bg-muted overflow-hidden flex">
          <div className={cn("h-full", over ? "bg-destructive" : "bg-primary/70")} style={{ width: `${pct(b.used)}%` }} />
          <div className="h-full bg-amber-400" style={{ width: `${pct(b.pending)}%` }} />
        </div>
      )}
    </div>
  );
}

function Patterns({ m }: { m: LeaveSummaryMember }) {
  const tags = [
    m.nextToWeekend ? [`${m.nextToWeekend}× Mon/Fri leave`, "Approved leave that starts on a Monday or ends on a Friday"] : null,
    m.emergency ? [`${m.emergency}× Emergency`, "Approved leave recorded as emergency leave"] : null,
    m.shortNotice ? [`${m.shortNotice}× Short notice`, "Applied for less than 3 days before the leave started"] : null,
  ].filter(Boolean) as string[][];
  if (!tags.length) return <span className="text-muted-foreground">None</span>;
  return <span className="flex flex-wrap gap-1">{tags.map(([t, tip]) => <span key={t} title={tip} className="rounded px-1.5 py-0.5 bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-300 whitespace-nowrap">{t}</span>)}</span>;
}

function MemberDetail({ m }: { m: LeaveSummaryMember }) {
  const max = Math.max(1, ...m.byMonth);
  return (
    <div className="grid lg:grid-cols-[1fr_auto] gap-5">
      <div className="space-y-4">
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-2">
          {m.balances.map((b) => (
            <div key={b.leaveTypeId} className="rounded-lg border bg-background p-3">
              <div className="flex items-baseline justify-between"><span className="text-xs font-semibold">{b.name}</span><span className={cn("text-sm font-semibold tabular-nums", b.remaining < 0 && "text-destructive")}>{n(b.remaining)} days left</span></div>
              <div className="mt-2"><BalanceCell b={b} /></div>
              <div className="mt-1 text-[11px] text-muted-foreground tabular-nums">
                Yearly entitlement {n(b.entitled)}
                {b.carryForward ? ` · carried over ${n(b.carryForward)}` : ""}
                {b.earned ? ` · earned ${n(b.earned)}` : ""}
                {b.opening ? ` · opening ${n(b.opening)}` : ""}
                {` · taken ${n(b.used)}`}
                {b.pending ? ` · pending ${n(b.pending)}` : ""}
              </div>
            </div>
          ))}
        </div>
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Applications this year ({m.applications.length})</div>
          {m.applications.length === 0 ? <p className="text-xs text-muted-foreground">No leave applied for this year.</p> : (
            <table className="w-full text-xs">
              <thead><tr className="text-muted-foreground border-b"><th className="text-left font-medium py-1 pr-2">No.</th><th className="text-left font-medium py-1 pr-2">Type</th><th className="text-left font-medium py-1 pr-2">Dates</th><th className="text-right font-medium py-1 pr-2">Days</th><th className="text-left font-medium py-1 pr-2">Applied on</th><th className="text-left font-medium py-1">Status</th></tr></thead>
              <tbody>
                {m.applications.map((a) => (
                  <tr key={a.id} className="border-b border-border/40">
                    <td className="py-1 pr-2 font-mono">{a.applicationNo}</td>
                    <td className="py-1 pr-2">{a.leaveTypeName}</td>
                    <td className="py-1 pr-2 whitespace-nowrap">{range(a.startDate, a.endDate)}{a.isHalfDay ? " (½)" : ""}</td>
                    <td className="py-1 pr-2 text-right tabular-nums">{n(parseFloat(a.totalDays))}</td>
                    <td className={cn("py-1 pr-2 whitespace-nowrap", !a.recordedByHr && a.noticeDays < 3 && a.status !== "CANCELLED" && "text-amber-700 dark:text-amber-400")}>{a.recordedByHr ? <>Recorded by HR {dShort(a.appliedOn)} <span className={a.acknowledgedAt ? "text-green-700 dark:text-green-400" : "text-amber-700 dark:text-amber-400"}>· {a.acknowledgedAt ? `acknowledged ${dShort(a.acknowledgedAt)}` : "not yet acknowledged"}</span></> : <>{dShort(a.appliedOn)} <span className="text-muted-foreground">({a.noticeDays < 0 ? `${-a.noticeDays}d after` : `${a.noticeDays}d ahead`})</span></>}</td>
                    <td className="py-1"><span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium capitalize", STATUS[a.status])}>{a.status.toLowerCase()}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
      <div className="min-w-56">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Approved days by month</div>
        <div className="flex items-end gap-1 h-24 border-b border-border">
          {m.byMonth.map((v, i) => (
            <div key={i} className="flex-1 flex flex-col items-center justify-end h-full" title={`${MONTHS[i]}: ${v} day(s)`}>
              {v > 0 && <span className="text-[9px] tabular-nums text-muted-foreground">{n(v)}</span>}
              <div className="w-full rounded-t bg-primary/70" style={{ height: `${(v / max) * 80}%` }} />
            </div>
          ))}
        </div>
        <div className="flex gap-1 mt-1">{MONTHS.map((l, i) => <span key={i} className="flex-1 text-center text-[8px] text-muted-foreground">{l}</span>)}</div>
      </div>
    </div>
  );
}
