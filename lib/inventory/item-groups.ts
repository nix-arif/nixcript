// Which user-defined item groups each product is in (a product can be in
// several — it is then listed under each). Plain helper for server code.
import { db } from "@/db";
import { itemGroupProduct } from "@/db/schema";
import { inArray } from "drizzle-orm";

export async function groupIdsByProduct(productIds: string[]): Promise<Map<string, string[]>> {
  const ids = [...new Set(productIds)];
  const out = new Map<string, string[]>();
  if (!ids.length) return out;
  const rows = await db.select().from(itemGroupProduct).where(inArray(itemGroupProduct.productId, ids));
  for (const r of rows) out.set(r.productId, [...(out.get(r.productId) ?? []), r.groupId]);
  return out;
}
