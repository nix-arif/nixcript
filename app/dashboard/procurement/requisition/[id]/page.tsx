import { requirePermission } from "@/lib/auth/require-permission";
import { getPurchaseRequisitionDetail } from "@/server/purchase-requisition";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { notFound } from "next/navigation";
import { PrDetailClient } from "./pr-detail-client";

export default async function PrDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("purchase-order:read");
  const { id } = await params;

  const [pr, permissions] = await Promise.all([
    getPurchaseRequisitionDetail(id),
    getUserPermissions(session.user.id, session.session.activeOrganizationId!),
  ]);

  if (!pr) notFound();

  return <PrDetailClient pr={pr} permissions={permissions} currentUserId={session.user.id} currentUserName={session.user.name ?? ""} />;
}
