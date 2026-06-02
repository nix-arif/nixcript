"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  deletePurchaseOrder,
  sendPurchaseOrder,
  acknowledgePurchaseOrder,
  receivePurchaseOrder,
  cancelPurchaseOrder,
  type PurchaseOrderWithItems,
} from "@/server/purchase-order";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import {
  ArrowLeftIcon, PencilIcon, TrashIcon,
  BuildingIcon, CalendarIcon, PackageIcon,
  SendIcon, CheckIcon, XIcon, ArchiveIcon, PrinterIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

const fmt = (v: string | number | null | undefined) =>
  `RM ${Number(v ?? 0).toLocaleString("en-MY", { minimumFractionDigits: 2 })}`;

const fmtDate = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const PO_STATUS: Record<string, { label: string; className: string }> = {
  draft:        { label: "Draft",        className: "bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400" },
  sent:         { label: "Sent",         className: "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400" },
  acknowledged: { label: "Acknowledged", className: "bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-400" },
  received:     { label: "Received",     className: "bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400" },
  cancelled:    { label: "Cancelled",    className: "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400" },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = PO_STATUS[status] ?? PO_STATUS.draft;
  return <span className={cn("text-[11px] font-medium rounded px-2 py-0.5", cfg.className)}>{cfg.label}</span>;
}

export function PurchaseOrderDetailClient({
  order,
  permissions,
  currentUserId,
  draftRedirected,
}: {
  order: PurchaseOrderWithItems;
  permissions: string[];
  currentUserId: string;
  draftRedirected?: boolean;
}) {
  const router = useRouter();
  const [status, setStatus] = useState(order.status ?? "draft");
  const [actioning, setActioning] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => { setStatus(order.status ?? "draft"); }, [order.status]);

  const can = (p: string) => permissions.includes("*") || permissions.includes(p);
  const isOwner = order.createdBy === currentUserId;
  const snap = order.supplierSnapshot as any;

  async function act(key: string, fn: () => Promise<void>, next: string, successMsg: string) {
    setActioning(key);
    try {
      await fn();
      setStatus(next);
      toast.success(successMsg);
      router.refresh();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setActioning(null);
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete ${order.poNo}? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await deletePurchaseOrder(order.id);
      toast.success("Purchase order deleted");
      router.push("/dashboard/procurement/purchase-order");
    } catch (e: any) {
      toast.error(e.message);
      setDeleting(false);
    }
  }

  const isDraft = status === "draft";
  const isCancelled = status === "cancelled";
  const isLocked = !isDraft && !isCancelled;

  return (
    <div className="p-6 space-y-6">
      {draftRedirected && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-700 px-4 py-3 text-sm text-amber-800 dark:text-amber-300 flex items-center gap-2">
          <span className="font-medium">Draft already exists.</span>
          You can only have one draft PO at a time. Send or delete this one before creating a new order.
        </div>
      )}
      <PageHeader
        title={order.poNo}
        description={fmtDate(order.createdAt)}
        action={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => router.push("/dashboard/procurement/purchase-order")} className="gap-1.5">
              <ArrowLeftIcon className="w-3.5 h-3.5" /> Back
            </Button>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => window.open(`/api/purchase-order/${order.id}/pdf`, "_blank")}>
              <PrinterIcon className="w-3.5 h-3.5" /> PDF
            </Button>
            {isDraft ? (
              <>
                {isOwner && can("purchase-order:update") && (
                  <Button variant="outline" size="sm" onClick={() => router.push(`/dashboard/procurement/purchase-order/${order.id}/edit`)} className="gap-1.5">
                    <PencilIcon className="w-3.5 h-3.5" /> Edit
                  </Button>
                )}
                {isOwner && can("purchase-order:delete") && (
                  <Button variant="outline" size="sm" className="gap-1.5 text-destructive hover:text-destructive" onClick={handleDelete} disabled={deleting}>
                    <TrashIcon className="w-3.5 h-3.5" /> Delete
                  </Button>
                )}
              </>
            ) : isCancelled ? (
              <>
                <StatusBadge status={status} />
                {isOwner && can("purchase-order:delete") && (
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
        {/* Left — items */}
        <div className="lg:col-span-2 space-y-5">
          {snap && (
            <section className="border border-border rounded-xl p-4">
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Supplier</h2>
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <BuildingIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <span className="text-sm font-medium">{snap.name}</span>
                </div>
                {snap.registrationNo && <p className="text-xs text-muted-foreground pl-5">Reg: {snap.registrationNo}</p>}
                {snap.contactPerson && <p className="text-xs text-muted-foreground pl-5">{snap.contactPerson}</p>}
                {snap.email && <p className="text-xs text-muted-foreground pl-5">{snap.email}</p>}
                {snap.contactNo && <p className="text-xs text-muted-foreground pl-5">{snap.contactNo}</p>}
              </div>
            </section>
          )}

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
                      <th className="text-left pb-2 pr-3 w-12">Ccy</th>
                      <th className="text-right pb-2 pr-3 w-24">Unit price</th>
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
                        <td className="py-2 pr-3 font-mono text-muted-foreground">{item.currency || "MYR"}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{Number(item.unitPrice ?? 0).toLocaleString("en-MY", { minimumFractionDigits: 2 })}</td>
                        <td className="py-2 text-right tabular-nums font-medium">{Number(item.totalPrice ?? 0).toLocaleString("en-MY", { minimumFractionDigits: 2 })}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {order.notes && (
            <section className="border border-border rounded-xl p-4">
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Notes</h2>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{order.notes}</p>
            </section>
          )}
        </div>

        {/* Right — summary + workflow */}
        <div className="space-y-5">
          <section className="border border-border rounded-xl p-4">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Status</h2>
            <div className="mb-3"><StatusBadge status={status} /></div>
            <div className="flex flex-col gap-2">
              {isDraft && can("purchase-order:update") && isOwner && (
                <Button size="sm" className="w-full gap-1.5 h-8 text-xs" disabled={!!actioning}
                  onClick={() => act("send", () => sendPurchaseOrder(order.id), "sent", "Purchase order sent to supplier")}>
                  <SendIcon className="w-3.5 h-3.5" />
                  {actioning === "send" ? "Sending…" : "Mark as Sent"}
                </Button>
              )}
              {status === "sent" && can("purchase-order:update") && (
                <Button size="sm" className="w-full gap-1.5 h-8 text-xs bg-purple-600 hover:bg-purple-700 text-white" disabled={!!actioning}
                  onClick={() => act("ack", () => acknowledgePurchaseOrder(order.id), "acknowledged", "Supplier acknowledged")}>
                  <CheckIcon className="w-3.5 h-3.5" />
                  {actioning === "ack" ? "Updating…" : "Mark Acknowledged"}
                </Button>
              )}
              {(status === "sent" || status === "acknowledged") && can("purchase-order:update") && (
                <Button size="sm" className="w-full gap-1.5 h-8 text-xs bg-green-600 hover:bg-green-700 text-white" disabled={!!actioning}
                  onClick={() => act("receive", () => receivePurchaseOrder(order.id), "received", "Goods received")}>
                  <ArchiveIcon className="w-3.5 h-3.5" />
                  {actioning === "receive" ? "Updating…" : "Mark Received"}
                </Button>
              )}
              {isLocked && status !== "received" && can("purchase-order:update") && (
                <Button size="sm" variant="outline" className="w-full gap-1.5 h-8 text-xs text-destructive hover:text-destructive border-destructive/30" disabled={!!actioning}
                  onClick={() => act("cancel", () => cancelPurchaseOrder(order.id), "cancelled", "Purchase order cancelled")}>
                  <XIcon className="w-3.5 h-3.5" />
                  {actioning === "cancel" ? "Cancelling…" : "Cancel PO"}
                </Button>
              )}
            </div>
          </section>

          <section className="border border-border rounded-xl p-4">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Pricing</h2>
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="tabular-nums">{fmt(order.subtotal)}</span>
              </div>
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

          <section className="border border-border rounded-xl p-4 space-y-2.5">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Details</h2>
            <div className="flex items-start gap-2">
              <PackageIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
              <div>
                <p className="text-[10px] text-muted-foreground">Items</p>
                <p className="text-xs">{order.items.length} line{order.items.length !== 1 ? "s" : ""}</p>
              </div>
            </div>
            {order.salesOrderNo && (
              <div className="flex items-start gap-2">
                <PackageIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                <div>
                  <p className="text-[10px] text-muted-foreground">Linked SO</p>
                  <p className="text-xs font-mono">{order.salesOrderNo}</p>
                </div>
              </div>
            )}
            {order.customerPos.length > 0 && (
              <div className="flex items-start gap-2">
                <PackageIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                <div>
                  <p className="text-[10px] text-muted-foreground">Customer POs</p>
                  <div className="flex flex-wrap gap-1 mt-0.5">
                    {order.customerPos.map((cpo) => (
                      <span key={cpo.id} className="text-xs font-mono bg-muted/50 rounded px-1.5 py-0.5">{cpo.customerPoNo}</span>
                    ))}
                  </div>
                </div>
              </div>
            )}
            {order.expectedDeliveryDate && (
              <div className="flex items-start gap-2">
                <CalendarIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                <div>
                  <p className="text-[10px] text-muted-foreground">Expected delivery</p>
                  <p className="text-xs">{fmtDate(order.expectedDeliveryDate)}</p>
                </div>
              </div>
            )}
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
                  <BuildingIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                  <div>
                    <p className="text-[10px] text-muted-foreground">Prepared by</p>
                    <p className="text-xs">{order.createdByName}</p>
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
