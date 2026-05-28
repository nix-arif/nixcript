"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { deleteInvoice, type InvoiceListRow } from "@/server/invoice";
import { useAppStore } from "@/lib/store/use-app-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/page-header";
import { Highlight } from "@/components/highlight";
import {
  PlusIcon,
  SearchIcon,
  XIcon,
  ReceiptIcon,
  PencilIcon,
  TrashIcon,
  ChevronUpIcon,
  ChevronDownIcon,
  ChevronsUpDownIcon,
  CheckCircle2Icon,
  CircleIcon,
  AlertCircleIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Formatters ─────────────────────────────────────────────────────────────

const fmtDate = (d: Date | string | null | undefined) =>
  d
    ? new Date(d).toLocaleDateString("en-MY", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "—";

const fmtMoney = (v: string | null | undefined) =>
  v
    ? parseFloat(v).toLocaleString("en-MY", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    : "0.00";

const parseMoney = (v: string | null | undefined) => parseFloat(v ?? "0") || 0;

// ── Status config ──────────────────────────────────────────────────────────

const INV_STATUS: Record<
  string,
  { label: string; cls: string; dot: string }
> = {
  draft: {
    label: "Draft",
    cls: "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400",
    dot: "bg-zinc-400",
  },
  sent: {
    label: "Sent",
    cls: "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400",
    dot: "bg-blue-500",
  },
  paid: {
    label: "Paid",
    cls: "bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400",
    dot: "bg-green-500",
  },
  overdue: {
    label: "Overdue",
    cls: "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400",
    dot: "bg-red-500",
  },
  cancelled: {
    label: "Cancelled",
    cls: "bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-500",
    dot: "bg-zinc-300",
  },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = INV_STATUS[status] ?? INV_STATUS.draft;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[11px] font-medium rounded-full px-2 py-0.5",
        cfg.cls,
      )}
    >
      <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", cfg.dot)} />
      {cfg.label}
    </span>
  );
}

// ── Sort ──────────────────────────────────────────────────────────────────

type SortKey =
  | "invoiceNo"
  | "invoiceDate"
  | "customer"
  | "hospital"
  | "customerPoNo"
  | "status"
  | "grandTotal"
  | "outstanding"
  | "dueDate"
  | "caseDate";

