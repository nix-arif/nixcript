"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { saveSelfReview, saveManagerReview, signOffReview, returnReviewToManager, reassignReviewer, type EligibleEmployee, type ReviewView } from "@/server/performance";
import { formatScore, ratingWord, weightedScore, type ReviewStatus } from "@/lib/performance/core";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowLeftIcon, CheckIcon } from "lucide-react";
import { ReviewStatusBadge } from "../../status-badge";

const fmtDate = (d: Date | string | null) => (d ? new Date(d).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" }) : "");
const STEPS: { key: ReviewStatus; label: string }[] = [
  { key: "self", label: "Self-assessment" }, { key: "manager", label: "Manager review" }, { key: "signoff", label: "HR sign-off" }, { key: "completed", label: "Completed" },
];

function Stepper({ status }: { status: ReviewStatus }) {
  const at = STEPS.findIndex((s) => s.key === status);
  return (
    <ol className="flex flex-wrap items-center gap-x-1 gap-y-1.5 text-xs">
      {STEPS.map((s, i) => {
        const done = i < at || status === "completed";
        const now = i === at && status !== "completed";
        return (
          <li key={s.key} className="flex items-center gap-1">
            <span className={`flex h-5 w-5 items-center justify-center rounded-full border text-[10px] ${done ? "border-green-500 bg-green-500 text-white" : now ? "border-indigo-500 bg-indigo-500 text-white" : "border-border text-muted-foreground"}`}>
              {done ? <CheckIcon className="h-3 w-3" /> : i + 1}
            </span>
            <span className={now ? "font-semibold" : "text-muted-foreground"}>{s.label}</span>
            {i < STEPS.length - 1 && <span className="mx-1 h-px w-4 bg-border" />}
          </li>
        );
      })}
    </ol>
  );
}

function RatingPicker({ value, max, onChange }: { value: number | null; max: number; onChange: (n: number) => void }) {
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-1.5" role="radiogroup">
        {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
          <button key={n} type="button" role="radio" aria-checked={value === n} title={ratingWord(n, max)} onClick={() => onChange(n)}
            className={`h-9 min-w-9 rounded-lg border px-2 text-sm tabular-nums transition-colors ${value === n ? "border-indigo-500 bg-indigo-500 font-semibold text-white" : "border-border hover:bg-muted/40"}`}>{n}</button>
        ))}
      </div>
      <div className="h-4 text-[11px] text-muted-foreground">{value ? ratingWord(value, max) : "Not rated"}</div>
    </div>
  );
}

function ReadRating({ label, rating, comment, max }: { label: string; rating: number | null; comment: string | null; max: number }) {
  return (
    <div className="rounded-lg bg-muted/30 px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-sm">{rating ? <><span className="font-semibold tabular-nums">{rating}</span> <span className="text-muted-foreground">/ {max} · {ratingWord(rating, max)}</span></> : <span className="text-muted-foreground">Not rated</span>}</div>
      {comment && <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{comment}</p>}
    </div>
  );
}

