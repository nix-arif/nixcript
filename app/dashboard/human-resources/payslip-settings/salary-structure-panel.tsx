"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import type { getTaxReliefTypes } from "@/server/tax-relief";
import { PencilIcon, PlusIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getPayItems, getSalaryStructures, saveSalaryStructure } from "@/server/payroll";

type Row = Awaited<ReturnType<typeof getSalaryStructures>>[number];
type PayItem = Awaited<ReturnType<typeof getPayItems>>[number];

type Relief = Awaited<ReturnType<typeof getTaxReliefTypes>>[number];
const rm = (v: number | string) =>
  Number(v).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function SalaryStructurePanel({
  initialRows,
  payItems,
  reliefTypes,
}: {
  initialRows: Row[];
  payItems: PayItem[];
  reliefTypes: Relief[];
}) {
  const [rows, setRows] = useState(initialRows);
  const [editing, setEditing] = useState<Row | null>(null);
  const [basic, setBasic] = useState("");
  const [lines, setLines] = useState<{ payItemId: string; amount: string }[]>([]);
  const [saving, setSaving] = useState(false);
  // Tax relief for this employee: whether it applies and the yearly amount
  const [reliefs, setReliefs] = useState<Record<string, { on: boolean; amount: string }>>({});
  const activeReliefs = reliefTypes.filter((t) => t.isActive);

  const recurring = payItems.filter((p) => p.recurring && p.isActive);
  const itemName = (id: string) => payItems.find((p) => p.id === id)?.name ?? "?";

  const open = (r: Row) => {
    setEditing(r);
    setBasic(r.hasStructure ? String(Number(r.basicSalary)) : "");
    setLines(r.items.map((i) => ({ payItemId: i.payItemId, amount: String(Number(i.amount)) })));
    const next: Record<string, { on: boolean; amount: string }> = {};
    for (const t of activeReliefs) {
      const own = r.reliefs.find((x) => x.typeId === t.id);
      const amount = own ? Number(own.amount) : t.appliesToAll ? Number(t.defaultAmount) : 0;
      next[t.id] = { on: own ? amount > 0 : t.appliesToAll, amount: String(amount > 0 ? amount : Number(t.defaultAmount) || "") };
    }
    setReliefs(next);
  };

  const save = async () => {
    if (!editing) return;
    const b = Number(basic);
    if (!(b >= 0) || basic.trim() === "") return toast.error("Enter basic salary");
    setSaving(true);
    try {
      await saveSalaryStructure({
        userId: editing.userId,
        basicSalary: b,
        items: lines
          .filter((l) => l.payItemId)
          .map((l) => ({ payItemId: l.payItemId, amount: Number(l.amount) || 0 })),
        reliefs: activeReliefs.flatMap((t) => {
          const st = reliefs[t.id];
          if (!st) return [];
          if (st.on) {
            const amt = t.linkEpf ? Number(t.maxAmount ?? t.defaultAmount) || 0 : Number(st.amount) || 0;
            // same as the default for an "everyone" relief: nothing to store
            return t.appliesToAll && !t.linkEpf && amt === Number(t.defaultAmount) ? [] : [{ typeId: t.id, amount: amt }];
          }
          return t.appliesToAll ? [{ typeId: t.id, amount: 0 }] : [];
        }),
      });
      setRows(await getSalaryStructures());
      setEditing(null);
      toast.success("Salary structure saved");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const unused = recurring.filter((p) => !lines.some((l) => l.payItemId === p.id));

  return (
    <div>
      <p className="text-xs text-muted-foreground mb-4 max-w-2xl">
        Each employee&apos;s basic salary and recurring pay items. “Generate payslips” on a payroll period uses
        these, and a new payslip starts from them.
      </p>

      <div className="border border-border rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-muted-foreground border-b border-border bg-muted/30">
              <th className="text-left font-medium px-4 py-2">Employee</th>
              <th className="text-right font-medium px-3 py-2">Basic (RM)</th>
              <th className="hidden md:table-cell text-left font-medium px-3 py-2">Recurring items</th>
              <th className="w-12" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.userId} className="border-b border-border last:border-0">
                <td className="px-4 py-2">
                  <div className="font-medium">{r.fullname || r.name}</div>
                  <div className="text-xs text-muted-foreground">{r.email}</div>
                  {r.items.length > 0 && (
                    <div className="md:hidden text-[11px] text-muted-foreground mt-0.5">
                      {r.items.map((i) => `${itemName(i.payItemId)} ${rm(i.amount)}`).join(" · ")}
                    </div>
                  )}
                </td>
                <td className="px-3 text-right font-mono">
                  {r.hasStructure ? rm(r.basicSalary) : <span className="text-muted-foreground">Not set</span>}
                </td>
                <td className="hidden md:table-cell px-3 text-xs text-muted-foreground">
                  {r.items.length
                    ? r.items.map((i) => `${itemName(i.payItemId)} ${rm(i.amount)}`).join(" · ")
                    : "—"}
                </td>
                <td className="text-center">
                  <button type="button" className="p-3" aria-label={`Edit ${r.name}`} onClick={() => open(r)}>
                    <PencilIcon className="w-4 h-4 text-muted-foreground hover:text-foreground" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent
          className="gap-0 p-0 flex flex-col overflow-hidden
            h-dvh w-screen max-w-none rounded-none top-0 left-0 translate-x-0 translate-y-0
            sm:h-auto sm:max-h-[90vh] sm:top-1/2 sm:left-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl
            sm:w-[calc(100vw-4rem)] sm:max-w-xl"
        >
          <DialogHeader className="px-4 pt-4 pb-3 sm:px-6 sm:pt-6 sm:pb-4 border-b border-border">
            <DialogTitle>{editing?.fullname || editing?.name}</DialogTitle>
            <DialogDescription>{editing?.email}</DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5 space-y-5">
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Basic salary (RM)</label>
              <input
                type="number"
                value={basic}
                onChange={(e) => setBasic(e.target.value)}
                className="h-9 w-full border border-input rounded-md px-2 bg-background text-sm"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs text-muted-foreground">Recurring pay items</label>
                {unused.length > 0 && (
                  <button
                    type="button"
                    className="text-xs text-primary flex items-center gap-1"
                    onClick={() => setLines([...lines, { payItemId: unused[0].id, amount: "" }])}
                  >
                    <PlusIcon className="w-3 h-3" /> Add
                  </button>
                )}
              </div>
              {recurring.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No recurring pay items yet. Add some in Payslip Settings.
                </p>
              )}
              {lines.map((l, i) => (
                <div key={i} className="flex flex-wrap sm:flex-nowrap gap-2 mb-2 items-center">
                  <select
                    value={l.payItemId}
                    onChange={(e) =>
                      setLines(lines.map((x, k) => (k === i ? { ...x, payItemId: e.target.value } : x)))
                    }
                    className="h-9 text-sm flex-1 min-w-full sm:min-w-0 border border-input rounded-md px-2 bg-background"
                  >
                    {[...unused, ...recurring.filter((p) => p.id === l.payItemId)].map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.kind})
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    value={l.amount}
                    placeholder="Amount"
                    onChange={(e) =>
                      setLines(lines.map((x, k) => (k === i ? { ...x, amount: e.target.value } : x)))
                    }
                    className="h-9 text-sm flex-1 sm:flex-none sm:w-28 border border-input rounded-md px-2 bg-background"
                  />
                  <button type="button" aria-label="Remove" className="p-2" onClick={() => setLines(lines.filter((_, k) => k !== i))}>
                    <XIcon className="w-4 h-4 text-muted-foreground hover:text-destructive" />
                  </button>
                </div>
              ))}
            </div>

            {activeReliefs.length > 0 && (
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Tax relief (per year, used for PCB)</label>
                <div className="rounded-lg border border-border divide-y divide-border">
                  {activeReliefs.map((t) => {
                    const st = reliefs[t.id] ?? { on: false, amount: "" };
                    const set = (patch: Partial<typeof st>) => setReliefs({ ...reliefs, [t.id]: { ...st, ...patch } });
                    return (
                      <div key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2">
                        <Switch size="sm" checked={st.on} onCheckedChange={(v) => set({ on: v })} aria-label={`Apply ${t.name}`} />
                        <span className="min-w-0 flex-1 text-sm">
                          {t.name}
                          {t.linkEpf && <span className="ml-1.5 text-[10px] text-muted-foreground">from actual EPF</span>}
                        </span>
                        {st.on && !t.linkEpf && (
                          <input
                            type="number"
                            min="0"
                            value={st.amount}
                            onChange={(e) => set({ amount: e.target.value })}
                            className="h-8 w-28 text-sm border border-input rounded-md px-2 bg-background"
                            aria-label={`${t.name} amount`}
                          />
                        )}
                        {st.on && t.maxAmount !== null && !t.linkEpf && (
                          <span className="text-[10px] text-muted-foreground">max {rm(t.maxAmount)}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
          <DialogFooter className="px-4 py-3 sm:px-6 sm:py-4 border-t border-border flex-row gap-2 sm:justify-end [&>button]:flex-1 sm:[&>button]:flex-none">
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
