"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { type GoodsReceiptWithItems, type GoodsReceiptItemEnriched, recallGoodsReceipt, deleteGoodsReceipt } from "@/server/goods-receipt";
import { resolveReceiptItemAction, type ReturnResolutionInput } from "@/server/packing-list";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { ArrowLeftIcon, CalendarIcon, BuildingIcon, TruckIcon, AlertTriangleIcon, CheckIcon, RotateCcwIcon, Trash2Icon, UserIcon, LinkIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { ResolveReturnDialog } from "../resolve-return-dialog";

const RESOLUTION_LABEL: Record<string, string> = {
  replacement: "replacement received",
  credited: "credited",
  written_off: "written off",
  other: "other",
};

const fmtDate = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" }) : "—";

// Full date + time, unlike fmtDate — resolving a return/repair is an
// audit-worthy action someone may look back at, so a bare date isn't
// specific enough to know who acted on it and when within that day.
const fmtDateTime = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleString("en-MY", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

interface Props {
  gr: GoodsReceiptWithItems;
  permissions: string[];
  // Shown when this is the centralized (cross-org) detail view, so it's
  // clear which org this receipt actually belongs to.
  organizationName?: string;
  // Overrides "Back" and the post-action redirect for the centralized route.
  backHref?: string;
  // Whether the caller can Mark Resolved on this receipt's org — for the
  // plain own-org view this is always true (gated by `can()` below instead);
  // for centralized it comes from getGoodsReceiptDetailCentralized's own
  // cross-org check. Recall/Delete stay restricted to the org you're
  // actually active in, regardless of this flag — see isOwnOrg below.
  canAct?: boolean;
  isOwnOrg?: boolean;
}

export function GoodsReceiptDetailClient({ gr, permissions, organizationName, backHref, canAct = true, isOwnOrg = true }: Props) {
  const router = useRouter();
  const [items, setItems] = useState(gr.items);
  const [status, setStatus] = useState(gr.status);
  const [resolving, setResolving] = useState<string | null>(null);
  const [recalling, setRecalling] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [resolvingReturnItem, setResolvingReturnItem] = useState<GoodsReceiptItemEnriched | null>(null);
  const [submittingReturn, setSubmittingReturn] = useState(false);
  const can = (p: string) => canAct && (permissions.includes("*") || permissions.includes(p));
  const isOwner = isOwnOrg && permissions.includes("*");
  const purchaseOrderId = gr.purchaseOrderId;
  const poRef = gr.purchaseOrderNo ?? gr.purchaseOrderPrNo ?? purchaseOrderId;
  const listHref = backHref ?? "/dashboard/procurement/goods-receipt";
  const poHref = isOwnOrg
    ? `/dashboard/procurement/purchase-order/${purchaseOrderId}`
    : `/dashboard/procurement/purchase-order/centralized/${purchaseOrderId}`;

  async function handleRecall() {
    if (!confirm(`Recall ${gr.grNo}? This reverses the stock it added, reopens its packing list for correction if there was one, and can't be undone.`)) return;
    setRecalling(true);
    try {
      await recallGoodsReceipt(gr.id);
      setStatus("recalled");
      toast.success("Goods receipt recalled");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setRecalling(false);
    }
  }

  async function handleDelete() {
    if (!confirm(`Permanently delete ${gr.grNo}? This removes the record entirely and can't be undone.`)) return;
    setDeleting(true);
    try {
      await deleteGoodsReceipt(gr.id);
      toast.success("Goods receipt deleted");
      router.push(listHref);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
      setDeleting(false);
    }
  }

  async function handleResolveRepair(itemId: string) {
    setResolving(`${itemId}:repair`);
    try {
      const { resolvedByName, resolvedAt } = await resolveReceiptItemAction(itemId, "repair");
      setItems((prev) => prev.map((i) => i.id === itemId ? { ...i, repairStatus: "resolved", repairResolvedByName: resolvedByName, repairResolvedAt: resolvedAt } : i));
      toast.success("Marked resolved");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setResolving(null);
    }
  }

  async function handleConfirmReturnResolution(resolution: ReturnResolutionInput) {
    if (!resolvingReturnItem) return;
    const itemId = resolvingReturnItem.id;
    setSubmittingReturn(true);
    try {
      const result = await resolveReceiptItemAction(itemId, "return", resolution);
      setItems((prev) => prev.map((i) => i.id === itemId ? {
        ...i,
        returnStatus: "resolved",
        returnResolvedByName: result.resolvedByName,
        returnResolvedAt: result.resolvedAt,
        returnResolutionType: result.resolutionType,
        returnResolutionPackingListNo: result.resolutionPackingListNo,
        returnResolutionNotes: resolution.notes ?? null,
      } : i));
      toast.success("Marked resolved");
      setResolvingReturnItem(null);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSubmittingReturn(false);
    }
  }

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title={gr.grNo}
        description={`Goods Receipt${organizationName ? ` · ${organizationName}` : ""} · Against ${poRef} · ${fmtDate(gr.receivedDate)}`}
        action={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push(listHref)}
              className="gap-1.5"
            >
              <ArrowLeftIcon className="w-3.5 h-3.5" /> Back
            </Button>
            {isOwner && status !== "recalled" && (
              <Button size="sm" variant="outline" className="gap-1.5 text-destructive hover:text-destructive" disabled={recalling} onClick={handleRecall}>
                <RotateCcwIcon className="w-3.5 h-3.5" /> Recall
              </Button>
            )}
            {isOwner && status === "recalled" && (
              <Button size="sm" variant="outline" className="gap-1.5 text-destructive hover:text-destructive" disabled={deleting} onClick={handleDelete}>
                <Trash2Icon className="w-3.5 h-3.5" /> Delete
              </Button>
            )}
            {status === "recalled" && (
              <span className="text-[11px] font-medium rounded px-2 py-0.5 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400">
                Recalled
              </span>
            )}
          </div>
        }
      />

      <section className="border border-border rounded-xl p-4">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
          Items Received <span className="font-normal">({items.length})</span>
        </h2>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No items</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left pb-2 pr-3 w-20">Code</th>
                  <th className="text-left pb-2 pr-3">Description</th>
                  <th className="text-right pb-2 pr-3 w-16">Ordered</th>
                  <th className="text-right pb-2 pr-3 w-16">Received</th>
                  <th className="text-left pb-2 w-12">UOM</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const ordered = parseFloat(item.qtyOrdered ?? "0");
                  const received = parseFloat(item.qtyReceived ?? "0");
                  const pct = ordered > 0 ? Math.round((received / ordered) * 100) : 0;
                  const fullyReceived = received >= ordered;
                  const wasInspected = item.qtyGood !== null && item.qtyGood !== undefined;
                  const qtyReturn = parseFloat(item.qtyReturn ?? "0");
                  const qtyRepair = parseFloat(item.qtyRepair ?? "0");
                  return (
                    <tr key={item.id} className="border-b border-border/40 last:border-0 align-top">
                      <td className="py-2 pr-3 font-mono text-muted-foreground">{item.productCode || "—"}</td>
                      <td className="py-2 pr-3">
                        <div>{item.description || "—"}</div>
                        {wasInspected && (
                          <div className="mt-1 flex flex-wrap items-center gap-1">
                            <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-green-50 text-green-700 border border-green-200 dark:bg-green-950/40 dark:text-green-400 dark:border-green-800">
                              <CheckIcon className="w-3 h-3 shrink-0" />{item.qtyGood} accepted
                            </span>
                            {qtyReturn > 0 && (
                              <>
                                <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-red-50 text-red-700 border border-red-200 dark:bg-red-950/40 dark:text-red-400 dark:border-red-800">
                                  <AlertTriangleIcon className="w-3 h-3 shrink-0" />{item.qtyReturn} return
                                </span>
                                <span className={cn(
                                  "inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md border",
                                  item.returnStatus === "resolved"
                                    ? "bg-green-50 text-green-700 border-green-200 dark:bg-green-950/40 dark:text-green-400 dark:border-green-800"
                                    : "bg-muted text-muted-foreground border-border/60",
                                )}>
                                  {item.returnStatus === "resolved" ? "resolved" : "pending"}
                                </span>
                                {item.returnStatus === "pending" && status !== "recalled" && can("packing-list:inspect") && (
                                  <button
                                    type="button"
                                    onClick={() => setResolvingReturnItem(item)}
                                    className="text-[10px] text-blue-600 dark:text-blue-400 hover:underline"
                                  >
                                    Mark Resolved
                                  </button>
                                )}
                                {item.returnNotes && (
                                  <p className="w-full text-[10px] text-muted-foreground mt-0.5">{item.returnNotes}</p>
                                )}
                                {item.returnStatus === "resolved" && item.returnResolvedByName && (
                                  <span className="w-full flex flex-col items-start gap-0.5 text-[10px] px-1.5 py-1 mt-0.5 rounded-md bg-green-50 text-green-700 border border-green-200 dark:bg-green-950/40 dark:text-green-400 dark:border-green-800">
                                    <span className="flex items-center gap-1">
                                      <UserIcon className="w-3 h-3 shrink-0" />
                                      Resolved by {item.returnResolvedByName}
                                      {item.returnResolvedAt && ` · ${fmtDateTime(item.returnResolvedAt)}`}
                                    </span>
                                    {item.returnResolutionType && (
                                      <span className="flex items-center gap-1 opacity-90">
                                        {RESOLUTION_LABEL[item.returnResolutionType] ?? item.returnResolutionType}
                                        {item.returnResolutionType === "replacement" && item.returnResolutionPackingListNo && (
                                          <>
                                            {" · "}
                                            <button
                                              type="button"
                                              onClick={() => router.push(`/dashboard/procurement/packing-list/${item.returnResolutionPackingListId}`)}
                                              className="inline-flex items-center gap-0.5 underline hover:no-underline"
                                            >
                                              {item.returnResolutionPackingListNo} <LinkIcon className="w-2.5 h-2.5 shrink-0" />
                                            </button>
                                          </>
                                        )}
                                      </span>
                                    )}
                                    {item.returnResolutionNotes && (
                                      <span className="italic opacity-90">&ldquo;{item.returnResolutionNotes}&rdquo;</span>
                                    )}
                                  </span>
                                )}
                              </>
                            )}
                            {qtyRepair > 0 && (
                              <>
                                <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-orange-50 text-orange-700 border border-orange-200 dark:bg-orange-950/40 dark:text-orange-400 dark:border-orange-800">
                                  <AlertTriangleIcon className="w-3 h-3 shrink-0" />{item.qtyRepair} repair
                                </span>
                                <span className={cn(
                                  "inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md border",
                                  item.repairStatus === "resolved"
                                    ? "bg-green-50 text-green-700 border-green-200 dark:bg-green-950/40 dark:text-green-400 dark:border-green-800"
                                    : "bg-muted text-muted-foreground border-border/60",
                                )}>
                                  {item.repairStatus === "resolved" ? "resolved" : "pending"}
                                </span>
                                {item.repairStatus === "pending" && status !== "recalled" && can("packing-list:inspect") && (
                                  <button
                                    type="button"
                                    disabled={resolving === `${item.id}:repair`}
                                    onClick={() => handleResolveRepair(item.id)}
                                    className="text-[10px] text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50"
                                  >
                                    Mark Resolved
                                  </button>
                                )}
                                {item.repairNotes && (
                                  <p className="w-full text-[10px] text-muted-foreground mt-0.5">{item.repairNotes}</p>
                                )}
                                {item.repairStatus === "resolved" && item.repairResolvedByName && (
                                  <span className="w-full inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 mt-0.5 rounded-md bg-green-50 text-green-700 border border-green-200 dark:bg-green-950/40 dark:text-green-400 dark:border-green-800">
                                    <UserIcon className="w-3 h-3 shrink-0" />
                                    Resolved by {item.repairResolvedByName}
                                    {item.repairResolvedAt && ` · ${fmtDateTime(item.repairResolvedAt)}`}
                                  </span>
                                )}
                              </>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{item.qtyOrdered}</td>
                      <td className="py-2 pr-3 text-right tabular-nums font-medium">
                        <span className={fullyReceived ? "text-green-600 dark:text-green-400" : "text-amber-600 dark:text-amber-400"}>
                          {item.qtyReceived}
                        </span>
                        <span className="text-muted-foreground ml-1 font-normal">({pct}%)</span>
                      </td>
                      <td className="py-2 text-muted-foreground">{item.uom || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-5">
          {gr.notes && (
            <section className="border border-border rounded-xl p-4">
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Notes</h2>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{gr.notes}</p>
            </section>
          )}
        </div>

        {/* Right — details */}
        <div className="space-y-5">
          <section className="border border-border rounded-xl p-4 space-y-3">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Details</h2>
            <div className="flex items-start gap-2">
              <TruckIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
              <div>
                <p className="text-[10px] text-muted-foreground">GR Number</p>
                <p className="text-xs font-mono font-medium">{gr.grNo}</p>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <TruckIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
              <div>
                <p className="text-[10px] text-muted-foreground">Against PO</p>
                <button
                  onClick={() => router.push(poHref)}
                  className="text-xs font-mono text-primary hover:underline"
                >
                  {poRef}
                </button>
              </div>
            </div>
            {gr.packingListId && (
              <div className="flex items-start gap-2">
                <TruckIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                <div>
                  <p className="text-[10px] text-muted-foreground">From Packing List</p>
                  <button
                    onClick={() => router.push(`/dashboard/procurement/packing-list/${gr.packingListId}`)}
                    className="text-xs font-mono text-primary hover:underline"
                  >
                    View packing list
                  </button>
                </div>
              </div>
            )}
            <div className="flex items-start gap-2">
              <CalendarIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
              <div>
                <p className="text-[10px] text-muted-foreground">Received Date</p>
                <p className="text-xs">{fmtDate(gr.receivedDate)}</p>
              </div>
            </div>
            {gr.receivedByName && (
              <div className="flex items-start gap-2">
                <BuildingIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                <div>
                  <p className="text-[10px] text-muted-foreground">Received by</p>
                  <p className="text-xs">{gr.receivedByName}</p>
                </div>
              </div>
            )}
            <div className="flex items-start gap-2">
              <CalendarIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
              <div>
                <p className="text-[10px] text-muted-foreground">Recorded</p>
                <p className="text-xs">{fmtDate(gr.createdAt)}</p>
              </div>
            </div>
          </section>
        </div>
      </div>

      {resolvingReturnItem && (
        <ResolveReturnDialog
          key={resolvingReturnItem.id}
          supplierId={gr.supplierId}
          targetOrgId={gr.organizationId}
          itemLabel={resolvingReturnItem.productCode || resolvingReturnItem.description || "this item"}
          qty={parseFloat(resolvingReturnItem.qtyReturn ?? "0") || 0}
          uom={resolvingReturnItem.uom}
          submitting={submittingReturn}
          onConfirm={handleConfirmReturnResolution}
          onClose={() => setResolvingReturnItem(null)}
        />
      )}
    </div>
  );
}
