import { db } from "@/db";
import { product, intercompanyPrice, intercompanyPricingRule, customerPurchaseOrder } from "@/db/schema";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { isPricingMethod, pricingMethodLabel, usesPercent, type PricingMethod } from "@/lib/intercompany/methods";

// Prices the lines of a PO that one of the owner's organizations (the buyer) sends to a sibling (the seller).
// The method is chosen on the PO; when it is not, the default rule applies: the rule for this buyer, else the
// seller's rule for any buyer, else "manual" (the prices typed on the PO stay).
// A line the method cannot price (no product, no price, another currency) keeps the price typed on the PO,
// and is reported so the user knows.

export type PricedLine = { productCode?: string | null; qty?: string | null; unitPrice?: string | null; totalPrice?: string | null; currency?: string | null; customerPoNo?: string | null };
export type PricingChoice = { method?: string | null; marginPct?: string | null };
export type PricingSource = "chosen" | "supplier_rule" | "buyer_rule" | "seller_rule" | "default";

const norm = (c: string | null | undefined) => (c ?? "").trim().toLowerCase();
const num = (v: string | null | undefined) => {
  const n = parseFloat(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};

// Order: the user's choice; a rule for this supplier (for this buyer, then for any buyer); the seller's general
// rule for this buyer; the seller's general rule for any buyer; else the prices typed on the PO.
export async function resolvePricingMethod(
  sellerOrgId: string,
  buyerOrgId: string,
  chosen?: PricingChoice,
  supplierName?: string | null,
): Promise<{ method: PricingMethod; marginPct: string | null; source: PricingSource }> {
  if (isPricingMethod(chosen?.method)) return { method: chosen!.method as PricingMethod, marginPct: chosen?.marginPct?.trim() || null, source: "chosen" };
  const rules = await db
    .select()
    .from(intercompanyPricingRule)
    .where(and(eq(intercompanyPricingRule.sellerOrganizationId, sellerOrgId)));
  const sup = supplierName?.trim().toLowerCase() || null;
  const pick = (buyer: string | null, supplier: string | null) =>
    rules.find((r) => (r.buyerOrganizationId ?? null) === buyer && (r.supplierNameNormalized ?? null) === supplier && isPricingMethod(r.method));
  const order: [PricingSource, ReturnType<typeof pick>][] = [
    ["supplier_rule", sup ? pick(buyerOrgId, sup) : undefined],
    ["supplier_rule", sup ? pick(null, sup) : undefined],
    ["buyer_rule", pick(buyerOrgId, null)],
    ["seller_rule", pick(null, null)],
  ];
  for (const [source, r] of order) if (r) return { method: r.method as PricingMethod, marginPct: r.marginPct, source };
  return { method: "manual", marginPct: null, source: "default" };
}

export async function priceIntercompanyLines<T extends PricedLine>(
  sellerOrgId: string,
  buyerOrgId: string,
  lines: T[],
  chosen?: PricingChoice,
  customerPoIds: string[] = [], // the customer POs this PO is for (for "Customer PO price − discount %")
  supplierName?: string | null, // the supplier the PO is really for, when it was routed here (for supplier exceptions)
  // a customer PO's lines as they will be (an amendment not saved yet): priced from these instead of the saved ones
  cpoOverride?: { id: string; items: NonNullable<(typeof customerPurchaseOrder.$inferSelect)["items"]> },
): Promise<{ lines: T[]; method: PricingMethod; marginPct: string | null; source: PricingSource; kept: string[] }> {
  const resolved = await resolvePricingMethod(sellerOrgId, buyerOrgId, chosen, supplierName);
  const { method } = resolved;
  if (method === "manual") return { lines, ...resolved, kept: [] };

  let margin = 0;
  if (method === "cost_plus") {
    const m = num(resolved.marginPct);
    if (m === null || m < 0) throw new Error("Enter the margin % (0 or more) for Cost + margin pricing.");
    margin = m;
  }
  let discount = 0;
  if (method === "cpo_less") {
    const d = num(resolved.marginPct);
    if (d === null || d < 0 || d >= 100) throw new Error("Enter the discount % (0 up to, but not including, 100) for Customer PO price − discount.");
    discount = d;
  }
  // the customer POs of the buying organization this PO is for, with the lines the price is taken from
  const cpos = (method === "cpo_less" && customerPoIds.length > 0
    ? await db
        .select({ id: customerPurchaseOrder.id, customerPoNo: customerPurchaseOrder.customerPoNo, currency: customerPurchaseOrder.currency, items: customerPurchaseOrder.items })
        .from(customerPurchaseOrder)
        .where(and(eq(customerPurchaseOrder.organizationId, buyerOrgId), inArray(customerPurchaseOrder.id, customerPoIds)))
    : []).map((c) => (cpoOverride && c.id === cpoOverride.id ? { ...c, items: cpoOverride.items } : c));

  const codes = [...new Set(lines.map((l) => norm(l.productCode)).filter(Boolean))];
  const products = method === "price_list" || codes.length === 0
    ? []
    : await db
        .select({
          code: sql<string>`lower(trim(${product.productCode}))`,
          selling: product.sellingUnitPrice, sellingCurrency: product.sellingPriceCurrency,
          cost: product.costUnitPrice, costCurrency: product.costPriceCurrency,
        })
        .from(product)
        .where(and(eq(product.organizationId, sellerOrgId), inArray(sql`lower(trim(${product.productCode}))`, codes)));
  const listed = method === "price_list" && codes.length > 0
    ? await db
        .select({ code: intercompanyPrice.productCodeNormalized, price: intercompanyPrice.unitPrice, currency: intercompanyPrice.currency })
        .from(intercompanyPrice)
        .where(and(eq(intercompanyPrice.sellerOrganizationId, sellerOrgId), inArray(intercompanyPrice.productCodeNormalized, codes)))
    : [];

  const kept: string[] = [];
  const out = lines.map((l, idx) => {
    const code = norm(l.productCode);
    const label = l.productCode?.trim() || `line ${idx + 1}`;
    if (!code) { kept.push(`${label}: no product code`); return l; }
    const lineCurrency = l.currency || "MYR";
    let price: number | null = null;
    let currency = "MYR";
    if (method === "selling_price") {
      const p = products.find((x) => x.code === code);
      price = num(p?.selling); currency = p?.sellingCurrency ?? "MYR";
    } else if (method === "cost_plus") {
      const p = products.find((x) => x.code === code);
      const cost = num(p?.cost);
      price = cost === null ? null : cost * (1 + margin / 100);
      currency = p?.costCurrency ?? p?.sellingCurrency ?? "MYR";
    } else if (method === "cpo_less") {
      // prefer the customer PO named on the line, then any linked one
      const ordered = [...cpos].sort((a, b) => Number(b.customerPoNo === l.customerPoNo) - Number(a.customerPoNo === l.customerPoNo));
      let found: { net: number; currency: string } | null = null;
      for (const c of ordered) {
        const it = (c.items ?? []).find((x) => norm(x.productCode) === code && x.lineType !== "rent");
        if (!it) continue;
        const q = num(it.qty) ?? 0;
        const total = num(it.totalPrice);
        // the price the customer pays per unit, after the customer PO's own line discount
        const net = total !== null && q > 0 ? total / q : (num(it.unitPrice) ?? 0) * (1 - (num(it.discountPct) ?? 0) / 100);
        if (net > 0) { found = { net, currency: c.currency || "MYR" }; break; }
      }
      if (!found) {
        kept.push(`${label}: ${cpos.length === 0 ? "the PO is not linked to a customer PO" : "no priced line with this code on the customer PO"}`);
        return l;
      }
      price = found.net * (1 - discount / 100); currency = found.currency;
    } else {
      const p = listed.find((x) => x.code === code);
      price = num(p?.price); currency = p?.currency ?? "MYR";
    }
    if (price === null || !(price > 0)) {
      kept.push(`${label}: no ${method === "price_list" ? "intercompany price" : method === "cost_plus" ? "cost price" : "selling price"} on the seller's side`);
      return l;
    }
    if (currency !== lineCurrency) { kept.push(`${label}: the price is in ${currency}, the PO line is in ${lineCurrency}`); return l; }
    const unit = price.toFixed(2);
    const qty = num(l.qty) ?? 0;
    return { ...l, unitPrice: unit, totalPrice: (qty * parseFloat(unit)).toFixed(2) };
  });
  return { lines: out, ...resolved, kept };
}

export function intercompanyPricingNote(method: PricingMethod, marginPct: string | null, source: PricingSource, kept: string[], supplierName?: string | null): string | null {
  if (method === "manual") return null;
  const how = source === "chosen" ? "chosen" : source === "supplier_rule" ? `exception for ${supplierName ?? "this supplier"}` : "default rule";
  const head = `Intercompany pricing (${how}): ${pricingMethodLabel(method, marginPct)}.`;
  return kept.length > 0 ? `${head} Kept the entered price on ${kept.length} line(s): ${kept.join("; ")}.` : head;
}

export function sumTotals(lines: PricedLine[], sstPct: string | null | undefined) {
  const subtotal = lines.reduce((s, l) => s + (num(l.totalPrice) ?? 0), 0);
  const sst = (subtotal * (num(sstPct) ?? 0)) / 100;
  return { subtotal: subtotal.toFixed(2), sst: sst.toFixed(2), grandTotal: (subtotal + sst).toFixed(2) };
}

// The pricing note is rewritten on every save, so the previous one is dropped first
export const stripPricingNote = (notes: string | null | undefined) =>
  (notes ?? "").split("\n").filter((l) => !l.startsWith("Intercompany pricing (")).join("\n").trim();
