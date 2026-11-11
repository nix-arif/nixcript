"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { toast } from "sonner";
import { CheckIcon, ListPlusIcon, MinusIcon, PlusIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  getAddableLinesForPackingList,
  requestPackingListRevision,
  decidePackingListRevision,
  cancelPackingListRevision,
  type PackableItem,
  type PackingListRevisionView,
  type PackingListWithItems,
} from "@/server/packing-list";
import type { AmendApproval } from "./amend-line";

const n = (v: number) => String(Math.round(v * 1000) / 1000);

// "Add / remove lines" on a packing list whose inspection is still open.
// Builds one request — lines to take off, PO lines (or whole POs) to add —
// that an approver then signs off. Nothing changes until it's approved.
export function RequestRevisionButton({ pl, poLabel }: { pl: PackingListWithItems; poLabel: (poId: string) => string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"remove" | "add">("remove");
  const [remove, setRemove] = useState<Set<string>>(new Set());
  const [addable, setAddable] = useState<PackableItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [add, setAdd] = useState<Record<string, string>>({}); // purchaseOrderItemId → qty
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const lines = pl.items.filter((i) => !i.removedAt);
  const linesByPo = useMemo(() => {
    const m = new Map<string, typeof lines>();
    for (const l of lines) m.set(l.purchaseOrderId, [...(m.get(l.purchaseOrderId) ?? []), l]);
    return [...m.entries()];
  }, [lines]);
  const addableByPo = useMemo(() => {
    const m = new Map<string, { label: string; items: PackableItem[] }>();
    for (const a of addable ?? []) {
      const g = m.get(a.purchaseOrderId) ?? { label: a.poNo ?? a.prNo ?? a.purchaseOrderId, items: [] };
      g.items.push(a);
      m.set(a.purchaseOrderId, g);
    }
    return [...m.entries()].sort(([, a], [, b]) => a.label.localeCompare(b.label));
  }, [addable]);

  async function start() {
    setTab("remove"); setRemove(new Set()); setAdd({}); setReason(""); setAddable(null);
    setOpen(true);
    setLoading(true);
    try {
      setAddable(await getAddableLinesForPackingList(pl.id));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't load the PO lines that can be added");
      setAddable([]);
    } finally {
      setLoading(false);
    }
  }

  const toggleRemove = (id: string) => setRemove((cur) => { const s = new Set(cur); if (s.has(id)) s.delete(id); else s.add(id); return s; });
  const toggleAdd = (it: PackableItem) => setAdd((cur) => {
    const next = { ...cur };
    if (it.purchaseOrderItemId in next) delete next[it.purchaseOrderItemId]; else next[it.purchaseOrderItemId] = n(it.qtyRemaining);
    return next;
  });
  const toggleWholePo = (items: PackableItem[]) => setAdd((cur) => {
    const next = { ...cur };
    const all = items.every((i) => i.purchaseOrderItemId in next);
    for (const i of items) { if (all) delete next[i.purchaseOrderItemId]; else next[i.purchaseOrderItemId] = n(i.qtyRemaining); }
    return next;
  });

  const addEntries = Object.entries(add);
  const addInvalid = addEntries.some(([id, q]) => {
    const it = addable?.find((a) => a.purchaseOrderItemId === id);
    const v = Number(q);
    return !it || !(Number.isFinite(v) && v > 0) || v > it.qtyRemaining + 1e-9;
  });
  const canSend = (remove.size > 0 || addEntries.length > 0) && !addInvalid && !!reason.trim() && !saving;

  async function submit() {
    setSaving(true);
    try {
      await requestPackingListRevision(pl.id, {
        remove: [...remove],
        add: addEntries.map(([purchaseOrderItemId, q]) => ({ purchaseOrderItemId, qty: Number(q) })),
        reason,
      });
      toast.success("Change sent for approval");
      setOpen(false);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button size="sm" variant="outline" className="gap-1.5" onClick={start}>
        <ListPlusIcon className="w-3.5 h-3.5" /> Add / remove lines
      </Button>

      <Dialog open={open} onOpenChange={(o) => !saving && setOpen(o)}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Change the lines on {pl.packingListNo}</DialogTitle>
            <DialogDescription>
              Sent to an approver. The packing list only changes once it&apos;s approved, and the inspection can&apos;t be completed while it waits.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-1 p-1 rounded-md bg-muted text-xs">
            <button type="button" onClick={() => setTab("remove")} className={cn("rounded px-2 py-1.5 font-medium", tab === "remove" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}>
              Remove lines{remove.size > 0 && ` (${remove.size})`}
            </button>
            <button type="button" onClick={() => setTab("add")} className={cn("rounded px-2 py-1.5 font-medium", tab === "add" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}>
              Add PO lines{addEntries.length > 0 && ` (${addEntries.length})`}
            </button>
          </div>

          <div className="max-h-[45vh] overflow-auto border rounded-md">
            {tab === "remove" ? (
              <table className="w-full text-xs">
                <tbody>
                  {linesByPo.map(([poId, items]) => (
                    <FragmentGroup key={poId} title={poLabel(poId)}>
                      {items.map((l) => (
                        <tr key={l.id} className={cn("border-b last:border-b-0 cursor-pointer hover:bg-muted/50", remove.has(l.id) && "bg-red-50 dark:bg-red-950/30")} onClick={() => toggleRemove(l.id)}>
                          <td className="py-1.5 px-2 w-6"><input type="checkbox" readOnly checked={remove.has(l.id)} className="w-3.5 h-3.5" /></td>
                          <td className="py-1.5 pr-2 tabular-nums text-muted-foreground w-10">#{l.poLineNo ?? "?"}</td>
                          <td className="py-1.5 pr-2 font-mono">{l.productCode || "—"}</td>
                          <td className="py-1.5 pr-2 text-muted-foreground truncate max-w-72">{l.description}</td>
                          <td className="py-1.5 pr-2 text-right tabular-nums whitespace-nowrap">{l.qtyExpected} {l.uom}</td>
                        </tr>
                      ))}
                    </FragmentGroup>
                  ))}
                </tbody>
              </table>
            ) : loading ? (
              <p className="p-4 text-xs text-muted-foreground">Loading PO lines…</p>
            ) : addableByPo.length === 0 ? (
              <p className="p-4 text-xs text-muted-foreground">Nothing left to pack for this supplier that isn&apos;t already on this packing list.</p>
            ) : (
              <table className="w-full text-xs">
                <tbody>
                  {addableByPo.map(([poId, g]) => {
                    const all = g.items.every((i) => i.purchaseOrderItemId in add);
                    return (
                      <FragmentGroup
                        key={poId}
                        title={g.label}
                        action={
                          <button type="button" onClick={() => toggleWholePo(g.items)} className="text-[10px] font-medium text-blue-600 dark:text-blue-400 hover:underline">
                            {all ? "Unselect whole PO" : `Add whole PO (${g.items.length} line${g.items.length !== 1 ? "s" : ""})`}
                          </button>
                        }
                      >
                        {g.items.map((it) => {
                          const on = it.purchaseOrderItemId in add;
                          const q = add[it.purchaseOrderItemId];
                          const bad = on && (!(Number(q) > 0) || Number(q) > it.qtyRemaining + 1e-9);
                          return (
                            <tr key={it.purchaseOrderItemId} className={cn("border-b last:border-b-0", on && "bg-green-50 dark:bg-green-950/30")}>
                              <td className="py-1.5 px-2 w-6"><input type="checkbox" checked={on} onChange={() => toggleAdd(it)} className="w-3.5 h-3.5 cursor-pointer" /></td>
                              <td className="py-1.5 pr-2 font-mono">{it.productCode || "—"}</td>
                              <td className="py-1.5 pr-2 text-muted-foreground truncate max-w-64">{it.description}</td>
                              <td className="py-1.5 pr-2 text-right text-muted-foreground whitespace-nowrap">{n(it.qtyRemaining)} {it.uom} left</td>
                              <td className="py-1.5 pr-2 w-24">
                                <Input
                                  type="number" min="0" step="any" disabled={!on}
                                  value={on ? q : ""}
                                  onChange={(e) => setAdd((cur) => ({ ...cur, [it.purchaseOrderItemId]: e.target.value }))}
                                  className={cn("h-7 text-xs text-right", bad && "border-destructive")}
                                />
                              </td>
                            </tr>
                          );
                        })}
                      </FragmentGroup>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          <Textarea placeholder="Why? (required — the approver sees this)" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="text-sm" />
          <p className="text-xs text-muted-foreground">
            {remove.size} line{remove.size !== 1 ? "s" : ""} to remove · {addEntries.length} PO line{addEntries.length !== 1 ? "s" : ""} to add
            {addInvalid && <span className="text-destructive"> · a quantity to add is missing or more than what&apos;s left</span>}
          </p>

          <DialogFooter>
            <Button type="button" variant="outline" size="sm" disabled={saving} onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="button" size="sm" disabled={!canSend} onClick={submit}>{saving ? "Sending…" : "Send for approval"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function FragmentGroup({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <>
      <tr className="bg-muted/60 sticky top-0">
        <td colSpan={5} className="py-1 px-2">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[11px] font-semibold">{title}</span>
            {action}
          </div>
        </td>
      </tr>
      {children}
    </>
  );
}

const STATUS_STYLE: Record<PackingListRevisionView["status"], string> = {
  pending: "bg-amber-500 text-white",
  approved: "bg-violet-600 text-white",
  rejected: "bg-muted text-muted-foreground border border-border",
  cancelled: "bg-muted text-muted-foreground border border-border",
};

// Add / remove-line requests on this packing list, newest first, with the
// approver's Approve / Reject (self-approval per the org setting) and the
// requester's Cancel on the one still waiting
export function RevisionPanel({ revisions, approval }: { revisions: PackingListRevisionView[]; approval?: AmendApproval }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [showOld, setShowOld] = useState(false);
  if (revisions.length === 0) return null;
  const shown = showOld ? revisions : revisions.filter((r) => r.status === "pending");
  const older = revisions.length - revisions.filter((r) => r.status === "pending").length;

  async function run(id: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(id);
    try {
      await fn();
      toast.success(ok);
      setRejecting(null); setNote("");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(null);
    }
  }

  const line = (l: PackingListRevisionView["add"][number], i: number) => (
    <li key={i} className="font-mono">
      {l.poNo ?? "PO"}{l.lineNo != null && ` #${l.lineNo}`} · {l.code || "—"} <span className="font-sans text-muted-foreground">· {n(l.qty)} {l.uom}</span>
    </li>
  );

  return (
    <section className="border border-border rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Line changes</h2>
        {older > 0 && (
          <button type="button" onClick={() => setShowOld((s) => !s)} className="text-[11px] text-muted-foreground hover:text-foreground underline">
            {showOld ? "Hide earlier requests" : `Show earlier requests (${older})`}
          </button>
        )}
      </div>
      {shown.map((r) => {
        const mine = !!approval && r.requestedById === approval.currentUserId;
        const canDecide = r.status === "pending" && !!approval?.canApprove && (!mine || approval.selfApprovalAllowed);
        return (
          <div key={r.id} className={cn("rounded-lg border p-3 text-xs space-y-2", r.status === "pending" && "border-amber-300 bg-amber-50/70 dark:border-amber-800 dark:bg-amber-950/20")}>
            <div className="flex flex-wrap items-center gap-2">
              <span className={cn("text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-md", STATUS_STYLE[r.status])}>
                {r.status === "pending" ? "Awaiting approval" : r.status}
              </span>
              <span className="text-muted-foreground">
                “{r.reason}” — {r.requestedByName ?? "someone"}, {format(new Date(r.requestedAt), "d MMM yyyy HH:mm")}
                {r.decidedAt && r.status !== "cancelled" && <> · {r.status} by {r.decidedByName ?? "someone"}, {format(new Date(r.decidedAt), "d MMM yyyy HH:mm")}</>}
                {r.decisionNotes && <> · “{r.decisionNotes}”</>}
              </span>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              {r.remove.length > 0 && (
                <div>
                  <p className="flex items-center gap-1 font-semibold text-red-700 dark:text-red-400 mb-0.5"><MinusIcon className="w-3 h-3" /> Remove {r.remove.length} line{r.remove.length !== 1 ? "s" : ""}</p>
                  <ul className="space-y-0.5">{r.remove.map(line)}</ul>
                </div>
              )}
              {r.add.length > 0 && (
                <div>
                  <p className="flex items-center gap-1 font-semibold text-green-700 dark:text-green-400 mb-0.5"><PlusIcon className="w-3 h-3" /> Add {r.add.length} line{r.add.length !== 1 ? "s" : ""}</p>
                  <ul className="space-y-0.5">{r.add.map(line)}</ul>
                </div>
              )}
            </div>
            {r.status === "pending" && (
              <div className="flex flex-wrap items-center gap-2">
                {canDecide && rejecting !== r.id && (
                  <>
                    <Button size="sm" className="h-7 gap-1" disabled={busy === r.id} onClick={() => run(r.id, () => decidePackingListRevision(r.id, "approved"), "Packing list updated")}>
                      <CheckIcon className="w-3 h-3" /> {busy === r.id ? "Applying…" : "Approve"}
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 gap-1 text-destructive hover:text-destructive" disabled={busy === r.id} onClick={() => { setRejecting(r.id); setNote(""); }}>
                      <XIcon className="w-3 h-3" /> Reject
                    </Button>
                  </>
                )}
                {canDecide && rejecting === r.id && (
                  <div className="flex w-full items-center gap-2">
                    <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why rejected? (optional)" className="h-7 text-xs" />
                    <Button size="sm" variant="destructive" className="h-7" disabled={busy === r.id} onClick={() => run(r.id, () => decidePackingListRevision(r.id, "rejected", note), "Change rejected")}>Reject</Button>
                    <Button size="sm" variant="ghost" className="h-7" onClick={() => setRejecting(null)}>Back</Button>
                  </div>
                )}
                {!canDecide && mine && approval?.canApprove && !approval.selfApprovalAllowed && (
                  <span className="italic text-muted-foreground">Needs a different approver — you asked for this change</span>
                )}
                {!canDecide && !approval?.canApprove && <span className="italic text-muted-foreground">Waiting for an approver</span>}
                {mine && (
                  <button type="button" disabled={busy === r.id} onClick={() => run(r.id, () => cancelPackingListRevision(r.id), "Request cancelled")} className="text-muted-foreground hover:text-foreground underline disabled:opacity-40">
                    Cancel request
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
      {shown.length === 0 && <p className="text-xs text-muted-foreground">No change waiting.</p>}
    </section>
  );
}
