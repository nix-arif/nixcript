"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { saveSelfReview, saveManagerReview, signOffReview, acknowledgeReview, returnReviewToManager, reassignReviewer, type EligibleEmployee, type ReviewView } from "@/server/performance";
import { formatScore, OUTCOMES, PURPOSES, RATING_WORDS, ratingWord, weightedScore, type ActionPlanRow, type PreviousGoal, type ReviewOutcome, type ReviewStatus } from "@/lib/performance/core";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowLeftIcon, CheckIcon, PlusIcon, TrashIcon } from "lucide-react";
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

function RatingPicker({ value, na, max, onChange, onNa }: { value: number | null; na: boolean; max: number; onChange: (n: number) => void; onNa: () => void }) {
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-1.5" role="radiogroup">
        {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
          <button key={n} type="button" role="radio" aria-checked={value === n} title={ratingWord(n, max)} onClick={() => onChange(n)}
            className={`h-9 min-w-9 rounded-lg border px-2 text-sm tabular-nums transition-colors ${value === n && !na ? "border-indigo-500 bg-indigo-500 font-semibold text-white" : "border-border hover:bg-muted/40"}`}>{n}</button>
        ))}
        <button type="button" role="radio" aria-checked={na} title="Not applicable" onClick={onNa}
          className={`h-9 min-w-9 rounded-lg border px-2 text-sm transition-colors ${na ? "border-slate-500 bg-slate-500 font-semibold text-white" : "border-border text-muted-foreground hover:bg-muted/40"}`}>N/A</button>
      </div>
      <div className="h-4 text-[11px] text-muted-foreground">{na ? "Not applicable" : value ? ratingWord(value, max) : "Not rated"}</div>
    </div>
  );
}

function ReadRating({ label, rating, na, comment, max }: { label: string; rating: number | null; na?: boolean; comment: string | null; max: number }) {
  return (
    <div className="rounded-lg bg-muted/30 px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-sm">{na ? <span className="text-muted-foreground">Not applicable</span> : rating ? <><span className="font-semibold tabular-nums">{rating}</span> <span className="text-muted-foreground">/ {max} · {ratingWord(rating, max)}</span></> : <span className="text-muted-foreground">Not rated</span>}</div>
      {comment && <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{comment}</p>}
    </div>
  );
}

// a description with several lines is a list of points (as on the paper form)
function Points({ text }: { text: string }) {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length <= 1) return <p className="mt-0.5 text-xs text-muted-foreground">{text}</p>;
  return <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">{lines.map((l, i) => <li key={i}>{l}</li>)}</ul>;
}

function Card({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-background p-4 space-y-3">
      <div><h2 className="text-sm font-semibold">{title}</h2>{hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}</div>
      {children}
    </section>
  );
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return <div><div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div><div className="mt-0.5 text-sm">{value || <span className="text-muted-foreground">—</span>}</div></div>;
}

