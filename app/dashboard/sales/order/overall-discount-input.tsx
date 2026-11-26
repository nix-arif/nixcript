"use client";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { DiscountMode, OverallDiscount } from "@/lib/sales-order/overall-discount";

/** Overall discount entry for a Sales Order: a % of the subtotal, or a fixed RM amount. */
export function OverallDiscountInput({
  value,
  onChange,
  amount,
  hint,
  fmt,
}: {
  value: OverallDiscount;
  onChange: (next: OverallDiscount) => void;
  /** RM the discount comes to */
  amount: number;
  /** Small note under the row, e.g. where the discount came from */
  hint?: string;
  fmt: (n: number) => string;
}) {
  const setMode = (mode: DiscountMode) => {
    if (mode === value.mode) return;
    // Switching keeps the same RM off the order, so nothing jumps
    onChange(mode === "fixed" ? { mode, pct: "0", amt: amount.toFixed(2) } : { mode, pct: "0", amt: "0" });
  };

  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-muted-foreground shrink-0">Overall disc.</span>
        <div className="flex items-center gap-1">
          <div className="flex rounded border border-input overflow-hidden text-[10px]">
            {(["pct", "fixed"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={cn(
                  "px-1.5 h-7",
                  value.mode === m ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted",
                )}
              >
                {m === "pct" ? "%" : "RM"}
              </button>
            ))}
          </div>
          <Input
            aria-label={value.mode === "pct" ? "Overall discount %" : "Overall discount RM"}
            value={value.mode === "pct" ? value.pct : value.amt}
            onChange={(e) =>
              onChange(value.mode === "pct" ? { ...value, pct: e.target.value } : { ...value, amt: e.target.value })
            }
            className={cn("h-7 text-xs text-right", value.mode === "pct" ? "w-14" : "w-20")}
          />
        </div>
        <span className="tabular-nums font-mono text-muted-foreground">−{fmt(amount)}</span>
      </div>
      {hint && <p className="text-[10px] text-muted-foreground text-right">{hint}</p>}
    </div>
  );
}
