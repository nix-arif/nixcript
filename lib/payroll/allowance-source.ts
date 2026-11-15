// Case allowances on a payslip come from the Allowance module
// (invoice_allowance). Plain server module — NOT a "use server" file — so these
// helpers can't be called from the browser; callers do the permission checks.
import { db } from "@/db";
import { invoiceAllowance, member, commissionType } from "@/db/schema";
import { and, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";

export type AllowanceCandidate = {
  id: string;
  invoiceNo: string;
  categoryName: string;
  role: string;
  dayType: string;
  rate: string;
  amount: string;
  caseDate: Date | null;
  linked: boolean; // already included in this payslip
  inPeriod: boolean; // case date falls in the payroll month (false = earlier, unpaid)
  commissionTypeId: string | null;
};

// Allowances can come from any invoice in the owner's org group
async function ownerOrgIds(orgId: string): Promise<string[]> {
  const [ownerRow] = await db
    .select({ userId: member.userId })
    .from(member)
    .where(and(eq(member.organizationId, orgId), eq(member.role, "owner")))
    .limit(1);
  if (!ownerRow) return [orgId];
  const rows = await db
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(and(eq(member.userId, ownerRow.userId), eq(member.role, "owner")));
  return [...new Set([orgId, ...rows.map((r) => r.organizationId)])];
}

// Commission types in the owner's org group that count as the same type as
// `typeId` (matched by name, since a covering person's earnings can come from a
// sibling org's invoice and its own copy of the type).
export async function matchingCommissionTypeIds(orgId: string, typeId: string): Promise<string[]> {
  const [t] = await db
    .select({ name: commissionType.name })
    .from(commissionType)
    .where(eq(commissionType.id, typeId))
    .limit(1);
  if (!t) return [];
  const orgIds = await ownerOrgIds(orgId);
  const rows = await db
    .select({ id: commissionType.id, name: commissionType.name })
    .from(commissionType)
    .where(inArray(commissionType.organizationId, orgIds));
  return rows.filter((r) => r.name.toLowerCase() === t.name.toLowerCase()).map((r) => r.id);
}

/**
 * Pending allowances the employee can be paid in this period: not yet on a
 * payslip. scope "month" = case date within the period's month; "upTo" also
 * includes earlier unpaid ones. Rows already on `payslipId` are always included
 * when editing.
 */
export async function listAllowanceCandidates(args: {
  orgId: string;
  userId: string;
  month: number;
  year: number;
  payslipId?: string | null;
  scope?: "month" | "upTo";
  commissionTypeIds: string[]; // only earnings of these commission types
}): Promise<AllowanceCandidate[]> {
  if (args.commissionTypeIds.length === 0) return [];
  const orgIds = await ownerOrgIds(args.orgId);
  const startOfMonth = new Date(Date.UTC(args.year, args.month - 1, 1));
  const endExclusive = new Date(Date.UTC(args.year, args.month, 1)); // first day of next month
  const inMonth = or(
    isNull(invoiceAllowance.caseDate),
    and(gte(invoiceAllowance.caseDate, startOfMonth), lt(invoiceAllowance.caseDate, endExclusive)),
  );
  const open = and(
    eq(invoiceAllowance.status, "pending"),
    isNull(invoiceAllowance.payslipId),
    args.scope === "upTo"
      ? or(isNull(invoiceAllowance.caseDate), lt(invoiceAllowance.caseDate, endExclusive))
      : inMonth,
  );
  const rows = await db
    .select({
      id: invoiceAllowance.id,
      invoiceNo: invoiceAllowance.invoiceNo,
      categoryName: invoiceAllowance.categoryName,
      role: invoiceAllowance.role,
      dayType: invoiceAllowance.dayType,
      rate: invoiceAllowance.rate,
      amount: invoiceAllowance.amount,
      caseDate: invoiceAllowance.caseDate,
      commissionTypeId: invoiceAllowance.commissionTypeId,
      payslipId: invoiceAllowance.payslipId,
    })
    .from(invoiceAllowance)
    .where(
      and(
        inArray(invoiceAllowance.organizationId, orgIds),
        eq(invoiceAllowance.userId, args.userId),
        inArray(invoiceAllowance.commissionTypeId, args.commissionTypeIds),
        args.payslipId ? or(open, eq(invoiceAllowance.payslipId, args.payslipId)) : open,
      ),
    )
    .orderBy(sql`${invoiceAllowance.caseDate} asc nulls last`);
  return rows.map(({ payslipId, ...r }) => ({
    ...r,
    linked: !!args.payslipId && payslipId === args.payslipId,
    inPeriod: !r.caseDate || (r.caseDate >= startOfMonth && r.caseDate < endExclusive),
  }));
}

/** Reserve exactly `ids` for the payslip (and release any others it held). */
export async function linkAllowancesToPayslip(args: {
  payslipId: string;
  orgId: string;
  userId: string;
  ids: string[];
}) {
  const orgIds = await ownerOrgIds(args.orgId);
  // release rows no longer selected
  await db
    .update(invoiceAllowance)
    .set({ payslipId: null })
    .where(
      and(
        eq(invoiceAllowance.payslipId, args.payslipId),
        args.ids.length ? sql`${invoiceAllowance.id} not in (${sql.join(args.ids.map((i) => sql`${i}`), sql`, `)})` : undefined,
      ),
    );
  if (!args.ids.length) return;
  await db
    .update(invoiceAllowance)
    .set({ payslipId: args.payslipId })
    .where(
      and(
        inArray(invoiceAllowance.id, args.ids),
        inArray(invoiceAllowance.organizationId, orgIds),
        eq(invoiceAllowance.userId, args.userId),
        eq(invoiceAllowance.status, "pending"),
        or(isNull(invoiceAllowance.payslipId), eq(invoiceAllowance.payslipId, args.payslipId)),
      ),
    );
}
