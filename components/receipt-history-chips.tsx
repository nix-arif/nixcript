"use client";

import { format } from "date-fns";
import { AlertTriangleIcon, HistoryIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LineReceiptHistory } from "@/server/packing-list";

const n = (v: number) => String(Math.round(v * 1000) / 1000);
const short = (no: string) => no.replace(/^PL-.*-(\d{4}-\d{4})$/, "PL-$1");

// Marks a packing-list line whose PO line was already received elsewhere
// (earlier/later packing lists, direct GRs), with the list on click, and warns
// — without blocking — when this delivery takes the PO line over what was
// ordered or brings in more than this packing list expected.
//   thisQty  — units this packing list accepts for the line (counted toward the PO)
//   received / expected — this packing list's own figures for the over-expected warning
export function ReceiptHistoryChips({
  history,
  thisQty,
  received,
  expected,
  uom,
}: {
  history: LineReceiptHistory | null;
  thisQty: number;
  received?: number;
  expected?: number;
  uom?: string | null;
}) {
  const receipts = history?.receipts ?? [];
  const overExpected = received !== undefined && expected !== undefined ? received - expected : 0;
  const overPo = history ? history.otherAccepted + thisQty - history.poQty : 0;
  if (receipts.length === 0 && overExpected <= 1e-9 && overPo <= 1e-9) return null;
  const unit = uom ? ` ${uom}` : "";

  return (
    <div className="mb-1 space-y-0.5" onClick={(e) => e.stopPropagation()}>
      <div className="flex flex-wrap items-center gap-1">
        {overPo > 1e-9 && (
          <span
            title={`PO qty ${n(history!.poQty)} · accepted elsewhere ${n(history!.otherAccepted)} · this packing list ${n(thisQty)}`}
            className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-amber-100 text-amber-800 border border-amber-400 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-700"
          >
            <AlertTriangleIcon className="w-2.5 h-2.5 shrink-0" />
            Over PO by {n(overPo)}{unit}
          </span>
        )}
        {overExpected > 1e-9 && (
          <span
            title={`Expected ${n(expected!)} on this packing list, received ${n(received!)}`}
            className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-amber-100 text-amber-800 border border-amber-400 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-700"
          >
            <AlertTriangleIcon className="w-2.5 h-2.5 shrink-0" />
            {n(overExpected)}{unit} more than expected
          </span>
        )}
      </div>
    </div>
  );
}

// The PO line's whole story in the Quantities column, as a small table: one row per delivery (replacement marked),
// this packing list last, and a total against what was ordered.
export function PoLineLedger({ history, thisQty, current, uom }: {
  history: LineReceiptHistory | null;
  thisQty: number;
  // this packing list's own figures for the line, shown as the last (highlighted) row
  current: { packingListNo: string; received: number; returned: number };
  uom?: string | null;
}) {
  const receipts = history?.receipts ?? [];
  if (!history || receipts.length === 0) return null;
  const unit = uom ? ` ${uom}` : "";
  const total = history.otherAccepted + thisQty;
  const diff = total - history.poQty;
  const totalRejected = receipts.reduce((sum, r) => sum + r.returned, 0) + current.returned;
  const th = "px-1 py-0.5 text-right font-medium text-muted-foreground";
  const td = "px-1 py-0.5 text-right tabular-nums";
  return (
    <div className="mt-1 overflow-hidden rounded-md border border-slate-300 text-[10px] leading-snug dark:border-slate-600">
      <p className="flex items-center gap-1 bg-slate-100 px-1.5 py-1 font-semibold dark:bg-slate-800">
        <HistoryIcon className="h-2.5 w-2.5 shrink-0" />
        PO line · ordered {n(history.poQty)}{unit}
      </p>
      <table className="w-full">
        <thead>
          <tr className="border-b border-slate-200 dark:border-slate-700">
            <th className="px-1.5 py-0.5 text-left font-medium text-muted-foreground">Delivery</th>
            <th className={th} title="Received">Rec&apos;d</th>
            <th className={th} title="Rejected, returned to the supplier">Rej.</th>
            <th className={th} title="Accepted into stock">Acc.</th>
          </tr>
        </thead>
        <tbody>
          {receipts.map((r) => (
            <tr key={r.grId} className="border-b border-slate-100 align-top dark:border-slate-800">
              <td className="px-1.5 py-0.5">
                <span className="font-mono">{short(r.packingListNo ?? "Direct GR")}</span>
                <span className="block text-muted-foreground">{format(new Date(r.at), "d MMM")}</span>
                {r.isReplacement && <span className="rounded bg-sky-600 px-1 font-bold uppercase text-white">replacement</span>}
                {r.returned > 0 && r.returnOpen && <span className="block text-red-600 dark:text-red-400">{r.returnSentBack ? "return open" : "not sent back"}</span>}
              </td>
              <td className={td}>{n(r.received)}</td>
              <td className={cn(td, r.returned > 0 && "font-medium text-red-600 dark:text-red-400")} title={r.returnReason ?? undefined}>{r.returned > 0 ? n(r.returned) : "–"}</td>
              <td className={cn(td, "font-medium")}>{n(r.accepted)}</td>
            </tr>
          ))}
          <tr className="border-b border-slate-200 bg-indigo-50/60 align-top dark:border-slate-700 dark:bg-indigo-900/10">
            <td className="px-1.5 py-0.5">
              <span className="font-mono font-semibold">{short(current.packingListNo)}</span>
              <span className="block rounded bg-indigo-600 px-1 font-bold uppercase text-white w-fit">this list</span>
            </td>
            <td className={td}>{n(current.received)}</td>
            <td className={cn(td, current.returned > 0 && "font-medium text-red-600 dark:text-red-400")}>{current.returned > 0 ? n(current.returned) : "–"}</td>
            <td className={cn(td, "font-semibold")}>{n(thisQty)}</td>
          </tr>
          <tr className={diff > 1e-9 ? "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300" : "bg-slate-50 dark:bg-slate-900/40"}>
            <td className="px-1.5 py-0.5 font-semibold" colSpan={3}>
              Total vs ordered {n(history.poQty)}{diff > 1e-9 ? ` · over by ${n(diff)}` : diff < -1e-9 ? ` · ${n(-diff)} to come` : " · complete"}
            </td>
            <td className={cn(td, "font-bold")}>{n(total)}</td>
          </tr>
        </tbody>
      </table>
      <p className={cn("border-t border-slate-200 px-1.5 py-0.5 dark:border-slate-700", totalRejected > 1e-9 ? "font-semibold text-red-600 dark:text-red-400" : "text-muted-foreground")}>
        Total rejected: {n(totalRejected)}{unit}
      </p>
    </div>
  );
}
