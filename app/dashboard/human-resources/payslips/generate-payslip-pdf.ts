import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

type PayslipData = {
  employeeName: string;
  jobTitle?: string | null;
  department?: string | null;
  icNumber?: string | null;
  bankAccountNo?: string | null;
  basicSalary: string;
  bonus?: string | null;
  overtimePay?: string | null;
  allowances?: any;
  epfEmployee: string | null; // ← add null
  epfEmployer: string | null; // ← add null
  socsoEmployee: string | null; // ← add null
  socsoEmployer: string | null; // ← add null
  eisEmployee: string | null; // ← add null
  eisEmployer: string | null; // ← add null
  lhdn: string | null; // ← add null
  otherDeductions?: any;
  grossPay: string;
  totalDeductions: string;
  netPay: string;
  periodLabel: string;
  periodMonth: number;
  periodYear: number;
};

const fmt = (v: string | number | null | undefined) =>
  `RM ${Number(v ?? 0).toLocaleString("en-MY", { minimumFractionDigits: 2 })}`;

export async function generatePayslipPdf(data: PayslipData) {
  const pdfDoc = await PDFDocument.create();
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const page = pdfDoc.addPage([595.28, 841.89]); // A4
  const { width, height } = page.getSize();
  const M = 48; // margin

  // Colors
  const NAVY = rgb(0.059, 0.094, 0.176);
  const WHITE = rgb(1, 1, 1);
  const DARK = rgb(0.059, 0.094, 0.176);
  const MUTED = rgb(0.451, 0.49, 0.569);
  const RED = rgb(0.78, 0.169, 0.169);
  const GREEN = rgb(0.133, 0.545, 0.133);
  const BORDER = rgb(0.878, 0.898, 0.918);
  const LIGHT = rgb(0.961, 0.965, 0.973);

  const line = (y: number, x1 = M, x2 = width - M, color = BORDER, t = 0.5) =>
    page.drawLine({
      start: { x: x1, y },
      end: { x: x2, y },
      thickness: t,
      color,
    });

  const text = (
    str: string,
    x: number,
    y: number,
    size: number,
    color = DARK,
    font = regular,
  ) => page.drawText(str, { x, y, size, color, font });

  const rightText = (
    str: string,
    x: number,
    y: number,
    size: number,
    color = DARK,
    font = regular,
  ) => {
    const w = font.widthOfTextAtSize(str, size);
    page.drawText(str, { x: x - w, y, size, color, font });
  };

  let y = height - M;

  // ── Header ────────────────────────────────────────────────────────────────
  page.drawRectangle({ x: 0, y: height - 70, width, height: 70, color: NAVY });
  text("PAYSLIP", M, height - 28, 18, WHITE, bold);
  text(
    data.periodLabel.toUpperCase(),
    M,
    height - 46,
    9,
    rgb(0.584, 0.647, 0.761),
    regular,
  );
  rightText(
    `Generated ${new Date().toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" })}`,
    width - M,
    height - 28,
    8,
    rgb(0.584, 0.647, 0.761),
  );
  y = height - 70 - 20;

  // ── Employee info ─────────────────────────────────────────────────────────
  page.drawRectangle({
    x: M,
    y: y - 70,
    width: width - M * 2,
    height: 70,
    color: LIGHT,
  });
  text(data.employeeName, M + 12, y - 20, 12, DARK, bold);
  text(
    `${data.jobTitle ?? ""}${data.department ? "  ·  " + data.department : ""}`,
    M + 12,
    y - 36,
    8.5,
    MUTED,
  );
  if (data.icNumber) text(`IC: ${data.icNumber}`, M + 12, y - 50, 8, MUTED);
  if (data.bankAccountNo)
    text(`Bank: ${data.bankAccountNo}`, M + 12, y - 62, 8, MUTED);

  // Right side of employee box
  text("Period", width - M - 140, y - 20, 8, MUTED);
  text(data.periodLabel, width - M - 140, y - 33, 10, DARK, bold);
  text("Month / Year", width - M - 140, y - 50, 8, MUTED);
  text(
    `${String(data.periodMonth).padStart(2, "0")} / ${data.periodYear}`,
    width - M - 140,
    y - 63,
    9,
    DARK,
  );

  y -= 80;

  // ── Two column layout ─────────────────────────────────────────────────────
  const col1X = M;
  const col2X = width / 2 + 8;
  const colW = width / 2 - M - 8;

  // Section header helper
  const sectionHeader = (label: string, x: number, yy: number) => {
    page.drawRectangle({ x, y: yy - 18, width: colW, height: 18, color: NAVY });
    text(label.toUpperCase(), x + 8, yy - 13, 7.5, WHITE, bold);
    return yy - 18;
  };

  // Row helper
  const row = (
    label: string,
    value: string,
    x: number,
    yy: number,
    valueColor = DARK,
  ) => {
    text(label, x + 8, yy - 10, 8.5, MUTED);
    rightText(value, x + colW - 8, yy - 10, 8.5, valueColor, regular);
    page.drawLine({
      start: { x, y: yy - 16 },
      end: { x: x + colW, y: yy - 16 },
      thickness: 0.3,
      color: BORDER,
    });
    return yy - 16;
  };

  // ── Earnings column ───────────────────────────────────────────────────────
  let ey = sectionHeader("Earnings", col1X, y);

  ey = row("Basic salary", fmt(data.basicSalary), col1X, ey);
  if (Number(data.bonus) > 0)
    ey = row("Bonus", fmt(data.bonus ?? 0), col1X, ey);
  if (Number(data.overtimePay) > 0)
    ey = row("Overtime", fmt(data.overtimePay ?? 0), col1X, ey);

  const allowances = (data.allowances as any[]) ?? [];
  for (const a of allowances) {
    if (Number(a.amount) > 0)
      ey = row(a.label || "Allowance", fmt(a.amount), col1X, ey);
  }

  // Gross total
  page.drawRectangle({
    x: col1X,
    y: ey - 20,
    width: colW,
    height: 20,
    color: LIGHT,
  });
  text("GROSS PAY", col1X + 8, ey - 14, 8.5, DARK, bold);
  // Gross pay
  rightText(fmt(data.grossPay ?? 0), col1X + colW - 8, ey - 14, 9, DARK, bold);
  ey -= 20;

  // ── Deductions column ─────────────────────────────────────────────────────
  let dy = sectionHeader("Deductions", col2X, y);

  dy = row("EPF (employee 11%)", fmt(data.epfEmployee ?? 0), col2X, dy, RED);
  dy = row("SOCSO", fmt(data.socsoEmployee ?? 0), col2X, dy, RED);
  dy = row("EIS", fmt(data.eisEmployee ?? 0), col2X, dy, RED);
  dy = row("PCB / LHDN", fmt(data.lhdn ?? 0), col2X, dy, RED);

  const otherDeds = (data.otherDeductions as any[]) ?? [];
  for (const d of otherDeds) {
    if (Number(d.amount) > 0)
      dy = row(d.label || "Deduction", fmt(d.amount), col2X, dy, RED);
  }

  // Total deductions
  page.drawRectangle({
    x: col2X,
    y: dy - 20,
    width: colW,
    height: 20,
    color: LIGHT,
  });
  text("TOTAL DEDUCTIONS", col2X + 8, dy - 14, 8.5, DARK, bold);
  // Total row
  rightText(
    `-${fmt(data.totalDeductions ?? 0)}`,
    col2X + colW - 8,
    dy - 14,
    9,
    RED,
    bold,
  );
  dy -= 20;

  // ── Employer contributions ────────────────────────────────────────────────
  const empY = Math.min(ey, dy) - 20;
  const sectionHeader2 = (label: string, x: number, yy: number, w: number) => {
    page.drawRectangle({ x, y: yy - 18, width: w, height: 18, color: LIGHT });
    page.drawLine({
      start: { x, y: yy - 18 },
      end: { x: x + w, y: yy - 18 },
      thickness: 0.5,
      color: BORDER,
    });
    text(label.toUpperCase(), x + 8, yy - 12, 7.5, MUTED, bold);
    return yy - 18;
  };

  const fullW = width - M * 2;
  let contY = sectionHeader2(
    "Employer contributions (not deducted from your salary)",
    M,
    empY,
    fullW,
  );

  // 3 columns for employer contributions
  const cw = fullW / 3;
  const contRow = (label: string, value: string, x: number, yy: number) => {
    text(label, x + 8, yy - 10, 8, MUTED);
    rightText(value, x + cw - 8, yy - 10, 8.5, DARK);
    return yy - 16;
  };

  // Employer contributions
  contRow(`EPF (employer)`, fmt(data.epfEmployer ?? 0), M, contY);
  contRow(`SOCSO (employer)`, fmt(data.socsoEmployer ?? 0), M + cw, contY);
  contRow(`EIS (employer)`, fmt(data.eisEmployer ?? 0), M + cw * 2, contY);
  contY -= 20;

  // ── Net pay ───────────────────────────────────────────────────────────────
  const netY = contY - 16;
  page.drawRectangle({
    x: M,
    y: netY - 48,
    width: fullW,
    height: 48,
    color: NAVY,
  });
  text("NET PAY", M + 16, netY - 20, 10, WHITE, bold);
  text(
    "Amount credited to your bank account",
    M + 16,
    netY - 34,
    8,
    rgb(0.584, 0.647, 0.761),
  );
  rightText(fmt(data.netPay ?? 0), width - M - 16, netY - 24, 16, GREEN, bold);

  // ── Footer ────────────────────────────────────────────────────────────────
  text(
    "This is a computer-generated payslip and does not require a signature.",
    M,
    28,
    7.5,
    MUTED,
  );
  rightText(`${data.periodLabel} Payslip`, width - M, 28, 7.5, MUTED);

  // Download
  const bytes = await pdfDoc.save();
  const blob = new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `payslip_${data.periodLabel.replace(" ", "_")}_${data.employeeName.replace(" ", "_")}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}
