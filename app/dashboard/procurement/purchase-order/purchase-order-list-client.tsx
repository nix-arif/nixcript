"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { type PurchaseOrderListRow, type PendingPrRow } from "@/server/purchase-order";
import { useAppStore } from "@/lib/store/use-app-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/page-header";
import { Highlight } from "@/components/highlight";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import {
  PlusIcon, SearchIcon, XIcon, TruckIcon,
  BuildingIcon, CalendarIcon, ClipboardListIcon, PackageIcon, ArrowRightIcon, AlertCircleIcon,
  ArrowUpDownIcon, CheckIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

type SortKey = "date" | "poNo" | "supplier" | "amount";
type SortDir = "asc" | "desc";
interface SortOption { key: SortKey; dir: SortDir; label: string }

const SORT_OPTIONS: SortOption[] = [
  { key: "date", dir: "desc", label: "Newest first" },
  { key: "date", dir: "asc", label: "Oldest first" },
  { key: "poNo", dir: "asc", label: "PO No (A→Z)" },
  { key: "poNo", dir: "desc", label: "PO No (Z→A)" },
  { key: "supplier", dir: "asc", label: "Supplier (A→Z)" },
  { key: "supplier", dir: "desc", label: "Supplier (Z→A)" },
  { key: "amount", dir: "desc", label: "Amount (High→Low)" },
  { key: "amount", dir: "asc", label: "Amount (Low→High)" },
];

function sortOrders(orders: PurchaseOrderListRow[], sort: SortOption): PurchaseOrderListRow[] {
  const sorted = [...orders].sort((a, b) => {
    switch (sort.key) {
      case "poNo":
        return (a.poNo ?? "").localeCompare(b.poNo ?? "");
      case "supplier": {
        const an = (a.supplierSnapshot as { name?: string } | null)?.name ?? "";
        const bn = (b.supplierSnapshot as { name?: string } | null)?.name ?? "";
        return an.localeCompare(bn);
      }
      case "amount":
        return (parseFloat(a.grandTotal ?? "0") || 0) - (parseFloat(b.grandTotal ?? "0") || 0);
      case "date":
      default:
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    }
  });
  return sort.dir === "asc" ? sorted : sorted.reverse();
}

const fmt = (v: string | number | null | undefined, currency = "MYR") =>
  `${currency} ${Number(v ?? 0).toLocaleString("en-MY", { minimumFractionDigits: 2 })}`;

const fmtDate = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const PO_STATUS: Record<string, { label: string; className: string }> = {
  draft:     { label: "Draft",     className: "bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400" },
  submitted: { label: "Submitted", className: "bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-400" },
  confirmed: { label: "Confirmed", className: "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400" },
  fulfilled: { label: "Fulfilled",  className: "bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400" },
  cancelled: { label: "Cancelled",  className: "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400" },
};

const PO_STATUSES = new Set(["draft", "submitted", "confirmed", "fulfilled", "cancelled"]);

function StatusBadge({ status }: { status: string }) {
  const cfg = PO_STATUS[status];
  if (!cfg) return null;
  return <span className={cn("text-[11px] font-medium rounded px-2 py-0.5", cfg.className)}>{cfg.label}</span>;
}

// "Fulfilled" only means everything was physically received (see
// maybeAutoFulfill in server/goods-receipt.ts) — it says nothing about
// whether it was actually accepted. This flags the gap: received quantity
// still sitting unresolved in "return to supplier" or "in-house repair".
function PendingActionBadge({ pendingReturnQty, pendingRepairQty }: { pendingReturnQty: number; pendingRepairQty: number }) {
  if (pendingReturnQty <= 0 && pendingRepairQty <= 0) return null;
  const parts: string[] = [];
  if (pendingReturnQty > 0) parts.push(`${pendingReturnQty} pending return`);
  if (pendingRepairQty > 0) parts.push(`${pendingRepairQty} pending repair`);
  return (
    <span
      className="flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800"
      title={parts.join(", ")}
    >
      <AlertCircleIcon className="w-2.5 h-2.5 shrink-0" />
      {parts.join(" · ")}
    </span>
  );
}

const PR_PENDING_STATUS: Record<string, { label: string; className: string }> = {
  approved:          { label: "Approved",          className: "bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400" },
  partially_ordered: { label: "Partially Ordered", className: "bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400" },
};

interface Props {
  initialOrders: PurchaseOrderListRow[];
  pendingPrs: PendingPrRow[];
  permissions: string[];
  currentUserId: string;
}

export function PurchaseOrderListClient({ initialOrders, pendingPrs, permissions, currentUserId }: Props) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortOption>(SORT_OPTIONS.find((o) => o.key === "poNo" && o.dir === "desc")!);
  const { isSwitchingOrg, setOrgSwitching } = useAppStore();

  const can = (p: string) => permissions.includes("*") || permissions.includes(p);

  useEffect(() => { setOrgSwitching(false); }, [initialOrders]);

  // Only show real supplier POs (confirmed/fulfilled/cancelled)
  const poOnly = initialOrders.filter((o) => PO_STATUSES.has(o.status));

  const filtered = sortOrders(poOnly.filter((o) => {
    if (!search) return true;
    const s = search.toLowerCase();
    const snap = o.supplierSnapshot as any;
    return (
      (o.poNo ?? "").toLowerCase().includes(s) ||
      (o.prNo ?? "").toLowerCase().includes(s) ||
      snap?.name?.toLowerCase().includes(s) ||
      o.status.toLowerCase().includes(s) ||
      o.createdByName?.toLowerCase().includes(s) ||
      o.customerPoNos.some((c) => c.toLowerCase().includes(s))
    );
  }), sort);

  return (
    <div className="p-6">
      <PageHeader
        title="Purchase Orders"
        description="Supplier POs issued from approved purchase requisitions"
        action={
          can("purchase-order:create") && (
            <Button onClick={() => router.push("/dashboard/procurement/purchase-order/create")} className="gap-2">
              <PlusIcon className="w-4 h-4" /> New PO
            </Button>
          )
        }
      />

      <div className="flex items-center gap-2 mb-4">
        <div className="relative flex-1">
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by PO no., supplier, status..."
            className="pl-9 h-9 text-sm"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
              <XIcon className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-9 gap-1.5 text-xs shrink-0">
              <ArrowUpDownIcon className="w-3.5 h-3.5" /> {sort.label}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {SORT_OPTIONS.map((opt) => (
              <DropdownMenuItem key={opt.label} onClick={() => setSort(opt)} className="justify-between gap-3">
                {opt.label}
                {sort.label === opt.label && <CheckIcon className="w-3.5 h-3.5" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {pendingPrs.length > 0 && (
        <div className="mb-5 border border-amber-200 dark:border-amber-800/50 rounded-xl overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-2.5 bg-amber-50 dark:bg-amber-950/20 border-b border-amber-200 dark:border-amber-800/50">
            <AlertCircleIcon className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
            <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">
              Pending PO Conversion
            </span>
            <span className="ml-auto text-[10px] text-amber-600 dark:text-amber-500 tabular-nums">
              {pendingPrs.length} requisition{pendingPrs.length !== 1 ? "s" : ""}
            </span>
          </div>
          <div className="divide-y divide-border/60">
            {pendingPrs.map((pr) => {
              const prStatus = PR_PENDING_STATUS[pr.status] ?? { label: pr.status, className: "bg-muted text-muted-foreground" };
              return (
                <div
                  key={pr.id}
                  className="flex items-center gap-3 px-4 py-3 bg-background hover:bg-muted/20 transition-colors cursor-pointer"
                  onClick={() => router.push(`/dashboard/procurement/purchase-order/create?prId=${pr.id}&from=${encodeURIComponent("/dashboard/procurement/purchase-order")}`)}
                >
                  <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-amber-50 dark:bg-amber-900/20 shrink-0">
                    <ClipboardListIcon className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-sm font-medium">{pr.prNo}</span>
                      <span className={cn("text-[11px] font-medium rounded px-2 py-0.5", prStatus.className)}>
                        {prStatus.label}
                      </span>
                      {pr.salesOrderNo && (
                        <span className="text-[10px] text-muted-foreground bg-muted/40 rounded px-1.5 py-0.5 font-mono">
                          {pr.salesOrderNo}
                        </span>
                      )}
                      {pr.customerPoNos.map((cpo) => (
                        <span key={cpo} className="inline-flex items-center text-[10px] font-mono font-medium px-1.5 py-0.5 rounded-md border bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800">
                          {cpo}
                        </span>
                      ))}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5">
                      <span className="text-[11px] text-muted-foreground">
                        {pr.itemCount} item{pr.itemCount !== 1 ? "s" : ""}
                      </span>
                      <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                        <CalendarIcon className="w-3 h-3 shrink-0" />
                        {fmtDate(pr.createdAt)}
                        {pr.requestedByName && ` · ${pr.requestedByName}`}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 text-[11px] font-medium text-amber-600 dark:text-amber-400 shrink-0">
                    Create PO <ArrowRightIcon className="w-3 h-3" />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {isSwitchingOrg ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="border border-border rounded-xl px-4 py-3 animate-pulse">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-muted shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="flex gap-2"><div className="h-3.5 w-28 bg-muted rounded" /><div className="h-3.5 w-16 bg-muted rounded" /></div>
                  <div className="h-3 w-48 bg-muted rounded" />
                  <div className="h-3 w-36 bg-muted rounded" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <>
          <div className="text-xs text-muted-foreground mb-3 tabular-nums">0 records</div>
          <div className="border border-border rounded-xl py-16 text-center text-muted-foreground">
            <TruckIcon className="w-8 h-8 mx-auto mb-3 opacity-30" />
            <div className="text-sm font-medium mb-1">No purchase orders yet</div>
            {search ? (
              <div className="text-xs">No results match your search</div>
            ) : (
              <>
                <div className="text-xs mb-4">POs are issued when purchase requisitions are approved</div>
                <Button
                  variant="outline" size="sm" className="gap-2"
                  onClick={() => router.push("/dashboard/procurement/requisition")}
                >
                  <ClipboardListIcon className="w-3.5 h-3.5" /> View Requisitions
                </Button>
              </>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="text-xs text-muted-foreground mb-3 tabular-nums">
            {filtered.length} record{filtered.length !== 1 ? "s" : ""}
          </div>
          <div className="space-y-2">
            {filtered.map((o) => {
              const snap = o.supplierSnapshot as any;
              return (
                <div
                  key={o.id}
                  className="border border-border rounded-xl bg-background hover:bg-muted/20 transition-colors cursor-pointer"
                  onClick={() => router.push(`/dashboard/procurement/purchase-order/${o.id}`)}
                >
                  <div className="flex items-center gap-3 px-4 py-3">
                    <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-900/20 shrink-0">
                      <TruckIcon className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-sm font-medium">
                          <Highlight text={o.poNo ?? o.id} query={search} />
                        </span>
                        <StatusBadge status={o.status} />
                        <PendingActionBadge pendingReturnQty={o.pendingReturnQty} pendingRepairQty={o.pendingRepairQty} />
                        {o.prNo && (
                          <span className="flex items-center gap-1 text-[10px] text-muted-foreground bg-muted/40 rounded px-1.5 py-0.5 font-mono">
                            <ClipboardListIcon className="w-2.5 h-2.5 shrink-0" />
                            <Highlight text={o.prNo} query={search} />
                          </span>
                        )}
                        {o.customerPoNos.map((cpo) => (
                          <span key={cpo} className="inline-flex items-center text-[10px] font-mono font-medium px-1.5 py-0.5 rounded-md border bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800">
                            <Highlight text={cpo} query={search} />
                          </span>
                        ))}
                        {o.itemCustomers.map((c) => (
                          <span key={`${c.name}-${c.organization}`} className="inline-flex items-center gap-1">
                            {c.organization && (
                              <span className="inline-flex items-center text-[10px] px-1.5 py-0.5 rounded-md bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-300 border border-violet-200 dark:border-violet-800">
                                {c.organization}
                              </span>
                            )}
                            <span className="inline-flex items-center text-[10px] px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground border border-border/60">
                              {c.name}
                            </span>
                          </span>
                        ))}
                      </div>
                      <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                        {snap?.name && (
                          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                            <BuildingIcon className="w-3 h-3 shrink-0" />
                            <Highlight text={snap.name} query={search} />
                          </span>
                        )}
                        <span className="text-[11px] font-semibold text-foreground ml-auto tabular-nums">
                          {fmt(o.grandTotal, o.currency ?? "MYR")}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 mt-0.5">
                        <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                          <CalendarIcon className="w-3 h-3 shrink-0" />
                          {fmtDate(o.createdAt)}
                          {o.createdByName && ` · ${o.createdByName}`}
                        </span>
                      </div>
                    </div>

                    <PackageIcon className="w-3.5 h-3.5 text-muted-foreground/40 shrink-0" />
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
