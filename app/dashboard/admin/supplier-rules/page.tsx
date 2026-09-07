import { requireOwner } from "@/lib/auth/require-permission";
import { getRestrictedSupplierRules, getOwnerOrganizationsForRules } from "@/server/supplier-restrictions";
import { SupplierRulesClient } from "./supplier-rules-client";

export default async function SupplierRulesPage() {
  await requireOwner();

  const [rules, ownerOrganizations] = await Promise.all([
    getRestrictedSupplierRules(),
    getOwnerOrganizationsForRules(),
  ]);

  return (
    <SupplierRulesClient initialRules={rules} ownerOrganizations={ownerOrganizations} />
  );
}
