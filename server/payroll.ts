"use server";

import { db } from "@/db";
import { payrollPeriod, payslip, member, profile, user, payItem, payslipLine, salaryStructure, salaryStructureItem, invoiceAllowance, commissionType, payrollPeriodRecall, employeeTaxRelief, taxReliefType } from "@/db/schema";
import { revalidatePath } from "next/cache";
import { getCachedSession } from "@/lib/auth/cached-session";
import { nanoid } from "nanoid";
import { eq, and, or, desc, sql, asc, lte, inArray, isNull } from "drizzle-orm";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";
import { assertSelfActionAllowed } from "@/lib/approvals/guard";
import { notifyUsersWithPermission, createNotification } from "@/server/notifications";
import { buildPayslip, type LineInput, type PayItemDef } from "@/lib/payroll/build-lines";
import { resolveReliefs } from "@/lib/payroll/relief";
import { siblingOrgs } from "@/lib/org/sibling-orgs";
import { listAllowanceCandidates, linkAllowancesToPayslip, matchingCommissionTypeIds } from "@/lib/payroll/allowance-source";

async function linesFor(payslipIds: string[]) {
  if (!payslipIds.length) return new Map<string, (typeof payslipLine.$inferSelect)[]>();
  const rows = await db
    .select()
    .from(payslipLine)
    .where(inArray(payslipLine.payslipId, payslipIds))
    .orderBy(asc(payslipLine.sortOrder), asc(payslipLine.label));
  const m = new Map<string, (typeof payslipLine.$inferSelect)[]>();
  for (const r of rows) {
    const a = m.get(r.payslipId) ?? [];
    a.push(r);
    m.set(r.payslipId, a);
  }
  return m;
}

async function getItemDefs(orgId: string): Promise<PayItemDef[]> {
  await ensureSystemPayItems(orgId);
  return db.select().from(payItem).where(eq(payItem.organizationId, orgId));
}

// Commission items take their amount from Custom Commission earnings (the
// Allowance module), never from what the client sent: resolve the selected rows
// per item and sum them here.
async function resolveAllowanceInputs(args: {
  orgId: string;
  userId: string;
  month: number;
  year: number;
  payslipId?: string | null;
  items: (PayItemDef & { commissionTypeId?: string | null })[];
  inputs: LineInput[];
}) {
  const invoiceItems = new Map(
    args.items
      .filter((i) => i.calcType === "invoice_allowance" && i.kind === "earning")
      .map((i) => [i.id, i]),
  );
  if (!invoiceItems.size) return { inputs: args.inputs, allowanceIds: [] as string[] };

  const allowanceIds: string[] = [];
  const inputs: LineInput[] = [];
  for (const inp of args.inputs) {
    const item = inp.payItemId ? invoiceItems.get(inp.payItemId) : undefined;
    if (!item) {
      inputs.push(inp);
      continue;
    }
    const typeIds = item.commissionTypeId
      ? await matchingCommissionTypeIds(args.orgId, item.commissionTypeId)
      : [];
    const candidates = await listAllowanceCandidates({
      orgId: args.orgId,
      userId: args.userId,
      month: args.month,
      year: args.year,
      payslipId: args.payslipId,
      scope: "upTo", // a person may deliberately pick earlier unpaid rows
      commissionTypeIds: typeIds,
    });
    const byId = new Map(candidates.map((c) => [c.id, c]));
    // no explicit selection = this month's earnings (older unpaid ones must be picked on purpose)
    const chosen = (inp.sourceIds ?? candidates.filter((c) => c.inPeriod).map((c) => c.id))
      .map((id) => byId.get(id))
      .filter((c): c is NonNullable<typeof c> => !!c);
    allowanceIds.push(...chosen.map((c) => c.id));
    inputs.push({
      ...inp,
      amount: chosen.reduce((sum, c) => sum + Number(c.amount), 0),
      quantity: String(chosen.length),
      rate: undefined,
    });
  }
  return { inputs, allowanceIds };
}

async function getSession() {
  const session = await getCachedSession();
  if (!session) throw new Error("You must be signed in to continue");
  const orgId = session.session.activeOrganizationId;
  if (!orgId) throw new Error("No active organization");
  return { session, orgId, userId: session.user.id };
}

