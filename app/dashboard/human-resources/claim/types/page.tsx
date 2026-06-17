import { requirePermission } from "@/lib/auth/require-permission";
import { getClaimTypes, getClaimCategoryAccounts } from "@/server/claim";
import { getLedgerAccounts } from "@/server/ledger";
import { ClaimTypesClient } from "./claim-types-client";

export default async function ClaimTypesPage() {
  await requirePermission("claim:manage");
  const [claimTypes, accounts, categoryMappings] = await Promise.all([
    getClaimTypes(),
    getLedgerAccounts(),
    getClaimCategoryAccounts(),
  ]);
  const expenseAccounts = accounts.filter((a) => a.type === "EXPENSE" && a.isActive);
  return (
    <ClaimTypesClient
      claimTypes={claimTypes}
      expenseAccounts={expenseAccounts}
      initialCategoryMappings={categoryMappings}
    />
  );
}
