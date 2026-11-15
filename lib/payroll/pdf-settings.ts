// What shows on the payslip PDF. Stored per organization (HR sets it in Payslip
// Settings); anything not stored falls back to these defaults.
export type PayslipPdfSettings = {
  ytdEarnings: boolean; // "YTD gross pay" under Gross pay
  ytdDeductions: boolean; // YTD under EPF, SOCSO, EIS, PCB and Total deductions
  ytdEmployer: boolean; // YTD under the employer EPF / SOCSO / EIS
  ytdSummary: boolean; // YTD net pay and YTD gross pay (and YTD taxable income when the tax summary is on)
  showTaxSummary: boolean; // gross, not-taxable and taxable income (the PCB base)
  showEmployer: boolean; // employer contributions section
  showEmployeeIds: boolean; // IC, EPF, SOCSO and tax numbers
  showBank: boolean; // "paid to" bank details
  footerNote: string; // extra line at the bottom
};

export const DEFAULT_PDF_SETTINGS: PayslipPdfSettings = {
  ytdEarnings: true,
  ytdDeductions: true,
  ytdEmployer: true,
  ytdSummary: true,
  showTaxSummary: true,
  showEmployer: true,
  showEmployeeIds: true,
  showBank: true,
  footerNote: "",
};

export function mergePdfSettings(raw: unknown): PayslipPdfSettings {
  const out = { ...DEFAULT_PDF_SETTINGS };
  if (raw && typeof raw === "object") {
    const r = raw as Record<string, unknown>;
    for (const k of Object.keys(out) as (keyof PayslipPdfSettings)[]) {
      if (typeof r[k] === typeof out[k]) (out as Record<string, unknown>)[k] = r[k];
    }
  }
  out.footerNote = out.footerNote.slice(0, 200);
  return out;
}
