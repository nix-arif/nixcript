import { db } from "@/db";
import { quotation, quotationItem, customer, customerCompany, customerOrganization, customerPurchaseOrder } from "@/db/schema";
import { and, desc, eq, inArray, notInArray, count } from "drizzle-orm";
import { getOwnerOrgIds } from "@/lib/org/owner-orgs";
import { rankSuggestions, type DocLine, type MatchCandidate, type Suggestion } from "@/lib/customer-po/quotation-match";

const MAX_QUOTATIONS = 3000; // the most recent final quotations of the owner's companies
const CHUNK = 1000;          // ids per item query

// The final quotations (of the owner's organizations) that the document could belong to.
// Every quotation is scored on everything at once: its number, total and customer, AND its items. Items used to be
// looked at only for quotations that already showed another sign (the total, the customer's name), so a PO for a few
// lines of a bigger quotation, from a customer named a little differently, was never matched however well its lines
// agreed. The items are one light query (code, description, price), and the scoring compares whole words, so this
// stays quick on a long quotation history.
export async function findMatchingQuotations(orgId: string, text: string, lines: DocLine[] = []): Promise<Suggestion[]> {
  const ownerOrgIds = await getOwnerOrgIds(orgId);
  const rows = await db
    .select({ id: quotation.id, quotationNo: quotation.quotationNo, grandTotal: quotation.grandTotal, customerId: quotation.customerId, snap: quotation.customerSnapshot })
    .from(quotation)
    .where(and(inArray(quotation.organizationId, ownerOrgIds), eq(quotation.status, "final"), eq(quotation.isDummy, 0)))
    .orderBy(desc(quotation.createdAt))
    .limit(MAX_QUOTATIONS);
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const customerIds = [...new Set(rows.map((r) => r.customerId).filter((v): v is string => !!v))];
  const chunks = Array.from({ length: Math.ceil(ids.length / CHUNK) }, (_, i) => ids.slice(i * CHUNK, (i + 1) * CHUNK));
  const [custRows, orgRows, itemRows] = await Promise.all([
    customerIds.length ? db.select({ id: customer.id, title: customer.title, name: customer.name }).from(customer).where(inArray(customer.id, customerIds)) : [],
    customerIds.length
      ? db.select({ customerId: customerCompany.customerId, name: customerOrganization.name })
          .from(customerCompany)
          .innerJoin(customerOrganization, eq(customerOrganization.id, customerCompany.customerOrganizationId))
          .where(inArray(customerCompany.customerId, customerIds))
      : [],
    Promise.all(chunks.map((c) =>
      db.select({ quotationId: quotationItem.quotationId, productCode: quotationItem.productCode, description: quotationItem.description, unitPrice: quotationItem.unitPrice })
        .from(quotationItem).where(inArray(quotationItem.quotationId, c)),
    )).then((r) => r.flat()),
  ]);

  const itemsOf = new Map<string, MatchCandidate["items"]>();
  for (const i of itemRows) {
    const list = itemsOf.get(i.quotationId) ?? [];
    list.push({ productCode: i.productCode, description: i.description, unitPrice: i.unitPrice });
    itemsOf.set(i.quotationId, list);
  }

  const candidates = rows
    .map((r): MatchCandidate => {
      const c = custRows.find((x) => x.id === r.customerId);
      const snapOrg = (r.snap as { organizationName?: string } | null)?.organizationName;
      return {
        id: r.id,
        quotationNo: r.quotationNo,
        grandTotal: r.grandTotal,
        customerName: (c ? [c.title, c.name].filter(Boolean).join(" ") : "") || null,
        orgNames: [...orgRows.filter((o) => o.customerId === r.customerId).map((o) => o.name), ...(snapOrg ? [snapOrg] : [])],
        items: itemsOf.get(r.id) ?? [],
        cpoCount: 0,
      };
    });
  // rows are newest first, so a tie goes to the newer quotation (a revision over the one it replaced)
  const scored = rankSuggestions(text, candidates, 5, lines);
  if (scored.length === 0) return [];

  // how many customer POs each suggested quotation already has (a warning against recording the same PO twice)
  const cpoCounts = await db.select({ quotationId: customerPurchaseOrder.quotationId, cnt: count() }).from(customerPurchaseOrder)
    .where(and(inArray(customerPurchaseOrder.organizationId, ownerOrgIds), inArray(customerPurchaseOrder.quotationId, scored.map((s) => s.id)), notInArray(customerPurchaseOrder.status, ["cancelled", "draft"])))
    .groupBy(customerPurchaseOrder.quotationId);
  return scored.map((s) => ({ ...s, cpoCount: cpoCounts.find((x) => x.quotationId === s.id)?.cnt ?? 0 }));
}
