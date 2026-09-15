"use client";

import { useState, useRef } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { searchProducts } from "@/server/products";
import { consignStockToSiblingOrg } from "@/server/consignment-transfer";
import type { OrgMember } from "@/server/field-stock";

function ProductPicker({ onPick }: { onPick: (p: { id: string; productCode: string; description: string | null }) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ id: string; productCode: string; description: string | null }[]>([]);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleInput(val: string) {
    setQ(val);
    if (debounce.current) clearTimeout(debounce.current);
    if (val.trim().length < 2) { setResults([]); return; }
    debounce.current = setTimeout(async () => {
      const r = await searchProducts(val);
      setResults(r);
    }, 300);
  }

  return (
    <div className="relative">
      <Input value={q} onChange={(e) => handleInput(e.target.value)} placeholder="Search product code / name…" className="h-9 text-sm" />
      {results.length > 0 && (
        <div className="absolute z-50 top-full left-0 mt-1 w-full rounded-md border border-border bg-background shadow-md max-h-48 overflow-y-auto text-sm">
          {results.map((p) => (
            <button key={p.id} type="button" className="w-full text-left px-3 py-2 hover:bg-accent flex gap-2"
              onClick={() => { onPick(p); setQ(p.productCode); setResults([]); }}>
              <span className="font-mono font-medium">{p.productCode}</span>
              <span className="text-muted-foreground truncate">{p.description ?? ""}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ConsignTransferClient({ siblingOrgs, reps }: { siblingOrgs: { id: string; name: string }[]; reps: OrgMember[] }) {
  const [toOrgId, setToOrgId] = useState("");
  const [product, setProduct] = useState<{ id: string; productCode: string; description: string | null } | null>(null);
  const [quantity, setQuantity] = useState("");
  const [destinationMode, setDestinationMode] = useState<"warehouse" | "rep">("warehouse");
  const [repId, setRepId] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  function reset() {
    setProduct(null); setQuantity(""); setDestinationMode("warehouse"); setRepId(""); setNotes("");
  }

  async function handleSubmit() {
    if (!toOrgId) { toast.error("Select which organization to consign to"); return; }
    if (!product) { toast.error("Select a product"); return; }
    const qty = parseFloat(quantity);
    if (isNaN(qty) || qty <= 0) { toast.error("Enter a valid quantity"); return; }
    if (destinationMode === "rep" && !repId) { toast.error("Select which rep receives this stock"); return; }

    setSaving(true);
    try {
      await consignStockToSiblingOrg({
        toOrgId, productId: product.id, quantity: qty,
        destinationRepId: destinationMode === "rep" ? repId : undefined,
        notes: notes.trim() || undefined,
      });
      toast.success("Stock consigned successfully");
      reset();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to consign stock");
    } finally {
      setSaving(false);
    }
  }

  const toOrgName = siblingOrgs.find((o) => o.id === toOrgId)?.name;

  return (
    <div className="p-4 sm:p-6 max-w-xl space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Consign to Sibling Org</h1>
        <p className="text-sm text-muted-foreground">
          Send stock to one of your own organizations as consignment — ownership stays with you until it's actually used.
        </p>
      </div>

      <div className="rounded-lg border border-border p-4 space-y-4">
        <div className="space-y-1.5">
          <Label className="text-xs">Consign to <span className="text-destructive">*</span></Label>
          <Select value={toOrgId} onValueChange={setToOrgId}>
            <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select organization…" /></SelectTrigger>
            <SelectContent>
              {siblingOrgs.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
            </SelectContent>
          </Select>
          {siblingOrgs.length === 0 && (
            <p className="text-xs text-muted-foreground">No sibling organizations found under your owner group.</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Product <span className="text-destructive">*</span></Label>
          {product ? (
            <div className="flex items-center justify-between rounded-md border border-input px-2.5 py-2 text-sm">
              <span><span className="font-mono font-medium">{product.productCode}</span> {product.description && <span className="text-muted-foreground ml-1.5">{product.description}</span>}</span>
              <button type="button" className="text-muted-foreground hover:text-destructive text-xs" onClick={() => setProduct(null)}>✕</button>
            </div>
          ) : (
            <ProductPicker onPick={setProduct} />
          )}
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Quantity <span className="text-destructive">*</span></Label>
          <Input type="number" min="0.0001" step="0.0001" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="0" className="h-9 text-sm" />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Destination at {toOrgName ?? "the receiving org"}</Label>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setDestinationMode("warehouse")}
              className={destinationMode === "warehouse" ? "px-3 py-2 rounded-md text-sm font-medium border border-primary bg-primary/5" : "px-3 py-2 rounded-md text-sm border border-border text-muted-foreground hover:bg-muted/40"}>
              Their warehouse
            </button>
            <button type="button" onClick={() => setDestinationMode("rep")}
              className={destinationMode === "rep" ? "px-3 py-2 rounded-md text-sm font-medium border border-primary bg-primary/5" : "px-3 py-2 rounded-md text-sm border border-border text-muted-foreground hover:bg-muted/40"}>
              Directly to a rep
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {destinationMode === "warehouse"
              ? "Lands in their own consigned stock bucket — they can transfer it to a rep later."
              : "Skips the warehouse hop and hands it straight to one of their field reps."}
          </p>
        </div>

        {destinationMode === "rep" && (
          <div className="space-y-1.5">
            <Label className="text-xs">Rep <span className="text-destructive">*</span></Label>
            <Select value={repId} onValueChange={setRepId}>
              <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select rep…" /></SelectTrigger>
              <SelectContent>
                {reps.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}{r.otherOrgName ? ` (${r.otherOrgName})` : ""}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="space-y-1.5">
          <Label className="text-xs">Notes</Label>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Optional" className="text-sm" />
        </div>

        <Button onClick={handleSubmit} disabled={saving} className="w-full">
          {saving ? "Sending…" : "Send Consignment"}
        </Button>
      </div>
    </div>
  );
}
