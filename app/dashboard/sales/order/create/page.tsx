import { requirePermission } from "@/lib/auth/require-permission";
import { getOrgMembers } from "@/server/members";
import { getExistingDraftSo } from "@/server/sales-order";
import { getCustomerPoForSoCreate, getOpenCustomerPos } from "@/server/customer-purchase-order";
import { CreateSalesOrderClient } from "./create-order-client";
import { redirect } from "next/navigation";

export default async function CreateSalesOrderPage({
  searchParams,
}: {
  searchParams: Promise<{ cpoId?: string | string[] }>;
}) {
  const session = await requirePermission("sales-order:create");
  const currentUserName = session.user.name ?? "";

  const { cpoId } = await searchParams;
  const cpoIds = cpoId ? (Array.isArray(cpoId) ? cpoId : [cpoId]) : [];

  // Only redirect to existing draft if not coming from a CPO
  if (cpoIds.length === 0) {
    const existingDraft = await getExistingDraftSo().catch(() => null);
    if (existingDraft) {
      redirect(`/dashboard/sales/order/${existingDraft.id}?draft=1`);
    }
  }

  const [members, cpos, openCpos] = await Promise.all([
    getOrgMembers().catch(() => []),
    Promise.all(cpoIds.map((id) => getCustomerPoForSoCreate(id).catch(() => null))).then(
      (results) => results.filter((r): r is NonNullable<typeof r> => r !== null)
    ),
    getOpenCustomerPos().catch(() => []),
  ]);

  return <CreateSalesOrderClient members={members} cpos={cpos} openCpos={openCpos} currentUserName={currentUserName} />;
}
