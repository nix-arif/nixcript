"use server";

// Intercompany pricing settings (owner only): the default rule per seller/buyer, and the intercompany price list.
// How the prices are applied to a PO is in lib/intercompany/pricing.ts.

import { db } from "@/db";
import { intercompanyPrice, intercompanyPricingRule, member, organization, product, restrictedSupplier, supplier } from "@/db/schema";
import { getCachedSession } from "@/lib/auth/cached-session";
import { getOwnerOrgIds } from "@/lib/org/owner-orgs";
import { requireAccess } from "@/lib/auth/require-access";
import { resolvePricingMethod } from "@/lib/intercompany/pricing";
import { routeRestrictedSupplier } from "@/lib/org/supplier-routing";
import { isPricingMethod, usesPercent, type PricingMethod } from "@/lib/intercompany/methods";
import { buildPriceListWorkbook, type PriceTemplateRow } from "@/lib/intercompany/price-list-workbook";
import { nanoid } from "nanoid";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";

async function requireOwner() {
  const session = await getCachedSession();
  if (!session) throw new Error("You must be signed in to continue");
  const orgId = session.session.activeOrganizationId;
  if (!orgId) throw new Error("No active organization");
  const userId = session.user.id;
  const [m] = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.organizationId, orgId)))
    .limit(1);
  if (!m || m.role !== "owner") throw new Error("Only the organization owner can do this");
  return { orgId, userId, ownerOrgIds: await getOwnerOrgIds(orgId) };
}

export type PricingRuleRow = typeof intercompanyPricingRule.$inferSelect & { sellerName: string; buyerName: string | null };
export type PriceRow = typeof intercompanyPrice.$inferSelect;

export async function getPricingAdminData(): Promise<{
  orgs: { id: string; name: string }[];
  rules: PricingRuleRow[];
  prices: PriceRow[];
}> {
  const { ownerOrgIds } = await requireOwner();
  const orgs = await db.select({ id: organization.id, name: organization.name }).from(organization)
    .where(inArray(organization.id, ownerOrgIds)).orderBy(asc(organization.name));
  const nameOf = new Map(orgs.map((o) => [o.id, o.name]));
  const rules = await db.select().from(intercompanyPricingRule)
    .where(inArray(intercompanyPricingRule.sellerOrganizationId, ownerOrgIds));
  const prices = await db.select().from(intercompanyPrice)
    .where(inArray(intercompanyPrice.sellerOrganizationId, ownerOrgIds))
    .orderBy(asc(intercompanyPrice.productCodeNormalized));
  return {
    orgs,
    rules: rules
      .map((r) => ({ ...r, sellerName: nameOf.get(r.sellerOrganizationId) ?? "—", buyerName: r.buyerOrganizationId ? (nameOf.get(r.buyerOrganizationId) ?? "—") : null }))
      .sort((a, b) => a.sellerName.localeCompare(b.sellerName) || (a.buyerName ?? "").localeCompare(b.buyerName ?? "")),
    prices,
  };
}

function parseMargin(method: PricingMethod, pct: string | undefined): string | null {
  if (!usesPercent(method)) return null;
  const n = parseFloat(String(pct ?? "").replace(/,/g, ""));
  if (method === "cpo_less") {
    if (!Number.isFinite(n) || n < 0 || n >= 100) throw new Error("Enter the discount % (0 up to, but not including, 100).");
  } else if (!Number.isFinite(n) || n < 0) {
    throw new Error("Enter the margin % (0 or more) for Cost + margin.");
  }
  return String(n);
}

