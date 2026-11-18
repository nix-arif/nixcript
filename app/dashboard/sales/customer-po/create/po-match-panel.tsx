"use client";

import { FileSearchIcon, LinkIcon, Loader2Icon, AlertTriangleIcon, SparklesIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Suggestion } from "@/lib/customer-po/quotation-match";

export type PoReadResult =
  | { status: "idle" }
  | { status: "loading"; fileName: string }
  | { status: "unreadable"; fileName: string; reason: string }
  | { status: "done"; fileName: string; suggestions: Suggestion[]; poNumber: string | null; poDate: string | null };

const fmtMoney = (v: string | null) => (v ? Number(v).toLocaleString("en-MY", { minimumFractionDigits: 2 }) : "");
const fmtDate = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" });

// "Not sure which quotation? Attach the customer's PO and we suggest it". Nothing is linked until the user clicks Link.
export function PoMatchPanel({
  result, onAttach, onLink, onUsePoNumber, onUseDate, currentPoNo, currentDate, linking,
}: {
  result: PoReadResult;
  onAttach: () => void;
  onLink: (s: Suggestion) => void;
  onUsePoNumber: (v: string) => void;
  onUseDate: (v: string) => void;
  currentPoNo: string;
  currentDate: string;
  linking: boolean;
}) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-muted/20 px-3 py-3 space-y-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <FileSearchIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">Not sure which quotation?</div>
          <div className="text-xs text-muted-foreground">Attach the customer&apos;s PO (PDF). We read it and suggest the matching quotation. You choose which one to link.</div>
        </div>
        <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={onAttach} disabled={result.status === "loading"}>
          {result.status === "loading" ? <Loader2Icon className="h-3.5 w-3.5 animate-spin" /> : <SparklesIcon className="h-3.5 w-3.5" />}
          {result.status === "idle" ? "Attach the PO and find the quotation" : "Try another PDF"}
        </Button>
      </div>

      {result.status === "loading" && <p className="text-xs text-muted-foreground">Reading {result.fileName}…</p>}

      {result.status === "unreadable" && (
        <div className="flex items-start gap-2 rounded-md border border-amber-200/80 bg-amber-50/70 px-2.5 py-2 text-xs text-amber-900 dark:border-amber-800/50 dark:bg-amber-900/10 dark:text-amber-200">
          <AlertTriangleIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{result.reason} The document is still attached to this CPO.</span>
        </div>
      )}

      {result.status === "done" && (
        <div className="space-y-2">
          {result.suggestions.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Read {result.fileName}, but no quotation matched it. Search for the quotation number below. The document is still attached to this CPO.
            </p>
          ) : (
            <>
              <p className="text-xs font-medium">{result.suggestions.length === 1 ? "1 quotation matches" : `${result.suggestions.length} quotations may match`} {result.fileName}:</p>
              <ul className="space-y-1.5">
                {result.suggestions.map((s) => (
                  <li key={s.id} className={cn("rounded-lg border px-3 py-2", s.level === "very-likely" ? "border-green-300 bg-green-50/60 dark:border-green-800 dark:bg-green-900/10" : "border-border bg-background")}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-semibold">{s.quotationNo}</span>
                      <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold", s.level === "very-likely" ? "bg-green-600 text-white" : "bg-muted text-muted-foreground")}>
                        {s.level === "very-likely" ? "Very likely" : "Possible"}
                      </span>
                      {s.customerName && <span className="text-xs text-muted-foreground">{s.customerName}</span>}
                      {s.grandTotal && <span className="ml-auto text-xs tabular-nums text-muted-foreground">RM {fmtMoney(s.grandTotal)}</span>}
                    </div>
                    <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                      {s.reasons.map((r) => <li key={r}>• {r}</li>)}
                    </ul>
                    {s.cpoCount > 0 && (
                      <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-400">
                        {s.cpoCount} Customer PO{s.cpoCount === 1 ? " was" : "s were"} already recorded from this quotation. Check this PO is not a duplicate.
                      </p>
                    )}
                    <div className="mt-1.5">
                      <Button type="button" size="sm" className="h-7 gap-1.5 text-xs" disabled={linking} onClick={() => onLink(s)}>
                        <LinkIcon className="h-3 w-3" />Link this quotation
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}

          {(result.poNumber && !currentPoNo.trim()) || (result.poDate && result.poDate !== currentDate) ? (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border/60 pt-2 text-xs">
              {result.poNumber && !currentPoNo.trim() && (
                <span>PO number on the document: <span className="font-mono font-medium">{result.poNumber}</span>{" "}
                  <button type="button" className="underline hover:text-foreground" onClick={() => onUsePoNumber(result.poNumber!)}>Use it</button></span>
              )}
              {result.poDate && result.poDate !== currentDate && (
                <span>Date on the document: <span className="font-medium">{fmtDate(result.poDate)}</span>{" "}
                  <button type="button" className="underline hover:text-foreground" onClick={() => onUseDate(result.poDate!)}>Use as received date</button></span>
              )}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
