import { requirePermission } from "@/lib/auth/require-permission";
import { getSalesOrderDetail, getSalesOrderDeleteBlockers } from "@/server/sales-order";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";
import { getOrgMembers } from "@/server/members";
import { getOpenCustomerPos } from "@/server/customer-purchase-order";
import { getOrganizationProfile } from "@/server/organization-profile";
import { redirect } from "next/navigation";
import { EditSalesOrderClient } from "./edit-order-client";

export default async function EditSalesOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("sales-order:update");
  const { id } = await params;
  const [order, members, openCpos, profile] = await Promise.all([
    getSalesOrderDetail(id),
    getOrgMembers().catch(() => []),
    getOpenCustomerPos().catch(() => []),
    getOrganizationProfile().catch(() => null),
  ]);
  // deleted (or never there): back to the list, which says so — not a 404
  if (!order) redirect("/dashboard/sales/order?gone=1");
  if (order.createdBy !== session.user.id) redirect(`/dashboard/sales/order/${id}`);
  if (order.status === "submitted" || order.status === "confirmed") {
    redirect(`/dashboard/sales/order/${id}`);
  }

  // Delete, by the SO page's rules: the creator (checked above), sales-order:delete,
  // and nothing raised from it
  const [perms, deleteBlockers] = await Promise.all([
    getUserPermissions(session.user.id, session.session.activeOrganizationId!),
    getSalesOrderDeleteBlockers([id]).catch(() => ({} as Record<string, string>)),
  ]);
  const canDelete = hasAccess(perms, "sales-order:delete") && !deleteBlockers[id];

  return (
    <EditSalesOrderClient
      canDelete={canDelete}
      order={order}
      members={members}
      currentUserName={session.user.name ?? ""}
      openCpos={openCpos}
      businessType={profile?.businessType ?? "trading"}
    />
  );
}
