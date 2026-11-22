"use client";

import { LinkIcon, Loader2Icon, AlertTriangleIcon, KeyboardIcon, LayersIcon, CheckCircle2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Combination, Suggestion } from "@/lib/customer-po/quotation-match";
import type { PoLine } from "@/lib/customer-po/po-lines";

export type PoReadResult =
  | { status: "idle" }
  | { status: "loading"; fileName: string }
  | { status: "unreadable"; fileName: string; reason: string }
  | {
      status: "done"; fileName: string; suggestions: Suggestion[]; poNumber: string | null; poDate: string | null; filled: string[];
      lines: PoLine[]; linked?: boolean; poTotal?: number | null;
      combination?: Combination | null; // the PO is spread over several quotations: these cover it together
    };

const fmtMoney = (v: string | null) => (v ? Number(v).toLocaleString("en-MY", { minimumFractionDigits: 2 }) : "");
const fmtDate = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" });
// "1", "1 and 3", "1, 3 and 4": PO line numbers as printed on the PO
const lineList = (lines: PoLine[], idx: number[]) => {
  const nos = idx.map((i) => String(lines[i]?.no ?? i + 1));
  return nos.length <= 1 ? nos.join("") : `${nos.slice(0, -1).join(", ")} and ${nos[nos.length - 1]}`;
};

