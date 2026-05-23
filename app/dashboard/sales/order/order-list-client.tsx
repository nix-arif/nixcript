"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { getSalesOrders, deleteSalesOrder, updateSalesOrderStatus, type SalesOrderRow } from "@/server/sales-order";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/page-header";
import { Highlight } from "@/components/highlight";
import {
  PlusIcon,
  SearchIcon,
  XIcon,
  FileTextIcon,
  PencilIcon,
  TrashIcon,
  BuildingIcon,
  UserIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

const fmt = (v: string | number | null | undefined) =>
  `RM ${Number(v ?? 0).toLocaleString("en-MY", { minimumFractionDigits: 2 })}`;

const fmtDate = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const SO_STATUS: Record<string, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400" },
  confirmed: { label: "Confirmed", className: "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400" },
  fulfilled: { label: "Fulfilled", className: "bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400" },
  cancelled: { label: "Cancelled", className: "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400" },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = SO_STATUS[status] ?? SO_STATUS.draft;
  return (
    <span className={cn("text-[11px] font-medium rounded px-2 py-0.5", cfg.className)}>
      {cfg.label}
    </span>
  );
}

interface Props {
  initialOrders: SalesOrderRow[];
}

export function SalesOrderListClient({ initialOrders }: Props) {
  const router = useRouter();
  const [orders, setOrders] = useState(initialOrders);
  const [search, setSearch] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);

  const filtered = orders.filter((o) => {
    if (!search) return true;
    const s = search.toLowerCase();
    const snap = o.customerSnapshot as any;
    return (
      o.soNo.toLowerCase().includes(s) ||
      snap?.name?.toLowerCase().includes(s) ||
      snap?.organizationName?.toLowerCase().includes(s) ||
      o.salesPersonName?.toLowerCase().includes(s) ||
      o.status.toLowerCase().includes(s)
    );
  });

  async function handleDelete(id: string, soNo: string) {
    if (!confirm(`Delete ${soNo}? This cannot be undone.`)) return;
    setDeleting(id);
    try {
      await deleteSalesOrder(id);
      setOrders(await getSalesOrders());
      toast.success("Sales order deleted");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="p-6 max-w-5xl">
      <PageHeader
        title="Sales Orders"
        description="Track and manage sales orders"
        action={
          <Button onClick={() => router.push("/dashboard/sales/order/create")} className="gap-2">
            <PlusIcon className="w-4 h-4" /> New SO
          </Button>
        }
      />

      <div className="relative mb-4">
        <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by SO no., customer, status..."
          className="pl-9 h-9 text-sm"
        />
        {search && (
          <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
            <XIcon className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <div className="text-xs text-muted-foreground mb-3 tabular-nums">
        {filtered.length} order{filtered.length !== 1 ? "s" : ""}
      </div>

      {filtered.length === 0 ? (
        <div className="border border-border rounded-xl py-16 text-center text-muted-foreground">
          <FileTextIcon className="w-8 h-8 mx-auto mb-3 opacity-30" />
          <div className="text-sm font-medium mb-1">No sales orders yet</div>
          <div className="text-xs mb-4">Create your first sales order to get started</div>
          <Button variant="outline" size="sm" className="gap-2" onClick={() => router.push("/dashboard/sales/order/create")}>
            <PlusIcon className="w-3.5 h-3.5" /> New SO
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((o) => {
            const snap = o.customerSnapshot as any;
            const custName = snap ? [snap.title, snap.name].filter(Boolean).join(" ") : null;
            return (
              <div
                key={o.id}
                className="border border-border rounded-xl bg-background hover:bg-muted/20 transition-colors"
              >
                <div className="flex items-center gap-3 px-4 py-3">
                  <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-muted/40 shrink-0">
                    <FileTextIcon className="w-3.5 h-3.5 text-muted-foreground" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-sm font-medium">
                        <Highlight text={o.soNo} query={search} />
                      </span>
                      <StatusBadge status={o.status} />
                      {o.quotationNo && (
                        <span className="text-[10px] text-muted-foreground bg-muted/50 rounded px-1.5 py-0.5 font-mono">
                          QT: {o.quotationNo}
                        </span>
                      )}
                      <span className="text-[10px] text-muted-foreground bg-muted/50 rounded px-1.5 py-0.5 tabular-nums ml-auto">
                        {fmtDate(o.createdAt)}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                      {custName && (
                        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          <UserIcon className="w-3 h-3" />
                          <Highlight text={custName} query={search} />
                        </span>
                      )}
                      {snap?.organizationName && (
                        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          <BuildingIcon className="w-3 h-3" />
                          <Highlight text={snap.organizationName} query={search} />
                        </span>
                      )}
                      <span className="text-[11px] font-semibold text-foreground ml-auto tabular-nums">
                        {fmt(o.grandTotal)}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="w-7 h-7"
                      onClick={() => router.push(`/dashboard/sales/order/${o.id}/edit`)}
                    >
                      <PencilIcon className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="w-7 h-7 text-destructive hover:text-destructive"
                      disabled={deleting === o.id}
                      onClick={() => handleDelete(o.id, o.soNo)}
                    >
                      <TrashIcon className="w-3.5 h-3.5" />
                    </Button>
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
