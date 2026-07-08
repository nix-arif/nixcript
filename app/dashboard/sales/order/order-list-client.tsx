"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAppStore } from "@/lib/store/use-app-store";
import { toast } from "sonner";
import { deleteSalesOrder, type SalesOrderListRow } from "@/server/sales-order";
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
  CalendarIcon,
  UserIcon,
  BuildingIcon,
  PackageIcon,
} from "lucide-react";
import { type CustomerPoSearchResult } from "@/server/customer-purchase-order";

import { cn } from "@/lib/utils";

const fmt = (v: string | number | null | undefined) =>
  `RM ${Number(v ?? 0).toLocaleString("en-MY", { minimumFractionDigits: 2 })}`;

const fmtDate = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const SO_STATUS: Record<string, { label: string; className: string; accent: string }> = {
  "pending-do": { label: "Pending DO",        className: "bg-teal-50 dark:bg-teal-900/20 text-teal-700 dark:text-teal-400",     accent: "bg-teal-500" },
  "pending-pr": { label: "Pending PR",        className: "bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-400", accent: "bg-orange-400" },
  draft:        { label: "Draft",             className: "bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400",   accent: "bg-amber-400" },
  submitted:    { label: "Awaiting Approval", className: "bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-400", accent: "bg-purple-400" },
  confirmed:    { label: "Confirmed",         className: "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400",       accent: "bg-blue-400" },
  fulfilled:    { label: "Fulfilled",         className: "bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400",   accent: "bg-green-500" },
  cancelled:    { label: "Cancelled",         className: "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400",           accent: "bg-red-400" },
};

const EDITABLE_STATUSES  = new Set(["draft", "pending-do", "pending-pr"]);
const DELETABLE_STATUSES = new Set(["draft", "pending-do", "pending-pr", "cancelled"]);

function StatusBadge({ status }: { status: string }) {
  const cfg = SO_STATUS[status] ?? SO_STATUS.draft;
  return (
    <span className={cn("text-[11px] font-medium rounded px-2 py-0.5", cfg.className)}>
      {cfg.label}
    </span>
  );
}

interface Props {
  initialOrders: SalesOrderListRow[];
  permissions: string[];
  currentUserId: string;
  pendingCpos?: CustomerPoSearchResult[];
}

