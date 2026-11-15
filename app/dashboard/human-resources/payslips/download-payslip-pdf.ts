"use client";

import { generatePayslipPdf } from "./generate-payslip-pdf";
import { getPayslipYtd } from "@/server/payroll";
import { getPayslipPdfSettings } from "@/server/payslip-pdf-settings";
import { splitLines, lineAmount, type StoredLine } from "@/lib/payroll/build-lines";
import { getFullOrganizationProfile } from "@/server/organization-profile";

export type PayslipPdfSource = {
  id: string;
  userId: string;
  employeeName: string;
  jobTitle?: string | null;
  department?: string | null;
  icNumber?: string | null;
  epfNo?: string | null;
  socsoNo?: string | null;
  employeeTaxNo?: string | null;
  bankName?: string | null;
  bankAccountHolder?: string | null;
  bankAccountNo?: string | null;
  basicSalary: string | null;
  grossPay: string | null;
  totalDeductions: string | null;
  netPay: string | null;
  taxableIncome?: string | null;
  lines: StoredLine[];
};

// Builds and downloads the PDF for one payslip. `period` is the payroll month it belongs to.
export async function downloadPayslipPdf(
  p: PayslipPdfSource,
  period: { label: string; month: number; year: number },
) {
  const [ytd, org, settings] = await Promise.all([
    getPayslipYtd(p.userId, period.year, period.month, p.id),
    getFullOrganizationProfile(),
    getPayslipPdfSettings(),
  ]);
  const parts = splitLines(p.lines);
  await generatePayslipPdf({
    companyName: org.companyName ?? org.name,
    companyAddress: org.companyAddress,
    companyLogo: org.logo,
    companySsmNo: org.newSsmNo ?? org.oldSsmNo,
    companyTaxNo: org.taxNo,

    employeeName: p.employeeName,
    jobTitle: p.jobTitle,
    department: p.department,
    icNumber: p.icNumber,
    epfNo: p.epfNo ?? null,
    socsoNo: p.socsoNo ?? null,
    taxNo: p.employeeTaxNo ?? null,
    bankName: p.bankName ?? null,
    bankAccountHolder: p.bankAccountHolder ?? null,
    bankAccountNo: p.bankAccountNo ?? null,

    periodLabel: period.label,
    periodMonth: period.month,
    periodYear: period.year,

    basicSalary: p.basicSalary,
    earnings: parts.earnings.map((l) => ({ label: l.label, amount: String(l.amount) })),
    grossPay: p.grossPay,
    epfEmployee: String(lineAmount(p.lines, "deduction", "epf")),
    epfEmployer: String(lineAmount(p.lines, "employer", "epf")),
    socsoEmployee: String(lineAmount(p.lines, "deduction", "socso")),
    socsoEmployer: String(lineAmount(p.lines, "employer", "socso")),
    eisEmployee: String(lineAmount(p.lines, "deduction", "eis")),
    eisEmployer: String(lineAmount(p.lines, "employer", "eis")),
    lhdn: String(lineAmount(p.lines, "deduction", "pcb")),
    otherDeductions: parts.deductions.map((l) => ({ label: l.label, amount: String(l.amount) })),
    totalDeductions: p.totalDeductions,
    netPay: p.netPay,
    taxableIncome: p.taxableIncome == null ? null : Number(p.taxableIncome),
    ytdGross: ytd.ytdGross,
    ytdNet: ytd.ytdNet,
    ytdEpfEmployee: ytd.ytdEpfEmployee,
    ytdEpfEmployer: ytd.ytdEpfEmployer,
    ytdSocsoEmployee: ytd.ytdSocsoEmployee,
    ytdSocsoEmployer: ytd.ytdSocsoEmployer,
    ytdEisEmployee: ytd.ytdEisEmployee,
    ytdEisEmployer: ytd.ytdEisEmployer,
    ytdLhdn: ytd.ytdLhdn,
    ytdTotalDeductions: ytd.ytdTotalDeductions,
    ytdTaxableIncome: ytd.ytdTaxableIncome,
    settings,
  });
}
