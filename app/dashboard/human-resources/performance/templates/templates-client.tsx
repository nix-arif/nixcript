"use client";

import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { deleteReviewTemplate, getReviewTemplates, saveReviewTemplate, setReviewTemplateActive, type TemplateWithCriteria } from "@/server/performance";
import { MAX_SELF_SHARE, RATING_WORDS, freeTemplateName, templateNameKey } from "@/lib/performance/core";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ArrowDownIcon, ArrowUpIcon, Building2Icon, ClipboardListIcon, CopyIcon, PencilIcon, PlusIcon, TrashIcon } from "lucide-react";

type Row = { key: string; section: string; name: string; description: string; weight: string; allowNa: boolean; commentOnExtremes: boolean };
type QRow = { key: string; id?: string; label: string; help: string; required: boolean };
const newRow = (section = ""): Row => ({ key: Math.random().toString(36).slice(2), section, name: "", description: "", weight: "1", allowNa: true, commentOnExtremes: false });
const newQRow = (label = "", help = "", id?: string, required = false): QRow => ({ key: Math.random().toString(36).slice(2), id, label, help, required });

// a small on/off choice inside a criterion or question
function Toggle({ checked, onChange, children, title }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode; title?: string }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground" title={title}>
      <input type="checkbox" className="h-3.5 w-3.5" checked={checked} onChange={(e) => onChange(e.target.checked)} />{children}
    </label>
  );
}
const SCALES = [3, 4, 5, 10];

// The company's own form (F-HR05, Employee Performance Review Form): its core competencies and its written questions.
// A new template starts from it, so HR does not begin from an empty page.
const FORM_COMPETENCIES: [string, string[]][] = [
  ["Attendance & Punctuality", ["Demonstrates commitment and ability to report to work on a consistent and punctual basis"]],
  ["Job Knowledge", [
    "Understands how your position supports the company's goal",
    "Demonstrates knowledge and skills necessary to perform the job effectively and applies to critical work issues in a timely manner",
    "Demonstrates willingness to learn new skills, methods, processes to enhance job performance",
    "Performs the full range of duties and responsibilities associated with the job"]],
  ["Interpersonal Skills, Cooperation, Collaboration", ["Demonstrates professional working relationships with internal and/or external stakeholders", "Encourages collaboration and sharing of information"]],
  ["Communication Skills", ["Writes and communicates clearly and accurately", "Listens well; is responsive to inquiries, directions, and suggestions"]],
  ["Planning, Organizing, and Achieving Results", ["Develops goals, plans, and priorities to achieve objectives; evaluates goals and accomplishments", "Meets deadlines in a timely and efficient manner", "Finds and uses resources well"]],
  ["Problem Analysis and Decision Making", ["Gather and analyzes appropriate information before making decisions", "Develops and implements effective solutions"]],
  ["Leadership", ["Demonstrates commitment and provides leadership through personal example and professional expertise", "Demonstrates the ability to motivate coworkers", "Displays an openness to new ideas and supports an environment of continuous improvement"]],
  ["Supervision", ["Applies to those in supervision / management positions. Choose N/A for everyone else.", "Sets clear goals and expectations for subordinates", "Provides adequate support for subordinates to complete tasks and their professional development", "Creates a positive work culture that encourages commitment to teamwork and organizational goals", "Provides informal, ongoing feedback to employees as well as formal performance evaluation", "Delegates authority and responsibility appropriately"]],
];
const FORM_QUESTIONS: [string, string][] = [
  ["Achievements", "What have been your significant achievements of the past year?"],
  ["Challenges", "What have been the most challenging aspect of your work of the past year and why? How can these challenges be overcome?"],
  ["Career planning", "What actions could be taken to improve your performance and enhance your career development? Describe your career aspirations and how can the management help you to achieve this?"],
  ["Corporate culture", "Are you comfortable with our corporate culture, and are there areas that need improvement? Is the team working well collaboratively?"],
];
const FORM_NAME = "Employee Performance Review (F-HR05)";
const formRows = (): Row[] => FORM_COMPETENCIES.map(([name, lines]) => ({ ...newRow("Core competencies"), name, description: lines.join("\n") }));
const formQuestions = (): QRow[] => FORM_QUESTIONS.map(([label, help]) => newQRow(label, help));

