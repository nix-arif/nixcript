import { requirePermission } from "@/lib/auth/require-permission";
import { getLeaveReport } from "@/server/leave";
import { LeaveReportClient } from "./report-client";

export default async function LeaveReportPage() {
  await requirePermission("leave:read:all");
  const report = await getLeaveReport();
  return <LeaveReportClient initialReport={report} />;
}
