"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { OrgMember } from "@/server/field-stock";
import { transferToRep, returnFromRep, getRepFieldStock, getWarehouseStockQty } from "@/server/field-stock";
import { searchProducts } from "@/server/inventory";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/page-header";
import { ArrowLeftIcon, PlusIcon, TrashIcon, ArrowRightIcon, ArrowLeftRightIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { uid } from "@/lib/uid";

type Direction = "to_rep" | "from_rep";

interface LineItem {
  _key: string;
  productId: string;
  productCode: string;
  description: string;
  uom: string;
  qty: string;
  maxQty?: number;     // for from_rep: rep's holding
  availableQty?: number; // for to_rep: main warehouse stock
}

const newLine = (): LineItem => ({
  _key: uid(),
  productId: "", productCode: "", description: "", uom: "", qty: "1",
});

// ── Defined at module level to prevent remount on parent re-render ──────────

interface ProductCellProps {
  item: LineItem;
  onUpdate: (key: string, patch: Partial<LineItem>) => void;
}

function ProductCell({ item, onUpdate }: ProductCellProps) {
  const [q, setQ] = useState(item.productCode);
  const [results, setResults] = useState<{ id: string; productCode: string; description: string | null; uom: string | null }[]>([]);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleInput(val: string) {
    setQ(val);
    onUpdate(item._key, { productCode: val, productId: "", description: "", uom: "" });
    if (debounce.current) clearTimeout(debounce.current);
    if (!val.trim()) { setResults([]); return; }
    debounce.current = setTimeout(async () => {
      const r = await searchProducts(val);
      setResults(r);
      const exact = r.find((p) => p.productCode.toLowerCase() === val.trim().toLowerCase());
      if (exact) {
        onUpdate(item._key, { productId: exact.id, productCode: exact.productCode, description: exact.description ?? "", uom: exact.uom ?? "" });
        setQ(exact.productCode);
        setResults([]);
      }
    }, 300);
  }

  async function pick(p: typeof results[0]) {
    onUpdate(item._key, { productId: p.id, productCode: p.productCode, description: p.description ?? "", uom: p.uom ?? "", availableQty: undefined });
    setQ(p.productCode);
    setResults([]);
    // Fetch available stock from Default warehouse
    const qty = await getWarehouseStockQty(p.id, "Default");
    onUpdate(item._key, { availableQty: qty });
  }

  return (
    <div className="relative">
      <Input value={q} onChange={(e) => handleInput(e.target.value)} className="h-8 text-sm" placeholder="Code / name…" />
      {results.length > 0 && (
        <div className="absolute z-50 top-full left-0 mt-0.5 w-72 rounded-md border border-border bg-background shadow-md max-h-48 overflow-y-auto text-xs">
          {results.map((p) => (
            <button key={p.id} type="button"
              className="w-full text-left px-3 py-2 hover:bg-accent flex flex-col gap-0.5"
              onMouseDown={() => { pick(p); }}
            >
              <span className="font-mono font-medium">{p.productCode}</span>
              {p.description && <span className="text-muted-foreground">{p.description}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

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

  async function loadRepStock(id: string) {
    if (!id) { setItems([newLine()]); return; }
    setLoadingRepStock(true);
    try {
      const stock = await getRepFieldStock(id);
      setItems(stock.length > 0
        ? stock.map((s) => ({
            _key: uid(),
            productId: s.productId,
            productCode: s.productCode,
            description: s.description,
            uom: s.uom ?? "",
            qty: "0",
            maxQty: s.qty,
          }))
        : [newLine()]);
    } catch {
      setItems([newLine()]);
    } finally {
      setLoadingRepStock(false);
    }
  }

  async function handleRepChange(id: string) {
    setRepId(id);
    if (direction === "from_rep") await loadRepStock(id);
  }

  async function handleDirectionChange(d: Direction) {
    setDirection(d);
    if (d === "from_rep") {
      await loadRepStock(repId);
    } else {
      setItems([newLine()]);
    }
  }

  function updateItem(key: string, patch: Partial<LineItem>) {
    setItems((prev) => prev.map((i) => i._key === key ? { ...i, ...patch } : i));
  }

  function removeItem(key: string) {
    setItems((prev) => prev.filter((i) => i._key !== key));
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
    <div className="p-6 space-y-6">
      <PageHeader
        title="Field Stock Transfer"
        description="Move stock between the main warehouse and a sales rep's field holding."
        action={
          <Button variant="outline" size="sm" onClick={() => router.push("/dashboard/inventory/field-stock")} className="gap-2">
            <ArrowLeftIcon className="w-3.5 h-3.5" /> Back
          </Button>
        }
      />

      {/* Direction */}
      <section className="border border-border rounded-xl p-4">
        <h2 className="text-sm font-semibold mb-3">Direction</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {([
            {
              key: "to_rep" as const,
              icon: ArrowRightIcon,
              label: "Send to Rep",
              desc: "Warehouse → Rep's field stock",
              accent: "border-teal-300 dark:border-teal-700 hover:bg-teal-50 dark:hover:bg-teal-900/20",
              active: "border-teal-500 bg-teal-50 dark:bg-teal-900/20",
            },
            {
              key: "from_rep" as const,
              icon: ArrowLeftIcon,
              label: "Return from Rep",
              desc: "Rep's field stock → Warehouse",
              accent: "border-orange-300 dark:border-orange-700 hover:bg-orange-50 dark:hover:bg-orange-900/20",
              active: "border-orange-500 bg-orange-50 dark:bg-orange-900/20",
            },
          ]).map((opt) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => handleDirectionChange(opt.key)}
              className={cn(
                "rounded-xl border-2 p-4 text-left transition-colors",
                direction === opt.key ? opt.active : `border-border bg-card ${opt.accent}`,
              )}
            >
              <div className="flex items-center gap-2 mb-1">
                <opt.icon className="w-4 h-4" />
                <p className="text-sm font-semibold">{opt.label}</p>
              </div>
              <p className="text-xs text-muted-foreground">{opt.desc}</p>
            </button>
          ))}
        </div>
      </section>

      {/* Rep */}
      <section className="border border-border rounded-xl p-4">
        <h2 className="text-sm font-semibold mb-3">Sales Rep</h2>
        <select
          value={repId}
          onChange={(e) => handleRepChange(e.target.value)}
          className="w-full h-10 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">Select rep…</option>
          {reps.map((r) => (
            <option key={r.id} value={r.id}>{r.name} ({r.role})</option>
          ))}
        </select>
      </section>

      {/* Items */}
      <section className="border border-border rounded-xl p-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-semibold">Items</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {direction === "to_rep"
                ? "Products to send to rep's field stock"
                : `Products to return from ${selectedRep?.name ?? "rep"}'s field stock`}
            </p>
          </div>
          {direction === "to_rep" && (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setItems((p) => [...p, newLine()])}>
              <PlusIcon className="w-3.5 h-3.5" /> Add item
            </Button>
          )}
        </div>

        {loadingRepStock ? (
          <p className="text-sm text-muted-foreground py-6 text-center">Loading rep's stock…</p>
        ) : direction === "to_rep" ? (
          /* ── Send to rep: free-entry rows ── */
          <div className="space-y-3">
            {items.map((item, idx) => (
              <div key={item._key} className="grid grid-cols-[auto_1fr_1fr_auto_auto] items-center gap-3 p-3 rounded-lg border border-border/60 bg-muted/20">
                <span className="text-xs text-muted-foreground w-5 text-center">{idx + 1}</span>
                <div className="space-y-1">
                  <Label className="text-xs">Product</Label>
                  <ProductCell item={item} onUpdate={updateItem} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Description</Label>
                  <Input
                    value={item.description}
                    onChange={(e) => updateItem(item._key, { description: e.target.value })}
                    className="h-8 text-sm"
                    placeholder="Auto-filled or override"
                  />
                </div>
                <div className="space-y-1 w-28">
                  <Label className="text-xs">
                    Qty {item.uom ? `(${item.uom})` : ""}
                  </Label>
                  <Input
                    type="number" min="0.0001" step="any"
                    value={item.qty}
                    onChange={(e) => updateItem(item._key, { qty: e.target.value })}
                    className={cn(
                      "h-8 text-sm text-right",
                      item.availableQty !== undefined && parseFloat(item.qty) > item.availableQty
                        ? "border-destructive focus-visible:ring-destructive"
                        : "",
                    )}
                  />
                  {item.availableQty !== undefined && (
                    parseFloat(item.qty) > item.availableQty ? (
                      <p className="text-xs text-destructive font-medium">
                        Only {item.availableQty} available
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        Stock: {item.availableQty}
                      </p>
                    )
                  )}
                </div>
                <button
                  onClick={() => removeItem(item._key)}
                  disabled={items.length === 1}
                  className="mt-5 text-muted-foreground hover:text-destructive transition-colors disabled:opacity-30"
                >
                  <TrashIcon className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          /* ── Return from rep: pre-loaded checklist ── */
          items.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">No field stock found for this rep.</p>
          ) : (
            <div className="space-y-2">
              {items.map((item) => {
                const used = parseFloat(item.qty) > 0;
                return (
                  <div
                    key={item._key}
                    className={cn(
                      "grid grid-cols-[1fr_auto_auto] items-center gap-4 px-4 py-3 rounded-lg border transition-colors",
                      used ? "border-orange-300 dark:border-orange-700 bg-orange-50/50 dark:bg-orange-900/10" : "border-border/60",
                    )}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-mono font-medium">{item.productCode}</p>
                      <p className="text-xs text-muted-foreground truncate">{item.description}</p>
                    </div>
                    <p className="text-xs text-muted-foreground whitespace-nowrap">
                      Holding: <span className="font-medium tabular-nums">{item.maxQty?.toFixed(0)}</span> {item.uom}
                    </p>
                    <div className="w-28 space-y-1">
                      <Label className="text-xs">Return qty</Label>
                      <Input
                        type="number" min="0" max={item.maxQty} step="any"
                        value={item.qty}
                        onChange={(e) => updateItem(item._key, { qty: e.target.value })}
                        className={cn("h-8 text-sm text-right", used ? "border-orange-400 dark:border-orange-600" : "")}
                        placeholder="0"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )
        )}
      </section>

      {/* Notes */}
      <section className="border border-border rounded-xl p-4">
        <h2 className="text-sm font-semibold mb-2">Notes <span className="font-normal text-muted-foreground">(optional)</span></h2>
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="text-sm" placeholder="Reason for transfer…" />
      </section>

      <div className="flex gap-3 pb-8">
        <Button onClick={handleSave} disabled={saving} size="lg">
          {saving ? "Saving…" : direction === "to_rep" ? "Transfer to Rep" : "Record Return"}
        </Button>
        <Button variant="outline" size="lg" onClick={() => router.push("/dashboard/inventory/field-stock")}>Cancel</Button>
      </div>
    </div>
  );
}
