"use client";

import { useState } from "react";
import { toast } from "sonner";
import { getReviewTemplates, saveReviewTemplate, setReviewTemplateActive, type TemplateWithCriteria } from "@/server/performance";
import { RATING_WORDS } from "@/lib/performance/core";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ArrowDownIcon, ArrowUpIcon, ClipboardListIcon, CopyIcon, PencilIcon, PlusIcon, TrashIcon } from "lucide-react";

type Row = { key: string; section: string; name: string; description: string; weight: string };
type QRow = { key: string; id?: string; label: string; help: string };
const newRow = (section = ""): Row => ({ key: Math.random().toString(36).slice(2), section, name: "", description: "", weight: "1" });
const newQRow = (label = "", help = "", id?: string): QRow => ({ key: Math.random().toString(36).slice(2), id, label, help });
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

export function TemplatesClient({ initial }: { initial: TemplateWithCriteria[] }) {
  const [templates, setTemplates] = useState(initial);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | undefined>();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [scaleMax, setScaleMax] = useState(5);
  const [rows, setRows] = useState<Row[]>([]);
  const [qrows, setQRows] = useState<QRow[]>([]);
  const [saving, setSaving] = useState(false);
  const reload = async () => setTemplates(await getReviewTemplates());

  function openNew() {
    setEditingId(undefined); setName(FORM_NAME); setDescription("The company's Employee Performance Review Form (F-HR05)"); setScaleMax(4); setRows(formRows()); setQRows(formQuestions());
    setOpen(true);
  }
  // a template of another company of the owner can be used as it is; to change it, copy it into this company first
  function openCopy(t: TemplateWithCriteria) {
    setEditingId(undefined); setName(`${t.name} (copy)`); setDescription(t.description ?? ""); setScaleMax(t.scaleMax);
    setRows(t.criteria.map((c) => ({ key: Math.random().toString(36).slice(2), section: c.section, name: c.name, description: c.description ?? "", weight: c.weight })));
    setQRows((t.questions ?? []).map((q) => newQRow(q.label, q.help)));
    setOpen(true);
  }
  function openEdit(t: TemplateWithCriteria) {
    setEditingId(t.id); setName(t.name); setDescription(t.description ?? ""); setScaleMax(t.scaleMax);
    setRows(t.criteria.map((c) => ({ key: c.id, section: c.section, name: c.name, description: c.description ?? "", weight: c.weight })));
    setQRows((t.questions ?? []).map((q) => newQRow(q.label, q.help, q.id)));
    setOpen(true);
  }
  const patch = (key: string, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));
  const move = (i: number, d: -1 | 1) => setRows((rs) => { const j = i + d; if (j < 0 || j >= rs.length) return rs; const c = [...rs]; [c[i], c[j]] = [c[j], c[i]]; return c; });

  async function save() {
    setSaving(true);
    try {
      const r = await saveReviewTemplate({ id: editingId, name, description, scaleMax, criteria: rows.map((x) => ({ section: x.section, name: x.name, description: x.description, weight: x.weight })), questions: qrows.map((q) => ({ id: q.id, label: q.label, help: q.help })) });
      if (!r.ok) { toast.error(r.error); return; }
      await reload(); setOpen(false); toast.success("Template saved");
    } catch (e: any) { toast.error(e.message); } finally { setSaving(false); }
  }
  async function toggle(t: TemplateWithCriteria) {
    const r = await setReviewTemplateActive(t.id, !t.isActive);
    if (!r.ok) toast.error(r.error); else await reload();
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
        <ul className="space-y-2">
          {templates.map((t) => {
            const sections = [...new Set(t.criteria.map((c) => c.section || "General"))];
            return (
              <li key={t.id} className={`rounded-xl border border-border bg-background px-4 py-3 ${t.isActive ? "" : "opacity-60"}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold">{t.name}</span>
                  <span className="rounded-md border border-border px-1.5 py-px text-[10px] text-muted-foreground">{t.criteria.length} criteria{(t.questions ?? []).length ? ` · ${(t.questions ?? []).length} questions` : ""} · scale 1 to {t.scaleMax}</span>
                  {!t.isActive && <span className="rounded-md border border-border px-1.5 py-px text-[10px] text-muted-foreground">Inactive</span>}
                  {!t.own && <span className="rounded-md border border-sky-200 bg-sky-50 px-1.5 py-px text-[10px] font-medium text-sky-800 dark:border-sky-700 dark:bg-sky-900/20 dark:text-sky-300">From {t.organizationName}</span>}
                  <div className="ml-auto flex gap-1.5">
                    {t.own ? (
                      <>
                        <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={() => openEdit(t)}><PencilIcon className="h-3 w-3" />Edit</Button>
                        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => toggle(t)}>{t.isActive ? "Deactivate" : "Activate"}</Button>
                      </>
                    ) : (
                      <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={() => openCopy(t)}><CopyIcon className="h-3 w-3" />Copy to my company</Button>
                    )}
                  </div>
                </div>
                {t.description && <p className="mt-1 text-xs text-muted-foreground">{t.description}</p>}
                <p className="mt-1.5 text-[11px] text-muted-foreground">{sections.join(" · ")}</p>
              </li>
            );
          })}
        </ul>
      )}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full max-w-2xl! overflow-y-auto px-6 sm:px-8">
          <SheetHeader className="mb-4">
            <SheetTitle>{editingId ? "Edit template" : "New template"}</SheetTitle>
            <SheetDescription>Changing a template does not change reviews that were already opened with it.</SheetDescription>
          </SheetHeader>
          <div className="space-y-4">
            <div className="space-y-1.5"><Label>Name <span className="text-destructive">*</span></Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Staff annual review" autoFocus={!editingId} /></div>
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
                </div>
              ))}
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setQRows((qs) => [...qs, newQRow()])}><PlusIcon className="h-3.5 w-3.5" />Add question</Button>
            </div>

            <div className="rounded-lg border border-dashed border-border px-3 py-2 text-[11px] text-muted-foreground">
              Employees also report progress on the goals of their last review, and the reviewer records the overall outcome, the next review date and the action plan for the next period. Those parts are the same in every template.
              <button type="button" className="ml-1 underline hover:text-foreground" onClick={() => { if (confirm("Replace the criteria and questions below with the company form (F-HR05)?")) { setName((n) => n || FORM_NAME); setScaleMax(4); setRows(formRows()); setQRows(formQuestions()); } }}>Reset to the company form (F-HR05)</button>
            </div>

            <div className="flex gap-2 pt-2">
              <Button className="flex-1" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save template"}</Button>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
