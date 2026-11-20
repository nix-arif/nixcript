"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { getSupplierTerms, saveSupplierClaimTerms, type SupplierTerms } from "@/server/post-delivery";
import { BASES, SITUATIONS, SITUATION_KEYS, situationLabel, type Basis } from "@/lib/post-delivery/core";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ArrowLeftIcon, PencilIcon, PlusIcon, TrashIcon } from "lucide-react";

type Row = { key: string; situation: string; windowDays: string; basis: Basis; notes: string };
const newKey = () => Math.random().toString(36).slice(2);

export function TermsClient({ initial }: { initial: SupplierTerms[] }) {
  const [suppliers, setSuppliers] = useState(initial);
  const [editing, setEditing] = useState<SupplierTerms | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [saving, setSaving] = useState(false);

  function edit(s: SupplierTerms) {
    setEditing(s);
    const mine = s.terms.map((t) => ({ key: newKey(), situation: t.situation, windowDays: String(t.windowDays), basis: t.basis, notes: t.notes ?? "" }));
    setRows(mine.some((r) => r.situation === "") ? mine : [{ key: newKey(), situation: "", windowDays: "", basis: "receipt" as Basis, notes: "" }, ...mine]);
  }
  const patch = (k: string, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === k ? { ...r, ...p } : r)));
  const used = new Set(rows.map((r) => r.situation));

  async function save() {
    if (!editing) return;
    setSaving(true);
    try {
      // a general row left without days is simply "no general term"
      const terms = rows.filter((r) => !(r.situation === "" && r.windowDays.trim() === "")).map((r) => ({ situation: r.situation, windowDays: r.windowDays, basis: r.basis, notes: r.notes }));
      const r = await saveSupplierClaimTerms(editing.id, terms);
      if (!r.ok) { toast.error(r.error); return; }
      setSuppliers(await getSupplierTerms()); setEditing(null); toast.success("Terms saved");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not save"); } finally { setSaving(false); }
  }

  return (
    <div className="p-4 sm:p-6 max-w-4xl">
      <PageHeader
        title="Claim terms"
        description="How long each supplier accepts a claim, and counted from which date. A claim's deadline is worked out from these."
        action={<Button asChild variant="outline" size="sm" className="gap-1.5"><Link href="/dashboard/procurement/supplier-claims"><ArrowLeftIcon className="h-3.5 w-3.5" />Claims</Link></Button>}
      />
      <p className="mb-3 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        Suppliers differ, so each has its own terms. Enter a general term (for example <b>30 days from the date we received the goods</b>), and add a different one for a kind of problem when the supplier treats it differently (for example <b>365 days from delivery</b> for failures in use). The terms are copied into a claim when it is raised.
      </p>
      <ul className="space-y-2">
        {suppliers.map((s) => {
          const general = s.terms.find((t) => t.situation === "");
          const others = s.terms.filter((t) => t.situation !== "");
          return (
            <li key={s.id} className="rounded-xl border border-border bg-background px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold">{s.name}</span>
                {s.terms.length === 0 && <span className="rounded-md border border-amber-200 bg-amber-50 px-1.5 py-px text-[10px] font-medium text-amber-800 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-300">No terms yet: claims get no deadline</span>}
                <Button variant="outline" size="sm" className="ml-auto h-7 gap-1 text-xs" onClick={() => edit(s)}><PencilIcon className="h-3 w-3" />{s.terms.length ? "Edit" : "Add terms"}</Button>
              </div>
              {s.terms.length > 0 && (
                <ul className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
                  {general && <li><span className="font-medium text-foreground">Any problem:</span> {general.windowDays} days from the {BASES[general.basis].toLowerCase()}{general.notes ? ` · ${general.notes}` : ""}</li>}
                  {others.map((t) => <li key={t.situation}><span className="font-medium text-foreground">{situationLabel(t.situation)}:</span> {t.windowDays} days from the {BASES[t.basis].toLowerCase()}{t.notes ? ` · ${t.notes}` : ""}</li>)}
                </ul>
              )}
            </li>
          );
        })}
        {suppliers.length === 0 && <li className="rounded-xl border border-dashed border-border py-12 text-center text-xs text-muted-foreground">No suppliers yet. Add suppliers first.</li>}
      </ul>

      <Sheet open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <SheetContent className="w-full max-w-xl! overflow-y-auto px-6 sm:px-8">
          <SheetHeader className="mb-4"><SheetTitle>{editing?.name}</SheetTitle><SheetDescription>Terms for claims against this supplier. Claims already raised keep the deadline they were given.</SheetDescription></SheetHeader>
          <div className="space-y-3">
            {rows.map((r) => (
              <div key={r.key} className="space-y-2 rounded-lg border border-border p-3">
                <div className="flex items-center gap-2">
                  {r.situation === "" ? <span className="text-xs font-semibold">Any kind of problem</span> : (
                    <select className="h-8 flex-1 rounded-md border border-input bg-background px-2 text-xs" value={r.situation} onChange={(e) => patch(r.key, { situation: e.target.value })}>
                      <option value={r.situation}>{situationLabel(r.situation)}</option>
                      {SITUATION_KEYS.filter((k) => !used.has(k)).map((k) => <option key={k} value={k}>{SITUATIONS[k].label}</option>)}
                    </select>
                  )}
                  {r.situation !== "" && <button type="button" aria-label="Remove" className="ml-auto text-muted-foreground hover:text-destructive" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}><TrashIcon className="h-4 w-4" /></button>}
                </div>
                <div className="grid gap-2 sm:grid-cols-5">
                  <div className="space-y-1 sm:col-span-1"><Label className="text-xs">Days</Label><Input className="h-8 text-sm tabular-nums" inputMode="numeric" value={r.windowDays} onChange={(e) => patch(r.key, { windowDays: e.target.value })} placeholder={r.situation === "" ? "none" : "30"} /></div>
                  <div className="space-y-1 sm:col-span-4"><Label className="text-xs">Counted from</Label>
                    <select className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs" value={r.basis} onChange={(e) => patch(r.key, { basis: e.target.value as Basis })}>{(Object.keys(BASES) as Basis[]).map((b) => <option key={b} value={b}>{BASES[b]}</option>)}</select>
                  </div>
                </div>
                <Input className="h-8 text-xs" value={r.notes} onChange={(e) => patch(r.key, { notes: e.target.value })} placeholder="Note, e.g. warranty is 12 months; send photos within 7 days (optional)" />
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" className="gap-1.5" disabled={used.size >= SITUATION_KEYS.length + 1}
              onClick={() => setRows((rs) => [...rs, { key: newKey(), situation: SITUATION_KEYS.find((k) => !used.has(k)) ?? "other", windowDays: "", basis: "receipt", notes: "" }])}>
              <PlusIcon className="h-3.5 w-3.5" />A different term for a kind of problem
            </Button>
            <div className="flex gap-2 pt-2"><Button className="flex-1" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save terms"}</Button><Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button></div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
