"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useEffect, useState } from "react";
import {
  deleteSalesOrder,
  submitSalesOrder,
  approveSalesOrder,
  rejectSalesOrder,
  recallSalesOrder,
  toggleSoItemPrExcluded,
  type SalesOrderWithItems,
} from "@/server/sales-order";
import {
  checkAndReserveStock,
  getStockInsight,
  type StockCheckResult,
} from "@/server/stock-reservation";
import { type QuotationBasic } from "@/server/quotation";
import { type PrListRow } from "@/server/purchase-requisition";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import {
  ArrowLeftIcon, PencilIcon, TrashIcon,
  UserIcon, BuildingIcon, CalendarIcon, MapPinIcon,
  FileTextIcon, PackageIcon, CheckIcon, XIcon, RotateCcwIcon, SendIcon, ClockIcon,
  PrinterIcon, ShoppingCartIcon, WarehouseIcon, AlertTriangleIcon, CheckCircle2Icon,
  Loader2Icon, TruckIcon, LinkIcon, PlusIcon, DatabaseIcon, BanIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

const fmt = (v: string | number | null | undefined) =>
  `RM ${Number(v ?? 0).toLocaleString("en-MY", { minimumFractionDigits: 2 })}`;

const fmtDate = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const SO_STATUS: Record<string, { label: string; className: string }> = {
  draft:     { label: "Draft",      className: "bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400" },
  submitted: { label: "Awaiting Approval",  className: "bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-400" },
  confirmed: { label: "Confirmed",  className: "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400" },
  fulfilled: { label: "Fulfilled",  className: "bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400" },
  cancelled: { label: "Cancelled",  className: "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400" },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = SO_STATUS[status] ?? SO_STATUS.draft;
  return <span className={cn("text-[11px] font-medium rounded px-2 py-0.5", cfg.className)}>{cfg.label}</span>;
}

const QT_STATUS: Record<string, { label: string; className: string }> = {
  draft:     { label: "Draft",     className: "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400" },
  final:     { label: "Final",     className: "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400" },
  approved:  { label: "Approved",  className: "bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400" },
  published: { label: "Published", className: "bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-400" },
};

export function SalesOrderDetailClient({
  order,
  linkedQuotation,
  linkedDos,
  linkedPrs,
  permissions,
  currentUserId,
  draftRedirected,
}: {
  order: SalesOrderWithItems;
  linkedQuotation: QuotationBasic | null;
  linkedDos: { id: string; doNo: string; customerPoId: string | null; customerPoNo: string | null; status: string }[];
  linkedPrs: PrListRow[];
  permissions: string[];
  currentUserId: string;
  draftRedirected?: boolean;
}) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [status, setStatus] = useState(order.status ?? "draft");
  const [actioning, setActioning] = useState<"submit" | "approve" | "reject" | "recall" | null>(null);
  const [rechecking, setRechecking] = useState(false);
  const [insight, setInsight] = useState<StockCheckResult | null>(null);
  const [insightLoading, setInsightLoading] = useState(false);
  const [stockStatus, setStockStatus] = useState<string | null>(order.stockReservationStatus ?? null);
  const [prExcludedItems, setPrExcludedItems] = useState<Set<string>>(
    () => new Set(order.items.filter((i) => (i as any).prExcluded).map((i) => i.id)),
  );
  const [togglingPrExclude, setTogglingPrExclude] = useState<string | null>(null);

  // Sync with server-refreshed prop
  useEffect(() => {
    setStatus(order.status ?? "draft");
    setStockStatus(order.stockReservationStatus ?? null);
  }, [order.status, order.stockReservationStatus]);

  // Read-only stock insight for confirmed orders
  useEffect(() => {
    if (status !== "confirmed" || !can("delivery-order:create")) return;
    let cancelled = false;
    setInsightLoading(true);
    getStockInsight(order.id)
      .then((r) => { if (!cancelled) setInsight(r); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setInsightLoading(false); });
    return () => { cancelled = true; };
  }, [order.id, status, stockStatus]);

  const can = (p: string) => permissions.includes("*") || permissions.includes(p);
  const isOwner = order.createdBy === currentUserId;

  const snap = order.customerSnapshot as any;
  const custName = snap ? [snap.title, snap.name].filter(Boolean).join(" ") : null;

  // Build deduplicated customer entries from CPO links, fall back to SO snapshot
  const seen = new Set<string>();
  const cpoCustomerEntries = (
    order.cpoCustomers.length > 0
      ? order.cpoCustomers.map((c) => ({
          label: c.customerSnapshot?.organizationName ?? (c.customerSnapshot ? [c.customerSnapshot.title, c.customerSnapshot.name].filter(Boolean).join(" ") : ""),
          person: c.customerSnapshot ? [c.customerSnapshot.title, c.customerSnapshot.name].filter(Boolean).join(" ") : null,
          address: null as string | null,
        }))
      : custName
        ? [{ label: snap?.organizationName ?? custName, person: custName, address: snap?.organizationAddress ?? null }]
        : []
  ).filter((c) => {
    if (!c.label || seen.has(c.label)) return false;
    seen.add(c.label);
    return true;
  });

  async function handleDelete() {
    if (!confirm(`Delete ${order.soNo}? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await deleteSalesOrder(order.id);
      toast.success("Sales order deleted");
      router.push("/dashboard/sales/order");
    } catch (e: any) {
      toast.error(e.message);
      setDeleting(false);
    }
  }

  async function handleSubmit() {
    setActioning("submit");
    try {
      await submitSalesOrder(order.id);
      toast.success("Sales order sent for approval");
      router.refresh();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setActioning(null);
    }
  }

  async function handleApprove() {
    setActioning("approve");
    try {
      await approveSalesOrder(order.id);
      toast.success("Sales order approved");
      router.refresh();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setActioning(null);
    }
  }

  async function handleReject() {
    if (!confirm(`Reject ${order.soNo}? This will return it to draft for revision.`)) return;
    setActioning("reject");
    try {
      await rejectSalesOrder(order.id);
      toast.success("Sales order returned for revision");
      router.refresh();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setActioning(null);
    }
  }

  async function handleRecall() {
    if (!confirm(`Recall ${order.soNo}? This will return it to draft.`)) return;
    setActioning("recall");
    try {
      await recallSalesOrder(order.id);
      toast.success("Sales order recalled");
      router.refresh();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setActioning(null);
    }
  }

  async function handleRecheckStock() {
    setRechecking(true);
    try {
      const result = await checkAndReserveStock(order.id);
      setInsight(result);
      setStockStatus(result.canReserve ? "reserved" : "insufficient");
      if (result.canReserve) {
        toast.success("Stock reserved successfully");
      } else {
        toast.warning("Still insufficient — see shortage details below");
      }
      router.refresh();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setRechecking(false);
    }
  }

  async function handleTogglePrExclude(itemId: string) {
    const nowExcluded = !prExcludedItems.has(itemId);
    setTogglingPrExclude(itemId);
    try {
      await toggleSoItemPrExcluded(itemId, nowExcluded);
      setPrExcludedItems((prev) => {
        const next = new Set(prev);
        if (nowExcluded) next.add(itemId); else next.delete(itemId);
        return next;
      });
      toast.success(nowExcluded ? "Item excluded from PR" : "Item included in PR");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setTogglingPrExclude(null);
    }
  }

  return (
    <div className="p-6 space-y-6">
      {draftRedirected && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-700 px-4 py-3 text-sm text-amber-800 dark:text-amber-300 flex items-center gap-2">
          <span className="font-medium">Draft already exists.</span>
          You can only have one draft SO at a time. Submit or delete this one before creating a new order.
        </div>
      )}
      <PageHeader
        title={order.soNo}
        description={fmtDate(order.createdAt)}
        action={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => router.push("/dashboard/sales/order")} className="gap-1.5">
              <ArrowLeftIcon className="w-3.5 h-3.5" /> Back
            </Button>
            {(status === "confirmed" || status === "fulfilled") && (
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => window.open(`/api/sales-order/${order.id}/pdf`, "_blank")}>
                <PrinterIcon className="w-3.5 h-3.5" /> PDF
              </Button>
            )}
            {status === "confirmed" && can("purchase-requisition:create") && (
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => router.push(`/dashboard/procurement/requisition/create?soId=${order.id}`)}>
                <ShoppingCartIcon className="w-3.5 h-3.5" /> Raise Requisition
              </Button>
            )}
            {status === "confirmed" && can("sales-order:update") && (
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => router.push(`/dashboard/sales/consignment/create?soId=${order.id}&soNo=${encodeURIComponent(order.soNo)}`)}>
                <PackageIcon className="w-3.5 h-3.5" /> Create Consignment
              </Button>
            )}
            {status === "draft" ? (
              <>
                {isOwner && can("sales-order:update") && (
                  <Button variant="outline" size="sm" onClick={() => router.push(`/dashboard/sales/order/${order.id}/edit`)} className="gap-1.5">
                    <PencilIcon className="w-3.5 h-3.5" /> Edit
                  </Button>
                )}
                {isOwner && can("sales-order:delete") && (
                  <Button variant="outline" size="sm" className="gap-1.5 text-destructive hover:text-destructive" onClick={handleDelete} disabled={deleting}>
                    <TrashIcon className="w-3.5 h-3.5" /> Delete
                  </Button>
                )}
              </>
            ) : status === "cancelled" ? (
              <>
                <StatusBadge status={status} />
                {isOwner && can("sales-order:delete") && (
                  <Button variant="outline" size="sm" className="gap-1.5 text-destructive hover:text-destructive" onClick={handleDelete} disabled={deleting}>
                    <TrashIcon className="w-3.5 h-3.5" /> Delete
                  </Button>
                )}
              </>
            ) : (
              <StatusBadge status={status} />
            )}
          </div>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column — main info */}
        <div className="lg:col-span-2 space-y-5">

          {/* Customer */}
          <section className="border border-border rounded-xl p-4">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              Customer{cpoCustomerEntries.length > 1 ? "s" : ""}
            </h2>
            {cpoCustomerEntries.length > 0 ? (
              <div className="space-y-0">
                {cpoCustomerEntries.map((c, i) => {
                  const hasBoth = c.person && c.person !== c.label && c.label;
                  return (
                    <div key={i} className={`grid grid-cols-2 gap-x-6 gap-y-0.5 ${i > 0 ? "border-t border-border/50 pt-3 mt-3" : ""}`}>
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">Organization</p>
                        <p className="text-sm font-medium">{c.label || "—"}</p>
                        {c.address && (
                          <p className="text-[11px] text-muted-foreground mt-1 leading-snug">{c.address}</p>
                        )}
                      </div>
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">Contact</p>
                        <p className="text-sm">{hasBoth ? c.person : "—"}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No customer linked</p>
            )}
          </section>

          {/* Items */}
          <section className="border border-border rounded-xl p-4">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              Items <span className="font-normal">({order.items.length})</span>
            </h2>
            {order.items.length === 0 ? (
              <p className="text-sm text-muted-foreground">No items</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground">
                      <th className="text-left pb-2 pr-3 w-6">#</th>
                      <th className="text-left pb-2 pr-3 w-20">Code</th>
                      <th className="text-left pb-2 pr-3">Description</th>
                      <th className="text-right pb-2 pr-3 w-12">Qty</th>
                      <th className="text-left pb-2 pr-3 w-12">UOM</th>
                      <th className="text-right pb-2 pr-3 w-24">Unit price</th>
                      <th className="text-right pb-2 pr-3 w-14">Disc%</th>
                      <th className="text-right pb-2 w-24">Total</th>
                      {can("sales-order:update") && status === "confirmed" && (
                        <th className="pb-2 w-8" />
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      // Build CPO id → { customerName, cpoNo } map
                      const cpoInfoMap = new Map(
                        order.cpoCustomers.map((c) => [
                          c.customerPoId,
                          {
                            customerName: c.customerSnapshot
                              ? [c.customerSnapshot.title, c.customerSnapshot.name].filter(Boolean).join(" ")
                              : null,
                            cpoNo: c.customerPoNo,
                          },
                        ]),
                      );

                      // Only tag when items span more than one distinct CPO
                      const distinctCpos = new Set(
                        order.items.map((i) => (i as any).sourceCustomerPoId).filter(Boolean),
                      );
                      const showTags = distinctCpos.size > 1;

                      return order.items.map((item) => {
                        const info = cpoInfoMap.get((item as any).sourceCustomerPoId ?? "");
                        return (
                          <tr key={item.id} className={cn("border-b border-border/40 last:border-0", prExcludedItems.has(item.id) && "opacity-50")}>
                            <td className="py-2 pr-3 text-muted-foreground">{item.rowNo}</td>
                            <td className="py-2 pr-3 font-mono text-muted-foreground">{item.productCode || "—"}</td>
                            <td className="py-2 pr-3">
                              <div className="flex flex-col gap-1">
                                <span>{item.description || "—"}</span>
                                <div className="flex items-center gap-1 flex-wrap">
                                  {showTags && info && (
                                    <>
                                      {info.customerName && (
                                        <span className="inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-400 border border-violet-200 dark:border-violet-800">
                                          {info.customerName}
                                        </span>
                                      )}
                                      <span className="inline-flex items-center text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-800">
                                        {info.cpoNo}
                                      </span>
                                    </>
                                  )}
                                  {prExcludedItems.has(item.id) && (
                                    <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-red-50 text-red-600 border border-red-200 dark:bg-red-950/40 dark:text-red-400 dark:border-red-800">
                                      <BanIcon className="w-3 h-3 shrink-0" /> no PR
                                    </span>
                                  )}
                                  {(item as any).isAdditional && (
                                    <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-purple-50 text-purple-700 border border-purple-200 dark:bg-purple-950/40 dark:text-purple-400 dark:border-purple-800">
                                      <PlusIcon className="w-3 h-3 shrink-0" /> additional row
                                    </span>
                                  )}
                                  {(item as any).descriptionSource === "cpo" && (
                                    <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-green-50 text-green-700 border border-green-200 dark:bg-green-950/40 dark:text-green-400 dark:border-green-800">
                                      <FileTextIcon className="w-3 h-3 shrink-0" /> from quotation
                                    </span>
                                  )}
                                  {(item as any).descriptionSource === "catalog" && (
                                    <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-blue-50 text-blue-600 border border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800">
                                      <DatabaseIcon className="w-3 h-3 shrink-0" /> from product table
                                    </span>
                                  )}
                                  {(item as any).descriptionSource === "user" && (
                                    <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800">
                                      <PencilIcon className="w-3 h-3 shrink-0" />
                                      {(item as any).editedBy ? `${(item as any).editedBy} edited` : "edited"}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </td>
                            <td className="py-2 pr-3 text-right tabular-nums">{item.qty}</td>
                            <td className="py-2 pr-3 text-muted-foreground">{item.uom || "—"}</td>
                            <td className="py-2 pr-3 text-right tabular-nums">{fmt(item.unitPrice)}</td>
                            <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">{item.discountPct || "0"}%</td>
                            <td className="py-2 text-right tabular-nums font-medium">{fmt(item.totalPrice)}</td>
                            {can("sales-order:update") && status === "confirmed" && (
                              <td className="py-2 pl-2">
                                <button
                                  title={prExcludedItems.has(item.id) ? "Include in PR" : "Exclude from PR"}
                                  disabled={togglingPrExclude === item.id}
                                  onClick={() => handleTogglePrExclude(item.id)}
                                  className={cn(
                                    "flex items-center justify-center w-6 h-6 rounded transition-colors",
                                    prExcludedItems.has(item.id)
                                      ? "text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-900/20 hover:bg-red-100"
                                      : "text-muted-foreground hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20",
                                  )}
                                >
                                  {togglingPrExclude === item.id
                                    ? <Loader2Icon className="w-3 h-3 animate-spin" />
                                    : <BanIcon className="w-3 h-3" />}
                                </button>
                              </td>
                            )}
                          </tr>
                        );
                      });
                    })()}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Notes */}
          {order.notes && (
            <section className="border border-border rounded-xl p-4">
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Notes</h2>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{order.notes}</p>
            </section>
          )}
        </div>

        {/* Right column — summary */}
        <div className="space-y-5">

          {/* Status */}
          <section className="border border-border rounded-xl p-4">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Status</h2>
            <div className="mb-3 flex items-center gap-2 flex-wrap">
              <StatusBadge status={status} />
              {order.soType === "proforma" && (
                <span className="text-[11px] font-medium px-2 py-0.5 rounded bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-400 capitalize">
                  Pro-forma · {order.proformaReason ?? ""}
                </span>
              )}
            </div>
            <div className="flex flex-col gap-2">
              {/* Creator: submit for approval */}
              {status === "draft" && can("sales-order:create") && (
                <Button
                  size="sm"
                  className="w-full gap-1.5 h-8 text-xs"
                  onClick={handleSubmit}
                  disabled={actioning !== null}
                >
                  <SendIcon className="w-3.5 h-3.5" />
                  {actioning === "submit" ? "Submitting…" : "Submit for approval"}
                </Button>
              )}
              {/* Manager: approve submitted */}
              {status === "submitted" && can("sales-order:approve") && (
                <Button
                  size="sm"
                  className="w-full gap-1.5 h-8 text-xs bg-blue-600 hover:bg-blue-700 text-white"
                  onClick={handleApprove}
                  disabled={actioning !== null}
                >
                  <CheckIcon className="w-3.5 h-3.5" />
                  {actioning === "approve" ? "Approving…" : "Approve"}
                </Button>
              )}
              {/* Manager: reject submitted → back to draft */}
              {status === "submitted" && can("sales-order:reject") && (
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full gap-1.5 h-8 text-xs text-destructive hover:text-destructive border-destructive/30 hover:border-destructive/60"
                  onClick={handleReject}
                  disabled={actioning !== null}
                >
                  <XIcon className="w-3.5 h-3.5" />
                  {actioning === "reject" ? "Returning…" : "Return for revision"}
                </Button>
              )}
              {/* Manager: recall confirmed → back to draft */}
              {status === "confirmed" && can("sales-order:recall") && (
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full gap-1.5 h-8 text-xs"
                  onClick={handleRecall}
                  disabled={actioning !== null}
                >
                  <RotateCcwIcon className="w-3.5 h-3.5" />
                  {actioning === "recall" ? "Recalling…" : "Recall"}
                </Button>
              )}
            </div>
          </section>

          {/* Stock Insight — only shown on confirmed SOs */}
          {status === "confirmed" && can("delivery-order:create") && (
            <section className={cn(
              "border rounded-xl p-4 space-y-3",
              stockStatus === "reserved"    && "border-green-300 dark:border-green-700/50 bg-green-50/50 dark:bg-green-900/10",
              stockStatus === "insufficient" && "border-red-300 dark:border-red-700/50 bg-red-50/50 dark:bg-red-900/10",
              !stockStatus                  && "border-border",
            )}>
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                  <WarehouseIcon className="w-3.5 h-3.5" />
                  Stock Insight
                </h2>
                {stockStatus === "reserved" && (
                  <span className="flex items-center gap-1 text-[11px] font-medium text-green-700 dark:text-green-400">
                    <CheckCircle2Icon className="w-3.5 h-3.5" /> Reserved
                  </span>
                )}
                {stockStatus === "insufficient" && (
                  <span className="flex items-center gap-1 text-[11px] font-medium text-red-600 dark:text-red-400">
                    <AlertTriangleIcon className="w-3.5 h-3.5" /> Insufficient
                  </span>
                )}
              </div>

              {/* Read-only per-item stock data */}
              {insightLoading ? (
                <p className="text-xs text-muted-foreground">Loading stock data…</p>
              ) : insight && insight.items.length > 0 ? (
                <div className="rounded-lg border border-border overflow-hidden">
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="border-b border-border text-muted-foreground bg-muted/30">
                        <th className="text-left px-2 py-1.5">Item</th>
                        <th className="text-right px-2 py-1.5">Need</th>
                        <th className="text-right px-2 py-1.5">On hand</th>
                        <th className="text-right px-2 py-1.5">Reserved</th>
                        <th className="text-right px-2 py-1.5">Available</th>
                        <th className="text-right px-2 py-1.5">Short</th>
                      </tr>
                    </thead>
                    <tbody>
                      {insight.items.map((i) => (
                        <tr
                          key={i.productId}
                          className={cn(
                            "border-b border-border/40 last:border-0",
                            i.shortage > 0 && "bg-red-50/50 dark:bg-red-900/10",
                          )}
                        >
                          <td className="px-2 py-1.5">
                            <div className="font-mono">{i.productCode ?? i.productId}</div>
                            {i.description && (
                              <div className="text-muted-foreground truncate max-w-35">{i.description}</div>
                            )}
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{i.required}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{i.onHand}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{i.reserved}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{i.available}</td>
                          <td className={cn(
                            "px-2 py-1.5 text-right tabular-nums font-medium",
                            i.shortage > 0 ? "text-red-600 dark:text-red-400" : "text-muted-foreground",
                          )}>
                            {i.shortage > 0 ? i.shortage : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">No trackable items on this order.</p>
              )}

              {/* Not yet checked (legacy orders confirmed before auto-reservation) */}
              {!stockStatus && (
                <Button
                  size="sm"
                  className="w-full gap-1.5 h-8 text-xs"
                  onClick={handleRecheckStock}
                  disabled={rechecking}
                >
                  {rechecking ? <Loader2Icon className="w-3.5 h-3.5 animate-spin" /> : <WarehouseIcon className="w-3.5 h-3.5" />}
                  {rechecking ? "Checking stock…" : "Check stock"}
                </Button>
              )}

              {/* Reserved — ready for DO */}
              {stockStatus === "reserved" && (
                <div className="space-y-2">
                  {/* Multi-CPO: show per-CPO delivery status */}
                  {order.cpoCustomers.length > 1 ? (
                    <div className="space-y-2">
                      <p className="text-xs text-muted-foreground">
                        This SO has {order.cpoCustomers.length} customer POs. Create a separate delivery order for each.
                      </p>
                      <div className="rounded-lg border border-border overflow-hidden divide-y divide-border/50">
                        {order.cpoCustomers.map((cpo) => {
                          const dos = linkedDos.filter((d) => d.customerPoId === cpo.customerPoId);
                          const delivered = dos.filter((d) => d.status === "delivered");
                          const hasDo = dos.length > 0;
                          const snap = cpo.customerSnapshot;
                          const custName = snap ? [snap.title, snap.name].filter(Boolean).join(" ") : null;
                          return (
                            <div key={cpo.customerPoId} className="px-3 py-2.5 flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="text-xs font-mono font-medium">{cpo.customerPoNo}</span>
                                  {hasDo ? (
                                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">
                                      {delivered.length > 0 ? "Delivered" : "DO created"}
                                    </span>
                                  ) : (
                                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400">
                                      Pending
                                    </span>
                                  )}
                                </div>
                                {custName && <p className="text-[10px] text-muted-foreground mt-0.5">{custName}</p>}
                                {dos.map((d) => (
                                  <button
                                    key={d.id}
                                    onClick={() => router.push(`/dashboard/fulfillment/delivery/${d.id}`)}
                                    className="text-[10px] font-mono text-blue-600 dark:text-blue-400 hover:underline block mt-0.5"
                                  >
                                    {d.doNo}
                                  </button>
                                ))}
                              </div>
                              {!hasDo && can("delivery-order:create") && (
                                <Button
                                  size="sm"
                                  className="gap-1 h-7 text-xs bg-green-600 hover:bg-green-700 text-white shrink-0"
                                  onClick={() => router.push(`/dashboard/fulfillment/delivery/create?soId=${order.id}&soNo=${encodeURIComponent(order.soNo)}&customerPoId=${encodeURIComponent(cpo.customerPoId)}`)}
                                >
                                  <TruckIcon className="w-3 h-3" /> Create DO
                                </Button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    /* Single customer: simple Create DO button */
                    <>
                      <p className="text-xs text-muted-foreground">
                        Stock has been reserved. You can now create a delivery order.
                      </p>
                      <Button
                        size="sm"
                        className="w-full gap-1.5 h-8 text-xs bg-green-600 hover:bg-green-700 text-white"
                        onClick={() => router.push(`/dashboard/fulfillment/delivery/create?soId=${order.id}&soNo=${encodeURIComponent(order.soNo)}`)}
                      >
                        <TruckIcon className="w-3.5 h-3.5" />
                        Create Delivery Order
                      </Button>
                    </>
                  )}
                </div>
              )}

              {/* Insufficient stock — narrow recovery actions */}
              {stockStatus === "insufficient" && (
                <div className="flex gap-2">
                  {can("purchase-requisition:create") && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1 gap-1.5 h-8 text-xs"
                      onClick={() => router.push(`/dashboard/procurement/requisition/create?soId=${order.id}`)}
                    >
                      <ShoppingCartIcon className="w-3.5 h-3.5" />
                      Raise Requisition
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 gap-1.5 h-8 text-xs"
                    onClick={handleRecheckStock}
                    disabled={rechecking}
                  >
                    {rechecking ? <Loader2Icon className="w-3 h-3 animate-spin" /> : <RotateCcwIcon className="w-3 h-3" />}
                    Recheck availability
                  </Button>
                </div>
              )}
            </section>
          )}

          {/* Purchase Requisitions */}
          {(linkedPrs.length > 0 || (can("purchase-requisition:read") && (status === "confirmed" || status === "fulfilled"))) && (
            <section className="border border-border rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                  <ShoppingCartIcon className="w-3.5 h-3.5" />
                  Purchase Requisitions
                </h2>
                {can("purchase-requisition:create") && (
                  <button
                    onClick={() => router.push(`/dashboard/procurement/requisition/create?soId=${order.id}`)}
                    className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    + New
                  </button>
                )}
              </div>
              {linkedPrs.length === 0 ? (
                <p className="text-xs text-muted-foreground">No requisitions raised yet.</p>
              ) : (
                <div className="space-y-1.5">
                  {linkedPrs.map((pr) => {
                    const PR_BADGES: Record<string, { label: string; cls: string }> = {
                      draft:             { label: "Draft",     cls: "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400" },
                      submitted:         { label: "Pending",   cls: "bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400" },
                      approved:          { label: "Approved",  cls: "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400" },
                      partially_ordered: { label: "Partial",   cls: "bg-cyan-100 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-400" },
                      ordered:           { label: "Ordered",   cls: "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400" },
                      cancelled:         { label: "Cancelled", cls: "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400" },
                    };
                    const badge = PR_BADGES[pr.status] ?? { label: pr.status, cls: "bg-muted text-muted-foreground" };
                    return (
                      <div key={pr.id} className="flex items-center justify-between gap-2 rounded-lg border border-border/60 px-3 py-2 hover:bg-muted/30 transition-colors">
                        <button
                          onClick={() => router.push(`/dashboard/procurement/requisition/${pr.id}`)}
                          className="text-xs font-mono text-blue-600 dark:text-blue-400 hover:underline"
                        >
                          {pr.prNo}
                        </button>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] text-muted-foreground">{pr.itemCount} item{pr.itemCount !== 1 ? "s" : ""}</span>
                          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${badge.cls}`}>{badge.label}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          {/* Pricing */}
          <section className="border border-border rounded-xl p-4">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Pricing</h2>
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="tabular-nums">{fmt(order.subtotal)}</span>
              </div>
              {parseFloat(order.overallDiscountPct ?? "0") > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Discount ({order.overallDiscountPct}%)</span>
                  <span className="tabular-nums text-muted-foreground">−{fmt(order.overallDiscountAmt)}</span>
                </div>
              )}
              {parseFloat(order.sstPct ?? "0") > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">SST ({order.sstPct}%)</span>
                  <span className="tabular-nums">{fmt(order.sst)}</span>
                </div>
              )}
              <div className="flex justify-between font-semibold border-t border-border pt-2 mt-2">
                <span>Grand total</span>
                <span className="tabular-nums">{fmt(order.grandTotal)}</span>
              </div>
            </div>
          </section>

          {/* Details */}
          <section className="border border-border rounded-xl p-4 space-y-2.5">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Details</h2>

            {/* Original SO — shown on warranty/replacement pro-forma SOs */}
            {order.originalSoNo && (
              <div className="flex items-start gap-2">
                <LinkIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                <div>
                  <p className="text-[10px] text-muted-foreground capitalize">
                    Original SO ({order.proformaReason})
                  </p>
                  {order.originalSoId ? (
                    <button
                      onClick={() => router.push(`/dashboard/sales/order/${order.originalSoId}`)}
                      className="text-xs font-mono text-blue-600 dark:text-blue-400 hover:underline text-left"
                    >
                      {order.originalSoNo}
                    </button>
                  ) : (
                    <p className="text-xs font-mono">{order.originalSoNo}</p>
                  )}
                </div>
              </div>
            )}

            {(() => {
              const allLinked = (order.linkedQuotations as { id: string; quotationNo: string }[] | null) ??
                (order.quotationId && order.quotationNo ? [{ id: order.quotationId, quotationNo: order.quotationNo }] : []);
              if (allLinked.length === 0) return null;
              return (
                <div className="flex items-start gap-2">
                  <FileTextIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] text-muted-foreground mb-1">
                      Quotation{allLinked.length > 1 ? "s" : ""}
                    </p>
                    <div className="space-y-1">
                      {allLinked.map((q) => {
                        const match = q.id === linkedQuotation?.id ? linkedQuotation : null;
                        return match ? (
                          <button
                            key={q.id}
                            onClick={() => router.push(`/dashboard/sales/quotation/${q.id}`)}
                            className="w-full text-left border border-border rounded-lg px-2.5 py-2 hover:bg-muted/40 transition-colors"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-mono font-medium">{match.quotationNo}</span>
                              {match.status && (
                                <span className={cn("text-[10px] font-medium rounded px-1.5 py-0.5", (QT_STATUS[match.status] ?? QT_STATUS.draft).className)}>
                                  {(QT_STATUS[match.status] ?? QT_STATUS.draft).label}
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-muted-foreground tabular-nums mt-0.5">
                              {fmt(match.grandTotal)}
                            </div>
                          </button>
                        ) : (
                          <p key={q.id} className="text-xs font-mono text-muted-foreground px-0.5">{q.quotationNo}</p>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })()}
            {/* Sales person — per-CPO when linked, else order-level */}
            {order.cpoCustomers.length > 0 ? (
              <div className="flex items-start gap-2">
                <UserIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] text-muted-foreground mb-1">Sales person</p>
                  <div className="space-y-1">
                    {order.cpoCustomers.map((c) => (
                      <div key={c.customerPoId} className="flex items-center gap-1.5">
                        <span className="text-[10px] font-mono text-blue-600 dark:text-blue-400 shrink-0">{c.customerPoNo}</span>
                        <span className="text-xs">{c.salesPersonName ?? <span className="text-muted-foreground">—</span>}</span>
                      </div>
                    ))}
                  </div>
                  {(order.associateSalesPersons as { id: string; name: string }[] | null)?.length ? (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {(order.associateSalesPersons as { id: string; name: string }[]).map((a) => (
                        <span key={a.id} className="text-[10px] bg-muted rounded-full px-2 py-0.5">{a.name}</span>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : order.salesPersonName ? (
              <div className="flex items-start gap-2">
                <UserIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                <div>
                  <p className="text-[10px] text-muted-foreground">Sales person</p>
                  <p className="text-xs">{order.salesPersonName}</p>
                  {(order.associateSalesPersons as { id: string; name: string }[] | null)?.length ? (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {(order.associateSalesPersons as { id: string; name: string }[]).map((a) => (
                        <span key={a.id} className="text-[10px] bg-muted rounded-full px-2 py-0.5">{a.name}</span>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}

            {/* Due delivery date — per-CPO when linked, else order-level */}
            {order.cpoCustomers.length > 0 ? (
              <div className="flex items-start gap-2">
                <CalendarIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] text-muted-foreground mb-1">Due delivery date</p>
                  <div className="space-y-1">
                    {order.cpoCustomers.map((c) => (
                      <div key={c.customerPoId} className="flex items-center gap-1.5">
                        <span className="text-[10px] font-mono text-blue-600 dark:text-blue-400 shrink-0">{c.customerPoNo}</span>
                        <span className="text-xs">
                          {c.deliveryDate ? fmtDate(c.deliveryDate) : <span className="text-muted-foreground">—</span>}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : order.deliveryDate ? (
              <div className="flex items-start gap-2">
                <CalendarIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                <div>
                  <p className="text-[10px] text-muted-foreground">Due delivery date</p>
                  <p className="text-xs">{fmtDate(order.deliveryDate)}</p>
                </div>
              </div>
            ) : null}

            {/* Delivery address — per-CPO when linked, else order-level */}
            {order.cpoCustomers.length > 0 ? (
              <div className="flex items-start gap-2">
                <MapPinIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] text-muted-foreground mb-1">Delivery address</p>
                  <div className="space-y-1.5">
                    {order.cpoCustomers.map((c) => (
                      <div key={c.customerPoId} className="flex items-start gap-1.5">
                        <span className="text-[10px] font-mono text-blue-600 dark:text-blue-400 shrink-0 pt-0.5">{c.customerPoNo}</span>
                        <span className="text-xs leading-snug">
                          {c.customerSnapshot?.organizationAddress ? (
                            <>
                              {c.customerSnapshot.organizationName && (
                                <span className="block text-[10px] font-medium text-muted-foreground">{c.customerSnapshot.organizationName}</span>
                              )}
                              {c.customerSnapshot.organizationAddress}
                            </>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : order.deliveryAddress ? (
              <div className="flex items-start gap-2">
                <MapPinIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                <div>
                  <p className="text-[10px] text-muted-foreground">Delivery address</p>
                  <p className="text-xs">{order.deliveryAddress}</p>
                </div>
              </div>
            ) : null}
            <div className="flex items-start gap-2">
              <PackageIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
              <div>
                <p className="text-[10px] text-muted-foreground">Items</p>
                <p className="text-xs">{order.items.length} line{order.items.length !== 1 ? "s" : ""}</p>
              </div>
            </div>

            {/* Audit trail */}
            <div className="border-t border-border/50 pt-2.5 space-y-2">
              <div className="flex items-start gap-2">
                <CalendarIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                <div>
                  <p className="text-[10px] text-muted-foreground">Created</p>
                  <p className="text-xs">{fmtDate(order.createdAt)}</p>
                </div>
              </div>
              {order.createdByName && (
                <div className="flex items-start gap-2">
                  <UserIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                  <div>
                    <p className="text-[10px] text-muted-foreground">Prepared by</p>
                    <p className="text-xs">{order.createdByName}</p>
                  </div>
                </div>
              )}
              {order.submittedAt && (
                <div className="flex items-start gap-2">
                  <ClockIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                  <div>
                    <p className="text-[10px] text-muted-foreground">Sent for Approval</p>
                    <p className="text-xs">{fmtDate(order.submittedAt)}{order.submittedByName ? ` · ${order.submittedByName}` : ""}</p>
                  </div>
                </div>
              )}
              {order.approvedAt && (
                <div className="flex items-start gap-2">
                  <CheckIcon className="w-3.5 h-3.5 text-green-500 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-[10px] text-muted-foreground">Approved</p>
                    <p className="text-xs">{fmtDate(order.approvedAt)}{order.approvedByName ? ` · ${order.approvedByName}` : ""}</p>
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
