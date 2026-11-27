import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/require-permission";
import { getCustomerPoDetailCentralized, updateCustomerPoCentralized, getCustomerPoSoLock } from "@/server/customer-purchase-order";
import { getOrgMembers } from "@/server/members";
import { EditCustomerPoClient } from "../../../[id]/edit/edit-customer-po-client";

export default async function CentralizedEditCustomerPoPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("customer-po:update:centralized");
  const currentUserName = session.user.name ?? "";
  const { id } = await params;
  const [cpo, members, soLock] = await Promise.all([
    getCustomerPoDetailCentralized(id),
    getOrgMembers().catch(() => []),
    getCustomerPoSoLock(id).catch(() => null),
  ]);
  if (!cpo) notFound();
  return (
    <EditCustomerPoClient
      cpo={cpo}
      members={members}
      currentUserName={currentUserName}
      updateFn={updateCustomerPoCentralized}
      soLock={soLock}
      detailHref={`/dashboard/sales/customer-po/centralized/${id}`}
    />
  );
}
