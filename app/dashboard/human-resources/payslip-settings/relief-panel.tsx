"use client";

import { useState } from "react";
import { toast } from "sonner";
import { InfoIcon, PencilIcon, PlusIcon, TrashIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  createTaxReliefType,
  deleteTaxReliefType,
  getTaxReliefTypes,
  setTaxReliefActive,
  updateTaxReliefType,
} from "@/server/tax-relief";

type Relief = Awaited<ReturnType<typeof getTaxReliefTypes>>[number];

const rm = (v: string | number) => Number(v).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Draft = {
  id: string | null;
  name: string;
  defaultAmount: string;
  maxAmount: string;
  appliesToAll: boolean;
  linkEpf: boolean;
};
const blank: Draft = { id: null, name: "", defaultAmount: "", maxAmount: "", appliesToAll: false, linkEpf: false };

export function ReliefPanel({ initial }: { initial: Relief[] }) {
  const [items, setItems] = useState(initial);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const reload = async () => setItems(await getTaxReliefTypes());
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    }
  };

  const open = (r: Relief | null) => {
    setConfirmDelete(false);
    setDraft(
      r
        ? {
            id: r.id,
            name: r.name,
            defaultAmount: String(Number(r.defaultAmount)),
            maxAmount: r.maxAmount === null ? "" : String(Number(r.maxAmount)),
            appliesToAll: r.appliesToAll,
            linkEpf: r.linkEpf,
          }
        : blank,
    );
  };

  const save = async () => {
    if (!draft) return;
    if (!draft.name.trim()) return toast.error("Enter a name");
    const payload = {
      name: draft.name,
      defaultAmount: Number(draft.defaultAmount) || 0,
      maxAmount: draft.maxAmount.trim() === "" ? null : Number(draft.maxAmount),
      appliesToAll: draft.appliesToAll,
      linkEpf: draft.linkEpf,
    };
    setSaving(true);
    try {
      if (draft.id) await updateTaxReliefType(draft.id, payload);
      else await createTaxReliefType(payload);
      await reload();
      setDraft(null);
      toast.success(draft.id ? "Saved" : "Added");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!draft?.id) return;
    if (!confirmDelete) return setConfirmDelete(true);
    try {
      await deleteTaxReliefType(draft.id);
      await reload();
      setDraft(null);
      toast.success("Deleted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not delete");
    }
  };

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex gap-2.5 p-3 rounded-lg border border-border bg-muted/20 text-xs text-muted-foreground">
        <InfoIcon className="w-4 h-4 shrink-0 mt-px" />
        <p>
          PCB is calculated after subtracting tax relief. <span className="font-medium text-foreground">You decide</span>{" "}
          which reliefs apply and how much. Amounts are <em>per year</em>. Set the default here, then adjust each
          employee under the Salary structure tab (for example, the number of children). Changes apply to payslips
          created or edited afterwards.
        </p>
      </div>

      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Tax relief types</h3>
        <Button size="sm" className="gap-1.5" onClick={() => open(null)}>
          <PlusIcon className="w-3.5 h-3.5" /> Add relief
        </Button>
      </div>

      <div className="rounded-xl border border-border">
        {items.map((r) => (
          <div key={r.id} className={`flex items-center gap-3 px-4 py-3 border-b border-border last:border-0 ${r.isActive ? "" : "opacity-60"}`}>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-sm font-medium">{r.name}</span>
                {r.appliesToAll && <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-px text-[10px] font-medium text-amber-700">Everyone</span>}
                {r.linkEpf && <span className="rounded border border-blue-200 bg-blue-50 px-1.5 py-px text-[10px] font-medium text-blue-700">From actual EPF</span>}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {r.linkEpf ? "Employee's yearly EPF" : `RM ${rm(r.defaultAmount)} default`}
                {r.maxAmount !== null && ` · up to RM ${rm(r.maxAmount)} a year`}
                {!r.appliesToAll && " · only employees you tick"}
              </div>
            </div>
            <label className="flex items-center gap-2 text-xs text-muted-foreground shrink-0">
              {r.isActive ? "On" : "Off"}
              <Switch size="sm" checked={r.isActive} onCheckedChange={(v) => run(() => setTaxReliefActive(r.id, v))} aria-label={`Toggle ${r.name}`} />
            </label>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0" aria-label={`Edit ${r.name}`} onClick={() => open(r)}>
              <PencilIcon className="w-3.5 h-3.5" />
            </Button>
          </div>
        ))}
        {items.length === 0 && <p className="px-4 py-8 text-center text-sm text-muted-foreground">No reliefs yet.</p>}
      </div>

      <Dialog open={!!draft} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent
          className="gap-0 p-0 flex flex-col overflow-hidden
            h-dvh w-screen max-w-none rounded-none top-0 left-0 translate-x-0 translate-y-0
            sm:h-auto sm:max-h-[90vh] sm:top-1/2 sm:left-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl
            sm:w-[calc(100vw-4rem)] sm:max-w-lg"
        >
          <DialogHeader className="px-4 pt-4 pb-3 sm:px-6 sm:pt-6 sm:pb-4 border-b border-border">
            <DialogTitle>{draft?.id ? "Edit" : "Add"} tax relief</DialogTitle>
            <DialogDescription>Amounts are per year, in RM.</DialogDescription>
          </DialogHeader>
          {draft && (
            <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5 space-y-5">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Name</label>
                <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Spouse" className="h-9 text-sm" autoFocus />
              </div>

              <label className="flex items-center justify-between gap-4 rounded-lg border border-input px-3 py-2.5 cursor-pointer">
                <span>
                  <span className="block text-sm font-medium">Taken from actual EPF</span>
                  <span className="block text-[11px] text-muted-foreground">The amount is the employee&apos;s yearly EPF contribution, up to the maximum below.</span>
                </span>
                <Switch checked={draft.linkEpf} onCheckedChange={(v) => setDraft({ ...draft, linkEpf: v })} />
              </label>

              <div className="grid grid-cols-2 gap-3">
                {!draft.linkEpf && (
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Default amount</label>
                    <Input type="number" min="0" value={draft.defaultAmount} onChange={(e) => setDraft({ ...draft, defaultAmount: e.target.value })} placeholder="0" className="h-9 text-sm" />
                  </div>
                )}
                <div className={draft.linkEpf ? "col-span-2" : ""}>
                  <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Maximum per year</label>
                  <Input type="number" min="0" value={draft.maxAmount} onChange={(e) => setDraft({ ...draft, maxAmount: e.target.value })} placeholder={draft.linkEpf ? "4000" : "No limit"} className="h-9 text-sm" />
                </div>
              </div>

              <label className="flex items-center justify-between gap-4 rounded-lg border border-input px-3 py-2.5 cursor-pointer">
                <span>
                  <span className="block text-sm font-medium">Applies to everyone</span>
                  <span className="block text-[11px] text-muted-foreground">Every employee gets this relief automatically. You can still change or remove it per employee. Turn off to give it only to employees you tick.</span>
                </span>
                <Switch checked={draft.appliesToAll} onCheckedChange={(v) => setDraft({ ...draft, appliesToAll: v })} />
              </label>
            </div>
          )}
          <DialogFooter className="px-4 py-3 sm:px-6 sm:py-4 border-t border-border flex-col-reverse gap-2 sm:flex-row sm:justify-between">
            {draft?.id ? (
              <Button variant="ghost" className="text-destructive hover:text-destructive gap-1.5" onClick={remove}>
                <TrashIcon className="w-3.5 h-3.5" />
                {confirmDelete ? "Click again to delete" : "Delete"}
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2 [&>button]:flex-1 sm:[&>button]:flex-none">
              <Button variant="outline" onClick={() => setDraft(null)}>Cancel</Button>
              <Button onClick={save} disabled={saving || !draft?.name.trim()}>{saving ? "Saving…" : draft?.id ? "Save changes" : "Add"}</Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
