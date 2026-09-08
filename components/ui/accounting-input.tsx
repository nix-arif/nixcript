"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface AccountingInputProps extends Omit<React.ComponentProps<"input">, "value" | "onChange" | "type"> {
  // Raw numeric string ("1234.5", "0", "") — never the comma-formatted display text.
  value: string;
  onValueChange: (raw: string) => void;
}

// Accounting-format number input: shows "1,234.56" (thousands separators,
// fixed 2 decimals) while not focused, and the plain editable number while
// focused/typing — so commas never fight with the cursor while entering a
// value, matching the classic spreadsheet "Accounting" number format.
// `draft` only matters while focused (onFocus seeds it from `value`) — while
// blurred, `display` is computed straight from `value`, so there's no need
// to keep `draft` synced via an effect.
export function AccountingInput({ value, onValueChange, className, onFocus, onBlur, ...props }: AccountingInputProps) {
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState(value);

  const display = focused
    ? draft
    : value === "" || isNaN(parseFloat(value))
      ? value
      : parseFloat(value).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <Input
      {...props}
      type="text"
      inputMode="decimal"
      value={display}
      onFocus={(e) => {
        setFocused(true);
        setDraft(value);
        // The DOM value at this instant is still the *formatted* display
        // (e.g. "0.00") — select() here would select that, then lose the
        // selection once React re-renders with the raw draft ("0"). Defer
        // to next tick so it selects the text that's actually on screen.
        const el = e.target;
        setTimeout(() => el.select(), 0);
        onFocus?.(e);
      }}
      onBlur={(e) => { setFocused(false); onBlur?.(e); }}
      onChange={(e) => {
        const raw = e.target.value;
        if (!/^\d*\.?\d*$/.test(raw)) return; // digits and a single decimal point only — no negatives
        setDraft(raw);
        onValueChange(raw);
      }}
      className={cn("text-right tabular-nums", className)}
    />
  );
}
