import { requirePermission } from "@/lib/auth/require-permission";
import { getCustomerPoForTrackingCentralized } from "@/server/customer-purchase-order";
import { notFound } from "next/navigation";
import { FulfilmentTrailClient } from "../../../[id]/fulfilment-trail";

export default async function CentralizedCustomerPoTrailPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("customer-po:read:centralized");
  const { id } = await params;

  const data = await getCustomerPoForTrackingCentralized(id);
  if (!data) notFound();

  // No permissions here, matching the centralized detail page — so no
  // "Create Sales Order" shortcut from a cross-org view.
  return (
    <FulfilmentTrailClient
      data={data}
      permissions={[]}
      backHref={`/dashboard/sales/customer-po/centralized/${id}`}
      organizationName={data.organizationName}
    />
  );
}