// One rule per (seller, buyer, supplier). Buyer null = any buyer; supplierName null = the general rule, otherwise an
// exception for that supplier (which the seller handles, see Supplier handling). Saving again for the same scope replaces it.
export async function saveIntercompanyPricingRule(input: {
  sellerOrganizationId: string;
  buyerOrganizationId: string | null;
  supplierName?: string | null;
  method: string;
  marginPct?: string;
}): Promise<void> {
  const { userId, ownerOrgIds } = await requireOwner();
  if (!isPricingMethod(input.method)) throw new Error("Choose a pricing method");
  if (!ownerOrgIds.includes(input.sellerOrganizationId)) throw new Error("The seller must be one of your organizations");
  if (input.buyerOrganizationId && !ownerOrgIds.includes(input.buyerOrganizationId)) throw new Error("The buyer must be one of your organizations");
  if (input.buyerOrganizationId === input.sellerOrganizationId) throw new Error("An organization cannot sell to itself");
  const marginPct = parseMargin(input.method, input.marginPct);

  // an exception only makes sense for a supplier that this seller handles
  let supplierName: string | null = null;
  let supplierNameNormalized: string | null = null;
  if (input.supplierName?.trim()) {
    const normalized = input.supplierName.trim().toLowerCase();
    const [handled] = await db
      .select({ name: restrictedSupplier.supplierName })
      .from(restrictedSupplier)
      .where(and(eq(restrictedSupplier.supplierNameNormalized, normalized), eq(restrictedSupplier.designatedOrganizationId, input.sellerOrganizationId)));
    if (!handled) throw new Error(`${input.supplierName.trim()} is not handled by this organization. Add it under Supplier handling first.`);
    supplierName = handled.name;
    supplierNameNormalized = normalized;
  }

  const [existing] = await db.select({ id: intercompanyPricingRule.id }).from(intercompanyPricingRule).where(and(
    eq(intercompanyPricingRule.sellerOrganizationId, input.sellerOrganizationId),
    input.buyerOrganizationId ? eq(intercompanyPricingRule.buyerOrganizationId, input.buyerOrganizationId) : isNull(intercompanyPricingRule.buyerOrganizationId),
    supplierNameNormalized ? eq(intercompanyPricingRule.supplierNameNormalized, supplierNameNormalized) : isNull(intercompanyPricingRule.supplierNameNormalized),
  ));
  if (existing) {
    await db.update(intercompanyPricingRule).set({ method: input.method, marginPct }).where(eq(intercompanyPricingRule.id, existing.id));
  } else {
    await db.insert(intercompanyPricingRule).values({
      id: nanoid(), sellerOrganizationId: input.sellerOrganizationId, buyerOrganizationId: input.buyerOrganizationId,
      supplierName, supplierNameNormalized, method: input.method, marginPct, createdBy: userId,
    });
  }
}

// "Apply to all": one method for many rows at once, in one atomic batch.
//  - seller_all:   every row of one seller's default matrix (each buyer, and "any other organization")
//  - all_sellers:  every row of every seller's default matrix
//  - supplier_all: every row of one supplier's exception matrix
// Rows that already have a rule are replaced; the result says how many were added and replaced.
export type ApplyScope =
  | { kind: "seller_all"; sellerOrganizationId: string }
  | { kind: "all_sellers" }
  | { kind: "supplier_all"; sellerOrganizationId: string; supplierName: string };

