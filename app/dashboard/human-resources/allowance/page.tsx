import { requirePermission } from "@/lib/auth/require-permission";
import { getMyAllowances } from "@/server/invoice-allowance";
import { MyAllowancesClient } from "./allowance-client";

export default async function MyAllowancesPage() {
  await requirePermission("allowance:read:own");
  const rows = await getMyAllowances();
  return <MyAllowancesClient rows={rows} />;
}
