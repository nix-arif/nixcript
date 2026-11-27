import { requirePermission } from "@/lib/auth/require-permission";
import { getCachedSession } from "@/lib/auth/cached-session";
import { getOwnerOrgIds } from "@/lib/org/owner-orgs";
import { categoriesOfOrgs } from "@/lib/document-category/inherit";
import { getSalesOrdersCentralized } from "@/server/sales-order";
import { CentralizedSalesOrderClient } from "./centralized-order-client";

export default async function CentralizedSalesOrderPage() {
  await requirePermission("sales-order:read:centralized");
  const orders = await getSalesOrdersCentralized();
  // every company's categories, for the filter chips (matched by name across companies)
  const session = await getCachedSession();
  const orgId = session?.session?.activeOrganizationId;
  const categories = orgId ? await categoriesOfOrgs(await getOwnerOrgIds(orgId)) : [];
  return <CentralizedSalesOrderClient initialOrders={orders} categories={categories} />;
}
