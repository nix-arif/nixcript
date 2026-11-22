import { db } from "@/db";
import { quotation, quotationItem, customer, customerCompany, customerOrganization, customerPurchaseOrder } from "@/db/schema";
import { and, desc, eq, inArray, notInArray, count } from "drizzle-orm";
import { getOwnerOrgIds } from "@/lib/org/owner-orgs";
import { indexDoc, orgMatches, rankWithCombination, type Combination, type DocLine, type MatchCandidate, type Suggestion } from "@/lib/customer-po/quotation-match";

export type MatchResult = { suggestions: Suggestion[]; combination: Combination | null };
const NONE: MatchResult = { suggestions: [], combination: null };

const MAX_QUOTATIONS = 3000; // the most recent final quotations of the owner's companies
const CHUNK = 1000;          // ids per item query

// The final quotations (of the owner's organizations) that the document could belong to, in two steps:
//  1. the organization: only the quotations whose customer's organization is on the PO go on (the rest are filtered
//     out here, before their items are even loaded);
//  2. those are scored on everything else: the quotation number, the items, the PO's lines, the total.
export async function findMatchingQuotations(orgId: string, text: string, lines: DocLine[] = []): Promise<MatchResult> {
  const ownerOrgIds = await getOwnerOrgIds(orgId);
  const rows = await db
    .select({ id: quotation.id, quotationNo: quotation.quotationNo, grandTotal: quotation.grandTotal, customerId: quotation.customerId, snap: quotation.customerSnapshot })
    .from(quotation)
    .where(and(inArray(quotation.organizationId, ownerOrgIds), eq(quotation.status, "final"), eq(quotation.isDummy, 0)))
    .orderBy(desc(quotation.createdAt))
    .limit(MAX_QUOTATIONS);
  if (rows.length === 0) return NONE;

  const customerIds = [...new Set(rows.map((r) => r.customerId).filter((v): v is string => !!v))];
  const [custRows, orgRows] = customerIds.length
    ? await Promise.all([
        db.select({ id: customer.id, title: customer.title, name: customer.name }).from(customer).where(inArray(customer.id, customerIds)),
        db.select({ customerId: customerCompany.customerId, name: customerOrganization.name })
          .from(customerCompany)
          .innerJoin(customerOrganization, eq(customerOrganization.id, customerCompany.customerOrganizationId))
          .where(inArray(customerCompany.customerId, customerIds)),
      ])
    : [[], []];

  // step 1: the organization (rows are newest first, and keep that order: a tie later goes to the newer quotation)
  const doc = indexDoc(text);
  const sameOrg = rows
    .map((r): MatchCandidate => {
      const c = custRows.find((x) => x.id === r.customerId);
      const snapOrg = (r.snap as { organizationName?: string } | null)?.organizationName;
      return {
        id: r.id,
        quotationNo: r.quotationNo,
        grandTotal: r.grandTotal,
        customerName: (c ? [c.title, c.name].filter(Boolean).join(" ") : "") || null,
        orgNames: [...orgRows.filter((o) => o.customerId === r.customerId).map((o) => o.name), ...(snapOrg ? [snapOrg] : [])],
        items: [],
        cpoCount: 0,
      };
    })
    .filter((c) => orgMatches(doc, c));
  if (sameOrg.length === 0) return NONE;

  // step 2: the items of those quotations only, then the score
  const ids = sameOrg.map((c) => c.id);
  const chunks = Array.from({ length: Math.ceil(ids.length / CHUNK) }, (_, i) => ids.slice(i * CHUNK, (i + 1) * CHUNK));
  const itemRows = (await Promise.all(chunks.map((ch) =>
    db.select({ quotationId: quotationItem.quotationId, productCode: quotationItem.productCode, description: quotationItem.description, unitPrice: quotationItem.unitPrice })
      .from(quotationItem).where(inArray(quotationItem.quotationId, ch)),
  ))).flat();
  for (const c of sameOrg) {
    c.items = itemRows.filter((i) => i.quotationId === c.id).map((i) => ({ productCode: i.productCode, description: i.description, unitPrice: i.unitPrice }));
  }
  // the best 5, plus (when the PO is spread over several quotations) the ones that cover it together
  const { suggestions: scored, combination } = rankWithCombination(text, sameOrg, 5, lines);
  if (scored.length === 0) return NONE;

  // how many customer POs each suggested quotation already has (a warning against recording the same PO twice)
  const cpoCounts = await db.select({ quotationId: customerPurchaseOrder.quotationId, cnt: count() }).from(customerPurchaseOrder)
    .where(and(inArray(customerPurchaseOrder.organizationId, ownerOrgIds), inArray(customerPurchaseOrder.quotationId, scored.map((s) => s.id)), notInArray(customerPurchaseOrder.status, ["cancelled", "draft"])))
    .groupBy(customerPurchaseOrder.quotationId);
  return { suggestions: scored.map((s) => ({ ...s, cpoCount: cpoCounts.find((x) => x.quotationId === s.id)?.cnt ?? 0 })), combination };
}
