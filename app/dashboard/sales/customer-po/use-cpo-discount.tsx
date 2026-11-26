"use client";

// The overall discount on a Customer PO, carried from the quotation(s) it was made from.
// It follows the quotations (a fixed RM discount shared out by the part of the quotation
// ordered) until the user changes it; they can also remove it or go back to the quotation's.

import { useRef, useState } from "react";
import { AlertTriangleIcon } from "lucide-react";
import { sumLines } from "@/lib/customer-po/set-price";
import {
  NO_DISCOUNT,
  discountFromQuotations,
  discountFromSaved,
  overallDiscountAmount,
  type OverallDiscount,
} from "@/lib/sales-order/overall-discount";
import { OverallDiscountInput } from "../order/overall-discount-input";

type Line = Parameters<typeof sumLines>[0][number] & { _quotationNo?: string };

export type CpoQuotationDiscount = {
  quotationNo: string;
  discountPct: string;
  discountAmt: string;
  /** The quotation's full subtotal (for sharing out a fixed amount) */
  subtotal: string;
};

const money = (n: number) => `RM ${n.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const sameDiscount = (a: OverallDiscount, b: OverallDiscount, sub: number) =>
  Math.abs(overallDiscountAmount(sub, a) - overallDiscountAmount(sub, b)) < 0.005;

/**
 * saved: the discount stored on the CPO being edited. When it was saved with one, that is kept;
 * an older CPO (nothing stored) follows its quotations.
 */
export function useCpoDiscount(saved?: { pct: string | null; amt: string | null }) {
  const [quotes, setQuotes] = useState<Record<string, CpoQuotationDiscount>>({});
  const quotesRef = useRef(quotes);
  const initialManual = saved && (saved.pct != null || saved.amt != null) ? discountFromSaved(saved.pct, saved.amt) : null;
  const [manual, setManualState] = useState<OverallDiscount | null>(initialManual);
  const manualRef = useRef(manual);

  const writeQuotes = (next: Record<string, CpoQuotationDiscount>) => { quotesRef.current = next; setQuotes(next); };

  /** The discount the quotations give these lines. */
  function fromQuotes(items: Line[]): OverallDiscount {
    const list = Object.values(quotesRef.current);
    if (list.length === 0) return NO_DISCOUNT;
    const lines = list.map((q) => ({
      sourceQuotationId: q.quotationNo,
      totalPrice: sumLines(items.filter((i) => i._quotationNo === q.quotationNo)),
    }));
    return discountFromQuotations(
      lines,
      list.map((q) => ({ id: q.quotationNo, discountPct: q.discountPct, discountAmt: q.discountAmt, subtotal: q.subtotal })),
    );
  }

  const discountFor = (items: Line[]) => manualRef.current ?? fromQuotes(items);

  /** Items' total less the overall discount: what the CPO amount should be. */
  function netTotal(items: Line[]): string {
    const sub = parseFloat(sumLines(items)) || 0;
    return (sub - overallDiscountAmount(sub, discountFor(items))).toFixed(2);
  }

  /** null: follow the quotations again. */
  function setManual(next: OverallDiscount | null) {
    manualRef.current = next;
    setManualState(next);
  }

  /** A quotation linked: its discount counts, and the CPO follows the quotations again. */
  function addQuotation(q: CpoQuotationDiscount) {
    writeQuotes({ ...quotesRef.current, [q.quotationNo]: q });
    setManual(null);
  }

  /** Quotations already on a CPO being edited: known, without changing what the CPO has. */
  function loadQuotations(list: CpoQuotationDiscount[]) {
    const next = { ...quotesRef.current };
    for (const q of list) next[q.quotationNo] = q;
    writeQuotes(next);
  }

  function removeQuotation(quotationNo: string) {
    const next = { ...quotesRef.current };
    delete next[quotationNo];
    writeQuotes(next);
    setManual(null);
  }

  return { quotes, manual, fromQuotes, discountFor, netTotal, setManual, addQuotation, loadQuotations, removeQuotation };
}

export type CpoDiscount = ReturnType<typeof useCpoDiscount>;

/** The discount row under the CPO items, with a warning whenever it came from, or differs from, the quotation. */
export function CpoDiscountPanel({
  items,
  disc,
  onChange,
  netTone,
}: {
  items: Line[];
  disc: CpoDiscount;
  /** The user changed the discount (null: back to the quotation's) */
  onChange: (next: OverallDiscount | null) => void;
  /** Colour of the total after discount (against the CPO amount / document) */
  netTone?: string;
}) {
  const sub = parseFloat(sumLines(items)) || 0;
  const value = disc.discountFor(items);
  const amount = overallDiscountAmount(sub, value);
  const quoted = disc.fromQuotes(items);
  const quotedAmt = overallDiscountAmount(sub, quoted);
  const followsQuotes = disc.manual === null;
  const differs = !followsQuotes && !sameDiscount(value, quoted, sub);

  // How each quotation's discount came to what is applied
  const parts = Object.values(disc.quotes).flatMap((q) => {
    const pct = parseFloat(q.discountPct) || 0;
    const amt = parseFloat(q.discountAmt) || 0;
    if (pct > 0) return [`${q.quotationNo}: ${pct}%`];
    if (amt <= 0) return [];
    const ordered = parseFloat(sumLines(items.filter((i) => i._quotationNo === q.quotationNo))) || 0;
    const full = parseFloat(q.subtotal) || 0;
    if (full > 0 && ordered < full - 0.005) {
      return [`${q.quotationNo}: ${money(amt)} special discount, shared out by ${money(ordered)} of ${money(full)} ordered = ${money((amt * ordered) / full)}`];
    }
    return [`${q.quotationNo}: ${money(amt)} special discount`];
  });

  if (quotedAmt <= 0 && amount <= 0 && followsQuotes) return null;

  return (
    <div className="ml-auto w-full max-w-sm space-y-2 text-sm">
      <OverallDiscountInput value={value} onChange={onChange} amount={amount} fmt={money} />

      {followsQuotes && quotedAmt > 0 && (
        <div className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-2 text-[11px] leading-snug text-amber-800 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
          <AlertTriangleIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div className="space-y-1">
            <p>
              <span className="font-semibold">Overall discount carried from the quotation.</span> Check it against the
              customer&apos;s PO. Change it, or remove it if the customer didn&apos;t take it.
            </p>
            {parts.length > 0 && <ul className="list-disc pl-4">{parts.map((p) => <li key={p}>{p}</li>)}</ul>}
            <button type="button" onClick={() => onChange(NO_DISCOUNT)} className="font-semibold underline">
              Remove discount
            </button>
          </div>
        </div>
      )}

      {differs && (
        <div className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-2 text-[11px] leading-snug text-amber-800 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
          <AlertTriangleIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div className="space-y-1">
            <p>
              {quotedAmt > 0
                ? <>Different from the quotation&apos;s discount ({money(quotedAmt)}). The sales order will use this one.</>
                : <>The quotation has no overall discount. The sales order will use this one.</>}
            </p>
            {quotedAmt > 0 && (
              <button type="button" onClick={() => onChange(null)} className="font-semibold underline">
                Use the quotation&apos;s discount
              </button>
            )}
          </div>
        </div>
      )}

      <div className="flex justify-between border-t border-border pt-1.5 font-semibold">
        <span>Total after discount</span>
        <span className={`tabular-nums font-mono ${netTone ?? ""}`}>{money(sub - amount)}</span>
      </div>
    </div>
  );
}
