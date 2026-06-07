import { requirePermission } from "@/lib/auth/require-permission";
import { getSalesOrderDetail } from "@/server/sales-order";
import { notFound, redirect } from "next/navigation";
import { CreateConsignmentClient } from "./create-consignment-client";

export default async function CreateConsignmentPage({ searchParams }: { searchParams: Promise<{ soId?: string; soNo?: string }> }) {
  await requirePermission("sales-order:update");
  const { soId, soNo } = await searchParams;

  if (!soId) redirect("/dashboard/sales/consignment");

  const so = await getSalesOrderDetail(soId);
  if (!so) notFound();
  if (so.status !== "confirmed") redirect(`/dashboard/sales/order/${soId}`);

  return <CreateConsignmentClient so={so} />;
}
