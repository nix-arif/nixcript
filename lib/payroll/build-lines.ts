// Turns a payslip's inputs (basic salary + pay-item amounts) into payslip lines
// and totals. Shared by the server (what is stored) and the payslip form (live
// preview) so both always agree.
import { calculatePayslip } from "@/lib/payroll/calculate";

export type PayItemDef = {
  id: string;
  name: string;
  kind: string; // earning | deduction
  systemKey: string | null; // epf | socso | eis | pcb → statutory deduction
  calcType: string; // fixed | per_unit | invoice_allowance | auto | manual (statutory: auto = calculated, manual = typed)
  inEpf: boolean;
  inSocso: boolean;
  inEis: boolean;
  inPcb: boolean;
  isActive: boolean;
  commissionTypeId?: string | null; // invoice_allowance items
};

// What a person enters: an amount against a pay item (or a free-text line)
export type LineInput = {
  payItemId?: string | null;
  label?: string; // free-text lines only
  kind?: "earning" | "deduction"; // free-text lines only
  quantity?: string;
  rate?: string;
  // invoice_allowance items: the Allowance rows included (amount is then taken from them)
  sourceIds?: string[];
  // manual statutory items: employer contribution typed alongside the employee amount
  employerAmount?: number;
  amount: number;
};

export type ComputedLine = {
  payItemId: string | null;
  code: string | null; // epf | socso | eis | pcb
  kind: "earning" | "deduction" | "employer";
  label: string;
  quantity: string | null;
  rate: string | null;
  amount: number;
  sortOrder: number;
};

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export const STATUTORY = [
  { key: "epf", name: "EPF", employerName: "EPF (employer)" },
  { key: "socso", name: "SOCSO", employerName: "SOCSO (employer)" },
  { key: "eis", name: "EIS", employerName: "EIS (employer)" },
  { key: "pcb", name: "PCB / LHDN", employerName: null },
] as const;

export function buildPayslip(input: {
  basicSalary: number;
  month: number;
  items: PayItemDef[];
  inputs: LineInput[];
  manualPcb?: number;
  // yearly tax relief HR set for this employee (see lib/payroll/relief.ts)
  relief?: { fixed: number; epfCap: number | null };
}) {
  const { basicSalary, month, items, inputs, manualPcb, relief } = input;
  const byId = new Map(items.map((i) => [i.id, i]));
  const lines: ComputedLine[] = [];

  let earningsTotal = 0;
  let deductionsTotal = 0;
  let epfAllowances = 0;
  let socsoAllowances = 0;
  let eisAllowances = 0;
  let pcbAllowances = 0;

  // Statutory items set to "manual" take typed amounts instead of the calculation
  const manualInputs = new Map<string, LineInput>();
  for (const inp of inputs) {
    const d = inp.payItemId ? byId.get(inp.payItemId) : undefined;
    if (d?.systemKey) manualInputs.set(d.id, inp);
  }

  for (const inp of inputs) {
    const amount = r2(inp.amount || 0);
    if (!(amount > 0)) continue;
    const def = inp.payItemId ? byId.get(inp.payItemId) : undefined;
    if (def?.systemKey) continue; // handled with the statutory lines below
    const kind = (def?.kind ?? inp.kind ?? "earning") as "earning" | "deduction";
    lines.push({
      payItemId: def?.id ?? null,
      code: null,
      kind,
      label: def?.name ?? inp.label ?? "",
      quantity: inp.quantity ?? null,
      rate: inp.rate ?? null,
      amount,
      sortOrder: kind === "earning" ? 10 : 30,
    });
    if (kind === "earning") {
      earningsTotal += amount;
      if (def?.inEpf) epfAllowances += amount;
      if (def?.inSocso) socsoAllowances += amount;
      if (def?.inEis) eisAllowances += amount;
      if (def?.inPcb) pcbAllowances += amount;
    } else deductionsTotal += amount;
  }

  const calc = calculatePayslip({
    basicSalary,
    allowances: earningsTotal,
    epfAllowances,
    socsoAllowances,
    eisAllowances,
    pcbAllowances,
    otherDeductions: 0,
    manualLhdn: manualPcb,
    reliefFixed: relief?.fixed,
    epfReliefCap: relief?.epfCap,
    currentMonth: month,
  });

  const amounts = {
    epf: { employee: calc.epf.employee, employer: calc.epf.employer },
    socso: { employee: calc.socso.employee, employer: calc.socso.employer },
    eis: { employee: calc.eis.employee, employer: calc.eis.employer },
    pcb: { employee: calc.lhdn, employer: 0 },
  };
  let statutoryEmployee = 0;
  STATUTORY.forEach((s, idx) => {
    const def = items.find((i) => i.systemKey === s.key);
    if (def && !def.isActive) return; // HR switched this deduction off
    const typed = def?.calcType === "manual" ? manualInputs.get(def.id) : undefined;
    const a =
      def?.calcType === "manual"
        ? { employee: typed?.amount || 0, employer: typed?.employerAmount || 0 }
        : amounts[s.key];
    if (a.employee > 0) {
      lines.push({
        payItemId: def?.id ?? null,
        code: s.key,
        kind: "deduction",
        label: def?.name ?? s.name,
        quantity: null,
        rate: null,
        amount: r2(a.employee),
        sortOrder: 20 + idx,
      });
      statutoryEmployee += r2(a.employee);
    }
    if (s.employerName && a.employer > 0)
      lines.push({
        payItemId: def?.id ?? null,
        code: s.key,
        kind: "employer",
        label: `${def?.name ?? s.name} (employer)`,
        quantity: null,
        rate: null,
        amount: r2(a.employer),
        sortOrder: 40 + idx,
      });
  });

  lines.sort((a, b) => a.sortOrder - b.sortOrder);
  const gross = r2(basicSalary + earningsTotal);
  const totalDeductions = r2(statutoryEmployee + deductionsTotal);
  return {
    lines,
    gross,
    totalDeductions,
    netPay: r2(gross - totalDeductions),
    taxableIncome: r2(basicSalary + pcbAllowances),
    calc,
  };
}

// Group stored lines for display
export type StoredLine = {
  kind: string;
  code: string | null;
  label: string;
  amount: string | number;
  quantity?: string | null;
  rate?: string | null;
};
export function splitLines(lines: StoredLine[]) {
  return {
    earnings: lines.filter((l) => l.kind === "earning"),
    statutory: lines.filter((l) => l.kind === "deduction" && l.code),
    deductions: lines.filter((l) => l.kind === "deduction" && !l.code),
    employer: lines.filter((l) => l.kind === "employer"),
  };
}
export const lineAmount = (lines: StoredLine[], kind: string, code: string) =>
  lines
    .filter((l) => l.kind === kind && l.code === code)
    .reduce((s, l) => s + Number(l.amount), 0);
