"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangleIcon, ArrowRightIcon, CheckIcon, PencilIcon, SearchIcon, SparklesIcon, UserPlusIcon } from "lucide-react";
import { reassignReviewer, type EligibleEmployee, type PeriodDetail } from "@/server/performance";
import { sharePercent } from "@/lib/performance/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type Review = PeriodDetail["reviews"][number];

const pill = (pct: number, lead?: boolean) => (
  <span className={cn(
    "shrink-0 rounded-full px-1.5 py-px text-[10px] font-medium tabular-nums",
    lead ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300" : "bg-muted text-muted-foreground",
  )}>{pct}%</span>
);

// The Reviewer column: who reviews (lead + co-reviewers with their share),
// read-only. Changing the lead goes through a dialog with a search, a
// suggestion, a clear "from → to" and an explicit confirm — never a stray
// dropdown change.
export function ReviewerCell({ review: r, employees, editable, several, onChanged }: {
  review: Review;
  employees: EligibleEmployee[];
  editable: boolean;
  several: boolean;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const weights = [r.leadWeight, ...r.coReviewers.map((c) => c.weight)];
  const shared = r.coReviewers.length > 0;
  const unassigned = !r.reviewerUserId && r.status !== "cancelled" && r.status !== "completed";

  return (
    <div className="w-52 space-y-1">
      <div className="flex items-center gap-1.5">
        {r.reviewerUserId ? (
          <span className="min-w-0 flex-1 truncate text-xs font-medium" title={r.reviewerName ?? undefined}>{r.reviewerName}</span>
        ) : (
          <span className={cn("min-w-0 flex-1 text-xs", unassigned ? "font-medium text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>Not assigned</span>
        )}
        {shared && pill(sharePercent(r.leadWeight, weights), true)}
        {editable && (
          unassigned ? (
            <Button size="sm" variant="outline" className="h-6 gap-1 px-2 text-[11px] border-amber-400 text-amber-800 hover:bg-amber-50 dark:text-amber-300 dark:hover:bg-amber-950/30" onClick={() => setOpen(true)}>
              <UserPlusIcon className="h-3 w-3" /> Assign
            </Button>
          ) : (
            <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground" onClick={() => setOpen(true)} title="Change the lead reviewer" aria-label="Change the lead reviewer">
              <PencilIcon className="h-3 w-3" />
            </Button>
          )
        )}
      </div>
      {shared && (
        <ul className="ml-1 space-y-0.5 border-l-2 border-border pl-2" title="Co-reviewers and their share of the score (change them on the review)">
          {r.coReviewers.map((c) => (
            <li key={c.userId} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              {r.status === "manager" && (c.submitted
                ? <CheckIcon className="h-3 w-3 shrink-0 text-green-600" aria-label="Submitted" />
                : <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" aria-label="Not submitted yet" />)}
              <span className="min-w-0 flex-1 truncate">{c.name}</span>
              {pill(sharePercent(c.weight, weights))}
            </li>
          ))}
        </ul>
      )}
      {open && <ChangeReviewerDialog review={r} employees={employees} several={several} onClose={() => setOpen(false)} onChanged={onChanged} />}
    </div>
  );
}

function ChangeReviewerDialog({ review: r, employees, several, onClose, onChanged }: {
  review: Review;
  employees: EligibleEmployee[];
  several: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [q, setQ] = useState("");
  const [pick, setPick] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const coIds = useMemo(() => new Set(r.coReviewers.map((c) => c.userId)), [r.coReviewers]);
  const me = employees.find((e) => e.userId === r.employeeUserId);
  // The manager of the employee's department in the company keeping this review, else their usual one
  const suggested = me?.companies.find((c) => c.name === r.organizationName)?.defaultReviewer ?? me?.defaultReviewer ?? null;

  const candidates = useMemo(() => {
    const f = q.trim().toLowerCase();
    return employees
      .filter((e) => e.userId !== r.employeeUserId)
      .filter((e) => !f || `${e.name} ${e.email} ${e.departments.join(" ")} ${e.organizationName}`.toLowerCase().includes(f))
      .sort((a, b) => {
        // suggestion first, then the current lead, then by name
        const rank = (e: EligibleEmployee) => (e.userId === suggested?.userId ? 0 : e.userId === r.reviewerUserId ? 1 : 2);
        return rank(a) - rank(b) || a.name.localeCompare(b.name);
      });
  }, [employees, q, r.employeeUserId, r.reviewerUserId, suggested?.userId]);

  const picked = pick ? employees.find((e) => e.userId === pick) : null;
  const changed = !!pick && pick !== r.reviewerUserId;

  async function save() {
    if (!pick) return;
    setSaving(true);
    try {
      const res = await reassignReviewer(r.id, pick);
      if (!res.ok) { toast.error(res.error); return; }
      toast.success(r.reviewerUserId ? `Lead reviewer changed to ${picked?.name}` : `${picked?.name} assigned as reviewer`);
      onClose();
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !saving && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{r.reviewerUserId ? "Change the lead reviewer" : "Assign a reviewer"}</DialogTitle>
          <DialogDescription>
            For <span className="font-medium text-foreground">{r.employeeName}</span>
            {several && r.organizationName && <> · {r.organizationName}</>}
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <SearchIcon className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, email or department" className="h-9 pl-8 text-sm" />
        </div>

        <div className="max-h-72 overflow-auto rounded-md border divide-y" role="radiogroup" aria-label="Reviewer">
          {candidates.length === 0 && <p className="p-4 text-center text-xs text-muted-foreground">Nobody matches “{q.trim()}”.</p>}
          {candidates.map((e) => {
            const isCurrent = e.userId === r.reviewerUserId;
            const isCo = coIds.has(e.userId);
            const isSuggested = e.userId === suggested?.userId;
            const selected = pick === e.userId;
            return (
              <button
                key={e.userId}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={isCo || isCurrent}
                onClick={() => setPick(e.userId)}
                className={cn(
                  "flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors",
                  selected ? "bg-indigo-50 dark:bg-indigo-900/20" : "hover:bg-muted/50",
                  (isCo || isCurrent) && "cursor-not-allowed opacity-60 hover:bg-transparent",
                )}
              >
                <span className={cn("flex h-4 w-4 shrink-0 items-center justify-center rounded-full border", selected ? "border-indigo-600 bg-indigo-600" : "border-muted-foreground/40")}>
                  {selected && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{e.name}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {[e.departments.join(", "), several ? e.organizationName : null].filter(Boolean).join(" · ") || e.email}
                  </span>
                </span>
                {isCurrent && <span className="shrink-0 rounded-full bg-muted px-1.5 py-px text-[10px] font-medium text-muted-foreground">Current</span>}
                {isCo && <span className="shrink-0 rounded-full bg-muted px-1.5 py-px text-[10px] font-medium text-muted-foreground">Co-reviewer</span>}
                {isSuggested && !isCurrent && !isCo && (
                  <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-green-50 px-1.5 py-px text-[10px] font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
                    <SparklesIcon className="h-2.5 w-2.5" /> Dept. manager
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {coIds.size > 0 && (
          <p className="text-[11px] text-muted-foreground">Co-reviewers can&apos;t be made the lead here — take them off on the review first.</p>
        )}

        {changed && (
          <div className="space-y-2 rounded-md border bg-muted/30 p-2.5 text-xs">
            <div className="flex items-center gap-2">
              <span className={cn("truncate", r.reviewerUserId ? "text-muted-foreground line-through" : "italic text-muted-foreground")}>{r.reviewerName ?? "Not assigned"}</span>
              <ArrowRightIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate font-semibold">{picked?.name}</span>
            </div>
            {r.status === "manager" && (
              <p className="flex gap-1.5 text-amber-800 dark:text-amber-300">
                <AlertTriangleIcon className="mt-px h-3.5 w-3.5 shrink-0" />
                <span>This review is already with the reviewer. {picked?.name} will be notified to complete it{r.reviewerName ? `, and ${r.reviewerName} will no longer be the lead` : ""}.</span>
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" size="sm" disabled={saving} onClick={onClose}>Cancel</Button>
          <Button size="sm" disabled={!changed || saving} onClick={save}>
            {saving ? "Saving…" : !changed ? "Pick someone" : r.reviewerUserId ? `Change to ${picked?.name}` : `Assign ${picked?.name}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
