// The one Intercompany PO (ICPO) number generator — used both by the Case DO
// invoice rule (server/purchase-order.ts) and by consignment settlement
// (lib/consignment/settle.ts). No session check of its own (settlement runs
// from the monthly scheduler), so it is NOT a server action: callers must
// have authorized orgId already.

import { db } from "@/db";
import { documentNumberingSetting, intercompanyPurchaseOrderCounter, purchaseOrder } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { buildDocumentNo } from "@/lib/document-numbering";
import { nextFreeDocNo } from "@/lib/document-number-group";
import { numberingConfig } from "@/lib/invoice-number";

/**
 * The company's own "icpo" numbering if it saved one; otherwise its PO
 * numbering with doc code "ICPO" (POAF/26-0001 → ICPOAF/26-0001) rather than
 * the generic org-slug fallback. Own counter — never shares a sequence with
 * regular POs — and skips any number already used across the owner's companies.
 */
export async function nextIntercompanyPoNo(orgId: string): Promise<string> {
  const [own] = await db.select({ id: documentNumberingSetting.id }).from(documentNumberingSetting)
    .where(and(eq(documentNumberingSetting.organizationId, orgId), eq(documentNumberingSetting.documentType, "icpo"))).limit(1);
  const cfg = own ? await numberingConfig(orgId, "icpo") : { ...(await numberingConfig(orgId, "po")), documentType: "icpo" as const, docCode: "ICPO" };

  const year = new Date().getFullYear();
  const [c] = await db.select().from(intercompanyPurchaseOrderCounter).where(eq(intercompanyPurchaseOrderCounter.organizationId, orgId)).limit(1);
  const start = c && c.year === year ? c.lastNumber + 1 : 1;
  const { seq, docNo } = await nextFreeDocNo(
    { table: purchaseOrder, id: purchaseOrder.id, organizationId: purchaseOrder.organizationId, number: purchaseOrder.poNo },
    orgId, start, (n) => buildDocumentNo(cfg, year, n),
  );
  if (c) await db.update(intercompanyPurchaseOrderCounter).set({ year, lastNumber: seq }).where(eq(intercompanyPurchaseOrderCounter.organizationId, orgId));
  else await db.insert(intercompanyPurchaseOrderCounter).values({ id: nanoid(), organizationId: orgId, year, lastNumber: seq });
  return docNo;
}
