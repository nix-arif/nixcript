"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { addReviewsToPeriod, cancelReview, reassignReviewer, setReviewPeriodStatus, type EligibleEmployee, type PeriodDetail } from "@/server/performance";
import { formatScore } from "@/lib/performance/core";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ArrowLeftIcon, PlusIcon } from "lucide-react";
import { ReviewStatusBadge } from "../../status-badge";
import { EmployeePicker, type Picked } from "../employee-picker";

const fmt = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" });

export function PeriodDetailClient({ period, employees }: { period: PeriodDetail; employees: EligibleEmployee[] }) {
  const router = useRouter();
  const [addOpen, setAddOpen] = useState(false);
  const [picked, setPicked] = useState<Picked>({});
  const [busy, setBusy] = useState(false);
  const open = period.status === "open";
  const active = period.reviews.filter((r) => r.status !== "cancelled");
  const done = active.filter((r) => r.status === "completed").length;
  const haveIds = period.reviews.map((r) => r.employeeUserId);
  const refresh = () => router.refresh();

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>, success?: string) {
    setBusy(true);
    try { const r = await fn(); if (!r.ok) toast.error(r.error); else { if (success) toast.success(success); refresh(); } }
    catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="p-4 sm:p-6 max-w-5xl">
      <PageHeader
        title={period.name}
        description={`${fmt(period.startDate)} to ${fmt(period.endDate)} · ${done} of ${active.length} completed`}
        action={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm" className="gap-1.5"><Link href="/dashboard/human-resources/performance/periods"><ArrowLeftIcon className="h-3.5 w-3.5" />Periods</Link></Button>
            {open && <Button size="sm" variant="outline" className="gap-1.5" onClick={() => { setPicked({}); setAddOpen(true); }}><PlusIcon className="h-3.5 w-3.5" />Add people</Button>}
            <Button size="sm" variant={open ? "outline" : "default"} disabled={busy}
              onClick={() => { if (open && !confirm("Close this period? Nobody can edit or sign off its reviews until you reopen it.")) return; run(() => setReviewPeriodStatus(period.id, open ? "closed" : "open"), open ? "Period closed" : "Period reopened"); }}>
              {open ? "Close period" : "Reopen period"}
            </Button>
          </div>
        }
      />
      {!open && <div className="mb-4 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">This period is closed. Reviews cannot be edited or signed off until it is reopened.</div>}

      <div className="overflow-hidden rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr><th className="px-4 py-2 text-left font-medium">Employee</th><th className="px-4 py-2 text-left font-medium">Reviewer</th><th className="px-4 py-2 text-left font-medium">Status</th><th className="px-4 py-2 text-right font-medium">Score</th><th className="w-28" /></tr>
          </thead>
          <tbody>
            {period.reviews.map((r) => {
              const editable = open && (r.status === "self" || r.status === "manager");
              return (
                <tr key={r.id} className={`border-t border-border/60 ${r.status === "cancelled" ? "opacity-50" : ""}`}>
                  <td className="px-4 py-2 font-medium">{r.employeeName}</td>
                  <td className="px-4 py-2">
                    {editable ? (
                      <select className="h-8 max-w-44 rounded-md border border-input bg-background px-2 text-xs" value={r.reviewerUserId ?? ""} disabled={busy}
                        onChange={(e) => e.target.value && run(() => reassignReviewer(r.id, e.target.value), "Reviewer changed")}>
                        <option value="">{r.reviewerUserId ? "" : "Not assigned"}</option>
                        {employees.filter((x) => x.userId !== r.employeeUserId).map((x) => <option key={x.userId} value={x.userId}>{x.name}</option>)}
                      </select>
                    ) : <span className="text-xs">{r.reviewerName ?? <span className="text-muted-foreground">Not assigned</span>}</span>}
                    {!r.reviewerUserId && r.status !== "cancelled" && r.status !== "completed" && <div className="text-[10px] text-amber-700 dark:text-amber-400">Assign a reviewer</div>}
                  </td>
                  <td className="px-4 py-2"><ReviewStatusBadge status={r.status} short /></td>
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
        <SheetContent className="w-full max-w-xl! overflow-y-auto px-6 sm:px-8">
          <SheetHeader className="mb-4"><SheetTitle>Add people to {period.name}</SheetTitle><SheetDescription>They get a review with this period&apos;s template.</SheetDescription></SheetHeader>
          <EmployeePicker employees={employees} value={picked} onChange={setPicked} excludeIds={haveIds} />
          <div className="mt-4 flex gap-2">
            <Button className="flex-1" disabled={busy || Object.keys(picked).length === 0}
              onClick={() => run(() => addReviewsToPeriod(period.id, Object.entries(picked).map(([userId, v]) => ({ userId, reviewerUserId: v.reviewerUserId }))), "Reviews opened").then(() => setAddOpen(false))}>
              Add {Object.keys(picked).length || ""}
            </Button>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
