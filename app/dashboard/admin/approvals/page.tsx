import { requirePermission } from "@/lib/auth/require-permission";
import { getApprovalMembers } from "@/server/approvals";
import { getApprovalSelfActionSettings } from "@/server/approval-settings";
import { APPROVAL_MODULES } from "@/lib/approvals/constants";
import { ApprovalsClient } from "./approvals-client";

export default async function ApprovalsPage() {
  await requirePermission("permission:read");

  const [members, selfActionSettings] = await Promise.all([
    getApprovalMembers(),
    getApprovalSelfActionSettings(),
  ]);

  return (
    <ApprovalsClient
      members={members}
      modules={APPROVAL_MODULES}
      selfActionSettings={selfActionSettings}
    />
  );
}