export async function applyIntercompanyPricingRules(input: {
  scope: ApplyScope;
  method: string;
  marginPct?: string;
}): Promise<{ added: number; replaced: number }> {
  const { userId, ownerOrgIds } = await requireOwner();
  if (!isPricingMethod(input.method)) throw new Error("Choose a pricing method");
  const marginPct = parseMargin(input.method, input.marginPct);
  if (ownerOrgIds.length < 2) throw new Error("This applies when you own more than one organization");

  const sellers = input.scope.kind === "all_sellers" ? ownerOrgIds : [input.scope.sellerOrganizationId];
  for (const id of sellers) if (!ownerOrgIds.includes(id)) throw new Error("The seller must be one of your organizations");

  let supplierName: string | null = null;
  let supplierNameNormalized: string | null = null;
  if (input.scope.kind === "supplier_all") {
    const normalized = input.scope.supplierName.trim().toLowerCase();
    const [handled] = await db
      .select({ name: restrictedSupplier.supplierName })
      .from(restrictedSupplier)
      .where(and(eq(restrictedSupplier.supplierNameNormalized, normalized), eq(restrictedSupplier.designatedOrganizationId, input.scope.sellerOrganizationId)));
    if (!handled) throw new Error(`${input.scope.supplierName.trim()} is not handled by this organization.`);
    supplierName = handled.name;
    supplierNameNormalized = normalized;
  }

  const existingRules = await db.select().from(intercompanyPricingRule).where(inArray(intercompanyPricingRule.sellerOrganizationId, ownerOrgIds));
  const queries: Parameters<typeof db.batch>[0][number][] = [];
  let added = 0;
  let replaced = 0;
  for (const seller of sellers) {
    const buyers: (string | null)[] = [...ownerOrgIds.filter((o) => o !== seller), null];
    for (const buyer of buyers) {
      const hit = existingRules.find((r) => r.sellerOrganizationId === seller && (r.buyerOrganizationId ?? null) === buyer && (r.supplierNameNormalized ?? null) === supplierNameNormalized);
      if (hit) {
        replaced++;
        queries.push(db.update(intercompanyPricingRule).set({ method: input.method, marginPct }).where(eq(intercompanyPricingRule.id, hit.id)));
      } else {
        added++;
        queries.push(db.insert(intercompanyPricingRule).values({
          id: nanoid(), sellerOrganizationId: seller, buyerOrganizationId: buyer, supplierName, supplierNameNormalized,
          method: input.method, marginPct, createdBy: userId,
        }));
      }
    }
  }
  if (queries.length > 0) await db.batch(queries as unknown as [(typeof queries)[0], ...(typeof queries)[number][]]);
  return { added, replaced };
}

export async function deleteIntercompanyPricingRule(id: string): Promise<void> {
  const { ownerOrgIds } = await requireOwner();
  await db.delete(intercompanyPricingRule).where(and(eq(intercompanyPricingRule.id, id), inArray(intercompanyPricingRule.sellerOrganizationId, ownerOrgIds)));
}

export type PriceListEntry = { productCode: string; unitPrice: string; currency?: string };

// Adds or updates prices (same product code replaces the price). Returns what was skipped and why.
export async function saveIntercompanyPrices(sellerOrganizationId: string, entries: PriceListEntry[]): Promise<{ saved: number; skipped: string[] }> {
  const { userId, ownerOrgIds } = await requireOwner();
  if (!ownerOrgIds.includes(sellerOrganizationId)) throw new Error("The seller must be one of your organizations");
  const skipped: string[] = [];
  const byCode = new Map<string, { productCode: string; unitPrice: string; currency: string }>();
  entries.forEach((e, i) => {
    const code = e.productCode?.trim();
    const price = parseFloat(String(e.unitPrice ?? "").replace(/,/g, ""));
    if (!code) { skipped.push(`Row ${i + 1}: product code is empty`); return; }
    if (!Number.isFinite(price) || price <= 0) { skipped.push(`Row ${i + 1} (${code}): price must be a number greater than 0`); return; }
    byCode.set(code.toLowerCase(), { productCode: code, unitPrice: price.toFixed(2), currency: (e.currency?.trim() || "MYR").toUpperCase() });
  });
  for (const [normalized, e] of byCode) {
    const [existing] = await db.select({ id: intercompanyPrice.id }).from(intercompanyPrice)
      .where(and(eq(intercompanyPrice.sellerOrganizationId, sellerOrganizationId), eq(intercompanyPrice.productCodeNormalized, normalized)));
    if (existing) {
      await db.update(intercompanyPrice).set({ productCode: e.productCode, unitPrice: e.unitPrice, currency: e.currency }).where(eq(intercompanyPrice.id, existing.id));
    } else {
      await db.insert(intercompanyPrice).values({
        id: nanoid(), sellerOrganizationId, productCode: e.productCode, productCodeNormalized: normalized,
        unitPrice: e.unitPrice, currency: e.currency, createdBy: userId,
      });
    }
  }
  return { saved: byCode.size, skipped };
}

