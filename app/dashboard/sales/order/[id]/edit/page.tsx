import { requirePermission } from "@/lib/auth/require-permission";
import { getSalesOrderDetail } from "@/server/sales-order";
import { getOrgMembers } from "@/server/members";
import { notFound } from "next/navigation";
import { EditSalesOrderClient } from "./edit-order-client";

export default async function EditSalesOrderPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("sales-order:update");
  const { id } = await params;
  const [order, members] = await Promise.all([
    getSalesOrderDetail(id),
    getOrgMembers(),
  ]);
  if (!order) notFound();

  return <EditSalesOrderClient order={order} members={members} />;
}
