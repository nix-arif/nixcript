import { requirePermission } from "@/lib/auth/require-permission";
import {
  getCategoryAllowanceRates, getAllowanceSettings, getPublicHolidays,
  getMemberAllowanceRates, getOrgMemberOptions,
} from "@/server/category-allowance-rate";
import { AllowanceRatesClient } from "./rates-client";

export default async function AllowanceRatesPage() {
  await requirePermission("allowance:manage");
  const [rates, settings, holidays, memberRates, members] = await Promise.all([
    getCategoryAllowanceRates(),
    getAllowanceSettings(),
    getPublicHolidays(),
    getMemberAllowanceRates(),
    getOrgMemberOptions(),
  ]);
  return (
    <AllowanceRatesClient
      rates={rates}
      settings={settings}
      holidays={holidays}
      memberRates={memberRates}
      members={members}
    />
  );
}
