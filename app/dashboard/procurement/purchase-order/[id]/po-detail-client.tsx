"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  deletePurchaseOrder,
  submitPurchaseOrder,
  approvePurchaseOrder,
  rejectPurchaseOrder,
  recallPurchaseOrder,
  fulfillPurchaseOrder,
  cancelPurchaseOrder,
  type PurchaseOrderWithItems,
} from "@/server/purchase-order";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import {
  ArrowLeftIcon, PencilIcon, TrashIcon,
  BuildingIcon, CalendarIcon, PackageIcon,
  SendIcon, CheckIcon, XIcon, ArchiveIcon, PrinterIcon, RotateCcwIcon,
  ClipboardListIcon, TruckIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

const fmt = (v: string | number | null | undefined, currency = "MYR") =>
  `${currency} ${Number(v ?? 0).toLocaleString("en-MY", { minimumFractionDigits: 2 })}`;

const fmtDate = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const PO_STATUS: Record<string, { label: string; className: string }> = {
  draft:     { label: "Draft",             className: "bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400" },
  submitted: { label: "Awaiting Approval", className: "bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-400" },
  confirmed: { label: "PO Confirmed",      className: "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400" },
  fulfilled: { label: "Fulfilled",         className: "bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400" },
  cancelled: { label: "Cancelled",         className: "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400" },
};

const PR_STATUSES = new Set(["draft", "submitted"]);

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

  // Document numbers: prNo for PR phase, poNo for PO phase, fall back for legacy records
  const isPrPhase = PR_STATUSES.has(status);
  const headerDocNo = isPrPhase
    ? (order.prNo ?? order.poNo ?? order.id)
    : (order.poNo ?? order.prNo ?? order.id);
  const docTypeLabel = isPrPhase ? "Purchase Requisition" : "Supplier Purchase Order";

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
    if (!confirm(`Delete ${headerDocNo}? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await deletePurchaseOrder(order.id);
      toast.success("Purchase requisition deleted");
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
          <span className="font-medium">Draft requisition already exists.</span>
          Submit or delete it before raising a new one.
        </div>
      )}
      <PageHeader
        title={headerDocNo}
        description={`${docTypeLabel} · ${fmtDate(order.createdAt)}`}
        action={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => router.push("/dashboard/procurement/purchase-order")} className="gap-1.5">
              <ArrowLeftIcon className="w-3.5 h-3.5" /> Back
            </Button>
            {status === "confirmed" && (
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => window.open(`/api/purchase-order/${order.id}/pdf`, "_blank")}>
                <PrinterIcon className="w-3.5 h-3.5" /> PDF
              </Button>
            )}
            {isDraft ? (
              <>
                {isOwner && can("purchase-order:update") && (
                  <Button variant="outline" size="sm" onClick={() => router.push(`/dashboard/procurement/purchase-order/${order.id}/edit`)} className="gap-1.5">
                    <PencilIcon className="w-3.5 h-3.5" /> Edit
                  </Button>
                )}
                {isOwner && can("purchase-order:delete") && !order.approvedAt && (
                  <Button variant="outline" size="sm" className="gap-1.5 text-destructive hover:text-destructive" onClick={handleDelete} disabled={deleting}>
                    <TrashIcon className="w-3.5 h-3.5" /> Delete
                  </Button>
                )}
              </>
            ) : isCancelled ? (
              <>
                <StatusBadge status={status} />
                {isOwner && can("purchase-order:delete") && !order.approvedAt && (
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

      {/* PR → PO number trail (only when both exist) */}
      {order.prNo && order.poNo && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground border border-border rounded-lg px-4 py-2.5 bg-muted/20">
          <ClipboardListIcon className="w-3.5 h-3.5 shrink-0" />
          <span className="font-mono font-medium text-foreground">{order.prNo}</span>
          <span className="text-muted-foreground/50">→</span>
          <TruckIcon className="w-3.5 h-3.5 shrink-0" />
          <span className="font-mono font-medium text-foreground">{order.poNo}</span>
          <span className="text-muted-foreground ml-1">Requisition approved — supplier PO issued</span>
        </div>
      )}

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

          {/* Goods Receipt section — visible once PO is confirmed */}
          {!isPrPhase && (
            <section className="border border-border rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Goods Receipts</h2>
                {status === "confirmed" && can("purchase-order:update") && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs gap-1.5"
                    onClick={() => router.push(`/dashboard/procurement/purchase-order/${order.id}/goods-receipt/create`)}
                  >
                    <TruckIcon className="w-3 h-3" /> Record Receipt
                  </Button>
                )}
              </div>
              {order.goodsReceipts.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {status === "fulfilled" ? "No formal goods receipts recorded." : "No goods receipts yet."}
                </p>
              ) : (
                <div className="space-y-1.5">
                  {order.goodsReceipts.map((gr) => (
                    <button
                      key={gr.id}
                      onClick={() => router.push(`/dashboard/procurement/purchase-order/${order.id}/goods-receipt/${gr.id}`)}
                      className="w-full flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted/30 transition-colors text-left"
                    >
                      <div className="flex items-center gap-2">
                        <TruckIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        <span className="font-mono text-xs font-medium">{gr.grNo}</span>
                      </div>
                      <span className="text-xs text-muted-foreground">{fmtDate(gr.receivedDate)}</span>
                    </button>
                  ))}
                </div>
              )}
            </section>
          )}
        </div>

        {/* Right — summary + workflow */}
        <div className="space-y-5">
          <section className="border border-border rounded-xl p-4">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Status</h2>
            <div className="mb-3"><StatusBadge status={status} /></div>
            <div className="flex flex-col gap-2">
              {/* Creator: submit draft */}
              {isDraft && can("purchase-order:update") && isOwner && (
                <Button size="sm" className="w-full gap-1.5 h-8 text-xs" disabled={!!actioning}
                  onClick={() => act("submit", () => submitPurchaseOrder(order.id), "submitted", "Requisition submitted for approval")}>
                  <SendIcon className="w-3.5 h-3.5" />
                  {actioning === "submit" ? "Submitting…" : "Submit for Approval"}
                </Button>
              )}
              {/* Approver: approve submitted → becomes Supplier PO */}
              {status === "submitted" && can("purchase-order:approve") && (
                <Button size="sm" className="w-full gap-1.5 h-8 text-xs bg-blue-600 hover:bg-blue-700 text-white" disabled={!!actioning}
                  onClick={() => act("approve", () => approvePurchaseOrder(order.id), "confirmed", "Requisition approved — supplier PO issued")}>
                  <CheckIcon className="w-3.5 h-3.5" />
                  {actioning === "approve" ? "Approving…" : "Approve & Issue PO"}
                </Button>
              )}
              {/* Approver: reject submitted → back to draft */}
              {status === "submitted" && can("purchase-order:approve") && (
                <Button size="sm" variant="outline" className="w-full gap-1.5 h-8 text-xs text-destructive hover:text-destructive border-destructive/30" disabled={!!actioning}
                  onClick={() => act("reject", () => rejectPurchaseOrder(order.id), "draft", "Requisition returned for revision")}>
                  <XIcon className="w-3.5 h-3.5" />
                  {actioning === "reject" ? "Returning…" : "Return for Revision"}
                </Button>
              )}
              {/* Approver: recall confirmed PO → back to draft */}
              {status === "confirmed" && can("purchase-order:approve") && (
                <Button size="sm" variant="outline" className="w-full gap-1.5 h-8 text-xs" disabled={!!actioning}
                  onClick={() => act("recall", () => recallPurchaseOrder(order.id), "draft", "Purchase order recalled")}>
                  <RotateCcwIcon className="w-3.5 h-3.5" />
                  {actioning === "recall" ? "Recalling…" : "Recall PO"}
                </Button>
              )}
              {/* Mark confirmed PO as fulfilled — direct close without GR */}
              {status === "confirmed" && can("purchase-order:approve") && (
                <Button size="sm" variant="outline" className="w-full gap-1.5 h-8 text-xs" disabled={!!actioning}
                  onClick={() => act("fulfill", () => fulfillPurchaseOrder(order.id), "fulfilled", "Purchase order marked as fulfilled")}>
                  <ArchiveIcon className="w-3.5 h-3.5" />
                  {actioning === "fulfill" ? "Closing…" : "Close PO (no GR)"}
                </Button>
              )}
              {/* Approver: cancel (submitted or confirmed) */}
              {isLocked && status !== "fulfilled" && can("purchase-order:approve") && (
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
                <span className="tabular-nums">{fmt(order.subtotal, order.currency)}</span>
              </div>
              {parseFloat(order.sstPct ?? "0") > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">SST ({order.sstPct}%)</span>
                  <span className="tabular-nums">{fmt(order.sst, order.currency)}</span>
                </div>
              )}
              <div className="flex justify-between font-semibold border-t border-border pt-2 mt-2">
                <span>Grand total</span>
                <span className="tabular-nums">{fmt(order.grandTotal, order.currency)}</span>
              </div>
            </div>
          </section>

          <section className="border border-border rounded-xl p-4 space-y-2.5">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Details</h2>
            {/* PR → PO number pair */}
            {order.prNo && (
              <div className="flex items-start gap-2">
                <ClipboardListIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                <div>
                  <p className="text-[10px] text-muted-foreground">Requisition No.</p>
                  <p className="text-xs font-mono">{order.prNo}</p>
                </div>
              </div>
            )}
            {order.poNo && (
              <div className="flex items-start gap-2">
                <TruckIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                <div>
                  <p className="text-[10px] text-muted-foreground">Purchase Order No.</p>
                  <p className="text-xs font-mono">{order.poNo}</p>
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
              {order.approvedAt && (
                <div className="flex items-start gap-2">
                  <CheckIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                  <div>
                    <p className="text-[10px] text-muted-foreground">Approved</p>
                    <p className="text-xs">{fmtDate(order.approvedAt)}</p>
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