export function ReviewFormClient({ view, people }: { view: ReviewView; people: EligibleEmployee[] }) {
  const router = useRouter();
  const side: "self" | "manager" | null = view.canEdit ? (view.role === "employee" ? "self" : "manager") : null;
  const [ratings, setRatings] = useState<Record<string, number | null>>(() => Object.fromEntries(view.criteria.map((c) => [c.id, side === "self" ? view.answers[c.id].selfRating : side === "manager" ? view.answers[c.id].managerRating : null])));
  const [comments, setComments] = useState<Record<string, string>>(() => Object.fromEntries(view.criteria.map((c) => [c.id, (side === "self" ? view.answers[c.id].selfComment : side === "manager" ? view.answers[c.id].managerComment : "") ?? ""])));
  const [na, setNa] = useState<Record<string, boolean>>(() => Object.fromEntries(view.criteria.map((c) => [c.id, side === "self" ? view.answers[c.id].selfNa : side === "manager" ? view.answers[c.id].managerNa : false])));
  const [summary, setSummary] = useState((side === "self" ? view.selfSummary : side === "manager" ? view.managerSummary : "") ?? "");
  // the employee's written parts
  const [qa, setQa] = useState<Record<string, string>>(() => ({ ...view.questionAnswers }));
  const [goals, setGoals] = useState<PreviousGoal[]>(() => (view.previousGoals.length ? view.previousGoals : [{ goal: "", action: "", completed: "", comments: "" }]));
  // the reviewer's part: outcome, next review date, goals for the next period
  const [outcome, setOutcome] = useState<ReviewOutcome | "">(view.outcome ?? "");
  const [nextReview, setNextReview] = useState(view.nextReviewDate ?? "");
  const [plan, setPlan] = useState<ActionPlanRow[]>(() => (view.actionPlan.length ? view.actionPlan : [{ goal: "", action: "", targetDate: "" }]));
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
  const rated = view.criteria.filter((c) => ratings[c.id] != null || na[c.id]).length;

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    setBusy(true);
    try { const r = await fn(); if (!r.ok) { toast.error(r.error, { duration: 8000 }); return false; } toast.success(success); router.refresh(); return true; }
    catch (e: any) { toast.error(e.message); return false; } finally { setBusy(false); }
  }
  const payload = (submit: boolean) => ({
    submit, summary,
    answers: view.criteria.map((c) => ({ criterionId: c.id, rating: na[c.id] ? null : ratings[c.id] ?? null, na: !!na[c.id], comment: comments[c.id] })),
  });
  const selfPayload = (submit: boolean) => ({ ...payload(submit), questionAnswers: qa, previousGoals: goals });
  const managerPayload = (submit: boolean) => ({ ...payload(submit), outcome: outcome || null, nextReviewDate: nextReview || null, actionPlan: plan });

  const save = (submit: boolean) => {
    if (submit && !confirm(side === "self" ? "Submit your self-assessment to your manager? You can't change it afterwards." : "Submit your review for HR sign-off? You can't change it unless HR sends it back.")) return;
    const call = () => (side === "self" ? saveSelfReview(view.id, selfPayload(submit)) : saveManagerReview(view.id, managerPayload(submit)));
    run(call, submit ? "Submitted" : "Draft saved").then((okay) => { if (okay && submit) router.push(side === "self" ? "/dashboard/human-resources/performance" : "/dashboard/human-resources/performance/team"); });
  };

  const showSelf = view.criteria.some((c) => view.answers[c.id].selfRating != null || view.answers[c.id].selfNa) || view.selfSummary != null || view.previousGoals.length > 0 || Object.values(view.questionAnswers).some(Boolean);
  const showManager = view.status === "completed" || (view.role !== "employee" && (view.criteria.some((c) => view.answers[c.id].managerRating != null || view.answers[c.id].managerNa) || view.managerSummary != null || view.outcome != null));
  const showB = side === "manager" || showManager; // Section B of the form
  const seeEmployeeParts = side === "self" || view.role === "employee" || showSelf;
  const fmtRange = view.periodStart ? `${fmtDate(view.periodStart)} to ${fmtDate(view.periodEnd)}` : "";
  const patchGoal = (i: number, p: Partial<PreviousGoal>) => setGoals((g) => g.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const patchPlan = (i: number, p: Partial<ActionPlanRow>) => setPlan((g) => g.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const inputCls = "h-8 text-xs";

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

      {/* ── details (header of the form) ── */}
      <Card title="Review details">
        <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          <Detail label="Employee's full name" value={view.employeeName} />
          <Detail label="Designation" value={view.employeeDesignation} />
          <Detail label="Department" value={view.employeeDepartment} />
          <Detail label="Purpose of review" value={view.purpose ? PURPOSES[view.purpose] : null} />
          <Detail label="Reviewer" value={view.reviewerName} />
          <Detail label="Reviewer's designation" value={view.reviewerDesignation} />
          <Detail label="Review period" value={<>{view.periodName}{fmtRange && <span className="text-muted-foreground"> · {fmtRange}</span>}</>} />
        </div>
      </Card>

      {/* ── Section A: goals of the last review, then the written questions ── */}
      {(side === "self" || (seeEmployeeParts && view.previousGoals.length > 0)) && (
        <Card title="Progress towards the goals identified in your last performance review" hint={side === "self" ? "If applicable. The goals from your last review are listed; say what you did and whether each was completed." : undefined}>
          {side === "self" ? (
            <div className="space-y-2">
              {goals.map((g, i) => (
                <div key={i} className="rounded-lg border border-border p-2.5 space-y-2">
                  <div className="flex gap-2">
                    <Input className={`${inputCls} flex-1`} value={g.goal} onChange={(e) => patchGoal(i, { goal: e.target.value })} placeholder="Goal" />
                    <select className="h-8 rounded-md border border-input bg-background px-2 text-xs" value={g.completed} onChange={(e) => patchGoal(i, { completed: e.target.value as PreviousGoal["completed"] })} aria-label="Completed?">
                      <option value="">Completed?</option><option value="Y">Yes</option><option value="N">No</option>
                    </select>
                    <Button variant="ghost" size="icon" className="h-8 w-7 text-muted-foreground hover:text-destructive" onClick={() => setGoals((gs) => gs.filter((_, j) => j !== i))} aria-label="Remove goal"><TrashIcon className="h-3.5 w-3.5" /></Button>
                  </div>
                  <Input className={inputCls} value={g.action} onChange={(e) => patchGoal(i, { action: e.target.value })} placeholder="Action taken" />
                  <Input className={inputCls} value={g.comments} onChange={(e) => patchGoal(i, { comments: e.target.value })} placeholder="Comments" />
                </div>
              ))}
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setGoals((gs) => [...gs, { goal: "", action: "", completed: "", comments: "" }])}><PlusIcon className="h-3.5 w-3.5" />Add goal</Button>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-xs">
                <thead className="bg-muted/40 text-left text-[10px] uppercase tracking-wide text-muted-foreground"><tr><th className="px-2.5 py-1.5">Goal</th><th className="px-2.5 py-1.5">Action taken</th><th className="px-2.5 py-1.5">Completed?</th><th className="px-2.5 py-1.5">Comments</th></tr></thead>
                <tbody className="divide-y divide-border/60">
                  {view.previousGoals.map((g, i) => <tr key={i} className="align-top"><td className="px-2.5 py-1.5">{g.goal}</td><td className="px-2.5 py-1.5">{g.action || "—"}</td><td className="px-2.5 py-1.5">{g.completed === "Y" ? "Yes" : g.completed === "N" ? "No" : "—"}</td><td className="px-2.5 py-1.5">{g.comments || "—"}</td></tr>)}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {view.questions.map((q) => (
        (side === "self" || seeEmployeeParts) && (
          <Card key={q.id} title={q.label} hint={q.help || undefined}>
            {side === "self"
              ? <Textarea rows={4} value={qa[q.id] ?? ""} onChange={(e) => setQa((m) => ({ ...m, [q.id]: e.target.value }))} placeholder="Your answer" />
              : <p className="whitespace-pre-wrap rounded-lg bg-muted/30 px-3 py-2 text-sm">{view.questionAnswers[q.id] || <span className="text-muted-foreground">No answer</span>}</p>}
          </Card>
        )
      ))}

      {/* ── core competencies ── */}
      <div className="rounded-lg border border-border bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground">
        <span className="font-semibold text-foreground">Rating scale: </span>
        {RATING_WORDS[view.scaleMax]?.map((w, i) => `${i + 1} = ${w}`).join(" · ")} · N/A = Not applicable
      </div>
      {sections.map((sec) => (
        <section key={sec.name} className="space-y-3">
          <h2 className="text-sm font-semibold">{sec.name}</h2>
          {sec.items.map((c) => {
            const a = view.answers[c.id];
            return (
              <div key={c.id} className="rounded-xl border border-border bg-background p-4 space-y-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2"><span className="text-sm font-medium">{c.name}</span>{c.weight !== 1 && <span className="rounded-md border border-border px-1.5 py-px text-[10px] text-muted-foreground">weight {c.weight}</span>}</div>
                  {c.description && <Points text={c.description} />}
                </div>

                {side === "manager" && <ReadRating label={`${view.employeeName}'s own rating`} rating={a.selfRating} na={a.selfNa} comment={a.selfComment} max={view.scaleMax} />}
                {side ? (
                  <div className="space-y-2">
                    <RatingPicker value={ratings[c.id] ?? null} na={!!na[c.id]} max={view.scaleMax}
                      onChange={(n) => { setRatings((r) => ({ ...r, [c.id]: n })); setNa((m) => ({ ...m, [c.id]: false })); }}
                      onNa={() => { setNa((m) => ({ ...m, [c.id]: !m[c.id] })); setRatings((r) => ({ ...r, [c.id]: null })); }} />
                    <Textarea rows={2} className="text-sm" value={comments[c.id] ?? ""} onChange={(e) => setComments((m) => ({ ...m, [c.id]: e.target.value }))} placeholder={side === "self" ? "Examples or comments (optional)" : "Your comments on this criterion (optional)"} />
                  </div>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {(showSelf || view.role === "employee") && <ReadRating label={view.role === "employee" ? "My rating" : "Self-assessment"} rating={a.selfRating} na={a.selfNa} comment={a.selfComment} max={view.scaleMax} />}
                    {showManager && <ReadRating label="Manager" rating={a.managerRating} na={a.managerNa} comment={a.managerComment} max={view.scaleMax} />}
                  </div>
                )}
              </div>
            );
          })}
        </section>
      ))}

      {/* ── summaries ── */}
      <section className="rounded-xl border border-border bg-background p-4 space-y-3">
        <h2 className="text-sm font-semibold">{side === "manager" || (!side && showManager && view.role !== "employee") ? "Reviewer's comments" : "Other comments"}</h2>
        {side ? (
          <div className="space-y-1.5">
            <Label>{side === "self" ? "Anything else you would like to say (optional)" : `Reviewer's comments on ${view.employeeName}`}{side === "manager" && <span className="text-destructive"> *</span>}</Label>
            <Textarea rows={5} value={summary} onChange={(e) => setSummary(e.target.value)} />
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {(showSelf || view.role === "employee") && <div className="rounded-lg bg-muted/30 px-3 py-2"><div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{view.role === "employee" ? "My summary" : "Self-assessment"}</div><p className="mt-1 whitespace-pre-wrap text-sm">{view.selfSummary || <span className="text-muted-foreground">None</span>}</p></div>}
            {showManager && <div className="rounded-lg bg-muted/30 px-3 py-2"><div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Manager</div><p className="mt-1 whitespace-pre-wrap text-sm">{view.managerSummary || <span className="text-muted-foreground">None</span>}</p></div>}
          </div>
        )}
      </section>

      {/* ── Section B: to be completed by the reviewer ── */}
      {showB && (
        <>
          <Card title="Overall review outcome" hint="Section B: completed by the reviewer">
            {side === "manager" ? (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Overall review outcome">
                  {(Object.keys(OUTCOMES) as ReviewOutcome[]).map((k) => (
                    <button key={k} type="button" role="radio" aria-checked={outcome === k} onClick={() => setOutcome(k)}
                      className={`rounded-lg border px-3 py-2 text-sm ${outcome === k ? "border-indigo-500 bg-indigo-50 font-semibold dark:bg-indigo-900/20" : "border-border hover:bg-muted/30"}`}>{OUTCOMES[k]}</button>
                  ))}
                </div>
                <div className="max-w-xs space-y-1.5"><Label>Next review date</Label><Input type="date" value={nextReview} onChange={(e) => setNextReview(e.target.value)} /></div>
              </div>
            ) : (
              <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                <Detail label="Outcome" value={view.outcome ? OUTCOMES[view.outcome] : null} />
                <Detail label="Next review date" value={view.nextReviewDate ? fmtDate(view.nextReviewDate) : null} />
              </div>
            )}
          </Card>

          <Card title="Action plan (goals for the next review period)">
            {side === "manager" ? (
              <div className="space-y-2">
                {plan.map((g, i) => (
                  <div key={i} className="rounded-lg border border-border p-2.5 space-y-2">
                    <div className="flex gap-2">
                      <Input className={`${inputCls} flex-1`} value={g.goal} onChange={(e) => patchPlan(i, { goal: e.target.value })} placeholder="Goal" />
                      <Input type="date" className={`${inputCls} w-36`} value={g.targetDate} onChange={(e) => patchPlan(i, { targetDate: e.target.value })} aria-label="Target date of completion" title="Target date of completion" />
                      <Button variant="ghost" size="icon" className="h-8 w-7 text-muted-foreground hover:text-destructive" onClick={() => setPlan((ps) => ps.filter((_, j) => j !== i))} aria-label="Remove row"><TrashIcon className="h-3.5 w-3.5" /></Button>
                    </div>
                    <Input className={inputCls} value={g.action} onChange={(e) => patchPlan(i, { action: e.target.value })} placeholder="Action required" />
                  </div>
                ))}
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setPlan((ps) => [...ps, { goal: "", action: "", targetDate: "" }])}><PlusIcon className="h-3.5 w-3.5" />Add goal</Button>
              </div>
            ) : view.actionPlan.length === 0 ? (
              <p className="text-xs text-muted-foreground">No goals set.</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40 text-left text-[10px] uppercase tracking-wide text-muted-foreground"><tr><th className="px-2.5 py-1.5">Goal</th><th className="px-2.5 py-1.5">Action required</th><th className="px-2.5 py-1.5">Target date</th></tr></thead>
                  <tbody className="divide-y divide-border/60">
                    {view.actionPlan.map((g, i) => <tr key={i} className="align-top"><td className="px-2.5 py-1.5">{g.goal}</td><td className="px-2.5 py-1.5">{g.action || "—"}</td><td className="px-2.5 py-1.5 whitespace-nowrap">{g.targetDate ? fmtDate(g.targetDate) : "—"}</td></tr>)}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}

      {/* ── signatures: who confirmed it and when ── */}
      {view.status === "completed" && (
        <Card title="Signatures">
          <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            <Detail label="Employee" value={view.acknowledgedAt ? `${view.employeeName} · acknowledged on ${fmtDate(view.acknowledgedAt)}` : <span className="text-muted-foreground">Not acknowledged yet</span>} />
            <Detail label="Reviewer" value={view.managerSubmittedAt ? `${view.reviewerName ?? "Reviewer"} · submitted on ${fmtDate(view.managerSubmittedAt)}` : null} />
          </div>
          {view.canAcknowledge && (
            <div className="rounded-lg border border-green-200 bg-green-50/60 px-3 py-2.5 dark:border-green-800 dark:bg-green-900/10">
              <p className="text-xs text-muted-foreground">Please read the review above. Acknowledging confirms you have read it; it does not mean you agree with every rating.</p>
              <Button className="mt-2" size="sm" disabled={busy} onClick={() => run(() => acknowledgeReview(view.id), "Acknowledged")}>I have read this review</Button>
            </div>
          )}
        </Card>
      )}

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
