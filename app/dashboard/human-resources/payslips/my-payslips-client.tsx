"use client";

import { useState } from "react";
import { getMyPayslips } from "@/server/payroll";
import { Button } from "@/components/ui/button";
import { DownloadIcon, EyeIcon, FileTextIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { generatePayslipPdf } from "./generate-payslip-pdf";
import { getPayslipYtd } from "@/server/payroll";
import {
  getFullOrganizationProfile,
  getLogoAsBase64,
} from "@/server/organization-profile";
import { toast } from "sonner";

type Payslip = Awaited<ReturnType<typeof getMyPayslips>>[number];

const fmt = (v: string | number | null | undefined) =>
  `RM ${Number(v ?? 0).toLocaleString("en-MY", { minimumFractionDigits: 2 })}`;

interface Props {
  payslips: Payslip[];
}

export function MyPayslipsClient({ payslips }: Props) {
  const [selected, setSelected] = useState<Payslip | null>(
    payslips.length > 0 ? payslips[0] : null,
  );
  const [generating, setGenerating] = useState<string | null>(null);

  const latest = payslips[0];
  const ytd = payslips.reduce((s, p) => s + Number(p.netPay), 0);

  // const handleDownload = async (p: Payslip) => {
  //   setGenerating(p.id);
  //   try {
  //     // Fetch YTD up to this payslip's month
  //     const [ytd, org, logoData] = await Promise.all([
  //       getPayslipYtd(p.userId, p.periodYear, p.periodMonth),
  //       getFullOrganizationProfile(),
  //       getLogoAsBase64(),
  //     ]);

  //     // Find primary bank
  //     const primaryBank =
  //       org.bankingInfo.find((b) => b.isPrimary) ?? org.bankingInfo[0];

  //   } catch (err: any) {
  //     toast.error(err.message);
  //   } finally {
  //     setGenerating(null);
  //   }
  // };

  const handleDownload = async (p: Payslip) => {
    setGenerating(p.id);
    try {
      const [ytd, org] = await Promise.all([
        getPayslipYtd(p.userId, p.periodYear, p.periodMonth),
        getFullOrganizationProfile(),
      ]);

      console.log("ytd:", ytd);
      console.log("org.logo:", org.logo);
      console.log("generating PDF...");

      await generatePayslipPdf({
        // Company
        companyName: org.companyName ?? org.name,
        companyAddress: org.companyAddress,
        companyLogo: org.logo, // ← just pass the URL string
        companySsmNo: org.newSsmNo ?? org.oldSsmNo,
        companyTaxNo: org.taxNo,

        // Employee
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

        // Period
        periodLabel: p.periodLabel,
        periodMonth: p.periodMonth,
        periodYear: p.periodYear,

        // This month
        basicSalary: p.basicSalary,
        bonus: p.bonus,
        overtimePay: p.overtimePay,
        allowances: p.allowances as any,
        grossPay: p.grossPay,
        epfEmployee: p.epfEmployee,
        epfEmployer: p.epfEmployer,
        socsoEmployee: p.socsoEmployee,
        socsoEmployer: p.socsoEmployer,
        eisEmployee: p.eisEmployee,
        eisEmployer: p.eisEmployer,
        lhdn: p.lhdn,
        otherDeductions: p.otherDeductions as any,
        totalDeductions: p.totalDeductions,
        netPay: p.netPay,

        // YTD
        ...ytd,
      });
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setGenerating(null);
    }
  };
  if (payslips.length === 0) {
    return (
      <div className="p-6 max-w-4xl">
        <div className="mb-6">
          <h1 className="text-xl font-semibold tracking-tight">My payslips</h1>
          <p className="text-sm text-muted-foreground mt-1">
            View and download your monthly payslips
          </p>
        </div>
        <div className="py-20 text-center text-muted-foreground border border-border rounded-xl">
          <FileTextIcon className="w-8 h-8 mx-auto mb-3 opacity-20" />
          <div className="text-sm font-medium">No payslips yet</div>
          <div className="text-xs mt-1">
            Your payslips will appear here once HR publishes them
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">My payslips</h1>
        <p className="text-sm text-muted-foreground mt-1">
          View and download your monthly payslips
        </p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        <div className="bg-muted/50 rounded-lg p-4">
          <div className="text-xs text-muted-foreground mb-1">
            Latest net pay
          </div>
          <div className="text-lg font-semibold text-green-600 dark:text-green-400">
            {latest ? fmt(latest.netPay) : "—"}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {latest?.periodLabel}
          </div>
        </div>
        <div className="bg-muted/50 rounded-lg p-4">
          <div className="text-xs text-muted-foreground mb-1">
            Total payslips
          </div>
          <div className="text-2xl font-semibold">{payslips.length}</div>
        </div>
        <div className="bg-muted/50 rounded-lg p-4">
          <div className="text-xs text-muted-foreground mb-1">
            YTD net earnings
          </div>
          <div className="text-lg font-semibold">{fmt(ytd)}</div>
        </div>
      </div>

      {/* History table */}
      <div className="bg-background border border-border rounded-xl overflow-hidden mb-4">
        <div className="px-4 py-3 border-b border-border bg-muted/20">
          <div className="text-sm font-medium">Payslip history</div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-muted/20">
                {["Period", "Basic", "Gross", "Deductions", "Net pay", ""].map(
                  (h) => (
                    <th
                      key={h}
                      className={cn(
                        "px-4 py-2.5 text-xs font-medium text-muted-foreground border-b border-border",
                        ["Basic", "Gross", "Deductions", "Net pay"].includes(h)
                          ? "text-right"
                          : "text-left",
                      )}
                    >
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {payslips.map((p, i) => (
                <tr
                  key={p.id}
                  className={cn(
                    i < payslips.length - 1 ? "border-b border-border" : "",
                    selected?.id === p.id
                      ? "bg-primary/5"
                      : i % 2 === 1
                        ? "bg-muted/10"
                        : "",
                    "cursor-pointer hover:bg-muted/20 transition-colors",
                  )}
                  onClick={() => setSelected(p)}
                >
                  <td className="px-4 py-3">
                    <div className="font-medium">{p.periodLabel}</div>
                    {i === 0 && (
                      <div className="text-xs text-primary mt-0.5">Latest</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-xs tabular-nums">
                    {fmt(p.basicSalary)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-xs tabular-nums">
                    {fmt(p.grossPay)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-xs tabular-nums text-red-600 dark:text-red-400">
                    -{fmt(p.totalDeductions)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-xs tabular-nums font-semibold text-green-600 dark:text-green-400">
                    {fmt(p.netPay)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5 justify-end">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 gap-1 text-xs"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelected(p);
                        }}
                      >
                        <EyeIcon className="w-3 h-3" /> View
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 gap-1 text-xs"
                        disabled={generating === p.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDownload(p);
                        }}
                      >
                        {generating === p.id ? (
                          <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                        ) : (
                          <DownloadIcon className="w-3 h-3" />
                        )}
                        PDF
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detail panel */}
      {selected && (
        <div className="bg-background border border-border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border bg-muted/20 flex items-center justify-between">
            <div className="text-sm font-medium">
              {selected.periodLabel} — Detail
            </div>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 h-7 text-xs"
              disabled={generating === selected.id}
              onClick={() => handleDownload(selected)}
            >
              {generating === selected.id ? (
                <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
              ) : (
                <DownloadIcon className="w-3 h-3" />
              )}
              Download PDF
            </Button>
          </div>

          <div className="p-5 grid grid-cols-2 gap-6">
            {/* Earnings */}
            <div>
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
                Earnings
              </div>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Basic salary</span>
                  <span className="font-mono">{fmt(selected.basicSalary)}</span>
                </div>
                {Number(selected.bonus) > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Bonus</span>
                    <span className="font-mono">{fmt(selected.bonus!)}</span>
                  </div>
                )}
                {Number(selected.overtimePay) > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Overtime</span>
                    <span className="font-mono">
                      {fmt(selected.overtimePay!)}
                    </span>
                  </div>
                )}
                {(selected.allowances as any[])?.map((a: any, i: number) =>
                  Number(a.amount) > 0 ? (
                    <div key={i} className="flex justify-between text-sm">
                      <span className="text-muted-foreground">
                        {a.label || "Allowance"}
                      </span>
                      <span className="font-mono">{fmt(a.amount)}</span>
                    </div>
                  ) : null,
                )}
                <div className="flex justify-between text-sm font-semibold border-t border-border pt-2 mt-1">
                  <span>Gross pay</span>
                  <span className="font-mono">{fmt(selected.grossPay)}</span>
                </div>
              </div>
            </div>

            {/* Deductions */}
            <div>
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
                Deductions
              </div>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">
                    EPF (employee 11%)
                  </span>
                  <span className="font-mono text-red-600 dark:text-red-400">
                    -{fmt(selected.epfEmployee)}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">SOCSO</span>
                  <span className="font-mono text-red-600 dark:text-red-400">
                    -{fmt(selected.socsoEmployee)}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">EIS</span>
                  <span className="font-mono text-red-600 dark:text-red-400">
                    -{fmt(selected.eisEmployee)}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">PCB / LHDN</span>
                  <span className="font-mono text-red-600 dark:text-red-400">
                    -{fmt(selected.lhdn)}
                  </span>
                </div>
                {(selected.otherDeductions as any[])?.map(
                  (d: any, i: number) =>
                    Number(d.amount) > 0 ? (
                      <div key={i} className="flex justify-between text-sm">
                        <span className="text-muted-foreground">
                          {d.label || "Deduction"}
                        </span>
                        <span className="font-mono text-red-600 dark:text-red-400">
                          -{fmt(d.amount)}
                        </span>
                      </div>
                    ) : null,
                )}
                <div className="flex justify-between text-sm font-semibold border-t border-border pt-2 mt-1">
                  <span>Total deductions</span>
                  <span className="font-mono text-red-600 dark:text-red-400">
                    -{fmt(selected.totalDeductions)}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Employer contributions note */}
          <div className="px-5 pb-4">
            <div className="bg-muted/30 rounded-lg p-3 text-xs text-muted-foreground space-y-1">
              <div className="font-medium text-foreground mb-1.5">
                Employer contributions (not deducted from salary)
              </div>
              <div className="flex justify-between">
                <span>EPF (employer)</span>
                <span className="font-mono">{fmt(selected.epfEmployer)}</span>
              </div>
              <div className="flex justify-between">
                <span>SOCSO (employer)</span>
                <span className="font-mono">{fmt(selected.socsoEmployer)}</span>
              </div>
              <div className="flex justify-between">
                <span>EIS (employer)</span>
                <span className="font-mono">{fmt(selected.eisEmployer)}</span>
              </div>
            </div>
          </div>

          {/* Net pay footer */}
          <div className="px-5 py-4 border-t border-border bg-muted/10 flex items-center justify-between">
            <span className="text-sm font-medium">Net pay</span>
            <span className="text-xl font-bold text-green-600 dark:text-green-400 font-mono">
              {fmt(selected.netPay)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
