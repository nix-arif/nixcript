import { requirePermission } from "@/lib/auth/require-permission";
import { getStatementOfAccount } from "@/server/invoice";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { getFullOrganizationProfile } from "@/server/organization-profile";
import { SoaClient } from "./soa-client";

export default async function SoaPage() {
  const session = await requirePermission("invoice:read");
  const [soa, permissions, orgProfile] = await Promise.all([
    getStatementOfAccount(),
    getUserPermissions(session.user.id, session.session.activeOrganizationId!),
    getFullOrganizationProfile(),
  ]);

  return <SoaClient soa={soa} permissions={permissions} orgProfile={orgProfile} />;
}