async function requireAccess(permission: string) {
  const { session, orgId, userId } = await getSession();
  const perms = await getUserPermissions(userId, orgId);
  if (!hasAccess(perms, permission)) throw new Error("You don't have permission to do this");
  return { session, orgId, userId };
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export async function getPayrollPeriods() {
  const { orgId } = await requireAccess("payslip:read:all");

  const periods = await db
    .select({
      id: payrollPeriod.id,
      month: payrollPeriod.month,
      year: payrollPeriod.year,
      label: payrollPeriod.label,
      status: payrollPeriod.status,
      createdBy: payrollPeriod.createdBy,
      approvedAt: payrollPeriod.approvedAt,
      publishedAt: payrollPeriod.publishedAt,
      createdAt: payrollPeriod.createdAt,
      payslipCount: sql<number>`count(${payslip.id})`,
      totalNetPay: sql<string>`coalesce(sum(${payslip.netPay}::numeric), 0)`,
      createdByName: user.name,
    })
    .from(payrollPeriod)
    .leftJoin(payslip, eq(payslip.periodId, payrollPeriod.id))
    .leftJoin(user, eq(user.id, payrollPeriod.createdBy))
    .where(eq(payrollPeriod.organizationId, orgId))
    .groupBy(payrollPeriod.id, user.name)
    .orderBy(desc(payrollPeriod.year), desc(payrollPeriod.month));

  return periods;
}

export async function createPayrollPeriod(month: number, year: number) {
  const { orgId, userId } = await requireAccess("payslip:create");

  const label = `${MONTHS[month - 1]} ${year}`;

  const [existing] = await db
    .select()
    .from(payrollPeriod)
    .where(
      and(
        eq(payrollPeriod.organizationId, orgId),
        eq(payrollPeriod.month, month),
        eq(payrollPeriod.year, year),
      ),
    )
    .limit(1);

  if (existing) throw new Error(`Payroll period for ${label} already exists`);

  const [period] = await db
    .insert(payrollPeriod)
    .values({
      id: nanoid(),
      organizationId: orgId,
      month,
      year,
      label,
      status: "draft",
      createdBy: userId,
    })
    .returning();

  await notifyUsersWithPermission(orgId, "payslip:approve", {
    type: "payroll:submitted",
    title: `Payroll period ${label} pending approval`,
    body: `Payroll period ${label} needs review`,
    link: `/dashboard/human-resources/payroll/${period.id}`,
  });

  return period;
}

// Used by multi-month Excel import: return the period for month/year,
// creating a draft one if it does not exist yet.
export async function ensurePayrollPeriod(month: number, year: number) {
  const { orgId, userId } = await requireAccess("payslip:create");
  if (!Number.isInteger(month) || month < 1 || month > 12)
    throw new Error("Invalid month");
  if (!Number.isInteger(year) || year < 2000 || year > 2100)
    throw new Error("Invalid year");

  const [existing] = await db
    .select()
    .from(payrollPeriod)
    .where(
      and(
        eq(payrollPeriod.organizationId, orgId),
        eq(payrollPeriod.month, month),
        eq(payrollPeriod.year, year),
      ),
    )
    .limit(1);
  if (existing) {
    if (existing.status === "published")
      throw new Error(`${existing.label} is already published`);
    return { id: existing.id, label: existing.label, created: false };
  }

  const label = `${MONTHS[month - 1]} ${year}`;
  const [period] = await db
    .insert(payrollPeriod)
    .values({
      id: nanoid(),
      organizationId: orgId,
      month,
      year,
      label,
      status: "draft",
      createdBy: userId,
    })
    .returning();
  return { id: period.id, label, created: true };
}

export async function approvePayrollPeriod(periodId: string) {
  const { orgId, userId } = await requireAccess("payslip:approve");

  const [period] = await db
    .select()
    .from(payrollPeriod)
    .where(
      and(
        eq(payrollPeriod.id, periodId),
        eq(payrollPeriod.organizationId, orgId),
      ),
    )
    .limit(1);

  if (!period) throw new Error("Period not found");
  if (period.status !== "draft")
    throw new Error("Only draft periods can be approved");
  await assertSelfActionAllowed(orgId, "payslip:approve", period.createdBy, userId, "approve");

  await db
    .update(payrollPeriod)
    .set({
      status: "approved",
      approvedBy: userId,
      approvedAt: new Date(),
    })
    .where(eq(payrollPeriod.id, periodId));
}

export async function publishPayrollPeriod(periodId: string) {
  const { orgId, userId } = await requireAccess("payslip:publish");

  const [period] = await db
    .select()
    .from(payrollPeriod)
    .where(
      and(
        eq(payrollPeriod.id, periodId),
        eq(payrollPeriod.organizationId, orgId),
      ),
    )
    .limit(1);

  if (!period) throw new Error("Period not found");
  if (period.status !== "approved")
    throw new Error("Period must be approved before publishing");

  // Publish the period
  await db
    .update(payrollPeriod)
    .set({ status: "published", publishedAt: new Date() })
    .where(eq(payrollPeriod.id, periodId));

  // Publish all payslips in this period
  await db
    .update(payslip)
    .set({ status: "published" })
    .where(eq(payslip.periodId, periodId));

  // Case allowances included in these payslips are now paid
  const ids = await db
    .select({ id: payslip.id })
    .from(payslip)
    .where(eq(payslip.periodId, periodId));
  if (ids.length)
    await db
      .update(invoiceAllowance)
      .set({ status: "paid", paidAt: new Date(), paidBy: userId })
      .where(
        and(
          inArray(invoiceAllowance.payslipId, ids.map((i) => i.id)),
          eq(invoiceAllowance.status, "pending"),
        ),
      );
}

// Take a published period back to draft so it can be corrected and published again.
// Employees stop seeing the payslips, and the commission earnings paid by them go
// back to pending (still reserved for the same payslips).
export async function recallPayrollPeriod(periodId: string, reason: string) {
  const { orgId, userId } = await requireAccess("payslip:recall");
  const why = reason?.trim();
  if (!why || why.length < 5) throw new Error("Give a reason (at least 5 characters)");
  if (why.length > 500) throw new Error("The reason is too long");

  const [period] = await db
    .select()
    .from(payrollPeriod)
    .where(and(eq(payrollPeriod.id, periodId), eq(payrollPeriod.organizationId, orgId)))
    .limit(1);
  if (!period) throw new Error("Period not found");
  if (period.status !== "published") throw new Error("Only a published period can be recalled");
  await assertSelfActionAllowed(orgId, "payslip:recall", period.createdBy, userId, "recall");

  const slips = await db
    .select({ id: payslip.id, userId: payslip.userId })
    .from(payslip)
    .where(eq(payslip.periodId, periodId));
  const ids = slips.map((s) => s.id);

  await db.batch([
    db
      .update(payrollPeriod)
      .set({ status: "draft", approvedBy: null, approvedAt: null, publishedAt: null })
      .where(eq(payrollPeriod.id, periodId)),
    db.update(payslip).set({ status: "draft" }).where(eq(payslip.periodId, periodId)),
    // Earnings paid out by this period become pending again (same reservation)
    db
      .update(invoiceAllowance)
      .set({ status: "pending", paidAt: null, paidBy: null })
      .where(
        and(
          inArray(invoiceAllowance.payslipId, ids.length ? ids : [""]),
          eq(invoiceAllowance.status, "paid"),
        ),
      ),
    db.insert(payrollPeriodRecall).values({
      id: nanoid(),
      periodId,
      organizationId: orgId,
      recalledBy: userId,
      reason: why,
      payslipCount: ids.length,
    }),
  ]);

  // Let employees know their payslip was withdrawn, and approvers know it needs redoing
  for (const s of slips) {
    await createNotification({
      organizationId: orgId,
      userId: s.userId,
      type: "payroll:recalled",
      title: `${period.label} payslip withdrawn`,
      body: "Your payslip is being corrected and will be published again.",
      link: "/dashboard/human-resources/payslips",
    });
  }
  await notifyUsersWithPermission(orgId, "payslip:approve", {
    type: "payroll:recalled",
    title: `Payroll period ${period.label} recalled`,
    body: why,
    link: `/dashboard/human-resources/payroll/${periodId}`,
  });
  revalidatePath(`/dashboard/human-resources/payroll/${periodId}`);
  revalidatePath("/dashboard/human-resources/payroll");
}

export async function deletePayrollPeriod(periodId: string) {
  const { orgId } = await requireAccess("payslip:create");

  const [period] = await db
    .select()
    .from(payrollPeriod)
    .where(
      and(
        eq(payrollPeriod.id, periodId),
        eq(payrollPeriod.organizationId, orgId),
      ),
    )
    .limit(1);

  if (!period) throw new Error("Period not found");
  if (period.status === "published")
    throw new Error("Cannot delete a published period");

  await db.delete(payrollPeriod).where(eq(payrollPeriod.id, periodId));
}

export async function getOrgMembers() {
  const { orgId } = await requireAccess("payslip:create");

  const members = await db
    .select({
      userId: member.userId,
      name: user.name,
      email: user.email,
      role: member.role,
      fullname: profile.fullname,
      jobTitle: profile.jobTitle,
      department: profile.department,
      icNumber: profile.icNumber,
      bankName: profile.bankName,
      bankAccountNo: profile.bankAccountNo,
      bankAccountHolder: profile.bankAccountHolder,
    })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .leftJoin(profile, eq(profile.userId, member.userId))
    .where(eq(member.organizationId, orgId))
    .orderBy(user.name);

  return members;
}

export async function getPeriodDetail(periodId: string) {
  const { orgId } = await requireAccess("payslip:read:all");

  const [period] = await db
    .select()
    .from(payrollPeriod)
    .where(
      and(
        eq(payrollPeriod.id, periodId),
        eq(payrollPeriod.organizationId, orgId),
      ),
    )
    .limit(1);

  if (!period) return null;

  const payslips = await db
    .select({
      id: payslip.id,
      userId: payslip.userId,
      employeeName: payslip.employeeName,
      jobTitle: payslip.jobTitle,
      department: payslip.department,
      basicSalary: payslip.basicSalary,
      grossPay: payslip.grossPay,
      totalDeductions: payslip.totalDeductions,
      netPay: payslip.netPay,
      status: payslip.status,
      bankName: payslip.bankName,
      bankAccountNo: payslip.bankAccountNo,
      bankAccountHolder: payslip.bankAccountHolder,
      taxableIncome: payslip.taxableIncome,
      icNumber: payslip.icNumber,
      epfNo: profile.epfNo,
      socsoNo: profile.socsoNo,
      employeeTaxNo: profile.taxNo,
    })
    .from(payslip)
    .leftJoin(profile, eq(profile.userId, payslip.userId))
    .where(eq(payslip.periodId, periodId))
    .orderBy(payslip.employeeName);

  const lineMap = await linesFor(payslips.map((p) => p.id));
  const payslipsWithLines = payslips.map((p) => ({ ...p, lines: lineMap.get(p.id) ?? [] }));

  const totalGross = payslips.reduce((s, p) => s + Number(p.grossPay), 0);
  const totalDeductions = payslips.reduce(
    (s, p) => s + Number(p.totalDeductions),
    0,
  );
  const totalNet = payslips.reduce((s, p) => s + Number(p.netPay), 0);

  return { period, payslips: payslipsWithLines, totalGross, totalDeductions, totalNet };
}

export async function getPayslipDetail(payslipId: string) {
  const { orgId } = await requireAccess("payslip:read:all");

  const [row] = await db
    .select()
    .from(payslip)
    .where(eq(payslip.id, payslipId))
    .limit(1);

  if (!row) return null;

  // Verify org access
  const [period] = await db
    .select()
    .from(payrollPeriod)
    .where(
      and(
        eq(payrollPeriod.id, row.periodId),
        eq(payrollPeriod.organizationId, orgId),
      ),
    )
    .limit(1);

  if (!period) return null;
  const lines = (await linesFor([row.id])).get(row.id) ?? [];
  return { payslip: { ...row, lines }, period };
}

type PayslipInput = {
  basicSalary: number;
  lines: LineInput[];
  manualLhdn?: number;
};
type CreatePayslipInput = PayslipInput & { periodId: string; userId: string };

export async function createPayslip(data: CreatePayslipInput) {
  const { orgId } = await requireAccess("payslip:create");
  await createPayslipInternal(orgId, data);
}

function cleanInputs(lines: LineInput[]): LineInput[] {
  return (lines ?? []).map((l) => {
    const amount = Number(l.amount);
    if (!(amount >= 0)) throw new Error("Invalid amount");
    return { ...l, amount, label: l.label?.slice(0, 120) };
  });
}

async function createPayslipInternal(orgId: string, data: CreatePayslipInput) {
  if (!(data.basicSalary > 0)) throw new Error("Basic salary is required");

  const [period] = await db
    .select()
    .from(payrollPeriod)
    .where(and(eq(payrollPeriod.id, data.periodId), eq(payrollPeriod.organizationId, orgId)))
    .limit(1);
  if (!period) throw new Error("Period not found");
  if (period.status === "published")
    throw new Error("Cannot add payslips to a published period");

  const [existing] = await db
    .select({ id: payslip.id })
    .from(payslip)
    .where(and(eq(payslip.periodId, data.periodId), eq(payslip.userId, data.userId)))
    .limit(1);
  if (existing)
    throw new Error("Payslip for this employee already exists in this period");

  // data.userId is client-supplied and `user` is a global, non-org-scoped
  // table — confirm the target is actually a member of this org first.
  const [targetMember] = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.userId, data.userId), eq(member.organizationId, orgId)))
    .limit(1);
  if (!targetMember) throw new Error("Employee is not a member of this organization");

  const [emp] = await db
    .select({
      name: user.name,
      fullname: profile.fullname,
      icNumber: profile.icNumber,
      jobTitle: profile.jobTitle,
      department: profile.department,
      employmentType: profile.employmentType,
      bankName: profile.bankName,
      bankAccountNo: profile.bankAccountNo,
      bankAccountHolder: profile.bankAccountHolder,
    })
    .from(user)
    .leftJoin(profile, eq(profile.userId, user.id))
    .where(eq(user.id, data.userId))
    .limit(1);
  if (!emp) throw new Error("Employee not found");

  const items = await getItemDefs(orgId);
  const resolved = await resolveAllowanceInputs({
    orgId,
    userId: data.userId,
    month: period.month,
    year: period.year,
    items,
    inputs: cleanInputs(data.lines),
  });
  const relief = (await resolveReliefs(orgId, [data.userId])).get(data.userId);
  const built = buildPayslip({
    basicSalary: data.basicSalary,
    month: period.month,
    items,
    inputs: resolved.inputs,
    manualPcb: data.manualLhdn,
    relief,
  });

  const id = nanoid();
  await db.insert(payslip).values({
    id,
    periodId: data.periodId,
    organizationId: orgId,
    userId: data.userId,
    employeeName: emp.fullname || emp.name,
    icNumber: emp.icNumber,
    jobTitle: emp.jobTitle,
    department: emp.department,
    employmentType: emp.employmentType,
    bankName: emp.bankName,
    bankAccountNo: emp.bankAccountNo,
    bankAccountHolder: emp.bankAccountHolder,
    basicSalary: String(data.basicSalary),
    grossPay: String(built.gross),
    totalDeductions: String(built.totalDeductions),
    netPay: String(built.netPay),
    taxableIncome: String(built.taxableIncome),
    status: "draft",
  });
  if (built.lines.length) {
    try {
      await db.insert(payslipLine).values(
        built.lines.map((l) => ({
          id: nanoid(),
          payslipId: id,
          payItemId: l.payItemId,
          code: l.code,
          kind: l.kind,
          label: l.label,
          quantity: l.quantity,
          rate: l.rate,
          amount: l.amount.toFixed(2),
          sortOrder: l.sortOrder,
        })),
      );
    } catch (e) {
      await db.delete(payslip).where(eq(payslip.id, id)); // don't leave a payslip without its lines
      throw e;
    }
  }
  if (resolved.allowanceIds.length)
    await linkAllowancesToPayslip({ payslipId: id, orgId, userId: data.userId, ids: resolved.allowanceIds });
}

