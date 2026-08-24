import { requirePermission } from "@/lib/auth/require-permission";
import { getNoticePeriodPolicies, getLeaveTypes } from "@/server/leave";
import { LeavePolicyClient } from "./leave-policy-client";

export default async function LeavePolicyPage() {
  await requirePermission("leave:manage");
  const [noticePolicies, leaveTypes] = await Promise.all([
    getNoticePeriodPolicies(),
    getLeaveTypes(),
  ]);
  return <LeavePolicyClient noticePolicies={noticePolicies} leaveTypes={leaveTypes} />;
}
