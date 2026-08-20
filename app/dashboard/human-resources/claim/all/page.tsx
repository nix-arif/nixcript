import { requirePermission } from "@/lib/auth/require-permission";
import { getAllClaimApplications } from "@/server/claim";
import { AllClaimsClient } from "./all-claims-client";

export default async function AllClaimsPage() {
  const session = await requirePermission("claim:read:all");
  const applications = await getAllClaimApplications();
  return <AllClaimsClient applications={applications} currentUserName={session.user.name ?? undefined} />;
}
