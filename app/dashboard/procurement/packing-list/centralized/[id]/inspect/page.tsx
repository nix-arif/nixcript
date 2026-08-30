import { notFound, redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/require-permission";
import { getPackingListDetailCentralized, completePackingListInspectionCentralized, canApprovePackingListInspection } from "@/server/packing-list";
import { InspectPackingListClient } from "../../../[id]/inspect/inspect-packing-list-client";

export default async function CentralizedInspectPackingListPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("packing-list:read:centralized");
  const { id } = await params;

  const data = await getPackingListDetailCentralized(id);
  if (!data) notFound();
  if (!data.canInspect || data.status !== "pending") redirect(`/dashboard/procurement/packing-list/centralized/${id}`);

  const { organizationName, businessType, ...packingList } = data;
  const canApprove = await canApprovePackingListInspection(packingList.organizationId);

  return (
    <InspectPackingListClient
      packingList={packingList}
      businessType={businessType}
      submitFn={completePackingListInspectionCentralized}
      backHref={`/dashboard/procurement/packing-list/centralized/${id}`}
      organizationName={organizationName}
      canApprove={canApprove}
    />
  );
}
