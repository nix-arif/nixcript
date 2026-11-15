import { PDFDocument, StandardFonts, rgb, RGB } from "pdf-lib";
import { DEFAULT_PDF_SETTINGS, type PayslipPdfSettings } from "@/lib/payroll/pdf-settings";

export type PayslipData = {
  // Company
  companyName: string;
  companyAddress?: string | null;
  companyLogo?: string | null;
  companySsmNo?: string | null;
  companyTaxNo?: string | null;

  // Employee
  employeeName: string;
  jobTitle?: string | null;
  department?: string | null;
  icNumber?: string | null;
  epfNo?: string | null;
  socsoNo?: string | null;
  taxNo?: string | null;
  bankName?: string | null;
  bankAccountHolder?: string | null;
  bankAccountNo?: string | null;

  // Period
  periodLabel: string;
  periodMonth: number;
  periodYear: number;

  // This month earnings
  basicSalary: string | null;
  earnings?: { label: string; amount: string }[];
  grossPay: string | null;

  // This month deductions
  epfEmployee: string | null;
  epfEmployer: string | null;
  socsoEmployee: string | null;
  socsoEmployer: string | null;
  eisEmployee: string | null;
  eisEmployer: string | null;
  lhdn: string | null;
  otherDeductions?: { label: string; amount: string }[];
  totalDeductions: string | null;
  netPay: string | null;
  taxableIncome?: number | null; // PCB base for this month (before reliefs)

  // YTD
  ytdGross: number;
  ytdNet: number;
  ytdEpfEmployee: number;
  ytdEpfEmployer: number;
  ytdSocsoEmployee: number;
  ytdSocsoEmployer: number;
  ytdEisEmployee: number;
  ytdEisEmployer: number;
  ytdLhdn: number;
  ytdTotalDeductions: number;
  ytdTaxableIncome: number;

  // What HR chose to show (Payslip Settings → Payslip PDF)
  settings?: PayslipPdfSettings;
};