export async function updatePayslip(payslipId: string, data: PayslipInput) {
  const { orgId } = await requireAccess("payslip:create");
  if (!(data.basicSalary > 0)) throw new Error("Basic salary is required");

  const [row] = await db
    .select({ periodId: payslip.periodId, userId: payslip.userId })
    .from(payslip)
    .where(and(eq(payslip.id, payslipId), eq(payslip.organizationId, orgId)))
    .limit(1);
  if (!row) throw new Error("Payslip not found");

  const [period] = await db
    .select()
    .from(payrollPeriod)
    .where(and(eq(payrollPeriod.id, row.periodId), eq(payrollPeriod.organizationId, orgId)))
    .limit(1);
  if (!period) throw new Error("Period not found");
  if (period.status === "published")
    throw new Error("Cannot edit payslips in a published period");

  const items = await getItemDefs(orgId);
  const resolved = await resolveAllowanceInputs({
    orgId,
    userId: row.userId,
    month: period.month,
    year: period.year,
    payslipId,
    items,
    inputs: cleanInputs(data.lines),
  });
  const relief = (await resolveReliefs(orgId, [row.userId])).get(row.userId);
  const built = buildPayslip({
    basicSalary: data.basicSalary,
    month: period.month,
    items,
    inputs: resolved.inputs,
    manualPcb: data.manualLhdn,
    relief,
  });

  // One atomic batch: replace the lines and update the totals together
  const ops = [
    db.delete(payslipLine).where(eq(payslipLine.payslipId, payslipId)),
    ...(built.lines.length
      ? [
          db.insert(payslipLine).values(
            built.lines.map((l) => ({
              id: nanoid(),
              payslipId,
              payItemId: l.payItemId,
              code: l.code,
              kind: l.kind,
              label: l.label,
              quantity: l.quantity,
              rate: l.rate,
              amount: l.amount.toFixed(2),
              sortOrder: l.sortOrder,
            })),
          ),
        ]
      : []),
    db
      .update(payslip)
      .set({
        basicSalary: String(data.basicSalary),
        grossPay: String(built.gross),
        totalDeductions: String(built.totalDeductions),
        netPay: String(built.netPay),
        taxableIncome: String(built.taxableIncome),
        updatedAt: new Date(),
      })
      .where(eq(payslip.id, payslipId)),
  ];
  await db.batch(ops as unknown as [(typeof ops)[0], ...(typeof ops)[number][]]);
  await linkAllowancesToPayslip({ payslipId, orgId, userId: row.userId, ids: resolved.allowanceIds });
}

