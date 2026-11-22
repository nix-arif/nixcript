"use client";

import { useMemo, useState } from "react";
import { CheckIcon, AlertTriangleIcon, ListChecksIcon, RotateCcwIcon, HandIcon, SparklesIcon, MinusCircleIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { matchPoLines, resolveMatches, type MatchItem, type PoLine, type PoLinesResult } from "@/lib/customer-po/po-lines";

const money = (v: number) => v.toLocaleString("en-MY", { minimumFractionDigits: 2 });
const SKIP = "__skip__"; // the "not one of our items" choice in the picker

type Item = MatchItem & { label: string };

// The lines read from the customer's PO, matched to the items on the CPO. The system suggests a match for each line; the
// user checks them and changes any that is wrong (or picks the item for a line it could not match, or says a line is
// not one of ours). Nothing changes until the user applies it: the CPO description of each matched item becomes the
// PO's wording, the items follow the PO's order, and the items the PO does not list are switched off.
export function PoLinesReview({
  lines, items, onApply,
}: {
  lines: PoLine[];
  items: Item[];
  onApply: (r: PoLinesResult) => void;
}) {
  const [open, setOpen] = useState(false);
  // the user's own choices, by PO line number: an item key, or null for "not one of our items"
  const [picks, setPicks] = useState<Record<number, string | null>>({});
  const auto = useMemo(() => (open ? matchPoLines(lines, items) : null), [open, lines, items]);
  const result = useMemo(() => (auto ? resolveMatches(auto, items, picks) : null), [auto, items, picks]);
  // items grouped by the quotation they came from, in the order of the CPO
  const groups = useMemo(() => {
    const out: { name: string; items: Item[] }[] = [];
    for (const it of items) {
      const name = it.group || "Items";
      const g = out.find((x) => x.name === name);
      if (g) g.items.push(it); else out.push({ name, items: [it] });
    }
    return out;
  }, [items]);
  if (lines.length === 0 || items.length === 0) return null;

  if (!open || !result || !auto) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
        <ListChecksIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1 text-xs">
          <span className="font-medium">The PO has {lines.length} line{lines.length === 1 ? "" : "s"}.</span>{" "}
          <span className="text-muted-foreground">Match each one to our item: we suggest a match, you check it and change any that is wrong.</span>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>Match the PO lines</Button>
      </div>
    );
  }

  const itemOf = (key: string | null) => items.find((i) => i.key === key);
  const lineUsing = (key: string, exceptNo: number) => result.matches.find((m) => m.itemKey === key && m.line.no !== exceptNo)?.line.no;
  const matched = result.matches.filter((m) => m.itemKey).length;
  const skipped = result.matches.filter((m) => !m.itemKey && result.picked.has(m.line.no)).length;
  const open_ = result.matches.length - matched - skipped; // still to decide
  const toCheck = result.matches.filter((m) => m.itemKey && (m.priceDiff || m.qtyDiff || m.confidence === "weak")).length;

  // choosing an item for a line takes it off any other line the user had given it to
  const choose = (no: number, value: string) => setPicks((p) => {
    const key = value === SKIP ? null : value;
    const next: Record<number, string | null> = {};
    for (const [n, k] of Object.entries(p)) if (key === null || k !== key || Number(n) === no) next[Number(n)] = k;
    next[no] = key;
    return next;
  });
  const reset = (no: number) => setPicks((p) => { const next = { ...p }; delete next[no]; return next; });
  const close = () => { setOpen(false); setPicks({}); };

  return (
    <div className="space-y-3 rounded-lg border border-border p-3">
      {/* where things stand */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span className="font-semibold">{matched} of {result.matches.length} PO lines matched</span>
        {open_ > 0 && <span className="font-medium text-amber-700 dark:text-amber-400">{open_} to match</span>}
        {toCheck > 0 && <span className="text-amber-700 dark:text-amber-400">{toCheck} to check</span>}
        {skipped > 0 && <span className="text-muted-foreground">{skipped} not ours</span>}
        {result.picked.size > 0 && (
          <button type="button" className="ml-auto inline-flex items-center gap-1 text-muted-foreground underline-offset-2 hover:text-foreground hover:underline" onClick={() => setPicks({})}>
            <RotateCcwIcon className="h-3 w-3" />Back to the suggestions
          </button>
        )}
      </div>
      <p className="text-[11px] leading-snug text-muted-foreground">
        For each line of the customer&apos;s PO, check the item we matched. If it is wrong, or there is none, pick the right item from the list. If the line is not something we supply, choose &ldquo;Not one of our items&rdquo;.
      </p>

      <ol className="space-y-2">
        {result.matches.map((m) => {
          const it = itemOf(m.itemKey);
          const byHand = result.picked.has(m.line.no);
          const undecided = !m.itemKey && !byHand;
          const ok = it && !m.priceDiff && !m.qtyDiff;
          return (
            <li
              key={m.line.no}
              className={cn(
                "grid gap-x-4 gap-y-2 rounded-lg border p-2.5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]",
                undecided ? "border-amber-300 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-900/10" : "border-border bg-background",
              )}
            >
              {/* the PO's side */}
              <div className="min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="shrink-0 rounded bg-muted px-1.5 py-px text-[10px] font-semibold tabular-nums text-muted-foreground">PO line {m.line.no}</span>
                  <span className="min-w-0 text-xs leading-snug">{m.line.description}</span>
                </div>
                <div className="mt-1 text-[11px] tabular-nums text-muted-foreground">
                  Qty {m.line.qty ?? "?"} × {m.line.unitPrice != null ? money(m.line.unitPrice) : "?"}
                  {m.line.amount != null && <> = {money(m.line.amount)}</>}
                </div>
              </div>

              {/* our item: suggested, or picked by the user */}
              <div className="min-w-0 space-y-1.5">
                <select
                  aria-label={`Our item for PO line ${m.line.no}`}
                  value={m.itemKey ?? (byHand ? SKIP : "")}
                  onChange={(e) => choose(m.line.no, e.target.value)}
                  className={cn(
                    "h-9 w-full min-w-0 rounded-md border bg-background px-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring",
                    undecided ? "border-amber-400 text-amber-900 dark:text-amber-200" : "border-input",
                  )}
                >
                  {undecided && <option value="" disabled>Pick our item for this line…</option>}
                  <option value={SKIP}>Not one of our items (leave it out)</option>
                  {groups.map((g) => (
                    <optgroup key={g.name} label={groups.length > 1 ? `Quotation ${g.name}` : g.name}>
                      {g.items.map((i) => {
                        const other = lineUsing(i.key, m.line.no);
                        return (
                          <option key={i.key} value={i.key}>
                            {i.label} · {i.qty} × {money(parseFloat(i.unitPrice) || 0)}{other ? `  (now on PO line ${other})` : ""}
                          </option>
                        );
                      })}
                    </optgroup>
                  ))}
                </select>
                {/* the chosen item in full: a phone's picker cuts long names short */}
                {it && (
                  <div className="text-[11px] leading-snug text-muted-foreground">
                    <span className="text-foreground">{it.label}</span>
                    <span className="tabular-nums"> · {it.qty} × {money(parseFloat(it.unitPrice) || 0)}</span>
                    {groups.length > 1 && it.group && <span> · from {it.group}</span>}
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
                  {byHand ? (
                    <span className="inline-flex items-center gap-1 font-medium text-sky-700 dark:text-sky-300"><HandIcon className="h-3 w-3" />{m.itemKey ? "Your choice" : "Not one of our items"}</span>
                  ) : m.itemKey ? (
                    <span className={cn("inline-flex items-center gap-1 font-medium", m.confidence === "strong" ? "text-green-700 dark:text-green-400" : "text-amber-700 dark:text-amber-400")}>
                      <SparklesIcon className="h-3 w-3" />{m.confidence === "strong" ? "Suggested: strong match" : "Suggested: please check"}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 font-medium text-amber-700 dark:text-amber-400"><AlertTriangleIcon className="h-3 w-3" />No match found: pick the item</span>
                  )}
                  {byHand && (
                    <button type="button" className="inline-flex items-center gap-1 text-muted-foreground underline-offset-2 hover:text-foreground hover:underline" onClick={() => reset(m.line.no)}>
                      <RotateCcwIcon className="h-3 w-3" />{auto.matches.find((a) => a.line.no === m.line.no)?.itemKey ? "Use the suggestion" : "Undo"}
                    </button>
                  )}
                </div>

                {ok && <div className="inline-flex items-center gap-1 text-[11px] text-green-700 dark:text-green-400"><CheckIcon className="h-3 w-3" />Price and quantity agree</div>}
                {m.priceDiff && <div className="flex items-start gap-1 text-[11px] text-amber-700 dark:text-amber-400"><AlertTriangleIcon className="mt-px h-3 w-3 shrink-0" />Price differs: PO {money(m.priceDiff.po)}, ours {money(m.priceDiff.ours)}. It is not changed: check it.</div>}
                {m.qtyDiff && <div className="flex items-start gap-1 text-[11px] text-amber-700 dark:text-amber-400"><AlertTriangleIcon className="mt-px h-3 w-3 shrink-0" />Quantity differs: PO {m.qtyDiff.po}, ours {m.qtyDiff.ours}{it?.inSet ? " (part of a set: not changed)" : ". The PO's quantity will be used."}</div>}
                {!m.itemKey && byHand && <div className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"><MinusCircleIcon className="h-3 w-3" />This line is left out.</div>}
              </div>
            </li>
          );
        })}
      </ol>

      {result.notOnPo.length > 0 && (
        <p className="text-[11px] leading-snug text-muted-foreground">
          <span className="font-medium text-foreground">Not on the PO, so they will be switched off</span> (you can tick them back afterwards): {result.notOnPo.map((k) => itemOf(k)?.label).filter(Boolean).join(" · ")}
        </p>
      )}

      {/* apply: sticks to the bottom of the screen while the list is long */}
      <div className="sticky bottom-2 z-10 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-background/95 px-3 py-2 shadow-sm backdrop-blur">
        <p className="min-w-0 flex-1 basis-60 text-[11px] leading-snug text-muted-foreground">
          {open_ > 0
            ? <span className="font-medium text-amber-700 dark:text-amber-400">{open_} line{open_ === 1 ? " is" : "s are"} not matched yet and will be left out if you apply now. </span>
            : null}
          Applying puts the PO&apos;s wording on the matched items, follows the PO&apos;s order and uses its quantity for loose items. Prices are never changed.
        </p>
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="outline" onClick={close}>Cancel</Button>
          <Button type="button" size="sm" onClick={() => { onApply(result); close(); }} disabled={matched === 0}>
            Apply {matched} match{matched === 1 ? "" : "es"}
          </Button>
        </div>
      </div>
    </div>
  );
}
