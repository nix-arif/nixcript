import { requirePermission } from "@/lib/auth/require-permission";
import { getCategoryAllowanceRates, getAllowanceSettings, getPublicHolidays } from "@/server/category-allowance-rate";
import { AllowanceRatesClient } from "./rates-client";

export default async function AllowanceRatesPage() {
  await requirePermission("allowance:manage");
  const [rates, settings, holidays] = await Promise.all([
    getCategoryAllowanceRates(),
    getAllowanceSettings(),
    getPublicHolidays(),
  ]);
  return <AllowanceRatesClient rates={rates} settings={settings} holidays={holidays} />;
}
