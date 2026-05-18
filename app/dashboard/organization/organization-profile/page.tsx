// app/dashboard/organization-profile/page.tsx
import { requirePermission } from "@/lib/auth/require-permission";
import { getFullOrganizationProfile } from "@/server/organization-profile";
import { OrganizationProfileClient } from "./organization-profile-client";

export default async function OrganizationProfilePage() {
  await requirePermission("organization-profile:read");
  const data = await getFullOrganizationProfile();
  return <OrganizationProfileClient data={data} />;
}
