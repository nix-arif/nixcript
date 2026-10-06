import { requirePermission } from "@/lib/auth/require-permission";
import { getRecordLeaveOptions } from "@/server/leave";
import { RecordLeaveClient } from "./record-client";

export default async function RecordLeavePage() {
  await requirePermission("leave:approve");
  const options = await getRecordLeaveOptions();
  return <RecordLeaveClient members={options.members} types={options.types} />;
}