export function SalesOrderListClient({ initialOrders, permissions, currentUserId, pendingCpos = [] }: Props) {
  const can = (p: string) => permissions.includes("*") || permissions.includes(p);
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const [selectedCpos, setSelectedCpos] = useState<Set<string>>(new Set());

  function toggleCpo(id: string) {
    setSelectedCpos((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleAllCpos() {
    setSelectedCpos((prev) =>
      prev.size === pendingCpos.length ? new Set() : new Set(pendingCpos.map((c) => c.id))
    );
  }

  function createSoFromSelected() {
    const ids = [...selectedCpos];
    const params = ids.map((id) => `cpoId=${id}`).join("&");
    router.push(`/dashboard/sales/order/create?${params}`);
  }
  const { isSwitchingOrg, setOrgSwitching } = useAppStore();

  // Clear the switching flag once the server has delivered fresh data for the new org
  useEffect(() => {
    setOrgSwitching(false);
  }, [initialOrders]);

  const filtered = initialOrders.filter((o) => {
    if (!search) return true;
    const s = search.toLowerCase();
    const snap = o.customerSnapshot as any;
    const cpoTerms = o.cpoCustomers.flatMap((c) => {
      const cs = c.customerSnapshot;
      return cs ? [cs.name, cs.organizationName, cs.title].filter(Boolean) as string[] : [];
    });
    return (
      o.soNo.toLowerCase().includes(s) ||
      snap?.name?.toLowerCase().includes(s) ||
      snap?.organizationName?.toLowerCase().includes(s) ||
      cpoTerms.some((t) => t.toLowerCase().includes(s)) ||
      o.salesPersonName?.toLowerCase().includes(s) ||
      o.status.toLowerCase().includes(s)
    );
  });

  async function handleDelete(id: string, soNo: string) {
    if (!confirm(`Delete ${soNo}? This cannot be undone.`)) return;
    setDeleting(id);
    try {
      await deleteSalesOrder(id);
      toast.success("Sales order deleted");
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

      {pendingCpos.length > 0 && can("sales-order:create") && (
        <div className="mb-5 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20 overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-amber-200 dark:border-amber-800">
            <input
              type="checkbox"
              checked={selectedCpos.size === pendingCpos.length}
              ref={(el) => { if (el) el.indeterminate = selectedCpos.size > 0 && selectedCpos.size < pendingCpos.length; }}
              onChange={toggleAllCpos}
              className="w-3.5 h-3.5 rounded accent-amber-600 cursor-pointer"
            />
            <PackageIcon className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
            <span className="text-xs font-semibold text-amber-700 dark:text-amber-400 flex-1">
              Pending SO — {pendingCpos.length} CPO{pendingCpos.length !== 1 ? "s" : ""} awaiting Sales Order
            </span>
            {selectedCpos.size > 0 && (
              <Button
                size="sm"
                className="h-7 text-xs gap-1.5 shrink-0 bg-amber-600 hover:bg-amber-700 text-white"
                onClick={createSoFromSelected}
              >
                <PlusIcon className="w-3 h-3" /> Create SO ({selectedCpos.size})
              </Button>
            )}
          </div>
          <div className="divide-y divide-amber-100 dark:divide-amber-900">
            {pendingCpos.map((cpo) => {
              const snap = cpo.customerSnapshot;
              const checked = selectedCpos.has(cpo.id);
              return (
                <div
                  key={cpo.id}
                  className={cn("flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors", checked ? "bg-amber-100/60 dark:bg-amber-900/30" : "hover:bg-amber-50 dark:hover:bg-amber-950/30")}
                  onClick={() => toggleCpo(cpo.id)}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleCpo(cpo.id)}
                    onClick={(e) => e.stopPropagation()}
                    className="w-3.5 h-3.5 rounded accent-amber-600 cursor-pointer shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <span className="font-mono text-sm font-medium text-foreground">{cpo.customerPoNo}</span>
                    {snap?.name && (
                      <span className="ml-2 text-[11px] text-muted-foreground">
                        <UserIcon className="w-3 h-3 inline mr-0.5" />{snap.title ? `${snap.title} ` : ""}{snap.name}
                      </span>
                    )}
                    {snap?.organizationName && (
                      <span className="ml-2 text-[11px] text-muted-foreground">
                        <BuildingIcon className="w-3 h-3 inline mr-0.5" />{snap.organizationName}
                      </span>
                    )}
                  </div>
                  <span className="text-[11px] tabular-nums font-semibold text-foreground shrink-0">
                    RM {Number(cpo.amount).toLocaleString("en-MY", { minimumFractionDigits: 2 })}
                  </span>
                  {!checked && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs gap-1.5 shrink-0 border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/30"
                      onClick={(e) => { e.stopPropagation(); router.push(`/dashboard/sales/order/create?cpoId=${cpo.id}`); }}
                    >
                      <PlusIcon className="w-3 h-3" /> Create SO
                    </Button>
                  )}
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
                  <div className="flex items-center gap-2">
                    <div className="h-3.5 w-28 bg-muted rounded" />
                    <div className="h-3.5 w-16 bg-muted rounded" />
                  </div>
                  <div className="h-3 w-48 bg-muted rounded" />
                  <div className="h-3 w-36 bg-muted rounded" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <>
          <div className="text-xs text-muted-foreground mb-3 tabular-nums">0 orders</div>
          <div className="border border-border rounded-xl py-16 text-center text-muted-foreground">
          <FileTextIcon className="w-8 h-8 mx-auto mb-3 opacity-30" />
          <div className="text-sm font-medium mb-1">No sales orders yet</div>
          <div className="text-xs mb-4">Create your first sales order to get started</div>
          <Button variant="outline" size="sm" className="gap-2" onClick={() => router.push("/dashboard/sales/order/create")}>
            <PlusIcon className="w-3.5 h-3.5" /> New SO
          </Button>
        </div>
        </>
      ) : (
        <>
          <div className="text-xs text-muted-foreground mb-3 tabular-nums">
            {filtered.length} order{filtered.length !== 1 ? "s" : ""}
          </div>
          <div className="space-y-2">
          {filtered.map((o) => {
            const snap = o.customerSnapshot as any;

            // Build deduplicated customer list from CPO links, fall back to SO snapshot
            const seen = new Set<string>();
            const customers: { label: string; person: string | null }[] = (
              o.cpoCustomers.length > 0
                ? o.cpoCustomers.map((c) => ({
                    label: c.customerSnapshot?.organizationName ?? (c.customerSnapshot ? [c.customerSnapshot.title, c.customerSnapshot.name].filter(Boolean).join(" ") : ""),
                    person: c.customerSnapshot ? [c.customerSnapshot.title, c.customerSnapshot.name].filter(Boolean).join(" ") : null,
                  }))
                : [{ label: snap?.organizationName ?? (snap ? [snap.title, snap.name].filter(Boolean).join(" ") : ""), person: snap ? [snap.title, snap.name].filter(Boolean).join(" ") : null }]
            ).filter((c) => {
              if (!c.label || seen.has(c.label)) return false;
              seen.add(c.label);
              return true;
            });

            const accentColor = SO_STATUS[o.status]?.accent ?? "bg-muted";

            const uniquePersons = [...new Set(
              customers
                .filter((c) => c.person && c.person !== c.label)
                .map((c) => c.person as string)
            )];

            return (
              <div
                key={o.id}
                className="flex overflow-hidden rounded-xl border border-border bg-background hover:bg-muted/20 transition-colors cursor-pointer"
                onClick={() => router.push(`/dashboard/sales/order/${o.id}`)}
              >
                {/* Status accent stripe */}
                <div className={`w-1 shrink-0 ${accentColor}`} />

                <div className="flex-1 min-w-0 px-4 py-3">
                  {/* Row 1: SO number + status + amount */}
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-mono text-sm font-semibold tracking-tight">
                        <Highlight text={o.soNo} query={search} />
                      </span>
                      <StatusBadge status={o.status} />
                      {o.soType === "proforma" && (
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-400 capitalize hidden sm:inline">
                          {o.proformaReason ?? "Pro-forma"}
                        </span>
                      )}
                      {o.soType === "urgent" && (
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 hidden sm:inline">
                          Urgent
                        </span>
                      )}
                      {o.quotationNo && (
                        <span className="text-[10px] text-muted-foreground bg-muted/60 rounded px-1.5 py-0.5 font-mono hidden sm:inline">
                          QT: {o.quotationNo}
                        </span>
                      )}
                    </div>
                    <span className="text-sm font-semibold tabular-nums shrink-0">
                      {fmt(o.grandTotal)}
                    </span>
                  </div>

                  {/* Row 2: Customer orgs + persons */}
                  {customers.length > 0 && (
                    <div className="mt-1.5 flex flex-col gap-0.5">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <BuildingIcon className="w-3 h-3 text-muted-foreground shrink-0" />
                        <p className="text-[12px] font-medium text-foreground/80 truncate">
                          {customers.map((c, i) => (
                            <span key={i}>
                              {i > 0 && <span className="text-muted-foreground mx-1.5">·</span>}
                              <Highlight text={c.label} query={search} />
                            </span>
                          ))}
                        </p>
                      </div>
                      {uniquePersons.length > 0 && (
                        <div className="flex items-center gap-1.5 min-w-0">
                          <UserIcon className="w-3 h-3 text-muted-foreground shrink-0" />
                          <p className="text-[11px] text-muted-foreground truncate">
                            {uniquePersons.map((p, i) => (
                              <span key={i}>
                                {i > 0 && <span className="mx-1.5">·</span>}
                                <Highlight text={p} query={search} />
                              </span>
                            ))}
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Row 3: Date · Creator · Sales person */}
                  <div className="flex items-center justify-between mt-1.5">
                    <div className="flex items-center gap-3 flex-wrap">
                      {o.createdByName && (
                        <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                          <CalendarIcon className="w-3 h-3" />
                          {fmtDate(o.createdAt)} · {o.createdByName}
                        </span>
                      )}
                      {o.salesPersonName && (
                        <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                          <UserIcon className="w-3 h-3" />
                          {o.salesPersonName}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                      {can("sales-order:update") && EDITABLE_STATUSES.has(o.status) && o.createdBy === currentUserId && (
                        <Button variant="ghost" size="icon" className="w-7 h-7"
                          onClick={() => router.push(`/dashboard/sales/order/${o.id}/edit`)}>
                          <PencilIcon className="w-3.5 h-3.5" />
                        </Button>
                      )}
                      {can("sales-order:delete") && DELETABLE_STATUSES.has(o.status) && o.createdBy === currentUserId && (
                        <Button variant="ghost" size="icon" className="w-7 h-7 text-destructive hover:text-destructive"
                          disabled={deleting === o.id}
                          onClick={() => handleDelete(o.id, o.soNo)}>
                          <TrashIcon className="w-3.5 h-3.5" />
                        </Button>
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
