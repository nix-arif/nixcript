import { requirePermission } from "@/lib/auth/require-permission";
import { getOrganizationWithProfile } from "@/server/organization-profile";
import { OrganizationProfileClient } from "./organization-profile-client";

export default async function OrganizationProfilePage() {
  await requirePermission("organization-profile:read");
  const { org, profile } = await getOrganizationWithProfile();
  return <OrganizationProfileClient org={org} profile={profile} />;
}
