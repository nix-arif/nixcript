import { requirePermission } from "@/lib/auth/require-permission";
import { getSalesOrderDetail } from "@/server/sales-order";
import { getOrgMembers } from "@/server/members";
import { notFound, redirect } from "next/navigation";
import { EditSalesOrderClient } from "./edit-order-client";

export default async function EditSalesOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("sales-order:update");
  const { id } = await params;
  const [order, members] = await Promise.all([
    getSalesOrderDetail(id),
    getOrgMembers().catch(() => []),
  ]);
  if (!order) notFound();
  if (order.createdBy !== session.user.id) redirect(`/dashboard/sales/order/${id}`);
  if (order.status === "submitted" || order.status === "confirmed") {
    redirect(`/dashboard/sales/order/${id}`);
  }

  return <EditSalesOrderClient order={order} members={members} currentUserName={session.user.name ?? ""} />;
}