export async function deleteIntercompanyPrice(id: string): Promise<void> {
  const { ownerOrgIds } = await requireOwner();
  await db.delete(intercompanyPrice).where(and(eq(intercompanyPrice.id, id), inArray(intercompanyPrice.sellerOrganizationId, ownerOrgIds)));
}

// For the PO form (any PO creator, not just the owner): when the chosen supplier is a sibling organization, or a supplier
// that a sibling handles (so the PO will be routed to it), which method applies by default.
export async function getIntercompanyPricingDefault(supplierId: string, knownOriginalSupplier?: string | null): Promise<{
  sellerName: string; method: PricingMethod; marginPct: string | null;
  source: "supplier_rule" | "buyer_rule" | "seller_rule" | "default"; routedFrom: string | null;
} | null> {
  const { orgId, userId } = await requireAccess("purchase-order:create");
  const [sup] = await db.select({ name: supplier.name, linked: supplier.linkedOrganizationId }).from(supplier).where(eq(supplier.id, supplierId));
  if (!sup) return null;
  const ownerOrgIds = await getOwnerOrgIds(orgId);
  let sellerId: string | null = null;
  let routedFrom: string | null = null;
  if (sup.linked && ownerOrgIds.includes(sup.linked)) {
    sellerId = sup.linked;
    routedFrom = knownOriginalSupplier?.trim() || null; // a PO already routed: the supplier it was really for
  } else {
    const route = await routeRestrictedSupplier(orgId, sup.name, userId, { dryRun: true });
    if (route) { sellerId = route.designatedOrgId; routedFrom = route.originalName; }
  }
  if (!sellerId) return null;
  const [seller] = await db.select({ name: organization.name }).from(organization).where(eq(organization.id, sellerId));
  const r = await resolvePricingMethod(sellerId, orgId, undefined, routedFrom);
  return {
    sellerName: seller?.name ?? "the sibling organization", method: r.method, marginPct: r.marginPct,
    source: r.source === "chosen" ? "default" : r.source, routedFrom,
  };
}

// The price list template: every product of the seller (so the user only fills in prices) plus anything already on the list
export async function createIntercompanyPriceTemplate(sellerOrganizationId: string): Promise<string> {
  const { ownerOrgIds } = await requireOwner();
  if (!ownerOrgIds.includes(sellerOrganizationId)) throw new Error("The seller must be one of your organizations");
  const [seller] = await db.select({ name: organization.name }).from(organization).where(eq(organization.id, sellerOrganizationId));
  const products = await db
    .select({ code: product.productCode, description: product.description })
    .from(product)
    .where(eq(product.organizationId, sellerOrganizationId))
    .orderBy(asc(product.productCode))
    .limit(20000);
  const listed = await db.select().from(intercompanyPrice).where(eq(intercompanyPrice.sellerOrganizationId, sellerOrganizationId));
  const priceOf = new Map(listed.map((p) => [p.productCodeNormalized, p]));
  const seen = new Set<string>();
  const rows: PriceTemplateRow[] = [];
  for (const p of products) {
    const key = p.code.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const l = priceOf.get(key);
    rows.push({ code: p.code, description: p.description ?? "", price: l?.unitPrice ?? "", currency: l?.currency ?? "MYR" });
  }
  for (const l of listed) {
    if (seen.has(l.productCodeNormalized)) continue;
    rows.push({ code: l.productCode, description: "", price: l.unitPrice, currency: l.currency });
  }
  const buf = await buildPriceListWorkbook(seller?.name ?? "", rows);
  return buf.toString("base64");
}
