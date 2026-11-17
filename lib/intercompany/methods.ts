// How a PO to a sibling organization (an "intercompany" PO) is priced. Plain constants, safe for client code.
export type PricingMethod = "manual" | "selling_price" | "cost_plus" | "price_list" | "cpo_less";

export const PRICING_METHODS: { value: PricingMethod; label: string; help: string }[] = [
  { value: "manual", label: "Manual price", help: "Use the unit prices typed on the PO." },
  { value: "selling_price", label: "Product selling price", help: "The seller's selling price for the product (from its product table)." },
  { value: "cost_plus", label: "Cost + margin %", help: "The seller's cost price for the product plus a margin." },
  { value: "price_list", label: "Intercompany price list", help: "The price the seller set for this product in its intercompany price list." },
  { value: "cpo_less", label: "Customer PO price − discount %", help: "The price on the customer PO this order is for, less a percentage. The PO must be linked to a customer PO." },
];

// Methods that take a percentage, and what it is called
export const PERCENT_LABEL: Partial<Record<PricingMethod, string>> = { cost_plus: "Margin %", cpo_less: "Discount %" };
export const usesPercent = (m: string | null | undefined) => m === "cost_plus" || m === "cpo_less";

export const pricingMethodLabel = (m: string | null | undefined, pct?: string | null) => {
  const label = PRICING_METHODS.find((x) => x.value === m)?.label ?? "Manual price";
  if (!pct) return label;
  if (m === "cost_plus") return `${label} (+${pct}%)`;
  if (m === "cpo_less") return `Customer PO price − ${pct}%`;
  return label;
};

export const isPricingMethod = (m: unknown): m is PricingMethod => PRICING_METHODS.some((x) => x.value === m);
