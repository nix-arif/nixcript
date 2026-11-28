import { requirePermission } from "@/lib/auth/require-permission";
import { getApprovalMembers, getCrossOrgApprovalMembers } from "@/server/approvals";
import { getApprovalRequiredSettings, getApprovalSelfActionSettings } from "@/server/approval-settings";
import { APPROVAL_MODULES } from "@/lib/approvals/constants";
import { ApprovalsClient } from "./approvals-client";

export default async function ApprovalsPage() {
  await requirePermission("permission:read");

  const [members, crossOrgMembers, selfActionSettings, approvalRequired] = await Promise.all([
    getApprovalMembers(),
    getCrossOrgApprovalMembers(),
    getApprovalSelfActionSettings(),
    getApprovalRequiredSettings(),
  ]);

  return (
    <ApprovalsClient
      members={members}
      crossOrgMembers={crossOrgMembers}
      modules={APPROVAL_MODULES}
      selfActionSettings={selfActionSettings}
      approvalRequired={approvalRequired}
    />
  );
}
