"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createGoodsReceipt, type GoodsReceiptItemInput } from "@/server/goods-receipt";
import { type PurchaseOrderWithItems } from "@/server/purchase-order";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/page-header";
import { ArrowLeftIcon, TruckIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  order: PurchaseOrderWithItems;
}

export function CreateGoodsReceiptClient({ order }: Props) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [receivedDate, setReceivedDate] = useState<string>(
    new Date().toISOString().split("T")[0],
  );
  const [notes, setNotes] = useState("");
  const [quantities, setQuantities] = useState<Record<string, string>>(
    Object.fromEntries(order.items.map((item) => [item.id, item.qty ?? "0"])),
  );

  const poDocNo = order.poNo ?? order.prNo ?? order.id;

  function setQty(itemId: string, val: string) {
    setQuantities((prev) => ({ ...prev, [itemId]: val }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!receivedDate) {
      toast.error("Received date is required");
      return;
    }

    const items: GoodsReceiptItemInput[] = order.items.map((item) => ({
      purchaseOrderItemId: item.id,
      productId: item.productId ?? undefined,
      productCode: item.productCode ?? undefined,
      description: item.description ?? undefined,
      qtyOrdered: item.qty ?? "0",
      qtyReceived: quantities[item.id] ?? "0",
      uom: item.uom ?? undefined,
      unitPrice: item.unitPrice ?? undefined,
      currency: item.currency ?? undefined,
    }));

    const totalReceived = items.reduce((sum, i) => sum + parseFloat(i.qtyReceived || "0"), 0);
    if (totalReceived <= 0) {
      toast.error("At least one item must have a quantity received greater than 0");
      return;
    }

    setSaving(true);
    try {
      const gr = await createGoodsReceipt({
        purchaseOrderId: order.id,
        receivedDate: new Date(receivedDate),
        notes: notes || undefined,
        items,
      });
      toast.success(`Goods receipt ${gr.grNo} recorded`);
      router.push(`/dashboard/procurement/purchase-order/${order.id}/goods-receipt/${gr.id}`);
    } catch (e: any) {
      toast.error(e.message);
      setSaving(false);
    }
  }

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Record Goods Receipt"
        description={`Against supplier PO ${poDocNo}`}
        action={
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push(`/dashboard/procurement/purchase-order/${order.id}`)}
            className="gap-1.5"
          >
            <ArrowLeftIcon className="w-3.5 h-3.5" /> Back to PO
          </Button>
        }
      />

      <form onSubmit={handleSubmit} className="space-y-5 max-w-2xl">
        {/* Header fields */}
        <section className="border border-border rounded-xl p-4 space-y-4">
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Receipt Details</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Received Date <span className="text-destructive">*</span></label>
              <Input
                type="date"
                value={receivedDate}
                onChange={(e) => setReceivedDate(e.target.value)}
                className="h-9 text-sm"
                required
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Notes</label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Delivery note number, condition remarks…"
              className="text-sm resize-none"
              rows={2}
            />
          </div>
        </section>

        {/* Items */}
        <section className="border border-border rounded-xl p-4">
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            Items Received
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left pb-2 pr-3 w-6">#</th>
                  <th className="text-left pb-2 pr-3 w-20">Code</th>
                  <th className="text-left pb-2 pr-3">Description</th>
                  <th className="text-right pb-2 pr-3 w-16">Ordered</th>
                  <th className="text-left pb-2 pr-3 w-12">UOM</th>
                  <th className="text-right pb-2 w-24">Received</th>
                </tr>
              </thead>
              <tbody>
                {order.items.map((item) => {
                  const ordered = parseFloat(item.qty ?? "0");
                  const received = parseFloat(quantities[item.id] ?? "0");
                  const overReceived = received > ordered;
                  return (
                    <tr key={item.id} className="border-b border-border/40 last:border-0">
                      <td className="py-2 pr-3 text-muted-foreground">{item.rowNo}</td>
                      <td className="py-2 pr-3 font-mono text-muted-foreground">{item.productCode || "—"}</td>
                      <td className="py-2 pr-3">{item.description || "—"}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{item.qty}</td>
                      <td className="py-2 pr-3 text-muted-foreground">{item.uom || "—"}</td>
                      <td className="py-2">
                        <Input
                          type="number"
                          min="0"
                          step="any"
                          value={quantities[item.id] ?? ""}
                          onChange={(e) => setQty(item.id, e.target.value)}
                          className={cn(
                            "h-7 text-xs text-right tabular-nums w-24 ml-auto",
                            overReceived && "border-amber-400 focus-visible:ring-amber-400",
                          )}
                        />
                        {overReceived && (
                          <p className="text-[10px] text-amber-600 text-right mt-0.5">Exceeds ordered qty</p>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <div className="flex gap-3">
          <Button type="submit" disabled={saving} className="gap-1.5">
            <TruckIcon className="w-3.5 h-3.5" />
            {saving ? "Saving…" : "Record Goods Receipt"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push(`/dashboard/procurement/purchase-order/${order.id}`)}
          >
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
