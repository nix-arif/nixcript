import { requirePermission } from "@/lib/auth/require-permission";
import { getPeriodDetail } from "@/server/payroll";
import { PeriodDetailClient } from "./period-detail-client";
import { notFound } from "next/navigation";
import { getCachedSession } from "@/lib/auth/cached-session";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";

export default async function PeriodDetailPage({
  params,
}: {
  params: Promise<{ periodId: string }>;
}) {
  await requirePermission("payslip:read:all");
  const { periodId } = await params;
  const data = await getPeriodDetail(periodId);
  if (!data) notFound();
  const session = await getCachedSession();
  const orgId = session?.session?.activeOrganizationId;
  const perms = session && orgId ? await getUserPermissions(session.user.id, orgId) : [];
  return <PeriodDetailClient data={data} canRecall={hasAccess(perms, "payslip:recall")} />;
}
