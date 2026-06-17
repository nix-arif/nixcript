import { requirePermission } from "@/lib/auth/require-permission";
import { getPendingClaimChecks } from "@/server/claim";
import { ClaimCheckerClient } from "./checker-client";

export default async function ClaimCheckerPage() {
  await requirePermission("claim:check");
  const applications = await getPendingClaimChecks();
  return <ClaimCheckerClient applications={applications} />;
}
