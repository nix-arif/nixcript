"use client";

import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import type { DashboardSummary } from "@/server/dashboard";
import {
  FileTextIcon,
  ShoppingCartIcon,
  PackageIcon,
  ClipboardListIcon,
  CheckCircle2Icon,
  ClockIcon,
  AlertCircleIcon,
  ArrowRightIcon,
  BuildingIcon,
  UserIcon,
  TruckIcon,
  ReceiptIcon,
  TrendingUpIcon,
  WalletIcon,
  BanknoteIcon,
  AlertTriangleIcon,
} from "lucide-react";

const fmtDate = (d: Date | string) =>
  new Date(d).toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" });

const fmtAmt = (v: string | null | undefined) =>
  `RM ${Number(v ?? 0).toLocaleString("en-MY", { minimumFractionDigits: 2 })}`;

// ── Status configs ──────────────────────────────────────────────────────────

const CPO_STRIPE: Record<string, string> = {
  received:     "bg-blue-400",
  acknowledged: "bg-amber-400",
  fulfilled:    "bg-green-500",
  cancelled:    "bg-gray-300 dark:bg-gray-600",
};

const SO_STRIPE: Record<string, string> = {
  draft:     "bg-amber-400",
  submitted: "bg-purple-400",
  confirmed: "bg-blue-400",
  fulfilled: "bg-green-500",
  cancelled: "bg-red-400",
};

const CPO_STATUS: Record<string, { label: string; className: string }> = {
  received:     { label: "Received",     className: "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400" },
  acknowledged: { label: "Acknowledged", className: "bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400" },
  fulfilled:    { label: "Fulfilled",    className: "bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400" },
  cancelled:    { label: "Cancelled",    className: "bg-gray-100 dark:bg-gray-800 text-gray-500" },
};

const SO_STATUS: Record<string, { label: string; className: string }> = {
  draft:     { label: "Draft",     className: "bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400" },
  submitted: { label: "Pending",   className: "bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-400" },
  confirmed: { label: "Confirmed", className: "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400" },
  fulfilled: { label: "Fulfilled", className: "bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400" },
  cancelled: { label: "Cancelled", className: "bg-gray-100 dark:bg-gray-800 text-gray-500" },
};

const QT_STATUS: Record<string, { label: string; className: string }> = {
  draft: { label: "Draft",     className: "bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400" },
  final: { label: "Finalized", className: "bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400" },
};

function Badge({ status, map }: { status: string; map: Record<string, { label: string; className: string }> }) {
  const cfg = map[status] ?? { label: status, className: "bg-gray-100 text-gray-600" };
  return (
    <span className={cn("text-[11px] font-medium rounded px-1.5 py-0.5 shrink-0", cfg.className)}>
      {cfg.label}
    </span>
  );
}

// ── KPI Card ────────────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  icon: Icon,
  href,
  accent,
  stripe,
}: {
  label: string;
  value: number;
  icon: React.ElementType;
  href?: string;
  accent?: string;
  stripe?: string;
}) {
  const router = useRouter();
  return (
    <div
      onClick={() => href && router.push(href)}
      className={cn(
        "rounded-xl border overflow-hidden flex flex-col bg-card",
        href && "cursor-pointer hover:shadow-sm transition-shadow",
      )}
    >
      {stripe && <div className={cn("h-0.5 shrink-0", stripe)} />}
      <div className="p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground font-medium">{label}</span>
          <span className={cn("rounded-lg p-1.5 shrink-0", accent ?? "bg-muted text-muted-foreground")}>
            <Icon className="h-3.5 w-3.5" />
          </span>
        </div>
        <p className="text-3xl font-bold tabular-nums leading-none">{value}</p>
      </div>
    </div>
  );
}

// ── Section header ──────────────────────────────────────────────────────────

