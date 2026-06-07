"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { type GoodsReceiptListRow } from "@/server/goods-receipt";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/page-header";
import { Highlight } from "@/components/highlight";
import {
  PlusIcon, SearchIcon, XIcon,
  TruckIcon, BuildingIcon, CalendarIcon, PackageIcon,
} from "lucide-react";

const fmtDate = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" }) : "—";

interface Props {
  initialGrs: GoodsReceiptListRow[];
  permissions: string[];
}

export function GoodsReceiptListClient({ initialGrs, permissions }: Props) {
  const router = useRouter();
  const [search, setSearch] = useState("");

  const can = (p: string) => permissions.includes("*") || permissions.includes(p);

  const filtered = initialGrs.filter((gr) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      gr.grNo.toLowerCase().includes(s) ||
      (gr.poNo ?? "").toLowerCase().includes(s) ||
      (gr.prNo ?? "").toLowerCase().includes(s) ||
      (gr.supplierName ?? "").toLowerCase().includes(s) ||
      (gr.receivedByName ?? "").toLowerCase().includes(s)
    );
  });

  return (
    <div className="p-6">
      <PageHeader
        title="Goods Receipts"
        description="Record and track all supplier deliveries against purchase orders"
        action={
          can("purchase-order:update") && (
            <Button
              onClick={() => router.push("/dashboard/procurement/goods-receipt/create")}
              className="gap-2"
            >
              <PlusIcon className="w-4 h-4" /> New Goods Receipt
            </Button>
          )
        }
      />

      <div className="relative mb-4">
        <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by GR no., PO no., supplier…"
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
            <TruckIcon className="w-8 h-8 mx-auto mb-3 opacity-30" />
            <div className="text-sm font-medium mb-1">
              {search ? "No goods receipts match your search" : "No goods receipts yet"}
            </div>
            <div className="text-xs mb-4">
              {search ? "Try a different search term" : "Record a receipt when goods arrive from a supplier"}
            </div>
            {!search && can("purchase-order:update") && (
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() => router.push("/dashboard/procurement/goods-receipt/create")}
              >
                <PlusIcon className="w-3.5 h-3.5" /> New Goods Receipt
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
            {filtered.map((gr) => (
              <div
                key={gr.id}
                className="border border-border rounded-xl bg-background hover:bg-muted/20 transition-colors cursor-pointer"
                onClick={() => router.push(`/dashboard/procurement/purchase-order/${gr.purchaseOrderId}/goods-receipt/${gr.id}`)}
              >
                <div className="flex items-center gap-3 px-4 py-3">
                  <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-green-50 dark:bg-green-900/20 shrink-0">
                    <TruckIcon className="w-3.5 h-3.5 text-green-600 dark:text-green-400" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-sm font-medium">
                        <Highlight text={gr.grNo} query={search} />
                      </span>
                      {(gr.poNo ?? gr.prNo) && (
                        <span className="text-[10px] text-muted-foreground bg-muted/50 rounded px-1.5 py-0.5 font-mono">
                          <Highlight text={gr.poNo ?? gr.prNo ?? ""} query={search} />
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                      {gr.supplierName && (
                        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          <BuildingIcon className="w-3 h-3" />
                          <Highlight text={gr.supplierName} query={search} />
                        </span>
                      )}
                      {gr.itemCount > 0 && (
                        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          <PackageIcon className="w-3 h-3" />
                          {gr.itemCount} item{gr.itemCount !== 1 ? "s" : ""}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-3 mt-0.5">
                      <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                        <CalendarIcon className="w-3 h-3" />
                        Received {fmtDate(gr.receivedDate)}
                        {gr.receivedByName && <> · {gr.receivedByName}</>}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
