import { requirePermission } from "@/lib/auth/require-permission";
import { getCustomerPoForTrackingCentralized } from "@/server/customer-purchase-order";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { notFound } from "next/navigation";
import { CustomerPoDetailClient } from "../../[id]/customer-po-detail-client";

export default async function CentralizedCustomerPoDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("customer-po:read:centralized");
  const { id } = await params;

  const [data, permissions] = await Promise.all([
    getCustomerPoForTrackingCentralized(id),
    getUserPermissions(session.user.id, session.session.activeOrganizationId!),
  ]);
  if (!data) notFound();

  const canEdit = permissions.includes("*") || permissions.includes("customer-po:update:centralized");
  const { organizationName, ...tracking } = data;
  return (
    <CustomerPoDetailClient
      data={tracking}
      permissions={[]}
      backHref="/dashboard/sales/customer-po/centralized"
      organizationName={organizationName}
      editHref={canEdit ? `/dashboard/sales/customer-po/centralized/${id}/edit` : undefined}
    />
  );
}
