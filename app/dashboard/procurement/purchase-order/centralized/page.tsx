import { cookies } from "next/headers";
import { requirePermission } from "@/lib/auth/require-permission";
import { getPurchaseOrdersCentralized } from "@/server/purchase-order";
import { CentralizedPurchaseOrderClient } from "./centralized-po-client";

export default async function CentralizedPurchaseOrderPage() {
  const session = await requirePermission("purchase-order:read:centralized");
  const [pos, jar] = await Promise.all([getPurchaseOrdersCentralized(), cookies()]);
  // The user's last sort choice, so the list opens the way they left it —
  // one cookie per user, so people sharing a browser keep their own
  const cookieName = `supplier_po_sort_${session.user.id}`;
  return <CentralizedPurchaseOrderClient initialPos={pos} initialSort={jar.get(cookieName)?.value ?? null} sortCookie={cookieName} />;
}
