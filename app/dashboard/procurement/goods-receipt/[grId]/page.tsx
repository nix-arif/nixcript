import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/require-permission";
import { getGoodsReceiptDetail } from "@/server/goods-receipt";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { getCachedSession } from "@/lib/auth/cached-session";
import { GoodsReceiptDetailClient } from "./gr-detail-client";

export default async function GoodsReceiptDetailPage({
  params,
}: {
  params: Promise<{ grId: string }>;
}) {
  await requirePermission("purchase-order:read");
  const { grId } = await params;
  const session = await getCachedSession();
  const orgId = session!.session.activeOrganizationId!;
  const [gr, permissions] = await Promise.all([
    getGoodsReceiptDetail(grId),
    getUserPermissions(session!.user.id, orgId),
  ]);
  if (!gr) notFound();
  return <GoodsReceiptDetailClient gr={gr} permissions={permissions} />;
}
