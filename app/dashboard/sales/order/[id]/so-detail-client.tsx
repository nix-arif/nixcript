"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useState } from "react";
import { deleteSalesOrder, updateSalesOrderStatus, type SalesOrderWithItems } from "@/server/sales-order";
import { type QuotationBasic } from "@/server/quotation";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import {
  ArrowLeftIcon, PencilIcon, TrashIcon,
  UserIcon, BuildingIcon, CalendarIcon, MapPinIcon,
  FileTextIcon, PackageIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

const fmt = (v: string | number | null | undefined) =>
  `RM ${Number(v ?? 0).toLocaleString("en-MY", { minimumFractionDigits: 2 })}`;

const fmtDate = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const SO_STATUS: Record<string, { label: string; className: string }> = {
  draft:     { label: "Draft",     className: "bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400" },
  confirmed: { label: "Confirmed", className: "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400" },
  fulfilled: { label: "Fulfilled", className: "bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400" },
  cancelled: { label: "Cancelled", className: "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400" },
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

export function SalesOrderDetailClient({ order, linkedQuotation }: { order: SalesOrderWithItems; linkedQuotation: QuotationBasic | null }) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [status, setStatus] = useState(order.status);
  const [updatingStatus, setUpdatingStatus] = useState(false);

  const snap = order.customerSnapshot as any;
  const custName = snap ? [snap.title, snap.name].filter(Boolean).join(" ") : null;

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

  async function handleStatusChange(newStatus: string) {
    setUpdatingStatus(true);
    try {
      await updateSalesOrderStatus(order.id, newStatus);
      setStatus(newStatus);
      toast.success("Status updated");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setUpdatingStatus(false);
    }
  }

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title={order.soNo}
        description={fmtDate(order.createdAt)}
        action={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => router.push("/dashboard/sales/order")} className="gap-1.5">
              <ArrowLeftIcon className="w-3.5 h-3.5" /> Back
            </Button>
            <Button variant="outline" size="sm" onClick={() => router.push(`/dashboard/sales/order/${order.id}/edit`)} className="gap-1.5">
              <PencilIcon className="w-3.5 h-3.5" /> Edit
            </Button>
            <Button variant="outline" size="sm" className="gap-1.5 text-destructive hover:text-destructive" onClick={handleDelete} disabled={deleting}>
              <TrashIcon className="w-3.5 h-3.5" /> Delete
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column — main info */}
        <div className="lg:col-span-2 space-y-5">

          {/* Customer */}
          <section className="border border-border rounded-xl p-4">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Customer</h2>
            {custName ? (
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <UserIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <span className="text-sm font-medium">{custName}</span>
                </div>
                {snap?.organizationName && (
                  <div className="flex items-center gap-2">
                    <BuildingIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <span className="text-sm text-muted-foreground">{snap.organizationName}</span>
                  </div>
                )}
                {snap?.organizationAddress && (
                  <div className="flex items-start gap-2 mt-1">
                    <MapPinIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                    <span className="text-xs text-muted-foreground">{snap.organizationAddress}</span>
                  </div>
                )}
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
                    </tr>
                  </thead>
                  <tbody>
                    {order.items.map((item) => (
                      <tr key={item.id} className="border-b border-border/40 last:border-0">
                        <td className="py-2 pr-3 text-muted-foreground">{item.rowNo}</td>
                        <td className="py-2 pr-3 font-mono text-muted-foreground">{item.productCode || "—"}</td>
                        <td className="py-2 pr-3">{item.description || "—"}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{item.qty}</td>
                        <td className="py-2 pr-3 text-muted-foreground">{item.uom || "—"}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{fmt(item.unitPrice)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">{item.discountPct || "0"}%</td>
                        <td className="py-2 text-right tabular-nums font-medium">{fmt(item.totalPrice)}</td>
                      </tr>
                    ))}
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
            <div className="mb-3"><StatusBadge status={status} /></div>
            <select
              value={status}
              onChange={(e) => handleStatusChange(e.target.value)}
              disabled={updatingStatus}
              className="w-full h-8 rounded-md border border-border bg-background px-2.5 text-xs"
            >
              {Object.entries(SO_STATUS).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
          </section>

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
            {order.salesPersonName && (
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
            )}
            {order.deliveryDate && (
              <div className="flex items-start gap-2">
                <CalendarIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                <div>
                  <p className="text-[10px] text-muted-foreground">Due delivery date</p>
                  <p className="text-xs">{fmtDate(order.deliveryDate)}</p>
                </div>
              </div>
            )}
            {order.deliveryAddress && (
              <div className="flex items-start gap-2">
                <MapPinIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                <div>
                  <p className="text-[10px] text-muted-foreground">Delivery address</p>
                  <p className="text-xs">{order.deliveryAddress}</p>
                </div>
              </div>
            )}
            <div className="flex items-start gap-2">
              <PackageIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
              <div>
                <p className="text-[10px] text-muted-foreground">Items</p>
                <p className="text-xs">{order.items.length} line{order.items.length !== 1 ? "s" : ""}</p>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
