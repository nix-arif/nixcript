import { redirect } from "next/navigation";

// Salary structure now lives inside Payslip Settings
export default function SalaryStructurePage() {
  redirect("/dashboard/human-resources/payslip-settings?tab=structure");
}
