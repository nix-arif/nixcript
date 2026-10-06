import { db } from "@/db";
import { itemGroupProduct, stockRuleSetting } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";

// Stock rules for Case DOs (Inventory → Stock Rules), per company. During a
// pilot stock isn't reconciled yet, so usage beyond what a location holds is
// recorded and listed as a shortfall; once reconciled the company switches to
// enforce, and such usage is refused.

export type StockRuleMode = "record_flag" | "warn" | "enforce";

export interface StockRules {
  mode: StockRuleMode;
  enforceFrom: Date | null;
  checkOnCreate: boolean;
  checkOnRecord: boolean;
  allowTakenFrom: boolean;
  allowNegative: boolean;
  exemptGroupIds: string[];
  exemptProductIds: string[];
}

export const DEFAULT_STOCK_RULES: StockRules = {
  mode: "record_flag", enforceFrom: null, checkOnCreate: false, checkOnRecord: true,
  allowTakenFrom: true, allowNegative: false, exemptGroupIds: [], exemptProductIds: [],
};

export async function getStockRules(orgId: string): Promise<StockRules> {
  const [r] = await db.select().from(stockRuleSetting).where(eq(stockRuleSetting.organizationId, orgId)).limit(1);
  if (!r) return DEFAULT_STOCK_RULES;
  return {
    mode: (r.mode as StockRuleMode) ?? "record_flag", enforceFrom: r.enforceFrom, checkOnCreate: r.checkOnCreate,
    checkOnRecord: r.checkOnRecord, allowTakenFrom: r.allowTakenFrom, allowNegative: r.allowNegative,
    exemptGroupIds: r.exemptGroupIds ?? [], exemptProductIds: r.exemptProductIds ?? [],
  };
}

/** The mode in force now: enforce scheduled for a later date is "warn" until then. */
export function modeNow(rules: StockRules, now = new Date()): StockRuleMode {
  if (rules.mode === "enforce" && rules.enforceFrom && now < rules.enforceFrom) return "warn";
  return rules.mode;
}

/** Products left out of the check (by product or item group) — always "record & flag". */
export async function exemptProducts(rules: StockRules, productIds: string[]): Promise<Set<string>> {
  const out = new Set(productIds.filter((id) => rules.exemptProductIds.includes(id)));
  if (rules.exemptGroupIds.length && productIds.length) {
    const rows = await db.select({ productId: itemGroupProduct.productId }).from(itemGroupProduct)
      .where(inArray(itemGroupProduct.groupId, rules.exemptGroupIds));
    for (const r of rows) if (productIds.includes(r.productId)) out.add(r.productId);
  }
  return out;
}
