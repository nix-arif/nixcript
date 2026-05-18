import { PDFDocument, StandardFonts, rgb, RGB } from "pdf-lib";

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
  bonus?: string | null;
  overtimePay?: string | null;
  allowances?: { label: string; amount: string }[];
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

  // YTD (selective)
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
  ytdBasic: number;
  ytdBonus: number;
  ytdOvertime: number;
  ytdAllowances: number;
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

export async function generatePayslipPdf(data: PayslipData) {
  const pdfDoc = await PDFDocument.create();
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);

  console.log("companyLogo:", data.companyLogo);

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

  const totalRowWithYtd = (
    label: string,
    value: string,
    ytdLabel: string,
    ytdValue: string,
    x: number,
    y: number,
    w: number,
    valueColor: RGB = DARK,
  ) => {
    HL(x, y, x + w, BORDER_MED, 0.8);
    T(label, x + 4, y - 11, 9, DARK, bold);
    TR(value, x + w - 4, y - 11, 9, valueColor, bold);
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
  RECT(0, height - 3, width, 3, NAVY);
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
        page.drawImage(img, {
          x: ML,
          y: y - headerH + 16,
          width: 36,
          height: 36,
        });
      } else if (ct.includes("jpeg") || ct.includes("jpg")) {
        const img = await pdfDoc.embedJpg(buf);
        page.drawImage(img, {
          x: ML,
          y: y - headerH + 16,
          width: 36,
          height: 36,
        });
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

  y -= empH;
  HL(ML, y, ML + CW, BORDER);

  // ── 2-COLUMN EARNINGS | DEDUCTIONS ────────────────────────────────────
  const colW = CW / 2 - 4;
  const col1X = ML;
  const col2X = ML + CW / 2 + 4;
  const colTop = y;

  y -= 0; // start columns from here

  // Section labels
  let ey = sectionLabel("Earnings", col1X, y, colW);
  let dy = sectionLabel("Deductions", col2X, y, colW);
  y = Math.min(ey, dy); // sync after headers (they're equal)

  ey = y;
  dy = y;

  // ── Earnings ──────────────────────────────────────────────────────────
  ey = dataRow("Basic salary", fmt(data.basicSalary), col1X, ey, colW);

  if (n(data.bonus) > 0)
    ey = dataRow("Bonus", fmt(data.bonus), col1X, ey, colW);

  if (n(data.overtimePay) > 0)
    ey = dataRow("Overtime", fmt(data.overtimePay), col1X, ey, colW);

  for (const a of (data.allowances ?? []).filter((a) => n(a.amount) > 0))
    ey = dataRow(a.label || "Allowance", fmt(a.amount), col1X, ey, colW);

  ey = totalRowWithYtd(
    "Gross pay",
    fmt(data.grossPay),
    "YTD gross pay",
    fmt(data.ytdGross),
    col1X,
    ey,
    colW,
  );

  // ── Deductions ────────────────────────────────────────────────────────
  // EPF with YTD sub-line
  T("EPF (11%)", col2X + 4, dy - 9, 8.5, MUTED);
  TR(`-${fmt(data.epfEmployee)}`, col2X + colW - 4, dy - 9, 8.5, RED);
  T("YTD EPF", col2X + 4, dy - 19, 8, LIGHT_MUTED);
  TR(fmt(data.ytdEpfEmployee), col2X + colW - 4, dy - 19, 8, LIGHT_MUTED);
  HL(col2X, dy - 23, col2X + colW, BORDER, 0.4);
  dy -= 23;

  dy = dataRow(
    "SOCSO",
    `-${fmt(data.socsoEmployee)}`,
    col2X,
    dy,
    colW,
    MUTED,
    RED,
  );
  dy = dataRow("EIS", `-${fmt(data.eisEmployee)}`, col2X, dy, colW, MUTED, RED);

  // LHDN with YTD sub-line
  T("PCB / LHDN", col2X + 4, dy - 9, 8.5, MUTED);
  TR(`-${fmt(data.lhdn)}`, col2X + colW - 4, dy - 9, 8.5, RED);
  T("YTD LHDN", col2X + 4, dy - 19, 8, LIGHT_MUTED);
  TR(fmt(data.ytdLhdn), col2X + colW - 4, dy - 19, 8, LIGHT_MUTED);
  HL(col2X, dy - 23, col2X + colW, BORDER, 0.4);
  dy -= 23;

  for (const d of (data.otherDeductions ?? []).filter((d) => n(d.amount) > 0))
    dy = dataRow(
      d.label || "Deduction",
      `-${fmt(d.amount)}`,
      col2X,
      dy,
      colW,
      MUTED,
      RED,
    );

  dy = totalRowWithYtd(
    "Total deductions",
    `-${fmt(data.totalDeductions)}`,
    "YTD deductions",
    fmt(data.ytdTotalDeductions),
    col2X,
    dy,
    colW,
    RED,
  );

  // Vertical divider
  const colBottom = Math.min(ey, dy);
  VL(ML + CW / 2, colTop, colBottom, BORDER);

  y = colBottom;
  HL(ML, y, ML + CW, BORDER);

  // ── EMPLOYER CONTRIBUTIONS ─────────────────────────────────────────────
  const empContribH = 36;
  RECT(0, y - empContribH, width, empContribH, LIGHT_BG);
  T(
    "EMPLOYER CONTRIBUTIONS (not deducted from salary)",
    ML + 4,
    y - 9,
    7,
    MUTED,
    bold,
  );

  const ecW = CW / 3;
  [
    { l: "EPF (12%)", v: fmt(data.epfEmployer) },
    { l: "SOCSO", v: fmt(data.socsoEmployer) },
    { l: "EIS", v: fmt(data.eisEmployer) },
  ].forEach((r, i) => {
    const ex = ML + i * ecW;
    T(r.l, ex + 4, y - 22, 8.5, MUTED);
    TR(r.v, ex + ecW - 4, y - 22, 8.5, DARK);
  });

  y -= empContribH;
  HL(ML, y, ML + CW, BORDER);

  // ── TAX SUMMARY ────────────────────────────────────────────────────────
  const taxH = 42;
  RECT(0, y - taxH, width, taxH, LIGHT_GREEN);
  T("TAX SUMMARY", ML + 4, y - 9, 7, DARK_GREEN, bold);

  const taxW = CW / 3;
  const taxable = n(data.grossPay) - n(data.epfEmployee);
  [
    { l: "Gross income", v: fmt(data.grossPay), isBold: false },
    { l: "EPF relief", v: `-${fmt(data.epfEmployee)}`, isBold: false },
    { l: "Taxable income", v: fmt(taxable), isBold: true },
  ].forEach((f, i) => {
    const tx = ML + i * taxW;
    T(f.l, tx + 4, y - 21, 8.5, MID_GREEN);
    TR(f.v, tx + taxW - 4, y - 21, 8.5, DARK_GREEN, f.isBold ? bold : regular);
  });

  HL(ML, y - 28, ML + CW, GREEN_BORDER, 0.4);
  T("YTD taxable income", ML + 4, y - 37, 8, MID_GREEN);
  TR(fmt(data.ytdTaxableIncome), ML + CW - 4, y - 37, 8, DARK_GREEN, bold);

  y -= taxH;
  HL(ML, y, ML + CW, BORDER);

  // ── BANK + NET PAY ──────────────────────────────────────────────────────
  const bnH = 74;
  const halfCW = CW / 2;
  RECT(0, y - bnH, width, bnH, WHITE);

  // Left — bank info + YTD net
  T("PAYMENT TO", ML + 4, y - 10, 7, MUTED, bold);
  T(data.bankName ?? "—", ML + 4, y - 22, 9.5, DARK, bold);
  T(data.bankAccountHolder ?? "", ML + 4, y - 33, 8, MUTED);
  T(data.bankAccountNo ?? "—", ML + 4, y - 44, 8.5, DARK);
  HL(ML, y - 50, ML + halfCW - 4, BORDER, 0.4);
  T("YTD net pay", ML + 4, y - 59, 7, MUTED, bold);
  T(`RM ${fmt(data.ytdNet)}`, ML + 4, y - 70, 9.5, DARK, bold);

  VL(ML + halfCW, y, y - bnH, BORDER);

  // Right — net pay
  const rX = ML + halfCW + 8;
  T("NET PAY", rX, y - 10, 7, MUTED, bold);
  T("RM", rX, y - 38, 11, GREEN);
  T(fmt(data.netPay), rX + 20, y - 42, 22, GREEN, bold);
  T("Malaysian Ringgit", rX, y - 54, 8, MUTED);
  HL(rX, y - 60, ML + CW, BORDER, 0.4);
  T("YTD gross pay", rX, y - 69, 7, MUTED, bold);
  TR(`RM ${fmt(data.ytdGross)}`, ML + CW - 4, y - 69, 9, DARK, bold);

  y -= bnH;
  HL(ML, y, ML + CW, BORDER);

  // ── FOOTER ─────────────────────────────────────────────────────────────
  RECT(0, y - 22, width, 22, NAVY);
  T(
    "Computer-generated document — no signature required",
    ML,
    y - 14,
    7.5,
    rgb(0.29, 0.435, 0.627),
  );
  TR(
    `${data.periodLabel}  ·  Page 1 of 1`,
    width - MR,
    y - 14,
    7.5,
    rgb(0.29, 0.435, 0.627),
  );

  // ── DOWNLOAD ───────────────────────────────────────────────────────────
  const bytes = await pdfDoc.save();
  const blob = new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Payslip_${data.periodLabel.replace(/ /g, "_")}_${data.employeeName.replace(/ /g, "_")}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}
