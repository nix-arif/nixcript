import { requirePermission } from "@/lib/auth/require-permission";
import { getAllAllowances, getOwnerOrgMembers } from "@/server/invoice-allowance";
import { AllAllowancesClient } from "./all-allowances-client";

export default async function AllAllowancesPage() {
  await requirePermission("allowance:read:all");
  const [rows, members] = await Promise.all([
    getAllAllowances(),
    getOwnerOrgMembers().catch(() => []),
  ]);
  return <AllAllowancesClient rows={rows} members={members} />;
}
