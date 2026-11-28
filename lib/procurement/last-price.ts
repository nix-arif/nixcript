// What we last paid for a product: the price on the most recent issued supplier PO (confirmed or
// fulfilled) of any of the owner's companies, by product code — from the given supplier first, else
// from any supplier — and the product's catalog cost price as the last resort. Used to fill in the
// prices of a new PR (its estimated cost) and supplier PO. Server-only (reads the database).
//
// Catalog cost prices are mostly empty, and a company may buy products listed in a sibling's
// catalog, so the supplier POs are the price that matters.

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { product, purchaseOrder, purchaseOrderItem } from "@/db/schema";

export type LastPrice = {
  unitPrice: string;
  currency: string;
  /** where it came from: the supplier PO (number, supplier, date) or the catalog */
  source: "supplier" | "other-supplier" | "catalog";
  poNo: string | null;
  supplierName: string | null;
  date: string | null;
};

const norm = (c: string) => c.trim().toLowerCase();
const positive = (v: string | null | undefined) => Number(v ?? 0) > 0;

/**
 * { productCode (as given): its last price } for the codes that have one.
 * supplierId: that supplier's price wins over another's. currency: another supplier's price (or the
 * catalog's) is only taken in this currency (a PO has one currency); left out, any currency.
 */
export async function lastPurchasePrices(
  orgIds: string[],
  codes: (string | null | undefined)[],
  opts: { supplierId?: string | null; currency?: string | null } = {},
): Promise<Map<string, LastPrice>> {
  const wanted = [...new Set(codes.filter((c): c is string => !!c && !!c.trim()))];
  const out = new Map<string, LastPrice>();
  if (wanted.length === 0 || orgIds.length === 0) return out;
  const byNorm = new Map(wanted.map((c) => [norm(c), c]));

  const rows = await db
    .select({
      code: purchaseOrderItem.productCode,
      unitPrice: purchaseOrderItem.unitPrice,
      itemCurrency: purchaseOrderItem.currency,
      poCurrency: purchaseOrder.currency,
      supplierId: purchaseOrder.supplierId,
      supplierName: sql<string | null>`${purchaseOrder.supplierSnapshot}->>'name'`,
      poNo: purchaseOrder.poNo,
      date: sql<string>`to_char(coalesce(${purchaseOrder.poDate}::timestamp, ${purchaseOrder.createdAt}), 'YYYY-MM-DD')`,
    })
    .from(purchaseOrderItem)
    .innerJoin(purchaseOrder, eq(purchaseOrder.id, purchaseOrderItem.purchaseOrderId))
    .where(and(
      inArray(purchaseOrder.organizationId, orgIds),
      inArray(purchaseOrder.status, ["confirmed", "fulfilled"]),
      sql`lower(trim(${purchaseOrderItem.productCode})) in ${[...byNorm.keys()]}`,
    ))
    .orderBy(desc(sql`coalesce(${purchaseOrder.poDate}::timestamp, ${purchaseOrder.createdAt})`));

  // newest first: the first priced row per code (the supplier's own, then anyone's in the currency)
  for (const pass of ["supplier", "other-supplier"] as const) {
    for (const r of rows) {
      const code = r.code ? byNorm.get(norm(r.code)) : undefined;
      if (!code || out.has(code) || !positive(r.unitPrice)) continue;
      const currency = r.poCurrency || r.itemCurrency || "MYR";
      if (pass === "supplier") { if (!opts.supplierId || r.supplierId !== opts.supplierId) continue; }
      else if (opts.currency && currency !== opts.currency) continue;
      out.set(code, { unitPrice: Number(r.unitPrice).toFixed(2), currency, source: pass, poNo: r.poNo, supplierName: r.supplierName, date: r.date });
    }
  }

  // the catalog cost (any of the companies' catalogs) for what was never bought
  const rest = wanted.filter((c) => !out.has(c));
  if (rest.length > 0) {
    const prods = await db
      .select({ code: product.productCode, cost: product.costUnitPrice, currency: product.costPriceCurrency })
      .from(product)
      .where(and(inArray(product.organizationId, orgIds), sql`lower(trim(${product.productCode})) in ${rest.map(norm)}`));
    for (const p of prods) {
      const code = byNorm.get(norm(p.code));
      const currency = p.currency || "MYR";
      if (!code || out.has(code) || !positive(p.cost) || (opts.currency && currency !== opts.currency)) continue;
      out.set(code, { unitPrice: Number(p.cost).toFixed(2), currency, source: "catalog", poNo: null, supplierName: null, date: null });
    }
  }
  return out;
}