function SortIcon({
  col,
  active,
  dir,
}: {
  col: SortKey;
  active: SortKey;
  dir: "asc" | "desc";
}) {
  if (col !== active)
    return <ChevronsUpDownIcon className="w-3 h-3 text-muted-foreground/40" />;
  return dir === "asc" ? (
    <ChevronUpIcon className="w-3 h-3 text-foreground" />
  ) : (
    <ChevronDownIcon className="w-3 h-3 text-foreground" />
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────

function Stat({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
}) {
  return (
    <div className="bg-background border border-border rounded-xl px-4 py-3 flex flex-col gap-0.5 min-w-0">
      <span className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium truncate">
        {label}
      </span>
      <span className={cn("text-xl font-semibold tabular-nums truncate", color)}>
        {value}
      </span>
      {sub && (
        <span className="text-[11px] text-muted-foreground tabular-nums">
          {sub}
        </span>
      )}
    </div>
  );
}

// ── Skeleton ──────────────────────────────────────────────────────────────

function TableSkeleton() {
  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <tbody>
          {Array.from({ length: 5 }).map((_, i) => (
            <tr key={i} className="border-b border-border last:border-0">
              {Array.from({ length: 10 }).map((_, j) => (
                <td key={j} className="px-3 py-3">
                  <div className="h-3 bg-muted rounded animate-pulse" />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Status filter pills ────────────────────────────────────────────────────

const STATUS_FILTERS = [
  { value: "", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "sent", label: "Sent" },
  { value: "overdue", label: "Overdue" },
  { value: "paid", label: "Paid" },
  { value: "cancelled", label: "Cancelled" },
];

// ── Main component ─────────────────────────────────────────────────────────

const EDITABLE_STATUSES = new Set(["draft"]);
const DELETABLE_STATUSES = new Set(["draft", "cancelled"]);

interface Props {
  initialInvoices: InvoiceListRow[];
  permissions: string[];
  currentUserId: string;
}

export function InvoiceListClient({
  initialInvoices,
  permissions,
  currentUserId,
}: Props) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("invoiceDate");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [deleting, setDeleting] = useState<string | null>(null);
  const { isSwitchingOrg, setOrgSwitching } = useAppStore();

  const can = (p: string) =>
    permissions.includes("*") || permissions.includes(p);

  useEffect(() => {
    setOrgSwitching(false);
  }, [initialInvoices]);

  // ── Search + status filter ────────────────────────────────────────────

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return initialInvoices.filter((inv) => {
      const snap = inv.customerSnapshot as any;
      if (statusFilter && inv.status !== statusFilter) return false;
      if (!q) return true;
      return (
        inv.invoiceNo.toLowerCase().includes(q) ||
        snap?.name?.toLowerCase().includes(q) ||
        snap?.organizationName?.toLowerCase().includes(q) ||
        inv.salesPersonName?.toLowerCase().includes(q) ||
        inv.customerPoNo?.toLowerCase().includes(q) ||
        inv.salesOrderNo?.toLowerCase().includes(q) ||
        inv.status.toLowerCase().includes(q) ||
        inv.caseType?.toLowerCase().includes(q) ||
        inv.mrnNo?.toLowerCase().includes(q) ||
        inv.createdByName?.toLowerCase().includes(q)
      );
    });
  }, [initialInvoices, search, statusFilter]);

  // ── Sort ──────────────────────────────────────────────────────────────

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const snapA = a.customerSnapshot as any;
      const snapB = b.customerSnapshot as any;
      switch (sortKey) {
        case "invoiceNo":
          return dir * a.invoiceNo.localeCompare(b.invoiceNo);
        case "invoiceDate":
          return (
            dir *
            (new Date(a.invoiceDate).getTime() -
              new Date(b.invoiceDate).getTime())
          );
        case "customer":
          return dir * (snapA?.name ?? "").localeCompare(snapB?.name ?? "");
        case "hospital":
          return (
            dir *
            (snapA?.organizationName ?? "").localeCompare(
              snapB?.organizationName ?? "",
            )
          );
        case "customerPoNo":
          return dir * (a.customerPoNo ?? "").localeCompare(b.customerPoNo ?? "");
        case "status":
          return dir * a.status.localeCompare(b.status);
        case "grandTotal":
          return dir * (parseMoney(a.grandTotal) - parseMoney(b.grandTotal));
        case "outstanding": {
          const outA = a.status === "paid" ? 0 : parseMoney(a.grandTotal) - parseMoney(a.paidAmount);
          const outB = b.status === "paid" ? 0 : parseMoney(b.grandTotal) - parseMoney(b.paidAmount);
          return dir * (outA - outB);
        }
        case "dueDate": {
          const da = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
          const db_ = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
          return dir * (da - db_);
        }
        case "caseDate": {
          const ca = a.caseDate ? new Date(a.caseDate).getTime() : 0;
          const cb = b.caseDate ? new Date(b.caseDate).getTime() : 0;
          return dir * (ca - cb);
        }
        default:
          return 0;
      }
    });
  }, [filtered, sortKey, sortDir]);

  // ── Stats ─────────────────────────────────────────────────────────────

  const stats = useMemo(() => {
    const all = initialInvoices;
    const totalBilled = all.reduce((s, i) => s + parseMoney(i.grandTotal), 0);
    // For "paid" invoices the full grandTotal is collected; for others use paidAmount
    const totalCollected = all.reduce((s, i) => {
      if (i.status === "paid") return s + parseMoney(i.grandTotal);
      return s + parseMoney(i.paidAmount);
    }, 0);
    const outstanding = all.reduce((s, i) => {
      if (i.status === "paid" || i.status === "cancelled") return s;
      return s + Math.max(0, parseMoney(i.grandTotal) - parseMoney(i.paidAmount));
    }, 0);
    const overdueCount = all.filter((i) => i.status === "overdue").length;
    const soaPendingCount = all.filter(
      (i) => !i.soaVerified && i.status !== "draft" && i.status !== "cancelled",
    ).length;
    return { total: all.length, totalBilled, totalCollected, outstanding, overdueCount, soaPendingCount };
  }, [initialInvoices]);

  // Footer totals for visible rows
  const footerTotals = useMemo(() => {
    const billed = sorted.reduce((s, i) => s + parseMoney(i.grandTotal), 0);
    const out = sorted.reduce((s, i) => {
      if (i.status === "paid" || i.status === "cancelled") return s;
      return s + Math.max(0, parseMoney(i.grandTotal) - parseMoney(i.paidAmount));
    }, 0);
    return { billed, out };
  }, [sorted]);

  // ── Sort handler ──────────────────────────────────────────────────────

  const handleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const Th = ({
    k,
    children,
    className,
  }: {
    k: SortKey;
    children: React.ReactNode;
    className?: string;
  }) => (
    <th
      className={cn(
        "px-3 py-2.5 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wider whitespace-nowrap cursor-pointer select-none hover:text-foreground transition-colors",
        className,
      )}
      onClick={() => handleSort(k)}
    >
      <span className="inline-flex items-center gap-1">
        {children}
        <SortIcon col={k} active={sortKey} dir={sortDir} />
      </span>
    </th>
  );

  // ── Delete ────────────────────────────────────────────────────────────

  async function handleDelete(id: string, invoiceNo: string) {
    if (!confirm(`Delete ${invoiceNo}? This cannot be undone.`)) return;
    setDeleting(id);
    try {
      await deleteInvoice(id);
      toast.success("Invoice deleted");
      router.refresh();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setDeleting(null);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div className="p-6 space-y-5">
      <PageHeader
        title="Invoices"
        description="Tax invoices and billing records"
        action={
          can("invoice:create") && (
            <Button
              onClick={() =>
                router.push("/dashboard/fulfillment/invoice/create")
              }
              className="gap-2"
            >
              <PlusIcon className="w-4 h-4" /> New Invoice
            </Button>
          )
        }
      />

      {/* Stats strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <Stat
          label="Total invoices"
          value={stats.total.toString()}
          sub={`${filtered.length !== stats.total ? `${filtered.length} shown` : "all shown"}`}
        />
        <Stat
          label="Total billed"
          value={`MYR ${fmtMoney(stats.totalBilled.toFixed(2))}`}
          color="text-foreground"
        />
        <Stat
          label="Collected"
          value={`MYR ${fmtMoney(stats.totalCollected.toFixed(2))}`}
          color="text-green-600 dark:text-green-400"
        />
        <Stat
          label="Outstanding"
          value={`MYR ${fmtMoney(stats.outstanding.toFixed(2))}`}
          color={
            stats.outstanding > 0
              ? "text-amber-600 dark:text-amber-400"
              : "text-foreground"
          }
        />
        <Stat
          label="Overdue"
          value={stats.overdueCount.toString()}
          sub={`${stats.soaPendingCount} SOA pending`}
          color={
            stats.overdueCount > 0
              ? "text-red-600 dark:text-red-400"
              : "text-foreground"
          }
        />
      </div>

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-2.5 items-start sm:items-center">
        {/* Search */}
        <div className="relative flex-1 min-w-0">
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search invoice no., customer, hospital, case type…"
            className="pl-9 h-9 text-sm"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <XIcon className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Status pills */}
        <div className="flex items-center gap-1 flex-wrap">
          {STATUS_FILTERS.map((f) => {
            const count =
              f.value === ""
                ? initialInvoices.length
                : initialInvoices.filter((i) => i.status === f.value).length;
            return (
              <button
                key={f.value}
                onClick={() => setStatusFilter(f.value)}
                className={cn(
                  "text-xs px-2.5 py-1 rounded-full border transition-colors tabular-nums",
                  statusFilter === f.value
                    ? "bg-foreground text-background border-foreground"
                    : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/30",
                )}
              >
                {f.label}
                {count > 0 && (
                  <span className="ml-1 opacity-60">{count}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Count */}
      <div className="text-xs text-muted-foreground tabular-nums -mt-2">
        {sorted.length} invoice{sorted.length !== 1 ? "s" : ""}
        {(search || statusFilter) && ` · filtered from ${initialInvoices.length}`}
      </div>

      {isSwitchingOrg ? (
        <TableSkeleton />
      ) : sorted.length === 0 ? (
        <div className="border border-border rounded-xl py-16 text-center text-muted-foreground">
          <ReceiptIcon className="w-8 h-8 mx-auto mb-3 opacity-30" />
          <div className="text-sm font-medium mb-1">
            {search || statusFilter ? "No invoices match your filter" : "No invoices yet"}
          </div>
          {!search && !statusFilter && (
            <>
              <div className="text-xs mb-4">
                Create your first invoice to get started
              </div>
              {can("invoice:create") && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={() =>
                    router.push("/dashboard/fulfillment/invoice/create")
                  }
                >
                  <PlusIcon className="w-3.5 h-3.5" /> New Invoice
                </Button>
              )}
            </>
          )}
        </div>
      ) : (
        <div className="border border-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-muted/30 border-b border-border">
                  <th className="px-3 py-2.5 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wider w-8">
                    #
                  </th>
                  <Th k="invoiceNo">Invoice No.</Th>
                  <Th k="invoiceDate">Date</Th>
                  <Th k="customerPoNo" className="hidden md:table-cell">
                    Customer PO
                  </Th>
                  <Th k="customer">Customer</Th>
                  <Th k="hospital">Hospital</Th>
                  <Th k="caseDate" className="hidden xl:table-cell">
                    Case
                  </Th>
                  <Th k="status">Status</Th>
                  <Th k="grandTotal" className="text-right">
                    Billed
                  </Th>
                  <Th k="outstanding" className="text-right">
                    Outstanding
                  </Th>
                  <Th k="dueDate" className="hidden lg:table-cell">
                    Due
                  </Th>
                  <th className="px-3 py-2.5 text-center text-[11px] font-medium text-muted-foreground uppercase tracking-wider w-10 hidden lg:table-cell">
                    SOA
                  </th>
                  <th className="px-3 py-2.5 w-16" />
                </tr>
              </thead>

              <tbody>
                {sorted.map((inv, idx) => {
                  const snap = inv.customerSnapshot as any;
                  const outstanding =
                    inv.status === "paid"
                      ? 0
                      : Math.max(0, parseMoney(inv.grandTotal) - parseMoney(inv.paidAmount));
                  const isOverdue = inv.status === "overdue";
                  const isDueSoon =
                    inv.dueDate &&
                    inv.status !== "paid" &&
                    inv.status !== "cancelled" &&
                    new Date(inv.dueDate).getTime() - Date.now() <
                      7 * 24 * 60 * 60 * 1000;

                  return (
                    <tr
                      key={inv.id}
                      onClick={() =>
                        router.push(
                          `/dashboard/fulfillment/invoice/${inv.id}`,
                        )
                      }
                      className={cn(
                        "border-b border-border last:border-0 cursor-pointer transition-colors",
                        isOverdue
                          ? "hover:bg-red-50/40 dark:hover:bg-red-900/10"
                          : "hover:bg-muted/20",
                      )}
                    >
                      {/* # */}
                      <td className="px-3 py-2.5 text-xs text-muted-foreground tabular-nums">
                        {idx + 1}
                      </td>

                      {/* Invoice No. */}
                      <td className="px-3 py-2.5">
                        <span className="font-mono text-xs font-medium text-foreground">
                          <Highlight text={inv.invoiceNo} query={search} />
                        </span>
                        {inv.salesOrderNo && (
                          <div className="text-[10px] text-muted-foreground font-mono mt-0.5">
                            SO:{" "}
                            <Highlight
                              text={inv.salesOrderNo}
                              query={search}
                            />
                          </div>
                        )}
                      </td>

                      {/* Customer PO */}
                      <td className="px-3 py-2.5 hidden md:table-cell">
                        {inv.customerPoNo ? (
                          <span className="font-mono text-xs text-muted-foreground">
                            <Highlight text={inv.customerPoNo} query={search} />
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground/40">—</span>
                        )}
                      </td>

                      {/* Date */}
                      <td className="px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                        {fmtDate(inv.invoiceDate)}
                      </td>

                      {/* Customer */}
                      <td className="px-3 py-2.5 max-w-35">
                        {snap?.name ? (
                          <span className="text-xs truncate block">
                            <Highlight text={snap.name} query={search} />
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground/50 italic">
                            —
                          </span>
                        )}
                        {inv.salesPersonName && (
                          <span className="text-[10px] text-muted-foreground block truncate">
                            <Highlight
                              text={inv.salesPersonName}
                              query={search}
                            />
                          </span>
                        )}
                      </td>

                      {/* Hospital */}
                      <td className="px-3 py-2.5 max-w-40">
                        {snap?.organizationName ? (
                          <span className="text-xs truncate block">
                            <Highlight
                              text={snap.organizationName}
                              query={search}
                            />
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground/50">
                            —
                          </span>
                        )}
                      </td>

                      {/* Case (hidden on small screens) */}
                      <td className="px-3 py-2.5 hidden xl:table-cell">
                        {inv.caseType ? (
                          <>
                            <span className="text-xs font-medium">
                              <Highlight
                                text={inv.caseType}
                                query={search}
                              />
                            </span>
                            {inv.caseDate && (
                              <div className="text-[10px] text-muted-foreground whitespace-nowrap">
                                {fmtDate(inv.caseDate)}
                              </div>
                            )}
                          </>
                        ) : (
                          <span className="text-xs text-muted-foreground/50">
                            —
                          </span>
                        )}
                      </td>

                      {/* Status */}
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <StatusBadge status={inv.status} />
                      </td>

                      {/* Billed */}
                      <td className="px-3 py-2.5 text-right">
                        <span className="text-xs font-mono tabular-nums font-medium">
                          {fmtMoney(inv.grandTotal)}
                        </span>
                      </td>

                      {/* Outstanding */}
                      <td className="px-3 py-2.5 text-right">
                        {outstanding > 0 ? (
                          <span
                            className={cn(
                              "text-xs font-mono tabular-nums font-medium",
                              isOverdue
                                ? "text-red-600 dark:text-red-400"
                                : "text-amber-600 dark:text-amber-400",
                            )}
                          >
                            {fmtMoney(outstanding.toFixed(2))}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground/50">
                            —
                          </span>
                        )}
                      </td>

                      {/* Due Date (hidden on small screens) */}
                      <td className="px-3 py-2.5 whitespace-nowrap hidden lg:table-cell">
                        {inv.dueDate ? (
                          <span
                            className={cn(
                              "text-xs",
                              isOverdue
                                ? "text-red-600 dark:text-red-400 font-medium"
                                : isDueSoon
                                  ? "text-amber-600 dark:text-amber-400 font-medium"
                                  : "text-muted-foreground",
                            )}
                          >
                            {fmtDate(inv.dueDate)}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground/50">
                            —
                          </span>
                        )}
                      </td>

                      {/* SOA verified (hidden on small screens) */}
                      <td className="px-3 py-2.5 text-center hidden lg:table-cell">
                        {inv.soaVerified ? (
                          <CheckCircle2Icon className="w-3.5 h-3.5 text-green-600 dark:text-green-400 mx-auto" />
                        ) : inv.status !== "draft" &&
                          inv.status !== "cancelled" ? (
                          <AlertCircleIcon className="w-3.5 h-3.5 text-amber-500 mx-auto opacity-70" />
                        ) : (
                          <CircleIcon className="w-3.5 h-3.5 text-muted-foreground/20 mx-auto" />
                        )}
                      </td>

                      {/* Actions */}
                      <td
                        className="px-3 py-2.5"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-center gap-0.5 justify-end">
                          {can("invoice:update") &&
                            EDITABLE_STATUSES.has(inv.status) &&
                            inv.createdBy === currentUserId && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="w-6 h-6"
                                onClick={() =>
                                  router.push(
                                    `/dashboard/fulfillment/invoice/${inv.id}/edit`,
                                  )
                                }
                              >
                                <PencilIcon className="w-3 h-3" />
                              </Button>
                            )}
                          {can("invoice:delete") &&
                            DELETABLE_STATUSES.has(inv.status) &&
                            inv.createdBy === currentUserId && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="w-6 h-6 text-destructive hover:text-destructive"
                                disabled={deleting === inv.id}
                                onClick={() =>
                                  handleDelete(inv.id, inv.invoiceNo)
                                }
                              >
                                <TrashIcon className="w-3 h-3" />
                              </Button>
                            )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>

              {/* Footer totals */}
              <tfoot>
                <tr className="bg-muted/20 border-t border-border">
                  <td
                    colSpan={8}
                    className="px-3 py-2.5 text-xs font-medium text-muted-foreground"
                  >
                    {sorted.length} invoice{sorted.length !== 1 ? "s" : ""}
                    {(search || statusFilter) &&
                      ` · filtered from ${initialInvoices.length}`}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <span className="text-xs font-mono tabular-nums font-semibold">
                      {fmtMoney(footerTotals.billed.toFixed(2))}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <span
                      className={cn(
                        "text-xs font-mono tabular-nums font-semibold",
                        footerTotals.out > 0
                          ? "text-amber-600 dark:text-amber-400"
                          : "text-muted-foreground",
                      )}
                    >
                      {fmtMoney(footerTotals.out.toFixed(2))}
                    </span>
                  </td>
                  <td
                    colSpan={3}
                    className="hidden lg:table-cell"
                  />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
