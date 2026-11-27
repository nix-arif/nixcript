"use client";

// The Amend step on a customer PO whose sales order is submitted or later: the reason, a preview of
// what the amendment does to the sales order and supplier POs, then Apply (lib/amendment/customer-po.ts).

import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangleIcon, ArrowRightIcon, Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { amendCustomerPo, previewCustomerPoAmendment, type UpdateCustomerPoInput } from "@/server/customer-purchase-order";
import type { AmendmentPlan } from "@/lib/amendment/customer-po";

const money = (n: number) => `RM ${n.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const qty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

export function AmendPanel({
  payload,
  payloadKey,
  onDone,
  onCancel,
}: {
  /** The CPO as it would be saved (all lines and amounts), or a message when it can't be yet */
  payload: () => UpdateCustomerPoInput | string;
  /** Changes whenever the form changes: a preview of an older version is dropped */
  payloadKey: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState("");
  const [preview_, setPlan] = useState<AmendmentPlan | null>(null);
  const [planKey, setPlanKey] = useState<string | null>(null);
  const [pos, setPos] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<"preview" | "apply" | null>(null);

  // the form changed after the preview: it no longer shows what Apply would do, so it's hidden
  const stale = !!preview_ && planKey !== payloadKey;
  const plan = stale ? null : preview_;

  async function preview() {
    const p = payload();
    if (typeof p === "string") { toast.error(p); return; }
    setBusy("preview");
    try {
      const next = await previewCustomerPoAmendment(p);
      setPlan(next);
      setPlanKey(payloadKey);
      setPos(Object.fromEntries([...new Set(next.poActions.filter((a) => a.auto).map((a) => a.poId))].map((id) => [id, true])));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't work out the amendment");
    } finally {
      setBusy(null);
    }
  }

  async function apply() {
    const p = payload();
    if (typeof p === "string") { toast.error(p); return; }
    if (!reason.trim()) { toast.error("Give the reason for the amendment"); return; }
    setBusy("apply");
    try {
      const r = await amendCustomerPo({ ...p, reason: reason.trim(), amendPoIds: Object.entries(pos).filter(([, on]) => on).map(([id]) => id) });
      const poText = r.amendedPos.map((x) => `${x.poNo} Rev ${x.revision}`).join(", ");
      toast.success(`Amended: customer PO Rev ${r.cpoRevision}, ${r.soNo} Rev ${r.soRevision} (back for approval)${poText ? `, ${poText}` : ""}.`, { duration: 10000 });
      if (r.followUps.length > 0) toast.warning(`Still to do: ${r.followUps.join(" ")}`, { duration: 20000 });
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The amendment couldn't be applied");
      setBusy(null);
    }
  }

  const poIds = plan ? [...new Set(plan.poActions.map((a) => a.poId))] : [];

  return (
    <section className="space-y-4 rounded-xl border-2 border-amber-300 bg-amber-50/40 p-4 dark:border-amber-700 dark:bg-amber-950/10">
      <div>
        <h2 className="text-sm font-semibold">Amend this customer PO</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Change the lines above to match the customer&apos;s amendment, then preview. Applying it updates the sales order
          (same number, new revision, back for approval) and the supplier POs that haven&apos;t shipped yet.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Reason <span className="text-destructive">*</span></Label>
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="text-sm"
          placeholder="e.g. Customer's amendment letter ref. … dated …: qty of item X reduced to 2" />
      </div>

      {plan && (
        <div className="space-y-3 text-xs">
          {plan.blockers.length > 0 && (
            <div className="flex gap-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300">
              <AlertTriangleIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <ul className="space-y-0.5">{plan.blockers.map((b) => <li key={b}>{b}</li>)}</ul>
            </div>
          )}

          <div>
            <p className="mb-1 font-semibold">
              Customer PO {plan.cpoNo} → Rev {plan.cpoRevision} · Sales order {plan.so.soNo} → Rev {plan.so.revision}
            </p>
            {plan.lines.length > 0 ? (
              <table className="w-full">
                <thead className="text-muted-foreground">
                  <tr><th className="py-1 text-left font-medium">Item</th><th className="text-right font-medium">Qty</th><th className="text-right font-medium">Amount</th><th className="text-right font-medium">Delivered</th></tr>
                </thead>
                <tbody>
                  {plan.lines.map((l, i) => (
                    <tr key={i} className="border-t border-border/60">
                      <td className="py-1">
                        <span className="font-mono">{l.productCode || "—"}</span>{" "}
                        <span className="text-muted-foreground">{l.change === "added" ? "added" : l.change === "removed" ? "removed" : ""}</span>
                      </td>
                      <td className="text-right tabular-nums">{qty(l.oldQty)} → <b>{qty(l.newQty)}</b></td>
                      <td className="text-right tabular-nums">{money(l.oldTotal)} → <b>{money(l.newTotal)}</b></td>
                      <td className="text-right tabular-nums">{l.delivered ? qty(l.delivered) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <p className="text-muted-foreground">No line changes.</p>}
            <p className="mt-1">
              Sales order total: {money(plan.so.oldTotal)} <ArrowRightIcon className="inline h-3 w-3" /> <b>{money(plan.so.newTotal)}</b>.
              It goes back for approval; no DO until it&apos;s approved again.
            </p>
          </div>

          {poIds.length > 0 && (
            <div className="space-y-1.5">
              <p className="font-semibold">Supplier POs</p>
              {poIds.map((id) => {
                const acts = plan.poActions.filter((a) => a.poId === id);
                const auto = acts.every((a) => a.auto);
                return (
                  <div key={id} className="rounded-md border border-border bg-background px-3 py-2">
                    <label className="flex items-center gap-2">
                      <input type="checkbox" disabled={!auto} checked={auto && !!pos[id]} onChange={(e) => setPos((m) => ({ ...m, [id]: e.target.checked }))} />
                      <span className="font-mono font-medium">{acts[0].poNo}</span>
                      <span className="text-muted-foreground">{acts[0].supplierName}</span>
                      <span className="ml-auto text-muted-foreground">{auto ? "amend it (same number, new revision)" : `can't be amended here: ${acts[0].why}`}</span>
                    </label>
                    <ul className="mt-1 list-disc pl-6 text-muted-foreground">
                      {acts.map((a) => (
                        <li key={a.poItemId}>
                          <span className="font-mono">{a.productCode}</span>: {qty(a.fromQty)} → {a.toQty <= 0 ? "removed" : qty(a.toQty)}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
              <p className="text-muted-foreground">Send the amended PO to the supplier after applying (its PDF says Amendment Rev N).</p>
            </div>
          )}

          {plan.followUps.length > 0 && (
            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200">
              <p className="font-semibold">To do by hand</p>
              <ul className="list-disc pl-4">{plan.followUps.map((f) => <li key={f}>{f}</li>)}</ul>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={preview} disabled={busy !== null}>
          {busy === "preview" && <Loader2Icon className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
          {plan ? "Preview again" : "Preview amendment"}
        </Button>
        <Button onClick={apply} disabled={busy !== null || !plan || stale || plan.blockers.length > 0 || !reason.trim()}>
          {busy === "apply" && <Loader2Icon className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
          Apply amendment
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={busy !== null}>Cancel amendment</Button>
      </div>
    </section>
  );
}
