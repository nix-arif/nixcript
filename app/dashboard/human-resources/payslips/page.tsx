import { requirePermission } from "@/lib/auth/require-permission";
import { getMyPayslips } from "@/server/payroll";
import { MyPayslipsClient } from "./my-payslips-client";

export default async function MyPayslipsPage() {
  await requirePermission("payslip:read:own");
  const payslips = await getMyPayslips();
  return <MyPayslipsClient payslips={payslips} />;
}
