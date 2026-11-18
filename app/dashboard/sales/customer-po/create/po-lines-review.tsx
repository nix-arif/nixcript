"use client";

import { useMemo, useState } from "react";
import { CheckIcon, AlertTriangleIcon, ListChecksIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { matchPoLines, type MatchItem, type PoLine, type PoLinesResult } from "@/lib/customer-po/po-lines";

const money = (v: number) => v.toLocaleString("en-MY", { minimumFractionDigits: 2 });

// The lines read from the customer's PO, matched to the items on the CPO. Nothing changes until the user applies it:
// the CPO description of each matched item becomes the PO's wording, the items follow the PO's order, and the items the
// PO does not list are switched off.
export function PoLinesReview({
  lines, items, onApply,
}: {
  lines: PoLine[];
  items: (MatchItem & { label: string })[];
  onApply: (r: PoLinesResult) => void;
}) {
  const [open, setOpen] = useState(false);
  const result = useMemo(() => (open ? matchPoLines(lines, items) : null), [open, lines, items]);
  if (lines.length === 0 || items.length === 0) return null;

  if (!open || !result) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
        <ListChecksIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1 text-xs">
          <span className="font-medium">The PO has {lines.length} line{lines.length === 1 ? "" : "s"}.</span>{" "}
          <span className="text-muted-foreground">Match them to the items: the CPO descriptions, the order and the items it does not list are filled in for you to check.</span>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>Match the PO lines</Button>
      </div>
    );
  }

  const label = (key: string | null) => items.find((i) => i.key === key);
  const matched = result.matches.filter((m) => m.itemKey).length;
  const unmatched = result.matches.length - matched;
  return (
    <div className="space-y-2.5 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-semibold">{matched} of {result.matches.length} PO lines matched</span>
        {unmatched > 0 && <span className="text-amber-700 dark:text-amber-400">{unmatched} not matched</span>}
        {result.notOnPo.length > 0 && <span className="text-muted-foreground">{result.notOnPo.length} item{result.notOnPo.length === 1 ? "" : "s"} not on the PO</span>}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="py-1 pr-2 font-medium">PO line</th>
              <th className="py-1 pr-2 font-medium">As written on the PO</th>
              <th className="py-1 pr-2 font-medium">Our item</th>
              <th className="py-1 font-medium">Check</th>
            </tr>
          </thead>
          <tbody>
            {result.matches.map((m) => {
              const it = label(m.itemKey);
              return (
                <tr key={m.line.no} className="border-b border-border/50 align-top">
                  <td className="py-1.5 pr-2 tabular-nums">{m.line.no}</td>
                  <td className="py-1.5 pr-2">
                    <div>{m.line.description}</div>
                    <div className="text-muted-foreground tabular-nums">{m.line.qty ?? "?"} × {m.line.unitPrice != null ? money(m.line.unitPrice) : "?"}</div>
                  </td>
                  <td className={cn("py-1.5 pr-2", !it && "text-destructive font-medium")}>{it ? it.label : "No matching item"}</td>
                  <td className="py-1.5 space-y-0.5">
                    {it && !m.priceDiff && !m.qtyDiff && <span className="inline-flex items-center gap-1 text-green-700 dark:text-green-400"><CheckIcon className="h-3 w-3" />Price and quantity agree</span>}
                    {m.priceDiff && <div className="flex items-center gap-1 text-amber-700 dark:text-amber-400"><AlertTriangleIcon className="h-3 w-3 shrink-0" />Price: PO {money(m.priceDiff.po)}, ours {money(m.priceDiff.ours)}</div>}
                    {m.qtyDiff && <div className="flex items-center gap-1 text-amber-700 dark:text-amber-400"><AlertTriangleIcon className="h-3 w-3 shrink-0" />Quantity: PO {m.qtyDiff.po}, ours {m.qtyDiff.ours}</div>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {result.notOnPo.length > 0 && (
        <p className="text-[11px] text-muted-foreground">
          Not on the PO, so they will be switched off (you can tick them back): {result.notOnPo.map((k) => label(k)?.label).filter(Boolean).join(" · ")}
        </p>
      )}
      <p className="text-[11px] text-muted-foreground">Applying replaces the CPO description of matched items with the PO&apos;s wording and sets the quantity of a loose item to the PO&apos;s. Prices are never changed: check the ones marked above.</p>
      <div className="flex gap-2">
        <Button type="button" size="sm" onClick={() => { onApply(result); setOpen(false); }} disabled={matched === 0}>Apply to the items</Button>
        <Button type="button" size="sm" variant="outline" onClick={() => setOpen(false)}>Close</Button>
      </div>
    </div>
  );
}
