import { requireAnyPermission } from "@/lib/auth/require-permission";
import { hasAccess } from "@/lib/permissions/has-access";
import { INTERCOMPANY_MANAGE, INTERCOMPANY_READ } from "@/lib/auth/intercompany-access";
import {
  getRestrictedSupplierRules,
  getOwnerOrganizationsForRules,
  getSupplierNamesForRules,
} from "@/server/supplier-restrictions";
import { getPricingAdminData } from "@/server/intercompany-pricing";
import { SupplierRulesClient, type IntercompanyTab } from "./supplier-rules-client";

const TABS: IntercompanyTab[] = ["suppliers", "pricing", "prices"];

export default async function SupplierRulesPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { perms } = await requireAnyPermission([INTERCOMPANY_READ, INTERCOMPANY_MANAGE]);
  const { tab } = await searchParams;

  const [rules, ownerOrganizations, supplierNames, pricing] = await Promise.all([
    getRestrictedSupplierRules(),
    getOwnerOrganizationsForRules(),
    getSupplierNamesForRules(),
    getPricingAdminData(),
  ]);

  return (
    <SupplierRulesClient
      canManage={hasAccess(perms, INTERCOMPANY_MANAGE)}
      initialTab={TABS.includes(tab as IntercompanyTab) ? (tab as IntercompanyTab) : "suppliers"}
      initialRules={rules}
      ownerOrganizations={ownerOrganizations}
      supplierNames={supplierNames}
      initialPricing={pricing}
    />
  );
}
