import { db } from "@/db";
import { member } from "@/db/schema";
import { and, eq, inArray, isNull, ne, type SQL } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";

/**
 * Document numbers (DO / INV / PO / SO) must be unique across every company
 * with the same owner — not just within one company. The DB's unique indexes
 * are per company, and sibling companies can share a numbering prefix (e.g.
 * Affirma was once configured with Smart Innosys's "SI"), which produced the
 * same DOSI/26-0309 in two companies.
 */

/** Every company owned by the owner of `orgId` (just `orgId` if none). */
export async function getOrgGroupIds(orgId: string): Promise<string[]> {
  const [owner] = await db
    .select({ userId: member.userId })
    .from(member)
    .where(and(eq(member.organizationId, orgId), eq(member.role, "owner"), isNull(member.deletedAt)))
    .limit(1);
  if (!owner) return [orgId];
  const owned = await db
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(and(eq(member.userId, owner.userId), eq(member.role, "owner"), isNull(member.deletedAt)));
  const ids = [...new Set(owned.map((o) => o.organizationId))];
  return ids.length ? ids : [orgId];
}

interface NumberedTable {
  table: PgTable;
  id: AnyPgColumn;
  organizationId: AnyPgColumn;
  number: AnyPgColumn;
}

/** True when `docNo` is already used by another document in the org group. */
export async function isDocNoTakenInGroup(
  t: NumberedTable,
  orgId: string,
  docNo: string,
  excludeId?: string,
): Promise<boolean> {
  const groupIds = await getOrgGroupIds(orgId);
  const conds: SQL[] = [inArray(t.organizationId, groupIds), eq(t.number, docNo)];
  if (excludeId) conds.push(ne(t.id, excludeId));
  const [hit] = await db.select({ id: t.id }).from(t.table).where(and(...conds)).limit(1);
  return !!hit;
}

/**
 * Starting at `firstNo`, return the first sequence number whose formatted
 * document number isn't used anywhere in the org group. Callers store the
 * returned `seq` as their counter so the skip is permanent.
 */
export async function nextFreeDocNo(
  t: NumberedTable,
  orgId: string,
  firstNo: number,
  format: (seq: number) => string,
): Promise<{ seq: number; docNo: string }> {
  let seq = firstNo;
  // Bounded: a gap this long means a misconfigured prefix/counter, which is
  // better surfaced than silently skipped forever.
  for (let i = 0; i < 1000; i++, seq++) {
    const docNo = format(seq);
    if (!(await isDocNoTakenInGroup(t, orgId, docNo))) return { seq, docNo };
  }
  throw new Error(`Could not find a free document number after ${format(firstNo)} — check the numbering settings`);
}
