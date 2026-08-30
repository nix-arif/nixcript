import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/require-permission";
import { getGoodsReceiptDetailCentralized } from "@/server/goods-receipt";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { getCachedSession } from "@/lib/auth/cached-session";
import { GoodsReceiptDetailClient } from "../../[grId]/gr-detail-client";

export default async function CentralizedGoodsReceiptDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePermission("goods-receipt:read:centralized");
  const { id } = await params;
  const session = await getCachedSession();
  const orgId = session!.session.activeOrganizationId!;
  const [gr, permissions] = await Promise.all([
    getGoodsReceiptDetailCentralized(id),
    getUserPermissions(session!.user.id, orgId),
  ]);
  if (!gr) notFound();
  const { organizationName, isOwnOrg, canAct, ...rest } = gr;
  return (
    <GoodsReceiptDetailClient
      gr={rest}
      permissions={permissions}
      organizationName={organizationName}
      backHref="/dashboard/procurement/goods-receipt/centralized"
      canAct={canAct}
      isOwnOrg={isOwnOrg}
    />
  );
}
