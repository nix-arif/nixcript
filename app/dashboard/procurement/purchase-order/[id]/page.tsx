import { requirePermission } from "@/lib/auth/require-permission";
import { getPurchaseOrderDetail, getPurchaseOrderRecallBlockers, getPurchaseOrderDeleteBlocker } from "@/server/purchase-order";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { getOrganizationProfile } from "@/server/organization-profile";
import { notFound } from "next/navigation";
import { PurchaseOrderDetailClient } from "./po-detail-client";

export default async function PurchaseOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("purchase-order:read");
  const { id } = await params;

  const [order, permissions, profile] = await Promise.all([
    getPurchaseOrderDetail(id),
    getUserPermissions(session.user.id, session.session.activeOrganizationId!),
    getOrganizationProfile().catch(() => null),
  ]);

  if (!order) notFound();

  const recallBlockers = order.status === "confirmed" ? await getPurchaseOrderRecallBlockers(id).catch(() => []) : [];
  const deleteBlocker = !order.approvedAt && (order.status === "draft" || order.status === "cancelled")
    ? await getPurchaseOrderDeleteBlocker(id).catch(() => null)
    : null;

  return (
    <PurchaseOrderDetailClient
      order={order}
      permissions={permissions}
      currentUserId={session.user.id}
      businessType={profile?.businessType ?? "trading"}
      recallBlockers={recallBlockers}
      deleteBlocker={deleteBlocker}
    />
  );
}
