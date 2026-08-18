import { requirePermission } from "@/lib/auth/require-permission";
import { getSalesOrderDetailCentralized, updateSalesOrderCentralized } from "@/server/sales-order";
import { getOrgMembers } from "@/server/members";
import { getOpenCustomerPos } from "@/server/customer-purchase-order";
import { getOrganizationProfile } from "@/server/organization-profile";
import { notFound, redirect } from "next/navigation";
import { EditSalesOrderClient } from "../../../[id]/edit/edit-order-client";

export default async function CentralizedEditSalesOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("sales-order:update:centralized");
  const { id } = await params;
  const [data, members, openCpos, profile] = await Promise.all([
    getSalesOrderDetailCentralized(id),
    getOrgMembers().catch(() => []),
    getOpenCustomerPos().catch(() => []),
    getOrganizationProfile().catch(() => null),
  ]);
  if (!data) notFound();
  if (data.createdBy !== session.user.id) redirect(`/dashboard/sales/order/centralized/${id}`);
  if (data.status === "submitted" || data.status === "confirmed") {
    redirect(`/dashboard/sales/order/centralized/${id}`);
  }

  return (
    <EditSalesOrderClient
      order={data}
      members={members}
      currentUserName={session.user.name ?? ""}
      openCpos={openCpos}
      updateFn={updateSalesOrderCentralized}
      detailHref={`/dashboard/sales/order/centralized/${id}`}
      businessType={profile?.businessType ?? "trading"}
    />
  );
}
