import { requirePermission } from "@/lib/auth/require-permission";
import { getCustomerPoForTracking } from "@/server/customer-purchase-order";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { notFound } from "next/navigation";
import { CustomerPoDetailClient } from "./customer-po-detail-client";

export default async function CustomerPoDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("customer-po:read");
  const { id } = await params;

  const [data, permissions] = await Promise.all([
    getCustomerPoForTracking(id),
    getUserPermissions(session.user.id, session.session.activeOrganizationId!),
  ]);

  if (!data) notFound();

  return <CustomerPoDetailClient data={data} permissions={permissions} />;
}
