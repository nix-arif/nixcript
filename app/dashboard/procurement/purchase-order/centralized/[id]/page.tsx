import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/require-permission";
import { getPurchaseOrderDetailCentralized } from "@/server/purchase-order";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { PurchaseOrderDetailClient } from "../../[id]/po-detail-client";

export default async function CentralizedPurchaseOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("purchase-order:read:centralized");
  const { id } = await params;

  const [data, permissions] = await Promise.all([
    getPurchaseOrderDetailCentralized(id),
    getUserPermissions(session.user.id, session.session.activeOrganizationId!),
  ]);
  if (!data) notFound();

  const { organizationName, canEdit, businessType, ...order } = data;
  return (
    <PurchaseOrderDetailClient
      order={order}
      permissions={[]}
      currentUserId={session.user.id}
      businessType={businessType}
      backHref="/dashboard/procurement/purchase-order/centralized"
      organizationName={organizationName}
      editHref={canEdit ? `/dashboard/procurement/purchase-order/centralized/${id}/edit` : undefined}
      hidePricing={!canEdit}
      canEditPoNumber={permissions.includes("*")}
    />
  );
}
