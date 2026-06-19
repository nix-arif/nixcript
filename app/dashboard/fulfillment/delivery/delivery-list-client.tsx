"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import { toast } from "sonner";
import { deleteDeliveryOrder, type DeliveryOrderListRow, type PendingSoForDoRow } from "@/server/delivery-order";
import { useAppStore } from "@/lib/store/use-app-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/page-header";
import { Highlight } from "@/components/highlight";
import {
  PlusIcon, SearchIcon, XIcon, TruckIcon,
  PencilIcon, TrashIcon, UserIcon, BuildingIcon, CalendarIcon, ArrowRightIcon, ReceiptIcon,
  ChevronLeftIcon, ChevronRightIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

const fmtDate = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const DO_STATUS: Record<string, { label: string; className: string; accent: string }> = {
  draft:     { label: "Draft",     className: "bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400",  accent: "bg-amber-400"  },
  delivered: { label: "Delivered", className: "bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400",  accent: "bg-green-500"  },
  returned:  { label: "Returned",  className: "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400",          accent: "bg-red-400"    },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = DO_STATUS[status] ?? DO_STATUS.draft;
  return <span className={cn("text-[11px] font-medium rounded px-2 py-0.5", cfg.className)}>{cfg.label}</span>;
}

const EDITABLE_STATUSES  = new Set(["draft"]);
const DELETABLE_STATUSES = new Set(["draft"]);

const fmtAmt = (v: string | null | undefined) =>
  v ? parseFloat(v).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "0.00";

// ── Status filters ────────────────────────────────────────────────────────

const STATUS_FILTERS = [
  { value: "",          label: "All" },
  { value: "draft",     label: "Draft" },
  { value: "delivered", label: "Delivered" },
  { value: "returned",  label: "Returned" },
];

// ── Pagination ────────────────────────────────────────────────────────────

function Pagination({ page, totalPages, onPage }: { page: number; totalPages: number; onPage: (p: number) => void }) {
  if (totalPages <= 1) return null;

  const pages: (number | "…")[] = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    if (page > 3) pages.push("…");
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) pages.push(i);
    if (page < totalPages - 2) pages.push("…");
    pages.push(totalPages);
  }

  return (
    <div className="flex items-center justify-center gap-1 py-4">
      <Button variant="outline" size="icon" className="w-7 h-7" disabled={page === 1} onClick={() => onPage(page - 1)}>
        <ChevronLeftIcon className="w-3.5 h-3.5" />
      </Button>
      {pages.map((p, i) =>
        p === "…" ? (
          <span key={`ellipsis-${i}`} className="w-7 h-7 flex items-center justify-center text-xs text-muted-foreground">…</span>
        ) : (
          <Button key={p} variant={p === page ? "default" : "outline"} size="icon" className="w-7 h-7 text-xs" onClick={() => onPage(p as number)}>
            {p}
          </Button>
        )
      )}
      <Button variant="outline" size="icon" className="w-7 h-7" disabled={page === totalPages} onClick={() => onPage(page + 1)}>
        <ChevronRightIcon className="w-3.5 h-3.5" />
      </Button>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────

interface Props {
  initialOrders: DeliveryOrderListRow[];
  total: number;
  page: number;
  pageSize: number;
  initialSearch: string;
  initialStatus: string;
  pendingSos: PendingSoForDoRow[];
  permissions: string[];
  currentUserId: string;
}

export function DeliveryOrderListClient({ initialOrders, total, page, pageSize, initialSearch, initialStatus, pendingSos, permissions, currentUserId }: Props) {
  const router   = useRouter();
  const pathname = usePathname();

  const [searchInput, setSearchInput]   = useState(initialSearch);
  const [statusFilter, setStatusFilter] = useState(initialStatus);
  const [deleting, setDeleting]         = useState<string | null>(null);
  const { isSwitchingOrg, setOrgSwitching } = useAppStore();

  const can = (p: string) => permissions.includes("*") || permissions.includes(p);

  useEffect(() => { setOrgSwitching(false); }, [initialOrders]);
  useEffect(() => { setSearchInput(initialSearch); },  [initialSearch]);
  useEffect(() => { setStatusFilter(initialStatus); }, [initialStatus]);

  // ── URL navigation ────────────────────────────────────────────────────

  const pushParams = useCallback(
    (updates: Record<string, string>) => {
      const params = new URLSearchParams(window.location.search);
      Object.entries(updates).forEach(([k, v]) => {
        if (v) params.set(k, v);
        else params.delete(k);
      });
      router.push(`${pathname}?${params.toString()}`);
    },
    [pathname, router],
  );

  useEffect(() => {
    const t = setTimeout(() => {
      pushParams({ search: searchInput, page: "" });
    }, 350);
    return () => clearTimeout(t);
  }, [searchInput]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleStatusFilter = (v: string) => {
    setStatusFilter(v);
    pushParams({ status: v, page: "" });
  };

  const handlePage = (p: number) => {
    pushParams({ page: p === 1 ? "" : String(p) });
  };

  async function handleDelete(id: string, doNo: string) {
    if (!confirm(`Delete ${doNo}? This cannot be undone.`)) return;
    setDeleting(id);
    try {
      await deleteDeliveryOrder(id);
      toast.success("Delivery order deleted");
      router.refresh();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setDeleting(null);
    }
  }

  const totalPages = Math.ceil(total / pageSize);
  const isFiltered = !!searchInput || !!statusFilter;

  return (
    <div className="p-6">
      <PageHeader
        title="Delivery Orders"
        description="Manage outgoing deliveries to customers"
        action={
          can("delivery-order:create") && (
            <Button onClick={() => router.push("/dashboard/fulfillment/delivery/create")} className="gap-2">
              <PlusIcon className="w-4 h-4" /> New DO
            </Button>
          )
        }
      />

      {pendingSos.length > 0 && can("delivery-order:create") && (
        <div className="border border-teal-200 dark:border-teal-800/50 rounded-xl overflow-hidden mb-4">
          <div className="flex items-center gap-2 px-4 py-2.5 bg-teal-50 dark:bg-teal-950/20 border-b border-teal-200 dark:border-teal-800/50">
            <TruckIcon className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400 shrink-0" />
            <span className="text-xs font-semibold text-teal-700 dark:text-teal-400">Pending DO Creation</span>
            <span className="ml-auto text-[10px] text-teal-600 dark:text-teal-500 tabular-nums">
              {pendingSos.length} sales order{pendingSos.length !== 1 ? "s" : ""} ready to deliver
            </span>
          </div>
          <div className="divide-y divide-border/60">
            {pendingSos.map((so) => (
              <div
                key={so.id}
                className="flex items-center gap-3 px-4 py-3 bg-background hover:bg-muted/20 transition-colors cursor-pointer"
                onClick={() => router.push(`/dashboard/fulfillment/delivery/create?soId=${so.id}&soNo=${encodeURIComponent(so.soNo)}`)}
              >
                <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-teal-50 dark:bg-teal-900/20 shrink-0">
                  <TruckIcon className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-sm font-medium">{so.soNo}</span>
                    {so.customerPoNos.map((cpo) => (
                      <span key={cpo} className="text-[10px] font-mono font-medium px-1.5 py-0.5 rounded-md bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                        {cpo}
                      </span>
                    ))}
                    <span className="text-[11px] font-semibold text-foreground tabular-nums ml-auto">
                      MYR {fmtAmt(so.grandTotal)}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                    {so.customers.length > 0 && (
                      <span className="flex items-start gap-1 text-[11px] text-muted-foreground">
                        <BuildingIcon className="w-3 h-3 shrink-0 mt-px" />
                        <span className="flex flex-wrap gap-x-2 gap-y-0.5">
                          {so.customers.map((c, i) => (
                            <span key={i}>
                              {c.name}
                              {c.organizationName && <span className="text-muted-foreground/60"> · {c.organizationName}</span>}
                            </span>
                          ))}
                        </span>
                      </span>
                    )}
                    <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                      <CalendarIcon className="w-3 h-3 shrink-0" />
                      {fmtDate(so.createdAt)}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 text-[11px] font-medium text-teal-600 dark:text-teal-400 shrink-0">
                  Create DO <ArrowRightIcon className="w-3 h-3" />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-2 items-start sm:items-center mb-2">
        <div className="relative flex-1 min-w-0">
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search by DO no., customer, SO no., status..."
            className="pl-9 h-9 text-sm"
          />
          {searchInput && (
            <button onClick={() => setSearchInput("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
              <XIcon className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-1 flex-wrap">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => handleStatusFilter(f.value)}
              className={cn(
                "text-xs px-2.5 py-1 rounded-full border transition-colors",
                statusFilter === f.value
                  ? "bg-foreground text-background border-foreground"
                  : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/30",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {isSwitchingOrg ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="border border-border rounded-xl px-4 py-3 animate-pulse">
              <div className="flex items-center gap-3">
                <div className="flex-1 space-y-2">
                  <div className="flex gap-2"><div className="h-3.5 w-28 bg-muted rounded" /><div className="h-3.5 w-16 bg-muted rounded" /></div>
                  <div className="h-3 w-48 bg-muted rounded" />
                  <div className="h-3 w-36 bg-muted rounded" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : initialOrders.length === 0 ? (
        <>
          <div className="text-xs text-muted-foreground mb-3 tabular-nums">0 orders</div>
          <div className="border border-border rounded-xl py-16 text-center text-muted-foreground">
            <TruckIcon className="w-8 h-8 mx-auto mb-3 opacity-30" />
            <div className="text-sm font-medium mb-1">
              {isFiltered ? "No delivery orders match your filter" : "No delivery orders yet"}
            </div>
            {!isFiltered && (
              <>
                <div className="text-xs mb-4">Create your first delivery order to get started</div>
                {can("delivery-order:create") && (
                  <Button variant="outline" size="sm" className="gap-2" onClick={() => router.push("/dashboard/fulfillment/delivery/create")}>
                    <PlusIcon className="w-3.5 h-3.5" /> New DO
                  </Button>
                )}
              </>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="text-xs text-muted-foreground mb-3 tabular-nums">
            {total} order{total !== 1 ? "s" : ""} total
            {totalPages > 1 && ` · page ${page} / ${totalPages}`}
          </div>
          <div className="space-y-2">
            {initialOrders.map((o) => {
              const snap        = o.customerSnapshot as any;
              const accentColor = DO_STATUS[o.status]?.accent ?? "bg-muted";
              const orgName     = snap?.organizationName;
              const personName  = snap ? [snap.title, snap.name].filter(Boolean).join(" ") : null;

              return (
                <div
                  key={o.id}
                  className="flex overflow-hidden rounded-xl border border-border bg-background hover:bg-muted/20 transition-colors cursor-pointer"
                  onClick={() => router.push(`/dashboard/fulfillment/delivery/${o.id}`)}
                >
                  <div className={`w-1 shrink-0 ${accentColor}`} />

                  <div className="flex-1 min-w-0 px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-mono text-sm font-semibold tracking-tight">
                          <Highlight text={o.doNo} query={searchInput} />
                        </span>
                        <StatusBadge status={o.status} />
                        {o.status === "delivered" && !o.invoiceId && can("invoice:read") && (
                          <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-700">
                            <ReceiptIcon className="w-3 h-3 shrink-0" />invoice pending
                          </span>
                        )}
                        {o.invoiceId && can("invoice:read") && (
                          <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800 font-mono">
                            <ReceiptIcon className="w-3 h-3 shrink-0" />{o.invoiceNo}
                          </span>
                        )}
                        {o.salesOrderNo && (
                          <span className="text-[10px] text-muted-foreground bg-muted/60 rounded px-1.5 py-0.5 font-mono hidden sm:inline">
                            SO: {o.salesOrderNo}
                          </span>
                        )}
                      </div>
                      {o.deliveryDate && (
                        <span className="text-xs text-muted-foreground tabular-nums shrink-0">{fmtDate(o.deliveryDate)}</span>
                      )}
                    </div>

                    {(orgName || personName) && (
                      <div className="mt-1.5 flex flex-col gap-0.5">
                        {orgName && (
                          <div className="flex items-center gap-1.5 min-w-0">
                            <BuildingIcon className="w-3 h-3 text-muted-foreground shrink-0" />
                            <p className="text-[12px] font-medium text-foreground/80 truncate">
                              <Highlight text={orgName} query={searchInput} />
                            </p>
                          </div>
                        )}
                        {personName && (
                          <div className="flex items-center gap-1.5 min-w-0">
                            <UserIcon className="w-3 h-3 text-muted-foreground shrink-0" />
                            <p className="text-[11px] text-muted-foreground truncate">
                              <Highlight text={personName} query={searchInput} />
                            </p>
                          </div>
                        )}
                      </div>
                    )}

                    <div className="flex items-center justify-between mt-1.5">
                      <div className="flex items-center gap-3 flex-wrap">
                        {o.createdByName && (
                          <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                            <CalendarIcon className="w-3 h-3" />
                            {fmtDate(o.createdAt)} · {o.createdByName}
                          </span>
                        )}
                        {o.deliveredTo && (
                          <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                            <TruckIcon className="w-3 h-3" />
                            {o.deliveredTo}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                        {can("delivery-order:update") && EDITABLE_STATUSES.has(o.status) && o.createdBy === currentUserId && (
                          <Button variant="ghost" size="icon" className="w-7 h-7"
                            onClick={() => router.push(`/dashboard/fulfillment/delivery/${o.id}/edit`)}>
                            <PencilIcon className="w-3.5 h-3.5" />
                          </Button>
                        )}
                        {can("delivery-order:delete") && DELETABLE_STATUSES.has(o.status) && o.createdBy === currentUserId && (
                          <Button variant="ghost" size="icon" className="w-7 h-7 text-destructive hover:text-destructive"
                            disabled={deleting === o.id} onClick={() => handleDelete(o.id, o.doNo)}>
                            <TrashIcon className="w-3.5 h-3.5" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <Pagination page={page} totalPages={totalPages} onPage={handlePage} />
        </>
      )}
    </div>
  );
}
