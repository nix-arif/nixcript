"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createReviewPeriod, getReviewPeriods, type EligibleEmployee, type PeriodSummary, type TemplateWithCriteria } from "@/server/performance";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { CalendarRangeIcon, PlusIcon, ArrowRightIcon } from "lucide-react";
import { EmployeePicker, type Picked } from "./employee-picker";
import { RATING_WORDS } from "@/lib/performance/core";

const fmt = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" });

export function PeriodsClient({ initialPeriods, templates, employees }: { initialPeriods: PeriodSummary[]; templates: TemplateWithCriteria[]; employees: EligibleEmployee[] }) {
  const router = useRouter();
  const [periods, setPeriods] = useState(initialPeriods);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [startDate, setStart] = useState("");
  const [endDate, setEnd] = useState("");
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [picked, setPicked] = useState<Picked>({});
  const [saving, setSaving] = useState(false);
  const [showReviewerMarks, setShowReviewerMarks] = useState(true); // with several reviewers: marks by name, or combined only
  const chosenTemplate = templates.find((t) => t.id === templateId);
  const companyNames = [...new Set(templates.map((t) => t.organizationName))];
  const pickedList = Object.keys(picked);
  const pickedCompanies = new Set(Object.values(picked).map((v) => v.organizationId));
  const missingBits = [!name.trim() && "a name", (!startDate || !endDate) && "the period dates", !templateId && "a template", pickedList.length === 0 && "at least one person"].filter(Boolean);

  async function create() {
    setSaving(true);
    try {
      const r = await createReviewPeriod({ name, startDate, endDate, templateId, showReviewerMarks, employees: Object.entries(picked).map(([userId, v]) => ({ userId, reviewerUserId: v.reviewerUserId, purpose: v.purpose, organizationId: v.organizationId, leadWeight: v.leadWeight, coReviewers: v.coReviewers })) });
      if (!r.ok) { toast.error(r.error); return; }
      toast.success("Review period opened. Employees were notified.");
      setPeriods(await getReviewPeriods()); setOpen(false); router.push(`/dashboard/human-resources/performance/periods/${r.value}`);
    } catch (e: any) { toast.error(e.message); } finally { setSaving(false); }
  }

  return (
    <div className="p-4 sm:p-6 max-w-4xl">
      <PageHeader
        title="Review Periods"
        description="Open a review period for your employees and follow its progress"
        action={<Button className="gap-2" onClick={() => setOpen(true)}><PlusIcon className="h-4 w-4" />New review period</Button>}
      />

      {periods.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-16 text-center text-muted-foreground">
          <CalendarRangeIcon className="mx-auto mb-3 h-8 w-8 opacity-30" />
          <div className="mb-1 text-sm font-medium">No review periods yet</div>
          <p className="mx-auto mb-4 max-w-sm text-xs">{templates.length === 0 ? "Create a review template first, then open a period for your employees." : "Open a period, pick the employees and a template, and each one gets a review to complete."}</p>
          {templates.length === 0
            ? <Button asChild variant="outline" size="sm"><Link href="/dashboard/human-resources/performance/templates">Create a template</Link></Button>
            : <Button variant="outline" size="sm" className="gap-2" onClick={() => setOpen(true)}><PlusIcon className="h-3.5 w-3.5" />New review period</Button>}
        </div>
      ) : (
        <ul className="space-y-2">
          {periods.map((p) => {
            const pct = p.total ? Math.round((p.completed / p.total) * 100) : 0;
            return (
              <li key={p.id}>
                <Link href={`/dashboard/human-resources/performance/periods/${p.id}`} className="block rounded-xl border border-border bg-background px-4 py-3 transition-colors hover:bg-muted/20">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold">{p.name}</span>
                    <span className={`rounded-md border px-1.5 py-px text-[10px] font-medium ${p.status === "open" ? "border-green-200 bg-green-50 text-green-800 dark:border-green-700 dark:bg-green-900/20 dark:text-green-300" : "border-border text-muted-foreground"}`}>{p.status === "open" ? "Open" : "Closed"}</span>
                    <span className="text-xs text-muted-foreground">{fmt(p.startDate)} to {fmt(p.endDate)}</span>
                    {p.signoff > 0 && <span className="rounded-md border border-violet-200 bg-violet-50 px-1.5 py-px text-[10px] font-medium text-violet-800 dark:border-violet-700 dark:bg-violet-900/20 dark:text-violet-300">{p.signoff} to sign off</span>}
                    <ArrowRightIcon className="ml-auto h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="mt-2 flex items-center gap-3">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-green-500" style={{ width: `${pct}%` }} /></div>
                    <span className="whitespace-nowrap text-[11px] tabular-nums text-muted-foreground">{p.completed} of {p.total} completed</span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full max-w-xl! overflow-y-auto px-6 sm:px-8">
          <SheetHeader className="mb-4">
            <SheetTitle>New review period</SheetTitle>
            <SheetDescription>Each selected employee gets a review and is notified to start their self-assessment.</SheetDescription>
          </SheetHeader>
          <div className="space-y-4">
            <div className="space-y-1.5"><Label>Name <span className="text-destructive">*</span></Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. 2026 H2" autoFocus /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>Period starts <span className="text-destructive">*</span></Label><Input type="date" value={startDate} onChange={(e) => setStart(e.target.value)} /></div>
              <div className="space-y-1.5"><Label>Period ends <span className="text-destructive">*</span></Label><Input type="date" value={endDate} onChange={(e) => setEnd(e.target.value)} /></div>
            </div>
            <div className="space-y-1.5">
              <Label>Template <span className="text-destructive">*</span></Label>
              <select className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                {templates.length === 0 && <option value="">No active template</option>}
                {companyNames.length > 1
                  ? companyNames.map((c) => (
                      <optgroup key={c} label={c}>
                        {templates.filter((t) => t.organizationName === c).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </optgroup>
                    ))
                  : templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              {chosenTemplate && (
                <p className="text-[11px] text-muted-foreground">
                  {chosenTemplate.criteria.length} criteria{(chosenTemplate.questions ?? []).length ? ` · ${(chosenTemplate.questions ?? []).length} written questions` : ""} · scale 1 to {chosenTemplate.scaleMax} ({RATING_WORDS[chosenTemplate.scaleMax]?.[0]} to {RATING_WORDS[chosenTemplate.scaleMax]?.slice(-1)[0]})
                  {!chosenTemplate.own ? ` · from ${chosenTemplate.organizationName}` : ""}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Employees <span className="text-destructive">*</span></Label>
              <EmployeePicker employees={employees} value={picked} onChange={setPicked} />
            </div>
            <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-border px-3 py-2 text-xs">
              <input type="checkbox" className="mt-0.5 h-3.5 w-3.5" checked={showReviewerMarks} onChange={(e) => setShowReviewerMarks(e.target.checked)} />
              <span><span className="font-medium">Employees see each reviewer&apos;s marks by name</span><br /><span className="text-muted-foreground">For reviews with more than one reviewer, once completed. Off: employees see only the combined marks and the lead reviewer&apos;s comments. HR always sees everything.</span></span>
            </label>
            <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs">
              {missingBits.length > 0
                ? <span className="text-muted-foreground">Still needed: {missingBits.join(", ")}.</span>
                : <span>Open <span className="font-medium">&ldquo;{name.trim()}&rdquo;</span> with <span className="font-medium">{chosenTemplate?.name}</span> for <span className="font-medium">{pickedList.length} {pickedList.length === 1 ? "person" : "people"}</span>{pickedCompanies.size > 1 ? ` in ${pickedCompanies.size} companies` : ""}. Each one is notified to start their self-assessment, and their reviewer follows.</span>}
            </div>
            <div className="flex gap-2 pt-2">
              <Button className="flex-1" onClick={create} disabled={saving || missingBits.length > 0}>{saving ? "Opening…" : `Open period${pickedList.length ? ` for ${pickedList.length}` : ""}`}</Button>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
