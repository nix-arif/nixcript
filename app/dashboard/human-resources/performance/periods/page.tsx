import { requirePermission } from "@/lib/auth/require-permission";
import { getReviewPeriods, getReviewTemplates, getEligibleEmployees } from "@/server/performance";
import { PeriodsClient } from "./periods-client";

export default async function ReviewPeriodsPage() {
  await requirePermission("review:manage");
  const [periods, templates, employees] = await Promise.all([getReviewPeriods(), getReviewTemplates(), getEligibleEmployees()]);
  return <PeriodsClient initialPeriods={periods} templates={templates.filter((t) => t.isActive)} employees={employees} />;
}
