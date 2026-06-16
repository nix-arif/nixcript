import { requirePermission } from "@/lib/auth/require-permission";
import { getApprovalMembers } from "@/server/approvals";
import { APPROVAL_MODULES } from "@/lib/approvals/constants";
import { ApprovalsClient } from "./approvals-client";

export default async function ApprovalsPage() {
  await requirePermission("permission:read");

  const members = await getApprovalMembers();

  return <ApprovalsClient members={members} modules={APPROVAL_MODULES} />;
}
