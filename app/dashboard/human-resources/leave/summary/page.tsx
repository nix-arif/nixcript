import { requirePermission } from "@/lib/auth/require-permission";
import { getLeaveSummary } from "@/server/leave";
import { LeaveSummaryClient } from "./summary-client";

export default async function LeaveSummaryPage() {
  await requirePermission("leave:summary");
  const summary = await getLeaveSummary();
  return <LeaveSummaryClient summary={summary} />;
}