function SectionHeading({ icon, title, count, hint }: { icon: ReactNode; title: string; count: number; hint: string }) {
  return (
    <div className="mb-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <span className="text-muted-foreground">{icon}</span>{title}
        <span className="rounded-full border border-border px-1.5 text-[10px] font-normal text-muted-foreground">{count}</span>
      </h2>
      <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

function TemplateRow({ t, actions }: { t: TemplateWithCriteria; actions: ReactNode }) {
  const sections = [...new Set(t.criteria.map((c) => c.section || "General"))];
  const questions = (t.questions ?? []).length;
  return (
    <li className={`rounded-xl border border-border bg-background px-4 py-3 ${t.isActive ? "" : "opacity-60"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">{t.name}</span>
        <span className="rounded-md border border-border px-1.5 py-px text-[10px] text-muted-foreground">{t.criteria.length} criteria{questions ? ` · ${questions} questions` : ""} · scale 1 to {t.scaleMax}</span>
        {(() => {
          const req = [
            (t.questions ?? []).filter((q) => q.required).length && `${(t.questions ?? []).filter((q) => q.required).length} required ${(t.questions ?? []).filter((q) => q.required).length === 1 ? "question" : "questions"}`,
            t.criteria.some((c) => !c.allowNa) && `${t.criteria.filter((c) => !c.allowNa).length} without N/A`,
            t.criteria.some((c) => c.commentOnExtremes) && `${t.criteria.filter((c) => c.commentOnExtremes).length} need a comment on 1 / ${t.scaleMax}`,
            t.requireNextReviewDate && "next review date",
            t.requireActionPlan && "action plan",
          ].filter(Boolean);
          const share = t.selfShare > 0 ? <span className="rounded-md border border-indigo-200 bg-indigo-50 px-1.5 py-px text-[10px] text-indigo-800 dark:border-indigo-800 dark:bg-indigo-900/20 dark:text-indigo-300">Self-assessment counts {t.selfShare}%</span> : null;
          if (!req.length) return share;
          return <>{share}{req.length ? <span className="rounded-md border border-amber-200 bg-amber-50 px-1.5 py-px text-[10px] text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300" title="Required in this template">Required: {req.join(" · ")}</span> : null}</>;
        })()}
        {!t.isActive && <span className="rounded-md border border-border px-1.5 py-px text-[10px] text-muted-foreground">Inactive</span>}
        <div className="ml-auto flex gap-1.5">{actions}</div>
      </div>
      {t.description && <p className="mt-1 text-xs text-muted-foreground">{t.description}</p>}
      <p className="mt-1.5 text-[11px] text-muted-foreground">{sections.join(" · ")}</p>
    </li>
  );
}

export function TemplatesClient({ initial, canDelete, orgName }: { initial: TemplateWithCriteria[]; canDelete: boolean; orgName: string }) {
  const [templates, setTemplates] = useState(initial);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | undefined>();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [scaleMax, setScaleMax] = useState(5);
  const [rows, setRows] = useState<Row[]>([]);
  const [qrows, setQRows] = useState<QRow[]>([]);
  // the reviewer's part HR makes required (the outcome and the reviewer's comments always are)
  const [requireNextReviewDate, setRequireNextReviewDate] = useState(false);
  const [requireActionPlan, setRequireActionPlan] = useState(false);
  // how much the employee's own ratings count in the final score, in percent (0 = not at all)
  const [selfShare, setSelfShare] = useState(0);
  const [saving, setSaving] = useState(false);
  const [copyFrom, setCopyFrom] = useState<{ name: string; org: string } | null>(null);
  // names are unique within this company (checked again on the server when saving)
  const ownNames = templates.filter((t) => t.own).map((t) => t.name);
  const nameTaken = !!name.trim() && templates.some((t) => t.own && t.id !== editingId && templateNameKey(t.name) === templateNameKey(name));
  const reload = async () => setTemplates(await getReviewTemplates());

  function openNew() {
    setCopyFrom(null); setEditingId(undefined); setName(freeTemplateName(FORM_NAME, ownNames)); setDescription("The company's Employee Performance Review Form (F-HR05)"); setScaleMax(4); setRows(formRows()); setQRows(formQuestions());
    setRequireNextReviewDate(false); setRequireActionPlan(false); setSelfShare(0);
    setOpen(true);
  }
  // a template of another company of the owner can be used as it is; to change it, copy it into this company first
  function openCopy(t: TemplateWithCriteria) {
    setCopyFrom({ name: t.name, org: t.organizationName }); setEditingId(undefined); setName(freeTemplateName(t.name, ownNames)); setDescription(t.description ?? ""); setScaleMax(t.scaleMax);
    setRows(t.criteria.map((c) => ({ key: Math.random().toString(36).slice(2), section: c.section, name: c.name, description: c.description ?? "", weight: c.weight, allowNa: c.allowNa, commentOnExtremes: c.commentOnExtremes })));
    setQRows((t.questions ?? []).map((q) => newQRow(q.label, q.help, undefined, !!q.required)));
    setRequireNextReviewDate(t.requireNextReviewDate); setRequireActionPlan(t.requireActionPlan); setSelfShare(t.selfShare);
    setOpen(true);
  }
  function openEdit(t: TemplateWithCriteria) {
    setCopyFrom(null); setEditingId(t.id); setName(t.name); setDescription(t.description ?? ""); setScaleMax(t.scaleMax);
    setRows(t.criteria.map((c) => ({ key: c.id, section: c.section, name: c.name, description: c.description ?? "", weight: c.weight, allowNa: c.allowNa, commentOnExtremes: c.commentOnExtremes })));
    setQRows((t.questions ?? []).map((q) => newQRow(q.label, q.help, q.id, !!q.required)));
    setRequireNextReviewDate(t.requireNextReviewDate); setRequireActionPlan(t.requireActionPlan); setSelfShare(t.selfShare);
    setOpen(true);
  }
  const patch = (key: string, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));
  const move = (i: number, d: -1 | 1) => setRows((rs) => { const j = i + d; if (j < 0 || j >= rs.length) return rs; const c = [...rs]; [c[i], c[j]] = [c[j], c[i]]; return c; });

  async function save() {
    setSaving(true);
    try {
      const r = await saveReviewTemplate({ id: editingId, name, description, scaleMax, criteria: rows.map((x) => ({ section: x.section, name: x.name, description: x.description, weight: x.weight, allowNa: x.allowNa, commentOnExtremes: x.commentOnExtremes })), questions: qrows.map((q) => ({ id: q.id, label: q.label, help: q.help, required: q.required })), requireNextReviewDate, requireActionPlan, selfShare });
      if (!r.ok) { toast.error(r.error); return; }
      await reload(); setOpen(false); toast.success("Template saved");
    } catch (e: any) { toast.error(e.message); } finally { setSaving(false); }
  }
  async function toggle(t: TemplateWithCriteria) {
    const r = await setReviewTemplateActive(t.id, !t.isActive);
    if (!r.ok) toast.error(r.error); else await reload();
  }
  const ownTemplates = templates.filter((t) => t.own);
  const otherGroups = [...new Set(templates.filter((t) => !t.own).map((t) => t.organizationName))]
    .map((name) => ({ name, templates: templates.filter((t) => !t.own && t.organizationName === name) }));

  async function remove(t: TemplateWithCriteria) {
    if (!confirm(`Delete the template "${t.name}"? This cannot be undone.`)) return;
    const r = await deleteReviewTemplate(t.id);
    if (!r.ok) { toast.error(r.error); await reload(); return; }
    await reload(); toast.success("Template deleted");
  }

  return (
    <div className="p-4 sm:p-6 max-w-4xl">
      <PageHeader
        title="Review Templates"
        description="The criteria, rating scale and weights used in performance reviews. A template of any of your companies can be used for any review period."
        action={<Button className="gap-2" onClick={openNew}><PlusIcon className="h-4 w-4" />New template</Button>}
      />

      {templates.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-16 text-center text-muted-foreground">
          <ClipboardListIcon className="mx-auto mb-3 h-8 w-8 opacity-30" />
          <div className="mb-1 text-sm font-medium">No templates yet</div>
          <p className="mx-auto mb-4 max-w-sm text-xs">A template lists what is rated (e.g. quality of work, teamwork) and how. Create one, then open a review period with it.</p>
          <Button variant="outline" size="sm" className="gap-2" onClick={openNew}><PlusIcon className="h-3.5 w-3.5" />Create the first template</Button>
        </div>
      ) : (
        <div className="space-y-8">
          {/* this company's own templates: the only ones that can be edited, deactivated or deleted here */}
          <section>
            <SectionHeading
              icon={<Building2Icon className="h-4 w-4" />}
              title={`${orgName || "This company"}'s templates`}
              count={ownTemplates.length}
              hint="Your company's own templates. You can edit, deactivate and delete these."
            />
            {ownTemplates.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-muted-foreground">
                <p className="mb-3 text-xs">
                  {orgName || "This company"} has no templates of its own yet.
                  {otherGroups.length > 0 && " Create one, or copy one from your other companies below."}
                </p>
                <Button variant="outline" size="sm" className="gap-2" onClick={openNew}><PlusIcon className="h-3.5 w-3.5" />New template</Button>
              </div>
            ) : (
              <ul className="space-y-2">{ownTemplates.map((t) => <TemplateRow key={t.id} t={t} actions={
                <>
                  <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={() => openEdit(t)}><PencilIcon className="h-3 w-3" />Edit</Button>
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => toggle(t)}>{t.isActive ? "Deactivate" : "Activate"}</Button>
                  {!canDelete ? null : t.periodCount === 0 ? (
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => remove(t)} aria-label="Delete template" title="Delete template"><TrashIcon className="h-3.5 w-3.5" /></Button>
                  ) : (
                    <span className="self-center text-[10px] text-muted-foreground" title="A template used by a review period can't be deleted. Deactivate it instead.">Used by {t.periodCount} {t.periodCount === 1 ? "period" : "periods"}</span>
                  )}
                </>
              } />)}</ul>
            )}
          </section>

          {/* templates of the owner's other companies: usable for a period as they are, read-only here */}
          {otherGroups.length > 0 && (
            <section>
              <SectionHeading
                icon={<Building2Icon className="h-4 w-4" />}
                title="From your other companies"
                count={otherGroups.reduce((n, g) => n + g.templates.length, 0)}
                hint={`You can use these for a review period as they are, but you can only change them in their own company. To change one here, copy it into ${orgName || "this company"} first.`}
              />
              <div className="space-y-4">
                {otherGroups.map((g) => (
                  <div key={g.name} className="rounded-xl border border-border bg-muted/30 p-3">
                    <div className="mb-2 flex items-center gap-2 px-1 text-xs font-semibold text-muted-foreground">
                      {g.name}
                      <span className="rounded-full border border-border bg-background px-1.5 text-[10px] font-normal">{g.templates.length}</span>
                    </div>
                    <ul className="space-y-2">{g.templates.map((t) => <TemplateRow key={t.id} t={t} actions={
                      <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={() => openCopy(t)}><CopyIcon className="h-3 w-3" />Copy to {orgName || "my company"}</Button>
                    } />)}</ul>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full max-w-2xl! overflow-y-auto px-6 sm:px-8">
          <SheetHeader className="mb-4">
            <SheetTitle>{editingId ? "Edit template" : copyFrom ? `Copy to ${orgName || "my company"}` : "New template"}</SheetTitle>
            <SheetDescription>
              {copyFrom
                ? `Saving creates a separate template in ${orgName || "this company"}, copied from "${copyFrom.name}" of ${copyFrom.org}. The original in ${copyFrom.org} stays as it is.`
                : "Changes apply to review periods opened from now on. Periods already open keep the form they started with, including for people added to them later."}
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-4">
            <div className="space-y-1.5"><Label>Name <span className="text-destructive">*</span></Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Staff annual review" autoFocus={!editingId} aria-invalid={nameTaken} className={nameTaken ? "border-destructive focus-visible:ring-destructive/30" : undefined} />
              {nameTaken && <p className="text-xs text-destructive">{orgName || "This company"} already has a template with this name. Give it a different name.</p>}
            </div>
            <div className="space-y-1.5"><Label>Description</Label><Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Who this template is for (optional)" /></div>
            <div className="space-y-1.5">
              <Label>Rating scale</Label>
              <div className="flex flex-wrap gap-1.5">
                {SCALES.map((s) => (
                  <button key={s} type="button" aria-pressed={scaleMax === s} onClick={() => setScaleMax(s)}
                    className={`rounded-lg border px-3 py-1.5 text-sm ${scaleMax === s ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20" : "border-border hover:bg-muted/30"}`}>1 to {s}</button>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">{RATING_WORDS[scaleMax]?.map((w, i) => `${i + 1} ${w}`).join(" · ")}</p>
            </div>

            <div className="space-y-1.5">
              <Label>Does the self-assessment count in the final score?</Label>
              <div className="flex flex-wrap gap-1.5">
                {[0, 10, 20, 30, 50].map((n) => (
                  <button key={n} type="button" aria-pressed={selfShare === n} onClick={() => setSelfShare(n)}
                    className={`rounded-lg border px-3 py-1.5 text-sm ${selfShare === n ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20" : "border-border hover:bg-muted/30"}`}>{n === 0 ? "No" : `${n}%`}</button>
                ))}
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">or
                  <input type="number" min={0} max={MAX_SELF_SHARE} className="h-8 w-16 rounded-md border border-input bg-background px-1.5 text-sm text-foreground" value={selfShare}
                    onChange={(e) => setSelfShare(Math.max(0, Math.min(MAX_SELF_SHARE, Math.round(Number(e.target.value) || 0))))} aria-label="Self-assessment share in percent" />%</span>
              </div>
              <p className="text-[11px] text-muted-foreground">{selfShare === 0
                ? "No: only the reviewers' ratings make the score. The employee's own ratings are shown next to them for comparison."
                : `Final score = reviewers' score × ${100 - selfShare}% + the employee's own score × ${selfShare}%. At most ${MAX_SELF_SHARE}%, so the reviewers always carry at least half.`}</p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between"><Label>Criteria <span className="text-destructive">*</span></Label>
                <span className="text-[11px] text-muted-foreground">Weight: how much a criterion counts in the final score</span></div>
              {rows.map((r, i) => (
                <div key={r.key} className="rounded-lg border border-border p-2.5 space-y-2">
                  <div className="flex flex-wrap gap-2">
                    <Input className="h-8 w-36 text-xs" value={r.section} onChange={(e) => patch(r.key, { section: e.target.value })} placeholder="Section" list="review-sections" />
                    <Input className="h-8 min-w-40 flex-1 text-sm" value={r.name} onChange={(e) => patch(r.key, { name: e.target.value })} placeholder={`Criterion ${i + 1}`} />
                    <Input className="h-8 w-16 text-sm tabular-nums" type="number" min="0.1" step="0.1" value={r.weight} onChange={(e) => patch(r.key, { weight: e.target.value })} aria-label="Weight" title="Weight" />
                    <div className="flex">
                      <Button variant="ghost" size="icon" className="h-8 w-7" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up"><ArrowUpIcon className="h-3.5 w-3.5" /></Button>
                      <Button variant="ghost" size="icon" className="h-8 w-7" disabled={i === rows.length - 1} onClick={() => move(i, 1)} aria-label="Move down"><ArrowDownIcon className="h-3.5 w-3.5" /></Button>
                      <Button variant="ghost" size="icon" className="h-8 w-7 text-muted-foreground hover:text-destructive" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} aria-label="Remove"><TrashIcon className="h-3.5 w-3.5" /></Button>
                    </div>
                  </div>
                  <Textarea rows={Math.min(6, Math.max(2, r.description.split("\n").length))} className="text-xs" value={r.description} onChange={(e) => patch(r.key, { description: e.target.value })} placeholder="What this criterion looks at (shown to the employee and manager). One line per point." />
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    <Toggle checked={r.allowNa} onChange={(v) => patch(r.key, { allowNa: v })} title="Off: everyone must be given a rating on this one (e.g. attendance)">Allow N/A</Toggle>
                    <Toggle checked={r.commentOnExtremes} onChange={(v) => patch(r.key, { commentOnExtremes: v })} title={`A reviewer who gives 1 or ${scaleMax} must say why in a comment`}>Reviewer must comment on the lowest / highest rating (1 or {scaleMax})</Toggle>
                  </div>
                </div>
              ))}
              <datalist id="review-sections">{[...new Set(rows.map((r) => r.section).filter(Boolean))].map((s) => <option key={s} value={s} />)}</datalist>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setRows((rs) => [...rs, newRow(rs[rs.length - 1]?.section ?? "")])}><PlusIcon className="h-3.5 w-3.5" />Add criterion</Button>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between"><Label>Written questions</Label>
                <span className="text-[11px] text-muted-foreground">Answered by the employee in their self-assessment</span></div>
              {qrows.map((q, i) => (
                <div key={q.key} className="rounded-lg border border-border p-2.5 space-y-2">
                  <div className="flex gap-2">
                    <Input className="h-8 flex-1 text-sm" value={q.label} onChange={(e) => setQRows((qs) => qs.map((x) => (x.key === q.key ? { ...x, label: e.target.value } : x)))} placeholder={`Heading ${i + 1}, e.g. Achievements`} />
                    <Button variant="ghost" size="icon" className="h-8 w-7 text-muted-foreground hover:text-destructive" onClick={() => setQRows((qs) => qs.filter((x) => x.key !== q.key))} aria-label="Remove question"><TrashIcon className="h-3.5 w-3.5" /></Button>
                  </div>
                  <Textarea rows={2} className="text-xs" value={q.help} onChange={(e) => setQRows((qs) => qs.map((x) => (x.key === q.key ? { ...x, help: e.target.value } : x)))} placeholder="The question the employee answers" />
                  <Toggle checked={q.required} onChange={(v) => setQRows((qs) => qs.map((x) => (x.key === q.key ? { ...x, required: v } : x)))}>Required: the employee must answer it to submit</Toggle>
                </div>
              ))}
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setQRows((qs) => [...qs, newQRow()])}><PlusIcon className="h-3.5 w-3.5" />Add question</Button>
            </div>

            <div className="space-y-1.5">
              <Label>Reviewer&apos;s part</Label>
              <p className="text-[11px] text-muted-foreground">The lead reviewer always has to choose the overall outcome and write their comments. You can also require:</p>
              <div className="flex flex-col gap-1">
                <Toggle checked={requireNextReviewDate} onChange={setRequireNextReviewDate}>Next review date</Toggle>
                <Toggle checked={requireActionPlan} onChange={setRequireActionPlan}>Action plan (at least one goal for the next period)</Toggle>
              </div>
            </div>

            <div className="rounded-lg border border-dashed border-border px-3 py-2 text-[11px] text-muted-foreground">
              Employees also report progress on the goals of their last review (optional), and the reviewer records the overall outcome, the next review date and the action plan for the next period.
              <button type="button" className="ml-1 underline hover:text-foreground" onClick={() => { if (confirm("Replace the criteria and questions below with the company form (F-HR05)?")) { setName((n) => n || FORM_NAME); setScaleMax(4); setRows(formRows()); setQRows(formQuestions()); } }}>Reset to the company form (F-HR05)</button>
            </div>

            <div className="flex gap-2 pt-2">
              <Button className="flex-1" onClick={save} disabled={saving || nameTaken}>{saving ? "Saving…" : "Save template"}</Button>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
