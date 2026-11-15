import { requirePermission } from "@/lib/auth/require-permission";
import { getPayItems, getCommissionTypeOptions, getSalaryStructures } from "@/server/payroll";
import { getTaxReliefTypes } from "@/server/tax-relief";
import { getPdfSiblingOrgs, getPayslipPdfSettings } from "@/server/payslip-pdf-settings";
import { PayslipSettingsClient } from "./payslip-settings-client";

export default async function PayslipSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  await requirePermission("payslip:create");
  const { tab } = await searchParams;
  const [items, commissionTypes, structures, pdfSettings, reliefTypes, siblingOrgs] = await Promise.all([
    getPayItems(),
    getCommissionTypeOptions(),
    getSalaryStructures(),
    getPayslipPdfSettings(),
    getTaxReliefTypes(),
    getPdfSiblingOrgs(),
  ]);
  return (
    <PayslipSettingsClient
      initialItems={items}
      commissionTypes={commissionTypes}
      structures={structures}
      pdfSettings={pdfSettings}
      reliefTypes={reliefTypes}
      siblingOrgs={siblingOrgs}
      initialTab={tab === "structure" ? "structure" : tab === "pdf" ? "pdf" : tab === "relief" ? "relief" : "items"}
    />
  );
}
