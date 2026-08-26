"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { type PackingListListRow, type PendingPackingListPo } from "@/server/packing-list";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/page-header";
import { Highlight } from "@/components/highlight";
import { PlusIcon, SearchIcon, XIcon, ClipboardCheckIcon, BuildingIcon, CalendarIcon, PackageIcon, AlertCircleIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const fmtDate = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const STATUS: Record<string, { label: string; className: string }> = {
  pending:   { label: "Pending Inspection", className: "bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400" },
  completed: { label: "Completed",          className: "bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400" },
  cancelled: { label: "Cancelled",          className: "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400" },
};

interface Props {
  initialLists: PackingListListRow[];
  pendingPos: PendingPackingListPo[];
  permissions: string[];
}

export function PackingListListClient({ initialLists, pendingPos, permissions }: Props) {
  const router = useRouter();
  const [search, setSearch] = useState("");

  const can = (p: string) => permissions.includes("*") || permissions.includes(p);

  const filtered = initialLists.filter((pl) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      pl.packingListNo.toLowerCase().includes(s) ||
      (pl.supplierRefNo ?? "").toLowerCase().includes(s) ||
      (pl.supplierName ?? "").toLowerCase().includes(s)
    );
  });

  return (
    <div className="p-6">
      <PageHeader
        title="Packing Lists"
        description="Pre-receipt manifests of what a supplier says they're shipping — inspect once goods arrive"
        action={
          can("packing-list:create") && (
            <Button onClick={() => router.push("/dashboard/procurement/packing-list/create")} className="gap-2">
              <PlusIcon className="w-4 h-4" /> New Packing List
            </Button>
          )
        }
      />

      {pendingPos.length > 0 && (
        <div className="mb-5 border border-amber-200 dark:border-amber-800/50 bg-amber-50/50 dark:bg-amber-950/15 rounded-xl p-4">
          <div className="flex items-center gap-1.5 mb-3">
            <AlertCircleIcon className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
            <h2 className="text-xs font-semibold text-amber-800 dark:text-amber-300 uppercase tracking-wide">
              Pending Packing List Creation <span className="font-normal normal-case">({pendingPos.length} confirmed PO{pendingPos.length !== 1 ? "s" : ""} not yet packed)</span>
            </h2>
          </div>
          <div className="space-y-2">
            {pendingPos.map((po) => (
              <div
                key={po.purchaseOrderId}
                className="flex items-center justify-between gap-3 border border-amber-200/70 dark:border-amber-800/40 bg-background rounded-lg px-3 py-2"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <button
                    className="font-mono text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline shrink-0"
                    onClick={() => router.push(`/dashboard/procurement/purchase-order/${po.purchaseOrderId}`)}
                  >
                    {po.poNo ?? po.prNo ?? po.purchaseOrderId}
                  </button>
                  {po.supplierName && (
                    <span className="flex items-center gap-1 text-[11px] text-muted-foreground truncate">
                      <BuildingIcon className="w-3 h-3 shrink-0" />
                      {po.supplierName}
                    </span>
                  )}
                  <span className="text-[11px] text-muted-foreground shrink-0">
                    {po.itemsRemaining} item{po.itemsRemaining !== 1 ? "s" : ""} remaining
                  </span>
                </div>
                {can("packing-list:create") && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5 h-7 text-xs shrink-0"
                    onClick={() => router.push(`/dashboard/procurement/packing-list/create${po.supplierId ? `?supplierId=${po.supplierId}` : ""}`)}
                  >
                    <PlusIcon className="w-3 h-3" /> Create Packing List
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="relative mb-4">
        <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by packing list no., supplier ref, or supplier…"
          className="pl-9 h-9 text-sm"
        />
        {search && (
          <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
            <XIcon className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <>
          <div className="text-xs text-muted-foreground mb-3 tabular-nums">0 records</div>
          <div className="border border-border rounded-xl py-16 text-center text-muted-foreground">
            <ClipboardCheckIcon className="w-8 h-8 mx-auto mb-3 opacity-30" />
            <div className="text-sm font-medium mb-1">
              {search ? "No packing lists match your search" : "No packing lists yet"}
            </div>
            <div className="text-xs mb-4">
              {search ? "Try a different search term" : "Create one when a supplier tells you what they're shipping"}
            </div>
            {!search && can("packing-list:create") && (
              <Button variant="outline" size="sm" className="gap-2" onClick={() => router.push("/dashboard/procurement/packing-list/create")}>
                <PlusIcon className="w-3.5 h-3.5" /> New Packing List
              </Button>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="text-xs text-muted-foreground mb-3 tabular-nums">
            {filtered.length} record{filtered.length !== 1 ? "s" : ""}
          </div>
          <div className="space-y-2">
            {filtered.map((pl) => {
              const status = STATUS[pl.status] ?? { label: pl.status, className: "bg-muted text-muted-foreground" };
              return (
                <div
                  key={pl.id}
                  className="border border-border rounded-xl bg-background hover:bg-muted/20 transition-colors cursor-pointer"
                  onClick={() => router.push(`/dashboard/procurement/packing-list/${pl.id}`)}
                >
                  <div className="flex items-center gap-3 px-4 py-3">
                    <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-teal-50 dark:bg-teal-900/20 shrink-0">
                      <ClipboardCheckIcon className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-sm font-medium">
                          <Highlight text={pl.packingListNo} query={search} />
                        </span>
                        <span className={cn("text-[10px] font-medium rounded px-2 py-0.5", status.className)}>{status.label}</span>
                        {pl.supplierRefNo && (
                          <span className="text-[10px] text-muted-foreground bg-muted/50 rounded px-1.5 py-0.5 font-mono">
                            <Highlight text={pl.supplierRefNo} query={search} />
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                        {pl.supplierName && (
                          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                            <BuildingIcon className="w-3 h-3" />
                            <Highlight text={pl.supplierName} query={search} />
                          </span>
                        )}
                        {pl.itemCount > 0 && (
                          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                            <PackageIcon className="w-3 h-3" />
                            {pl.itemCount} item{pl.itemCount !== 1 ? "s" : ""}
                          </span>
                        )}
                        {pl.expectedDate && (
                          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                            <CalendarIcon className="w-3 h-3" />
                            Expected {fmtDate(pl.expectedDate)}
                          </span>
                        )}
                      </div>
                    </div>
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
