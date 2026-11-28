"use client";

import { GoneNotice } from "@/components/gone-notice";
import { RevBadge, useRevisions } from "@/components/amendment-history";
import { SoTrailHover } from "../so-trail-hover";
import { SoStockChip } from "@/components/so-stock-chip";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { getSalesOrdersCentralized, type CentralizedSalesOrder } from "@/server/sales-order";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/page-header";
import { Highlight } from "@/components/highlight";
import {
  SearchIcon,
  XIcon,
  FileTextIcon,
  UserIcon,
  BuildingIcon,
  RefreshCwIcon,
  LayersIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { CategoryFilter, CategoryTags, RecordCount, SO_STATS, StatCards, useListFilters } from "@/components/list-stat-filters";
import type { CategoryOption } from "@/server/document-category-chain";

const fmt = (v: string | number | null | undefined) =>
  `RM ${Number(v ?? 0).toLocaleString("en-MY", { minimumFractionDigits: 2 })}`;

const fmtDate = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const SO_STATUS: Record<string, { label: string; className: string }> = {
  "pending-do": { label: "Pending DO", className: "bg-teal-50 dark:bg-teal-900/20 text-teal-700 dark:text-teal-400" },
  "pending-pr": { label: "Pending PR", className: "bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-400" },
  draft: { label: "Draft", className: "bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400" },
  submitted: { label: "Awaiting Approval", className: "bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-400" },
  confirmed: { label: "Confirmed", className: "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400" },
  fulfilled: { label: "Fulfilled", className: "bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400" },
  cancelled: { label: "Cancelled", className: "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400" },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = SO_STATUS[status] ?? SO_STATUS.draft;
  return <span className={cn("text-[11px] font-medium rounded px-2 py-0.5", cfg.className)}>{cfg.label}</span>;
}

interface Props {
  initialOrders: CentralizedSalesOrder[];
  /** Every company's categories (the filter chips go by name) */
  categories?: CategoryOption[];
}

export function CentralizedSalesOrderClient({ initialOrders, categories = [] }: Props) {
  const router = useRouter();
  const [orders, setOrders] = useState(initialOrders);
  // Server data re-sent (live refresh / router.refresh): show it
  const [seenInitialOrders, setSeenInitialOrders] = useState(initialOrders);
  if (initialOrders !== seenInitialOrders) { setSeenInitialOrders(initialOrders); setOrders(initialOrders); }
  const [search, setSearch] = useState("");
  const [orgFilter, setOrgFilter] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const orgs = [...new Set(orders.map((o) => o.organizationName))].sort();

  // the stat cards count the company chosen (and the categories chosen)
  const inOrg = orgFilter ? orders.filter((o) => o.organizationName === orgFilter) : orders;
  const f = useListFilters(inOrg, categories, SO_STATS, true);

  const revs = useRevisions("so", orders.map((x) => x.id)); // amended: Rev N by the number
  const filtered = f.inScope.filter((o) => {
    if (!f.inBucketNow(o)) return false;
    if (!search) return true;
    const s = search.toLowerCase();
    const snap = o.customerSnapshot as any;
    const cpoMatch = o.cpoCustomers.some(
      (c) =>
        c.customerPoNo?.toLowerCase().includes(s) ||
        c.customerSnapshot?.name?.toLowerCase().includes(s) ||
        c.customerSnapshot?.organizationName?.toLowerCase().includes(s),
    );
    return (
      o.soNo.toLowerCase().includes(s) ||
      o.quotationNo?.toLowerCase().includes(s) ||
      snap?.name?.toLowerCase().includes(s) ||
      snap?.organizationName?.toLowerCase().includes(s) ||
      o.organizationName.toLowerCase().includes(s) ||
      cpoMatch ||
      f.searchCats(o, s)
    );
  });

  async function handleRefresh() {
    setRefreshing(true);
    try {
      setOrders(await getSalesOrdersCentralized());
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to refresh");
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="p-6">
      <GoneNotice what="sales order" />
      <PageHeader
        title="Centralized Sales Orders"
        description="Every Sales Order recorded across all organizations under the same owner"
        action={
          <Button variant="outline" size="sm" className="gap-1.5" onClick={handleRefresh} disabled={refreshing}>
            <RefreshCwIcon className={cn("w-3.5 h-3.5", refreshing && "animate-spin")} />
            Refresh
          </Button>
        }
      />

      <StatCards f={f} />
      <CategoryFilter f={f} />

      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by SO no., customer, QT no., CPO no., organization, category…"
            className="pl-9 h-9 text-sm"
          />
          {search && (
            <button type="button" aria-label="Clear search" onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
              <XIcon className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {orgs.length > 1 && (
          <div className="flex items-center gap-1 flex-wrap">
            <button
              onClick={() => setOrgFilter(null)}
              className={cn(
                "text-[11px] font-medium rounded-full px-2.5 py-1 border transition-colors",
                orgFilter === null ? "bg-foreground text-background border-foreground" : "border-border text-muted-foreground hover:bg-muted/50",
              )}
            >
              All orgs
            </button>
            {orgs.map((org) => (
              <button
                key={org}
                onClick={() => setOrgFilter(org)}
                className={cn(
                  "text-[11px] font-medium rounded-full px-2.5 py-1 border transition-colors",
                  orgFilter === org ? "bg-foreground text-background border-foreground" : "border-border text-muted-foreground hover:bg-muted/50",
                )}
              >
                {org}
              </button>
            ))}
          </div>
        )}
      </div>

      <RecordCount f={f} count={filtered.length} noun="order" />

      {filtered.length === 0 ? (
        <div className="border border-border rounded-xl py-16 text-center text-muted-foreground">
          <LayersIcon className="w-8 h-8 mx-auto mb-3 opacity-30" />
          <div className="text-sm font-medium mb-1">No sales orders found</div>
          <div className="text-xs">
            {orders.length === 0 ? "No Sales Orders recorded across any of your organizations yet." : "No records match your filters."}
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((o) => {
            const snap = o.customerSnapshot as any;
            const seen = new Set<string>();
            const customers = (
              o.cpoCustomers.length > 0
                ? o.cpoCustomers.map((c) => ({
                    label: c.customerSnapshot?.organizationName ?? (c.customerSnapshot ? [c.customerSnapshot.title, c.customerSnapshot.name].filter(Boolean).join(" ") : ""),
                  }))
                : [{ label: snap?.organizationName ?? (snap ? [snap.title, snap.name].filter(Boolean).join(" ") : "") }]
            ).filter((c) => {
              if (!c.label || seen.has(c.label)) return false;
              seen.add(c.label);
              return true;
            });

            return (
              <SoTrailHover key={o.id} id={o.id} soNo={o.soNo} centralized>
              <div
                className="border border-border rounded-xl bg-background hover:bg-muted/20 transition-colors cursor-pointer has-[a:focus-visible]:ring-3 has-[a:focus-visible]:ring-ring/50"
                onClick={() => router.push(`/dashboard/sales/order/centralized/${o.id}`)}
              >
                <div className="flex items-center gap-3 px-4 py-3">
                  <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-muted/40 shrink-0">
                    <FileTextIcon className="w-3.5 h-3.5 text-muted-foreground" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {/* the number, and its revision below it */}
                      <span className="inline-flex flex-col items-start gap-0.5 leading-tight">
                        {/* a real link, so the order opens from the keyboard and in a new tab */}
                        <Link
                          href={`/dashboard/sales/order/centralized/${o.id}`}
                          prefetch={false}
                          onClick={(e) => e.stopPropagation()}
                          className="font-mono text-sm font-medium outline-none hover:underline underline-offset-4"
                        >
                          <Highlight text={o.soNo} query={search} />
                        </Link>
                        <RevBadge revision={revs[o.id]} />
                      </span>
                      <StatusBadge status={o.status} />
                      <SoStockChip status={o.status} stockReservationStatus={o.stockReservationStatus} soId={o.id} />
                      <span className="text-[10px] font-medium text-indigo-700 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/20 rounded px-1.5 py-0.5">
                        <Highlight text={o.organizationName} query={search} />
                      </span>
                      {o.quotationNo && (
                        <span className="text-[10px] bg-muted/50 text-muted-foreground rounded px-1.5 py-0.5 font-mono">
                          QT: <Highlight text={o.quotationNo} query={search} />
                        </span>
                      )}
                      <span className="text-[10px] text-muted-foreground bg-muted/50 rounded px-1.5 py-0.5 ml-auto tabular-nums">
                        {fmtDate(o.createdAt)}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                      {customers.length > 0 && (
                        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          <BuildingIcon className="w-3 h-3" />
                          {customers.map((c, i) => (
                            <span key={i}>
                              {i > 0 && <span className="text-muted-foreground mx-1">·</span>}
                              <Highlight text={c.label} query={search} />
                            </span>
                          ))}
                        </span>
                      )}
                      {o.createdByName && (
                        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          <UserIcon className="w-3 h-3" />
                          {o.createdByName}
                        </span>
                      )}
                      <CategoryTags list={f.categoriesOf(o)} query={search} />
                      <span className="text-[11px] font-semibold text-foreground ml-auto tabular-nums">
                        {fmt(o.grandTotal)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
              </SoTrailHover>
            );
          })}
        </div>
      )}
    </div>
  );
}
