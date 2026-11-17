"use client";

import { useEffect, useState } from "react";
import { getIntercompanyPricingDefault } from "@/server/intercompany-pricing";
import { PRICING_METHODS, PERCENT_LABEL, pricingMethodLabel, usesPercent, type PricingMethod } from "@/lib/intercompany/methods";
import { Input } from "@/components/ui/input";
import { BuildingIcon } from "lucide-react";

export type PricingPick = { method: "" | PricingMethod; marginPct: string };

// Shown on a PO whose supplier is one of your other organizations. "" = the user did not choose, so the default rule applies.
export function IntercompanyPricingPicker({
  supplierId,
  originalSupplier,
  value,
  onChange,
}: {
  supplierId: string;
  originalSupplier?: string | null; // edit page: the supplier a routed PO was really for
  value: PricingPick;
  onChange: (v: PricingPick) => void;
}) {
  const [dflt, setDflt] = useState<Awaited<ReturnType<typeof getIntercompanyPricingDefault>>>(null);

  useEffect(() => {
    let cancelled = false;
    setDflt(null);
    if (!supplierId) return;
    // null when the supplier is neither a sibling organization nor one a sibling handles: nothing to show then
    getIntercompanyPricingDefault(supplierId, originalSupplier).then((d) => { if (!cancelled) setDflt(d); }).catch(() => {});
    return () => { cancelled = true; };
  }, [supplierId, originalSupplier]);

  if (!supplierId || !dflt) return null;

  const effective = value.method || dflt?.method || "manual";
  const effectiveMargin = value.method ? value.marginPct : (dflt?.marginPct ?? "");
  const sourceText =
    dflt?.source === "supplier_rule" ? `exception for ${dflt.routedFrom ?? "this supplier"}`
    : dflt?.source === "buyer_rule" ? "rule for this company"
    : dflt?.source === "seller_rule" ? "rule for all buyers"
    : "no rule set";

  return (
    <div className="mt-3 rounded-lg border border-border bg-muted/20 px-3 py-3 space-y-2">
      <div className="flex items-center gap-1.5 text-xs font-medium">
        <BuildingIcon className="w-3.5 h-3.5 text-muted-foreground" />
        Intercompany pricing
      </div>
      <p className="text-[11px] leading-snug text-muted-foreground">
        {dflt.routedFrom
          ? <>{dflt.routedFrom} is handled by {dflt.sellerName}, so this PO is issued to {dflt.sellerName}.</>
          : <>{dflt.sellerName} is one of your organizations.</>}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="h-9 rounded-md border border-border bg-background px-3 text-sm"
          value={value.method}
          onChange={(e) => onChange({ method: e.target.value as PricingPick["method"], marginPct: value.marginPct })}
        >
          <option value="">
            Default{dflt ? ` — ${pricingMethodLabel(dflt.method, dflt.marginPct)} (${sourceText})` : ""}
          </option>
          {PRICING_METHODS.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>
        {usesPercent(value.method) && (
          <div className="flex items-center gap-1.5">
            <Input
              type="number" min="0" step="0.01" placeholder={PERCENT_LABEL[value.method as PricingMethod]?.replace(" %", "") ?? "%"}
              className="h-9 w-24 text-sm tabular-nums"
              value={value.marginPct}
              onChange={(e) => onChange({ method: value.method, marginPct: e.target.value })}
            />
            <span className="text-sm text-muted-foreground">%</span>
          </div>
        )}
      </div>
      <p className="text-[11px] leading-snug text-muted-foreground">
        {PRICING_METHODS.find((m) => m.value === effective)?.help}
        {effective !== "manual" && (
          <>
            {" "}The prices are set from {effective === "cpo_less" ? "the linked customer PO" : "the seller's data"} when you save{effective === "cost_plus" && effectiveMargin ? ` (cost + ${effectiveMargin}%)` : effective === "cpo_less" && effectiveMargin ? ` (less ${effectiveMargin}%)` : ""}.
            A line the seller has no price for keeps the price you typed, and the PO notes say which.
          </>
        )}
      </p>
    </div>
  );
}
