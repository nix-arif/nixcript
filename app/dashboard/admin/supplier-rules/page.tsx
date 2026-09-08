import { requireOwner } from "@/lib/auth/require-permission";
import {
  getRestrictedSupplierRules,
  getOwnerOrganizationsForRules,
  getSupplierNamesForRules,
} from "@/server/supplier-restrictions";
import { SupplierRulesClient } from "./supplier-rules-client";

export default async function SupplierRulesPage() {
  await requireOwner();

  const [rules, ownerOrganizations, supplierNames] = await Promise.all([
    getRestrictedSupplierRules(),
    getOwnerOrganizationsForRules(),
    getSupplierNamesForRules(),
  ]);

  return (
    <SupplierRulesClient
      initialRules={rules}
      ownerOrganizations={ownerOrganizations}
      supplierNames={supplierNames}
    />
  );
}
