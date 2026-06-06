"use client";

import { useRouter } from "next/navigation";
import { type GoodsReceiptWithItems } from "@/server/goods-receipt";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { ArrowLeftIcon, CalendarIcon, BuildingIcon, TruckIcon } from "lucide-react";

const fmtDate = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" }) : "—";

interface Props {
  gr: GoodsReceiptWithItems;
  purchaseOrderId: string;
}

export function GoodsReceiptDetailClient({ gr, purchaseOrderId }: Props) {
  const router = useRouter();
  const poRef = gr.purchaseOrderNo ?? gr.purchaseOrderPrNo ?? purchaseOrderId;

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
                      return (
                        <tr key={item.id} className="border-b border-border/40 last:border-0">
                          <td className="py-2 pr-3 font-mono text-muted-foreground">{item.productCode || "—"}</td>
                          <td className="py-2 pr-3">{item.description || "—"}</td>
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
