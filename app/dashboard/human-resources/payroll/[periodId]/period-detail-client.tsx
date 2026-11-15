"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  createPayslip,
  updatePayslip,
  deletePayslip,
  approvePayrollPeriod,
  publishPayrollPeriod,
  getOrgMembers,
  getPeriodDetail,
  getPayItems,
  getSalaryStructures,
  getCaseAllowanceCandidates,
  generatePayslips,
  recallPayrollPeriod,
} from "@/server/payroll";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  ArrowLeftIcon,
  PlusIcon,
  SparklesIcon,
  CheckCircleIcon,
  SendIcon,
  TrashIcon,
  PencilIcon,
  EyeIcon,
  Undo2Icon,
  DownloadIcon,
  XIcon,
} from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { buildPayslip, type LineInput } from "@/lib/payroll/build-lines";
import type { AllowanceCandidate } from "@/lib/payroll/allowance-source";

type Cand = AllowanceCandidate & { payItemId: string };
import { PayrollImportMenu } from "../payroll-import-menu";
import { downloadPayslipPdf } from "../../payslips/download-payslip-pdf";

type PeriodData = Awaited<ReturnType<typeof getPeriodDetail>>;
type Member = Awaited<ReturnType<typeof getOrgMembers>>[number];
type PayItemRow = Awaited<ReturnType<typeof getPayItems>>[number];
type PayslipRow = NonNullable<PeriodData>["payslips"][number];

const STATUS_CONFIG = {
  draft: {
    label: "Draft",
    className:
      "bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800",
  },
  approved: {
    label: "Approved",
    className:
      "bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-800",
  },
  published: {
    label: "Published",
    className:
      "bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800",
  },
};

import { acc } from "@/lib/payroll/format";

const fmt = (v: string | number) => `RM ${acc(v)}`;