// Earnings the form can offer for an employee in a period, tagged with the
// pay item that pays them out.
export async function getCaseAllowanceCandidates(
  userId: string,
  periodId: string,
  payslipId?: string | null,
  includeEarlier = false,
) {
  const { orgId } = await requireAccess("payslip:create");
  const [period] = await db
    .select()
    .from(payrollPeriod)
    .where(and(eq(payrollPeriod.id, periodId), eq(payrollPeriod.organizationId, orgId)))
    .limit(1);
  if (!period) throw new Error("Period not found");
  const [target] = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.organizationId, orgId)))
    .limit(1);
  if (!target) throw new Error("Employee is not a member of this organization");

  const items = await getItemDefs(orgId);
  const out: (Awaited<ReturnType<typeof listAllowanceCandidates>>[number] & { payItemId: string })[] = [];
  for (const item of items.filter((i) => i.calcType === "invoice_allowance" && i.kind === "earning")) {
    if (!item.commissionTypeId) continue;
    const typeIds = await matchingCommissionTypeIds(orgId, item.commissionTypeId);
    const rows = await listAllowanceCandidates({
      orgId,
      userId,
      month: period.month,
      year: period.year,
      payslipId,
      scope: includeEarlier ? "upTo" : "month",
      commissionTypeIds: typeIds,
    });
    out.push(...rows.map((r) => ({ ...r, payItemId: item.id })));
  }
  return out;
}

// Commission types a payslip item can pay out (for Payslip Settings)
export async function getCommissionTypeOptions() {
  const { orgId } = await requireAccess("payslip:create");
  return db
    .select({ id: commissionType.id, name: commissionType.name, isActive: commissionType.isActive })
    .from(commissionType)
    .where(eq(commissionType.organizationId, orgId))
    .orderBy(asc(commissionType.name));
}

export async function deletePayslip(payslipId: string) {
  const { orgId } = await requireAccess("payslip:create");

  const [row] = await db
    .select({ periodId: payslip.periodId })
    .from(payslip)
    .where(eq(payslip.id, payslipId))
    .limit(1);

  if (!row) throw new Error("Payslip not found");

  const [period] = await db
    .select()
    .from(payrollPeriod)
    .where(
      and(
        eq(payrollPeriod.id, row.periodId),
        eq(payrollPeriod.organizationId, orgId),
      ),
    )
    .limit(1);

  if (!period) throw new Error("Not found");
  if (period.status === "published")
    throw new Error("Cannot delete payslips in a published period");

  await db.delete(payslip).where(eq(payslip.id, payslipId));
}

