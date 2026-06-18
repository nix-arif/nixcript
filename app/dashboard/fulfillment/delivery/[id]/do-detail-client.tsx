"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  deleteDeliveryOrder,
  deliverDeliveryOrder,
  returnDeliveryOrder,
  type DeliveryOrderWithItems,
} from "@/server/delivery-order";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import {
  ArrowLeftIcon, PencilIcon, TrashIcon,
  UserIcon, BuildingIcon, CalendarIcon, PackageIcon, MapPinIcon,
  TruckIcon, RotateCcwIcon, LinkIcon, ReceiptIcon, CheckCircle2Icon,
} from "lucide-react";
import { cn } from "@/lib/utils";

const fmtDate = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const DO_STATUS: Record<string, { label: string; className: string }> = {
  draft:     { label: "Draft",     className: "bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400" },
  delivered: { label: "Delivered", className: "bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400" },
  returned:  { label: "Returned",  className: "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400" },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = DO_STATUS[status] ?? DO_STATUS.draft;
  return <span className={cn("text-[11px] font-medium rounded px-2 py-0.5", cfg.className)}>{cfg.label}</span>;
}

export function DeliveryOrderDetailClient({
  order,
  permissions,
  currentUserId,
}: {
  order: DeliveryOrderWithItems;
  permissions: string[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState(order.status ?? "draft");
  const [actioning, setActioning] = useState<"deliver" | "return" | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => { setStatus(order.status ?? "draft"); }, [order.status]);

  const can = (p: string) => permissions.includes("*") || permissions.includes(p);
  const isOwner = order.createdBy === currentUserId;
  const snap = order.customerSnapshot as any;
  const orgName = snap?.organizationName;
  const personName = snap ? [snap.title, snap.name].filter(Boolean).join(" ") : null;
  const hasBoth = orgName && personName && personName !== orgName;

  async function act(
    key: "deliver" | "return",
    fn: () => Promise<void>,
    next: string,
    successMsg: string,
  ) {
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
    if (!confirm(`Delete ${order.doNo}? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await deleteDeliveryOrder(order.id);
      toast.success("Delivery order deleted");
      router.push("/dashboard/fulfillment/delivery");
    } catch (e: any) {
      toast.error(e.message);
      setDeleting(false);
    }
  }

  const isDraft = status === "draft";
  const isDelivered = status === "delivered";

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title={order.doNo}
        description={fmtDate(order.createdAt)}
        action={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => router.push("/dashboard/fulfillment/delivery")} className="gap-1.5">
              <ArrowLeftIcon className="w-3.5 h-3.5" /> Back
            </Button>
            {isDelivered && order.invoiceId && can("invoice:read") && (
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() => router.push(`/dashboard/fulfillment/invoice/${order.invoiceId}`)}
              >
                <ReceiptIcon className="w-3.5 h-3.5" /> View Invoice
              </Button>
            )}
            {isDelivered && !order.invoiceId && can("invoice:create") && (
              <Button
                size="sm"
                className="gap-1.5"
                onClick={() => {
                  const params = new URLSearchParams({ doId: order.id });
                  if (order.salesOrderId) params.set("soId", order.salesOrderId);
                  if (order.salesOrderNo) params.set("soNo", order.salesOrderNo);
                  router.push(`/dashboard/fulfillment/invoice/create?${params}`);
                }}
              >
                <ReceiptIcon className="w-3.5 h-3.5" /> Create Invoice
              </Button>
            )}
            {isDraft && isOwner && can("delivery-order:update") && (
              <Button variant="outline" size="sm" onClick={() => router.push(`/dashboard/fulfillment/delivery/${order.id}/edit`)} className="gap-1.5">
                <PencilIcon className="w-3.5 h-3.5" /> Edit
              </Button>
            )}
            {isDraft && isOwner && can("delivery-order:delete") && (
              <Button variant="outline" size="sm" className="gap-1.5 text-destructive hover:text-destructive" onClick={handleDelete} disabled={deleting}>
                <TrashIcon className="w-3.5 h-3.5" /> Delete
              </Button>
            )}
            {!isDraft && <StatusBadge status={status} />}
          </div>
        }
      />

      {isDelivered && !order.invoiceId && can("invoice:create") && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-4 py-3">
          <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
            <ReceiptIcon className="w-4 h-4 shrink-0" />
            <span className="text-sm font-medium">Invoice pending</span>
            <span className="text-sm text-amber-600 dark:text-amber-500">— this delivery has not been invoiced yet.</span>
          </div>
          <Button
            size="sm"
            className="gap-1.5 shrink-0"
            onClick={() => {
              const params = new URLSearchParams({ doId: order.id });
              if (order.salesOrderId) params.set("soId", order.salesOrderId);
              if (order.salesOrderNo) params.set("soNo", order.salesOrderNo);
              router.push(`/dashboard/fulfillment/invoice/create?${params}`);
            }}
          >
            <ReceiptIcon className="w-3.5 h-3.5" /> Create Invoice
          </Button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column — customer + items + notes */}
        <div className="lg:col-span-2 space-y-5">

          {/* Customer */}
          {snap && (
            <section className="border border-border rounded-xl p-4">
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Customer</h2>
              <div className="grid grid-cols-2 gap-x-6">
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">Organization</p>
                  <p className="text-sm font-medium">{orgName || personName || "—"}</p>
                  {snap.organizationAddress && (
                    <p className="text-[11px] text-muted-foreground mt-1 leading-snug">{snap.organizationAddress}</p>
                  )}
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">Contact</p>
                  <p className="text-sm">{hasBoth ? personName : "—"}</p>
                  {snap.email && <p className="text-[11px] text-muted-foreground mt-0.5">{snap.email}</p>}
                  {snap.contactNo && <p className="text-[11px] text-muted-foreground">{snap.contactNo}</p>}
                </div>
              </div>
            </section>
          )}

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
                      <th className="text-left pb-2 w-12">UOM</th>
                    </tr>
                  </thead>
                  <tbody>
                    {order.items.map((item) => (
                      <tr key={item.id} className="border-b border-border/40 last:border-0">
                        <td className="py-2 pr-3 text-muted-foreground">{item.rowNo}</td>
                        <td className="py-2 pr-3 font-mono text-muted-foreground">{item.productCode || "—"}</td>
                        <td className="py-2 pr-3">{item.description || "—"}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{item.qty}</td>
                        <td className="py-2 text-muted-foreground">{item.uom || "—"}</td>
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

        {/* Right column — status + details */}
        <div className="space-y-5">

          {/* Status */}
          <section className="border border-border rounded-xl p-4">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Status</h2>
            <div className="mb-3"><StatusBadge status={status} /></div>
            <div className="flex flex-col gap-2">
              {isDraft && can("delivery-order:update") && (
                <Button
                  size="sm"
                  className="w-full gap-1.5 h-8 text-xs bg-green-600 hover:bg-green-700 text-white"
                  disabled={!!actioning}
                  onClick={() => act("deliver", () => deliverDeliveryOrder(order.id), "delivered", "Marked as delivered")}
                >
                  <TruckIcon className="w-3.5 h-3.5" />
                  {actioning === "deliver" ? "Updating…" : "Mark as Delivered"}
                </Button>
              )}
              {isDelivered && can("delivery-order:update") && (
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full gap-1.5 h-8 text-xs text-destructive hover:text-destructive border-destructive/30"
                  disabled={!!actioning}
                  onClick={() => act("return", () => returnDeliveryOrder(order.id), "returned", "Marked as returned")}
                >
                  <RotateCcwIcon className="w-3.5 h-3.5" />
                  {actioning === "return" ? "Updating…" : "Mark as Returned"}
                </Button>
              )}
              {isDelivered && can("invoice:create") && (
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full gap-1.5 h-8 text-xs"
                  onClick={() => {
                    const params = new URLSearchParams({ doId: order.id });
                    if (order.salesOrderId) params.set("soId", order.salesOrderId);
                    if (order.salesOrderNo) params.set("soNo", order.salesOrderNo);
                    router.push(`/dashboard/fulfillment/invoice/create?${params}`);
                  }}
                >
                  <ReceiptIcon className="w-3.5 h-3.5" />
                  Create Invoice
                </Button>
              )}
              {status === "returned" && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground px-1">
                  <CheckCircle2Icon className="w-3.5 h-3.5 text-muted-foreground" />
                  Stock has been returned to inventory.
                </div>
              )}
            </div>
          </section>

          {/* Details */}
          <section className="border border-border rounded-xl p-4 space-y-2.5">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Details</h2>

            {/* Linked SO — clickable */}
            {order.salesOrderNo && (
              <div className="flex items-start gap-2">
                <LinkIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                <div>
                  <p className="text-[10px] text-muted-foreground">Linked SO</p>
                  {order.salesOrderId ? (
                    <button
                      onClick={() => router.push(`/dashboard/sales/order/${order.salesOrderId}`)}
                      className="text-xs font-mono text-blue-600 dark:text-blue-400 hover:underline text-left"
                    >
                      {order.salesOrderNo}
                    </button>
                  ) : (
                    <p className="text-xs font-mono">{order.salesOrderNo}</p>
                  )}
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

            {order.deliveryDate && (
              <div className="flex items-start gap-2">
                <CalendarIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                <div>
                  <p className="text-[10px] text-muted-foreground">Delivery date</p>
                  <p className="text-xs">{fmtDate(order.deliveryDate)}</p>
                </div>
              </div>
            )}

            {order.deliveredTo && (
              <div className="flex items-start gap-2">
                <UserIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                <div>
                  <p className="text-[10px] text-muted-foreground">Delivered to</p>
                  <p className="text-xs">{order.deliveredTo}</p>
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
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
