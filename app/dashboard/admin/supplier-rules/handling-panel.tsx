"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { createRestrictedSupplierRule, deleteRestrictedSupplierRule, type RestrictedSupplierRule } from "@/server/supplier-restrictions";
import { formatBusinessDate, periodStatuses, sortPeriods, todayKL, type PeriodStatus } from "@/lib/org/handling-periods";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SuggestInput } from "@/components/ui/suggest-input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { BuildingIcon, CalendarClockIcon, FactoryIcon, PlusIcon, SearchIcon, TrashIcon } from "lucide-react";

const EMPTY = { supplierName: "", designatedOrganizationId: "", effectiveFrom: "", notes: "" };

const STATUS_TAG: Record<PeriodStatus, { label: string; cls: string }> = {
  current: { label: "Current", cls: "border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-800 dark:bg-indigo-900/20 dark:text-indigo-400" },
  upcoming: { label: "Upcoming", cls: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-300" },
  past: { label: "Ended", cls: "border-border text-muted-foreground" },
};

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
  const today = todayKL();

  // one card per supplier, with its periods in date order
  const suppliers = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const map = new Map<string, RestrictedSupplierRule[]>();
    for (const r of rules) map.set(r.supplierNameNormalized, [...(map.get(r.supplierNameNormalized) ?? []), r]);
    return [...map.values()]
      .map((list) => sortPeriods(list))
      .filter((list) => !needle || list[0].supplierName.toLowerCase().includes(needle) || list.some((r) => (r.designatedOrganizationName ?? "").toLowerCase().includes(needle)))
      .sort((a, b) => a[0].supplierName.localeCompare(b[0].supplierName));
  }, [rules, q]);

  function openCreate(supplierName = "", handOver = false) {
    setForm({ ...EMPTY, supplierName, designatedOrganizationId: orgs[0]?.id ?? "", effectiveFrom: handOver ? today : "" });
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
      toast.success(form.effectiveFrom ? "Handover added" : "Rule added");
    } catch (e: any) { toast.error(e.message); } finally { setSaving(false); }
  }

  async function remove(r: RestrictedSupplierRule, onlyOne: boolean) {
    const msg = onlyOne
      ? `Stop routing "${r.supplierName}" through ${r.designatedOrganizationName ?? "its organization"}? Every organization will be able to order from this supplier directly again.`
      : `Remove this period (${r.designatedOrganizationName ?? "organization"}${r.effectiveFrom ? ` from ${formatBusinessDate(r.effectiveFrom)}` : ", from the beginning"})? The periods before and after it then stay as they are.`;
    if (!confirm(msg)) return;
    setDeleting(r.id);
    try { await deleteRestrictedSupplierRule(r.id); await reload(); toast.success("Removed"); }
    catch (e: any) { toast.error(e.message); } finally { setDeleting(null); }
  }

  return (
    <div className="space-y-4 pt-1">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="max-w-xl text-sm text-muted-foreground">
          Choose which organization deals with a supplier. A PO from any other organization is issued to the one that handles the supplier on the PO&apos;s date, and that organization orders from the supplier itself. When another organization takes over, add a handover with its start date.
        </p>
        {canManage && <Button onClick={() => openCreate()} className="gap-2"><PlusIcon className="h-4 w-4" />Add supplier rule</Button>}
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
          {canManage && <Button variant="outline" size="sm" className="gap-2" onClick={() => openCreate()}><PlusIcon className="h-3.5 w-3.5" />Add the first rule</Button>}
        </div>
      ) : suppliers.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">No rule matches &ldquo;{q}&rdquo;.</p>
      ) : (
        <div className="space-y-3">
          {suppliers.map((list) => {
            const status = periodStatuses(list, today);
            const current = list.find((r) => status.get(r) === "current");
            return (
              <section key={list[0].supplierNameNormalized} className="overflow-hidden rounded-xl border border-border">
                <header className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/30 px-4 py-2.5">
                  <FactoryIcon className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-semibold">{list[0].supplierName}</span>
                  <span className="text-xs text-muted-foreground">
                    {current ? <>handled by <span className="font-medium text-foreground">{current.designatedOrganizationName}</span> now</> : "no organization handles it yet"}
                  </span>
                  {canManage && (
                    <Button variant="outline" size="sm" className="ml-auto h-7 gap-1.5 text-xs" onClick={() => openCreate(list[0].supplierName, true)}>
                      <CalendarClockIcon className="h-3.5 w-3.5" />Add handover
                    </Button>
                  )}
                </header>
                <ul className="divide-y divide-border/60">
                  {list.map((r) => {
                    const st = status.get(r)!;
                    return (
                      <li key={r.id} className={`flex items-start gap-3 px-4 py-2.5 ${st === "past" ? "opacity-60" : ""}`}>
                        <div className="w-32 shrink-0 pt-0.5 text-xs text-muted-foreground">
                          {r.effectiveFrom ? `From ${formatBusinessDate(r.effectiveFrom)}` : "From the beginning"}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                            <BuildingIcon className="h-3.5 w-3.5 text-muted-foreground" />{r.designatedOrganizationName ?? "Unknown organization"}
                            <span className={`rounded-md border px-1.5 py-px text-[10px] font-semibold ${STATUS_TAG[st].cls}`}>{STATUS_TAG[st].label}</span>
                          </div>
                          {r.notes && <p className="mt-0.5 text-xs text-muted-foreground">{r.notes}</p>}
                        </div>
                        {canManage && (
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" disabled={deleting === r.id} onClick={() => remove(r, list.length === 1)} aria-label={`Remove this period for ${r.supplierName}`}>
                            <TrashIcon className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      <p className="text-[11px] text-muted-foreground">
        The date that counts is the date of the PO or PR. A handover only affects POs made on or after its start date; POs that already exist are not moved. Suppliers are matched by name, ignoring capitals and spaces, so add each spelling you use.
      </p>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full max-w-lg! overflow-y-auto px-8 sm:max-w-md">
          <SheetHeader className="mb-5">
            <SheetTitle>{form.effectiveFrom ? "Add handover" : "Add supplier rule"}</SheetTitle>
            <SheetDescription>One organization orders from this supplier. The others order through it.</SheetDescription>
          </SheetHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Supplier name <span className="text-destructive">*</span></Label>
              <SuggestInput value={form.supplierName} onChange={(v) => setForm({ ...form, supplierName: v })} suggestions={supplierNames} placeholder="e.g. Minaro Surgical" autoFocus={!form.supplierName} />
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
              <Label>Takes over from</Label>
              <Input type="date" className="w-44" value={form.effectiveFrom} onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })} />
              <p className="text-[11px] text-muted-foreground">
                Leave empty if this organization has handled the supplier from the start. To hand the supplier to another organization later, add another rule with the date it takes over; the earlier one then ends the day before.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Why this supplier goes through one organization (optional)" rows={2} />
            </div>
            <div className="flex gap-2 pt-2">
              <Button className="flex-1" onClick={save} disabled={saving}>{saving ? "Saving…" : form.effectiveFrom ? "Add handover" : "Add rule"}</Button>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