function StatusBadge({ status }: { status: string }) {
  const c =
    STATUS_CONFIG[status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.draft;
  return (
    <span
      className={cn("text-[11px] font-medium rounded px-2 py-0.5", c.className)}
    >
      {c.label}
    </span>
  );
}

type Allowance = { label: string; amount: string; quantity?: string; rate?: string };
type StructureRow = Awaited<ReturnType<typeof getSalaryStructures>>[number];

interface PayslipFormState {
  userId: string;
  basicSalary: string;
  // pay item id -> amount (fixed-amount items, and manual statutory deductions)
  amounts: Record<string, string>;
  // manual statutory items: employer contribution, pay item id -> amount
  employer: Record<string, string>;
  // per-unit pay items (e.g. cases × rate): pay item id -> quantity / rate
  units: Record<string, { qty: string; rate: string }>;
  // Lines on an existing payslip whose label no longer matches an active pay item
  legacyAllowances: Allowance[];
  legacyDeductions: Allowance[];
  // Allowance-module rows included in the case-allowance item: allowance id -> selected
  selected: Record<string, boolean>;
  manualLhdn: string;
  overrideLhdn: boolean;
}

const EMPTY_FORM: PayslipFormState = {
  userId: "",
  basicSalary: "",
  amounts: {},
  employer: {},
  units: {},
  legacyAllowances: [],
  legacyDeductions: [],
  selected: {},
  manualLhdn: "",
  overrideLhdn: false,
};

const num = (v: string | undefined | null) => Number(v) || 0;

// Amount of one pay item on the form (fixed amount, or quantity × rate)
function itemAmount(f: PayslipFormState, it: PayItemRow, rows: Cand[]) {
  if (it.calcType === "invoice_allowance")
    return rows
      .filter((r) => r.payItemId === it.id && f.selected[r.id])
      .reduce((s, r) => s + Number(r.amount), 0);
  if (it.calcType === "per_unit") {
    const u = f.units[it.id];
    return u ? num(u.qty) * num(u.rate) : 0;
  }
  return num(f.amounts[it.id]);
}

// Pay items the person fills in (statutory deductions are auto-calculated)
// Statutory items set to "manual" are typed in; "auto" ones are calculated.
const isInput = (it: PayItemRow) => (it.systemKey ? it.calcType === "manual" : it.calcType !== "auto");

// What the server needs: one input per pay item with an amount, plus free-text lines
function buildInputs(form: PayslipFormState, payItems: PayItemRow[], rows: Cand[]): LineInput[] {
  const out: LineInput[] = [];
  for (const it of payItems) {
    if (!isInput(it)) continue;
    const amount = itemAmount(form, it, rows);
    if (it.systemKey) {
      // manual statutory deduction: employee amount + optional employer share
      const employerAmount = num(form.employer[it.id]);
      if (amount > 0 || employerAmount > 0) out.push({ payItemId: it.id, amount, employerAmount });
      continue;
    }
    if (!(amount > 0)) continue;
    out.push({
      payItemId: it.id,
      amount,
      ...(it.calcType === "invoice_allowance"
        ? { sourceIds: rows.filter((r) => r.payItemId === it.id && form.selected[r.id]).map((r) => r.id) }
        : {}),
      ...(it.calcType === "per_unit"
        ? { quantity: form.units[it.id]?.qty, rate: form.units[it.id]?.rate }
        : {}),
    });
  }
  for (const l of form.legacyAllowances)
    if (l.label.trim() && num(l.amount) > 0)
      out.push({ label: l.label, kind: "earning", amount: num(l.amount) });
  for (const l of form.legacyDeductions)
    if (l.label.trim() && num(l.amount) > 0)
      out.push({ label: l.label, kind: "deduction", amount: num(l.amount) });
  return out;
}

function formFromPayslip(p: PayslipRow, payItems: PayItemRow[]): PayslipFormState {
  const amounts: Record<string, string> = {};
  const units: Record<string, { qty: string; rate: string }> = {};
  const legacyAllowances: Allowance[] = [];
  const legacyDeductions: Allowance[] = [];
  const employer: Record<string, string> = {};

  // Statutory lines typed in manually keep their values when editing
  for (const l of p.lines.filter((x) => x.code)) {
    const it = payItems.find((x) => x.systemKey === l.code && x.calcType === "manual");
    if (!it) continue;
    if (l.kind === "deduction") amounts[it.id] = String(Number(l.amount));
    else if (l.kind === "employer") employer[it.id] = String(Number(l.amount));
  }

  // Auto-calculated statutory lines (code set) are recomputed, not edited
  for (const l of p.lines.filter((x) => x.kind !== "employer" && !x.code)) {
    const it = payItems.find((x) => x.id === l.payItemId && isInput(x));
    if (it?.calcType === "invoice_allowance") continue; // re-selected from the Allowance module rows
    if (!it) {
      (l.kind === "earning" ? legacyAllowances : legacyDeductions).push({
        label: l.label,
        amount: String(Number(l.amount)),
      });
      continue;
    }
    if (it.calcType === "per_unit") {
      const rate = l.rate ?? it.rate ?? "0";
      const qty = l.quantity ?? (num(rate) > 0 ? String(Number(l.amount) / num(rate)) : "0");
      const prev = units[it.id];
      units[it.id] = prev ? { qty: String(num(prev.qty) + num(qty)), rate: prev.rate } : { qty, rate };
    } else amounts[it.id] = String(num(amounts[it.id]) + Number(l.amount));
  }

  return {
    userId: p.userId,
    basicSalary: p.basicSalary,
    amounts,
    employer,
    units,
    legacyAllowances,
    legacyDeductions,
    selected: {},
    manualLhdn: "",
    overrideLhdn: false,
  };
}

function formFromStructure(userId: string, st: StructureRow | undefined): PayslipFormState {
  const amounts: Record<string, string> = {};
  for (const i of st?.items ?? []) amounts[i.payItemId] = String(num(i.amount));
  return {
    ...EMPTY_FORM,
    userId,
    basicSalary: st?.hasStructure ? String(num(st.basicSalary)) : "",
    amounts,
  };
}

function FlagBadges({ item }: { item: PayItemRow }) {
  if (item.kind !== "earning" || item.systemKey) return null;
  return (
    <span className="ml-1.5 inline-flex gap-1 align-middle">
      {([["inEpf", "EPF"], ["inSocso", "SOCSO"], ["inEis", "EIS"], ["inPcb", "PCB"]] as const).map(
        ([k, label]) =>
          item[k] && (
            <span key={k} className="text-[9px] font-medium px-1 py-px rounded border border-amber-200 bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:border-amber-800 dark:text-amber-400">
              {label}
            </span>
          ),
      )}
    </span>
  );
}

interface PayslipSheetProps {
  open: boolean;
  onClose: () => void;
  periodId: string;
  periodStatus: string;
  editPayslip?: PayslipRow | null;
  isViewOnly?: boolean;
  members: Member[];
  payItems: PayItemRow[];
  structures: StructureRow[];
  onSaved: () => void;
  periodMonth: number;
}

function PayslipSheet({
  open,
  onClose,
  periodId,
  periodStatus,
  editPayslip,
  isViewOnly = false,
  members,
  payItems,
  structures,
  onSaved,
  periodMonth,
}: PayslipSheetProps) {
  const [form, setForm] = useState<PayslipFormState>(EMPTY_FORM);
  const [calcResult, setCalcResult] = useState<ReturnType<typeof buildPayslip> | null>(null);
  const [saving, setSaving] = useState(false);
  const [invoiceRows, setInvoiceRows] = useState<Cand[]>([]);
  const [loadingRows, setLoadingRows] = useState(false);

  const isEdit = !!editPayslip;
  const isReadOnly = isViewOnly || periodStatus === "published";
  // Read-only payslips show money in accounting format (1,234.56)
  const ro = (v: string) => (isReadOnly && v.trim() !== "" && !isNaN(Number(v)) ? acc(v) : v);

  // An item shows on the form if HR left it active, or the payslip already uses it
  const visible = (it: PayItemRow) => it.isActive || itemAmount(form, it, invoiceRows) > 0;
  const hasInvoiceItem = payItems.some((p) => p.calcType === "invoice_allowance" && p.kind === "earning");
  const earningItems = payItems.filter((p) => isInput(p) && p.kind === "earning" && visible(p));
  const deductionItems = payItems.filter((p) => isInput(p) && p.kind === "deduction" && visible(p));

  const runCalcWith = useCallback(
    (f: PayslipFormState, rows: Cand[] = invoiceRows) => {
      const basic = num(f.basicSalary);
      if (basic <= 0) {
        setCalcResult(null);
        return;
      }
      setCalcResult(
        buildPayslip({
          basicSalary: basic,
          month: periodMonth,
          items: payItems,
          inputs: buildInputs(f, payItems, rows),
          manualPcb: f.overrideLhdn ? num(f.manualLhdn) : undefined,
          relief: structures.find((x) => x.userId === (f.userId || editPayslip?.userId))?.relief,
        }),
      );
    },
    [periodMonth, payItems, invoiceRows, structures, editPayslip],
  );

  const runCalc = useCallback(() => {
    setForm((current) => {
      runCalcWith(current);
      return current;
    });
  }, [runCalcWith]);

  useEffect(() => {
    if (!open) return;
    setShowingEarlier(false);
    if (editPayslip) {
      const f = formFromPayslip(editPayslip, payItems);
      setForm(f);
      runCalcWith(f, []);
      if (hasInvoiceItem) {
        setLoadingRows(true);
        getCaseAllowanceCandidates(editPayslip.userId, periodId, editPayslip.id)
          .then((rows) => {
            setInvoiceRows(rows);
            const withSel = { ...f, selected: Object.fromEntries(rows.filter((r) => r.linked).map((r) => [r.id, true])) };
            setForm(withSel);
            runCalcWith(withSel, rows);
          })
          .catch(() => setInvoiceRows([]))
          .finally(() => setLoadingRows(false));
      }
    } else {
      setForm(EMPTY_FORM);
      setInvoiceRows([]);
      setCalcResult(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editPayslip, payItems]);

  const set = useCallback(
    <K extends keyof PayslipFormState>(key: K, val: PayslipFormState[K]) =>
      setForm((f) => ({ ...f, [key]: val })),
    [],
  );
  const setAmount = (id: string, v: string) =>
    setForm((f) => ({ ...f, amounts: { ...f.amounts, [id]: v } }));
  const setUnit = (it: PayItemRow, patch: Partial<{ qty: string; rate: string }>) =>
    setForm((f) => {
      const cur = f.units[it.id] ?? { qty: "", rate: it.rate ?? "" };
      return { ...f, units: { ...f.units, [it.id]: { ...cur, ...patch } } };
    });

  const pickEmployee = (userId: string) => {
    // New payslip: start from the employee's salary structure
    const f = formFromStructure(userId, structures.find((s) => s.userId === userId));
    setForm(f);
    setInvoiceRows([]);
    runCalcWith(f, []);
    if (hasInvoiceItem) {
      setLoadingRows(true);
      getCaseAllowanceCandidates(userId, periodId)
        .then((rows) => {
          setInvoiceRows(rows);
          const withSel = { ...f, selected: Object.fromEntries(rows.filter((r) => r.inPeriod).map((r) => [r.id, true])) };
          setForm(withSel);
          runCalcWith(withSel, rows);
        })
        .catch((e) => toast.error(e instanceof Error ? e.message : "Could not load case allowances"))
        .finally(() => setLoadingRows(false));
    }
  };

  const handleSave = async () => {
    if (!form.userId && !isEdit) return toast.error("Select an employee");
    if (!form.basicSalary || Number(form.basicSalary) <= 0)
      return toast.error("Enter basic salary");
    setSaving(true);
    try {
      const body = {
        basicSalary: Number(form.basicSalary),
        lines: buildInputs(form, payItems, invoiceRows),
        manualLhdn: form.overrideLhdn ? num(form.manualLhdn) : undefined,
      };
      if (isEdit) {
        await updatePayslip(editPayslip!.id, body);
        toast.success("Payslip updated");
      } else {
        await createPayslip({ periodId, userId: form.userId, ...body });
        toast.success("Payslip created");
      }
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save payslip");
    } finally {
      setSaving(false);
    }
  };

  const [showingEarlier, setShowingEarlier] = useState(false);
  const loadEarlier = async () => {
    const uid = isEdit ? editPayslip!.userId : form.userId;
    if (!uid) return;
    setLoadingRows(true);
    try {
      const rows = await getCaseAllowanceCandidates(uid, periodId, editPayslip?.id, true);
      setInvoiceRows(rows);
      setShowingEarlier(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load earlier allowances");
    } finally {
      setLoadingRows(false);
    }
  };

  const toggleRow = (id: string, on: boolean) => {
    const next = { ...form, selected: { ...form.selected, [id]: on } };
    setForm(next);
    runCalcWith(next);
  };

  const amountInput = (it: PayItemRow) => {
    const itemRows = invoiceRows.filter((r) => r.payItemId === it.id);
    if (it.systemKey)
      return (
        <div key={it.id} className="col-span-2 grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">
              {it.name} — employee (RM)
              <span className="ml-1.5 text-[9px] font-medium px-1 py-px rounded border border-border">Manual</span>
            </label>
            <Input
              value={ro(form.amounts[it.id] ?? "")}
              onChange={(e) => setAmount(it.id, e.target.value)}
              onBlur={runCalc}
              placeholder="0.00"
              type={isReadOnly ? "text" : "number"}
              min="0"
              className="h-9 text-sm"
              disabled={isReadOnly}
            />
          </div>
          {it.systemKey !== "pcb" && (
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                {it.name} — employer (RM)
              </label>
              <Input
                value={ro(form.employer[it.id] ?? "")}
                onChange={(e) => setForm((f) => ({ ...f, employer: { ...f.employer, [it.id]: e.target.value } }))}
                onBlur={runCalc}
                placeholder="0.00"
                type={isReadOnly ? "text" : "number"}
                min="0"
                className="h-9 text-sm"
                disabled={isReadOnly}
              />
            </div>
          )}
        </div>
      );
    return it.calcType === "invoice_allowance" ? (
      <div key={it.id} className="col-span-2 border border-dashed border-border rounded-md p-3 space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold text-foreground">
            {it.name}
            <FlagBadges item={it} />
          </label>
          <span className="text-[10px] text-muted-foreground">From Custom Commission</span>
        </div>
        {loadingRows ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : itemRows.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {form.userId || isEdit ? "Nothing pending this month." : "Select an employee to see their earnings."}
          </p>
        ) : (
          <div className="max-h-48 overflow-y-auto divide-y divide-border border border-border rounded-md">
            {itemRows.map((r) => (
              <label
                key={r.id}
                className="flex items-center gap-2.5 px-2.5 py-1.5 text-xs cursor-pointer hover:bg-muted/40"
              >
                <input
                  type="checkbox"
                  checked={!!form.selected[r.id]}
                  disabled={isReadOnly}
                  onChange={(e) => toggleRow(r.id, e.target.checked)}
                />
                <span className="w-24 shrink-0 text-muted-foreground">
                  {r.caseDate
                    ? new Date(r.caseDate).toLocaleDateString("en-MY", r.inPeriod ? { day: "2-digit", month: "short" } : { day: "2-digit", month: "short", year: "2-digit" })
                    : "—"}
                  {!r.inPeriod && " ·old"}
                </span>
                <span className="flex-1 min-w-0 truncate">
                  {r.invoiceNo} · {r.categoryName}
                  <span className="text-muted-foreground">
                    {" "}· {r.role === "app_specialist" ? "AS" : "SP"} · {r.dayType}
                  </span>
                </span>
                <span className="font-mono shrink-0">RM {acc(r.amount)}</span>
              </label>
            ))}
          </div>
        )}
        {!isReadOnly && !showingEarlier && (form.userId || isEdit) && !loadingRows && (
          <button type="button" onClick={loadEarlier} className="text-xs text-primary">
            Show earlier unpaid allowances
          </button>
        )}
        {itemRows.length > 0 && (
          <div className="flex justify-between text-xs pt-0.5">
            <span className="text-muted-foreground">
              {itemRows.filter((r) => form.selected[r.id]).length} of {itemRows.length} selected
            </span>
            <span className="font-mono font-medium">RM {acc(itemAmount(form, it, invoiceRows))}</span>
          </div>
        )}
      </div>
    ) : it.calcType === "per_unit" ? (
      <div key={it.id} className="col-span-2 border border-dashed border-border rounded-md p-3 space-y-2">
        <label className="text-xs font-semibold text-foreground">
          {it.name}
          <FlagBadges item={it} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-muted-foreground mb-1.5">
              No. of {it.unitLabel || "units"}
            </label>
            <Input
              value={form.units[it.id]?.qty ?? ""}
              onChange={(e) => setUnit(it, { qty: e.target.value })}
              onBlur={runCalc}
              placeholder="0"
              type="number"
              min="0"
              className="h-9 text-sm"
              disabled={isReadOnly}
            />
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1.5">
              Rate per {it.unitLabel || "unit"} (RM)
            </label>
            <Input
              value={ro(form.units[it.id]?.rate ?? it.rate ?? "")}
              onChange={(e) => setUnit(it, { rate: e.target.value })}
              onBlur={runCalc}
              placeholder="0.00"
              type={isReadOnly ? "text" : "number"}
              min="0"
              className="h-9 text-sm"
              disabled={isReadOnly}
            />
          </div>
        </div>
        {itemAmount(form, it, invoiceRows) > 0 && (
          <div className="flex justify-between text-xs pt-0.5">
            <span className="text-muted-foreground">
              {form.units[it.id]?.qty} {it.unitLabel || "units"} × RM{" "}
              {form.units[it.id]?.rate ?? it.rate}
            </span>
            <span className="font-mono font-medium">RM {acc(itemAmount(form, it, invoiceRows))}</span>
          </div>
        )}
      </div>
    ) : (
      <div key={it.id}>
        <label className="block text-xs font-medium text-muted-foreground mb-1.5">
          {it.name} (RM)
          <FlagBadges item={it} />
        </label>
        <Input
          value={ro(form.amounts[it.id] ?? "")}
          onChange={(e) => setAmount(it.id, e.target.value)}
          onBlur={runCalc}
          placeholder="0.00"
          type={isReadOnly ? "text" : "number"}
          min="0"
          className="h-9 text-sm"
          disabled={isReadOnly}
        />
      </div>
    );
  };

  const legacyRows = (
    key: "legacyAllowances" | "legacyDeductions",
    title: string,
  ) =>
    form[key].length > 0 && (
      <div>
        <div className="text-xs font-medium text-muted-foreground mb-1.5">
          {title}{" "}
          <span className="font-normal">(not in Payslip Settings)</span>
        </div>
        {form[key].map((item, i) => (
          <div key={i} className="flex gap-2 mb-1.5 items-center">
            <div className="h-8 text-xs flex-1 border border-input rounded-md px-2 bg-muted/40 flex items-center truncate">
              {item.label}
            </div>
            <input
              value={item.amount}
              onChange={(e) => {
                const n = [...form[key]];
                n[i] = { ...n[i], amount: e.target.value };
                set(key, n);
              }}
              onBlur={runCalc}
              className="h-8 text-xs w-28 border border-input rounded-md px-2 bg-background"
              type="number"
              disabled={isReadOnly}
            />
            {!isReadOnly && (
              <button
                type="button"
                onClick={() => {
                  set(key, form[key].filter((_, idx) => idx !== i));
                  setTimeout(runCalc, 0);
                }}
              >
                <XIcon className="w-3.5 h-3.5 text-muted-foreground hover:text-destructive" />
              </button>
            )}
          </div>
        ))}
      </div>
    );

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent className="w-full max-w-2xl! px-10 overflow-y-auto">
        <SheetHeader className="mb-4">
          <SheetTitle>
            {isViewOnly ? "View payslip" : isEdit ? "Edit payslip" : "Add payslip"}
          </SheetTitle>
        </SheetHeader>

        <div className="space-y-4">
          {/* Employee */}
          {!isEdit ? (
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                Employee
              </label>
              <Select onValueChange={pickEmployee} value={form.userId}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="Select employee" />
                </SelectTrigger>
                <SelectContent>
                  {members.map((m) => (
                    <SelectItem key={m.userId} value={m.userId} className="lowercase">
                      {m.fullname || m.name} — {m.email} - {m.jobTitle || m.role}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {form.userId &&
                !structures.find((s) => s.userId === form.userId)?.hasStructure && (
                  <p className="text-[11px] text-muted-foreground mt-1">
                    No salary structure for this employee — fill in manually, or
                    set one up under Payslip Settings → Salary structure.
                  </p>
                )}
            </div>
          ) : (
            <div className="p-3 bg-muted/40 rounded-lg">
              <div className="text-sm font-medium">{editPayslip?.employeeName}</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {editPayslip?.jobTitle} · {editPayslip?.department}
              </div>
            </div>
          )}

          {/* Earnings — driven by Payslip Settings */}
          <div className="border border-border rounded-lg overflow-hidden">
            <div className="px-3 py-2 bg-muted/30 border-b border-border">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Earnings
              </span>
            </div>
            <div className="p-3 space-y-3">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                  Basic salary (RM)
                </label>
                <Input
                  value={ro(form.basicSalary)}
                  onChange={(e) => set("basicSalary", e.target.value)}
                  onBlur={runCalc}
                  placeholder="0.00"
                  type={isReadOnly ? "text" : "number"}
                  className="h-9 text-sm"
                  disabled={isReadOnly}
                />
              </div>

              {earningItems.length > 0 && (
                <div className="grid grid-cols-2 gap-3">
                  {earningItems.map(amountInput)}
                </div>
              )}

              {legacyRows("legacyAllowances", "Other earnings")}

              <p className="text-[11px] text-muted-foreground">
                Items shown here come from Payslip Settings.
              </p>
            </div>
          </div>

          {/* Deductions */}
          <div className="border border-border rounded-lg overflow-hidden">
            <div className="px-3 py-2 bg-muted/30 border-b border-border">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Deductions
              </span>
            </div>
            <div className="p-3 space-y-2">
              {calcResult && (
                <div className="space-y-1.5 text-xs">
                  {calcResult.lines
                    .filter((l) => l.kind === "deduction" && l.code)
                    .map((l) => (
                      <div key={l.label} className="flex justify-between">
                        <span className="text-muted-foreground">{l.label}</span>
                        <span className="font-mono">RM {acc(l.amount)}</span>
                      </div>
                    ))}
                  <div className="text-[10px] text-muted-foreground">
                    EPF, SOCSO, EIS and PCB are auto-calculated unless set to manual in Payslip Settings
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="overrideLhdn"
                  checked={form.overrideLhdn}
                  onChange={(e) => {
                    set("overrideLhdn", e.target.checked);
                    if (!e.target.checked) setTimeout(runCalc, 0);
                  }}
                  disabled={isReadOnly}
                  className="w-3.5 h-3.5"
                />
                <label
                  htmlFor="overrideLhdn"
                  className="text-xs text-muted-foreground cursor-pointer"
                >
                  Override PCB / LHDN manually
                </label>
              </div>

              {form.overrideLhdn && (
                <Input
                  value={ro(form.manualLhdn)}
                  onChange={(e) => set("manualLhdn", e.target.value)}
                  onBlur={runCalc}
                  placeholder="Manual LHDN amount"
                  type={isReadOnly ? "text" : "number"}
                  className="h-8 text-xs"
                  disabled={isReadOnly}
                />
              )}

              {deductionItems.length > 0 && (
                <div className="grid grid-cols-2 gap-3 pt-1">
                  {deductionItems.map(amountInput)}
                </div>
              )}
              {legacyRows("legacyDeductions", "Other deductions")}
            </div>
          </div>

          {/* Summary */}
          {calcResult && (
            <div className="border border-border rounded-lg overflow-hidden">
              <div className="px-3 py-2 bg-muted/30 border-b border-border">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Summary
                </span>
              </div>
              <div className="p-3 space-y-1.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Gross pay</span>
                  <span className="font-mono font-medium">
                    {fmt(calcResult.gross)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    Total deductions
                  </span>
                  <span className="font-mono text-red-600">
                    - {fmt(calcResult.totalDeductions)}
                  </span>
                </div>
                <div className="flex justify-between border-t border-border pt-1.5 mt-1">
                  <span className="font-medium">Net pay</span>
                  <span className="font-mono font-semibold text-green-600">
                    {fmt(calcResult.netPay)}
                  </span>
                </div>
                <div className="pt-1.5 border-t border-border">
                  <div className="text-muted-foreground mb-1.5">
                    Employer contributions
                  </div>
                  {calcResult.lines
                    .filter((l) => l.kind === "employer")
                    .map((l) => (
                      <div key={l.label} className="flex justify-between mb-1">
                        <span className="text-muted-foreground">{l.label}</span>
                        <span className="font-mono">RM {acc(l.amount)}</span>
                      </div>
                    ))}
                </div>
              </div>
            </div>
          )}

          {!isReadOnly && (
            <Button
              onClick={handleSave}
              disabled={saving}
              className="w-full gap-2"
            >
              {saving && (
                <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
              )}
              {isEdit ? "Update payslip" : "Create payslip"}
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export function PeriodDetailClient({
  data,
  canRecall = false,
}: {
  data: NonNullable<PeriodData>;
  canRecall?: boolean;
}) {
  const router = useRouter();
  const { period, payslips, totalGross, totalDeductions, totalNet } = data;
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editPayslip, setEditPayslip] = useState<PayslipRow | null>(null);
  const [isViewOnly, setIsViewOnly] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [payItems, setPayItems] = useState<PayItemRow[]>([]);
  const [structures, setStructures] = useState<StructureRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const isEditable = period.status !== "published";
  const [generating, setGenerating] = useState(false);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const r = await generatePayslips(period.id);
      toast.success(
        `${r.created} payslip${r.created !== 1 ? "s" : ""} generated` +
          (r.skipped ? `, ${r.skipped} already existed` : ""),
      );
      if (r.errors.length) toast.error(r.errors.slice(0, 3).join("; "));
      router.refresh();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setGenerating(false);
    }
  };

  const loadMembers = async () => {
    if (!loaded) {
      const [m, items, st] = await Promise.all([
        getOrgMembers(),
        getPayItems(),
        getSalaryStructures(),
      ]);
      setMembers(m);
      setPayItems(items);
      setStructures(st);
      setLoaded(true);
    }
  };

  const openAdd = async () => {
    await loadMembers();
    setEditPayslip(null);
    setIsViewOnly(false);
    setSheetOpen(true);
  };

  const openEdit = async (p: PayslipRow) => {
    await loadMembers();
    setEditPayslip(p);
    setIsViewOnly(false);
    setSheetOpen(true);
  };

  const openView = async (p: PayslipRow) => {
    await loadMembers();
    setEditPayslip(p);
    setIsViewOnly(true);
    setSheetOpen(true);
  };

  const [pdfId, setPdfId] = useState<string | null>(null);
  const handlePdf = async (p: PayslipRow) => {
    setPdfId(p.id);
    try {
      await downloadPayslipPdf(p, { label: period.label, month: period.month, year: period.year });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create the PDF");
    } finally {
      setPdfId(null);
    }
  };

  const closeSheet = () => {
    setSheetOpen(false);
    setEditPayslip(null);
    setIsViewOnly(false);
  };

  const handleDelete = async (payslipId: string) => {
    if (!confirm("Delete this payslip?")) return;
    setActionLoading(payslipId);
    try {
      await deletePayslip(payslipId);
      toast.success("Payslip deleted");
      router.refresh();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleApprove = async () => {
    setActionLoading("approve");
    try {
      await approvePayrollPeriod(period.id);
      toast.success("Period approved");
      router.refresh();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setActionLoading(null);
    }
  };

  const [recallOpen, setRecallOpen] = useState(false);
  const [recallReason, setRecallReason] = useState("");
  const handleRecall = async () => {
    setActionLoading("recall");
    try {
      await recallPayrollPeriod(period.id, recallReason);
      toast.success("Period recalled to draft");
      setRecallOpen(false);
      setRecallReason("");
      router.refresh();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setActionLoading(null);
    }
  };

  const handlePublish = async () => {
    setActionLoading("publish");
    try {
      await publishPayrollPeriod(period.id);
      toast.success("Payslips published — employees can now view them");
      router.refresh();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="p-6">
      {/* Breadcrumb */}
      <button
        onClick={() => router.push("/dashboard/human-resources/payroll")}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-4 transition-colors"
      >
        <ArrowLeftIcon className="w-3.5 h-3.5" /> Payroll
      </button>

      {/* Header */}
      <div className="flex items-start justify-between mb-5">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-xl font-semibold tracking-tight">
              {period.label}
            </h1>
            <StatusBadge status={period.status} />
          </div>
          <p className="text-sm text-muted-foreground">
            {payslips.length} payslip{payslips.length !== 1 ? "s" : ""} ·
            Created{" "}
            {new Date(period.createdAt).toLocaleDateString("en-MY", {
              day: "2-digit",
              month: "short",
              year: "numeric",
            })}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {isEditable && (
            <>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                disabled={generating}
                onClick={handleGenerate}
              >
                <SparklesIcon className="w-3.5 h-3.5" />
                {generating ? "Generating…" : "Generate payslips"}
              </Button>
              <PayrollImportMenu
                onlyMonth={{ month: period.month, year: period.year }}
                onDone={() => router.refresh()}
              />
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={openAdd}
              >
                <PlusIcon className="w-3.5 h-3.5" /> Add payslip
              </Button>
            </>
          )}
          {period.status === "draft" && payslips.length > 0 && (
            <Button
              size="sm"
              className="gap-1.5 bg-blue-600 hover:bg-blue-700 text-white"
              disabled={actionLoading === "approve"}
              onClick={handleApprove}
            >
              <CheckCircleIcon className="w-3.5 h-3.5" />
              {actionLoading === "approve" ? "Approving…" : "Approve period"}
            </Button>
          )}
          {period.status === "published" && canRecall && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-destructive hover:text-destructive"
              onClick={() => setRecallOpen(true)}
            >
              <Undo2Icon className="w-3.5 h-3.5" /> Recall to draft
            </Button>
          )}
          {period.status === "approved" && (
            <Button
              size="sm"
              className="gap-1.5 bg-green-600 hover:bg-green-700 text-white"
              disabled={actionLoading === "publish"}
              onClick={handlePublish}
            >
              <SendIcon className="w-3.5 h-3.5" />
              {actionLoading === "publish" ? "Publishing…" : "Publish payslips"}
            </Button>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3 mb-5">
        {[
          { label: "Employees", value: payslips.length, format: false },
          { label: "Total gross", value: totalGross, format: true },
          { label: "Total deductions", value: totalDeductions, format: true },
          {
            label: "Total net pay",
            value: totalNet,
            format: true,
            green: true,
          },
        ].map((s) => (
          <div key={s.label} className="bg-muted/40 rounded-lg p-4">
            <div className="text-xs text-muted-foreground mb-1.5">
              {s.label}
            </div>
            <div
              className={cn(
                "font-semibold tabular-nums",
                s.green ? "text-green-600 dark:text-green-400" : "",
                s.format ? "text-base" : "text-2xl",
              )}
            >
              {s.format ? fmt(s.value) : s.value}
            </div>
          </div>
        ))}
      </div>

      {/* Payslips table */}
      <div className="bg-background border border-border rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border bg-muted/20 flex items-center justify-between">
          <div className="text-sm font-medium">Payslips</div>
          <div className="text-xs text-muted-foreground">
            {payslips.length} employees
          </div>
        </div>

        {payslips.length === 0 ? (
          <div className="py-16 text-center text-muted-foreground">
            <div className="text-sm font-medium mb-1">No payslips yet</div>
            <div className="text-xs mb-4">
              Add payslips manually or import from Excel
            </div>
            {isEditable && (
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={openAdd}
              >
                <PlusIcon className="w-3.5 h-3.5" /> Add first payslip
              </Button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-muted/20">
                  {[
                    "Employee",
                    "Department",
                    "Basic",
                    "Gross",
                    "Deductions",
                    "Net pay",
                    "",
                  ].map((h) => (
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
                  ))}
                </tr>
              </thead>
              <tbody>
                {payslips.map((p, i) => (
                  <tr
                    key={p.id}
                    className={cn(
                      i < payslips.length - 1 ? "border-b border-border" : "",
                      i % 2 === 1 ? "bg-muted/10" : "",
                    )}
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium">{p.employeeName}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {p.jobTitle ?? "—"}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">
                      {p.department ?? "—"}
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
                          className="h-7 w-7 p-0"
                          onClick={() => openView(p)}
                        >
                          <EyeIcon className="w-3 h-3" />
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 w-7 p-0"
                          title="Download PDF"
                          aria-label="Download PDF"
                          disabled={pdfId === p.id}
                          onClick={() => handlePdf(p)}
                        >
                          {pdfId === p.id ? <Spinner className="size-3" /> : <DownloadIcon className="w-3 h-3" />}
                        </Button>
                        {isEditable && (
                          <>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 w-7 p-0"
                              onClick={() => openEdit(p)}
                            >
                              <PencilIcon className="w-3 h-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                              disabled={actionLoading === p.id}
                              onClick={() => handleDelete(p.id)}
                            >
                              <TrashIcon className="w-3 h-3" />
                            </Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Dialog open={recallOpen} onOpenChange={(o) => !o && setRecallOpen(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Recall {period.label} to draft?</DialogTitle>
            <DialogDescription>
              Employees will stop seeing these {payslips.length} payslip{payslips.length === 1 ? "" : "s"} and are
              notified. Commission earnings paid by them go back to pending. Fix what is wrong, then approve and
              publish the period again.
            </DialogDescription>
          </DialogHeader>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">Reason (kept in the audit log)</label>
            <textarea
              value={recallReason}
              onChange={(e) => setRecallReason(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder="e.g. Wrong overtime amount for 3 employees"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRecallOpen(false)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={actionLoading === "recall" || recallReason.trim().length < 5}
              onClick={handleRecall}
            >
              {actionLoading === "recall" ? "Recalling…" : "Recall to draft"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Sheet */}
      <PayslipSheet
        open={sheetOpen}
        onClose={closeSheet}
        periodId={period.id}
        periodStatus={period.status}
        editPayslip={editPayslip}
        isViewOnly={isViewOnly}
        members={members}
        payItems={payItems}
        structures={structures}
        onSaved={() => router.refresh()}
        periodMonth={period.month}
      />
    </div>
  );
}
