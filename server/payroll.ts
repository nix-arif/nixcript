"use server";

import { db } from "@/db";
import { payrollPeriod, payslip, member, profile, user } from "@/db/schema";
import { getCachedSession } from "@/lib/auth/cached-session";
import { nanoid } from "nanoid";
import { eq, and, desc, sql, asc, lte } from "drizzle-orm";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";
import { assertSelfActionAllowed } from "@/lib/approvals/guard";
import { notifyUsersWithPermission } from "@/server/notifications";

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
  const { orgId } = await requireAccess("payslip:publish");

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
      bonus: payslip.bonus,
      overtimePay: payslip.overtimePay,
      caseAllowancePay: payslip.caseAllowancePay,
      petrolAllowancePay: payslip.petrolAllowancePay,
      allowances: payslip.allowances,
      otherDeductions: payslip.otherDeductions, // ← add
      epfEmployee: payslip.epfEmployee, // ← add
      socsoEmployee: payslip.socsoEmployee, // ← add
      eisEmployee: payslip.eisEmployee, // ← add
      lhdn: payslip.lhdn, // ← add
      grossPay: payslip.grossPay,
      totalDeductions: payslip.totalDeductions,
      netPay: payslip.netPay,
      status: payslip.status,
      bankName: payslip.bankName,
      bankAccountNo: payslip.bankAccountNo,
      bankAccountHolder: payslip.bankAccountHolder,
    })
    .from(payslip)
    .where(eq(payslip.periodId, periodId))
    .orderBy(payslip.employeeName);

  const totalGross = payslips.reduce((s, p) => s + Number(p.grossPay), 0);
  const totalDeductions = payslips.reduce(
    (s, p) => s + Number(p.totalDeductions),
    0,
  );
  const totalNet = payslips.reduce((s, p) => s + Number(p.netPay), 0);

  return { period, payslips, totalGross, totalDeductions, totalNet };
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
  return { payslip: row, period };
}

export async function createPayslip(data: {
  periodId: string;
  userId: string;
  basicSalary: number;
  bonus?: number;
  overtimePay?: number;
  caseAllowancePay?: number;
  petrolAllowancePay?: number;
  allowances?: { label: string; amount: string }[];
  otherDeductions?: { label: string; amount: string }[];
  manualLhdn?: number;
}) {
  const { orgId } = await requireAccess("payslip:create");

  // Get period
  const [period] = await db
    .select()
    .from(payrollPeriod)
    .where(
      and(
        eq(payrollPeriod.id, data.periodId),
        eq(payrollPeriod.organizationId, orgId),
      ),
    )
    .limit(1);

  if (!period) throw new Error("Period not found");
  if (period.status === "published")
    throw new Error("Cannot add payslips to a published period");

  // Check duplicate
  const [existing] = await db
    .select()
    .from(payslip)
    .where(
      and(eq(payslip.periodId, data.periodId), eq(payslip.userId, data.userId)),
    )
    .limit(1);

  if (existing)
    throw new Error("Payslip for this employee already exists in this period");

  // Get employee profile
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

  // Calculate
  const { calculatePayslip } = await import("@/lib/payroll/calculate");
  const calc = calculatePayslip({
    basicSalary: data.basicSalary,
    bonus: data.bonus ?? 0,
    overtimePay: data.overtimePay ?? 0,
    caseAllowancePay: data.caseAllowancePay ?? 0,
    petrolAllowancePay: data.petrolAllowancePay ?? 0,
    currentMonth: period.month,
    allowances: data.allowances?.reduce((s, a) => s + Number(a.amount), 0),
    otherDeductions: data.otherDeductions?.reduce(
      (s, d) => s + Number(d.amount),
      0,
    ),
    manualLhdn: data.manualLhdn,
  });

  await db.insert(payslip).values({
    id: nanoid(),
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
    bonus: String(data.bonus ?? 0),
    overtimePay: String(data.overtimePay ?? 0),
    caseAllowancePay: String(data.caseAllowancePay ?? 0),
    petrolAllowancePay: String(data.petrolAllowancePay ?? 0),
    allowances: data.allowances ?? [],
    epfEmployee: String(calc.epf.employee),
    epfEmployer: String(calc.epf.employer),
    socsoEmployee: String(calc.socso.employee),
    socsoEmployer: String(calc.socso.employer),
    eisEmployee: String(calc.eis.employee),
    eisEmployer: String(calc.eis.employer),
    lhdn: String(calc.lhdn),
    otherDeductions: data.otherDeductions ?? [],
    grossPay: String(calc.gross),
    totalDeductions: String(calc.totalDeductions),
    netPay: String(calc.netPay),
    status: "draft",
  });
}

