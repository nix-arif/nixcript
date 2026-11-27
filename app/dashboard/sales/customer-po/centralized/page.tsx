import { requirePermission } from "@/lib/auth/require-permission";
import { getCachedSession } from "@/lib/auth/cached-session";
import { getOwnerOrgIds } from "@/lib/org/owner-orgs";
import { categoriesOfOrgs } from "@/lib/document-category/inherit";
import { getCustomerPosCentralized } from "@/server/customer-purchase-order";
import { CentralizedCustomerPoClient } from "./centralized-po-client";

export default async function CentralizedCustomerPoPage() {
  await requirePermission("customer-po:read:centralized");
  const pos = await getCustomerPosCentralized();
  // every company's categories, for the filter chips (matched by name across companies)
  const session = await getCachedSession();
  const orgId = session?.session?.activeOrganizationId;
  const categories = orgId ? await categoriesOfOrgs(await getOwnerOrgIds(orgId)) : [];
  return <CentralizedCustomerPoClient initialPos={pos} categories={categories} />;
}
