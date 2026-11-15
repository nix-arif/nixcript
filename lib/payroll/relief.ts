// Works out each employee's yearly tax relief from what HR configured
// (Payslip Settings → Tax relief, and the employee's own amounts).
import { db } from "@/db";
import { taxReliefType, employeeTaxRelief } from "@/db/schema";
import { and, asc, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";

export type EmployeeRelief = {
  fixed: number; // yearly relief in RM (everything except the EPF-linked one)
  epfCap: number | null; // yearly cap for the EPF-linked relief, null = not claimed
};

// Defaults created the first time an organization opens the settings.
// "Individual" applies to everyone, matching what PCB assumed before.
const DEFAULT_TYPES = [
  { name: "Individual", defaultAmount: "9000", maxAmount: null, appliesToAll: true, linkEpf: false },
  { name: "Spouse", defaultAmount: "4000", maxAmount: "4000", appliesToAll: false, linkEpf: false },
  { name: "Children", defaultAmount: "2000", maxAmount: null, appliesToAll: false, linkEpf: false },
  { name: "EPF contributions", defaultAmount: "4000", maxAmount: "4000", appliesToAll: false, linkEpf: true },
  { name: "Life insurance / takaful", defaultAmount: "3000", maxAmount: "3000", appliesToAll: false, linkEpf: false },
  { name: "Medical, education & lifestyle", defaultAmount: "0", maxAmount: "10000", appliesToAll: false, linkEpf: false },
] as const;

export async function ensureReliefTypes(orgId: string) {
  const have = await db.select({ id: taxReliefType.id }).from(taxReliefType).where(eq(taxReliefType.organizationId, orgId)).limit(1);
  if (have.length) return;
  await db
    .insert(taxReliefType)
    .values(DEFAULT_TYPES.map((t, i) => ({ id: nanoid(), organizationId: orgId, ...t, sortOrder: i })))
    .onConflictDoNothing();
}

export async function resolveReliefs(orgId: string, userIds: string[]): Promise<Map<string, EmployeeRelief>> {
  await ensureReliefTypes(orgId);
  const types = await db
    .select()
    .from(taxReliefType)
    .where(and(eq(taxReliefType.organizationId, orgId), eq(taxReliefType.isActive, true)))
    .orderBy(asc(taxReliefType.sortOrder));
  const rows = userIds.length
    ? await db
        .select()
        .from(employeeTaxRelief)
        .where(and(eq(employeeTaxRelief.organizationId, orgId), inArray(employeeTaxRelief.userId, userIds)))
    : [];
  const out = new Map<string, EmployeeRelief>();
  for (const uid of userIds) {
    let fixed = 0;
    let epfCap: number | null = null;
    for (const t of types) {
      const own = rows.find((r) => r.userId === uid && r.reliefTypeId === t.id);
      let amount = own ? Number(own.amount) : t.appliesToAll ? Number(t.defaultAmount) : 0;
      if (t.maxAmount !== null) amount = Math.min(amount, Number(t.maxAmount));
      if (!(amount > 0)) continue;
      if (t.linkEpf) epfCap = (epfCap ?? 0) + amount;
      else fixed += amount;
    }
    out.set(uid, { fixed, epfCap });
  }
  return out;
}
