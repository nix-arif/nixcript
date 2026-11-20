"use client";

import { format } from "date-fns";
import { AlertTriangleIcon, HistoryIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LineReceiptHistory } from "@/server/packing-list";

const n = (v: number) => String(Math.round(v * 1000) / 1000);

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

// The PO line's whole story in the Quantities column: ordered, every delivery (replacement marked), this packing list, total.
export function PoLineLedger({ history, thisQty, uom }: { history: LineReceiptHistory | null; thisQty: number; uom?: string | null }) {
  const receipts = history?.receipts ?? [];
  if (!history || receipts.length === 0) return null;
  const unit = uom ? ` ${uom}` : "";
  const overPo = history.otherAccepted + thisQty - history.poQty;
  return (
    <div className="mt-1 rounded-md border border-slate-300 bg-slate-50 px-2 py-1.5 text-[10px] leading-snug text-slate-700 dark:border-slate-600 dark:bg-slate-900/40 dark:text-slate-300">
          <p className="mb-0.5 flex items-center gap-1 font-semibold">
            <HistoryIcon className="h-2.5 w-2.5 shrink-0" />
            This PO line: ordered {n(history.poQty)}{unit}
          </p>
          <ul className="space-y-0.5">
            {receipts.map((r) => (
              <li key={r.grId}>
                <span className="font-mono">{r.packingListNo ?? "Direct GR"}</span>
                {r.isReplacement && <span className="ml-1 rounded bg-sky-600 px-1 font-bold uppercase text-white">replacement</span>}
                {" · "}{format(new Date(r.at), "d MMM yyyy")}
                {" — received "}{n(r.received)}
                {r.returned > 0 ? (
                  <span className="text-red-600 dark:text-red-400">
                    {", rejected "}{n(r.returned)}
                    {r.returnReason && <> ({r.returnReason})</>}
                    {r.returnOpen && (r.returnSentBack ? " · return open" : " · not sent back yet")}
                  </span>
                ) : null}
                {" → "}<b>{n(r.accepted)} accepted</b>
              </li>
            ))}
            <li>
              <span className="font-mono">This packing list</span>
              {" → "}<b>{n(thisQty)} accepted</b>
            </li>
          </ul>
          <p className={cn("mt-0.5 border-t border-slate-300 pt-0.5 font-semibold dark:border-slate-600", overPo > 1e-9 ? "text-amber-700 dark:text-amber-400" : "")}>
            Total accepted {n(history.otherAccepted + thisQty)} of {n(history.poQty)} ordered
            {overPo > 1e-9 ? ` — over by ${n(overPo)}${unit}` : history.otherAccepted + thisQty < history.poQty - 1e-9 ? ` — ${n(history.poQty - history.otherAccepted - thisQty)}${unit} still to come` : " — complete"}
          </p>
        </div>
  );
}
