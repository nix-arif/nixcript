// Itemized Case DO pricing vs the MDA rule: a product without a valid MDA
// registration is left off the customer copy, so with a price per item the
// customer copy's total would not match what is invoiced. Server-side check
// used when saving a doctor template or a Case DO's customer items.
import { db } from "@/db";
import { product } from "@/db/schema";
import { inArray } from "drizzle-orm";
import { isMdaValid } from "@/lib/mda/valid";

export async function pricedWithoutMda(items: { productId?: string | null; productCode?: string | null }[]): Promise<string[]> {
  const ids = [...new Set(items.map((i) => i.productId).filter(Boolean) as string[])];
  if (!ids.length) return [];
  const rows = await db.select({ id: product.id, code: product.productCode, reg: product.mdaRegistrationNo, exp: product.mdaExpiredOn })
    .from(product).where(inArray(product.id, ids));
  return rows.filter((r) => !isMdaValid(r.reg, r.exp)).map((r) => r.code);
}

export { pricedWithoutMdaMessage } from "@/lib/mda/priced-message";
