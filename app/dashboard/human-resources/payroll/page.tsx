import { requirePermission } from "@/lib/auth/require-permission";
import { getPayrollPeriods } from "@/server/payroll";
import { PayrollClient } from "./payroll-client";

export default async function PayrollPage() {
  await requirePermission("payslip:read:all");
  const periods = await getPayrollPeriods();
  return <PayrollClient initialPeriods={periods} />;
}
