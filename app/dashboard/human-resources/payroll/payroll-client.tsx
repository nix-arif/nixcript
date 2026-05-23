"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  createPayrollPeriod,
  approvePayrollPeriod,
  publishPayrollPeriod,
  deletePayrollPeriod,
  getPayrollPeriods,
} from "@/server/payroll";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  PlusIcon,
  CheckCircleIcon,
  EyeIcon,
  TrashIcon,
  SendIcon,
  CalendarIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Period = Awaited<
  ReturnType<typeof import("@/server/payroll").getPayrollPeriods>
>[number];

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const STATUS_CONFIG = {
  draft: {
    label: "Draft",
    className: "bg-muted text-muted-foreground border border-border",
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

function StatusBadge({ status }: { status: string }) {
  const config =
    STATUS_CONFIG[status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.draft;
  return (
    <span
      className={cn(
        "inline-flex text-[11px] font-medium rounded px-2 py-0.5",
        config.className,
      )}
    >
      {config.label}
    </span>
  );
}

function formatCurrency(value: string | number) {
  return `RM ${Number(value).toLocaleString("en-MY", { minimumFractionDigits: 2 })}`;
}

interface Props {
  initialPeriods: Period[];
}

export function PayrollClient({ initialPeriods }: Props) {
  const router = useRouter();
  const [periods, setPeriods] = useState(initialPeriods);
  const [showCreate, setShowCreate] = useState(false);
  const [createMonth, setCreateMonth] = useState("");
  const [createYear, setCreateYear] = useState(
    String(new Date().getFullYear()),
  );
  const [creating, setCreating] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const total = periods.length;
  const pending = periods.filter((p) => p.status === "draft").length;
  const published = periods.filter((p) => p.status === "published").length;

  const refreshPeriods = async () => {
    const updated = await getPayrollPeriods();
    setPeriods(updated);
  };

  const handleCreate = async () => {
    if (!createMonth || !createYear)
      return toast.error("Select month and year");
    setCreating(true);
    try {
      await createPayrollPeriod(Number(createMonth), Number(createYear));
      toast.success("Payroll period created");
      setShowCreate(false);
      setCreateMonth("");

      // Refetch periods and update state directly
      const updated = await getPayrollPeriods();
      setPeriods(updated);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setCreating(false);
    }
  };

  const handleApprove = async (id: string) => {
    setActionLoading(id + "-approve");
    try {
      await approvePayrollPeriod(id);
      toast.success("Period approved");
      await refreshPeriods();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setActionLoading(null);
    }
  };

  const handlePublish = async (id: string) => {
    setActionLoading(id + "-publish");
    try {
      await publishPayrollPeriod(id);
      toast.success("Payslips published — employees can now view them");
      await refreshPeriods();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this payroll period? This cannot be undone.")) return;
    setActionLoading(id + "-delete");
    try {
      await deletePayrollPeriod(id);
      toast.success("Period deleted");
      await refreshPeriods();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setActionLoading(null);
    }
  };

  const currentYear = new Date().getFullYear();
  const years = [currentYear - 1, currentYear, currentYear + 1].map(String);

  return (
    <div className="p-6 max-w-5xl">
      <PageHeader
        title="Payroll"
        description="Manage monthly payroll periods and employee payslips"
        action={
          <Button onClick={() => setShowCreate(true)} className="gap-2">
            <PlusIcon className="w-4 h-4" /> New period
          </Button>
        }
      />

      {/* Stat cards */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        {[
          { label: "Total periods", value: total, color: "" },
          {
            label: "Pending approval",
            value: pending,
            color: pending > 0 ? "text-amber-600 dark:text-amber-400" : "",
          },
          {
            label: "Published",
            value: published,
            color: "text-green-600 dark:text-green-400",
          },
        ].map((s) => (
          <div key={s.label} className="bg-muted/50 rounded-lg p-4">
            <div className="text-xs text-muted-foreground mb-1.5">
              {s.label}
            </div>
            <div className={cn("text-2xl font-semibold", s.color)}>
              {s.value}
            </div>
          </div>
        ))}
      </div>

      {/* Periods table */}
      <div className="bg-background border border-border rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border bg-muted/20 flex items-center justify-between">
          <div className="text-sm font-medium">All periods</div>
          <div className="text-xs text-muted-foreground">
            {total} period{total !== 1 ? "s" : ""}
          </div>
        </div>

        {periods.length === 0 ? (
          <div className="py-16 text-center text-muted-foreground">
            <CalendarIcon className="w-8 h-8 mx-auto mb-3 opacity-20" />
            <div className="text-sm font-medium">No payroll periods yet</div>
            <div className="text-xs mt-1">
              Create your first payroll period to get started
            </div>
            <Button
              variant="outline"
              size="sm"
              className="mt-4 gap-2"
              onClick={() => setShowCreate(true)}
            >
              <PlusIcon className="w-3.5 h-3.5" /> New period
            </Button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-muted/20">
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground border-b border-border">
                    Period
                  </th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground border-b border-border">
                    Payslips
                  </th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground border-b border-border">
                    Total net pay
                  </th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground border-b border-border">
                    Status
                  </th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground border-b border-border">
                    Created by
                  </th>
                  <th className="px-4 py-2.5 border-b border-border" />
                </tr>
              </thead>
              <tbody>
                {periods.map((p, i) => (
                  <tr
                    key={p.id}
                    className={cn(
                      i < periods.length - 1 ? "border-b border-border" : "",
                      p.status === "draft"
                        ? "bg-amber-50/40 dark:bg-amber-900/10"
                        : "",
                    )}
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium">{p.label}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {p.createdAt
                          ? new Date(p.createdAt).toLocaleDateString("en-MY", {
                              day: "2-digit",
                              month: "short",
                              year: "numeric",
                            })
                          : "—"}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm">
                        {Number(p.payslipCount)} payslips
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium tabular-nums">
                        {Number(p.totalNetPay) > 0
                          ? formatCurrency(p.totalNetPay)
                          : "—"}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={p.status} />
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">
                      {p.createdByName ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 justify-end">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs gap-1"
                          onClick={() =>
                            router.push(
                              `/dashboard/human-resources/payroll/${p.id}`,
                            )
                          }
                        >
                          <EyeIcon className="w-3 h-3" /> View
                        </Button>

                        {p.status === "draft" && (
                          <Button
                            size="sm"
                            className="h-7 text-xs gap-1 bg-blue-600 hover:bg-blue-700 text-white"
                            disabled={actionLoading === p.id + "-approve"}
                            onClick={() => handleApprove(p.id)}
                          >
                            <CheckCircleIcon className="w-3 h-3" />
                            {actionLoading === p.id + "-approve"
                              ? "…"
                              : "Approve"}
                          </Button>
                        )}

                        {p.status === "approved" && (
                          <Button
                            size="sm"
                            className="h-7 text-xs gap-1 bg-green-600 hover:bg-green-700 text-white"
                            disabled={actionLoading === p.id + "-publish"}
                            onClick={() => handlePublish(p.id)}
                          >
                            <SendIcon className="w-3 h-3" />
                            {actionLoading === p.id + "-publish"
                              ? "…"
                              : "Publish"}
                          </Button>
                        )}

                        {p.status !== "published" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                            disabled={actionLoading === p.id + "-delete"}
                            onClick={() => handleDelete(p.id)}
                          >
                            <TrashIcon className="w-3.5 h-3.5" />
                          </Button>
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

      {/* Create dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarIcon className="w-4 h-4" />
              New payroll period
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                Month
              </label>
              <Select onValueChange={setCreateMonth} value={createMonth}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Select month" />
                </SelectTrigger>
                <SelectContent>
                  {MONTHS.map((m, i) => (
                    <SelectItem key={m} value={String(i + 1)}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                Year
              </label>
              <Select onValueChange={setCreateYear} value={createYear}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Select year" />
                </SelectTrigger>
                <SelectContent>
                  {years.map((y) => (
                    <SelectItem key={y} value={y}>
                      {y}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-start gap-2 p-3 rounded-lg bg-muted/40 text-xs text-muted-foreground">
              <CalendarIcon className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              After creating the period you can add payslips one by one or
              import from Excel.
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={creating || !createMonth}
              className="gap-2"
            >
              {creating ? (
                <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
              ) : (
                <PlusIcon className="w-3.5 h-3.5" />
              )}
              Create period
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