export async function getMyPayslips() {
  const { orgId, userId } = await requireAccess("payslip:read:own");

  const rows = await db
    .select({
      id: payslip.id,
      periodId: payslip.periodId,
      userId: payslip.userId,
      employeeName: payslip.employeeName,
      jobTitle: payslip.jobTitle,
      department: payslip.department,
      icNumber: payslip.icNumber,
      bankName: payslip.bankName,
      bankAccountNo: payslip.bankAccountNo,
      bankAccountHolder: payslip.bankAccountHolder,
      basicSalary: payslip.basicSalary,
      grossPay: payslip.grossPay,
      totalDeductions: payslip.totalDeductions,
      netPay: payslip.netPay,
      taxableIncome: payslip.taxableIncome,
      status: payslip.status,
      periodLabel: payrollPeriod.label,
      periodMonth: payrollPeriod.month,
      periodYear: payrollPeriod.year,
      epfNo: profile.epfNo,
      socsoNo: profile.socsoNo,
      employeeTaxNo: profile.taxNo,
    })
    .from(payslip)
    .innerJoin(payrollPeriod, eq(payrollPeriod.id, payslip.periodId))
    .leftJoin(profile, eq(profile.userId, payslip.userId)) // ← must be here
    .where(and(eq(payslip.userId, userId), eq(payslip.organizationId, orgId), eq(payslip.status, "published")))
    .orderBy(desc(payrollPeriod.year), desc(payrollPeriod.month));

  const lineMap = await linesFor(rows.map((r) => r.id));
  return rows.map((r) => ({ ...r, lines: lineMap.get(r.id) ?? [] }));
}

// Helper to get owner org id — reuse from products
async function getOwnerOrgId(
  userId: string,
  currentOrgId: string,
): Promise<string> {
  const [ownerMember] = await db
    .select()
    .from(member)
    .where(
      and(eq(member.organizationId, currentOrgId), eq(member.role, "owner")),
    )
    .limit(1);

  if (!ownerMember) return currentOrgId;

  const [primaryOrg] = await db
    .select()
    .from(member)
    .where(and(eq(member.userId, ownerMember.userId), eq(member.role, "owner")))
    .orderBy(asc(member.createdAt))
    .limit(1);

  return primaryOrg?.organizationId ?? currentOrgId;
}

export async function getPayslipYtd(
  targetUserId: string,
  year: number,
  upToMonth: number,
  // Count this payslip even if its period isn't published yet (e.g. HR previewing a draft)
  includePayslipId?: string,
) {
  const { orgId, userId } = await getSession();

  // Pulling someone else's YTD requires the same permission that gates
  // seeing anyone's payslip beyond your own.
  if (targetUserId !== userId) {
    const perms = await getUserPermissions(userId, orgId);
    if (!hasAccess(perms, "payslip:read:all")) throw new Error("You don't have permission to do this");
  }

  const rows = await db
    .select({
      id: payslip.id,
      grossPay: payslip.grossPay,
      netPay: payslip.netPay,
      basicSalary: payslip.basicSalary,
      totalDeductions: payslip.totalDeductions,
      taxableIncome: payslip.taxableIncome,
    })
    .from(payslip)
    .innerJoin(payrollPeriod, eq(payrollPeriod.id, payslip.periodId))
    .where(
      and(
        eq(payslip.userId, targetUserId),
        eq(payrollPeriod.organizationId, orgId),
        includePayslipId
          ? or(eq(payslip.status, "published"), eq(payslip.id, includePayslipId))
          : eq(payslip.status, "published"),
        eq(payrollPeriod.year, year),
        lte(payrollPeriod.month, upToMonth),
      ),
    );

  const sum = (field: "grossPay" | "netPay" | "basicSalary" | "totalDeductions" | "taxableIncome") =>
    rows.reduce((s, r) => s + Number(r[field] ?? 0), 0);

  // Statutory totals come from the coded payslip lines
  const coded = rows.length
    ? await db
        .select({
          code: payslipLine.code,
          kind: payslipLine.kind,
          total: sql<string>`coalesce(sum(${payslipLine.amount}), 0)`,
        })
        .from(payslipLine)
        .where(
          and(
            inArray(payslipLine.payslipId, rows.map((r) => r.id)),
            sql`${payslipLine.code} is not null`,
          ),
        )
        .groupBy(payslipLine.code, payslipLine.kind)
    : [];
  // Year-to-date per payslip line, so each row can show its own YTD
  const lineTotals = rows.length
    ? await db
        .select({
          kind: payslipLine.kind,
          code: payslipLine.code,
          label: payslipLine.label,
          total: sql<string>`coalesce(sum(${payslipLine.amount}), 0)`,
        })
        .from(payslipLine)
        .where(inArray(payslipLine.payslipId, rows.map((r) => r.id)))
        .groupBy(payslipLine.kind, payslipLine.code, payslipLine.label)
    : [];
  const code = (c: string, kind: "deduction" | "employer") =>
    Number(coded.find((x) => x.code === c && x.kind === kind)?.total ?? 0);

  const ytdGross = sum("grossPay");
  const ytdEpfEmployee = code("epf", "deduction");

  return {
    ytdGross,
    ytdNet: sum("netPay"),
    ytdBasic: sum("basicSalary"),
    ytdEpfEmployee,
    ytdEpfEmployer: code("epf", "employer"),
    ytdSocsoEmployee: code("socso", "deduction"),
    ytdSocsoEmployer: code("socso", "employer"),
    ytdEisEmployee: code("eis", "deduction"),
    ytdEisEmployer: code("eis", "employer"),
    ytdLhdn: code("pcb", "deduction"),
    ytdTotalDeductions: sum("totalDeductions"),
    ytdLines: lineTotals.map((l) => ({ kind: l.kind, code: l.code, label: l.label, total: Number(l.total) })),
    // Taxable income (PCB base, before reliefs) added up over the year
    ytdTaxableIncome: sum("taxableIncome"),
  };
}


/* ── Pay items (HR setting) ──────────────────────────────────────── */

// Statutory deductions the payroll engine calculates; HR can rename or switch
// them off, but not delete them.
const STATUTORY_ITEMS = [
  { key: "epf", name: "EPF" },
  { key: "socso", name: "SOCSO" },
  { key: "eis", name: "EIS" },
  { key: "pcb", name: "PCB / LHDN" },
] as const;

