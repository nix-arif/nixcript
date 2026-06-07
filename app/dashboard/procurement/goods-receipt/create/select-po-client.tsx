"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { type ConfirmedPoForGr } from "@/server/goods-receipt";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/page-header";
import {
  SearchIcon,
  XIcon,
  TruckIcon,
  BuildingIcon,
  CalendarIcon,
  ChevronRightIcon,
  PackageIcon,
} from "lucide-react";
import Link from "next/link";

const fmtDate = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" }) : null;

const fmtCurrency = (amount: string, currency: string) =>
  new Intl.NumberFormat("en-MY", { style: "currency", currency, minimumFractionDigits: 2 }).format(
    parseFloat(amount) || 0,
  );

interface Props {
  confirmedPos: ConfirmedPoForGr[];
}

export function SelectPoClient({ confirmedPos }: Props) {
  const router = useRouter();
  const [search, setSearch] = useState("");

  const filtered = confirmedPos.filter((po) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      (po.poNo ?? "").toLowerCase().includes(s) ||
      (po.prNo ?? "").toLowerCase().includes(s) ||
      (po.supplierName ?? "").toLowerCase().includes(s)
    );
  });

  return (
    <div className="p-6">
      <PageHeader
        title="New Goods Receipt"
        description="Select a purchase order to record a delivery against"
        action={
          <Button variant="outline" asChild>
            <Link href="/dashboard/procurement/goods-receipt">Cancel</Link>
          </Button>
        }
      />

      <div className="relative mb-4">
        <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by PO no., PR no., or supplier…"
          className="pl-9 h-9 text-sm"
          autoFocus
        />
        {search && (
          <button
            onClick={() => setSearch("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          >
            <XIcon className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="border border-border rounded-xl py-16 text-center text-muted-foreground">
          <TruckIcon className="w-8 h-8 mx-auto mb-3 opacity-30" />
          <div className="text-sm font-medium mb-1">
            {search ? "No purchase orders match your search" : "No confirmed purchase orders"}
          </div>
          <div className="text-xs">
            {search
              ? "Try a different search term"
              : "Purchase orders must be approved and confirmed before a goods receipt can be recorded"}
          </div>
        </div>
      ) : (
        <>
          <div className="text-xs text-muted-foreground mb-3 tabular-nums">
            {filtered.length} purchase order{filtered.length !== 1 ? "s" : ""} awaiting goods receipt
          </div>
          <div className="space-y-2">
            {filtered.map((po) => {
              const docNo = po.poNo ?? po.prNo ?? po.id;
              const deliveryDate = fmtDate(po.expectedDeliveryDate);
              return (
                <button
                  key={po.id}
                  className="w-full text-left border border-border rounded-xl bg-background hover:bg-muted/20 transition-colors"
                  onClick={() =>
                    router.push(`/dashboard/procurement/purchase-order/${po.id}/goods-receipt/create`)
                  }
                >
                  <div className="flex items-center gap-3 px-4 py-3">
                    <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-900/20 shrink-0">
                      <TruckIcon className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-sm font-medium">{docNo}</span>
                        {po.grCount > 0 && (
                          <span className="text-[10px] bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800 rounded px-1.5 py-0.5">
                            {po.grCount} receipt{po.grCount !== 1 ? "s" : ""} recorded
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                        {po.supplierName && (
                          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                            <BuildingIcon className="w-3 h-3" />
                            {po.supplierName}
                          </span>
                        )}
                        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          <PackageIcon className="w-3 h-3" />
                          {fmtCurrency(po.grandTotal, po.currency)}
                        </span>
                        {deliveryDate && (
                          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                            <CalendarIcon className="w-3 h-3" />
                            Expected {deliveryDate}
                          </span>
                        )}
                      </div>
                    </div>

                    <ChevronRightIcon className="w-4 h-4 text-muted-foreground shrink-0" />
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
