import { requirePermission } from "@/lib/auth/require-permission";
import { getCachedSession } from "@/lib/auth/cached-session";
import { getOwnerOrgIds } from "@/lib/org/owner-orgs";
import { categoriesOfOrgs } from "@/lib/document-category/inherit";
import { getCustomerPosCentralized } from "@/server/customer-purchase-order";
import { CentralizedCustomerPoClient } from "../centralized-po-client";

// Intercompany POs: the Customer POs auto-created in a receiving org when a
// sibling org confirms a PO to it — kept off the centralized Customer POs
// page so that list shows real customers only.
export default async function CentralizedIntercompanyPoPage() {
  await requirePermission("customer-po:read:centralized");
  const pos = await getCustomerPosCentralized("intercompany");
  // every company's categories, for the filter chips (matched by name across companies)
  const session = await getCachedSession();
  const orgId = session?.session?.activeOrganizationId;
  const categories = orgId ? await categoriesOfOrgs(await getOwnerOrgIds(orgId)) : [];
  return <CentralizedCustomerPoClient initialPos={pos} kind="intercompany" categories={categories} />;
}
