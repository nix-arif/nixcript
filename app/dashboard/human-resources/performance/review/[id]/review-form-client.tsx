"use client";

import { BackButton } from "@/components/back-button";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { saveSelfReview, saveManagerReview, signOffReview, acknowledgeReview, returnReviewToManager, reassignReviewer, resolveReviewDispute, reopenDisputedReview, setReviewReviewers, type EligibleEmployee, type EmployeeResponse, type ReviewView } from "@/server/performance";
import { formatScore, isExtreme, isOutcome, missingAnswers, missingExtremeComments, naAllowed, sharePercent, OUTCOMES, PURPOSES, RATING_WORDS, ratingWord, weightedScore, type ActionPlanRow, type PreviousGoal, type ReviewOutcome, type ReviewStatus } from "@/lib/performance/core";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowLeftIcon, CheckIcon, DownloadIcon, Loader2Icon, PlusIcon, TrashIcon, XIcon } from "lucide-react";
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

function RatingPicker({ value, na, max, onChange, onNa, allowNa = true }: { value: number | null; na: boolean; max: number; onChange: (n: number) => void; onNa: () => void; allowNa?: boolean }) {
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-1.5" role="radiogroup">
        {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
          <button key={n} type="button" role="radio" aria-checked={value === n} title={ratingWord(n, max)} onClick={() => onChange(n)}
            className={`h-9 min-w-9 rounded-lg border px-2 text-sm tabular-nums transition-colors ${value === n && !na ? "border-indigo-500 bg-indigo-500 font-semibold text-white" : "border-border hover:bg-muted/40"}`}>{n}</button>
        ))}
        {(allowNa || na) && <button type="button" role="radio" aria-checked={na} title="Not applicable" onClick={onNa}
          className={`h-9 min-w-9 rounded-lg border px-2 text-sm transition-colors ${na ? "border-slate-500 bg-slate-500 font-semibold text-white" : "border-border text-muted-foreground hover:bg-muted/40"}`}>N/A</button>}
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

// the reviewers' ratings of one criterion combined by share: a number with decimals, not one of the scale's words
function CombinedRating({ value, max, label = "Combined" }: { value: number | null; max: number; label?: string }) {
  return (
    <div className="rounded-lg border border-indigo-200 bg-indigo-50/50 px-3 py-2 dark:border-indigo-800 dark:bg-indigo-900/10">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-indigo-800 dark:text-indigo-300">{label}</div>
      <div className="mt-0.5 text-sm">{value == null ? <span className="text-muted-foreground">Not rated</span> : <><span className="font-semibold tabular-nums">{value.toFixed(2)}</span> <span className="text-muted-foreground">/ {max}</span></>}</div>
    </div>
  );
}

