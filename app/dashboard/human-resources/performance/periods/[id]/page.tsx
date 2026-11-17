import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/require-permission";
import { getReviewPeriod, getEligibleEmployees } from "@/server/performance";
import { PeriodDetailClient } from "./period-detail-client";

export default async function ReviewPeriodPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("review:manage");
  const { id } = await params;
  const [period, employees] = await Promise.all([getReviewPeriod(id), getEligibleEmployees()]);
  if (!period) notFound();
  return <PeriodDetailClient period={period} employees={employees} />;
}
