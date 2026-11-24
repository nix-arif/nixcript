import { requirePermission } from "@/lib/auth/require-permission";
import { getCustomerPoForTracking } from "@/server/customer-purchase-order";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { getTrailActions } from "@/server/trail-actions";
import { notFound } from "next/navigation";
import { FulfilmentTrailClient } from "../fulfilment-trail";

export default async function CustomerPoTrailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("customer-po:read");
  const { id } = await params;

  const [data, permissions, actions] = await Promise.all([
    getCustomerPoForTracking(id),
    getUserPermissions(session.user.id, session.session.activeOrganizationId!),
    getTrailActions(id).catch(() => null),
  ]);

  if (!data) notFound();

  return <FulfilmentTrailClient data={data} permissions={permissions} backHref={`/dashboard/sales/customer-po/${id}`} actions={actions} />;
}
