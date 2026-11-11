"use client";

import { useState } from "react";
import { format } from "date-fns";
import { AlertTriangleIcon, ChevronDownIcon, HistoryIcon } from "lucide-react";
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
  const [open, setOpen] = useState(false);
  const receipts = history?.receipts ?? [];
  const overExpected = received !== undefined && expected !== undefined ? received - expected : 0;
  const overPo = history ? history.otherAccepted + thisQty - history.poQty : 0;
  if (receipts.length === 0 && overExpected <= 1e-9 && overPo <= 1e-9) return null;
  const unit = uom ? ` ${uom}` : "";

  return (
    <div className="mb-1 space-y-0.5" onClick={(e) => e.stopPropagation()}>
      <div className="flex flex-wrap items-center gap-1">
        {receipts.length > 0 && (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            title="This PO line was also received outside this packing list — click to see where"
            className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-700 border border-slate-300 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-600 dark:hover:bg-slate-700"
          >
            <HistoryIcon className="w-2.5 h-2.5 shrink-0" />
            Received {receipts.length}× before · {n(history!.otherAccepted)} of {n(history!.poQty)} accepted
            <ChevronDownIcon className={cn("w-2.5 h-2.5 shrink-0 transition-transform", open && "rotate-180")} />
          </button>
        )}
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
      {open && receipts.length > 0 && (
        <ul className="pl-1 space-y-0.5">
          {receipts.map((r) => (
            <li key={r.grId} className="text-[10px] leading-snug text-slate-700 dark:text-slate-300">
              <span className="font-mono">{r.packingListNo ?? "Direct GR"}</span>
              {" · "}
              <span className="font-mono">{r.grNo}</span>
              {" · "}
              {format(new Date(r.at), "d MMM yyyy")}
              {" — received "}{n(r.received)}, accepted {n(r.accepted)}
              {r.returned > 0 && (
                <span className="text-red-600 dark:text-red-400">
                  {", returned "}{n(r.returned)}
                  {r.returnReason && <> ({r.returnReason})</>}
                  {r.returnOpen && (r.returnSentBack ? " · return open" : " · not sent back yet")}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
