import { db } from "@/db";
import { member, stockLevel, user } from "@/db/schema";
import { and, eq, isNull, like, sql } from "drizzle-orm";

// A company's field stock (warehouse label "Field:<userId>") can only be held
// by its own people. Another company's person gets stock through consignment
// or a sale, never as a field transfer or adjustment on this company's books.

export async function isOrgMember(orgId: string, userId: string): Promise<boolean> {
  const [m] = await db.select({ id: member.id }).from(member)
    .where(and(eq(member.organizationId, orgId), eq(member.userId, userId), isNull(member.deletedAt))).limit(1);
  return !!m;
}

/**
 * Null when `label` may take this movement in `orgId`, else the reason. Stock
 * coming in must go to one of the company's own members; stock going out is
 * always allowed, so a balance left with someone who isn't a member (left the
 * company, or belongs elsewhere) can still be cleared.
 */
export async function fieldHolderProblem(orgId: string, label: string, incoming: boolean): Promise<string | null> {
  if (!label.startsWith("Field:") || !incoming) return null;
  const holderId = label.slice("Field:".length);
  if (await isOrgMember(orgId, holderId)) return null;
  const [u] = await db.select({ name: user.name }).from(user).where(eq(user.id, holderId)).limit(1);
  return `${u?.name ?? "This person"} isn't a member of this company — field stock can only be with your own people (use consignment or a sale for another company)`;
}

/** People outside the company who still hold field stock on its books — listed so the balance can be cleared. */
export async function nonMemberFieldHolders(orgId: string): Promise<{ id: string; name: string }[]> {
  const rows = await db.selectDistinct({ label: stockLevel.warehouseLabel }).from(stockLevel)
    .where(and(eq(stockLevel.organizationId, orgId), like(stockLevel.warehouseLabel, "Field:%"), sql`${stockLevel.quantity}::numeric <> 0`));
  const out: { id: string; name: string }[] = [];
  for (const r of rows) {
    const id = r.label.slice("Field:".length);
    if (await isOrgMember(orgId, id)) continue;
    const [u] = await db.select({ name: user.name }).from(user).where(eq(user.id, id)).limit(1);
    out.push({ id, name: u?.name ?? id });
  }
  return out;
}
