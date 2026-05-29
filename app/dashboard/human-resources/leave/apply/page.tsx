import { requirePermission } from "@/lib/auth/require-permission";
import { getActiveLeaveTypes, getMyLeaveBalances } from "@/server/leave";
import { ApplyLeaveClient } from "./apply-leave-client";

export default async function ApplyLeavePage() {
  await requirePermission("leave:apply");
  const [leaveTypes, balances] = await Promise.all([
    getActiveLeaveTypes(),
    getMyLeaveBalances(),
  ]);
  return <ApplyLeaveClient leaveTypes={leaveTypes} balances={balances} />;
}
