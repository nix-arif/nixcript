// Human names for the coded stock locations, so no screen shows raw ids:
//   Field:<user>                      → Field stock — Zilarahim
//   Field:<user>:Consigned:<org>      → Field stock — Zilarahim (consigned from Smart Innosys)
//   CS:ORG:<org>                      → Consigned → Affirma Sdn Bhd
//   CS:ORG:<org>:REP:<user>           → Consigned → Affirma Sdn Bhd · Zilarahim
//   CS:CUST:<hospital>                → Consigned → Hospital Sungai Buloh
//   CS:EXT:<partner>                  → Consigned → Test Dealer Sdn Bhd (dealer)
//
// Server-only (reads names); pages pass the map to their client components.

import { db } from "@/db";
import { consignHeader, consignPartner, customerOrganization, organization, stockLevel, stockMovement, user } from "@/db/schema";
import { and, inArray, like, or } from "drizzle-orm";
import { parseLocation } from "@/lib/consignment/labels";

/** Names for every coded location the given companies' stock has been at. */
export async function getLocationNames(orgIds: string[], extraLabels: string[] = []): Promise<Record<string, string>> {
  if (!orgIds.length) return {};
  const coded = (col: typeof stockLevel.warehouseLabel) => or(like(col, "CS:%"), like(col, "Field:%"));
  const [levels, headers, moves] = await Promise.all([
    db.selectDistinct({ l: stockLevel.warehouseLabel }).from(stockLevel).where(and(inArray(stockLevel.organizationId, orgIds), coded(stockLevel.warehouseLabel))),
    db.selectDistinct({ l: consignHeader.locationLabel }).from(consignHeader).where(or(inArray(consignHeader.organizationId, orgIds), inArray(consignHeader.agentOrgId, orgIds))),
    db.selectDistinct({ l: stockMovement.warehouseLabel }).from(stockMovement).where(and(inArray(stockMovement.organizationId, orgIds), like(stockMovement.warehouseLabel, "CS:%"))),
  ]);
  const labels = [...new Set([...levels, ...headers, ...moves].map((r) => r.l).concat(extraLabels).filter((l) => l && (l.startsWith("CS:") || l.startsWith("Field:"))))];
  return nameLocations(labels);
}

/** Resolve names for specific coded labels. */
export async function nameLocations(labels: string[]): Promise<Record<string, string>> {
  const orgIds = new Set<string>(), userIds = new Set<string>(), hospIds = new Set<string>(), partnerIds = new Set<string>();
  for (const l of labels) {
    const p = parseLocation(l);
    if (p?.kind === "agent") orgIds.add(p.agentOrgId);
    else if (p?.kind === "agent-rep") { orgIds.add(p.agentOrgId); userIds.add(p.repUserId); }
    else if (p?.kind === "customer") hospIds.add(p.customerOrgId);
    else if (p?.kind === "partner") partnerIds.add(p.partnerId);
    else if (l.startsWith("Field:")) {
      const [rep, , src] = l.slice("Field:".length).split(":");
      if (rep) userIds.add(rep);
      if (src) orgIds.add(src);
    }
  }
  const [orgs, users, hosps, partners] = await Promise.all([
    orgIds.size ? db.select({ id: organization.id, name: organization.name }).from(organization).where(inArray(organization.id, [...orgIds])) : [],
    userIds.size ? db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, [...userIds])) : [],
    hospIds.size ? db.select({ id: customerOrganization.id, name: customerOrganization.name }).from(customerOrganization).where(inArray(customerOrganization.id, [...hospIds])) : [],
    partnerIds.size ? db.select({ id: consignPartner.id, name: consignPartner.name, model: consignPartner.model }).from(consignPartner).where(inArray(consignPartner.id, [...partnerIds])) : [],
  ]);
  const org = new Map(orgs.map((o) => [o.id, o.name])), usr = new Map(users.map((u) => [u.id, u.name]));
  const hosp = new Map(hosps.map((h) => [h.id, h.name])), ptn = new Map(partners.map((p) => [p.id, p]));
  const out: Record<string, string> = {};
  for (const l of labels) {
    const p = parseLocation(l);
    if (p?.kind === "agent") out[l] = `Consigned → ${org.get(p.agentOrgId) ?? "another company"}`;
    else if (p?.kind === "agent-rep") out[l] = `Consigned → ${org.get(p.agentOrgId) ?? "another company"} · ${usr.get(p.repUserId) ?? "specialist"}`;
    else if (p?.kind === "customer") out[l] = `Consigned → ${hosp.get(p.customerOrgId) ?? "hospital"}`;
    else if (p?.kind === "partner") { const x = ptn.get(p.partnerId); out[l] = `Consigned → ${x?.name ?? "external agent"}${x ? ` (${x.model === "dealer" ? "dealer" : "sales agent"})` : ""}`; }
    else if (l.startsWith("Field:")) {
      const [rep, , src] = l.slice("Field:".length).split(":");
      out[l] = `Field stock — ${usr.get(rep) ?? rep}${src ? ` (consigned from ${org.get(src) ?? "another company"})` : ""}`;
    }
  }
  return out;
}
