import { db } from "@/db";
import { quotation, quotationItem, customer, customerCompany, customerOrganization, customerPurchaseOrder } from "@/db/schema";
import { and, desc, eq, inArray, notInArray, count } from "drizzle-orm";
import { getOwnerOrgIds } from "@/lib/org/owner-orgs";
import { numbersIn, quickSignals, rankSuggestions, type MatchCandidate } from "@/lib/customer-po/quotation-match";

// The final quotations (of the owner's organizations) that the document text could belong to.
// Two steps, so a big quotation history stays quick: first a light look at every quotation (number, total, customer), then
// only the ones that show some sign get their items loaded and scored.
export async function findMatchingQuotations(orgId: string, text: string) {
  const ownerOrgIds = await getOwnerOrgIds(orgId);
  const rows = await db
    .select({ id: quotation.id, quotationNo: quotation.quotationNo, grandTotal: quotation.grandTotal, customerId: quotation.customerId, snap: quotation.customerSnapshot })
    .from(quotation)
    .where(and(inArray(quotation.organizationId, ownerOrgIds), eq(quotation.status, "final"), eq(quotation.isDummy, 0)))
    .orderBy(desc(quotation.createdAt))
    .limit(3000);
  if (rows.length === 0) return [];

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

  const light: MatchCandidate[] = rows.map((r) => {
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
  });

  const nums = numbersIn(text);
  const weight = (s: ReturnType<typeof quickSignals>) => (s.ref ? 100 : 0) + (s.amount ? 25 : 0) + (s.org ? 15 : 0) + (s.person ? 10 : 0);
  const worthALook = light
    .map((c) => ({ c, w: weight(quickSignals(text, nums, c)) }))
    .filter((x) => x.w > 0)
    .sort((a, b) => b.w - a.w)
    .slice(0, 60)
    .map((x) => x.c);
  if (worthALook.length === 0) return [];

  const ids = worthALook.map((c) => c.id);
  const [items, cpoCounts] = await Promise.all([
    db.select({ quotationId: quotationItem.quotationId, productCode: quotationItem.productCode, description: quotationItem.description }).from(quotationItem).where(inArray(quotationItem.quotationId, ids)),
    db.select({ quotationId: customerPurchaseOrder.quotationId, cnt: count() }).from(customerPurchaseOrder)
      .where(and(inArray(customerPurchaseOrder.organizationId, ownerOrgIds), inArray(customerPurchaseOrder.quotationId, ids), notInArray(customerPurchaseOrder.status, ["cancelled", "draft"])))
      .groupBy(customerPurchaseOrder.quotationId),
  ]);
  const full = worthALook.map((c) => ({
    ...c,
    items: items.filter((i) => i.quotationId === c.id).map((i) => ({ productCode: i.productCode, description: i.description })),
    cpoCount: cpoCounts.find((x) => x.quotationId === c.id)?.cnt ?? 0,
  }));
  return rankSuggestions(text, full);
}
