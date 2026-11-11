"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { toast } from "sonner";
import { CheckIcon, PencilLineIcon, Trash2Icon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  requestPackingListAmendment,
  decidePackingListAmendment,
  cancelPackingListAmendment,
  type LineAmendment,
  type PackingListItemEnriched,
} from "@/server/packing-list";

const n = (v: number) => String(Math.round(v * 1000) / 1000);
const num = (s: string) => (s.trim() === "" ? NaN : Number(s));

export type AmendApproval = { canApprove: boolean; currentUserId: string; selfApprovalAllowed: boolean };

// "Request change" on one line of a completed packing list. Asks for new
// received / return / repair figures, or for the line to be removed — with a
// reason. Nothing changes until an approver approves the request.
export function RequestAmendButton({ item, poLabel }: { item: PackingListItemEnriched; poLabel: string }) {
  const router = useRouter();
  const curReceived = parseFloat(item.draftQtyReceived ?? item.qtyExpected) || 0;
  const curRet = parseFloat(item.draftQtyReturn ?? "0") || 0;
  const curRepair = parseFloat(item.draftQtyRepair ?? "0") || 0;
  const curGood = Math.max(0, curReceived - curRet);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"amend" | "remove">("amend");
  const [received, setReceived] = useState("");
  const [ret, setRet] = useState("");
  const [repair, setRepair] = useState("");
  const [returnNotes, setReturnNotes] = useState("");
  const [repairNotes, setRepairNotes] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  function start() {
    setKind("amend");
    setReceived(n(curReceived)); setRet(n(curRet)); setRepair(n(curRepair));
    setReturnNotes(item.draftReturnNotes ?? ""); setRepairNotes(item.draftRepairNotes ?? ""); setReason("");
    setOpen(true);
  }

  const r = num(received), t = num(ret), p = num(repair);
  const valid = kind === "remove" || ([r, t, p].every((v) => Number.isFinite(v) && v >= 0) && t + p <= r + 1e-9);
  const stockDelta = kind === "remove" ? -curGood : valid ? Math.max(0, r - t) - curGood : 0;
  const changed = kind === "remove" || (valid && (r !== curReceived || t !== curRet || p !== curRepair
    || (t > 0 && returnNotes.trim() !== (item.draftReturnNotes ?? "").trim())
    || (p > 0 && repairNotes.trim() !== (item.draftRepairNotes ?? "").trim())));
  const unit = item.uom ? ` ${item.uom}` : "";

  async function submit() {
    setSaving(true);
    try {
      await requestPackingListAmendment(item.id, kind === "remove"
        ? { kind, reason }
        : { kind, qtyReceived: r, qtyReturn: t, qtyRepair: p, returnNotes, repairNotes, reason });
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
    <div onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={start}
        className="mt-1 inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
        title="Ask for this line's figures to be corrected, or for the line to be removed — an approver signs it off"
      >
        <PencilLineIcon className="w-3 h-3 shrink-0" /> Request change
      </button>

      <Dialog open={open} onOpenChange={(o) => !saving && setOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Change {poLabel}{item.poLineNo != null && ` #${item.poLineNo}`} · {item.productCode || "item"}
            </DialogTitle>
            <DialogDescription>
              This sends a request to an approver. Stock, the goods receipt and this packing list only change once it is approved.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-1 p-1 rounded-md bg-muted text-xs">
            {(["amend", "remove"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={cn("rounded px-2 py-1.5 font-medium", kind === k ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}
              >
                {k === "amend" ? "Correct the figures" : "Remove this line"}
              </button>
            ))}
          </div>

          {kind === "amend" ? (
            <>
              <div className="grid grid-cols-[5rem_4rem_1fr] gap-x-3 gap-y-2 items-center text-sm">
                <span />
                <span className="text-[11px] text-muted-foreground text-right">Now</span>
                <span className="text-[11px] text-muted-foreground">New</span>

                <span className="text-muted-foreground">Expected</span>
                <span className="text-right tabular-nums">{item.qtyExpected}</span>
                <span className="text-[11px] text-muted-foreground">can&apos;t be changed</span>

                <span className="text-muted-foreground">Received</span>
                <span className="text-right tabular-nums">{n(curReceived)}</span>
                <Input type="number" min="0" step="any" value={received} onChange={(e) => setReceived(e.target.value)} className="h-8" />

                <span className="text-muted-foreground">Return</span>
                <span className="text-right tabular-nums">{n(curRet)}</span>
                <Input type="number" min="0" step="any" value={ret} onChange={(e) => setRet(e.target.value)} className="h-8" />

                <span className="text-muted-foreground">Repair</span>
                <span className="text-right tabular-nums">{n(curRepair)}</span>
                <Input type="number" min="0" step="any" value={repair} onChange={(e) => setRepair(e.target.value)} className="h-8" />
              </div>
              {t > 0 && <Textarea placeholder="Return reason" value={returnNotes} onChange={(e) => setReturnNotes(e.target.value)} rows={2} className="text-sm" />}
              {p > 0 && <Textarea placeholder="Repair note" value={repairNotes} onChange={(e) => setRepairNotes(e.target.value)} rows={2} className="text-sm" />}
            </>
          ) : (
            <p className="text-sm rounded-md border border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300 px-3 py-2">
              The line comes off this packing list and its goods receipt. The {n(curReceived)}{unit} received are taken back out of stock, and the PO line becomes available to pack again. Photos and history are kept.
            </p>
          )}

          <Textarea placeholder="Why? (required — the approver sees this)" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="text-sm" />

          <div className="text-xs rounded-md border px-3 py-2 bg-muted/40">
            {!valid ? (
              <span className="text-destructive">Quantities must be 0 or more, and return + repair can&apos;t be more than received.</span>
            ) : stockDelta === 0 ? (
              <span className="text-muted-foreground">On approval: no stock change.</span>
            ) : (
              <span>
                On approval, stock {item.productCode ?? ""}: <b className={stockDelta > 0 ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400"}>{stockDelta > 0 ? "+" : ""}{n(stockDelta)}{unit}</b>
                {stockDelta < 0 && " — can't be approved if that stock has already been used or delivered."}
              </span>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" size="sm" disabled={saving} onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              type="button"
              size="sm"
              variant={kind === "remove" ? "destructive" : "default"}
              disabled={saving || !changed || !valid || !reason.trim()}
              onClick={submit}
            >
              {saving ? "Sending…" : "Send for approval"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const STATUS_STYLE: Record<LineAmendment["status"], string> = {
  pending: "bg-amber-500 text-white",
  approved: "bg-violet-600 text-white",
  rejected: "bg-muted text-muted-foreground border border-border",
  cancelled: "bg-muted text-muted-foreground border border-border",
};

function describe(a: LineAmendment) {
  if (a.kind === "remove") return "Remove this line";
  const diff = (label: string, x: number, y: number) => (x === y ? null : `${label} ${n(x)} → ${n(y)}`);
  return [diff("Received", a.oldQtyReceived, a.newQtyReceived), diff("Return", a.oldQtyReturn, a.newQtyReturn), diff("Repair", a.oldQtyRepair, a.newQtyRepair)]
    .filter(Boolean).join(" · ") || "Notes changed";
}

// Every change request on the line, oldest first. A pending one carries the
// approver's Approve / Reject (following the org's self-approval setting) and
// the requester's Cancel.
export function AmendmentPanel({ amendments, approval }: { amendments: LineAmendment[]; approval?: AmendApproval }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [note, setNote] = useState("");
  if (amendments.length === 0) return null;

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

  return (
    <div className="mt-1.5 space-y-1" onClick={(e) => e.stopPropagation()}>
      {amendments.map((a) => {
        const mine = !!approval && a.requestedById === approval.currentUserId;
        const canDecide = a.status === "pending" && !!approval?.canApprove && (!mine || approval.selfApprovalAllowed);
        return (
          <div key={a.id} className={cn("text-[10px] leading-snug rounded-md", a.status === "pending" && "border border-amber-300 dark:border-amber-800 bg-amber-50/70 dark:bg-amber-950/20 p-1.5")}>
            <div className="flex flex-wrap items-center gap-1">
              <span className={cn("inline-flex items-center gap-1 font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-md", STATUS_STYLE[a.status])}>
                {a.kind === "remove" ? <Trash2Icon className="w-2.5 h-2.5 shrink-0" /> : <PencilLineIcon className="w-2.5 h-2.5 shrink-0" />}
                {a.status === "pending" ? "Change awaiting approval" : a.status === "approved" ? (a.kind === "remove" ? "Removed" : "Amended") : a.status}
              </span>
              <span className={cn("font-medium", a.status === "rejected" || a.status === "cancelled" ? "text-muted-foreground line-through" : "text-foreground")}>{describe(a)}</span>
              {a.status === "approved" && a.stockDelta !== 0 && <span className="text-muted-foreground">· stock {a.stockDelta > 0 ? "+" : ""}{n(a.stockDelta)}</span>}
            </div>
            <p className="text-muted-foreground">
              “{a.reason}” — {a.requestedByName ?? "someone"}, {format(new Date(a.requestedAt), "d MMM yyyy HH:mm")}
              {a.decidedAt && a.status !== "cancelled" && <> · {a.status} by {a.decidedByName ?? "someone"}, {format(new Date(a.decidedAt), "d MMM yyyy HH:mm")}</>}
              {a.decisionNotes && <> · “{a.decisionNotes}”</>}
            </p>

            {a.status === "pending" && (
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                {canDecide && rejecting !== a.id && (
                  <>
                    <button
                      type="button"
                      disabled={busy === a.id}
                      onClick={() => run(a.id, () => decidePackingListAmendment(a.id, "approved"), a.kind === "remove" ? "Line removed" : "Change approved")}
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border border-green-300 dark:border-green-800 text-green-700 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 disabled:opacity-40"
                    >
                      <CheckIcon className="w-3 h-3" /> {busy === a.id ? "Applying…" : "Approve"}
                    </button>
                    <button
                      type="button"
                      disabled={busy === a.id}
                      onClick={() => { setRejecting(a.id); setNote(""); }}
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border border-red-300 dark:border-red-800 text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-40"
                    >
                      <XIcon className="w-3 h-3" /> Reject
                    </button>
                  </>
                )}
                {canDecide && rejecting === a.id && (
                  <div className="flex w-full items-center gap-1">
                    <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why rejected? (optional)" className="h-6 text-[11px]" />
                    <button type="button" disabled={busy === a.id} onClick={() => run(a.id, () => decidePackingListAmendment(a.id, "rejected", note), "Change rejected")} className="px-1.5 py-0.5 rounded-md bg-red-600 text-white hover:bg-red-700 shrink-0 disabled:opacity-40">Reject</button>
                    <button type="button" onClick={() => setRejecting(null)} className="text-muted-foreground hover:text-foreground shrink-0">Back</button>
                  </div>
                )}
                {!canDecide && mine && approval?.canApprove && !approval.selfApprovalAllowed && (
                  <span className="italic text-muted-foreground">Needs a different approver — you asked for this change</span>
                )}
                {!canDecide && !approval?.canApprove && <span className="italic text-muted-foreground">Waiting for an approver</span>}
                {mine && (
                  <button type="button" disabled={busy === a.id} onClick={() => run(a.id, () => cancelPackingListAmendment(a.id), "Request cancelled")} className="text-muted-foreground hover:text-foreground underline disabled:opacity-40">
                    Cancel request
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
