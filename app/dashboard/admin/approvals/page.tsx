import { requirePermission } from "@/lib/auth/require-permission";
import { getApprovalMembers, getCrossOrgApprovalMembers } from "@/server/approvals";
import { getApprovalSelfActionSettings } from "@/server/approval-settings";
import { APPROVAL_MODULES } from "@/lib/approvals/constants";
import { ApprovalsClient } from "./approvals-client";

export default async function ApprovalsPage() {
  await requirePermission("permission:read");

  const [members, crossOrgMembers, selfActionSettings] = await Promise.all([
    getApprovalMembers(),
    getCrossOrgApprovalMembers(),
    getApprovalSelfActionSettings(),
  ]);

  return (
    <ApprovalsClient
      members={members}
      crossOrgMembers={crossOrgMembers}
      modules={APPROVAL_MODULES}
      selfActionSettings={selfActionSettings}
    />
  );
}
