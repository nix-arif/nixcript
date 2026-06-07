import { requirePermission } from "@/lib/auth/require-permission";
import { getConsignmentDetail } from "@/server/consignment";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { notFound } from "next/navigation";
import { ConsignmentDetailClient } from "./consignment-detail-client";

export default async function ConsignmentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("sales-order:read");
  const { id } = await params;

  const [consignment, permissions] = await Promise.all([
    getConsignmentDetail(id),
    getUserPermissions(session.user.id, session.session.activeOrganizationId!),
  ]);

  if (!consignment) notFound();

  return <ConsignmentDetailClient consignment={consignment} permissions={permissions} currentUserId={session.user.id} />;
}
