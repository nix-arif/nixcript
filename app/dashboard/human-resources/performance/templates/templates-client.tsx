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
import { ArrowDownIcon, ArrowUpIcon, ClipboardListIcon, PencilIcon, PlusIcon, TrashIcon } from "lucide-react";

type Row = { key: string; section: string; name: string; description: string; weight: string };
const newRow = (section = ""): Row => ({ key: Math.random().toString(36).slice(2), section, name: "", description: "", weight: "1" });
const SCALES = [3, 4, 5, 10];

// a sensible starting point so HR does not begin from an empty page
const STARTER: Row[] = [
  ["Job performance", "Quality of work", "Accuracy, thoroughness and attention to detail"],
  ["Job performance", "Productivity", "Output and meeting deadlines"],
  ["Job performance", "Job knowledge", "Understanding of the role and the products"],
  ["Behaviour", "Teamwork", "Cooperation and helping colleagues"],
  ["Behaviour", "Communication", "Clear and respectful communication with colleagues and customers"],
  ["Behaviour", "Attendance and punctuality", "Reliability in attendance and time-keeping"],
].map(([section, name, description]) => ({ ...newRow(section), name, description }));

export function TemplatesClient({ initial }: { initial: TemplateWithCriteria[] }) {
  const [templates, setTemplates] = useState(initial);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | undefined>();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [scaleMax, setScaleMax] = useState(5);
  const [rows, setRows] = useState<Row[]>([]);
  const [saving, setSaving] = useState(false);
  const reload = async () => setTemplates(await getReviewTemplates());

  function openNew() {
    setEditingId(undefined); setName(""); setDescription(""); setScaleMax(5); setRows(STARTER.map((r) => ({ ...r, key: Math.random().toString(36).slice(2) })));
    setOpen(true);
  }
  function openEdit(t: TemplateWithCriteria) {
    setEditingId(t.id); setName(t.name); setDescription(t.description ?? ""); setScaleMax(t.scaleMax);
    setRows(t.criteria.map((c) => ({ key: c.id, section: c.section, name: c.name, description: c.description ?? "", weight: c.weight })));
    setOpen(true);
  }
  const patch = (key: string, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));
  const move = (i: number, d: -1 | 1) => setRows((rs) => { const j = i + d; if (j < 0 || j >= rs.length) return rs; const c = [...rs]; [c[i], c[j]] = [c[j], c[i]]; return c; });

  async function save() {
    setSaving(true);
    try {
      const r = await saveReviewTemplate({ id: editingId, name, description, scaleMax, criteria: rows.map((x) => ({ section: x.section, name: x.name, description: x.description, weight: x.weight })) });
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
        description="The criteria, rating scale and weights used in performance reviews"
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
                  <span className="rounded-md border border-border px-1.5 py-px text-[10px] text-muted-foreground">{t.criteria.length} criteria · scale 1 to {t.scaleMax}</span>
                  {!t.isActive && <span className="rounded-md border border-border px-1.5 py-px text-[10px] text-muted-foreground">Inactive</span>}
                  <div className="ml-auto flex gap-1.5">
                    <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={() => openEdit(t)}><PencilIcon className="h-3 w-3" />Edit</Button>
                    <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => toggle(t)}>{t.isActive ? "Deactivate" : "Activate"}</Button>
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
                  <Input className="h-8 text-xs" value={r.description} onChange={(e) => patch(r.key, { description: e.target.value })} placeholder="What this criterion looks at (shown to the employee and manager)" />
                </div>
              ))}
              <datalist id="review-sections">{[...new Set(rows.map((r) => r.section).filter(Boolean))].map((s) => <option key={s} value={s} />)}</datalist>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setRows((rs) => [...rs, newRow(rs[rs.length - 1]?.section ?? "")])}><PlusIcon className="h-3.5 w-3.5" />Add criterion</Button>
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
