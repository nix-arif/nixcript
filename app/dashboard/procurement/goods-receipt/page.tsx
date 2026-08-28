import { requirePermission } from "@/lib/auth/require-permission";
import { getAllGoodsReceipts, getPendingReturnsAndRepairs } from "@/server/goods-receipt";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { getCachedSession } from "@/lib/auth/cached-session";
import { GoodsReceiptListClient } from "./goods-receipt-list-client";

export default async function GoodsReceiptsPage() {
  await requirePermission("purchase-order:read");
  const session = await getCachedSession();
  const orgId = session!.session.activeOrganizationId!;
  const [grs, pendingReturnsRepairs, permissions] = await Promise.all([
    getAllGoodsReceipts(),
    getPendingReturnsAndRepairs(),
    getUserPermissions(session!.user.id, orgId),
  ]);
  return <GoodsReceiptListClient initialGrs={grs} pendingReturnsRepairs={pendingReturnsRepairs} permissions={permissions} />;
}