// HR: the reviewers besides the lead, and everyone's share of the score
function ReviewersEditor({ view, people, busy, onSave }: { view: ReviewView; people: EligibleEmployee[]; busy: boolean; onSave: (v: { leadWeight: number; coReviewers: { userId: string; weight: number }[] }) => void }) {
  const setup = view.reviewerSetup!;
  const [leadWeight, setLeadWeight] = useState(setup.leadWeight);
  const [co, setCo] = useState(setup.coReviewers.map((c) => ({ userId: c.userId, weight: c.weight })));
  const weights = [leadWeight, ...co.map((c) => c.weight)];
  const num = (v: string) => Math.max(1, Math.min(100, Math.round(Number(v) || 1)));
  const taken = new Set([...co.map((c) => c.userId)]);
  const pool = people.filter((p) => p.name !== view.employeeName && p.name !== view.reviewerName);
  const changed = JSON.stringify([leadWeight, co]) !== JSON.stringify([setup.leadWeight, setup.coReviewers.map((c) => ({ userId: c.userId, weight: c.weight }))]);
  const share = (w: number) => <span className="w-10 text-right tabular-nums text-muted-foreground">{sharePercent(w, weights)}%</span>;
  return (
    <section className="space-y-2 rounded-xl border border-border px-4 py-3 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 className="text-sm font-semibold">Reviewers and their share of the score</h2><span className="text-[11px] text-muted-foreground">Each reviewer rates every criterion; the final score combines their scores by share.</span></div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="min-w-40 font-medium">{view.reviewerName ?? "Lead reviewer"} <span className="font-normal text-muted-foreground">(lead)</span></span>
        <input type="number" min={1} max={100} className="h-7 w-16 rounded-md border border-input bg-background px-1.5 text-xs" value={leadWeight} onChange={(e) => setLeadWeight(num(e.target.value))} aria-label="Lead reviewer's share" />{share(leadWeight)}
      </div>
      {co.map((c, i) => {
        const was = setup.coReviewers.find((x) => x.userId === c.userId);
        return (
          <div key={i} className="flex flex-wrap items-center gap-2 text-xs">
            <select className="h-7 min-w-40 rounded-md border border-input bg-background px-2 text-xs" value={c.userId} onChange={(e) => setCo((l) => l.map((x, j) => (j === i ? { ...x, userId: e.target.value } : x)))} aria-label={`Reviewer ${i + 2}`}>
              {pool.filter((p) => p.userId === c.userId || !taken.has(p.userId)).map((p) => <option key={p.userId} value={p.userId}>{p.name}</option>)}
            </select>
            <input type="number" min={1} max={100} className="h-7 w-16 rounded-md border border-input bg-background px-1.5 text-xs" value={c.weight} onChange={(e) => setCo((l) => l.map((x, j) => (j === i ? { ...x, weight: num(e.target.value) } : x)))} aria-label={`Share of reviewer ${i + 2}`} />{share(c.weight)}
            {was?.submitted && <span className="text-[10px] text-green-700 dark:text-green-400">submitted</span>}
            <button type="button" className="text-muted-foreground hover:text-destructive" onClick={() => (!was?.submitted || confirm(`${was ? "Remove this reviewer? Their submitted marks are deleted." : ""}`)) && setCo((l) => l.filter((_, j) => j !== i))} aria-label="Remove reviewer"><XIcon className="h-3.5 w-3.5" /></button>
          </div>
        );
      })}
      <div className="flex flex-wrap items-center gap-3 pt-1">
        {co.length < 5 && view.reviewerName && (
          <button type="button" className="inline-flex items-center gap-1 text-xs text-muted-foreground underline hover:text-foreground"
            onClick={() => { const next = pool.find((p) => !taken.has(p.userId)); if (next) setCo((l) => [...l, { userId: next.userId, weight: leadWeight }]); }}>
            <PlusIcon className="h-3 w-3" />Add a reviewer
          </button>
        )}
        {!view.reviewerName && <span className="text-xs text-muted-foreground">Assign the lead reviewer first.</span>}
        {changed && <Button size="sm" className="ml-auto" disabled={busy} onClick={() => onSave({ leadWeight, coReviewers: co })}>Save reviewers</Button>}
      </div>
    </section>
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
  // with several reviewers: the lead writes Section B and submits; another reviewer ("co") gives only their own marks
  const isCo = view.role === "reviewer" && !view.isLead;
  const editB = side === "manager" && !isCo;
  const others = view.reviewers.filter((x) => !x.isLead && x.submittedAt); // the other reviewers' submitted marks
  const eachReviewer = view.reviewers.length > 0; // marks one by one are shown
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
  // the employee's answer to the signed-off review, and HR's way of settling a disagreement
  const [response, setResponse] = useState<EmployeeResponse | "">("");
  const [ackComment, setAckComment] = useState("");
  const [disputeAction, setDisputeAction] = useState<"keep" | "reopen" | null>(null);
  const [disputeNote, setDisputeNote] = useState("");
  const [downloading, setDownloading] = useState(false);

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
  // what is still missing when someone tries to submit: shown on the cards, not only in a message
  const [missing, setMissing] = useState<{ criteria: string[]; outcome: boolean; summary: boolean; comments: string[]; questions: string[]; nextReview: boolean; plan: boolean }>({ criteria: [], outcome: false, summary: false, comments: [], questions: [], nextReview: false, plan: false });
  const unrated = view.criteria.filter((c) => ratings[c.id] == null && !na[c.id]);
  // autosave: the form as it is now against the form as it was last saved
  const snapshot = JSON.stringify([ratings, na, comments, summary, qa, goals, outcome, nextReview, plan]);
  const [savedSnapshot, setSavedSnapshot] = useState(snapshot);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const dirty = !!side && snapshot !== savedSnapshot;
  const snapshotRef = useRef(snapshot);
  useEffect(() => { snapshotRef.current = snapshot; }, [snapshot]);

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

  const callSave = (submit: boolean) => (side === "self" ? saveSelfReview(view.id, selfPayload(submit)) : saveManagerReview(view.id, managerPayload(submit)));

  const goToFirstMissing = (ids: string[]) => {
    const el = ids.length ? document.getElementById(`crit-${ids[0]}`) : document.getElementById("section-b");
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const save = (submit: boolean) => {
    if (submit) {
      // say exactly what is missing, on the page, before asking the server
      const miss = {
        criteria: unrated.map((c) => c.id), outcome: editB && !outcome, summary: editB && !summary.trim(),
        // what the template made required
        comments: side === "manager" ? missingExtremeComments(view.criteria, Object.fromEntries(view.criteria.map((c) => [c.id, na[c.id] ? null : ratings[c.id]])), comments, view.scaleMax).map((c) => c.id) : [],
        questions: side === "self" ? missingAnswers(view.questions, qa).map((q) => q.id) : [],
        nextReview: editB && view.requireNextReviewDate && !nextReview,
        plan: editB && view.requireActionPlan && !plan.some((g) => g.goal.trim()),
      };
      setMissing(miss);
      if (miss.criteria.length > 0 || miss.outcome || miss.summary || miss.comments.length > 0 || miss.questions.length > 0 || miss.nextReview || miss.plan) {
        const bits = [
          miss.criteria.length > 0 && `${miss.criteria.length} not rated`, miss.comments.length > 0 && `${miss.comments.length} lowest / highest ${miss.comments.length === 1 ? "rating" : "ratings"} without a comment`,
          miss.questions.length > 0 && `${miss.questions.length} required ${miss.questions.length === 1 ? "question" : "questions"} not answered`,
          miss.outcome && "the overall outcome", miss.summary && "the reviewer's comments", miss.nextReview && "the next review date", miss.plan && "the action plan",
        ].filter(Boolean);
        toast.error(`Not ready to submit: ${bits.join(", ")}. They are marked on the page.`, { duration: 8000 });
        if (miss.criteria.length || miss.comments.length) goToFirstMissing(miss.criteria.length ? miss.criteria : miss.comments);
        else if (miss.questions.length) document.getElementById(`q-${miss.questions[0]}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
        else goToFirstMissing([]);
        return;
      }
      if (editB && view.waitingFor.length > 0) { toast.error(`Waiting for ${view.waitingFor.join(", ")} to submit their marks first. Save your draft meanwhile.`, { duration: 8000 }); return; }
      if (!confirm(side === "self" ? "Submit your self-assessment to your manager? You can't change it afterwards." : isCo ? "Submit your marks? You can't change them unless HR sends the review back." : "Submit your review for HR sign-off? You can't change it unless HR sends it back.")) return;
    }
    const sentSnapshot = snapshot;
    run(() => callSave(submit), submit ? "Submitted" : "Draft saved").then((okay) => {
      if (okay) { setSavedSnapshot(sentSnapshot); setSavedAt(new Date()); }
      if (okay && submit) router.push(side === "self" ? "/dashboard/human-resources/performance" : "/dashboard/human-resources/performance/team");
    });
  };

  // Draft autosave every 20 seconds while there are unsaved changes (quietly: no toast, only the "Saved" time in the bar)
  const autosaving = useRef(false);
  const autosave = useCallback(async () => {
    if (!side || autosaving.current) return;
    const sent = snapshotRef.current;
    if (sent === savedSnapshot) return;
    autosaving.current = true;
    try {
      const r = await callSave(false);
      if (r.ok) { setSavedSnapshot(sent); setSavedAt(new Date()); }
    } catch { /* the next tick tries again, and the Save draft button still shows the error */ }
    finally { autosaving.current = false; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [side, savedSnapshot, view.id]);
  useEffect(() => {
    if (!side) return;
    const t = setInterval(() => { if (!busy) void autosave(); }, 20000);
    return () => clearInterval(t);
  }, [side, busy, autosave]);
  // leaving with unsaved changes asks first
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // the PDF is made from the saved review, so unsaved changes are saved first (as a draft: nothing is submitted)
  async function downloadPdf() {
    setDownloading(true);
    try {
      if (dirty) {
        const sent = snapshot;
        const r = await callSave(false);
        if (!r.ok) throw new Error(`Your changes could not be saved, so the PDF was not made: ${r.error}`);
        setSavedSnapshot(sent); setSavedAt(new Date());
      }
      const res = await fetch(`/api/performance/review/${view.id}/pdf`);
      if (!res.ok) throw new Error((await res.text().catch(() => "")).trim() || `The PDF could not be downloaded (HTTP ${res.status}).`);
      const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? "Performance-Review.pdf";
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url; a.download = name; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The PDF could not be downloaded.");
    } finally {
      setDownloading(false);
    }
  }

  const showSelf = view.criteria.some((c) => view.answers[c.id].selfRating != null || view.answers[c.id].selfNa) || view.selfSummary != null || view.previousGoals.length > 0 || Object.values(view.questionAnswers).some(Boolean);
  const showManager = view.status === "completed" || (view.role !== "employee" && (view.criteria.some((c) => view.answers[c.id].managerRating != null || view.answers[c.id].managerNa) || view.managerSummary != null || view.outcome != null));
  const showB = editB || showManager; // Section B of the form
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
        action={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="gap-1.5" disabled={downloading} onClick={downloadPdf}
              title={dirty ? "Saves your changes as a draft, then downloads the PDF" : "Download this review as a PDF on the company letterhead"}>
              {downloading ? <Loader2Icon className="h-3.5 w-3.5 animate-spin" /> : <DownloadIcon className="h-3.5 w-3.5" />}PDF
            </Button>
            <BackButton fallback={view.role === "hr" ? "/dashboard/human-resources/performance/periods" : view.role === "reviewer" ? "/dashboard/human-resources/performance/team" : "/dashboard/human-resources/performance"} variant="outline" size="sm" className="gap-1.5"><ArrowLeftIcon className="h-3.5 w-3.5" />Back</BackButton>
          </div>
        }
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
            {view.scoreParts && <div className="w-full text-xs text-muted-foreground">Reviewers {formatScore(view.scoreParts.reviewers, view.scaleMax)} × {100 - view.selfShare}% + self-assessment {formatScore(view.scoreParts.self, view.scaleMax)} × {view.selfShare}%</div>}
            {eachReviewer && <div className="w-full text-xs text-muted-foreground">{view.reviewers.map((x) => `${x.name}${x.isLead ? " (lead)" : ""} ${formatScore(x.score, view.scaleMax)} × ${x.share}%`).join(" · ")}</div>}
            {!eachReviewer && view.multipleReviewers && <div className="w-full text-xs text-muted-foreground">Combined from the marks of {view.reviewers.length || "several"} reviewers.</div>}
          </div>
        )}
        {side === "self" && <p className="text-xs text-muted-foreground">{view.selfShare > 0 ? `Your own ratings count for ${view.selfShare}% of the final score; your reviewers' ratings count for ${100 - view.selfShare}%.` : "Your own ratings are not part of the final score: your reviewer sees them next to theirs, so explain them well."}</p>}
        {view.rounds.length > 0 && view.status === "manager" && view.role !== "employee" && (() => {
          const last = view.rounds[view.rounds.length - 1];
          return <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-900 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200"><span className="font-semibold">Reopened after {view.employeeName} disagreed</span> (round {last.round} score {formatScore(last.finalScore, view.scaleMax)}): &ldquo;{last.employeeComment}&rdquo;. Your earlier marks are filled in below; change what needs changing and submit again. The earlier round is kept at the bottom of the page.</div>;
        })()}
        {view.returnNote && view.status === "manager" && <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-200"><span className="font-semibold">Sent back by HR:</span> {view.returnNote}</div>}
        {view.role === "employee" && view.status === "manager" && <p className="text-xs text-muted-foreground">{view.rounds.length > 0 ? "HR has sent your review back to your manager after your disagreement. You will be notified when it is signed off again." : "Your self-assessment was submitted. It is with your manager now."}</p>}
        {isCo && view.status === "manager" && <p className="text-xs text-muted-foreground">You are one of the reviewers; {view.reviewerName ?? "the lead reviewer"} is the lead. {view.canEdit ? "Give your own marks: they are combined with the other reviewers' by share. The others' marks show once you have submitted yours." : "Your marks are submitted. The lead reviewer finishes the review."}</p>}
        {(view.isLead || view.role === "hr") && view.status === "manager" && view.waitingFor.length > 0 && <p className="text-xs text-amber-700 dark:text-amber-400">Waiting for marks from {view.waitingFor.join(", ")}.{view.isLead ? " You can submit for sign-off once they are in." : ""}</p>}
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
          <Card key={q.id} title={`${q.label}${q.required && side === "self" ? " *" : ""}`} hint={q.help || undefined}>
            {side === "self"
              ? <div id={`q-${q.id}`} className="space-y-1">
                  <Textarea rows={4} value={qa[q.id] ?? ""} onChange={(e) => setQa((m) => ({ ...m, [q.id]: e.target.value }))} placeholder={q.required ? "Your answer (required)" : "Your answer"}
                    className={missing.questions.includes(q.id) && !qa[q.id]?.trim() ? "border-red-400" : ""} />
                  {missing.questions.includes(q.id) && !qa[q.id]?.trim() && <p className="text-xs font-medium text-red-600">Answer this question to submit.</p>}
                </div>
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
              <div key={c.id} id={`crit-${c.id}`} className={`rounded-xl border bg-background p-4 space-y-3 ${missing.criteria.includes(c.id) && ratings[c.id] == null && !na[c.id] ? "border-red-400 ring-1 ring-red-300 dark:border-red-700" : "border-border"}`}>
                <div>
                  <div className="flex flex-wrap items-center gap-2"><span className="text-sm font-medium">{c.name}</span>{missing.criteria.includes(c.id) && ratings[c.id] == null && !na[c.id] && <span className="rounded-md bg-red-600 px-1.5 py-px text-[10px] font-semibold text-white">Not rated</span>}{c.weight !== 1 && <span className="rounded-md border border-border px-1.5 py-px text-[10px] text-muted-foreground">weight {c.weight}</span>}</div>
                  {c.description && <Points text={c.description} />}
                </div>

                {side === "manager" && <ReadRating label={`${view.employeeName}'s own rating`} rating={a.selfRating} na={a.selfNa} comment={a.selfComment} max={view.scaleMax} />}
                {editB && others.length > 0 && (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {others.map((x) => <ReadRating key={x.key} label={`${x.name} (${x.share}%)`} rating={x.answers[c.id]?.rating ?? null} na={x.answers[c.id]?.na} comment={x.answers[c.id]?.comment ?? null} max={view.scaleMax} />)}
                  </div>
                )}
                {side ? (
                  <div className="space-y-2">
                    <RatingPicker value={ratings[c.id] ?? null} na={!!na[c.id]} max={view.scaleMax} allowNa={naAllowed(c)}
                      onChange={(n) => { setRatings((r) => ({ ...r, [c.id]: n })); setNa((m) => ({ ...m, [c.id]: false })); }}
                      onNa={() => { setNa((m) => ({ ...m, [c.id]: !m[c.id] })); setRatings((r) => ({ ...r, [c.id]: null })); }} />
                    {(() => {
                      // the template asks a reviewer to say why they gave the lowest or highest rating
                      const needWhy = side === "manager" && !!c.commentOnExtremes && !na[c.id] && isExtreme(ratings[c.id], view.scaleMax);
                      const flagged = needWhy && missing.comments.includes(c.id) && !comments[c.id]?.trim();
                      return (
                        <>
                          <Textarea rows={2} className={`text-sm ${flagged ? "border-red-400" : ""}`} value={comments[c.id] ?? ""} onChange={(e) => setComments((m) => ({ ...m, [c.id]: e.target.value }))}
                            placeholder={side === "self" ? "Examples or comments (optional)" : needWhy ? `Required: why ${ratings[c.id]} (the ${ratings[c.id] === 1 ? "lowest" : "highest"} rating)?` : "Your comments on this criterion (optional)"} />
                          {needWhy && !comments[c.id]?.trim() && <p className={`text-xs ${flagged ? "font-medium text-red-600" : "text-amber-700 dark:text-amber-400"}`}>A comment is required for the lowest or highest rating on this criterion.</p>}
                        </>
                      );
                    })()}
                  </div>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {(showSelf || view.role === "employee") && <ReadRating label={view.role === "employee" ? "My rating" : "Self-assessment"} rating={a.selfRating} na={a.selfNa} comment={a.selfComment} max={view.scaleMax} />}
                    {showManager && !view.multipleReviewers && <ReadRating label="Manager" rating={a.managerRating} na={a.managerNa} comment={a.managerComment} max={view.scaleMax} />}
                    {showManager && eachReviewer && view.reviewers.map((x) => (
                      x.isLead || x.submittedAt
                        ? <ReadRating key={x.key} label={`${x.name}${x.isLead ? " (lead)" : ""} · ${x.share}%`} rating={x.answers[c.id]?.rating ?? null} na={x.answers[c.id]?.na} comment={x.answers[c.id]?.comment ?? null} max={view.scaleMax} />
                        : <div key={x.key} className="rounded-lg bg-muted/30 px-3 py-2 text-xs text-muted-foreground">{x.name}: not submitted yet</div>
                    ))}
                    {showManager && view.multipleReviewers && view.combined && <CombinedRating value={view.combined[c.id] ?? null} max={view.scaleMax} label={eachReviewer ? "Combined" : "Reviewers (combined)"} />}
                    {showManager && view.multipleReviewers && !eachReviewer && a.managerComment && <div className="rounded-lg bg-muted/30 px-3 py-2 text-xs text-muted-foreground sm:col-span-2"><span className="font-semibold uppercase tracking-wide text-[10px]">Lead reviewer</span><p className="mt-0.5 whitespace-pre-wrap">{a.managerComment}</p></div>}
                  </div>
                )}
              </div>
            );
          })}
        </section>
      ))}

      {/* ── summaries ── */}
      <section className="rounded-xl border border-border bg-background p-4 space-y-3">
        <h2 className="text-sm font-semibold">{side === "manager" || (!side && showManager && view.role !== "employee") ? (isCo ? "Your comments" : "Reviewer's comments") : "Other comments"}</h2>
        {side ? (
          <div className="space-y-1.5">
            <Label>{side === "self" ? "Anything else you would like to say (optional)" : isCo ? `Your comments on ${view.employeeName} (optional)` : `Reviewer's comments on ${view.employeeName}`}{editB && <span className="text-destructive"> *</span>}</Label>
            <Textarea rows={5} value={summary} onChange={(e) => setSummary(e.target.value)} className={missing.summary && !summary.trim() ? "border-red-400" : ""} />
            {missing.summary && !summary.trim() && <p className="text-xs font-medium text-red-600">Write the reviewer&apos;s comments to submit.</p>}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {(showSelf || view.role === "employee") && <div className="rounded-lg bg-muted/30 px-3 py-2"><div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{view.role === "employee" ? "My summary" : "Self-assessment"}</div><p className="mt-1 whitespace-pre-wrap text-sm">{view.selfSummary || <span className="text-muted-foreground">None</span>}</p></div>}
            {showManager && !eachReviewer && <div className="rounded-lg bg-muted/30 px-3 py-2"><div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{view.multipleReviewers ? "Lead reviewer" : "Manager"}</div><p className="mt-1 whitespace-pre-wrap text-sm">{view.managerSummary || <span className="text-muted-foreground">None</span>}</p></div>}
            {showManager && eachReviewer && view.reviewers.filter((x) => x.isLead || x.submittedAt).map((x) => <div key={x.key} className="rounded-lg bg-muted/30 px-3 py-2"><div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{x.name}{x.isLead ? " (lead)" : ""}</div><p className="mt-1 whitespace-pre-wrap text-sm">{x.summary || <span className="text-muted-foreground">None</span>}</p></div>)}
          </div>
        )}
      </section>

      {/* ── Section B: to be completed by the reviewer ── */}
      {showB && (
        <>
          <span id="section-b" />
          <Card title="Overall review outcome" hint="Section B: completed by the reviewer">
            {editB ? (
              <div className="space-y-3">
                {missing.outcome && !outcome && <p className="text-xs font-medium text-red-600">Choose the overall outcome to submit.</p>}
                <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Overall review outcome">
                  {(Object.keys(OUTCOMES) as ReviewOutcome[]).map((k) => (
                    <button key={k} type="button" role="radio" aria-checked={outcome === k} onClick={() => setOutcome(k)}
                      className={`rounded-lg border px-3 py-2 text-sm ${outcome === k ? "border-indigo-500 bg-indigo-50 font-semibold dark:bg-indigo-900/20" : "border-border hover:bg-muted/30"}`}>{OUTCOMES[k]}</button>
                  ))}
                </div>
                <div className="max-w-xs space-y-1.5"><Label>Next review date{view.requireNextReviewDate && <span className="text-destructive"> *</span>}</Label><Input type="date" value={nextReview} onChange={(e) => setNextReview(e.target.value)} className={missing.nextReview && !nextReview ? "border-red-400" : ""} />
                  {missing.nextReview && !nextReview && <p className="text-xs font-medium text-red-600">Enter the next review date to submit.</p>}</div>
              </div>
            ) : (
              <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                <Detail label="Outcome" value={view.outcome ? OUTCOMES[view.outcome] : null} />
                <Detail label="Next review date" value={view.nextReviewDate ? fmtDate(view.nextReviewDate) : null} />
              </div>
            )}
          </Card>

          <Card title={`Action plan (goals for the next review period)${editB && view.requireActionPlan ? " *" : ""}`}>
            {editB ? (
              <div className="space-y-2">
                {missing.plan && !plan.some((g) => g.goal.trim()) && <p className="text-xs font-medium text-red-600">Add at least one goal to submit.</p>}
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
            <Detail label="Employee" value={view.acknowledgedAt ? `${view.employeeName} · acknowledged on ${fmtDate(view.acknowledgedAt)}${view.employeeResponse === "agree" ? " · agrees" : view.employeeResponse === "disagree" ? " · disagrees" : ""}` : <span className="text-muted-foreground">Not acknowledged yet</span>} />
            <Detail label="Reviewer" value={view.managerSubmittedAt ? `${view.reviewerName ?? "Reviewer"} · submitted on ${fmtDate(view.managerSubmittedAt)}` : null} />
          </div>
          {view.employeeResponse === "disagree" && (
            <div className="space-y-2 rounded-lg border border-red-200 bg-red-50/60 px-3 py-2.5 text-sm dark:border-red-800 dark:bg-red-900/10">
              <div><div className="text-[10px] font-semibold uppercase tracking-wide text-red-800 dark:text-red-300">{view.role === "employee" ? "Your disagreement" : `${view.employeeName} disagrees`}</div><p className="mt-1 whitespace-pre-wrap">{view.employeeComment}</p></div>
              {view.disputeResolvedAt
                ? <div className="border-t border-red-200 pt-2 dark:border-red-800"><div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">HR kept the marks{view.disputeResolvedByName ? ` · ${view.disputeResolvedByName}` : ""} · {fmtDate(view.disputeResolvedAt)}</div><p className="mt-1 whitespace-pre-wrap">{view.disputeResolution}</p></div>
                : <p className="text-xs text-muted-foreground">{view.role === "employee" ? "HR has been told. They will either keep the marks and say why, or send the review back to your manager." : "Waiting for HR to keep the marks or reopen the review to the manager."}</p>}
            </div>
          )}
          {view.employeeResponse === "agree" && view.employeeComment && (
            <div className="rounded-lg bg-muted/30 px-3 py-2 text-sm"><div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Employee&apos;s comment</div><p className="mt-1 whitespace-pre-wrap">{view.employeeComment}</p></div>
          )}
          {view.canAcknowledge && (
            <div className="space-y-2.5 rounded-lg border border-green-200 bg-green-50/60 px-3 py-2.5 dark:border-green-800 dark:bg-green-900/10">
              <p className="text-xs text-muted-foreground">Please read the review above, then acknowledge it. If you disagree, say so here: HR will either keep the marks and tell you why, or send the review back to your manager.</p>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Do you agree with this review?">
                {([["agree", "I agree with this review"], ["disagree", "I disagree"]] as const).map(([k, label]) => (
                  <button key={k} type="button" role="radio" aria-checked={response === k} onClick={() => setResponse(k)}
                    className={`rounded-lg border px-3 py-1.5 text-sm ${response === k ? (k === "agree" ? "border-green-600 bg-green-100 font-semibold dark:bg-green-900/30" : "border-red-500 bg-red-50 font-semibold dark:bg-red-900/20") : "border-border bg-background hover:bg-muted/30"}`}>{label}</button>
                ))}
              </div>
              {response && (
                <div className="space-y-1.5">
                  <Label>{response === "disagree" ? <>What do you disagree with, and why?<span className="text-destructive"> *</span></> : "Comment (optional)"}</Label>
                  <Textarea rows={3} value={ackComment} onChange={(e) => setAckComment(e.target.value)} placeholder={response === "disagree" ? "e.g. The rating on Delivery does not count the project I finished in March" : ""} />
                </div>
              )}
              <Button size="sm" disabled={busy || !response || (response === "disagree" && !ackComment.trim())}
                onClick={() => response && (response === "agree" || confirm("Send your disagreement to HR and your manager? You can't change it afterwards.")) && run(() => acknowledgeReview(view.id, { response: response as EmployeeResponse, comment: ackComment }), response === "disagree" ? "Sent to HR" : "Acknowledged")}>
                {response === "disagree" ? "Acknowledge and send my disagreement" : "Acknowledge"}
              </Button>
            </div>
          )}
          {view.canResolveDispute && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-violet-200 bg-violet-50/40 px-3 py-2.5 dark:border-violet-800 dark:bg-violet-900/10">
              <span className="flex-1 text-xs text-muted-foreground">HR: settle the disagreement.</span>
              <Button size="sm" variant="outline" disabled={busy || !view.periodOpen} title={view.periodOpen ? undefined : "Reopen the review period first"} onClick={() => { setDisputeAction("reopen"); setDisputeNote(""); }}>Reopen to the manager</Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => { setDisputeAction("keep"); setDisputeNote(""); }}>Keep the marks</Button>
            </div>
          )}
        </Card>
      )}

      {/* ── earlier rounds: what was signed off before the review was reopened ── */}
      {view.rounds.length > 0 && (
        <Card title={`Earlier ${view.rounds.length === 1 ? "round" : "rounds"}`} hint="The review was reopened after the employee disagreed. What was signed off before is kept here.">
          <div className="space-y-2">
            {[...view.rounds].reverse().map((h) => (
              <details key={h.round} className="rounded-lg border border-border">
                <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                  <span className="font-medium">Round {h.round}</span>
                  <span className="tabular-nums">{formatScore(h.finalScore, view.scaleMax)}</span>
                  {isOutcome(h.outcome) && <span className="text-xs text-muted-foreground">{OUTCOMES[h.outcome]}</span>}
                  <span className="text-xs text-muted-foreground">reopened {fmtDate(h.reopenedAt)}{h.reopenedByName ? ` by ${h.reopenedByName}` : ""}</span>
                </summary>
                <div className="space-y-3 border-t border-border px-3 py-3 text-xs">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="rounded-lg bg-red-50/60 px-3 py-2 dark:bg-red-900/10"><div className="text-[10px] font-semibold uppercase tracking-wide text-red-800 dark:text-red-300">Employee disagreed</div><p className="mt-1 whitespace-pre-wrap text-sm">{h.employeeComment || "—"}</p></div>
                    <div className="rounded-lg bg-muted/30 px-3 py-2"><div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">HR reopened it</div><p className="mt-1 whitespace-pre-wrap text-sm">{h.reopenNote}</p></div>
                  </div>
                  <table className="w-full">
                    <thead className="text-left text-[10px] uppercase tracking-wide text-muted-foreground"><tr><th className="py-1 pr-2">Criterion</th><th className="py-1 pr-2">{h.coReviewers.length ? `Lead · ${h.leadShare}%` : "Manager"}</th>{h.coReviewers.map((x, k) => <th key={k} className="py-1 pr-2">{x.name} · {x.share}%</th>)}<th className="py-1">Comment</th></tr></thead>
                    <tbody className="divide-y divide-border/60">
                      {view.criteria.map((c) => {
                        const a = h.managerAnswers[c.id];
                        const now = view.answers[c.id];
                        const changed = view.status === "completed" && !!a && (a.rating !== now.managerRating || a.na !== now.managerNa);
                        return (
                          <tr key={c.id} className="align-top">
                            <td className="py-1 pr-2">{c.name}</td>
                            <td className="py-1 pr-2 whitespace-nowrap tabular-nums">{a?.na ? "N/A" : a?.rating != null ? Number(a.rating.toFixed(2)) : "—"}{changed && <span className="ml-1 text-[10px] text-indigo-600">→ {now.managerNa ? "N/A" : now.managerRating ?? "—"}</span>}</td>
                            {h.coReviewers.map((x, k) => <td key={k} className="py-1 pr-2 whitespace-nowrap tabular-nums">{x.answers[c.id]?.na ? "N/A" : x.answers[c.id]?.rating ?? "—"}</td>)}
                            <td className="py-1 text-muted-foreground">{a?.comment || ""}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {h.managerSummary && <div><div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Reviewer&apos;s comments</div><p className="mt-0.5 whitespace-pre-wrap">{h.managerSummary}</p></div>}
                  <p className="text-muted-foreground">Signed off{h.signedOffByName ? ` by ${h.signedOffByName}` : ""}{h.signedOffAt ? ` on ${fmtDate(h.signedOffAt)}` : ""}{h.signoffComment ? `: "${h.signoffComment}"` : ""} · acknowledged {fmtDate(h.acknowledgedAt) || "—"}</p>
                </div>
              </details>
            ))}
          </div>
        </Card>
      )}

      {/* ── actions ── */}
      {side && (
        <div className="sticky bottom-3 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-background/95 px-4 py-3 shadow-md backdrop-blur">
          <div className="min-w-40 flex-1 space-y-1">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>{rated} of {view.criteria.length} rated{side === "manager" && liveScore != null ? ` · ${view.multipleReviewers ? "your score" : "score"} so far ${formatScore(liveScore, view.scaleMax)}` : ""}</span>
              {unrated.length > 0 && <button type="button" className="underline hover:text-foreground" onClick={() => document.getElementById(`crit-${unrated[0].id}`)?.scrollIntoView({ behavior: "smooth", block: "center" })}>Next unrated</button>}
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-indigo-500 transition-all" style={{ width: `${view.criteria.length ? Math.round((rated / view.criteria.length) * 100) : 0}%` }} /></div>
            <div className="text-[11px] text-muted-foreground" aria-live="polite">
              {busy ? "Saving…" : dirty ? "Unsaved changes (saved automatically every 20 seconds)" : savedAt ? `Saved at ${savedAt.toLocaleTimeString("en-MY", { hour: "2-digit", minute: "2-digit" })}` : "Nothing changed yet"}
            </div>
          </div>
          <div className="ml-auto flex gap-2">
            <Button variant="outline" disabled={busy} onClick={() => save(false)}>Save draft</Button>
            <Button disabled={busy} onClick={() => save(true)} title={editB && view.waitingFor.length > 0 ? `Waiting for ${view.waitingFor.join(", ")}` : undefined}>{side === "self" ? "Submit to manager" : isCo ? "Submit my marks" : "Submit for sign-off"}</Button>
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

      {view.canReassign && view.reviewerSetup && (
        <ReviewersEditor key={JSON.stringify(view.reviewerSetup)} view={view} people={people} busy={busy} onSave={(v) => run(() => setReviewReviewers(view.id, v), "Reviewers saved")} />
      )}

      <Dialog open={disputeAction !== null} onOpenChange={(o) => !o && setDisputeAction(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{disputeAction === "reopen" ? "Reopen to the manager" : "Keep the marks"}</DialogTitle>
            <DialogDescription>{disputeAction === "reopen"
              ? `The review goes back to ${view.reviewerName ?? "the manager"} with their earlier marks, then through sign-off and ${view.employeeName}'s acknowledgment again. This round is kept in the history.`
              : `The review stays completed with the current marks. ${view.employeeName} and the manager can read your reason.`}</DialogDescription>
          </DialogHeader>
          <Textarea rows={3} value={disputeNote} onChange={(e) => setDisputeNote(e.target.value)} autoFocus
            placeholder={disputeAction === "reopen" ? "e.g. Please look again at Delivery: the March project was not counted" : "e.g. The rating on Delivery reflects the missed Q3 deadlines, discussed with you on 12 Oct"} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDisputeAction(null)}>Cancel</Button>
            <Button disabled={busy || !disputeNote.trim()} onClick={() => run(() => (disputeAction === "reopen" ? reopenDisputedReview(view.id, disputeNote) : resolveReviewDispute(view.id, disputeNote)), disputeAction === "reopen" ? "Reopened to the manager" : "Marks kept").then((okay) => { if (okay) setDisputeAction(null); })}>
              {disputeAction === "reopen" ? "Reopen" : "Keep the marks"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