export async function updatePayslip(
  payslipId: string,
  data: {
    basicSalary: number;
    bonus?: number;
    overtimePay?: number;
    caseAllowancePay?: number;
    petrolAllowancePay?: number;
    allowances?: { label: string; amount: string }[];
    otherDeductions?: { label: string; amount: string }[];
    manualLhdn?: number;
  },
) {
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

  if (!period) throw new Error("Period not found");
  if (period.status === "published")
    throw new Error("Cannot edit payslips in a published period");

  const { calculatePayslip } = await import("@/lib/payroll/calculate");
  const calc = calculatePayslip({
    basicSalary: data.basicSalary,
    bonus: data.bonus ?? 0,
    overtimePay: data.overtimePay ?? 0,
    caseAllowancePay: data.caseAllowancePay ?? 0,
    petrolAllowancePay: data.petrolAllowancePay ?? 0,
    currentMonth: period.month,
    allowances: data.allowances?.reduce((s, a) => s + Number(a.amount), 0),
    otherDeductions: data.otherDeductions?.reduce(
      (s, d) => s + Number(d.amount),
      0,
    ),
    manualLhdn: data.manualLhdn,
  });

  await db
    .update(payslip)
    .set({
      basicSalary: String(data.basicSalary),
      bonus: String(data.bonus ?? 0),
      overtimePay: String(data.overtimePay ?? 0),
      caseAllowancePay: String(data.caseAllowancePay ?? 0),
      petrolAllowancePay: String(data.petrolAllowancePay ?? 0),
      allowances: data.allowances ?? [],
      epfEmployee: String(calc.epf.employee),
      epfEmployer: String(calc.epf.employer),
      socsoEmployee: String(calc.socso.employee),
      socsoEmployer: String(calc.socso.employer),
      eisEmployee: String(calc.eis.employee),
      eisEmployer: String(calc.eis.employer),
      lhdn: String(calc.lhdn),
      otherDeductions: data.otherDeductions ?? [],
      grossPay: String(calc.gross),
      totalDeductions: String(calc.totalDeductions),
      netPay: String(calc.netPay),
      updatedAt: new Date(),
    })
    .where(eq(payslip.id, payslipId));
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
  const { session, orgId, userId } = await getSession();

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
      bonus: payslip.bonus,
      overtimePay: payslip.overtimePay,
      allowances: payslip.allowances,
      epfEmployee: payslip.epfEmployee,
      epfEmployer: payslip.epfEmployer,
      socsoEmployee: payslip.socsoEmployee,
      socsoEmployer: payslip.socsoEmployer,
      eisEmployee: payslip.eisEmployee,
      eisEmployer: payslip.eisEmployer,
      lhdn: payslip.lhdn,
      otherDeductions: payslip.otherDeductions,
      grossPay: payslip.grossPay,
      totalDeductions: payslip.totalDeductions,
      netPay: payslip.netPay,
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
    .where(and(eq(payslip.userId, userId), eq(payslip.status, "published")))
    .orderBy(desc(payrollPeriod.year), desc(payrollPeriod.month));

  return rows;
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
  userId: string,
  year: number,
  upToMonth: number,
) {
  const rows = await db
    .select({
      grossPay: payslip.grossPay,
      netPay: payslip.netPay,
      basicSalary: payslip.basicSalary,
      bonus: payslip.bonus,
      overtimePay: payslip.overtimePay,
      allowances: payslip.allowances,
      epfEmployee: payslip.epfEmployee,
      epfEmployer: payslip.epfEmployer,
      socsoEmployee: payslip.socsoEmployee,
      socsoEmployer: payslip.socsoEmployer,
      eisEmployee: payslip.eisEmployee,
      eisEmployer: payslip.eisEmployer,
      lhdn: payslip.lhdn,
      totalDeductions: payslip.totalDeductions,
      periodMonth: payrollPeriod.month,
    })
    .from(payslip)
    .innerJoin(payrollPeriod, eq(payrollPeriod.id, payslip.periodId))
    .where(
      and(
        eq(payslip.userId, userId),
        eq(payslip.status, "published"),
        eq(payrollPeriod.year, year),
        lte(payrollPeriod.month, upToMonth),
      ),
    );

  const sum = (field: keyof (typeof rows)[0]) =>
    rows.reduce((s, r) => s + Number(r[field] ?? 0), 0);

  const ytdAllowances = rows.reduce((s, r) => {
    const arr = (r.allowances as any[]) ?? [];
    return s + arr.reduce((a: number, x: any) => a + Number(x.amount || 0), 0);
  }, 0);

  const ytdGross = sum("grossPay");
  const ytdNet = sum("netPay");
  const ytdEpfEmployee = sum("epfEmployee");
  const ytdEpfEmployer = sum("epfEmployer");
  const ytdSocsoEmployee = sum("socsoEmployee");
  const ytdSocsoEmployer = sum("socsoEmployer");
  const ytdEisEmployee = sum("eisEmployee");
  const ytdEisEmployer = sum("eisEmployer");
  const ytdLhdn = sum("lhdn");
  const ytdTotalDeductions = sum("totalDeductions");
  const ytdBasic = sum("basicSalary");
  const ytdBonus = sum("bonus");
  const ytdOvertime = sum("overtimePay");

  // Taxable income = gross - EPF employee (EPF relief under Section 49)
  const ytdTaxableIncome = ytdGross - ytdEpfEmployee;

  return {
    ytdGross,
    ytdNet,
    ytdBasic,
    ytdBonus,
    ytdOvertime,
    ytdAllowances,
    ytdEpfEmployee,
    ytdEpfEmployer,
    ytdSocsoEmployee,
    ytdSocsoEmployer,
    ytdEisEmployee,
    ytdEisEmployer,
    ytdLhdn,
    ytdTotalDeductions,
    ytdTaxableIncome,
  };
}
