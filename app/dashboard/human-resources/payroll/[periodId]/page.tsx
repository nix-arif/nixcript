import { requirePermission } from "@/lib/auth/require-permission";
import { getPeriodDetail } from "@/server/payroll";
import { PeriodDetailClient } from "./period-detail-client";
import { notFound } from "next/navigation";

export default async function PeriodDetailPage({
  params,
}: {
  params: Promise<{ periodId: string }>;
}) {
  await requirePermission("payslip:read:all");
  const { periodId } = await params;
  const data = await getPeriodDetail(periodId);
  if (!data) notFound();
  return <PeriodDetailClient data={data} />;
}
