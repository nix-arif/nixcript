"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAppStore } from "@/lib/store/use-app-store";
import type { ConsignmentSummary } from "@/server/consignment";
import { PageHeader } from "@/components/page-header";
import { Input } from "@/components/ui/input";
import { SearchIcon, BuildingIcon, UserIcon, CalendarIcon, PackageIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const fmtDate = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const fmt = (v: string | number | null | undefined) =>
  `RM ${Number(v ?? 0).toLocaleString("en-MY", { minimumFractionDigits: 2 })}`;

const STATUS: Record<string, { label: string; className: string }> = {
  active: { label: "Active",  className: "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400" },
  closed: { label: "Closed",  className: "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400" },
};

interface Props {
  initialConsignments: ConsignmentSummary[];
}

export function ConsignmentListClient({ initialConsignments }: Props) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const { setOrgSwitching } = useAppStore();

  useEffect(() => { setOrgSwitching(false); }, [initialConsignments]);

  const filtered = initialConsignments.filter((c) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      c.consignmentNo.toLowerCase().includes(s) ||
      c.soNo.toLowerCase().includes(s) ||
      c.customerName?.toLowerCase().includes(s) ||
      c.customerOrg?.toLowerCase().includes(s) ||
      c.status.toLowerCase().includes(s)
    );
  });

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-4">
      <PageHeader title="Consignment" description="Stock sent to customers on consignment, tied to Sales Orders" />

      <div className="relative">
        <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <Input
          placeholder="Search by CO no., customer, SO no…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9 h-9"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground text-sm">
          {search ? "No consignments match your search." : "No consignments yet. Create one from a confirmed Sales Order."}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((c) => {
            const st = STATUS[c.status] ?? STATUS.active;
            return (
              <div
                key={c.id}
                onClick={() => router.push(`/dashboard/sales/consignment/${c.id}`)}
                className="cursor-pointer border rounded-lg p-4 hover:bg-muted/40 transition-colors space-y-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm">{c.consignmentNo}</span>
                    <span className={cn("text-[11px] font-medium rounded px-2 py-0.5", st.className)}>{st.label}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">SO: {c.soNo}</span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-1 text-xs text-muted-foreground">
                  {c.customerName && (
                    <span className="flex items-center gap-1">
                      <UserIcon className="h-3 w-3" />
                      {c.customerName}
                    </span>
                  )}
                  {c.customerOrg && (
                    <span className="flex items-center gap-1">
                      <BuildingIcon className="h-3 w-3" />
                      {c.customerOrg}
                    </span>
                  )}
                  <span className="flex items-center gap-1">
                    <PackageIcon className="h-3 w-3" />
                    {c.itemCount} item{c.itemCount !== 1 ? "s" : ""}
                  </span>
                  {c.sentDate && (
                    <span className="flex items-center gap-1">
                      <CalendarIcon className="h-3 w-3" />
                      Sent {fmtDate(c.sentDate)}
                    </span>
                  )}
                </div>

                <div className="text-xs text-muted-foreground">
                  Remaining value: <span className="font-medium text-foreground">{fmt(c.totalValue)}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
