// How much of a sales order's lines its PRs already ask for, per product code (a PR line is its total;
// an SO line is quantity × sets).
// A line is "covered" only as far as that quantity goes: when an amendment raises a quantity, the
// rest is still to request (it used to be skipped once the product was on any PR).
// Server-only (reads the database).

import { and, eq, inArray, isNotNull, ne } from "drizzle-orm";
import { db } from "@/db";
import { purchaseRequisition, purchaseRequisitionItem } from "@/db/schema";
import { prLineQty, soLineQty } from "@/lib/sales-order/set-qty";

const norm = (c: string | null | undefined) => (c ?? "").trim().toLowerCase();

/** { soId: { productCode (normalized): quantity its active PRs ask for } } */
export async function prCoveredQty(orgId: string, soIds: string[]): Promise<Map<string, Map<string, number>>> {
  const out = new Map<string, Map<string, number>>();
  if (soIds.length === 0) return out;
  const rows = await db
    .select({
      soId: purchaseRequisition.salesOrderId,
      productCode: purchaseRequisitionItem.productCode,
      qty: purchaseRequisitionItem.qty,
      setGroupId: purchaseRequisitionItem.setGroupId,
      setQty: purchaseRequisitionItem.setQty,
    })
    .from(purchaseRequisitionItem)
    .innerJoin(purchaseRequisition, eq(purchaseRequisitionItem.purchaseRequisitionId, purchaseRequisition.id))
    .where(and(
      eq(purchaseRequisition.organizationId, orgId),
      isNotNull(purchaseRequisition.salesOrderId),
      inArray(purchaseRequisition.salesOrderId, soIds),
      ne(purchaseRequisition.status, "cancelled"),
    ));
  for (const r of rows) {
    const code = norm(r.productCode);
    if (!r.soId || !code) continue;
    const m = out.get(r.soId) ?? new Map<string, number>();
    m.set(code, (m.get(code) ?? 0) + prLineQty(r)); // a PR line is its total
    out.set(r.soId, m);
  }
  return out;
}

/**
 * What's still to request for each of an SO's lines, given what its PRs cover: the covered quantity
 * is taken off its lines with that product code in order. Lines without a code are never covered.
 */
export function remainingPerLine<T extends { id: string; productCode?: string | null; qty?: string | null; setGroupId?: string | null; setQty?: string | null }>(
  lines: T[],
  covered: Map<string, number> | undefined,
): Map<string, number> {
  const left = new Map(covered ?? []);
  const out = new Map<string, number>();
  for (const l of lines) {
    const need = soLineQty(l);
    const code = norm(l.productCode);
    if (!code) { out.set(l.id, need); continue; }
    const have = left.get(code) ?? 0;
    const take = Math.min(have, need);
    left.set(code, have - take);
    out.set(l.id, need - take);
  }
  return out;
}