// What reading the customer's PO found: the matching quotation(s), the PO number and the date. Nothing is linked until
// the user clicks Link. A PO can be for lines of several quotations: then the quotations that cover it together are
// offered as one ("Link all"), and after a link, the PO lines still in no linked quotation are pointed out.
export function PoMatchResults({
  result, onLink, onLinkMany, onTypeNumber, hasQuotation, linkedIds, uncoveredLines, onUsePoNumber, onUseDate, currentPoNo, currentDate, linking,
}: {
  result: PoReadResult;
  onLink: (s: Suggestion) => void;
  onLinkMany: (ss: Suggestion[]) => void; // link several quotations, in this order
  onTypeNumber: () => void;   // none of the suggestions is right: go to the quotation search
  hasQuotation: boolean;      // a quotation is linked (picked here or typed in)
  linkedIds: string[];        // the quotations linked so far
  uncoveredLines: number[] | null; // the PO lines (by position) in no linked quotation yet; null when the lines are unknown
  onUsePoNumber: (v: string) => void;
  onUseDate: (v: string) => void;
  currentPoNo: string;
  currentDate: string;
  linking: boolean;
}) {
  if (result.status === "idle") return null;

  if (result.status === "loading") {
    return <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2Icon className="h-3.5 w-3.5 animate-spin" />Reading {result.fileName} for the dates, address and matching quotation…</p>;
  }

  if (result.status === "unreadable") {
    return (
      <div className="flex items-start gap-2 rounded-md border border-amber-200/80 bg-amber-50/70 px-2.5 py-2 text-xs text-amber-900 dark:border-amber-800/50 dark:bg-amber-900/10 dark:text-amber-200">
        <AlertTriangleIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>{result.reason} The document is still attached to this CPO.</span>
      </div>
    );
  }

  const lines = result.lines;
  const filledNote = result.filled.length > 0 && (
    <p className="rounded-md border border-green-200 bg-green-50/70 px-2.5 py-1.5 text-xs text-green-900 dark:border-green-800/50 dark:bg-green-900/10 dark:text-green-200">
      Filled in from {result.fileName}: {result.filled.join(", ")}. They are highlighted below: check each one and change anything that is not right.
    </p>
  );
  const showPoNo = !!result.poNumber && !currentPoNo.trim();
  const showDate = !!result.poDate && result.poDate !== currentDate;
  const typeNumber = (label: string) => (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <Button type="button" size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={onTypeNumber}>
        <KeyboardIcon className="h-3 w-3" />Type the quotation number
      </Button>
    </div>
  );

  // one quotation, with what it matched and (when the PO's lines are known) which of them it has
  const card = (s: Suggestion, highlight?: number[]) => (
    <li key={s.id}>
      <div className={cn("rounded-lg border px-3 py-2", s.level === "very-likely" ? "border-green-300 bg-green-50/60 dark:border-green-800 dark:bg-green-900/10" : "border-border bg-background")}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm font-semibold">{s.quotationNo}</span>
          <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold", s.level === "very-likely" ? "bg-green-600 text-white" : "bg-muted text-muted-foreground")}>
            {s.level === "very-likely" ? "Very likely" : "Possible"}
          </span>
          {s.customerName && <span className="text-xs text-muted-foreground">{s.customerName}</span>}
          {s.grandTotal && <span className="ml-auto text-xs tabular-nums text-muted-foreground">RM {fmtMoney(s.grandTotal)}</span>}
        </div>
        {lines.length > 1 && s.coversLines.length > 0 && (
          <p className="mt-1 text-[11px] font-medium text-foreground">
            Has PO line{s.coversLines.length === 1 ? "" : "s"} {lineList(lines, s.coversLines)} of {lines.length}
            {highlight && highlight.length > 0 && <span className="text-amber-700 dark:text-amber-400"> (still needed: {lineList(lines, highlight)})</span>}
          </p>
        )}
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
      </div>
    </li>
  );

  let body: React.ReactNode = null;
  if (!hasQuotation && !result.linked) {
    // ── nothing linked yet: the suggestions (and the quotations that cover the PO together) ──
    const combo = result.combination;
    const comboSs = combo ? combo.ids.map((id) => result.suggestions.find((s) => s.id === id)).filter((s): s is Suggestion => !!s) : [];
    body = result.suggestions.length === 0 ? (
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>No quotation matched {result.fileName}: only quotations for the customer organization named on the PO are suggested, and none of ours is for it (or it is named differently in our customer records). The document is still attached to this CPO.</span>
        <Button type="button" size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={onTypeNumber}>
          <KeyboardIcon className="h-3 w-3" />Type the quotation number
        </Button>
      </div>
    ) : (
      <>
        {combo && comboSs.length === combo.ids.length && (
          <div className="space-y-2 rounded-lg border border-sky-300 bg-sky-50/60 px-3 py-2.5 dark:border-sky-800 dark:bg-sky-900/10">
            <p className="flex items-start gap-1.5 text-xs font-medium text-sky-900 dark:text-sky-200">
              <LayersIcon className="mt-px h-3.5 w-3.5 shrink-0" />
              This PO is spread over {combo.ids.length} quotations: together they have {combo.covered === combo.total ? `all ${combo.total}` : `${combo.covered} of the ${combo.total}`} PO lines.
            </p>
            <ul className="space-y-0.5 text-[11px]">
              {comboSs.map((s, i) => (
                <li key={s.id} className="flex flex-wrap gap-x-2">
                  <span className="font-mono font-semibold">{s.quotationNo}</span>
                  <span className="text-muted-foreground">PO line{combo.lines[i].length === 1 ? "" : "s"} {lineList(lines, combo.lines[i])}{s.grandTotal ? ` · RM ${fmtMoney(s.grandTotal)}` : ""}</span>
                </li>
              ))}
            </ul>
            {combo.covered < combo.total && (
              <p className="text-[11px] text-amber-700 dark:text-amber-400">
                PO line{combo.total - combo.covered === 1 ? "" : "s"} {lineList(lines, Array.from({ length: combo.total }, (_, i) => i).filter((i) => !combo.lines.flat().includes(i)))} {combo.total - combo.covered === 1 ? "is" : "are"} in none of them: link that quotation yourself.
              </p>
            )}
            <Button type="button" size="sm" className="h-7 gap-1.5 text-xs" disabled={linking} onClick={() => onLinkMany(comboSs)}>
              <LinkIcon className="h-3 w-3" />Link all {comboSs.length}
            </Button>
          </div>
        )}
        <p className="text-xs font-medium">
          {combo ? "Or link them one at a time:" : <>{result.suggestions.length === 1 ? "1 quotation matches" : `${result.suggestions.length} quotations may match`} {result.fileName}:</>}
        </p>
        <ul className="space-y-1.5">{result.suggestions.map((s) => card(s))}</ul>
        {typeNumber(result.suggestions.length === 1 ? "Not the right quotation?" : "None of these is right?")}
      </>
    );
  } else if (uncoveredLines && lines.length > 0) {
    // ── a quotation is linked: are all the PO's lines in the linked quotation(s)? ──
    if (uncoveredLines.length === 0) {
      body = lines.length > 1 && (
        <p className="flex items-center gap-1.5 text-xs text-green-700 dark:text-green-400">
          <CheckCircle2Icon className="h-3.5 w-3.5 shrink-0" />All {lines.length} PO lines are in the linked quotation{linkedIds.length === 1 ? "" : "s"}.
        </p>
      );
    } else {
      const need = new Set(uncoveredLines);
      const others = result.suggestions
        .filter((s) => !linkedIds.includes(s.id))
        .map((s) => ({ s, adds: s.coversLines.filter((i) => need.has(i)) }))
        .filter((x) => x.adds.length > 0)
        .sort((a, b) => b.adds.length - a.adds.length || b.s.score - a.s.score);
      // No other quotation has those lines: most often the right quotation is linked and the PO just words the item
      // differently. Not a "more than one quotation" warning then: a quiet note for a PO of several lines, else nothing.
      if (others.length === 0) {
        body = lines.length > 1 && (
          <p className="text-[11px] leading-snug text-muted-foreground">
            PO line{uncoveredLines.length === 1 ? "" : "s"} {lineList(lines, uncoveredLines)} {uncoveredLines.length === 1 ? "was" : "were"} not recognised in the linked quotation{linkedIds.length === 1 ? "" : "s"}. Check {uncoveredLines.length === 1 ? "it" : "them"} with &ldquo;Match the PO lines&rdquo;, or{" "}
            <button type="button" className="underline hover:text-foreground" onClick={onTypeNumber}>link another quotation</button> if {uncoveredLines.length === 1 ? "it is" : "they are"} from one.
          </p>
        );
      } else body = (
        <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50/50 px-3 py-2.5 dark:border-amber-800 dark:bg-amber-900/10">
          <p className="flex items-start gap-1.5 text-xs font-medium text-amber-900 dark:text-amber-200">
            <AlertTriangleIcon className="mt-px h-3.5 w-3.5 shrink-0" />
            PO line{uncoveredLines.length === 1 ? "" : "s"} {lineList(lines, uncoveredLines)} {uncoveredLines.length === 1 ? "is" : "are"} not in the linked quotation{linkedIds.length === 1 ? "" : "s"} yet: this PO may be for more than one quotation.
          </p>
          <p className="text-[11px] text-muted-foreground">{others.length === 1 ? "This quotation has" : "These quotations have"} {uncoveredLines.length === 1 ? "it" : "them"}:</p>
          <ul className="space-y-1.5">{others.map((x) => card(x.s, x.adds))}</ul>
          {typeNumber("Another quotation?")}
        </div>
      );
    }
  }

  return (
    <div className="space-y-2.5">
      {filledNote}
      {body}

      {(showPoNo || showDate) && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border/60 pt-2 text-xs">
          {showPoNo && (
            <span>PO number on the document: <span className="font-mono font-medium">{result.poNumber}</span>{" "}
              <button type="button" className="underline hover:text-foreground" onClick={() => onUsePoNumber(result.poNumber!)}>Use it</button></span>
          )}
          {showDate && (
            <span>Date on the document: <span className="font-medium">{fmtDate(result.poDate!)}</span>{" "}
              <button type="button" className="underline hover:text-foreground" onClick={() => onUseDate(result.poDate!)}>Use as received date</button></span>
          )}
        </div>
      )}
    </div>
  );
}
