import { requirePermission } from "@/lib/auth/require-permission";
import { getOrgMembers } from "@/server/members";
import { getExistingDraftSo } from "@/server/sales-order";
import { CreateSalesOrderClient } from "./create-order-client";
import { redirect } from "next/navigation";

export default async function CreateSalesOrderPage() {
  await requirePermission("sales-order:create");

  const existingDraft = await getExistingDraftSo().catch(() => null);
  if (existingDraft) {
    redirect(`/dashboard/sales/order/${existingDraft.id}?draft=1`);
  }

  const members = await getOrgMembers().catch(() => []);
  return <CreateSalesOrderClient members={members} />;
}
