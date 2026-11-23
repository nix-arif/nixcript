"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { setReviewPeriodShowReviewerMarks, addReviewsToPeriod, cancelReview, reassignReviewer, remindReviewPeriod, setReviewPeriodStatus, type EligibleEmployee, type PeriodDetail } from "@/server/performance";
import { formatScore, OUTCOMES, PURPOSES, sharePercent, STATUS_LABEL, type ReviewStatus } from "@/lib/performance/core";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Sheet, SheetFormContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ArrowLeftIcon, BellRingIcon, CheckIcon, DownloadIcon, PlusIcon } from "lucide-react";
import { ReviewStatusBadge } from "../../status-badge";
import { EmployeePicker, type Picked } from "../employee-picker";

const fmt = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" });
const fmtDT = (d: Date | string | null) => (d ? new Date(d).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" }) : "");
type Filter = "all" | ReviewStatus | "no-reviewer" | "disputed";
const matches = (r: { status: ReviewStatus; reviewerUserId: string | null; disputed: boolean }, f: Filter) =>
  f === "all" ? true : f === "no-reviewer" ? !r.reviewerUserId && r.status !== "cancelled" && r.status !== "completed" : f === "disputed" ? r.disputed : r.status === f;
const CHIPS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" }, { key: "self", label: "Waiting for self-assessment" }, { key: "manager", label: "With the manager" },
  { key: "signoff", label: "Waiting for sign-off" }, { key: "completed", label: "Completed" }, { key: "disputed", label: "Disputed" }, { key: "no-reviewer", label: "No reviewer" }, { key: "cancelled", label: "Cancelled" },
];

