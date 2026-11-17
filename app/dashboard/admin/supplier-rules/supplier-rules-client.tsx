"use client";

import { useState } from "react";
import { getRestrictedSupplierRules, type RestrictedSupplierRule } from "@/server/supplier-restrictions";
import { getPricingAdminData } from "@/server/intercompany-pricing";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/page-header";
import { ArrowRightIcon, BuildingIcon, FactoryIcon, TagsIcon } from "lucide-react";
import { HandlingPanel } from "./handling-panel";
import { PricingRulesPanel } from "./pricing-rules-panel";
import { PriceListPanel } from "./price-list-panel";

export type IntercompanyTab = "suppliers" | "pricing" | "prices";
export type PricingData = Awaited<ReturnType<typeof getPricingAdminData>>;

interface Props {
  canManage: boolean;
  initialTab: IntercompanyTab;
  initialRules: RestrictedSupplierRule[];
  ownerOrganizations: { id: string; name: string }[];
  supplierNames: string[];
  initialPricing: PricingData;
}

function Count({ n }: { n: number }) {
  return <span className="rounded-full bg-muted px-1.5 py-px text-[10px] font-semibold tabular-nums text-muted-foreground">{n}</span>;
}

export function SupplierRulesClient({ canManage, initialTab, initialRules, ownerOrganizations, supplierNames, initialPricing }: Props) {
  const [tab, setTab] = useState<IntercompanyTab>(initialTab);
  const [rules, setRules] = useState(initialRules);
  const [pricing, setPricing] = useState(initialPricing);
  const reloadRules = async () => setRules(await getRestrictedSupplierRules());
  const reloadPricing = async () => setPricing(await getPricingAdminData());

  const changeTab = (v: string) => {
    setTab(v as IntercompanyTab);
    try { window.history.replaceState(null, "", `?tab=${v}`); } catch { /* the tab still works without the URL */ }
  };

  return (
    <div className="p-4 sm:p-6 max-w-5xl">
      <PageHeader
        title="Intercompany Purchasing"
        description="How your organizations buy from shared suppliers and from each other"
        action={!canManage ? <span className="rounded-md border border-border bg-muted/40 px-2.5 py-1 text-xs text-muted-foreground">View only</span> : undefined}
      />

      {ownerOrganizations.length < 2 ? (
        <div className="border border-border rounded-xl py-16 text-center text-muted-foreground">
          <BuildingIcon className="w-8 h-8 mx-auto mb-3 opacity-30" />
          <div className="text-sm font-medium mb-1">Only one organization</div>
          <div className="text-xs">These settings apply when you own more than one organization.</div>
        </div>
      ) : (
        <>
          {/* the idea in one line, so each tab makes sense on its own */}
          <div className="mb-5 rounded-xl border border-border bg-muted/20 px-4 py-3">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs">
              <span className="rounded-md border border-border bg-background px-2 py-1 font-medium">Any of your organizations</span>
              <ArrowRightIcon className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-muted-foreground">PO at the price you set</span>
              <ArrowRightIcon className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="rounded-md border border-indigo-200 bg-indigo-50 px-2 py-1 font-medium text-indigo-700 dark:border-indigo-800 dark:bg-indigo-900/20 dark:text-indigo-400">Organization that handles the supplier</span>
              <ArrowRightIcon className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-muted-foreground">its own PO</span>
              <ArrowRightIcon className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="rounded-md border border-border bg-background px-2 py-1 font-medium">Supplier</span>
            </div>
          </div>

          <Tabs value={tab} onValueChange={changeTab}>
            <TabsList className="flex-wrap">
              <TabsTrigger value="suppliers"><FactoryIcon className="h-3.5 w-3.5" />Supplier handling <Count n={rules.length} /></TabsTrigger>
              <TabsTrigger value="pricing"><BuildingIcon className="h-3.5 w-3.5" />Pricing between organizations <Count n={pricing.rules.length} /></TabsTrigger>
              <TabsTrigger value="prices"><TagsIcon className="h-3.5 w-3.5" />Price list <Count n={pricing.prices.length} /></TabsTrigger>
            </TabsList>

            <TabsContent value="suppliers">
              <HandlingPanel canManage={canManage} rules={rules} orgs={ownerOrganizations} supplierNames={supplierNames} reload={reloadRules} />
            </TabsContent>
            <TabsContent value="pricing">
              <PricingRulesPanel canManage={canManage} data={pricing} supplierRules={rules} reload={reloadPricing} goToPrices={() => changeTab("prices")} />
            </TabsContent>
            <TabsContent value="prices">
              <PriceListPanel canManage={canManage} data={pricing} reload={reloadPricing} />
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}
