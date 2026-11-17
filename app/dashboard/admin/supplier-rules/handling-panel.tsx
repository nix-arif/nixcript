"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { createRestrictedSupplierRule, deleteRestrictedSupplierRule, type RestrictedSupplierRule } from "@/server/supplier-restrictions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SuggestInput } from "@/components/ui/suggest-input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { BuildingIcon, FactoryIcon, PlusIcon, SearchIcon, TrashIcon } from "lucide-react";

const EMPTY = { supplierName: "", designatedOrganizationId: "", notes: "" };

export function HandlingPanel({
  canManage, rules, orgs, supplierNames, reload,
}: {
  canManage: boolean;
  rules: RestrictedSupplierRule[];
  orgs: { id: string; name: string }[];
  supplierNames: string[];
  reload: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const grouped = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const shown = rules.filter((r) => !needle || r.supplierName.toLowerCase().includes(needle) || (r.designatedOrganizationName ?? "").toLowerCase().includes(needle));
    const map = new Map<string, { name: string; rules: RestrictedSupplierRule[] }>();
    for (const r of shown) {
      const g = map.get(r.designatedOrganizationId) ?? { name: r.designatedOrganizationName ?? "Unknown organization", rules: [] };
      g.rules.push(r);
      map.set(r.designatedOrganizationId, g);
    }
    return [...map.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name));
  }, [rules, q]);

  function openCreate() {
    setForm({ ...EMPTY, designatedOrganizationId: orgs[0]?.id ?? "" });
    setOpen(true);
  }

  async function save() {
    if (!form.supplierName.trim()) return toast.error("Supplier name is required");
    if (!form.designatedOrganizationId) return toast.error("Choose which organization handles this supplier");
    setSaving(true);
    try {
      await createRestrictedSupplierRule(form);
      await reload();
      setOpen(false);
      toast.success("Rule added");
    } catch (e: any) { toast.error(e.message); } finally { setSaving(false); }
  }

  async function remove(r: RestrictedSupplierRule) {
    if (!confirm(`Stop routing "${r.supplierName}" through ${r.designatedOrganizationName ?? "its organization"}? Every organization will be able to order from this supplier directly again.`)) return;
    setDeleting(r.id);
    try { await deleteRestrictedSupplierRule(r.id); await reload(); toast.success("Rule removed"); }
    catch (e: any) { toast.error(e.message); } finally { setDeleting(null); }
  }

  return (
    <div className="space-y-4 pt-1">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="max-w-xl text-sm text-muted-foreground">
          Choose which organization deals with a supplier. A PO or PR line for that supplier from any other organization is issued to the one you choose, and it orders from the supplier itself.
        </p>
        {canManage && <Button onClick={openCreate} className="gap-2"><PlusIcon className="h-4 w-4" />Add supplier rule</Button>}
      </div>

      {rules.length > 4 && (
        <div className="relative max-w-xs">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="h-9 pl-8" placeholder="Search supplier or organization" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      )}

      {rules.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-14 text-center">
          <FactoryIcon className="mx-auto mb-3 h-8 w-8 text-muted-foreground/40" />
          <div className="mb-1 text-sm font-medium">No supplier rules yet</div>
          <p className="mx-auto mb-4 max-w-sm text-xs text-muted-foreground">Every organization can order from any supplier directly until a rule is added.</p>
          {canManage && <Button variant="outline" size="sm" className="gap-2" onClick={openCreate}><PlusIcon className="h-3.5 w-3.5" />Add the first rule</Button>}
        </div>
      ) : grouped.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">No rule matches &ldquo;{q}&rdquo;.</p>
      ) : (
        <div className="space-y-4">
          {grouped.map(([orgId, g]) => (
            <section key={orgId} className="overflow-hidden rounded-xl border border-border">
              <header className="flex items-center gap-2 border-b border-border bg-indigo-50/60 px-4 py-2.5 dark:bg-indigo-900/10">
                <BuildingIcon className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                <span className="text-sm font-semibold">{g.name}</span>
                <span className="text-xs text-muted-foreground">handles {g.rules.length} supplier{g.rules.length === 1 ? "" : "s"}</span>
              </header>
              <ul className="divide-y divide-border/60">
                {g.rules.map((r) => (
                  <li key={r.id} className="flex items-start gap-3 px-4 py-2.5 hover:bg-muted/20">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">{r.supplierName}</div>
                      {r.notes && <p className="mt-0.5 text-xs text-muted-foreground">{r.notes}</p>}
                    </div>
                    <span className="hidden pt-0.5 text-[11px] text-muted-foreground sm:block">Added {new Date(r.createdAt).toLocaleDateString()}</span>
                    {canManage && (
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" disabled={deleting === r.id} onClick={() => remove(r)} aria-label={`Remove rule for ${r.supplierName}`}>
                        <TrashIcon className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <p className="text-[11px] text-muted-foreground">
        Suppliers are matched by name, ignoring capitals and spaces. &ldquo;ABC Medical&rdquo; and &ldquo;ABC Medical Sdn Bhd&rdquo; are different names, so add each spelling you use. A rule does not change POs that already exist.
      </p>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full max-w-lg! overflow-y-auto px-8 sm:max-w-md">
          <SheetHeader className="mb-5">
            <SheetTitle>Add supplier rule</SheetTitle>
            <SheetDescription>One organization orders from this supplier. The others order through it.</SheetDescription>
          </SheetHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Supplier name <span className="text-destructive">*</span></Label>
              <SuggestInput value={form.supplierName} onChange={(v) => setForm({ ...form, supplierName: v })} suggestions={supplierNames} placeholder="e.g. Minaro Surgical" autoFocus />
              <p className="text-[11px] text-muted-foreground">Pick a supplier you already have, or type a name no organization has added yet.</p>
            </div>
            <div className="space-y-1.5">
              <Label>Organization that handles it <span className="text-destructive">*</span></Label>
              <div className="grid gap-1.5">
                {orgs.map((o) => (
                  <button
                    key={o.id} type="button" aria-pressed={form.designatedOrganizationId === o.id}
                    onClick={() => setForm({ ...form, designatedOrganizationId: o.id })}
                    className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors ${form.designatedOrganizationId === o.id ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20" : "border-border hover:bg-muted/30"}`}
                  >
                    <BuildingIcon className="h-4 w-4 shrink-0 text-muted-foreground" />{o.name}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Why this supplier goes through one organization (optional)" rows={2} />
            </div>
            <div className="flex gap-2 pt-2">
              <Button className="flex-1" onClick={save} disabled={saving}>{saving ? "Saving…" : "Add rule"}</Button>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
