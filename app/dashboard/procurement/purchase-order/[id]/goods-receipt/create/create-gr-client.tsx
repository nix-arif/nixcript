"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createGoodsReceipt, type GoodsReceiptItemInput } from "@/server/goods-receipt";
import { searchProducts } from "@/server/inventory";
import { type PurchaseOrderWithItems } from "@/server/purchase-order";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/page-header";
import { ArrowLeftIcon, TruckIcon, LinkIcon, XIcon, AlertCircleIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// ── Product link autocomplete (for items with no productId) ───────────────────

type ProductHit = { id: string; productCode: string | null; description: string | null; uom: string | null };

function ProductLinkCell({
  linked,
  onSelect,
  onClear,
}: {
  linked: ProductHit | null;
  onSelect: (p: ProductHit) => void;
  onClear: () => void;
}) {
  const [query, setQuery]     = useState("");
  const [results, setResults] = useState<ProductHit[]>([]);
  const [open, setOpen]       = useState(false);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function close(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  useEffect(() => {
    if (query.length < 2) { setResults([]); setOpen(false); return; }
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await searchProducts(query);
        setResults(r);
        setOpen(r.length > 0);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  if (linked) {
    return (
      <div className="flex items-center gap-1.5 mt-1">
        <LinkIcon className="w-3 h-3 text-green-600 dark:text-green-400 shrink-0" />
        <span className="text-[10px] font-mono text-green-700 dark:text-green-400 font-medium">
          {linked.productCode ?? linked.description ?? linked.id}
        </span>
        <button onClick={onClear} className="text-muted-foreground hover:text-destructive ml-auto shrink-0">
          <XIcon className="w-3 h-3" />
        </button>
      </div>
    );
  }

  return (
    <div ref={ref} className="relative mt-1">
      <div className="flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400 mb-0.5">
        <AlertCircleIcon className="w-3 h-3 shrink-0" />
        <span>No product linked — stock won&apos;t update</span>
      </div>
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search to link product…"
        className="h-6 text-[11px] border-dashed"
      />
      {loading && <span className="absolute right-2 top-1.5 text-[10px] text-muted-foreground">…</span>}
      {open && results.length > 0 && (
        <div className="absolute z-50 left-0 top-full mt-1 bg-popover border border-border rounded-lg shadow-lg text-xs w-64 max-h-48 overflow-y-auto">
          {results.map((p) => (
            <button
              key={p.id}
              type="button"
              className="w-full text-left px-3 py-2 hover:bg-muted/60 transition-colors border-b border-border/30 last:border-0"
              onClick={() => { onSelect(p); setQuery(""); setOpen(false); }}
            >
              <span className="font-mono font-medium">{p.productCode ?? "—"}</span>
              <span className="text-muted-foreground ml-2">{p.description}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main form ─────────────────────────────────────────────────────────────────

interface Props {
  order: PurchaseOrderWithItems;
}

export function CreateGoodsReceiptClient({ order }: Props) {
  const router = useRouter();
  const [saving, setSaving]           = useState(false);
  const [receivedDate, setReceivedDate] = useState<string>(new Date().toISOString().split("T")[0]);
  const [notes, setNotes]             = useState("");
  const [quantities, setQuantities]   = useState<Record<string, string>>(
    Object.fromEntries(order.items.map((item) => [item.id, item.qty ?? "0"])),
  );
  // Per-item product link for items that have no productId on the PO
  const [linkedProducts, setLinkedProducts] = useState<Record<string, ProductHit>>({});

  const poDocNo = order.poNo ?? order.prNo ?? order.id;

  function setQty(itemId: string, val: string) {
    setQuantities((prev) => ({ ...prev, [itemId]: val }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!receivedDate) { toast.error("Received date is required"); return; }

    const items: GoodsReceiptItemInput[] = order.items.map((item) => ({
      purchaseOrderItemId: item.id,
      // Use the PO's productId first; fall back to what the user linked in this form
      productId:   item.productId ?? linkedProducts[item.id]?.id ?? undefined,
      productCode: item.productCode ?? linkedProducts[item.id]?.productCode ?? undefined,
      description: item.description ?? undefined,
      qtyOrdered:  item.qty ?? "0",
      qtyReceived: quantities[item.id] ?? "0",
      uom:         item.uom ?? linkedProducts[item.id]?.uom ?? undefined,
      unitPrice:   item.unitPrice ?? undefined,
      currency:    item.currency ?? undefined,
    }));

    const totalReceived = items.reduce((sum, i) => sum + parseFloat(i.qtyReceived || "0"), 0);
    if (totalReceived <= 0) {
      toast.error("At least one item must have a quantity received greater than 0");
      return;
    }

    // Warn if some received items still have no product link
    const unlinkedWithQty = items.filter(
      (i) => !i.productId && parseFloat(i.qtyReceived || "0") > 0,
    );
    if (unlinkedWithQty.length > 0) {
      const ok = confirm(
        `${unlinkedWithQty.length} item${unlinkedWithQty.length > 1 ? "s" : ""} ` +
        `with no product link will not update inventory.\n\nContinue anyway?`
      );
      if (!ok) return;
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
      router.push(`/dashboard/procurement/goods-receipt/${gr.id}`);
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
          <Button variant="outline" size="sm" onClick={() => router.push(`/dashboard/procurement/purchase-order/${order.id}`)} className="gap-1.5">
            <ArrowLeftIcon className="w-3.5 h-3.5" /> Back to PO
          </Button>
        }
      />

      <form onSubmit={handleSubmit} className="space-y-5 max-w-2xl">
        {/* Header */}
        <section className="border border-border rounded-xl p-4 space-y-4">
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Receipt Details</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Received Date <span className="text-destructive">*</span></label>
              <Input type="date" value={receivedDate} onChange={(e) => setReceivedDate(e.target.value)} className="h-9 text-sm" required />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Notes</label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Delivery note number, condition remarks…" className="text-sm resize-none" rows={2} />
          </div>
        </section>

        {/* Items */}
        <section className="border border-border rounded-xl p-4">
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Items Received</h2>
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
                  const ordered      = parseFloat(item.qty ?? "0");
                  const received     = parseFloat(quantities[item.id] ?? "0");
                  const overReceived = received > ordered;
                  const hasProduct   = !!item.productId;

                  return (
                    <tr key={item.id} className="border-b border-border/40 last:border-0 align-top">
                      <td className="py-2.5 pr-3 text-muted-foreground">{item.rowNo}</td>
                      <td className="py-2.5 pr-3 font-mono text-muted-foreground">{item.productCode || "—"}</td>
                      <td className="py-2.5 pr-3">
                        <div>{item.description || "—"}</div>
                        {/* Product link field — only for items with no productId */}
                        {!hasProduct && (
                          <ProductLinkCell
                            linked={linkedProducts[item.id] ?? null}
                            onSelect={(p) => setLinkedProducts((prev) => ({ ...prev, [item.id]: p }))}
                            onClear={() => setLinkedProducts((prev) => {
                              const next = { ...prev };
                              delete next[item.id];
                              return next;
                            })}
                          />
                        )}
                      </td>
                      <td className="py-2.5 pr-3 text-right tabular-nums">{item.qty}</td>
                      <td className="py-2.5 pr-3 text-muted-foreground">{item.uom || "—"}</td>
                      <td className="py-2.5">
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
                        {overReceived && <p className="text-[10px] text-amber-600 text-right mt-0.5">Exceeds ordered qty</p>}
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
          <Button type="button" variant="outline" onClick={() => router.push(`/dashboard/procurement/purchase-order/${order.id}`)}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
