"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { getPurchaseOrdersCentralized, type CentralizedPurchaseOrder } from "@/server/purchase-order";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/page-header";
import { Highlight } from "@/components/highlight";
import {
  SearchIcon, XIcon, TruckIcon, BuildingIcon, CalendarIcon,
  RefreshCwIcon, LayersIcon, ClipboardListIcon, EyeIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

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

function StatusBadge({ status }: { status: string }) {
  const cfg = PO_STATUS[status] ?? { label: status, className: "bg-muted text-muted-foreground" };
  return <span className={cn("text-[11px] font-medium rounded px-2 py-0.5", cfg.className)}>{cfg.label}</span>;
}

interface Props {
  initialPos: CentralizedPurchaseOrder[];
}

export function CentralizedPurchaseOrderClient({ initialPos }: Props) {
  const router = useRouter();
  const [pos, setPos] = useState(initialPos);
  const [search, setSearch] = useState("");
  const [orgFilter, setOrgFilter] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const orgs = [...new Set(pos.map((p) => p.organizationName))].sort();

  const filtered = pos.filter((p) => {
    if (orgFilter && p.organizationName !== orgFilter) return false;
    if (!search) return true;
    const s = search.toLowerCase();
    const snap = p.supplierSnapshot as { name?: string } | null;
    return (
      (p.poNo ?? "").toLowerCase().includes(s) ||
      (p.prNo ?? "").toLowerCase().includes(s) ||
      snap?.name?.toLowerCase().includes(s) ||
      p.organizationName.toLowerCase().includes(s) ||
      p.customerPoNos.some((c) => c.toLowerCase().includes(s))
    );
  });

  async function handleRefresh() {
    setRefreshing(true);
    try {
      setPos(await getPurchaseOrdersCentralized());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to refresh");
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="p-6">
      <PageHeader
        title="Centralized Supplier POs"
        description="Every Supplier PO recorded across all organizations under the same owner"
        action={
          <Button variant="outline" size="sm" className="gap-1.5" onClick={handleRefresh} disabled={refreshing}>
            <RefreshCwIcon className={cn("w-3.5 h-3.5", refreshing && "animate-spin")} />
            Refresh
          </Button>
        }
      />

      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by PO no., PR no., supplier, organization…"
            className="pl-9 h-9 text-sm"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
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

      <div className="text-xs text-muted-foreground mb-3 tabular-nums">
        {filtered.length} record{filtered.length !== 1 ? "s" : ""}
      </div>

      {filtered.length === 0 ? (
        <div className="border border-border rounded-xl py-16 text-center text-muted-foreground">
          <LayersIcon className="w-8 h-8 mx-auto mb-3 opacity-30" />
          <div className="text-sm font-medium mb-1">No supplier POs found</div>
          <div className="text-xs">
            {pos.length === 0 ? "No Supplier POs recorded across any of your organizations yet." : "No records match your filters."}
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((p) => {
            const snap = p.supplierSnapshot as { name?: string } | null;
            return (
              <div
                key={p.id}
                className="border border-border rounded-xl bg-background hover:bg-muted/20 transition-colors cursor-pointer"
                onClick={() => router.push(`/dashboard/procurement/purchase-order/centralized/${p.id}`)}
              >
                <div className="flex items-center gap-3 px-4 py-3">
                  <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-900/20 shrink-0">
                    <TruckIcon className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-sm font-medium">
                        <Highlight text={p.poNo ?? p.id} query={search} />
                      </span>
                      <StatusBadge status={p.status} />
                      <span className="text-[10px] font-medium text-indigo-700 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/20 rounded px-1.5 py-0.5">
                        <Highlight text={p.organizationName} query={search} />
                      </span>
                      {p.prNo && (
                        <span className="flex items-center gap-1 text-[10px] text-muted-foreground bg-muted/40 rounded px-1.5 py-0.5 font-mono">
                          <ClipboardListIcon className="w-2.5 h-2.5 shrink-0" />
                          <Highlight text={p.prNo} query={search} />
                        </span>
                      )}
                      {!p.canEdit && (
                        <span className="flex items-center gap-1 text-[10px] text-muted-foreground bg-muted/40 rounded px-1.5 py-0.5">
                          <EyeIcon className="w-2.5 h-2.5 shrink-0" /> View only
                        </span>
                      )}
                      <span className="text-[10px] text-muted-foreground bg-muted/50 rounded px-1.5 py-0.5 ml-auto tabular-nums">
                        {fmtDate(p.createdAt)}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                      {snap?.name && (
                        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          <BuildingIcon className="w-3 h-3" />
                          <Highlight text={snap.name} query={search} />
                        </span>
                      )}
                      {p.createdByName && (
                        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          <CalendarIcon className="w-3 h-3" />
                          {p.createdByName}
                        </span>
                      )}
                      {p.canEdit && (
                        <span className="text-[11px] font-semibold text-foreground ml-auto tabular-nums">
                          {fmt(p.grandTotal, p.currency ?? "MYR")}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
