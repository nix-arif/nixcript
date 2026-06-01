"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import {
  PackageIcon, PlusIcon, MinusIcon, SettingsIcon, AlertTriangleIcon, ArrowRightIcon,
} from "lucide-react";
import type { StockWithProduct } from "@/server/inventory";
import { adjustStock, setReorderPoint, MOVEMENT_TYPE } from "@/server/inventory";

interface Product { id: string; productCode: string; description: string | null; uom: string | null }
interface Props {
  inventory: StockWithProduct[];
  products: Product[];
  permissions: string[];
}

function fmt(v: string | number) {
  return parseFloat(String(v)).toLocaleString("en-MY", { minimumFractionDigits: 0, maximumFractionDigits: 4 });
}

export function InventoryClient({ inventory, products, permissions }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [search, setSearch] = useState("");

  const canAdjust = permissions.includes("inventory:adjust") || permissions.includes("*");
  const canManage = permissions.includes("inventory:manage") || permissions.includes("*");

  // Adjust sheet
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjProductId, setAdjProductId] = useState("");
  const [adjType, setAdjType] = useState(MOVEMENT_TYPE.STOCK_IN);
  const [adjQty, setAdjQty] = useState("");
  const [adjCost, setAdjCost] = useState("");
  const [adjRef, setAdjRef] = useState("");
  const [adjNotes, setAdjNotes] = useState("");
  const [saving, setSaving] = useState(false);

  // Reorder sheet
  const [reorderOpen, setReorderOpen] = useState(false);
  const [reorderItem, setReorderItem] = useState<StockWithProduct | null>(null);
  const [reorderPoint, setReorderPointVal] = useState("");
  const [maxStockVal, setMaxStockVal] = useState("");
  const [savingReorder, setSavingReorder] = useState(false);

  const filtered = inventory.filter(i =>
    i.productCode.toLowerCase().includes(search.toLowerCase()) ||
    (i.description ?? "").toLowerCase().includes(search.toLowerCase()),
  );

  const lowStockCount = inventory.filter(i => i.isLowStock).length;

  async function handleAdjust(e: React.FormEvent) {
    e.preventDefault();
    if (!adjProductId) { toast.error("Select a product"); return; }
    const qty = parseFloat(adjQty);
    if (isNaN(qty) || qty <= 0) { toast.error("Enter a valid quantity"); return; }
    setSaving(true);
    try {
      await adjustStock({ productId: adjProductId, movementType: adjType, quantity: qty, unitCost: adjCost || undefined, referenceNo: adjRef || undefined, notes: adjNotes || undefined });
      toast.success("Stock updated");
      setAdjustOpen(false);
      setAdjProductId(""); setAdjType(MOVEMENT_TYPE.STOCK_IN); setAdjQty(""); setAdjCost(""); setAdjRef(""); setAdjNotes("");
      startTransition(() => router.refresh());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally { setSaving(false); }
  }

  async function handleSaveReorder(e: React.FormEvent) {
    e.preventDefault();
    if (!reorderItem) return;
    setSavingReorder(true);
    try {
      await setReorderPoint(reorderItem.productId, reorderPoint || null, maxStockVal || null);
      toast.success("Reorder settings saved");
      setReorderOpen(false);
      startTransition(() => router.refresh());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally { setSavingReorder(false); }
  }

  function openReorder(item: StockWithProduct) {
    setReorderItem(item);
    setReorderPointVal(item.reorderPoint ?? "");
    setMaxStockVal(item.maxStock ?? "");
    setReorderOpen(true);
  }

  return (
    <div className="p-6 flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <PackageIcon className="h-5 w-5 text-muted-foreground" />Inventory
          </h1>
          <p className="text-sm text-muted-foreground">
            {inventory.length} products · {lowStockCount > 0 && <span className="text-amber-600 font-medium">{lowStockCount} low stock</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canAdjust && (
            <Button size="sm" onClick={() => setAdjustOpen(true)} className="gap-1.5">
              <PlusIcon className="h-4 w-4" />Stock Movement
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => router.push("/dashboard/inventory/movements")} className="gap-1.5">
            <ArrowRightIcon className="h-4 w-4" />Movement History
          </Button>
        </div>
      </div>

      {/* Search */}
      <Input placeholder="Search by product code or description…" value={search} onChange={e => setSearch(e.target.value)} className="max-w-sm"/>

      {/* Table */}
      <div className="rounded-lg border border-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40">
              <TableHead className="w-36">Product Code</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="w-16 text-center">UOM</TableHead>
              <TableHead className="w-28 text-right">On Hand</TableHead>
              <TableHead className="w-28 text-right">Reserved</TableHead>
              <TableHead className="w-28 text-right">Available</TableHead>
              <TableHead className="w-28 text-right">Reorder Pt.</TableHead>
              <TableHead className="w-20 text-center">Status</TableHead>
              {canManage && <TableHead className="w-10"/>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-10 text-sm text-muted-foreground">
                  {search ? "No products match your search." : "No inventory records yet. Add a stock movement to get started."}
                </TableCell>
              </TableRow>
            ) : filtered.map(item => (
              <TableRow key={item.id} className={item.isLowStock ? "bg-amber-50/40 dark:bg-amber-900/10" : ""}>
                <TableCell className="font-mono text-xs font-medium">{item.productCode}</TableCell>
                <TableCell className="text-sm text-muted-foreground max-w-xs truncate">{item.description ?? "—"}</TableCell>
                <TableCell className="text-center text-xs text-muted-foreground">{item.uom ?? "—"}</TableCell>
                <TableCell className="text-right font-medium tabular-nums">{fmt(item.quantity)}</TableCell>
                <TableCell className="text-right text-xs text-muted-foreground tabular-nums">{fmt(item.reservedQty)}</TableCell>
                <TableCell className="text-right font-semibold tabular-nums text-green-700 dark:text-green-400">{fmt(item.availableQty)}</TableCell>
                <TableCell className="text-right text-xs text-muted-foreground tabular-nums">{item.reorderPoint ? fmt(item.reorderPoint) : "—"}</TableCell>
                <TableCell className="text-center">
                  {item.isLowStock ? (
                    <Badge variant="outline" className="text-xs bg-amber-50 text-amber-700 border-amber-300 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-700 gap-1">
                      <AlertTriangleIcon className="h-3 w-3"/>Low
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-xs text-green-700 border-green-300 bg-green-50 dark:text-green-400 dark:border-green-700">OK</Badge>
                  )}
                </TableCell>
                {canManage && (
                  <TableCell>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openReorder(item)} title="Set reorder point">
                      <SettingsIcon className="h-3.5 w-3.5"/>
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Stock Movement Sheet */}
      <Sheet open={adjustOpen} onOpenChange={open => { if (!saving) setAdjustOpen(open); }}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto px-8">
          <SheetHeader className="mb-5"><SheetTitle>Stock Movement</SheetTitle></SheetHeader>
          <form onSubmit={handleAdjust} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>Product <span className="text-destructive">*</span></Label>
              <Select value={adjProductId} onValueChange={setAdjProductId}>
                <SelectTrigger><SelectValue placeholder="Select product…"/></SelectTrigger>
                <SelectContent>
                  {products.map(p => (
                    <SelectItem key={p.id} value={p.id}>
                      <span className="font-mono mr-2">{p.productCode}</span>
                      <span className="text-muted-foreground text-xs">{p.description ?? ""}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Movement Type <span className="text-destructive">*</span></Label>
              <Select value={adjType} onValueChange={v => setAdjType(v as typeof adjType)}>
                <SelectTrigger><SelectValue/></SelectTrigger>
                <SelectContent>
                  {Object.entries(MOVEMENT_TYPE).map(([k, v]) => (
                    <SelectItem key={k} value={v}>{v === "STOCK_IN" ? "Stock In ↑" : v === "STOCK_OUT" ? "Stock Out ↓" : v === "ADJUSTMENT" ? "Adjustment" : v === "RETURN" ? "Return" : "Opening Balance"}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label>Quantity <span className="text-destructive">*</span></Label>
                <Input type="number" min="0.0001" step="0.0001" placeholder="0" value={adjQty} onChange={e => setAdjQty(e.target.value)}/>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Unit Cost (RM) <span className="text-muted-foreground font-normal text-xs">(optional)</span></Label>
                <Input type="number" min="0" step="0.01" placeholder="0.00" value={adjCost} onChange={e => setAdjCost(e.target.value)}/>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Reference No. <span className="text-muted-foreground font-normal text-xs">(optional)</span></Label>
              <Input placeholder="e.g. PO-2025-0001" value={adjRef} onChange={e => setAdjRef(e.target.value)}/>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Notes <span className="text-muted-foreground font-normal text-xs">(optional)</span></Label>
              <Input placeholder="Reason for adjustment…" value={adjNotes} onChange={e => setAdjNotes(e.target.value)}/>
            </div>
            <div className="flex gap-2 pt-2">
              <Button type="submit" disabled={saving} className="flex-1">{saving ? "Saving…" : "Save"}</Button>
              <Button type="button" variant="outline" onClick={() => setAdjustOpen(false)} disabled={saving}>Cancel</Button>
            </div>
          </form>
        </SheetContent>
      </Sheet>

      {/* Reorder Point Sheet */}
      <Sheet open={reorderOpen} onOpenChange={open => { if (!savingReorder) setReorderOpen(open); }}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto px-8">
          <SheetHeader className="mb-5">
            <SheetTitle>Stock Settings — {reorderItem?.productCode}</SheetTitle>
          </SheetHeader>
          <form onSubmit={handleSaveReorder} className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">{reorderItem?.description}</p>
            <div className="flex flex-col gap-1.5">
              <Label>Reorder Point <span className="text-muted-foreground font-normal text-xs">(alert when stock ≤ this)</span></Label>
              <Input type="number" min="0" step="0.0001" placeholder="e.g. 10" value={reorderPoint} onChange={e => setReorderPointVal(e.target.value)}/>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Max Stock <span className="text-muted-foreground font-normal text-xs">(optional — for reference)</span></Label>
              <Input type="number" min="0" step="0.0001" placeholder="e.g. 500" value={maxStockVal} onChange={e => setMaxStockVal(e.target.value)}/>
            </div>
            <div className="flex gap-2 pt-2">
              <Button type="submit" disabled={savingReorder} className="flex-1">{savingReorder ? "Saving…" : "Save Settings"}</Button>
              <Button type="button" variant="outline" onClick={() => setReorderOpen(false)} disabled={savingReorder}>Cancel</Button>
            </div>
          </form>
        </SheetContent>
      </Sheet>
    </div>
  );
}