function SectionHeader({
  icon: Icon,
  title,
  count,
  href,
  variant,
}: {
  icon: React.ElementType;
  title: string;
  count?: number;
  href?: string;
  variant?: "warning" | "info" | "success" | "default";
}) {
  const router = useRouter();
  const colors = {
    warning: "text-amber-600 dark:text-amber-400",
    info:    "text-blue-600 dark:text-blue-400",
    success: "text-green-600 dark:text-green-400",
    default: "text-muted-foreground",
  };
  return (
    <div className="flex items-center justify-between">
      <h2 className={cn("flex items-center gap-2 text-[13px] font-semibold", colors[variant ?? "default"])}>
        <Icon className="h-3.5 w-3.5 shrink-0" />
        {title}
        {count !== undefined && (
          <span className={cn(
            "text-[11px] font-medium rounded-full px-2 py-0.5 tabular-nums",
            count > 0
              ? "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400"
              : "bg-muted text-muted-foreground",
          )}>
            {count}
          </span>
        )}
      </h2>
      {href && (
        <button
          onClick={() => router.push(href)}
          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
        >
          View all <ArrowRightIcon className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

// ── Row items ───────────────────────────────────────────────────────────────

function CpoRow({ row, onClick }: { row: DashboardSummary["openCpos"][0]; onClick: () => void }) {
  const stripe = CPO_STRIPE[row.status] ?? "bg-muted";
  return (
    <div
      onClick={onClick}
      className="flex overflow-hidden rounded-lg hover:bg-muted/40 cursor-pointer transition-colors"
    >
      <div className={cn("w-0.5 shrink-0", stripe)} />
      <div className="flex items-center gap-3 flex-1 min-w-0 py-2.5 px-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium font-mono">{row.customerPoNo}</span>
            <Badge status={row.status} map={CPO_STATUS} />
          </div>
          <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
            {row.customerName && (
              <span className="flex items-center gap-1 min-w-0">
                <UserIcon className="h-3 w-3 shrink-0" />
                <span className="truncate">{row.customerName}</span>
              </span>
            )}
            {row.customerOrg && (
              <span className="flex items-center gap-1 min-w-0">
                <BuildingIcon className="h-3 w-3 shrink-0" />
                <span className="truncate">{row.customerOrg}</span>
              </span>
            )}
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className="text-sm font-medium tabular-nums">{fmtAmt(row.amount)}</p>
          <p className="text-xs text-muted-foreground">{fmtDate(row.createdAt)}</p>
        </div>
      </div>
    </div>
  );
}

function SoRow({ row, onClick }: { row: DashboardSummary["pendingSoApprovals"][0]; onClick: () => void }) {
  const stripe = SO_STRIPE[row.status] ?? "bg-muted";
  return (
    <div
      onClick={onClick}
      className="flex overflow-hidden rounded-lg hover:bg-muted/40 cursor-pointer transition-colors"
    >
      <div className={cn("w-0.5 shrink-0", stripe)} />
      <div className="flex items-center gap-3 flex-1 min-w-0 py-2.5 px-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium font-mono">{row.soNo}</span>
            <Badge status={row.status} map={SO_STATUS} />
          </div>
          <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
            {row.customerName && (
              <span className="flex items-center gap-1 min-w-0">
                <UserIcon className="h-3 w-3 shrink-0" />
                <span className="truncate">{row.customerName}</span>
              </span>
            )}
            {row.customerOrg && (
              <span className="flex items-center gap-1 min-w-0">
                <BuildingIcon className="h-3 w-3 shrink-0" />
                <span className="truncate">{row.customerOrg}</span>
              </span>
            )}
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className="text-sm font-medium tabular-nums">{fmtAmt(row.grandTotal)}</p>
          <p className="text-xs text-muted-foreground">{fmtDate(row.createdAt)}</p>
        </div>
      </div>
    </div>
  );
}

function QtRow({ row, onClick }: { row: DashboardSummary["pendingQtApprovals"][0]; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      className="flex overflow-hidden rounded-lg hover:bg-muted/40 cursor-pointer transition-colors"
    >
      <div className="w-0.5 shrink-0 bg-amber-400" />
      <div className="flex items-center gap-3 flex-1 min-w-0 py-2.5 px-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium font-mono">{row.quotationNo}</span>
            <Badge status={row.status} map={QT_STATUS} />
          </div>
          <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
            {row.customerName && (
              <span className="flex items-center gap-1 min-w-0">
                <UserIcon className="h-3 w-3 shrink-0" />
                <span className="truncate">{row.customerName}</span>
              </span>
            )}
            {row.customerOrg && (
              <span className="flex items-center gap-1 min-w-0">
                <BuildingIcon className="h-3 w-3 shrink-0" />
                <span className="truncate">{row.customerOrg}</span>
              </span>
            )}
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className="text-xs text-muted-foreground">{fmtDate(row.createdAt)}</p>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 py-5 px-3 text-sm text-muted-foreground">
      <CheckCircle2Icon className="h-4 w-4 text-green-500 shrink-0" />
      {message}
    </div>
  );
}

// ── Stakeholder financial panel ─────────────────────────────────────────────

function FinCard({
  label,
  value,
  sub,
  icon: Icon,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ElementType;
  accent: string;
}) {
  return (
    <div className="rounded-xl border bg-card overflow-hidden flex flex-col">
      <div className="p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground font-medium">{label}</span>
          <span className={cn("rounded-lg p-1.5 shrink-0", accent)}>
            <Icon className="h-3.5 w-3.5" />
          </span>
        </div>
        <p className="text-2xl font-bold tabular-nums leading-none">{value}</p>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </div>
    </div>
  );
}

function StakeholderPanel({ stats }: { stats: DashboardSummary["invoiceStats"] }) {
  if (!stats) return null;
  const fmt = (v: string | number) =>
    `RM ${Number(v).toLocaleString("en-MY", { minimumFractionDigits: 2 })}`;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <TrendingUpIcon className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-[13px] font-semibold">Financial Overview</h2>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <FinCard
          label="Total Billed"
          value={fmt(stats.totalBilled)}
          sub={`${stats.totalCount} invoice${stats.totalCount !== 1 ? "s" : ""}`}
          icon={ReceiptIcon}
          accent="bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
        />
        <FinCard
          label="Collected"
          value={fmt(stats.totalCollected)}
          sub={`${stats.paidCount} paid`}
          icon={BanknoteIcon}
          accent="bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400"
        />
        <FinCard
          label="Outstanding"
          value={fmt(stats.totalOutstanding)}
          sub={`${stats.sentCount} sent · ${stats.overdueCount} overdue`}
          icon={WalletIcon}
          accent={
            stats.overdueCount > 0
              ? "bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400"
              : "bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400"
          }
        />
        <FinCard
          label="Overdue"
          value={String(stats.overdueCount)}
          sub={`${stats.cancelledCount} cancelled`}
          icon={AlertTriangleIcon}
          accent={
            stats.overdueCount > 0
              ? "bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400"
              : "bg-muted text-muted-foreground"
          }
        />
      </div>

      {/* Status breakdown bar */}
      {stats.totalCount > 0 && (
        <div className="rounded-xl border bg-card p-4 space-y-3">
          <p className="text-xs font-medium text-muted-foreground">Invoice status breakdown</p>
          <div className="flex h-2 rounded-full overflow-hidden gap-px">
            {stats.paidCount > 0 && (
              <div
                className="bg-green-500"
                style={{ width: `${(stats.paidCount / stats.totalCount) * 100}%` }}
                title={`Paid: ${stats.paidCount}`}
              />
            )}
            {stats.sentCount > 0 && (
              <div
                className="bg-blue-400"
                style={{ width: `${(stats.sentCount / stats.totalCount) * 100}%` }}
                title={`Sent: ${stats.sentCount}`}
              />
            )}
            {stats.draftCount > 0 && (
              <div
                className="bg-amber-400"
                style={{ width: `${(stats.draftCount / stats.totalCount) * 100}%` }}
                title={`Draft: ${stats.draftCount}`}
              />
            )}
            {stats.overdueCount > 0 && (
              <div
                className="bg-red-500"
                style={{ width: `${(stats.overdueCount / stats.totalCount) * 100}%` }}
                title={`Overdue: ${stats.overdueCount}`}
              />
            )}
            {stats.cancelledCount > 0 && (
              <div
                className="bg-muted"
                style={{ width: `${(stats.cancelledCount / stats.totalCount) * 100}%` }}
                title={`Cancelled: ${stats.cancelledCount}`}
              />
            )}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
            {stats.paidCount > 0 && (
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-2 h-2 rounded-full bg-green-500" />
                Paid {stats.paidCount}
              </span>
            )}
            {stats.sentCount > 0 && (
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-2 h-2 rounded-full bg-blue-400" />
                Sent {stats.sentCount}
              </span>
            )}
            {stats.draftCount > 0 && (
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-2 h-2 rounded-full bg-amber-400" />
                Draft {stats.draftCount}
              </span>
            )}
            {stats.overdueCount > 0 && (
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-2 h-2 rounded-full bg-red-500" />
                Overdue {stats.overdueCount}
              </span>
            )}
            {stats.cancelledCount > 0 && (
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-2 h-2 rounded-full bg-muted-foreground/40" />
                Cancelled {stats.cancelledCount}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

interface Props {
  summary: DashboardSummary;
  userName: string | null;
}

export function DashboardClient({ summary, userName }: Props) {
  const router = useRouter();
  const { kpi, can, openCpos, pendingSoApprovals, pendingQtApprovals, recentCpos, recentSos, isStakeholder, invoiceStats } = summary;

  const totalOpenTasks = openCpos.length + pendingSoApprovals.length + kpi.pendingDoCount + kpi.pendingInvoiceDoCount;
  const firstName = userName?.split(" ")[0]?.toLowerCase() ?? null;

  return (
    <div className="p-6 flex flex-col gap-6">

      {/* Welcome */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            Welcome back{firstName ? `, ${firstName}` : ""}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {totalOpenTasks > 0
              ? `You have ${totalOpenTasks} open task${totalOpenTasks !== 1 ? "s" : ""} that need attention.`
              : "Everything is up to date. Here's your workspace overview."}
          </p>
        </div>
        {totalOpenTasks > 0 && (
          <div className="shrink-0 mt-0.5 px-3 py-1.5 rounded-full text-xs font-medium tabular-nums bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/50 text-amber-700 dark:text-amber-400">
            {totalOpenTasks} open task{totalOpenTasks !== 1 ? "s" : ""}
          </div>
        )}
      </div>

      {/* Stakeholder financial overview */}
      {isStakeholder && <StakeholderPanel stats={invoiceStats} />}

      {/* KPI Row */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        {can.cpo && (
          <KpiCard
            label="Open CPOs"
            value={kpi.openCpoCount}
            icon={ClipboardListIcon}
            href="/dashboard/sales/customer-po"
            stripe={kpi.openCpoCount > 0 ? "bg-amber-400" : "bg-border"}
            accent={kpi.openCpoCount > 0 ? "bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400" : undefined}
          />
        )}
        {can.so && (
          <KpiCard
            label="Pending Approval"
            value={pendingSoApprovals.length}
            icon={ClockIcon}
            href="/dashboard/sales/order"
            stripe={pendingSoApprovals.length > 0 ? "bg-purple-400" : "bg-border"}
            accent={pendingSoApprovals.length > 0 ? "bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400" : undefined}
          />
        )}
        {can.so && (
          <KpiCard
            label="Active Orders"
            value={kpi.activeSoCount}
            icon={ShoppingCartIcon}
            href="/dashboard/sales/order"
            stripe="bg-blue-400"
            accent="bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
          />
        )}
        {can.so && (
          <KpiCard
            label="Fulfilled"
            value={kpi.fulfilledSoCount}
            icon={CheckCircle2Icon}
            href="/dashboard/sales/order"
            stripe="bg-green-500"
            accent="bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400"
          />
        )}
        {can.consignment && (
          <KpiCard
            label="Consignments"
            value={kpi.activeConsignmentCount}
            icon={PackageIcon}
            href="/dashboard/sales/consignment"
            stripe="bg-indigo-400"
            accent="bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400"
          />
        )}
        {can.do && (
          <KpiCard
            label="Pending Delivery"
            value={kpi.pendingDoCount}
            icon={TruckIcon}
            href="/dashboard/fulfillment/delivery"
            stripe={kpi.pendingDoCount > 0 ? "bg-teal-400" : "bg-border"}
            accent={kpi.pendingDoCount > 0 ? "bg-teal-100 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400" : undefined}
          />
        )}
        {can.invoice && (
          <KpiCard
            label="Pending Invoice"
            value={kpi.pendingInvoiceDoCount}
            icon={ReceiptIcon}
            href="/dashboard/fulfillment/invoice"
            stripe={kpi.pendingInvoiceDoCount > 0 ? "bg-amber-400" : "bg-border"}
            accent={kpi.pendingInvoiceDoCount > 0 ? "bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400" : undefined}
          />
        )}
      </div>

      {/* Open Tasks */}
      <div className="grid md:grid-cols-2 gap-4">

        {can.cpo && (
          <div className="border rounded-xl overflow-hidden bg-card">
            <div className="px-4 pt-4 pb-3">
              <SectionHeader
                icon={AlertCircleIcon}
                title="Customer POs — Awaiting SO"
                count={openCpos.length}
                href="/dashboard/sales/customer-po"
                variant={openCpos.length > 0 ? "warning" : "default"}
              />
            </div>
            <div className="px-2 pb-2">
              {openCpos.length === 0
                ? <EmptyState message="All Customer POs have been processed." />
                : openCpos.slice(0, 6).map((row) => (
                    <CpoRow key={row.id} row={row} onClick={() => router.push(`/dashboard/sales/customer-po/${row.id}`)} />
                  ))}
            </div>
          </div>
        )}

        {can.so && (
          <div className="border rounded-xl overflow-hidden bg-card">
            <div className="px-4 pt-4 pb-3">
              <SectionHeader
                icon={ClockIcon}
                title="Sales Orders — Pending Approval"
                count={pendingSoApprovals.length}
                href="/dashboard/sales/order"
                variant={pendingSoApprovals.length > 0 ? "warning" : "default"}
              />
            </div>
            <div className="px-2 pb-2">
              {pendingSoApprovals.length === 0
                ? <EmptyState message="No Sales Orders awaiting approval." />
                : pendingSoApprovals.slice(0, 6).map((row) => (
                    <SoRow key={row.id} row={row} onClick={() => router.push(`/dashboard/sales/order/${row.id}`)} />
                  ))}
            </div>
          </div>
        )}
      </div>

      {/* Draft Quotations */}
      {can.quotation && pendingQtApprovals.length > 0 && (
        <div className="border rounded-xl overflow-hidden bg-card">
          <div className="px-4 pt-4 pb-3">
            <SectionHeader
              icon={FileTextIcon}
              title="Quotations in Progress"
              count={pendingQtApprovals.length}
              href="/dashboard/sales/quotation"
              variant="info"
            />
          </div>
          <div className="grid md:grid-cols-2 px-2 pb-2">
            {pendingQtApprovals.slice(0, 8).map((row) => (
              <QtRow key={row.id} row={row} onClick={() => router.push(`/dashboard/sales/quotation/${row.id}`)} />
            ))}
          </div>
        </div>
      )}

      {/* Recent activity */}
      <div className="grid md:grid-cols-2 gap-4">

        {can.cpo && (
          <div className="border rounded-xl overflow-hidden bg-card">
            <div className="px-4 pt-4 pb-3">
              <SectionHeader
                icon={ClipboardListIcon}
                title="Recent Customer POs"
                href="/dashboard/sales/customer-po"
              />
            </div>
            <div className="px-2 pb-2">
              {recentCpos.length === 0
                ? <p className="py-5 text-sm text-muted-foreground text-center">No Customer POs yet.</p>
                : recentCpos.map((row) => (
                    <CpoRow key={row.id} row={row} onClick={() => router.push(`/dashboard/sales/customer-po/${row.id}`)} />
                  ))}
            </div>
          </div>
        )}

        {can.so && (
          <div className="border rounded-xl overflow-hidden bg-card">
            <div className="px-4 pt-4 pb-3">
              <SectionHeader
                icon={ShoppingCartIcon}
                title="Recent Sales Orders"
                href="/dashboard/sales/order"
              />
            </div>
            <div className="px-2 pb-2">
              {recentSos.length === 0
                ? <p className="py-5 text-sm text-muted-foreground text-center">No Sales Orders yet.</p>
                : recentSos.map((row) => (
                    <SoRow key={row.id} row={row} onClick={() => router.push(`/dashboard/sales/order/${row.id}`)} />
                  ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
