import { requirePermission } from "@/lib/auth/require-permission";
import { getActiveClaimTypes } from "@/server/claim";
import { ApplyClaimClient } from "./apply-claim-client";

export default async function ApplyClaimPage() {
  const session = await requirePermission("claim:apply");
  void session;
  const claimTypes = await getActiveClaimTypes();
  return <ApplyClaimClient claimTypes={claimTypes} />;
}
