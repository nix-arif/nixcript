"use client";

import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { OrgMember } from "@/server/field-stock";
import { transferToRep, returnFromRep, getRepFieldStock } from "@/server/field-stock";
import { searchProducts } from "@/server/inventory";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/page-header";
import { ArrowLeftIcon, PlusIcon, TrashIcon, SearchIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type Direction = "to_rep" | "from_rep";

interface LineItem {
  _key: string;
  productId: string;
  productCode: string;
  description: string;
  uom: string;
  qty: string;
  maxQty?: number;
}

const newLine = (): LineItem => ({
  _key: crypto.randomUUID(),
  productId: "", productCode: "", description: "", uom: "", qty: "1",
});

interface Props {
  reps: OrgMember[];
}

export function TransferClient({ reps }: Props) {
  const router = useRouter();
  const [direction, setDirection] = useState<Direction>("to_rep");
  const [repId, setRepId] = useState(reps[0]?.id ?? "");
  const [items, setItems] = useState<LineItem[]>([newLine()]);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [loadingRepStock, setLoadingRepStock] = useState(false);

  const selectedRep = reps.find((r) => r.id === repId);

  async function handleRepChange(id: string) {
    setRepId(id);
    if (direction === "from_rep" && id) {
      setLoadingRepStock(true);
      try {
        const stock = await getRepFieldStock(id);
        setItems(stock.map((s) => ({
          _key: crypto.randomUUID(),
          productId: s.productId,
          productCode: s.productCode,
          description: s.description,
          uom: s.uom ?? "",
          qty: "0",
          maxQty: s.qty,
        })));
      } catch {
        setItems([newLine()]);
      } finally {
        setLoadingRepStock(false);
      }
    }
  }

  async function handleDirectionChange(d: Direction) {
    setDirection(d);
    setItems([newLine()]);
    if (d === "from_rep" && repId) {
      await handleRepChange(repId);
    }
  }

  function updateItem(key: string, patch: Partial<LineItem>) {
    setItems((prev) => prev.map((i) => i._key === key ? { ...i, ...patch } : i));
  }

  function removeItem(key: string) {
    setItems((prev) => prev.filter((i) => i._key !== key));
  }

  function ProductCell({ item }: { item: LineItem }) {
    const [q, setQ] = useState(item.productCode);
    const [results, setResults] = useState<{ id: string; productCode: string; description: string | null; uom: string | null }[]>([]);
    const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

    function handleInput(val: string) {
      setQ(val);
      updateItem(item._key, { productCode: val, productId: "", description: "", uom: "" });
      if (debounce.current) clearTimeout(debounce.current);
      if (!val.trim()) { setResults([]); return; }
      debounce.current = setTimeout(async () => {
        const r = await searchProducts(val);
        setResults(r);
        const exact = r.find((p) => p.productCode.toLowerCase() === val.trim().toLowerCase());
        if (exact) {
          updateItem(item._key, { productId: exact.id, productCode: exact.productCode, description: exact.description ?? "", uom: exact.uom ?? "" });
          setResults([]);
        }
      }, 300);
    }

    function pick(p: typeof results[0]) {
      updateItem(item._key, { productId: p.id, productCode: p.productCode, description: p.description ?? "", uom: p.uom ?? "" });
      setQ(p.productCode);
      setResults([]);
    }

    return (
      <div className="relative">
        <Input value={q} onChange={(e) => handleInput(e.target.value)} className="h-7 text-xs" placeholder="Code…" />
        {results.length > 0 && (
          <div className="absolute z-50 top-full left-0 mt-0.5 w-56 rounded-md border border-border bg-background shadow-md max-h-40 overflow-y-auto text-xs">
            {results.map((p) => (
              <button key={p.id} type="button" className="w-full text-left px-2 py-1.5 hover:bg-accent flex gap-2" onClick={() => pick(p)}>
                <span className="font-mono font-medium">{p.productCode}</span>
                <span className="text-muted-foreground truncate">{p.description ?? ""}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  async function handleSave() {
    if (!repId) { toast.error("Select a rep"); return; }
    const validItems = items.filter((i) => i.productId && parseFloat(i.qty) > 0);
    if (validItems.length === 0) { toast.error("Add at least one item with qty > 0"); return; }

    setSaving(true);
    try {
      const fn = direction === "to_rep" ? transferToRep : returnFromRep;
      const ref = await fn({
        repId,
        repName: selectedRep?.name ?? repId,
        items: validItems.map((i) => ({ productId: i.productId, qty: parseFloat(i.qty) })),
        notes: notes || undefined,
      });
      toast.success(`${direction === "to_rep" ? "Transfer" : "Return"} recorded — ${ref}`);
      router.push("/dashboard/inventory/field-stock");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-6">
      <PageHeader
        title="Field Stock Transfer"
        description="Move stock between the warehouse and a sales rep's field holding."
        action={
          <Button variant="outline" size="sm" onClick={() => router.push("/dashboard/inventory/field-stock")} className="gap-2">
            <ArrowLeftIcon className="w-3.5 h-3.5" /> Back
          </Button>
        }
      />

      <div className="space-y-6 max-w-2xl">

        {/* Direction */}
        <section className="border border-border rounded-xl p-4">
          <h2 className="text-sm font-semibold mb-3">Direction</h2>
          <div className="grid grid-cols-2 gap-2">
            {([
              { key: "to_rep",   label: "Send to rep",         desc: "Warehouse → Rep's field stock" },
              { key: "from_rep", label: "Return from rep",     desc: "Rep's field stock → Warehouse" },
            ] as const).map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => handleDirectionChange(opt.key)}
                className={cn(
                  "rounded-lg border p-3 text-left transition-colors",
                  direction === opt.key
                    ? "border-primary bg-primary/5"
                    : "border-border hover:bg-muted/40",
                )}
              >
                <p className="text-sm font-medium">{opt.label}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{opt.desc}</p>
              </button>
            ))}
          </div>
        </section>

        {/* Rep selection */}
        <section className="border border-border rounded-xl p-4">
          <h2 className="text-sm font-semibold mb-3">Sales Rep</h2>
          <select
            value={repId}
            onChange={(e) => handleRepChange(e.target.value)}
            className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm"
          >
            <option value="">Select rep…</option>
            {reps.map((r) => (
              <option key={r.id} value={r.id}>{r.name} ({r.role})</option>
            ))}
          </select>
        </section>

        {/* Items */}
        <section className="border border-border rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold">Items</h2>
            {direction === "to_rep" && (
              <Button variant="outline" size="sm" className="gap-1.5 h-7 text-xs" onClick={() => setItems((p) => [...p, newLine()])}>
                <PlusIcon className="w-3 h-3" /> Add row
              </Button>
            )}
          </div>

          {loadingRepStock ? (
            <p className="text-sm text-muted-foreground py-4 text-center">Loading rep's stock…</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="text-left pb-2 pr-2 w-28">Product Code</th>
                    <th className="text-left pb-2 pr-2">Description</th>
                    <th className="text-left pb-2 pr-2 w-14">UOM</th>
                    <th className="text-right pb-2 pr-2 w-20">
                      Qty {direction === "from_rep" ? "to Return" : ""}
                    </th>
                    {direction === "from_rep" && <th className="text-right pb-2 pr-2 w-16">Holding</th>}
                    {direction === "to_rep" && <th className="w-6" />}
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item._key} className="border-b border-border/50 last:border-0">
                      <td className="py-1.5 pr-2">
                        {direction === "from_rep"
                          ? <span className="font-mono font-medium">{item.productCode}</span>
                          : <ProductCell item={item} />
                        }
                      </td>
                      <td className="py-1.5 pr-2">
                        {direction === "from_rep"
                          ? <span className="text-muted-foreground">{item.description}</span>
                          : <Input value={item.description} onChange={(e) => updateItem(item._key, { description: e.target.value })} className="h-7 text-xs" />
                        }
                      </td>
                      <td className="py-1.5 pr-2 text-muted-foreground">{item.uom || "—"}</td>
                      <td className="py-1.5 pr-2">
                        <Input
                          type="number" min="0" max={item.maxQty}
                          value={item.qty}
                          onChange={(e) => updateItem(item._key, { qty: e.target.value })}
                          className="h-7 text-xs text-right"
                        />
                      </td>
                      {direction === "from_rep" && (
                        <td className="py-1.5 pr-2 text-right text-muted-foreground tabular-nums">
                          {item.maxQty?.toFixed(0) ?? "—"}
                        </td>
                      )}
                      {direction === "to_rep" && (
                        <td className="py-1.5">
                          <button onClick={() => removeItem(item._key)} disabled={items.length === 1}
                            className="text-muted-foreground hover:text-destructive transition-colors disabled:opacity-30">
                            <TrashIcon className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Notes */}
        <section className="border border-border rounded-xl p-4">
          <h2 className="text-sm font-semibold mb-3">Notes (optional)</h2>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="text-sm" placeholder="Reason for transfer…" />
        </section>

        <div className="flex gap-3 pb-8">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : direction === "to_rep" ? "Transfer to Rep" : "Record Return"}
          </Button>
          <Button variant="outline" onClick={() => router.push("/dashboard/inventory/field-stock")}>Cancel</Button>
        </div>
      </div>
    </div>
  );
}
