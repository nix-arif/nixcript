import { requirePermission } from "@/lib/auth/require-permission";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { getCachedSession } from "@/lib/auth/cached-session";
import { getWorkflowSummary } from "@/server/workflow";
import { WorkflowClient } from "./workflow-client";
import { redirect } from "next/navigation";

export default async function WorkflowPage() {
  await requirePermission("sales-order:read");

  const session = await getCachedSession();
  if (!session?.session.activeOrganizationId) redirect("/dashboard");

  const [rows, permissions] = await Promise.all([
    getWorkflowSummary(),
    getUserPermissions(session.user.id, session.session.activeOrganizationId),
  ]);

  return <WorkflowClient rows={rows} permissions={permissions} />;
}
