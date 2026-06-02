import { requirePermission } from "@/lib/auth/require-permission";
import { getOrgMembers } from "@/server/members";
import { CreateSalesOrderClient } from "./create-order-client";

export default async function CreateSalesOrderPage() {
  await requirePermission("sales-order:create");
  const members = await getOrgMembers().catch(() => []);
  return <CreateSalesOrderClient members={members} />;
}
