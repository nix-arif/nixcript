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
  UploadIcon,
  CheckCircleIcon,
  SendIcon,
  TrashIcon,
  PencilIcon,
  EyeIcon,
  XIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { calculatePayslip } from "@/lib/payroll/calculate";

type PeriodData = Awaited<ReturnType<typeof getPeriodDetail>>;
type Member = Awaited<ReturnType<typeof getOrgMembers>>[number];
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

const fmt = (v: string | number) =>
  `RM ${Number(v).toLocaleString("en-MY", { minimumFractionDigits: 2 })}`;

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

type Allowance = { label: string; amount: string };

interface PayslipFormState {
  userId: string;
  basicSalary: string;
  bonus: string;
  overtimePay: string;
  caseCount: string;
  caseRate: string;
  petrolAllowancePay: string;
  allowances: Allowance[];
  otherDeductions: Allowance[];
  manualLhdn: string;
  overrideLhdn: boolean;
}

const EMPTY_FORM: PayslipFormState = {
  userId: "",
  basicSalary: "",
  bonus: "0",
  overtimePay: "0",
  caseCount: "0",
  caseRate: "100",
  petrolAllowancePay: "0",
  allowances: [],
  otherDeductions: [],
  manualLhdn: "",
  overrideLhdn: false,
};