export function ReviewFormClient({ view, people }: { view: ReviewView; people: EligibleEmployee[] }) {
  const router = useRouter();
  const side: "self" | "manager" | null = view.canEdit ? (view.role === "employee" ? "self" : "manager") : null;
  const [ratings, setRatings] = useState<Record<string, number | null>>(() => Object.fromEntries(view.criteria.map((c) => [c.id, side === "self" ? view.answers[c.id].selfRating : side === "manager" ? view.answers[c.id].managerRating : null])));
  const [comments, setComments] = useState<Record<string, string>>(() => Object.fromEntries(view.criteria.map((c) => [c.id, (side === "self" ? view.answers[c.id].selfComment : side === "manager" ? view.answers[c.id].managerComment : "") ?? ""])));
  const [summary, setSummary] = useState((side === "self" ? view.selfSummary : side === "manager" ? view.managerSummary : "") ?? "");
  const [busy, setBusy] = useState(false);
  const [signComment, setSignComment] = useState("");
  const [backOpen, setBackOpen] = useState(false);
  const [backNote, setBackNote] = useState("");

  const liveScore = useMemo(() => weightedScore(view.criteria, ratings), [view.criteria, ratings]);
  const sections = useMemo(() => {
    const out: { name: string; items: typeof view.criteria }[] = [];
    for (const c of view.criteria) {
      const name = c.section || "General";
      const g = out.find((x) => x.name === name);
      if (g) g.items.push(c); else out.push({ name, items: [c] });
    }
    return out;
  }, [view]);
  const rated = view.criteria.filter((c) => ratings[c.id] != null).length;

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    setBusy(true);
    try { const r = await fn(); if (!r.ok) { toast.error(r.error, { duration: 8000 }); return false; } toast.success(success); router.refresh(); return true; }
    catch (e: any) { toast.error(e.message); return false; } finally { setBusy(false); }
  }
  const payload = (submit: boolean) => ({ submit, summary, answers: view.criteria.map((c) => ({ criterionId: c.id, rating: ratings[c.id] ?? null, comment: comments[c.id] })) });

  const save = (submit: boolean) => {
    if (submit && !confirm(side === "self" ? "Submit your self-assessment to your manager? You can't change it afterwards." : "Submit your review for HR sign-off? You can't change it unless HR sends it back.")) return;
    const fn = side === "self" ? saveSelfReview : saveManagerReview;
    run(() => fn(view.id, payload(submit)), submit ? "Submitted" : "Draft saved").then((okay) => { if (okay && submit) router.push(side === "self" ? "/dashboard/human-resources/performance" : "/dashboard/human-resources/performance/team"); });
  };

  const showSelf = view.criteria.some((c) => view.answers[c.id].selfRating != null) || view.selfSummary != null;
  const showManager = view.status === "completed" || (view.role !== "employee" && view.criteria.some((c) => view.answers[c.id].managerRating != null));

  return (
    <div className="p-4 sm:p-6 max-w-4xl space-y-5">
      <PageHeader
        title={view.role === "employee" ? "My performance review" : `Review of ${view.employeeName}`}
        description={`${view.periodName} · ${view.templateName}`}
        action={<Button asChild variant="outline" size="sm" className="gap-1.5"><Link href={view.role === "hr" ? "/dashboard/human-resources/performance/periods" : view.role === "reviewer" ? "/dashboard/human-resources/performance/team" : "/dashboard/human-resources/performance"}><ArrowLeftIcon className="h-3.5 w-3.5" />Back</Link></Button>}
      />

      <div className="rounded-xl border border-border bg-background p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <ReviewStatusBadge status={view.status} />
          <span className="text-xs text-muted-foreground">Employee: <span className="font-medium text-foreground">{view.employeeName}</span> · Reviewer: <span className="font-medium text-foreground">{view.reviewerName ?? "not assigned"}</span></span>
          {!view.periodOpen && <span className="rounded-md border border-border px-1.5 py-px text-[10px] text-muted-foreground">Period closed</span>}
        </div>
        <Stepper status={view.status} />
        {view.status === "completed" && (
          <div className="flex flex-wrap items-center gap-4 rounded-lg bg-green-50 px-4 py-3 dark:bg-green-900/10">
            <div><div className="text-[10px] font-semibold uppercase tracking-wide text-green-800 dark:text-green-300">Final score</div><div className="text-2xl font-semibold tabular-nums">{formatScore(view.finalScore, view.scaleMax)}</div></div>
            <div className="text-xs text-muted-foreground">Signed off{view.signedOffByName ? ` by ${view.signedOffByName}` : ""} on {fmtDate(view.signedOffAt)}{view.signoffComment ? <><br />&ldquo;{view.signoffComment}&rdquo;</> : null}</div>
          </div>
        )}
        {view.returnNote && view.status === "manager" && <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-200"><span className="font-semibold">Sent back by HR:</span> {view.returnNote}</div>}
        {view.role === "employee" && view.status === "manager" && <p className="text-xs text-muted-foreground">Your self-assessment was submitted. It is with your manager now.</p>}
        {view.role === "employee" && view.status === "signoff" && <p className="text-xs text-muted-foreground">Your manager has finished. HR is signing it off; you can read the result once it is completed.</p>}
      </div>

      {/* ── criteria ── */}
      {sections.map((sec) => (
        <section key={sec.name} className="space-y-3">
          <h2 className="text-sm font-semibold">{sec.name}</h2>
          {sec.items.map((c) => {
            const a = view.answers[c.id];
            return (
              <div key={c.id} className="rounded-xl border border-border bg-background p-4 space-y-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2"><span className="text-sm font-medium">{c.name}</span>{c.weight !== 1 && <span className="rounded-md border border-border px-1.5 py-px text-[10px] text-muted-foreground">weight {c.weight}</span>}</div>
                  {c.description && <p className="mt-0.5 text-xs text-muted-foreground">{c.description}</p>}
                </div>

                {side === "manager" && <ReadRating label={`${view.employeeName}'s own rating`} rating={a.selfRating} comment={a.selfComment} max={view.scaleMax} />}
                {side ? (
                  <div className="space-y-2">
                    <RatingPicker value={ratings[c.id] ?? null} max={view.scaleMax} onChange={(n) => setRatings((r) => ({ ...r, [c.id]: n }))} />
                    <Textarea rows={2} className="text-sm" value={comments[c.id] ?? ""} onChange={(e) => setComments((m) => ({ ...m, [c.id]: e.target.value }))} placeholder={side === "self" ? "Examples or comments (optional)" : "Your comments on this criterion (optional)"} />
                  </div>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {(showSelf || view.role === "employee") && <ReadRating label={view.role === "employee" ? "My rating" : "Self-assessment"} rating={a.selfRating} comment={a.selfComment} max={view.scaleMax} />}
                    {showManager && <ReadRating label="Manager" rating={a.managerRating} comment={a.managerComment} max={view.scaleMax} />}
                  </div>
                )}
              </div>
            );
          })}
        </section>
      ))}

      {/* ── summaries ── */}
      <section className="rounded-xl border border-border bg-background p-4 space-y-3">
        <h2 className="text-sm font-semibold">Overall comments</h2>
        {side ? (
          <div className="space-y-1.5">
            <Label>{side === "self" ? "Summary of your year (achievements, challenges, goals)" : `Overall comment on ${view.employeeName}`}{side === "manager" && <span className="text-destructive"> *</span>}</Label>
            <Textarea rows={5} value={summary} onChange={(e) => setSummary(e.target.value)} />
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {(showSelf || view.role === "employee") && <div className="rounded-lg bg-muted/30 px-3 py-2"><div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{view.role === "employee" ? "My summary" : "Self-assessment"}</div><p className="mt-1 whitespace-pre-wrap text-sm">{view.selfSummary || <span className="text-muted-foreground">None</span>}</p></div>}
            {showManager && <div className="rounded-lg bg-muted/30 px-3 py-2"><div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Manager</div><p className="mt-1 whitespace-pre-wrap text-sm">{view.managerSummary || <span className="text-muted-foreground">None</span>}</p></div>}
          </div>
        )}
      </section>

      {/* ── actions ── */}
      {side && (
        <div className="sticky bottom-3 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-background/95 px-4 py-3 shadow-md backdrop-blur">
          <div className="text-xs text-muted-foreground">
            {rated} of {view.criteria.length} rated{side === "manager" && liveScore != null ? ` · score so far ${formatScore(liveScore, view.scaleMax)}` : ""}
          </div>
          <div className="ml-auto flex gap-2">
            <Button variant="outline" disabled={busy} onClick={() => save(false)}>Save draft</Button>
            <Button disabled={busy} onClick={() => save(true)}>{side === "self" ? "Submit to manager" : "Submit for sign-off"}</Button>
          </div>
        </div>
      )}

      {view.canSignOff && (
        <section className="rounded-xl border border-violet-200 bg-violet-50/40 p-4 space-y-3 dark:border-violet-800 dark:bg-violet-900/10">
          <div className="flex flex-wrap items-baseline gap-3"><h2 className="text-sm font-semibold">Sign-off</h2><span className="text-xs text-muted-foreground">Final score {formatScore(view.finalScore, view.scaleMax)}</span></div>
          <div className="space-y-1.5"><Label>Comment (optional, the employee can read it)</Label><Textarea rows={2} value={signComment} onChange={(e) => setSignComment(e.target.value)} /></div>
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy} onClick={() => confirm("Sign off this review? The employee will be able to read it.") && run(() => signOffReview(view.id, signComment), "Review signed off").then((okay) => okay && router.push("/dashboard/human-resources/performance/periods"))}>Sign off</Button>
            <Button variant="outline" disabled={busy} onClick={() => setBackOpen(true)}>Send back to manager</Button>
          </div>
        </section>
      )}

      {view.canReassign && (
        <section className="flex flex-wrap items-center gap-2 rounded-xl border border-border px-4 py-3 text-sm">
          <span className="text-xs text-muted-foreground">Reviewer</span>
          <select className="h-8 rounded-md border border-input bg-background px-2 text-xs" defaultValue="" disabled={busy}
            onChange={(e) => e.target.value && run(() => reassignReviewer(view.id, e.target.value), "Reviewer changed")}>
            <option value="">{view.reviewerName ? `${view.reviewerName} (change)` : "Assign a reviewer"}</option>
            {people.filter((p) => p.name !== view.employeeName).map((p) => <option key={p.userId} value={p.userId}>{p.name}</option>)}
          </select>
        </section>
      )}

      <Dialog open={backOpen} onOpenChange={setBackOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Send back to the manager</DialogTitle><DialogDescription>The manager is notified and can change the review. Say what to change.</DialogDescription></DialogHeader>
          <Textarea rows={3} value={backNote} onChange={(e) => setBackNote(e.target.value)} placeholder="e.g. Please explain the rating on Delivery" autoFocus />
          <DialogFooter>
            <Button variant="outline" onClick={() => setBackOpen(false)}>Cancel</Button>
            <Button disabled={busy || !backNote.trim()} onClick={() => run(() => returnReviewToManager(view.id, backNote), "Sent back").then((okay) => { if (okay) { setBackOpen(false); setBackNote(""); } })}>Send back</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
