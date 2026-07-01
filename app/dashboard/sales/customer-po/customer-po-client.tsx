"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  getCustomerPos,
  deleteCustomerPo,
  type CustomerPo,
} from "@/server/customer-purchase-order";
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
  UserIcon,
  BuildingIcon,
  LayoutListIcon,
  PackageIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

const fmt = (v: string | number | null | undefined) =>
  `RM ${Number(v ?? 0).toLocaleString("en-MY", { minimumFractionDigits: 2 })}`;

const fmtDate = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const STATUS: Record<string, { label: string; className: string }> = {
  received: { label: "Received", className: "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400" },
  acknowledged: { label: "Acknowledged", className: "bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400" },
  fulfilled: { label: "Fulfilled", className: "bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400" },
  cancelled: { label: "Cancelled", className: "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400" },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS[status] ?? STATUS.received;
  return <span className={cn("text-[11px] font-medium rounded px-2 py-0.5", cfg.className)}>{cfg.label}</span>;
}

export function CustomerPoClient({ initialPos, canCreateSo = false }: { initialPos: CustomerPo[]; canCreateSo?: boolean }) {
  const router = useRouter();
  const [pos, setPos] = useState(initialPos);
  const [search, setSearch] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);

  const filtered = pos.filter((p) => {
    if (!search) return true;
    const s = search.toLowerCase();
    const snap = p.customerSnapshot as any;
    return (
      p.customerPoNo.toLowerCase().includes(s) ||
      snap?.name?.toLowerCase().includes(s) ||
      snap?.organizationName?.toLowerCase().includes(s) ||
      p.quotationNo?.toLowerCase().includes(s) ||
      p.salesOrderNo?.toLowerCase().includes(s)
    );
  });

  async function handleDelete(id: string, poNo: string) {
    if (!confirm(`Delete Customer PO "${poNo}"?`)) return;
    setDeleting(id);
    try {
      await deleteCustomerPo(id);
      setPos(await getCustomerPos());
      toast.success("Customer PO deleted");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="p-6">
      <PageHeader
        title="Customer Purchase Orders"
        description="Track PO documents received from customers"
        action={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="gap-1.5"
              onClick={() => router.push("/dashboard/sales/customer-po/summary")}>
              <LayoutListIcon className="w-3.5 h-3.5" /> Summary table
            </Button>
            <Button onClick={() => router.push("/dashboard/sales/customer-po/create")} className="gap-2">
              <PlusIcon className="w-4 h-4" /> Record customer PO
            </Button>
          </div>
        }
      />

      <div className="relative mb-4">
        <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by PO no., customer, QT no., SO no...."
          className="pl-9 h-9 text-sm"
        />
        {search && (
          <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
            <XIcon className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <div className="text-xs text-muted-foreground mb-3 tabular-nums">
        {filtered.length} record{filtered.length !== 1 ? "s" : ""}
      </div>

      {filtered.length === 0 ? (
        <div className="border border-border rounded-xl py-16 text-center text-muted-foreground">
          <FileTextIcon className="w-8 h-8 mx-auto mb-3 opacity-30" />
          <div className="text-sm font-medium mb-1">No customer POs recorded</div>
          <div className="text-xs mb-4">Record the first customer purchase order</div>
          <Button variant="outline" size="sm" className="gap-2" onClick={() => router.push("/dashboard/sales/customer-po/create")}>
            <PlusIcon className="w-3.5 h-3.5" /> Record customer PO
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((p) => {
            const snap = p.customerSnapshot as any;
            return (
              <div
                key={p.id}
                className="border border-border rounded-xl bg-background hover:bg-muted/20 transition-colors cursor-pointer"
                onClick={() => router.push(`/dashboard/sales/customer-po/${p.id}`)}
              >
                <div className="flex items-center gap-3 px-4 py-3">
                  <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-muted/40 shrink-0">
                    <FileTextIcon className="w-3.5 h-3.5 text-muted-foreground" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-sm font-medium">
                        <Highlight text={p.customerPoNo} query={search} />
                      </span>
                      <StatusBadge status={p.status} />
                      {p.quotationNo && (
                        <span className="text-[10px] bg-muted/50 text-muted-foreground rounded px-1.5 py-0.5 font-mono">
                          QT: <Highlight text={p.quotationNo} query={search} />
                        </span>
                      )}
                      {p.salesOrderNo ? (
                        <span className="text-[10px] bg-muted/50 text-muted-foreground rounded px-1.5 py-0.5 font-mono">
                          SO: <Highlight text={p.salesOrderNo} query={search} />
                        </span>
                      ) : p.status !== "cancelled" && p.status !== "fulfilled" ? (
                        <span className="text-[10px] bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 rounded px-1.5 py-0.5 font-medium">
                          Pending SO
                        </span>
                      ) : null}
                      <span className="text-[10px] text-muted-foreground bg-muted/50 rounded px-1.5 py-0.5 ml-auto tabular-nums">
                        {fmtDate(p.receivedDate ?? p.createdAt)}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                      {snap?.name && (
                        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          <UserIcon className="w-3 h-3" />
                          <Highlight text={snap.name} query={search} />
                        </span>
                      )}
                      {snap?.organizationName && (
                        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          <BuildingIcon className="w-3 h-3" />
                          <Highlight text={snap.organizationName} query={search} />
                        </span>
                      )}
                      <span className="text-[11px] font-semibold text-foreground ml-auto tabular-nums">
                        {fmt(p.amount)} {p.currency !== "MYR" ? p.currency : ""}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                    {canCreateSo && !p.salesOrderId && p.status !== "cancelled" && p.status !== "fulfilled" && (
                      <Button
                        variant="ghost" size="icon" className="w-7 h-7 text-amber-600 dark:text-amber-400 hover:text-amber-700"
                        title="Create Sales Order"
                        onClick={() => router.push(`/dashboard/sales/order/create?cpoId=${p.id}`)}
                      >
                        <PackageIcon className="w-3.5 h-3.5" />
                      </Button>
                    )}
                    <Button
                      variant="ghost" size="icon" className="w-7 h-7"
                      onClick={() => router.push(`/dashboard/sales/customer-po/${p.id}/edit`)}
                    >
                      <PencilIcon className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      variant="ghost" size="icon" className="w-7 h-7 text-destructive hover:text-destructive"
                      disabled={deleting === p.id}
                      onClick={() => handleDelete(p.id, p.customerPoNo)}
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
