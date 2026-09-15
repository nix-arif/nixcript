import { requirePermission } from "@/lib/auth/require-permission";
import { getSiblingOrgsForConsignment } from "@/server/consignment-transfer";
import { getFieldReps } from "@/server/field-stock";
import { ConsignTransferClient } from "./consign-transfer-client";

export default async function ConsignTransferPage() {
  await requirePermission("inventory:manage");
  const [siblingOrgs, reps] = await Promise.all([
    getSiblingOrgsForConsignment().catch(() => []),
    getFieldReps().catch(() => []),
  ]);
  return <ConsignTransferClient siblingOrgs={siblingOrgs} reps={reps} />;
}
