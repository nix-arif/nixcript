"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { type GoodsReceiptWithItems } from "@/server/goods-receipt";
import { resolveReceiptItemAction } from "@/server/packing-list";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { ArrowLeftIcon, CalendarIcon, BuildingIcon, TruckIcon, AlertTriangleIcon, CheckIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const fmtDate = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" }) : "—";

interface Props {
  gr: GoodsReceiptWithItems;
  purchaseOrderId: string;
  permissions: string[];
}

export function GoodsReceiptDetailClient({ gr, purchaseOrderId, permissions }: Props) {
  const router = useRouter();
  const [resolving, setResolving] = useState<string | null>(null);
  const can = (p: string) => permissions.includes("*") || permissions.includes(p);
  const poRef = gr.purchaseOrderNo ?? gr.purchaseOrderPrNo ?? purchaseOrderId;

  async function handleResolve(itemId: string, actionType: "return" | "repair") {
    setResolving(`${itemId}:${actionType}`);
    try {
      await resolveReceiptItemAction(itemId, actionType);
      toast.success("Marked resolved");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setResolving(null);
    }
  }

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title={gr.grNo}
        description={`Goods Receipt · Against ${poRef} · ${fmtDate(gr.receivedDate)}`}
        action={
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push(`/dashboard/procurement/purchase-order/${purchaseOrderId}`)}
            className="gap-1.5"
          >
            <ArrowLeftIcon className="w-3.5 h-3.5" /> Back to PO
          </Button>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left — items */}
        <div className="lg:col-span-2 space-y-5">
          <section className="border border-border rounded-xl p-4">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              Items Received <span className="font-normal">({gr.items.length})</span>
            </h2>
            {gr.items.length === 0 ? (
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
                    {gr.items.map((item) => {
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
                                    {item.returnStatus === "pending" && can("packing-list:inspect") && (
                                      <button
                                        type="button"
                                        disabled={resolving === `${item.id}:return`}
                                        onClick={() => handleResolve(item.id, "return")}
                                        className="text-[10px] text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50"
                                      >
                                        Mark Resolved
                                      </button>
                                    )}
                                    {item.returnNotes && (
                                      <p className="w-full text-[10px] text-muted-foreground mt-0.5">{item.returnNotes}</p>
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
                                    {item.repairStatus === "pending" && can("packing-list:inspect") && (
                                      <button
                                        type="button"
                                        disabled={resolving === `${item.id}:repair`}
                                        onClick={() => handleResolve(item.id, "repair")}
                                        className="text-[10px] text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50"
                                      >
                                        Mark Resolved
                                      </button>
                                    )}
                                    {item.repairNotes && (
                                      <p className="w-full text-[10px] text-muted-foreground mt-0.5">{item.repairNotes}</p>
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
                  onClick={() => router.push(`/dashboard/procurement/purchase-order/${purchaseOrderId}`)}
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
    </div>
  );
}