interface PayslipSheetProps {
  open: boolean;
  onClose: () => void;
  periodId: string;
  periodStatus: string;
  editPayslip?: PayslipRow | null;
  isViewOnly?: boolean;
  members: Member[];
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
  onSaved,
  periodMonth,
}: PayslipSheetProps) {
  const [form, setForm] = useState<PayslipFormState>(EMPTY_FORM);
  const [calcResult, setCalcResult] = useState<ReturnType<
    typeof calculatePayslip
  > | null>(null);
  const [saving, setSaving] = useState(false);

  const isEdit = !!editPayslip;
  const isReadOnly = isViewOnly || periodStatus === "published";

  const runCalcWith = useCallback(
    (f: PayslipFormState) => {
      const basic = Number(f.basicSalary) || 0;
      if (basic <= 0) {
        setCalcResult(null);
        return;
      }
      const bonus = Number(f.bonus) || 0;
      const overtime = Number(f.overtimePay) || 0;
      const caseAllowancePay = (Number(f.caseCount) || 0) * (Number(f.caseRate) || 0);
      const petrolAllowancePay = Number(f.petrolAllowancePay) || 0;
      const allowTotal = f.allowances.reduce(
        (s, a) => s + (Number(a.amount) || 0),
        0,
      );
      const dedTotal = f.otherDeductions.reduce(
        (s, d) => s + (Number(d.amount) || 0),
        0,
      );
      const manualLhdn = f.overrideLhdn ? Number(f.manualLhdn) || 0 : undefined;
      setCalcResult(
        calculatePayslip({
          basicSalary: basic,
          bonus,
          overtimePay: overtime,
          caseAllowancePay,
          petrolAllowancePay,
          allowances: allowTotal,
          otherDeductions: dedTotal,
          manualLhdn,
          currentMonth: periodMonth,
        }),
      );
    },
    [periodMonth],
  ); // ← add periodMonth to dependency array

  const runCalc = useCallback(() => {
    setForm((current) => {
      runCalcWith(current);
      return current;
    });
  }, [runCalcWith]);

  useEffect(() => {
    if (!open) return;
    if (editPayslip) {
      const initialForm: PayslipFormState = {
        userId: editPayslip.userId,
        basicSalary: editPayslip.basicSalary,
        bonus: editPayslip.bonus ?? "0",
        overtimePay: "0",
        caseCount: "0",
        caseRate: "100",
        petrolAllowancePay: "0",
        allowances: [],
        otherDeductions: [],
        manualLhdn: "",
        overrideLhdn: false,
      };
      setForm(initialForm);
      runCalcWith(initialForm);
    } else {
      setForm(EMPTY_FORM);
      setCalcResult(null);
    }
  }, [open, editPayslip, runCalcWith]);

  const set = useCallback(
    (key: keyof PayslipFormState, val: any) =>
      setForm((f) => ({ ...f, [key]: val })),
    [],
  );

  const handleSave = async () => {
    if (!form.userId && !isEdit) return toast.error("Select an employee");
    if (!form.basicSalary || Number(form.basicSalary) <= 0)
      return toast.error("Enter basic salary");
    setSaving(true);
    try {
      const manualLhdn = form.overrideLhdn
        ? Number(form.manualLhdn) || 0
        : undefined;
      const caseAllowancePay = (Number(form.caseCount) || 0) * (Number(form.caseRate) || 0);
      const petrolAllowancePay = Number(form.petrolAllowancePay) || 0;
      if (isEdit) {
        await updatePayslip(editPayslip!.id, {
          basicSalary: Number(form.basicSalary),
          bonus: Number(form.bonus) || 0,
          overtimePay: Number(form.overtimePay) || 0,
          caseAllowancePay,
          petrolAllowancePay,
          allowances: form.allowances,
          otherDeductions: form.otherDeductions,
          manualLhdn,
        });
        toast.success("Payslip updated");
      } else {
        await createPayslip({
          periodId,
          userId: form.userId,
          basicSalary: Number(form.basicSalary),
          bonus: Number(form.bonus) || 0,
          overtimePay: Number(form.overtimePay) || 0,
          caseAllowancePay,
          petrolAllowancePay,
          allowances: form.allowances,
          otherDeductions: form.otherDeductions,
          manualLhdn,
        });
        toast.success("Payslip created");
      }
      onSaved();
      onClose();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    if (editPayslip) {
      const savedCasePay = Number(editPayslip.caseAllowancePay ?? 0);
      const initialForm: PayslipFormState = {
        userId: editPayslip.userId,
        basicSalary: editPayslip.basicSalary,
        bonus: editPayslip.bonus ?? "0",
        overtimePay: editPayslip.overtimePay ?? "0",
        caseCount: savedCasePay > 0 ? String(savedCasePay / 100) : "0",
        caseRate: "100",
        petrolAllowancePay: editPayslip.petrolAllowancePay ?? "0",
        allowances: (editPayslip.allowances as any[]) ?? [],
        otherDeductions: (editPayslip.otherDeductions as any[]) ?? [],
        manualLhdn: "",
        overrideLhdn: false,
      };
      setForm(initialForm);
      runCalcWith(initialForm);
    } else {
      setForm(EMPTY_FORM);
      setCalcResult(null);
    }
  }, [open, editPayslip, runCalcWith]);

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent className="w-full max-w-2xl! px-10 overflow-y-auto">
        <SheetHeader className="mb-4">
          <SheetTitle>
            {isViewOnly
              ? "View payslip"
              : isEdit
                ? "Edit payslip"
                : "Add payslip"}
          </SheetTitle>
        </SheetHeader>

        <div className="space-y-4">
          {/* Employee */}
          {!isEdit ? (
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                Employee
              </label>
              <Select
                onValueChange={(v) => set("userId", v)}
                value={form.userId}
              >
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="Select employee" />
                </SelectTrigger>
                <SelectContent>
                  {members.map((m) => (
                    <SelectItem key={m.userId} value={m.userId}>
                      {m.fullname || m.name} — {m.email} -{" "}
                      {m.jobTitle || m.role}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div className="p-3 bg-muted/40 rounded-lg">
              <div className="text-sm font-medium">
                {editPayslip?.employeeName}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {editPayslip?.jobTitle} · {editPayslip?.department}
              </div>
            </div>
          )}

          {/* Earnings */}
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
                  value={form.basicSalary}
                  onChange={(e) => set("basicSalary", e.target.value)}
                  onBlur={runCalc}
                  placeholder="0.00"
                  type="number"
                  className="h-9 text-sm"
                  disabled={isReadOnly}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                    Bonus (RM)
                  </label>
                  <Input
                    value={form.bonus}
                    onChange={(e) => set("bonus", e.target.value)}
                    onBlur={runCalc}
                    placeholder="0.00"
                    type="number"
                    className="h-9 text-sm"
                    disabled={isReadOnly}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                    Overtime (RM)
                  </label>
                  <Input
                    value={form.overtimePay}
                    onChange={(e) => set("overtimePay", e.target.value)}
                    onBlur={runCalc}
                    placeholder="0.00"
                    type="number"
                    className="h-9 text-sm"
                    disabled={isReadOnly}
                  />
                </div>
              </div>

              {/* Case Allowance */}
              <div className="border border-dashed border-border rounded-md p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-foreground">
                    Case allowance
                  </label>
                  <span className="text-[10px] text-amber-600 dark:text-amber-400 font-medium bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded px-1.5 py-0.5">
                    Taxable income (PCB applies)
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1.5">
                      No. of cases
                    </label>
                    <Input
                      value={form.caseCount}
                      onChange={(e) => set("caseCount", e.target.value)}
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
                      Rate per case (RM)
                    </label>
                    <Input
                      value={form.caseRate}
                      onChange={(e) => set("caseRate", e.target.value)}
                      onBlur={runCalc}
                      placeholder="100"
                      type="number"
                      min="0"
                      className="h-9 text-sm"
                      disabled={isReadOnly}
                    />
                  </div>
                </div>
                {Number(form.caseCount) > 0 && (
                  <div className="flex justify-between text-xs pt-0.5">
                    <span className="text-muted-foreground">
                      {form.caseCount} cases × RM {form.caseRate}
                    </span>
                    <span className="font-mono font-medium">
                      RM {((Number(form.caseCount) || 0) * (Number(form.caseRate) || 0)).toFixed(2)}
                    </span>
                  </div>
                )}
              </div>

              {/* Petrol Allowance */}
              <div className="border border-dashed border-border rounded-md p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-foreground">
                    Petrol allowance
                  </label>
                  <span className="text-[10px] text-blue-600 dark:text-blue-400 font-medium bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded px-1.5 py-0.5">
                    EPF/SOCSO exempt
                  </span>
                </div>
                <Input
                  value={form.petrolAllowancePay}
                  onChange={(e) => set("petrolAllowancePay", e.target.value)}
                  onBlur={runCalc}
                  placeholder="0.00"
                  type="number"
                  min="0"
                  className="h-9 text-sm"
                  disabled={isReadOnly}
                />
                {Number(form.petrolAllowancePay) > 0 && (
                  <div className="space-y-0.5 text-xs pt-0.5">
                    <div className="flex justify-between text-muted-foreground">
                      <span>Exempt (Schedule 6, ≤RM500/mth)</span>
                      <span className="font-mono text-green-600 dark:text-green-400">
                        RM {Math.min(Number(form.petrolAllowancePay) || 0, 500).toFixed(2)}
                      </span>
                    </div>
                    {(Number(form.petrolAllowancePay) || 0) > 500 && (
                      <div className="flex justify-between text-muted-foreground">
                        <span>Taxable (PCB applies)</span>
                        <span className="font-mono text-amber-600 dark:text-amber-400">
                          RM {Math.max(0, (Number(form.petrolAllowancePay) || 0) - 500).toFixed(2)}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Allowances — inlined */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-medium text-muted-foreground">
                    Other allowances
                  </label>
                  {!isReadOnly && (
                    <button
                      type="button"
                      onClick={() =>
                        set("allowances", [
                          ...form.allowances,
                          { label: "", amount: "" },
                        ])
                      }
                      className="text-xs text-primary flex items-center gap-1"
                    >
                      <PlusIcon className="w-3 h-3" /> Add
                    </button>
                  )}
                </div>
                {form.allowances.map((item, i) => (
                  <div key={i} className="flex gap-2 mb-1.5 items-center">
                    <input
                      value={item.label}
                      onChange={(e) => {
                        const n = [...form.allowances];
                        n[i] = { ...n[i], label: e.target.value };
                        set("allowances", n);
                      }}
                      placeholder="Label"
                      className="h-8 text-xs flex-1 border border-input rounded-md px-2 bg-background"
                      disabled={isReadOnly}
                    />
                    <input
                      value={item.amount}
                      onChange={(e) => {
                        const n = [...form.allowances];
                        n[i] = { ...n[i], amount: e.target.value };
                        set("allowances", n);
                      }}
                      onBlur={runCalc}
                      placeholder="Amount"
                      className="h-8 text-xs w-28 border border-input rounded-md px-2 bg-background"
                      type="number"
                      disabled={isReadOnly}
                    />
                    {!isReadOnly && (
                      <button
                        type="button"
                        onClick={() => {
                          set(
                            "allowances",
                            form.allowances.filter((_, idx) => idx !== i),
                          );
                          setTimeout(runCalc, 0);
                        }}
                      >
                        <XIcon className="w-3.5 h-3.5 text-muted-foreground hover:text-destructive" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Deductions */}
          <div className="border border-border rounded-lg overflow-hidden">
            <div className="px-3 py-2 bg-muted/30 border-b border-border">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Deductions (auto-calculated)
              </span>
            </div>
            <div className="p-3 space-y-2">
              {calcResult && (
                <div className="space-y-1.5 text-xs">
                  {[
                    {
                      label: "EPF (employee 11%)",
                      value: calcResult.epf.employee,
                    },
                    {
                      label: "SOCSO (employee 0.5%)",
                      value: calcResult.socso.employee,
                    },
                    {
                      label: "EIS (employee 0.2%)",
                      value: calcResult.eis.employee,
                    },
                    { label: "PCB / LHDN", value: calcResult.lhdn },
                  ].map((d) => (
                    <div key={d.label} className="flex justify-between">
                      <span className="text-muted-foreground">{d.label}</span>
                      <span className="font-mono">RM {d.value.toFixed(2)}</span>
                    </div>
                  ))}
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
                  value={form.manualLhdn}
                  onChange={(e) => set("manualLhdn", e.target.value)}
                  onBlur={runCalc}
                  placeholder="Manual LHDN amount"
                  type="number"
                  className="h-8 text-xs"
                  disabled={isReadOnly}
                />
              )}

              {/* Other deductions — inlined */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-medium text-muted-foreground">
                    Other deductions
                  </label>
                  {!isReadOnly && (
                    <button
                      type="button"
                      onClick={() =>
                        set("otherDeductions", [
                          ...form.otherDeductions,
                          { label: "", amount: "" },
                        ])
                      }
                      className="text-xs text-primary flex items-center gap-1"
                    >
                      <PlusIcon className="w-3 h-3" /> Add
                    </button>
                  )}
                </div>
                {form.otherDeductions.map((item, i) => (
                  <div key={i} className="flex gap-2 mb-1.5 items-center">
                    <input
                      value={item.label}
                      onChange={(e) => {
                        const n = [...form.otherDeductions];
                        n[i] = { ...n[i], label: e.target.value };
                        set("otherDeductions", n);
                      }}
                      placeholder="Label"
                      className="h-8 text-xs flex-1 border border-input rounded-md px-2 bg-background"
                      disabled={isReadOnly}
                    />
                    <input
                      value={item.amount}
                      onChange={(e) => {
                        const n = [...form.otherDeductions];
                        n[i] = { ...n[i], amount: e.target.value };
                        set("otherDeductions", n);
                      }}
                      onBlur={runCalc}
                      placeholder="Amount"
                      className="h-8 text-xs w-28 border border-input rounded-md px-2 bg-background"
                      type="number"
                      disabled={isReadOnly}
                    />
                    {!isReadOnly && (
                      <button
                        type="button"
                        onClick={() => {
                          set(
                            "otherDeductions",
                            form.otherDeductions.filter((_, idx) => idx !== i),
                          );
                          setTimeout(runCalc, 0);
                        }}
                      >
                        <XIcon className="w-3.5 h-3.5 text-muted-foreground hover:text-destructive" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
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
                  {[
                    {
                      label: "EPF (employer 12–13%)",
                      value: calcResult.epf.employer,
                    },
                    {
                      label: "SOCSO (employer 1.75%)",
                      value: calcResult.socso.employer,
                    },
                    {
                      label: "EIS (employer 0.2%)",
                      value: calcResult.eis.employer,
                    },
                  ].map((d) => (
                    <div key={d.label} className="flex justify-between mb-1">
                      <span className="text-muted-foreground">{d.label}</span>
                      <span className="font-mono">RM {d.value.toFixed(2)}</span>
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
}: {
  data: NonNullable<PeriodData>;
}) {
  const router = useRouter();
  const { period, payslips, totalGross, totalDeductions, totalNet } = data;
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editPayslip, setEditPayslip] = useState<PayslipRow | null>(null);
  const [isViewOnly, setIsViewOnly] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const isEditable = period.status !== "published";

  const loadMembers = async () => {
    if (!members.length) {
      const m = await getOrgMembers();
      setMembers(m);
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

  const openView = (p: PayslipRow) => {
    setEditPayslip(p);
    setIsViewOnly(true);
    setSheetOpen(true);
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
              <Button variant="outline" size="sm" className="gap-1.5">
                <UploadIcon className="w-3.5 h-3.5" /> Import Excel
              </Button>
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

      {/* Sheet */}
      <PayslipSheet
        open={sheetOpen}
        onClose={closeSheet}
        periodId={period.id}
        periodStatus={period.status}
        editPayslip={editPayslip}
        isViewOnly={isViewOnly}
        members={members}
        onSaved={() => router.refresh()}
        periodMonth={period.month}
      />
    </div>
  );
}
