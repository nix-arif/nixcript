import { requirePermission } from "@/lib/auth/require-permission";
import { getAllClaimApplications } from "@/server/claim";
import { AllClaimsClient } from "./all-claims-client";

export default async function AllClaimsPage() {
  await requirePermission("claim:read:all");
  const applications = await getAllClaimApplications();
  return <AllClaimsClient applications={applications} />;
}
