"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { deleteInvoice, type InvoiceListRow } from "@/server/invoice";
import { useAppStore } from "@/lib/store/use-app-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/page-header";
import { Highlight } from "@/components/highlight";
import {
  PlusIcon, SearchIcon, XIcon, ReceiptIcon,
  PencilIcon, TrashIcon, UserIcon, BuildingIcon, CalendarIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

const fmtDate = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const fmtMoney = (v: string | null | undefined) =>
  v ? parseFloat(v).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "0.00";

const INV_STATUS: Record<string, { label: string; className: string }> = {
  draft:     { label: "Draft",     className: "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400" },
  sent:      { label: "Sent",      className: "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400" },
  paid:      { label: "Paid",      className: "bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400" },
  overdue:   { label: "Overdue",   className: "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400" },
  cancelled: { label: "Cancelled", className: "bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-500" },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = INV_STATUS[status] ?? INV_STATUS.draft;
  return <span className={cn("text-[11px] font-medium rounded px-2 py-0.5", cfg.className)}>{cfg.label}</span>;
}

function ProfitBadge({ profit }: { profit: string | null | undefined }) {
  const val = parseFloat(profit ?? "0");
  const cls = val >= 0 ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400";
  return <span className={cn("text-[11px] font-mono tabular-nums", cls)}>{val >= 0 ? "+" : ""}{val.toFixed(2)}</span>;
}

const EDITABLE_STATUSES = new Set(["draft"]);
const DELETABLE_STATUSES = new Set(["draft", "cancelled"]);

interface Props {
  initialInvoices: InvoiceListRow[];
  permissions: string[];
  currentUserId: string;
}

export function InvoiceListClient({ initialInvoices, permissions, currentUserId }: Props) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const { isSwitchingOrg, setOrgSwitching } = useAppStore();

  const can = (p: string) => permissions.includes("*") || permissions.includes(p);

  useEffect(() => { setOrgSwitching(false); }, [initialInvoices]);

  const filtered = initialInvoices.filter((inv) => {
    if (!search) return true;
    const s = search.toLowerCase();
    const snap = inv.customerSnapshot as any;
    return (
      inv.invoiceNo.toLowerCase().includes(s) ||
      snap?.name?.toLowerCase().includes(s) ||
      snap?.organizationName?.toLowerCase().includes(s) ||
      inv.salesPersonName?.toLowerCase().includes(s) ||
      inv.customerPoNo?.toLowerCase().includes(s) ||
      inv.salesOrderNo?.toLowerCase().includes(s) ||
      inv.status.toLowerCase().includes(s) ||
      inv.createdByName?.toLowerCase().includes(s)
    );
  });

  async function handleDelete(id: string, invoiceNo: string) {
    if (!confirm(`Delete ${invoiceNo}? This cannot be undone.`)) return;
    setDeleting(id);
    try {
      await deleteInvoice(id);
      toast.success("Invoice deleted");
      router.refresh();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="p-6">
      <PageHeader
        title="Invoices"
        description="Tax invoices and billing records"
        action={
          can("invoice:create") && (
            <Button onClick={() => router.push("/dashboard/fulfillment/invoice/create")} className="gap-2">
              <PlusIcon className="w-4 h-4" /> New Invoice
            </Button>
          )
        }
      />

      <div className="relative mb-4">
        <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by invoice no., customer, SO, status..."
          className="pl-9 h-9 text-sm"
        />
        {search && (
          <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
            <XIcon className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

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
          <div className="text-xs text-muted-foreground mb-3 tabular-nums">0 invoices</div>
          <div className="border border-border rounded-xl py-16 text-center text-muted-foreground">
            <ReceiptIcon className="w-8 h-8 mx-auto mb-3 opacity-30" />
            <div className="text-sm font-medium mb-1">No invoices yet</div>
            <div className="text-xs mb-4">Create your first invoice to get started</div>
            {can("invoice:create") && (
              <Button variant="outline" size="sm" className="gap-2" onClick={() => router.push("/dashboard/fulfillment/invoice/create")}>
                <PlusIcon className="w-3.5 h-3.5" /> New Invoice
              </Button>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="text-xs text-muted-foreground mb-3 tabular-nums">
            {filtered.length} invoice{filtered.length !== 1 ? "s" : ""}
          </div>
          <div className="space-y-2">
            {filtered.map((inv) => {
              const snap = inv.customerSnapshot as any;
              return (
                <div
                  key={inv.id}
                  className="border border-border rounded-xl bg-background hover:bg-muted/20 transition-colors cursor-pointer"
                  onClick={() => router.push(`/dashboard/fulfillment/invoice/${inv.id}`)}
                >
                  <div className="flex items-center gap-3 px-4 py-3">
                    <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-muted/40 shrink-0">
                      <ReceiptIcon className="w-3.5 h-3.5 text-muted-foreground" />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-sm font-medium">
                          <Highlight text={inv.invoiceNo} query={search} />
                        </span>
                        <StatusBadge status={inv.status} />
                        {inv.customerPoNo && (
                          <span className="text-[10px] bg-muted/50 text-muted-foreground rounded px-1.5 py-0.5 font-mono">
                            PO: <Highlight text={inv.customerPoNo} query={search} />
                          </span>
                        )}
                        {inv.salesOrderNo && (
                          <span className="text-[10px] bg-muted/50 text-muted-foreground rounded px-1.5 py-0.5 font-mono">
                            SO: <Highlight text={inv.salesOrderNo} query={search} />
                          </span>
                        )}
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
                        <span className="text-[11px] text-muted-foreground ml-auto flex items-center gap-2">
                          <span className="font-mono tabular-nums font-semibold text-foreground">MYR {fmtMoney(inv.grandTotal)}</span>
                          <span className="text-[10px] text-muted-foreground/60">profit</span>
                          <ProfitBadge profit={inv.profit} />
                        </span>
                      </div>
                      <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                        {inv.createdByName && (
                          <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                            <CalendarIcon className="w-3 h-3" />
                            {fmtDate(inv.createdAt)} · {inv.createdByName}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                      {can("invoice:update") && EDITABLE_STATUSES.has(inv.status) && inv.createdBy === currentUserId && (
                        <Button variant="ghost" size="icon" className="w-7 h-7"
                          onClick={() => router.push(`/dashboard/fulfillment/invoice/${inv.id}/edit`)}>
                          <PencilIcon className="w-3.5 h-3.5" />
                        </Button>
                      )}
                      {can("invoice:delete") && DELETABLE_STATUSES.has(inv.status) && inv.createdBy === currentUserId && (
                        <Button variant="ghost" size="icon" className="w-7 h-7 text-destructive hover:text-destructive"
                          disabled={deleting === inv.id} onClick={() => handleDelete(inv.id, inv.invoiceNo)}>
                          <TrashIcon className="w-3.5 h-3.5" />
                        </Button>
                      )}
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