// Default pay items for an org, created on first visit. Everything except the
// statutory deductions is an ordinary item HR can edit or delete.
async function ensureSystemPayItems(orgId: string) {
  const rows = await db
    .select({ name: payItem.name, systemKey: payItem.systemKey })
    .from(payItem)
    .where(eq(payItem.organizationId, orgId));
  const haveKeys = new Set(rows.map((r) => r.systemKey).filter(Boolean));
  const names = new Set(rows.map((r) => r.name.toLowerCase()));
  const uniq = (n: string) => (names.has(n.toLowerCase()) ? `${n} (statutory)` : n);

  const values: (typeof payItem.$inferInsert)[] = [];
  if (rows.length === 0) {
    const ord = (name: string, extra: Partial<typeof payItem.$inferInsert>, sortOrder: number) =>
      values.push({
        id: nanoid(),
        organizationId: orgId,
        name,
        kind: "earning",
        recurring: false,
        sortOrder,
        ...extra,
      });
    ord("Bonus", ALL_STATUTORY, -8);
    ord("Overtime", ALL_STATUTORY, -7);
    // Case allowance pays out the org's first commission type when it has one
    const [firstType] = await db
      .select({ id: commissionType.id })
      .from(commissionType)
      .where(eq(commissionType.organizationId, orgId))
      .orderBy(asc(commissionType.sortOrder))
      .limit(1);
    ord(
      "Case allowance",
      firstType
        ? { calcType: "invoice_allowance", commissionTypeId: firstType.id, ...ALL_STATUTORY }
        : ALL_STATUTORY,
      -6,
    );
    ord("Petrol allowance", { inPcb: true }, -5);
  }
  STATUTORY_ITEMS.forEach((i, idx) => {
    if (haveKeys.has(i.key)) return;
    values.push({
      id: nanoid(),
      organizationId: orgId,
      name: uniq(i.name),
      kind: "deduction",
      systemKey: i.key,
      calcType: "auto",
      recurring: false,
      sortOrder: -10 + idx,
    });
  });
  if (values.length) await db.insert(payItem).values(values).onConflictDoNothing();
}

// Copy this organization's pay items to the other organizations of the same owner.
// Items are matched by name (statutory ones by their key): matches are updated to the
// same settings, missing ones are created. Nothing is deleted, and salary structures
// are not copied. Commission items need a commission type with the same name there.
export async function applyPayItemsToAll() {
  const { orgId, userId } = await requireAccess("payslip:create");
  const orgs = await siblingOrgs(orgId, userId, "payslip:create");
  const result = { orgs: orgs.length, created: 0, updated: 0, skipped: [] as string[] };
  if (!orgs.length) return result;

  const src = await db.select().from(payItem).where(eq(payItem.organizationId, orgId));
  const srcTypes = await db.select({ id: commissionType.id, name: commissionType.name }).from(commissionType).where(eq(commissionType.organizationId, orgId));

  for (const o of orgs) {
    await ensureSystemPayItems(o.id);
    const dst = await db.select().from(payItem).where(eq(payItem.organizationId, o.id));
    const dstTypes = await db.select({ id: commissionType.id, name: commissionType.name }).from(commissionType).where(eq(commissionType.organizationId, o.id));

    for (const it of src) {
      try {
        const target = it.systemKey
          ? dst.find((d) => d.systemKey === it.systemKey)
          : dst.find((d) => !d.systemKey && d.name.toLowerCase() === it.name.toLowerCase());
        if (target && target.kind !== it.kind) {
          result.skipped.push(`${o.name}: ${it.name} (already exists as a ${target.kind})`);
          continue;
        }
        let commissionTypeId: string | null = null;
        if (it.calcType === "invoice_allowance") {
          const typeName = srcTypes.find((t) => t.id === it.commissionTypeId)?.name;
          const t = dstTypes.find((x) => x.name.toLowerCase() === typeName?.toLowerCase());
          if (!t) {
            result.skipped.push(`${o.name}: ${it.name} (no "${typeName ?? "?"}" commission type there)`);
            continue;
          }
          if (dst.some((d) => d.commissionTypeId === t.id && d.id !== target?.id)) {
            result.skipped.push(`${o.name}: ${it.name} (that commission type is paid out by another item)`);
            continue;
          }
          commissionTypeId = t.id;
        }
        if (target) {
          const set = it.systemKey
            ? { name: it.name, calcType: it.calcType, isActive: it.isActive }
            : {
                calcType: it.calcType, unitLabel: it.unitLabel, rate: it.rate, commissionTypeId,
                inEpf: it.inEpf, inSocso: it.inSocso, inEis: it.inEis, inPcb: it.inPcb,
                recurring: it.recurring, isActive: it.isActive,
              };
          await db.update(payItem).set(set).where(eq(payItem.id, target.id));
          Object.assign(target, set);
          result.updated++;
        } else {
          const row = {
            id: nanoid(), organizationId: o.id, name: it.name, kind: it.kind, systemKey: it.systemKey,
            calcType: it.calcType, unitLabel: it.unitLabel, rate: it.rate, commissionTypeId,
            inEpf: it.inEpf, inSocso: it.inSocso, inEis: it.inEis, inPcb: it.inPcb,
            recurring: it.recurring, isActive: it.isActive, sortOrder: dst.length,
          };
          await db.insert(payItem).values(row);
          dst.push({ ...row, createdAt: new Date() } as (typeof dst)[number]);
          result.created++;
        }
      } catch (e) {
        result.skipped.push(`${o.name}: ${it.name} (${e instanceof Error ? e.message : "failed"})`);
      }
    }
  }
  return result;
}

export async function getPayItems() {
  const { orgId } = await requireAccess("payslip:create");
  await ensureSystemPayItems(orgId);
  return db
    .select()
    .from(payItem)
    .where(eq(payItem.organizationId, orgId))
    .orderBy(asc(payItem.kind), asc(payItem.sortOrder), asc(payItem.name));
}

type PayItemInput = {
  name: string;
  kind: "earning" | "deduction";
  inEpf: boolean;
  inSocso: boolean;
  inEis: boolean;
  inPcb: boolean;
  recurring: boolean;
  calcType: "fixed" | "per_unit" | "invoice_allowance" | "auto" | "manual";
  unitLabel: string | null;
  rate: string | null;
  commissionTypeId: string | null;
};

const ALL_STATUTORY = { inEpf: true, inSocso: true, inEis: true, inPcb: true };

