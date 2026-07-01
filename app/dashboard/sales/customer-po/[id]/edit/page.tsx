import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/require-permission";
import { getCustomerPoDetail } from "@/server/customer-purchase-order";
import { getOrgMembers } from "@/server/members";
import { EditCustomerPoClient } from "./edit-customer-po-client";

export default async function EditCustomerPoPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("customer-po:update");
  const currentUserName = session.user.name ?? "";
  const { id } = await params;
  const [cpo, members] = await Promise.all([
    getCustomerPoDetail(id),
    getOrgMembers().catch(() => []),
  ]);
  if (!cpo) notFound();
  return <EditCustomerPoClient cpo={cpo} members={members} currentUserName={currentUserName} />;
}
