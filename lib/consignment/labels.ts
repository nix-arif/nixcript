// Consignment locations (model B): consigned stock stays on the OWNER's books
// — stock_level / stock_lot rows keep organization_id = owner — and the
// warehouse label says where it physically is. Pure helpers, safe to import
// from client and server code.
//
//   CS:ORG:<agentOrgId>               at an agent company's warehouse
//   CS:ORG:<agentOrgId>:REP:<userId>  with one of the agent's specialists
//   CS:CUST:<customerOrgId>           at a customer site (hospital)
//   CS:EXT:<partnerId>                with an external agent (dealer / sales agent)
//
// Deliberately NOT prefixed "Field:" — field-stock code treats "Field:*" as
// the specialist's own company stock; consigned stock with a specialist is
// read through consignment queries (and shown on Field Stock grouped by owner).

export const CS_PREFIX = "CS:";

export const agentLocation = (agentOrgId: string) => `CS:ORG:${agentOrgId}`;
export const agentRepLocation = (agentOrgId: string, repUserId: string) => `CS:ORG:${agentOrgId}:REP:${repUserId}`;
export const customerLocation = (customerOrgId: string) => `CS:CUST:${customerOrgId}`;
export const partnerLocation = (partnerId: string) => `CS:EXT:${partnerId}`;

export const isConsignmentLocation = (label: string) => label.startsWith(CS_PREFIX);

export type ParsedLocation =
  | { kind: "agent"; agentOrgId: string }
  | { kind: "agent-rep"; agentOrgId: string; repUserId: string }
  | { kind: "customer"; customerOrgId: string }
  | { kind: "partner"; partnerId: string };

export function parseLocation(label: string): ParsedLocation | null {
  const rep = /^CS:ORG:([^:]+):REP:([^:]+)$/.exec(label);
  if (rep) return { kind: "agent-rep", agentOrgId: rep[1], repUserId: rep[2] };
  const org = /^CS:ORG:([^:]+)$/.exec(label);
  if (org) return { kind: "agent", agentOrgId: org[1] };
  const cust = /^CS:CUST:([^:]+)$/.exec(label);
  if (cust) return { kind: "customer", customerOrgId: cust[1] };
  const ext = /^CS:EXT:([^:]+)$/.exec(label);
  if (ext) return { kind: "partner", partnerId: ext[1] };
  return null;
}