export function PeriodDetailClient({ period, employees }: { period: PeriodDetail; employees: EligibleEmployee[] }) {
  const router = useRouter();
  const [addOpen, setAddOpen] = useState(false);
  const [picked, setPicked] = useState<Picked>({});
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [company, setCompany] = useState("all");
  const open = period.status === "open";
  const live = period.reviews.filter((r) => r.status !== "cancelled");
  const done = live.filter((r) => r.status === "completed").length;
  const waiting = live.filter((r) => r.status !== "completed").length;
  const haveIds = period.reviews.map((r) => r.employeeUserId);
  const companies = [...new Set(period.reviews.map((r) => r.organizationName).filter(Boolean))];
  const several = companies.length > 1;
  const refresh = () => router.refresh();

  const counts = useMemo(() => Object.fromEntries(CHIPS.map((c) => [c.key, period.reviews.filter((r) => matches(r, c.key) && (company === "all" || r.organizationName === company)).length])) as Record<Filter, number>, [period.reviews, company]);
  const rows = period.reviews.filter((r) => matches(r, filter) && (company === "all" || r.organizationName === company));

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>, success?: string) {
    setBusy(true);
    try { const r = await fn(); if (!r.ok) toast.error(r.error); else { if (success) toast.success(success); refresh(); } }
    catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }

  async function remind() {
    if (!confirm(`Send a reminder to the ${waiting} ${waiting === 1 ? "person" : "people"} this period is waiting for? Nobody gets more than one a day.`)) return;
    setBusy(true);
    try {
      const r = await remindReviewPeriod(period.id);
      if (!r.ok) toast.error(r.error);
      else toast.success(r.value.reminded === 0 ? "Everyone was already reminded today." : `Reminded ${r.value.reminded}${r.value.skipped ? `, ${r.value.skipped} skipped (already reminded today or no reviewer)` : ""}.`);
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }

  // one spreadsheet of the whole period, to keep or to check against the paper form
  function exportCsv() {
    const q = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const head = ["Employee", "Company", "Department", "Designation", "Purpose", "Reviewer", "Status", "Self-assessment submitted", "Manager review submitted", "HR signed off", "Final score", "Out of", "Outcome", "Employee acknowledged", "Employee response", "Round"];
    const lines = period.reviews.filter((r) => r.status !== "cancelled").map((r) => [
      r.employeeName, r.organizationName, r.department, r.designation, r.purpose ? PURPOSES[r.purpose] : "", r.reviewerName, STATUS_LABEL[r.status],
      fmtDT(r.selfSubmittedAt), fmtDT(r.managerSubmittedAt), fmtDT(r.signedOffAt), r.status === "completed" || r.status === "signoff" ? r.finalScore : "", r.scaleMax, r.outcome ? OUTCOMES[r.outcome] : "", fmtDT(r.acknowledgedAt),
      r.employeeResponse === "agree" ? "Agrees" : r.employeeResponse === "disagree" ? (r.disputed ? "Disagrees (open)" : "Disagrees (settled)") : "", r.round,
    ].map(q).join(","));
    const blob = new Blob(["﻿" + [head.map(q).join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `performance-review-${period.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="p-4 sm:p-6 max-w-5xl">
      <PageHeader
        title={period.name}
        description={`${fmt(period.startDate)} to ${fmt(period.endDate)} · ${done} of ${live.length} completed`}
        action={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm" className="gap-1.5"><Link href="/dashboard/human-resources/performance/periods"><ArrowLeftIcon className="h-3.5 w-3.5" />Periods</Link></Button>
            {open && waiting > 0 && <Button size="sm" variant="outline" className="gap-1.5" disabled={busy} onClick={remind}><BellRingIcon className="h-3.5 w-3.5" />Remind {waiting} waiting</Button>}
            <Button size="sm" variant="outline" className="gap-1.5" onClick={exportCsv}><DownloadIcon className="h-3.5 w-3.5" />Export</Button>
            {open && <Button size="sm" variant="outline" className="gap-1.5" onClick={() => { setPicked({}); setAddOpen(true); }}><PlusIcon className="h-3.5 w-3.5" />Add people</Button>}
            <Button size="sm" variant={open ? "outline" : "default"} disabled={busy}
              onClick={() => { if (open && !confirm("Close this period? Nobody can edit or sign off its reviews until you reopen it.")) return; run(() => setReviewPeriodStatus(period.id, open ? "closed" : "open"), open ? "Period closed" : "Period reopened"); }}>
              {open ? "Close period" : "Reopen period"}
            </Button>
          </div>
        }
      />
      {period.reviews.some((r) => r.coReviewers.length > 0) && (
        <label className="mb-3 flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs">
          <input type="checkbox" className="h-3.5 w-3.5" checked={period.showReviewerMarks} disabled={busy}
            onChange={(e) => run(() => setReviewPeriodShowReviewerMarks(period.id, e.target.checked), e.target.checked ? "Employees will see each reviewer's marks" : "Employees will see the combined marks only")} />
          <span><span className="font-medium">Employees see each reviewer&apos;s marks by name</span> <span className="text-muted-foreground">(reviews with more than one reviewer, once completed; off = combined marks only)</span></span>
        </label>
      )}
      {!open && <div className="mb-4 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">This period is closed. Reviews cannot be edited or signed off until it is reopened.</div>}

      {/* progress, and the statuses as filters */}
      <div className="mb-3 space-y-2.5 rounded-xl border border-border bg-background p-3">
        <div className="flex items-center gap-3">
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-green-500 transition-all" style={{ width: `${live.length ? Math.round((done / live.length) * 100) : 0}%` }} /></div>
          <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">{live.length ? Math.round((done / live.length) * 100) : 0}% completed</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {CHIPS.filter((c) => c.key === "all" || counts[c.key] > 0 || filter === c.key).map((c) => (
            <button key={c.key} type="button" aria-pressed={filter === c.key} onClick={() => setFilter(c.key)}
              className={`rounded-full border px-2.5 py-1 text-xs ${filter === c.key ? "border-indigo-500 bg-indigo-50 font-medium dark:bg-indigo-900/20" : "border-border text-muted-foreground hover:bg-muted/30"} ${c.key === "no-reviewer" ? "border-amber-300 text-amber-800 dark:text-amber-300" : ""}`}>
              {c.label} <span className="tabular-nums">{counts[c.key]}</span>
            </button>
          ))}
          {several && (
            <select className="ml-auto h-8 rounded-md border border-input bg-background px-2 text-xs" value={company} onChange={(e) => setCompany(e.target.value)} aria-label="Company">
              <option value="all">All companies</option>
              {companies.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr><th className="px-4 py-2 text-left font-medium">Employee</th><th className="px-4 py-2 text-left font-medium">Reviewer</th><th className="px-4 py-2 text-left font-medium">Status</th><th className="px-4 py-2 text-right font-medium">Score</th><th className="w-28" /></tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-xs text-muted-foreground">No reviews match this filter.</td></tr>}
            {rows.map((r) => {
              const editable = open && (r.status === "self" || r.status === "manager");
              return (
                <tr key={r.id} className={`border-t border-border/60 ${r.status === "cancelled" ? "opacity-50" : ""}`}>
                  <td className="px-4 py-2">
                    <div className="font-medium">{r.employeeName}</div>
                    <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                      {several && <span>{r.organizationName}</span>}
                      {r.department && <span>{r.department}</span>}
                      {r.purpose && <span className="rounded border border-border px-1">{PURPOSES[r.purpose]}</span>}
                    </div>
                  </td>
                  <td className="px-4 py-2">
                    {editable ? (
                      <select className="h-8 max-w-44 rounded-md border border-input bg-background px-2 text-xs" value={r.reviewerUserId ?? ""} disabled={busy}
                        onChange={(e) => e.target.value && run(() => reassignReviewer(r.id, e.target.value), "Reviewer changed")}>
                        <option value="">{r.reviewerUserId ? "" : "Not assigned"}</option>
                        {employees.filter((x) => x.userId !== r.employeeUserId).map((x) => <option key={x.userId} value={x.userId}>{x.name}{several ? ` (${x.organizationName})` : ""}</option>)}
                      </select>
                    ) : <span className="text-xs">{r.reviewerName ?? <span className="text-muted-foreground">Not assigned</span>}</span>}
                    {!r.reviewerUserId && r.status !== "cancelled" && r.status !== "completed" && <div className="text-[10px] text-amber-700 dark:text-amber-400">Assign a reviewer</div>}
                    {r.coReviewers.length > 0 && (
                      <div className="mt-0.5 space-y-px text-[10px] text-muted-foreground" title="Other reviewers and their share of the score (change them on the review)">
                        <div>lead · {sharePercent(r.leadWeight, [r.leadWeight, ...r.coReviewers.map((c) => c.weight)])}%</div>
                        {r.coReviewers.map((c) => (
                          <div key={c.userId} className="flex items-center gap-1">
                            {r.status === "manager" && (c.submitted ? <CheckIcon className="h-3 w-3 text-green-600" /> : <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500" />)}
                            {c.name} · {sharePercent(c.weight, [r.leadWeight, ...r.coReviewers.map((x) => x.weight)])}%
                          </div>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <ReviewStatusBadge status={r.status} short />
                    {r.disputed && <span className="ml-1 inline-flex rounded-md border border-red-300 bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">Disputed</span>}
                    {r.round > 1 && <span className="ml-1 text-[10px] text-muted-foreground">round {r.round}</span>}
                    {r.status === "completed" && (
                      <div className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
                        {r.outcome && <span>{OUTCOMES[r.outcome]}</span>}
                        {r.acknowledgedAt ? <span className="inline-flex items-center gap-0.5 text-green-700 dark:text-green-400"><CheckIcon className="h-3 w-3" />acknowledged</span> : <span>not acknowledged yet</span>}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-xs">{r.status === "completed" || r.status === "signoff" ? formatScore(r.finalScore, r.scaleMax) : "—"}</td>
                  <td className="px-3 py-2 text-right">
                    {r.status !== "cancelled" && (
                      <div className="flex justify-end gap-1">
                        <Button asChild size="sm" variant={r.status === "signoff" ? "default" : "outline"} className="h-7 text-xs"><Link href={`/dashboard/human-resources/performance/review/${r.id}`}>{r.status === "signoff" ? "Sign off" : "Open"}</Link></Button>
                        {open && r.status !== "completed" && <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground hover:text-destructive" disabled={busy} onClick={() => confirm(`Cancel ${r.employeeName}'s review?`) && run(() => cancelReview(r.id), "Review cancelled")}>Cancel</Button>}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Sheet open={addOpen} onOpenChange={setAddOpen}>
        <SheetFormContent className="w-full max-w-xl!">
          <SheetHeader className="mb-4 px-0"><SheetTitle>Add people to {period.name}</SheetTitle><SheetDescription>They get the same review form as everyone already in this period, even if its template has been changed since. They can be in any of your companies.</SheetDescription></SheetHeader>
          <EmployeePicker employees={employees} value={picked} onChange={setPicked} excludeIds={haveIds} />
          <div className="mt-4 flex gap-2">
            <Button className="flex-1" disabled={busy || Object.keys(picked).length === 0}
              onClick={() => run(() => addReviewsToPeriod(period.id, Object.entries(picked).map(([userId, v]) => ({ userId, reviewerUserId: v.reviewerUserId, purpose: v.purpose, organizationId: v.organizationId, leadWeight: v.leadWeight, coReviewers: v.coReviewers }))), "Reviews opened").then(() => setAddOpen(false))}>
              Add {Object.keys(picked).length || ""}
            </Button>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
          </div>
        </SheetFormContent>
      </Sheet>
    </div>
  );
}