// ── Helpers ────────────────────────────────────────────────────────────────
const n = (v: string | number | null | undefined) => Number(v ?? 0);
const fmt = (v: string | number | null | undefined) =>
  n(v).toLocaleString("en-MY", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

// Colors
const NAVY = rgb(0.059, 0.094, 0.176);
const WHITE = rgb(1, 1, 1);
const DARK = rgb(0.059, 0.094, 0.176);
const MUTED = rgb(0.451, 0.49, 0.569);
const LIGHT_MUTED = rgb(0.6, 0.635, 0.7);
const RED = rgb(0.639, 0.173, 0.173);
const GREEN = rgb(0.231, 0.431, 0.067);
const DARK_GREEN = rgb(0.153, 0.314, 0.039);
const LIGHT_GREEN = rgb(0.918, 0.953, 0.867);
const MID_GREEN = rgb(0.231, 0.431, 0.067);
const BORDER = rgb(0.882, 0.898, 0.918);
const BORDER_MED = rgb(0.78, 0.808, 0.84);
const LIGHT_BG = rgb(0.961, 0.965, 0.973);
const GREEN_BORDER = rgb(0.753, 0.867, 0.592);

export async function generatePayslipPdf(
  data: PayslipData,
  opts: { output?: "download" | "open" } = {},
) {
  const cfg = { ...DEFAULT_PDF_SETTINGS, ...(data.settings ?? {}) };
  const pdfDoc = await PDFDocument.create();
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const page = pdfDoc.addPage([595.28, 841.89]);
  const { width, height } = page.getSize();
  const ML = 32;
  const MR = 32;
  const CW = width - ML - MR;

  // ── Primitives ─────────────────────────────────────────────────────────
  const T = (
    str: string,
    x: number,
    y: number,
    size: number,
    color: RGB = DARK,
    font = regular,
  ) => page.drawText(String(str), { x, y, size, color, font });

  const TR = (
    str: string,
    rx: number,
    y: number,
    size: number,
    color: RGB = DARK,
    font = regular,
  ) => {
    const w = font.widthOfTextAtSize(String(str), size);
    page.drawText(String(str), { x: rx - w, y, size, color, font });
  };

  const HL = (
    x1: number,
    y: number,
    x2: number,
    color: RGB = BORDER,
    t = 0.5,
  ) =>
    page.drawLine({
      start: { x: x1, y },
      end: { x: x2, y },
      thickness: t,
      color,
    });

  const VL = (
    x: number,
    y1: number,
    y2: number,
    color: RGB = BORDER,
    t = 0.5,
  ) =>
    page.drawLine({
      start: { x, y: y1 },
      end: { x, y: y2 },
      thickness: t,
      color,
    });

  const RECT = (x: number, y: number, w: number, h: number, color: RGB) =>
    page.drawRectangle({ x, y, width: w, height: h, color });

  // ── Row helpers ────────────────────────────────────────────────────────
  const dataRow = (
    label: string,
    value: string,
    x: number,
    y: number,
    w: number,
    labelColor: RGB = MUTED,
    valueColor: RGB = DARK,
    size = 8.5,
  ) => {
    T(label, x + 4, y - 9, size, labelColor);
    TR(value, x + w - 4, y - 9, size, valueColor);
    HL(x, y - 14, x + w, BORDER, 0.4);
    return y - 14;
  };

  // A row with an optional "year to date" sub-line
  const rowWithYtd = (
    label: string,
    value: string,
    ytdLabel: string,
    ytdValue: string,
    x: number,
    y: number,
    w: number,
    showYtd: boolean,
    valueColor: RGB = DARK,
  ) => {
    T(label, x + 4, y - 9, 8.5, MUTED);
    TR(value, x + w - 4, y - 9, 8.5, valueColor);
    if (!showYtd) {
      HL(x, y - 14, x + w, BORDER, 0.4);
      return y - 14;
    }
    T(ytdLabel, x + 4, y - 19, 8, LIGHT_MUTED);
    TR(ytdValue, x + w - 4, y - 19, 8, LIGHT_MUTED);
    HL(x, y - 23, x + w, BORDER, 0.4);
    return y - 23;
  };

  const totalRowWithYtd = (
    label: string,
    value: string,
    ytdLabel: string,
    ytdValue: string,
    x: number,
    y: number,
    w: number,
    showYtd: boolean,
    valueColor: RGB = DARK,
  ) => {
    HL(x, y, x + w, BORDER_MED, 0.8);
    T(label, x + 4, y - 11, 9, DARK, bold);
    TR(value, x + w - 4, y - 11, 9, valueColor, bold);
    if (!showYtd) {
      HL(x, y - 15, x + w, BORDER, 0.4);
      return y - 15;
    }
    T(ytdLabel, x + 4, y - 22, 8, LIGHT_MUTED);
    TR(ytdValue, x + w - 4, y - 22, 8, LIGHT_MUTED);
    HL(x, y - 26, x + w, BORDER, 0.4);
    return y - 26;
  };

  const sectionLabel = (label: string, x: number, y: number, w: number) => {
    T(label.toUpperCase(), x + 4, y - 9, 7, MUTED, bold);
    HL(x, y - 13, x + w, BORDER, 0.4);
    return y - 13;
  };

  let y = height - ML;

  // ── TOP ACCENT ─────────────────────────────────────────────────────────
  y = height - 3;

  // ── HEADER ─────────────────────────────────────────────────────────────
  const headerH = 68;
  RECT(0, y - headerH, width, headerH, WHITE);

  // Logo
  if (data.companyLogo) {
    try {
      const res = await fetch(data.companyLogo);
      const ct = res.headers.get("content-type") ?? "";
      const buf = new Uint8Array(await res.arrayBuffer());
      if (ct.includes("png")) {
        const img = await pdfDoc.embedPng(buf);
        page.drawImage(img, { x: ML, y: y - headerH + 16, width: 36, height: 36 });
      } else if (ct.includes("jpeg") || ct.includes("jpg")) {
        const img = await pdfDoc.embedJpg(buf);
        page.drawImage(img, { x: ML, y: y - headerH + 16, width: 36, height: 36 });
      } else {
        RECT(ML, y - headerH + 16, 36, 36, LIGHT_BG);
      }
    } catch {
      RECT(ML, y - headerH + 16, 36, 36, LIGHT_BG);
    }
  } else {
    RECT(ML, y - headerH + 16, 36, 36, LIGHT_BG);
  }

  const cx = ML + 46;
  T(data.companyName, cx, y - 18, 10.5, DARK, bold);
  T(data.companyAddress ?? "", cx, y - 30, 8, MUTED);
  const ssmTin = [
    data.companySsmNo ? `SSM: ${data.companySsmNo}` : "",
    data.companyTaxNo ? `TIN: ${data.companyTaxNo}` : "",
  ]
    .filter(Boolean)
    .join("  ·  ");
  if (ssmTin) T(ssmTin, cx, y - 41, 8, MUTED);

  T(
    "PAYSLIP",
    width - MR - bold.widthOfTextAtSize("PAYSLIP", 8),
    y - 18,
    8,
    MUTED,
    bold,
  );
  TR(data.periodLabel, width - MR, y - 32, 14, NAVY, bold);
  TR(
    `Generated ${new Date().toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" })}`,
    width - MR,
    y - 45,
    8,
    MUTED,
  );

  y -= headerH;
  HL(ML, y, ML + CW, BORDER);

  // ── EMPLOYEE STRIP ─────────────────────────────────────────────────────
  const empH = 46;
  RECT(0, y - empH, width, empH, LIGHT_BG);

  T(data.employeeName, ML + 4, y - 12, 11, DARK, bold);
  T(
    [data.jobTitle, data.department].filter(Boolean).join("  ·  "),
    ML + 4,
    y - 24,
    8.5,
    MUTED,
  );

  if (cfg.showEmployeeIds) {
    const empFields = [
      { l: "IC", v: data.icNumber ?? "—" },
      { l: "EPF No", v: data.epfNo ?? "—" },
      { l: "SOCSO", v: data.socsoNo ?? "—" },
      { l: "Tax No", v: data.taxNo ?? "—" },
    ];
    const efColW = 126;
    const efStartX = width - MR - efColW * 2 - 4;
    empFields.forEach((f, i) => {
      const ex = efStartX + (i % 2) * (efColW + 4);
      const ey = i < 2 ? y - 11 : y - 27;
      T(`${f.l}: `, ex, ey, 8, MUTED);
      T(f.v, ex + regular.widthOfTextAtSize(`${f.l}: `, 8), ey, 8, DARK);
    });
  }

  y -= empH;
  HL(ML, y, ML + CW, BORDER);

  // ── 2-COLUMN EARNINGS | DEDUCTIONS ────────────────────────────────────
  const colW = CW / 2 - 4;
  const col1X = ML;
  const col2X = ML + CW / 2 + 4;
  const colTop = y;

  let ey = sectionLabel("Earnings", col1X, y, colW);
  let dy = sectionLabel("Deductions", col2X, y, colW);
  y = Math.min(ey, dy);
  ey = y;
  dy = y;

  // ── Earnings ──────────────────────────────────────────────────────────
  ey = dataRow("Basic salary", fmt(data.basicSalary), col1X, ey, colW);

  for (const a of (data.earnings ?? []).filter((a) => n(a.amount) > 0))
    ey = dataRow(a.label || "Allowance", fmt(a.amount), col1X, ey, colW);

  ey = totalRowWithYtd(
    "Gross pay",
    fmt(data.grossPay),
    "YTD gross pay",
    fmt(data.ytdGross),
    col1X,
    ey,
    colW,
    cfg.ytdEarnings,
  );

  // ── Deductions ────────────────────────────────────────────────────────
  dy = rowWithYtd("EPF (11%)", `-${fmt(data.epfEmployee)}`, "YTD EPF", fmt(data.ytdEpfEmployee), col2X, dy, colW, cfg.ytdDeductions, RED);
  dy = rowWithYtd("SOCSO", `-${fmt(data.socsoEmployee)}`, "YTD SOCSO", fmt(data.ytdSocsoEmployee), col2X, dy, colW, cfg.ytdDeductions, RED);
  dy = rowWithYtd("EIS", `-${fmt(data.eisEmployee)}`, "YTD EIS", fmt(data.ytdEisEmployee), col2X, dy, colW, cfg.ytdDeductions, RED);
  dy = rowWithYtd("PCB / LHDN", `-${fmt(data.lhdn)}`, "YTD LHDN", fmt(data.ytdLhdn), col2X, dy, colW, cfg.ytdDeductions, RED);

  for (const d of (data.otherDeductions ?? []).filter((d) => n(d.amount) > 0))
    dy = dataRow(d.label || "Deduction", `-${fmt(d.amount)}`, col2X, dy, colW, MUTED, RED);

  dy = totalRowWithYtd(
    "Total deductions",
    `-${fmt(data.totalDeductions)}`,
    "YTD total deductions",
    fmt(data.ytdTotalDeductions),
    col2X,
    dy,
    colW,
    cfg.ytdDeductions,
    RED,
  );

  // Vertical divider
  const colBottom = Math.min(ey, dy);
  VL(ML + CW / 2, colTop, colBottom, BORDER);

  y = colBottom;
  HL(ML, y, ML + CW, BORDER);

  // ── EMPLOYER CONTRIBUTIONS ─────────────────────────────────────────────
  if (cfg.showEmployer) {
    const empContribH = cfg.ytdEmployer ? 48 : 36;
    RECT(0, y - empContribH, width, empContribH, LIGHT_BG);
    T("EMPLOYER CONTRIBUTIONS (not deducted from salary)", ML + 4, y - 9, 7, MUTED, bold);

    const ecW = CW / 3;
    [
      { l: "EPF (12%)", v: fmt(data.epfEmployer), ytd: fmt(data.ytdEpfEmployer) },
      { l: "SOCSO", v: fmt(data.socsoEmployer), ytd: fmt(data.ytdSocsoEmployer) },
      { l: "EIS", v: fmt(data.eisEmployer), ytd: fmt(data.ytdEisEmployer) },
    ].forEach((r, i) => {
      const ex = ML + i * ecW;
      T(r.l, ex + 4, y - 22, 8.5, MUTED);
      TR(r.v, ex + ecW - 4, y - 22, 8.5, DARK);
      if (cfg.ytdEmployer) {
        T("YTD", ex + 4, y - 33, 8, LIGHT_MUTED);
        TR(r.ytd, ex + ecW - 4, y - 33, 8, LIGHT_MUTED);
      }
    });

    y -= empContribH;
    HL(ML, y, ML + CW, BORDER);
  }

  // ── TAX SUMMARY ────────────────────────────────────────────────────────
  // Taxable income = the PCB base (basic salary + earnings HR marked for PCB), before reliefs
  if (cfg.showTaxSummary && data.taxableIncome != null) {
    const showYtd = cfg.ytdSummary;
    const taxH = showYtd ? 42 : 30;
    RECT(0, y - taxH, width, taxH, LIGHT_GREEN);
    T("TAX SUMMARY", ML + 4, y - 9, 7, DARK_GREEN, bold);

    const taxW = CW / 3;
    const notTaxable = Math.max(0, n(data.grossPay) - data.taxableIncome);
    [
      { l: "Gross income", v: fmt(data.grossPay), isBold: false },
      { l: "Not taxable", v: `-${fmt(notTaxable)}`, isBold: false },
      { l: "Taxable income", v: fmt(data.taxableIncome), isBold: true },
    ].forEach((f, i) => {
      const tx = ML + i * taxW;
      T(f.l, tx + 4, y - 21, 8.5, MID_GREEN);
      TR(f.v, tx + taxW - 4, y - 21, 8.5, DARK_GREEN, f.isBold ? bold : regular);
    });

    if (showYtd) {
      HL(ML, y - 28, ML + CW, GREEN_BORDER, 0.4);
      T("YTD taxable income", ML + 4, y - 37, 8, MID_GREEN);
      TR(fmt(data.ytdTaxableIncome), ML + CW - 4, y - 37, 8, DARK_GREEN, bold);
    }

    y -= taxH;
    HL(ML, y, ML + CW, BORDER);
  }

  // ── BANK + NET PAY ──────────────────────────────────────────────────────
  const bnH = 74;
  const halfCW = CW / 2;
  RECT(0, y - bnH, width, bnH, WHITE);

  // Left — bank info + YTD net
  if (cfg.showBank) {
    T("PAYMENT TO", ML + 4, y - 10, 7, MUTED, bold);
    T(data.bankName ?? "—", ML + 4, y - 22, 9.5, DARK, bold);
    T(data.bankAccountHolder ?? "", ML + 4, y - 33, 8, MUTED);
    T(data.bankAccountNo ?? "—", ML + 4, y - 44, 8.5, DARK);
  }
  if (cfg.ytdSummary) {
    HL(ML, y - 50, ML + halfCW - 4, BORDER, 0.4);
    T("YTD net pay", ML + 4, y - 59, 7, MUTED, bold);
    T(`RM ${fmt(data.ytdNet)}`, ML + 4, y - 70, 9.5, DARK, bold);
  }

  VL(ML + halfCW, y, y - bnH, BORDER);

  // Right — net pay
  const rX = ML + halfCW + 8;
  T("NET PAY", rX, y - 10, 7, MUTED, bold);
  T("RM", rX, y - 38, 11, GREEN);
  T(fmt(data.netPay), rX + 20, y - 42, 22, GREEN, bold);
  T("Malaysian Ringgit", rX, y - 54, 8, MUTED);
  if (cfg.ytdSummary) {
    HL(rX, y - 60, ML + CW, BORDER, 0.4);
    T("YTD gross pay", rX, y - 69, 7, MUTED, bold);
    TR(`RM ${fmt(data.ytdGross)}`, ML + CW - 4, y - 69, 9, DARK, bold);
  }

  y -= bnH;
  HL(ML, y, ML + CW, BORDER);

  // ── FOOTER ─────────────────────────────────────────────────────────────
  const note = cfg.footerNote.trim();
  if (note) {
    T(note.slice(0, 120), ML + 4, y - 14, 8, MUTED);
    y -= 22;
  }
  T("Computer-generated document — no signature required", ML, y - 14, 7.5, LIGHT_MUTED);
  TR(`${data.periodLabel}  ·  Page 1 of 1`, width - MR, y - 14, 7.5, LIGHT_MUTED);

  // ── DOWNLOAD ───────────────────────────────────────────────────────────
  const bytes = await pdfDoc.save();
  const blob = new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  if (opts.output === "open") {
    window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return;
  }
  const a = document.createElement("a");
  a.href = url;
  a.download = `Payslip_${data.periodLabel.replace(/ /g, "_")}_${data.employeeName.replace(/ /g, "_")}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}

// Example payslip for the "Preview PDF" button in Payslip Settings
export function samplePayslipData(settings: PayslipPdfSettings): PayslipData {
  return {
    companyName: "Sample Company Sdn Bhd",
    companyAddress: "12, Jalan Contoh, 50000 Kuala Lumpur",
    companySsmNo: "202001000001",
    companyTaxNo: "C 1234567890",
    employeeName: "Aisyah Binti Ahmad",
    jobTitle: "Executive",
    department: "Operations",
    icNumber: "900101-14-5678",
    epfNo: "12345678",
    socsoNo: "900101145678",
    taxNo: "SG 12345678090",
    bankName: "Maybank",
    bankAccountHolder: "Aisyah Binti Ahmad",
    bankAccountNo: "5140 1234 5678",
    periodLabel: "April 2026",
    periodMonth: 4,
    periodYear: 2026,
    basicSalary: "5500",
    earnings: [
      { label: "Case allowance", amount: "850" },
      { label: "Overtime", amount: "240" },
    ],
    grossPay: "6590",
    epfEmployee: "660",
    epfEmployer: "780",
    socsoEmployee: "29.75",
    socsoEmployer: "104.15",
    eisEmployee: "11.9",
    eisEmployer: "11.9",
    lhdn: "244.17",
    otherDeductions: [{ label: "Cash advance", amount: "100" }],
    totalDeductions: "1045.82",
    netPay: "5544.18",
    ytdGross: 26360,
    ytdNet: 22176.72,
    ytdEpfEmployee: 2640,
    ytdEpfEmployer: 3120,
    ytdSocsoEmployee: 119,
    ytdSocsoEmployer: 416.6,
    ytdEisEmployee: 47.6,
    ytdEisEmployer: 47.6,
    ytdLhdn: 976.68,
    ytdTotalDeductions: 4183.28,
    taxableIncome: 6590,
    ytdTaxableIncome: 26360,
    settings,
  };
}
