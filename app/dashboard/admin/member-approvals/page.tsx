import { requireOwner } from "@/lib/auth/require-permission";
import { getPendingInvitations, getPendingDepartmentAssignments } from "@/server/member-approvals";
import { MemberApprovalsClient } from "./member-approvals-client";

export default async function MemberApprovalsPage() {
  await requireOwner();

  const [pendingInvitations, pendingDepartmentAssignments] = await Promise.all([
    getPendingInvitations(),
    getPendingDepartmentAssignments(),
  ]);

  return (
    <MemberApprovalsClient
      pendingInvitations={pendingInvitations}
      pendingDepartmentAssignments={pendingDepartmentAssignments}
    />
  );
}
