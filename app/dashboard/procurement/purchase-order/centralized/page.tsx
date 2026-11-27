import { cookies } from "next/headers";
import { requirePermission } from "@/lib/auth/require-permission";
import { getPurchaseOrdersCentralized } from "@/server/purchase-order";
import { CentralizedPurchaseOrderClient } from "./centralized-po-client";
import { getOwnerOrgIds } from "@/lib/org/owner-orgs";
import { categoriesOfOrgs } from "@/lib/document-category/inherit";

export default async function CentralizedPurchaseOrderPage() {
  const session = await requirePermission("purchase-order:read:centralized");
  const [pos, jar, categories] = await Promise.all([
    getPurchaseOrdersCentralized(),
    cookies(),
    // every company's categories, for the filter chips (matched by name across companies)
    getOwnerOrgIds(session.session.activeOrganizationId!).then(categoriesOfOrgs),
  ]);
  // The user's last sort choice, so the list opens the way they left it —
  // one cookie per user, so people sharing a browser keep their own
  const cookieName = `supplier_po_sort_${session.user.id}`;
  return <CentralizedPurchaseOrderClient initialPos={pos} initialSort={jar.get(cookieName)?.value ?? null} sortCookie={cookieName} categories={categories} />;
}
