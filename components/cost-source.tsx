"use client";

// Under a price: where it came from — what was last paid for the product (the same price: filled in
// from it), entered by hand (a different one: what was last paid, for comparison), or none. The
// sources come from lib/procurement/last-price.ts (getPrPriceSources / getPoPriceSources).

export type PriceSource = { unitPrice: string; currency: string; label: string };

export function CostSource({ code, cost, currency, sources, align = "left" }: {
  code?: string | null;
  cost?: string | null;
  currency?: string | null;
  sources: Record<string, PriceSource> | null;
  align?: "left" | "right";
}) {
  if (!sources) return null;
  const src = code ? sources[code.trim()] ?? sources[code] : undefined;
  const value = Number(cost ?? 0);
  const ccy = currency ?? "MYR";
  const cls = `mt-0.5 truncate text-[10px] ${align === "right" ? "text-right" : ""}`;
  const fmtP = (p: PriceSource) => `${p.currency} ${Number(p.unitPrice).toLocaleString("en-MY", { minimumFractionDigits: 2 })}`;
  if (!src) return <p className={`${cls} text-muted-foreground`} title="Never bought on a supplier PO, and no catalog cost">{value > 0 ? "entered by hand" : "no price history"}</p>;
  const same = value > 0 && Math.abs(value - Number(src.unitPrice)) < 0.005 && src.currency === ccy;
  if (same) return <p className={`${cls} text-muted-foreground`} title={src.label === "catalog cost" ? "From the product's catalog cost price" : `What we last paid: ${src.label}`}>{src.label === "catalog cost" ? "catalog cost" : `last paid · ${src.label}`}</p>;
  return (
    <p className={`${cls} text-amber-700 dark:text-amber-400`} title={`What we last paid: ${fmtP(src)} (${src.label})`}>
      {value > 0 ? "entered by hand · " : ""}last paid {fmtP(src)}
    </p>
  );
}
