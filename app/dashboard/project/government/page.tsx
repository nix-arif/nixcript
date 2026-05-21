import { requirePermission } from "@/lib/auth/require-permission";
import { getCachedSession } from "@/lib/auth/cached-session";
import { getOwnerOrganizations } from "@/server/quotation";
import { GovernmentClient } from "./government-client";

export default async function GovernmentProjectPage() {
  await requirePermission("quotation:create");
  const session = await getCachedSession();
  const activeOrgId = session?.session.activeOrganizationId ?? "";
  const ownerOrgs = await getOwnerOrganizations();
  return <GovernmentClient ownerOrgs={ownerOrgs} activeOrgId={activeOrgId} />;
}