function cleanPayItem(d: Partial<PayItemInput>) {
  const out: Partial<PayItemInput> = {};
  if (d.name !== undefined) {
    const n = d.name.trim();
    if (!n) throw new Error("Name is required");
    if (n.length > 60) throw new Error("Name is too long");
    out.name = n;
  }
  if (d.kind !== undefined) {
    if (d.kind !== "earning" && d.kind !== "deduction") throw new Error("Invalid type");
    out.kind = d.kind;
  }
  for (const k of ["inEpf", "inSocso", "inEis", "inPcb"] as const)
    if (d[k] !== undefined) out[k] = !!d[k];
  if (d.recurring !== undefined) out.recurring = d.recurring;
  if (d.calcType !== undefined) {
    if (d.calcType !== "fixed" && d.calcType !== "per_unit" && d.calcType !== "invoice_allowance")
      throw new Error("Invalid amount type"); // auto/manual are only set on statutory items (updatePayItem)
    out.calcType = d.calcType;
    // quantity × rate and invoice-backed items are filled in each month, not fixed in a structure
    if (d.calcType !== "fixed") out.recurring = false;
    if (d.calcType === "invoice_allowance") {
      out.unitLabel = null;
      out.rate = null;
    } else out.commissionTypeId = null;
  }
  const money = (v: string | null | undefined, what: string) => {
    if (v === null || v === undefined || v.trim() === "") return null;
    const n = Number(v);
    if (!(n >= 0)) throw new Error(`Invalid ${what}`);
    return String(n);
  };
  if (d.commissionTypeId !== undefined && d.calcType === "invoice_allowance") out.commissionTypeId = d.commissionTypeId;
  if (d.unitLabel !== undefined) out.unitLabel = d.unitLabel?.trim() || null;
  if (d.rate !== undefined) out.rate = money(d.rate, "rate");
  // Statutory/tax flags only make sense for earnings
  if (out.kind === "deduction") {
    out.inEpf = out.inSocso = out.inEis = out.inPcb = false;
    out.calcType = "fixed";
  }
  return out;
}

// An item backed by Custom Commission needs one of the org's commission types,
// and a type can only be paid out by one item (its earnings can't be split).
async function assertCommissionItem(orgId: string, typeId: string | null | undefined, exceptId?: string) {
  if (!typeId) throw new Error("Choose which commission type this item pays out");
  const [t] = await db
    .select({ id: commissionType.id })
    .from(commissionType)
    .where(and(eq(commissionType.id, typeId), eq(commissionType.organizationId, orgId)))
    .limit(1);
  if (!t) throw new Error("Commission type not found");
  const rows = await db
    .select({ id: payItem.id })
    .from(payItem)
    .where(and(eq(payItem.organizationId, orgId), eq(payItem.commissionTypeId, typeId)));
  if (rows.some((r) => r.id !== exceptId))
    throw new Error("Another payslip item already pays out this commission type");
}

export async function createPayItem(
  data: Pick<PayItemInput, "name" | "kind" | "inEpf" | "inSocso" | "inEis" | "inPcb" | "recurring"> &
    Partial<PayItemInput>,
) {
  const { orgId } = await requireAccess("payslip:create");
  const c = cleanPayItem(data) as PayItemInput;
  if (c.calcType === "invoice_allowance") await assertCommissionItem(orgId, c.commissionTypeId);
  const existing = await db
    .select({ name: payItem.name })
    .from(payItem)
    .where(eq(payItem.organizationId, orgId));
  if (existing.some((e) => e.name.toLowerCase() === c.name.toLowerCase()))
    throw new Error("A pay item with this name already exists");
  await db.insert(payItem).values({
    id: nanoid(),
    organizationId: orgId,
    ...c,
    sortOrder: existing.length,
  });
}

export async function updatePayItem(
  id: string,
  data: Partial<PayItemInput> & { isActive?: boolean },
) {
  const { orgId } = await requireAccess("payslip:create");
  const [cur] = await db
    .select({ systemKey: payItem.systemKey })
    .from(payItem)
    .where(and(eq(payItem.id, id), eq(payItem.organizationId, orgId)))
    .limit(1);
  if (!cur) throw new Error("Pay item not found");
  const { isActive, ...rest } = data;
  // Statutory items: only the name, visibility and auto/manual mode can change
  const allowed = cur.systemKey ? { name: rest.name } : rest;
  const set: Record<string, unknown> = cleanPayItem(allowed);
  if (cur.systemKey && (rest.calcType === "auto" || rest.calcType === "manual")) set.calcType = rest.calcType;
  if (isActive !== undefined) set.isActive = isActive;
  if (!Object.keys(set).length) return;
  if (set.calcType === "invoice_allowance")
    await assertCommissionItem(orgId, set.commissionTypeId as string | null | undefined, id);
  try {
    await db
      .update(payItem)
      .set(set)
      .where(and(eq(payItem.id, id), eq(payItem.organizationId, orgId)));
  } catch {
    throw new Error("A pay item with this name already exists");
  }
}

// Payslips keep their stored label; salary-structure lines for the item
// are removed with it (FK cascade).
export async function deletePayItem(id: string) {
  const { orgId } = await requireAccess("payslip:create");
  await db
    .delete(payItem)
    .where(
      and(
        eq(payItem.id, id),
        eq(payItem.organizationId, orgId),
        isNull(payItem.systemKey),
      ),
    );
}

/* ── Salary structure (per employee) ─────────────────────────────── */

export async function getSalaryStructures() {
  const { orgId } = await requireAccess("payslip:create");
  const members = await db
    .select({
      userId: member.userId,
      name: user.name,
      email: user.email,
      fullname: profile.fullname,
      jobTitle: profile.jobTitle,
    })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .leftJoin(profile, eq(profile.userId, member.userId))
    .where(eq(member.organizationId, orgId))
    .orderBy(user.name);

  const structures = await db
    .select()
    .from(salaryStructure)
    .where(eq(salaryStructure.organizationId, orgId));
  const items = structures.length
    ? await db
        .select()
        .from(salaryStructureItem)
        .where(
          inArray(
            salaryStructureItem.structureId,
            structures.map((x) => x.id),
          ),
        )
    : [];

  const reliefMap = await resolveReliefs(orgId, members.map((m) => m.userId));
  const ownRelief = await db
    .select({ userId: employeeTaxRelief.userId, reliefTypeId: employeeTaxRelief.reliefTypeId, amount: employeeTaxRelief.amount })
    .from(employeeTaxRelief)
    .where(eq(employeeTaxRelief.organizationId, orgId));

  return members.map((m) => {
    const st = structures.find((x) => x.userId === m.userId);
    return {
      ...m,
      relief: reliefMap.get(m.userId) ?? { fixed: 0, epfCap: null },
      reliefs: ownRelief.filter((r) => r.userId === m.userId).map((r) => ({ typeId: r.reliefTypeId, amount: r.amount })),
      hasStructure: !!st,
      basicSalary: st?.basicSalary ?? "0",
      items: st
        ? items
            .filter((i) => i.structureId === st.id)
            .map((i) => ({ payItemId: i.payItemId, amount: i.amount }))
        : [],
    };
  });
}

