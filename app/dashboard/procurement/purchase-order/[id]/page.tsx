import { requirePermission } from "@/lib/auth/require-permission";
import { getPurchaseOrderDetail } from "@/server/purchase-order";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { notFound } from "next/navigation";
import { PurchaseOrderDetailClient } from "./po-detail-client";

export default async function PurchaseOrderDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ draft?: string }> }) {
  const session = await requirePermission("purchase-order:read");
  const { id } = await params;
  const { draft } = await searchParams;

  const [order, permissions] = await Promise.all([
    getPurchaseOrderDetail(id),
    getUserPermissions(session.user.id, session.session.activeOrganizationId!),
  ]);

  if (!order) notFound();

  return <PurchaseOrderDetailClient order={order} permissions={permissions} currentUserId={session.user.id} draftRedirected={draft === "1"} />;
}
