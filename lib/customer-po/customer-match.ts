// Which quotations may be combined on one Customer PO.
//  - the same customer: yes
//  - a different customer in the same customer organization (e.g. two doctors of one hospital): yes, with a gentle warning
//  - a customer of another organization: no
// "Same organization" is decided by the organization's name, ignoring capitals, punctuation and extra spaces,
// because each customer record keeps its own copy of the organization (so the ids differ).

export const normOrgName = (n: string | null | undefined) =>
  (n ?? "").toLowerCase().replace(/[.,()]/g, " ").replace(/\s+/g, " ").trim();

export type CustomerRef = { customerId?: string | null; orgNames: (string | null | undefined)[] };
export type CustomerRelation = "same" | "same-organization" | "different";

export function customerRelation(primary: CustomerRef, other: CustomerRef): CustomerRelation {
  if (primary.customerId && other.customerId && primary.customerId === other.customerId) return "same";
  // no customer record on either side: only the organization can tell
  const a = new Set(primary.orgNames.map(normOrgName).filter(Boolean));
  const shared = other.orgNames.map(normOrgName).filter((n) => n && a.has(n));
  if (shared.length > 0) return "same-organization";
  return !primary.customerId && !other.customerId && a.size === 0 ? "same" : "different";
}

// The customer of one CPO line: the one saved on the line, else the customer of the CPO as a whole (older CPOs)
export function itemCustomer(
  item: { customerId?: string | null; customerName?: string | null; customerOrganization?: string | null; customerOrganizationId?: string | null },
  cpo: { customerId?: string | null; customerSnapshot?: { title?: string; name?: string; organizationName?: string } | null },
) {
  if (item.customerName || item.customerId) {
    return { customerId: item.customerId ?? "", customerName: item.customerName ?? "", customerOrganization: item.customerOrganization ?? "", customerOrganizationId: item.customerOrganizationId ?? "" };
  }
  const s = cpo.customerSnapshot;
  return { customerId: cpo.customerId ?? "", customerName: [s?.title, s?.name].filter(Boolean).join(" "), customerOrganization: s?.organizationName ?? "", customerOrganizationId: "" };
}

// The wording of the gentle warning, for the quotations of other contacts
export function otherContactsNote(
  primaryName: string | null | undefined,
  org: string | null | undefined,
  others: { quotationNo: string; customerName?: string | null }[],
): string {
  const list = others.map((o) => `${o.quotationNo}${o.customerName ? ` (${o.customerName})` : ""}`).join(", ");
  return `${list} ${others.length === 1 ? "is" : "are"} for ${others.length === 1 ? "another contact" : "other contacts"}${org ? ` at ${org}` : ""}. This Customer PO is recorded under ${primaryName || "the first quotation's customer"}. Check that this is right.`;
}