export async function saveSalaryStructure(data: {
  userId: string;
  basicSalary: number;
  items: { payItemId: string; amount: number }[];
  // The employee's own yearly tax relief amounts (0 = excluded). Types not listed fall back to the default.
  reliefs?: { typeId: string; amount: number }[];
}) {
  const { orgId } = await requireAccess("payslip:create");
  if (!(data.basicSalary >= 0)) throw new Error("Invalid basic salary");

  const [target] = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.userId, data.userId), eq(member.organizationId, orgId)))
    .limit(1);
  if (!target) throw new Error("Employee is not a member of this organization");

  const ids = data.items.map((i) => i.payItemId);
  if (ids.length) {
    const valid = await db
      .select({ id: payItem.id })
      .from(payItem)
      .where(and(eq(payItem.organizationId, orgId), inArray(payItem.id, ids)));
    if (valid.length !== new Set(ids).size) throw new Error("Unknown pay item");
  }
  for (const i of data.items)
    if (!(i.amount >= 0)) throw new Error("Invalid amount");

  const [existing] = await db
    .select({ id: salaryStructure.id })
    .from(salaryStructure)
    .where(
      and(
        eq(salaryStructure.organizationId, orgId),
        eq(salaryStructure.userId, data.userId),
      ),
    )
    .limit(1);
  const structureId = existing?.id ?? nanoid();
  if (existing) {
    await db
      .update(salaryStructure)
      .set({ basicSalary: String(data.basicSalary), updatedAt: new Date() })
      .where(eq(salaryStructure.id, structureId));
    await db
      .delete(salaryStructureItem)
      .where(eq(salaryStructureItem.structureId, structureId));
  } else {
    await db.insert(salaryStructure).values({
      id: structureId,
      organizationId: orgId,
      userId: data.userId,
      basicSalary: String(data.basicSalary),
    });
  }
  if (data.reliefs) {
    const typeIds = [...new Set(data.reliefs.map((r) => r.typeId))];
    if (typeIds.length) {
      const valid = await db
        .select({ id: taxReliefType.id })
        .from(taxReliefType)
        .where(and(eq(taxReliefType.organizationId, orgId), inArray(taxReliefType.id, typeIds)));
      if (valid.length !== typeIds.length) throw new Error("Unknown tax relief type");
    }
    for (const r of data.reliefs) if (!(r.amount >= 0)) throw new Error("Invalid tax relief amount");
    await db
      .delete(employeeTaxRelief)
      .where(and(eq(employeeTaxRelief.organizationId, orgId), eq(employeeTaxRelief.userId, data.userId)));
    const byType = new Map(data.reliefs.map((r) => [r.typeId, r.amount]));
    if (byType.size)
      await db.insert(employeeTaxRelief).values(
        [...byType].map(([reliefTypeId, amount]) => ({
          id: nanoid(),
          organizationId: orgId,
          userId: data.userId,
          reliefTypeId,
          amount: String(amount),
        })),
      );
  }
  const uniq = new Map(data.items.map((i) => [i.payItemId, i.amount]));
  if (uniq.size)
    await db.insert(salaryStructureItem).values(
      [...uniq].map(([payItemId, amount]) => ({
        id: nanoid(),
        structureId,
        payItemId,
        amount: String(amount),
      })),
    );
}

// Create draft payslips for every employee with a salary structure that
// doesn't have one in this period yet.
export async function generatePayslips(periodId: string) {
  const { orgId } = await requireAccess("payslip:create");

  const [period] = await db
    .select()
    .from(payrollPeriod)
    .where(and(eq(payrollPeriod.id, periodId), eq(payrollPeriod.organizationId, orgId)))
    .limit(1);
  if (!period) throw new Error("Period not found");
  if (period.status === "published")
    throw new Error("Cannot add payslips to a published period");

  const structures = await db
    .select()
    .from(salaryStructure)
    .where(eq(salaryStructure.organizationId, orgId));
  if (!structures.length)
    throw new Error("No salary structures set up yet (Organization → Payslip Settings → Salary structure)");

  const existing = await db
    .select({ userId: payslip.userId })
    .from(payslip)
    .where(eq(payslip.periodId, periodId));
  const have = new Set(existing.map((e) => e.userId));

  const items = await db
    .select({
      structureId: salaryStructureItem.structureId,
      payItemId: salaryStructureItem.payItemId,
      amount: salaryStructureItem.amount,
      name: payItem.name,
      kind: payItem.kind,
      isActive: payItem.isActive,
    })
    .from(salaryStructureItem)
    .innerJoin(payItem, eq(payItem.id, salaryStructureItem.payItemId))
    .where(
      inArray(
        salaryStructureItem.structureId,
        structures.map((x) => x.id),
      ),
    );

  const defs = await getItemDefs(orgId);

  let created = 0;
  let skipped = 0;
  const errors: string[] = [];
  for (const st of structures) {
    if (have.has(st.userId)) {
      skipped++;
      continue;
    }
    const mine = items.filter(
      (i) => i.structureId === st.id && i.isActive && Number(i.amount) > 0,
    );
    // Case allowance: include whatever the Allowance module has pending for them
    const caseInputs = defs
      .filter((d) => d.isActive && d.kind === "earning" && d.calcType === "invoice_allowance")
      .map((d) => ({ payItemId: d.id, amount: 0 }));
    try {
      await createPayslipInternal(orgId, {
        periodId,
        userId: st.userId,
        basicSalary: Number(st.basicSalary),
        lines: [
          ...mine.map((i) => ({ payItemId: i.payItemId, amount: Number(i.amount) })),
          ...caseInputs,
        ],
      });
      created++;
    } catch (e) {
      errors.push(e instanceof Error ? e.message : "failed");
    }
  }
  return { created, skipped, errors };
}
