import { requirePermission } from "@/lib/auth/require-permission";
import { getOrgMembers } from "@/server/members";
import { getExistingDraftSo } from "@/server/sales-order";
import { getCustomerPoForSoCreate, getOpenCustomerPos } from "@/server/customer-purchase-order";
import { CreateSalesOrderClient } from "./create-order-client";
import { redirect } from "next/navigation";

export default async function CreateSalesOrderPage({
  searchParams,
}: {
  searchParams: Promise<{ cpoId?: string }>;
}) {
  const session = await requirePermission("sales-order:create");
  const currentUserName = session.user.name ?? "";

  const { cpoId } = await searchParams;

  // Only redirect to existing draft if not coming from a CPO
  if (!cpoId) {
    const existingDraft = await getExistingDraftSo().catch(() => null);
    if (existingDraft) {
      redirect(`/dashboard/sales/order/${existingDraft.id}?draft=1`);
    }
  }

  const [members, cpo, openCpos] = await Promise.all([
    getOrgMembers().catch(() => []),
    cpoId ? getCustomerPoForSoCreate(cpoId).catch(() => null) : Promise.resolve(null),
    getOpenCustomerPos().catch(() => []),
  ]);

  return <CreateSalesOrderClient members={members} cpo={cpo} openCpos={openCpos} currentUserName={currentUserName} />;
}
