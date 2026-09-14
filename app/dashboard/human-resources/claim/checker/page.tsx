import { requirePermission } from "@/lib/auth/require-permission";
import { getPendingClaimChecks, getPendingRejectionReviews } from "@/server/claim";
import { ClaimCheckerClient } from "./checker-client";

export default async function ClaimCheckerPage() {
  await requirePermission("claim:check");
  const [applications, rejectionReviews] = await Promise.all([
    getPendingClaimChecks(),
    getPendingRejectionReviews(),
  ]);
  return <ClaimCheckerClient applications={applications} rejectionReviews={rejectionReviews} />;
}
