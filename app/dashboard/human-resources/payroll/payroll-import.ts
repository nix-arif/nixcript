"use client";

import {
  createPayslip,
  ensurePayrollPeriod,
  getOrgMembers,
  getPayItems,
  getSalaryStructures,
} from "@/server/payroll";

type PayItem = Awaited<ReturnType<typeof getPayItems>>[number];

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

const FIXED_HEADERS = [
  "Month (YYYY-MM)",
  "Email",
  "Name (reference only)",
  "Basic Salary (blank = salary structure)",
];
const PCB_HEADER = "PCB (blank = auto)";

const itemHeader = (i: PayItem) => `${i.name} (${i.kind})`;
const employerHeader = (i: PayItem) => `${i.name} (employer)`;
// Statutory deductions are calculated unless HR switched them to manual
const isImportItem = (i: PayItem) =>
  i.isActive && i.calcType !== "invoice_allowance" && (i.systemKey ? i.calcType === "manual" : true);
const columnsFor = (i: PayItem) =>
  i.systemKey && i.systemKey !== "pcb" ? [itemHeader(i), employerHeader(i)] : [itemHeader(i)];

export async function downloadPayrollTemplate() {
  const XLSX = await import("xlsx");
  // Commission items come from Custom Commission, so they have no column
  const items = (await getPayItems()).filter(isImportItem);
  const headers = [...FIXED_HEADERS, ...items.flatMap(columnsFor), PCB_HEADER];
  const row = (month: string) => [
    month,
    "employee@company.com",
    "Employee Name",
    "",
    ...items.flatMap((i) => columnsFor(i).map(() => "")),
    "",
  ];
  const ws = XLSX.utils.aoa_to_sheet([headers, row("2026-01"), row("2026-02")]);
  ws["!cols"] = headers.map((h) => ({ wch: Math.max(14, h.length + 2) }));
  const notes = XLSX.utils.aoa_to_sheet([
    ["Payslip import template"],
    ["One row = one employee for one month. Missing periods are created as Draft."],
    ["Month: YYYY-MM (e.g. 2026-01). 'Jan 2026' / 'January 2026' also work."],
    ["Email must match a member of this organization (required)."],
    ["Basic Salary and recurring pay-item columns: leave blank to use the employee's salary structure."],
    ["Type a value (0 to remove it) to override for that month."],
    ["Non-recurring pay items are only added when filled in."],
    ["Commission items (e.g. Case allowance) are added automatically from Custom Commission (this month's pending earnings)."],
    ["EPF, SOCSO, EIS and PCB are calculated automatically, unless set to manual in Payslip Settings (then they get their own columns)."],
    ["Existing payslips (same employee + month) and published periods are skipped."],
    ["Pay-item columns come from Payslip Settings; re-download the template after changing them."],
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Payslips");
  XLSX.utils.book_append_sheet(wb, notes, "Notes");
  XLSX.writeFile(wb, "payslip-import-template.xlsx");
}

function parseMonth(v: unknown): { month: number; year: number } | null {
  if (v instanceof Date && !isNaN(v.getTime()))
    return { month: v.getMonth() + 1, year: v.getFullYear() };
  const s = String(v ?? "").trim();
  let m = s.match(/^(\d{4})[-/](\d{1,2})/);
  if (m) return { year: +m[1], month: +m[2] };
  m = s.match(/^(\d{1,2})[-/](\d{4})$/);
  if (m) return { month: +m[1], year: +m[2] };
  m = s.match(/^([A-Za-z]{3})[A-Za-z]*[\s-]+(\d{2,4})$/);
  if (m) {
    const i = MONTHS.findIndex((x) => x.slice(0, 3) === m![1].toLowerCase());
    if (i >= 0) {
      const y = +m[2];
      return { month: i + 1, year: y < 100 ? 2000 + y : y };
    }
  }
  return null;
}

export type ImportResult = {
  ok: number;
  newPeriods: number;
  errors: string[];
};

/**
 * Import payslips from an Excel file. With `onlyMonth`, rows for other months
 * are skipped (used from a single period's page).
 */
export async function importPayrollExcel(
  file: File,
  opts: { onlyMonth?: { month: number; year: number } } = {},
): Promise<ImportResult> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
    wb.Sheets[wb.SheetNames[0]],
    { defval: "" },
  );
  if (!rows.length) throw new Error("No rows found in the file");

  const [members, items, structures] = await Promise.all([
    getOrgMembers(),
    getPayItems(),
    getSalaryStructures(),
  ]);
  // statutory deductions (EPF/SOCSO/EIS/PCB) are auto-calculated, not columns
  const allItems = items;
  const activeItems = items.filter(isImportItem);
  const byEmail = new Map(members.map((m) => [m.email.toLowerCase(), m]));
  const structByUser = new Map(structures.map((s) => [s.userId, s]));

  const norm = (h: string) => h.trim().toLowerCase();
  const get = (r: Record<string, unknown>, header: string) => {
    const k = Object.keys(r).find((h) => norm(h) === norm(header));
    return k ? r[k] : "";
  };
  const getPrefix = (r: Record<string, unknown>, prefix: string) => {
    const k = Object.keys(r).find((h) => norm(h).startsWith(prefix));
    return k ? r[k] : "";
  };
  const blank = (v: unknown) => String(v ?? "").trim() === "";
  const num = (v: unknown) => {
    const x = Number(String(v ?? "").replace(/,/g, "").trim());
    return Number.isFinite(x) ? x : 0;
  };

  const periodIds = new Map<string, string | null>();
  const result: ImportResult = { ok: 0, newPeriods: 0, errors: [] };

  for (const [i, r] of rows.entries()) {
    const email = String(getPrefix(r, "email")).trim().toLowerCase();
    if (!email) continue;
    const rowNo = i + 2;

    const pm = parseMonth(getPrefix(r, "month"));
    if (!pm) {
      result.errors.push(`Row ${rowNo}: invalid month`);
      continue;
    }
    if (
      opts.onlyMonth &&
      (pm.month !== opts.onlyMonth.month || pm.year !== opts.onlyMonth.year)
    ) {
      result.errors.push(`Row ${rowNo}: other month, skipped`);
      continue;
    }
    const m = byEmail.get(email);
    if (!m) {
      result.errors.push(`Row ${rowNo}: ${email} not a member`);
      continue;
    }
    const st = structByUser.get(m.userId);

    const basicCell = getPrefix(r, "basic");
    const basic = blank(basicCell) ? Number(st?.basicSalary ?? 0) : num(basicCell);
    if (!(basic > 0)) {
      result.errors.push(`Row ${rowNo}: no basic salary (and no salary structure)`);
      continue;
    }

    const lines: { payItemId: string; amount: number; employerAmount?: number }[] = [];
    // Pending case allowances are included automatically
    for (const it of allItems)
      if (it.isActive && it.kind === "earning" && it.calcType === "invoice_allowance")
        lines.push({ payItemId: it.id, amount: 0 });
    for (const it of activeItems) {
      if (it.systemKey) {
        // manual statutory deduction: employee + employer amounts
        const emp = num(get(r, itemHeader(it)));
        const er = it.systemKey !== "pcb" ? num(get(r, employerHeader(it))) : 0;
        if (emp > 0 || er > 0) lines.push({ payItemId: it.id, amount: emp, employerAmount: er });
        continue;
      }
      const cell = get(r, itemHeader(it));
      let amount: number | null = null;
      if (!blank(cell)) amount = num(cell);
      else if (it.recurring) {
        const si = st?.items.find((x) => x.payItemId === it.id);
        if (si) amount = Number(si.amount);
      }
      if (amount && amount > 0) lines.push({ payItemId: it.id, amount });
    }

    const key = `${pm.year}-${pm.month}`;
    if (!periodIds.has(key)) {
      try {
        const p = await ensurePayrollPeriod(pm.month, pm.year);
        if (p.created) result.newPeriods++;
        periodIds.set(key, p.id);
      } catch (e) {
        result.errors.push(
          `Row ${rowNo}: ${e instanceof Error ? e.message : "period failed"}`,
        );
        periodIds.set(key, null);
      }
    }
    const periodId = periodIds.get(key);
    if (!periodId) continue;

    const pcb = String(get(r, PCB_HEADER)).trim();
    try {
      await createPayslip({
        periodId,
        userId: m.userId,
        basicSalary: basic,
        lines,
        manualLhdn: pcb === "" ? undefined : num(pcb),
      });
      result.ok++;
    } catch (e) {
      result.errors.push(`Row ${rowNo}: ${e instanceof Error ? e.message : "failed"}`);
    }
  }
  return result;
}
