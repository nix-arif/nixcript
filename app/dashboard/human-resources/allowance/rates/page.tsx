import { requirePermission } from "@/lib/auth/require-permission";
import {
  getCategoryAllowanceRates, getAllowanceSettings,
  getMemberAllowanceRates, getOrgMemberOptions,
} from "@/server/category-allowance-rate";
import { AllowanceRatesClient } from "./rates-client";

export default async function AllowanceRatesPage() {
  await requirePermission("allowance:manage");
  const [rates, settings, memberRates, members] = await Promise.all([
    getCategoryAllowanceRates(),
    getAllowanceSettings(),
    getMemberAllowanceRates(),
    getOrgMemberOptions(),
  ]);
  return (
    <AllowanceRatesClient
      rates={rates}
      settings={settings}
      memberRates={memberRates}
      members={members}
    />
  );
}
