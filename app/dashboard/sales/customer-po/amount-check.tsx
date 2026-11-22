"use client";

import { AlertTriangleIcon, CheckCircle2Icon, InfoIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// Does the CPO amount agree with the items ticked on it? Recorded CPOs always do, so a difference usually means an
// item ticked or left out by mistake, a wrong quantity, or an amount typed wrong.
//  ok:       the same (to the sen)
//  rounding: off by RM 1.00 or less, most likely rounding on the customer's PO
//  mismatch: anything more
export type AmountState = "none" | "ok" | "rounding" | "mismatch";

export function amountCheck(amount: string, itemsTotal: string, selectedCount: number): { state: AmountState; diff: number } {
  if (selectedCount === 0) return { state: "none", diff: 0 };
  const a = parseFloat(amount), t = parseFloat(itemsTotal);
  if (!Number.isFinite(a)) return { state: "mismatch", diff: -(Number.isFinite(t) ? t : 0) };
  const diff = Math.round((a - (Number.isFinite(t) ? t : 0)) * 100) / 100;
  if (Math.abs(diff) < 0.005) return { state: "ok", diff: 0 };
  return { state: Math.abs(diff) <= 1 ? "rounding" : "mismatch", diff };
}

// the colour of the Amount box and of the items' total, by state
export const AMOUNT_TONE: Record<AmountState, { input: string; text: string }> = {
  none:     { input: "", text: "" },
  ok:       { input: "border-green-500 focus-visible:ring-green-500/30", text: "text-green-700 dark:text-green-400" },
  rounding: { input: "border-amber-400 focus-visible:ring-amber-400/30", text: "text-amber-700 dark:text-amber-400" },
  mismatch: { input: "border-red-500 bg-red-50/50 focus-visible:ring-red-500/30 dark:bg-red-950/20", text: "text-red-600 dark:text-red-400" },
};

const money = (v: number) => Math.abs(v).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// The short note under the Amount box
export function AmountCheckNote({
  amount, itemsTotal, selectedCount, currency, onUseItemsTotal,
}: {
  amount: string;
  itemsTotal: string;
  selectedCount: number;
  currency: string;
  onUseItemsTotal: () => void;
}) {
  const { state, diff } = amountCheck(amount, itemsTotal, selectedCount);
  if (state === "none") return null;
  const items = `${selectedCount} selected item${selectedCount === 1 ? "" : "s"}`;
  if (state === "ok") {
    return (
      <p className="flex items-start gap-1 text-[11px] leading-snug text-green-700 dark:text-green-400">
        <CheckCircle2Icon className="mt-px h-3 w-3 shrink-0" />Matches the {items}
      </p>
    );
  }
  const tone = AMOUNT_TONE[state].text;
  const Icon = state === "rounding" ? InfoIcon : AlertTriangleIcon;
  return (
    <div role={state === "mismatch" ? "alert" : undefined} className={cn("flex items-start gap-1 text-[11px] leading-snug", tone)}>
      <Icon className="mt-px h-3 w-3 shrink-0" />
      <span>
        {state === "rounding" ? "Small difference: " : "Does not match the items: "}
        the amount is {currency} {money(diff)} {diff > 0 ? "more" : "less"} than the {items} ({currency} {money(parseFloat(itemsTotal) || 0)}).
        {state === "mismatch" && " Check the items ticked and their quantities, or the amount."}{" "}
        <button type="button" className="font-medium underline underline-offset-2 hover:opacity-80" onClick={onUseItemsTotal}>Use item total</button>
      </span>
    </div>
  );
}
