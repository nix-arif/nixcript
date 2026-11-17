import { requirePermission } from "@/lib/auth/require-permission";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { getAllClaimApplications } from "@/server/claim";
import { AllClaimsClient } from "./all-claims-client";

export default async function AllClaimsPage() {
  const session = await requirePermission("claim:read:all");
  const applications = await getAllClaimApplications();
  // the owner holds every permission ("*"): only the owner can recall an approved claim
  const perms = await getUserPermissions(session.user.id, session.session.activeOrganizationId!);
  return <AllClaimsClient applications={applications} currentUserName={session.user.name ?? undefined} isOwner={perms.includes("*")} />;
}
