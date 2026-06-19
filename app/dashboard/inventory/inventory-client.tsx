"use client";

import { useState, useTransition, useRef } from "react";
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
  PackageIcon, PlusIcon, SettingsIcon, AlertTriangleIcon, ArrowRightIcon, ArrowLeftRightIcon,
} from "lucide-react";
import type { StockWithProduct, Warehouse } from "@/server/inventory";
import { adjustStock, setReorderPoint, transferStock, searchProducts } from "@/server/inventory";
import { MOVEMENT_TYPE } from "@/lib/inventory/constants";
import type { ConsignmentItemRow } from "@/server/consignment";

interface Product { id: string; productCode: string; description: string | null; uom: string | null }
type ActiveConsignment = {
  consignmentId: string;
  consignmentNo: string;
  customerName: string | null;
  customerOrg: string | null;
  sentDate: Date | null;
  item: ConsignmentItemRow;
};

interface Props {
  inventory: StockWithProduct[];
  warehouses: Warehouse[];
  permissions: string[];
  activeConsignments?: ActiveConsignment[];
}

function ProductSearch({ value, onChange }: { value: string; onChange: (id: string, code: string) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Product[]>([]);
  const [open, setOpen] = useState(false);
  const [selectedLabel, setSelectedLabel] = useState("");
  const [noResults, setNoResults] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestQuery = useRef("");

  async function runSearch(q: string) {
    if (!q.trim()) { setResults([]); setOpen(false); setNoResults(false); return; }
    try {
      const r = await searchProducts(q);
      if (latestQuery.current !== q) return; // stale
      setResults(r);
      setNoResults(r.length === 0);
      setOpen(r.length > 0);
      const exact = r.find(p => p.productCode.toLowerCase() === q.trim().toLowerCase());
      if (exact) select(exact);
    } catch (err) {
      console.error("searchProducts error:", err);
      toast.error("Product search failed");
    }
  }

  function handleInput(q: string) {
    setQuery(q);
    latestQuery.current = q;
    if (debounce.current) clearTimeout(debounce.current);
    if (!q.trim()) { setResults([]); setOpen(false); return; }
    debounce.current = setTimeout(() => runSearch(q), 300);
  }

  function select(p: Product) {
    setSelectedLabel(`${p.productCode}${p.description ? ` — ${p.description}` : ""}`);
    setQuery("");
    setResults([]);
    setOpen(false);
    onChange(p.id, p.productCode);
  }

  function clear() {
    setSelectedLabel("");
    setQuery("");
    setResults([]);
    setNoResults(false);
    latestQuery.current = "";
    onChange("", "");
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      if (results.length > 0) { select(results[0]); return; }
      if (debounce.current) clearTimeout(debounce.current);
      runSearch(query);
    }
  }

  function handleBlur() {
    // use ref (not state) — state may be stale if blur fires before React commits
    const q = latestQuery.current;
    if (!selectedLabel && q.trim()) {
      if (debounce.current) clearTimeout(debounce.current);
      runSearch(q);
    }
  }

  return (
    <div className="relative">
      {selectedLabel ? (
        <div className="flex items-start gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm">
          <span className="flex-1 font-mono text-xs wrap-break-word min-w-0">{selectedLabel}</span>
          <button type="button" onClick={clear} className="text-muted-foreground hover:text-foreground text-xs shrink-0 mt-0.5">✕</button>
        </div>
      ) : (
        <>
          <Input
            placeholder="Type product code or name…"
            value={query}
            onChange={e => handleInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={handleBlur}
            autoComplete="off"
          />
          {noResults && query.trim() && (
            <p className="text-xs text-destructive mt-1">
              No product found for &quot;{query}&quot;. Add it in <a href="/dashboard/products/catalogue" className="underline">Product Catalogue</a> first.
            </p>
          )}
        </>
      )}
      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-border bg-background shadow-md max-h-48 overflow-y-auto">
          {results.map(p => (
            <button
              key={p.id}
              type="button"
              className="w-full text-left px-3 py-2 text-xs hover:bg-accent flex flex-col gap-0.5"
              onClick={() => select(p)}
            >
              <span className="font-mono font-medium">{p.productCode}</span>
              {p.description && <span className="text-muted-foreground whitespace-normal">{p.description}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function fmt(v: string | number) {
  return parseFloat(String(v)).toLocaleString("en-MY", { minimumFractionDigits: 0, maximumFractionDigits: 4 });
}

export function InventoryClient({ inventory, warehouses, permissions, activeConsignments = [] }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [search, setSearch] = useState("");
  const [warehouseFilter, setWarehouseFilter] = useState("ALL");

  const canAdjust = permissions.includes("inventory:adjust") || permissions.includes("*");
  const canManage = permissions.includes("inventory:manage") || permissions.includes("*");

  // ── Adjust sheet ──────────────────────────────────────────────────────────
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjProductId, setAdjProductId] = useState("");
  const [adjWarehouse, setAdjWarehouse] = useState(warehouses[0]?.label ?? "Default");
  const [adjType, setAdjType] = useState(MOVEMENT_TYPE.STOCK_IN);
  const [adjQty, setAdjQty] = useState("");
  const [adjCost, setAdjCost] = useState("");
  const [adjRef, setAdjRef] = useState("");
  const [adjNotes, setAdjNotes] = useState("");
  const [adjLotNo, setAdjLotNo] = useState("");
  const [adjExpiry, setAdjExpiry] = useState("");
  const [saving, setSaving] = useState(false);

  // ── Transfer sheet ────────────────────────────────────────────────────────
  const [transferOpen, setTransferOpen] = useState(false);
  const [txProductId, setTxProductId] = useState("");
  const [txFrom, setTxFrom] = useState(warehouses[0]?.label ?? "Default");
  const [txTo, setTxTo] = useState(warehouses[1]?.label ?? warehouses[0]?.label ?? "Default");
  const [txQty, setTxQty] = useState("");
  const [txNotes, setTxNotes] = useState("");
  const [transferring, setTransferring] = useState(false);

  // ── Reorder sheet ─────────────────────────────────────────────────────────
  const [reorderOpen, setReorderOpen] = useState(false);
  const [reorderItem, setReorderItem] = useState<StockWithProduct | null>(null);
  const [reorderPoint, setReorderPointVal] = useState("");
  const [maxStockVal, setMaxStockVal] = useState("");
  const [savingReorder, setSavingReorder] = useState(false);

  const allWarehouses = Array.from(new Set(inventory.map(i => i.warehouseLabel)));
  const lowStockCount = inventory.filter(i => i.isLowStock).length;

  const filtered = inventory.filter(i => {
    const matchSearch =
      i.productCode.toLowerCase().includes(search.toLowerCase()) ||
      (i.description ?? "").toLowerCase().includes(search.toLowerCase());
    const matchWh = warehouseFilter === "ALL" || i.warehouseLabel === warehouseFilter;
    return matchSearch && matchWh;
  });

  // Group by warehouse for display
  const grouped = allWarehouses
    .filter(wh => warehouseFilter === "ALL" || wh === warehouseFilter)
    .map(wh => ({
      label: wh,
      address: warehouses.find(w => w.label === wh)?.address ?? "",
      rows: filtered.filter(i => i.warehouseLabel === wh),
    }))
    .filter(g => g.rows.length > 0);

  async function handleAdjust(e: React.FormEvent) {
    e.preventDefault();
    if (!adjProductId) { toast.error("Select a product"); return; }
    const qty = parseFloat(adjQty);
    if (isNaN(qty) || qty <= 0) { toast.error("Enter a valid quantity"); return; }
    setSaving(true);
    try {
      await adjustStock({ productId: adjProductId, warehouseLabel: adjWarehouse, movementType: adjType, quantity: qty, unitCost: adjCost || undefined, referenceNo: adjRef || undefined, notes: adjNotes || undefined, lotNo: adjLotNo || undefined, expiryDate: adjExpiry ? new Date(adjExpiry) : undefined });
      toast.success("Stock updated");
      setAdjustOpen(false);
      setAdjProductId(""); setAdjQty(""); setAdjCost(""); setAdjRef(""); setAdjNotes(""); setAdjLotNo(""); setAdjExpiry("");
      startTransition(() => router.refresh());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally { setSaving(false); }
  }

  async function handleTransfer(e: React.FormEvent) {
    e.preventDefault();
    if (!txProductId) { toast.error("Select a product"); return; }
    const qty = parseFloat(txQty);
    if (isNaN(qty) || qty <= 0) { toast.error("Enter a valid quantity"); return; }
    setTransferring(true);
    try {
      await transferStock({ productId: txProductId, fromWarehouse: txFrom, toWarehouse: txTo, quantity: qty, notes: txNotes || undefined });
      toast.success(`Transferred ${qty} units from ${txFrom} → ${txTo}`);
      setTransferOpen(false);
      setTxProductId(""); setTxQty(""); setTxNotes("");
      startTransition(() => router.refresh());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally { setTransferring(false); }
  }

  async function handleSaveReorder(e: React.FormEvent) {
    e.preventDefault();
    if (!reorderItem) return;
    setSavingReorder(true);
    try {
      await setReorderPoint(reorderItem.productId, reorderItem.warehouseLabel, reorderPoint || null, maxStockVal || null);
      toast.success("Settings saved");
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
            <PackageIcon className="h-5 w-5 text-muted-foreground"/>Inventory
          </h1>
          <p className="text-sm text-muted-foreground">
            {inventory.length} stock records across {allWarehouses.length} warehouse{allWarehouses.length !== 1 ? "s" : ""}
            {lowStockCount > 0 && <span className="text-amber-600 font-medium"> · {lowStockCount} low stock</span>}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {canAdjust && warehouses.length > 1 && (
            <Button size="sm" variant="outline" onClick={() => setTransferOpen(true)} className="gap-1.5">
              <ArrowLeftRightIcon className="h-4 w-4"/>Transfer
            </Button>
          )}
          {canAdjust && (
            <Button size="sm" onClick={() => setAdjustOpen(true)} className="gap-1.5">
              <PlusIcon className="h-4 w-4"/>Stock Movement
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => router.push("/dashboard/inventory/movements")} className="gap-1.5">
            <ArrowRightIcon className="h-4 w-4"/>Movement History
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <Input placeholder="Search product…" value={search} onChange={e => setSearch(e.target.value)} className="max-w-xs"/>
        <div className="flex items-center gap-1.5 flex-wrap">
          <Button size="sm" variant={warehouseFilter === "ALL" ? "default" : "outline"} className="h-7 text-xs" onClick={() => setWarehouseFilter("ALL")}>All Warehouses</Button>
          {allWarehouses.map(wh => (
            <Button key={wh} size="sm" variant={warehouseFilter === wh ? "default" : "outline"} className="h-7 text-xs" onClick={() => setWarehouseFilter(wh)}>{wh}</Button>
          ))}
        </div>
      </div>

      {/* Grouped by warehouse */}
      {grouped.length === 0 ? (
        <div className="rounded-lg border border-border py-16 text-center text-sm text-muted-foreground">
          No inventory records yet. Add a stock movement to get started.
        </div>
      ) : grouped.map(group => (
        <div key={group.label} className="flex flex-col gap-0 rounded-lg border border-border overflow-hidden">
          <div className="px-4 py-2.5 bg-muted/40 border-b border-border flex items-center gap-3">
            <span className="text-sm font-semibold">{group.label}</span>
            {group.address && <span className="text-xs text-muted-foreground">{group.address}</span>}
            <Badge variant="outline" className="text-xs ml-auto">{group.rows.length} product{group.rows.length !== 1 ? "s" : ""}</Badge>
          </div>
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/20">
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
              {group.rows.map(item => (
                <TableRow key={item.id} className={item.isLowStock ? "bg-amber-50/40 dark:bg-amber-900/10" : ""}>
                  <TableCell className="font-mono text-xs font-medium">{item.productCode}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{item.description ?? "—"}</TableCell>
                  <TableCell className="text-center text-xs text-muted-foreground">{item.uom ?? "—"}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{fmt(item.quantity)}</TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground tabular-nums">{fmt(item.reservedQty)}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums text-green-700 dark:text-green-400">{fmt(item.availableQty)}</TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground tabular-nums">{item.reorderPoint ? fmt(item.reorderPoint) : "—"}</TableCell>
                  <TableCell className="text-center">
                    {item.isLowStock ? (
                      <Badge variant="outline" className="text-xs bg-amber-50 text-amber-700 border-amber-300 dark:bg-amber-900/20 dark:text-amber-400 gap-1">
                        <AlertTriangleIcon className="h-3 w-3"/>Low
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-xs text-green-700 border-green-300 bg-green-50 dark:text-green-400">OK</Badge>
                    )}
                  </TableCell>
                  {canManage && (
                    <TableCell>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openReorder(item)} title="Settings">
                        <SettingsIcon className="h-3.5 w-3.5"/>
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ))}

      {/* ── Consignment Section ──────────────────────────────────────────── */}
      {activeConsignments.length > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Active Consignments ({activeConsignments.length} item{activeConsignments.length !== 1 ? "s" : ""})
          </h2>
          <div className="rounded-lg border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/20">
                  <TableHead>CO No.</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-center w-16">OUM</TableHead>
                  <TableHead className="text-right w-24">Sent</TableHead>
                  <TableHead className="text-right w-24">Used</TableHead>
                  <TableHead className="text-right w-24">Returned</TableHead>
                  <TableHead className="text-right w-24">Remaining</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activeConsignments.map(({ consignmentId, consignmentNo, customerName, customerOrg, item }) => {
                  const remaining = parseFloat(item.qtySent) - parseFloat(item.qtyUsed) - parseFloat(item.qtyReturned);
                  return (
                    <TableRow
                      key={`${consignmentId}-${item.id}`}
                      className="cursor-pointer hover:bg-muted/30"
                      onClick={() => router.push(`/dashboard/sales/consignment/${consignmentId}`)}
                    >
                      <TableCell className="text-xs font-medium">{consignmentNo}</TableCell>
                      <TableCell className="text-sm">
                        <p>{customerName ?? "—"}</p>
                        {customerOrg && <p className="text-xs text-muted-foreground">{customerOrg}</p>}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{item.description}</TableCell>
                      <TableCell className="text-center text-xs text-muted-foreground">{item.uom ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmt(item.qtySent)}</TableCell>
                      <TableCell className="text-right tabular-nums text-orange-600 dark:text-orange-400">{fmt(item.qtyUsed)}</TableCell>
                      <TableCell className="text-right tabular-nums text-green-600 dark:text-green-400">{fmt(item.qtyReturned)}</TableCell>
                      <TableCell className="text-right tabular-nums font-semibold">{fmt(remaining)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* ── Stock Movement Sheet ─────────────────────────────────────────── */}
      <Sheet open={adjustOpen} onOpenChange={open => { if (!saving) setAdjustOpen(open); }}>
        <SheetContent className="w-full data-[side=right]:sm:max-w-2xl overflow-y-auto px-6">
          <SheetHeader className="mb-5"><SheetTitle>Stock Movement</SheetTitle></SheetHeader>
          <form onSubmit={handleAdjust} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>Warehouse <span className="text-destructive">*</span></Label>
              <Select value={adjWarehouse} onValueChange={setAdjWarehouse}>
                <SelectTrigger><SelectValue/></SelectTrigger>
                <SelectContent>
                  {warehouses.map(w => <SelectItem key={w.label} value={w.label}>{w.label}{w.address ? ` — ${w.address}` : ""}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Product <span className="text-destructive">*</span></Label>
              <ProductSearch value={adjProductId} onChange={(id) => setAdjProductId(id)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Movement Type <span className="text-destructive">*</span></Label>
              <Select value={adjType} onValueChange={v => setAdjType(v as typeof adjType)}>
                <SelectTrigger><SelectValue/></SelectTrigger>
                <SelectContent>
                  {([MOVEMENT_TYPE.OPENING, MOVEMENT_TYPE.STOCK_IN, MOVEMENT_TYPE.STOCK_OUT, MOVEMENT_TYPE.ADJUSTMENT, MOVEMENT_TYPE.RETURN] as const).map(t => (
                    <SelectItem key={t} value={t}>
                      {t === "STOCK_IN" ? "Stock In ↑" : t === "STOCK_OUT" ? "Stock Out ↓" : t === "ADJUSTMENT" ? "Adjustment" : t === "RETURN" ? "Return" : "Opening Balance"}
                    </SelectItem>
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
                <Label>Unit Cost (RM) <span className="text-muted-foreground font-normal text-xs">(opt)</span></Label>
                <Input type="number" min="0" step="0.01" placeholder="0.00" value={adjCost} onChange={e => setAdjCost(e.target.value)}/>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Reference No. <span className="text-muted-foreground font-normal text-xs">(opt)</span></Label>
              <Input placeholder="e.g. PO-2025-0001" value={adjRef} onChange={e => setAdjRef(e.target.value)}/>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label>Lot No. <span className="text-muted-foreground font-normal text-xs">(opt)</span></Label>
                <Input placeholder="e.g. LOT-240301" value={adjLotNo} onChange={e => setAdjLotNo(e.target.value)}/>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Expiry Date <span className="text-muted-foreground font-normal text-xs">(opt)</span></Label>
                <Input type="date" value={adjExpiry} onChange={e => setAdjExpiry(e.target.value)}/>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Notes <span className="text-muted-foreground font-normal text-xs">(opt)</span></Label>
              <Input placeholder="Reason…" value={adjNotes} onChange={e => setAdjNotes(e.target.value)}/>
            </div>
            <div className="flex gap-2 pt-2">
              <Button type="submit" disabled={saving} className="flex-1">{saving ? "Saving…" : "Save"}</Button>
              <Button type="button" variant="outline" onClick={() => setAdjustOpen(false)} disabled={saving}>Cancel</Button>
            </div>
          </form>
        </SheetContent>
      </Sheet>

      {/* ── Transfer Sheet ───────────────────────────────────────────────── */}
      <Sheet open={transferOpen} onOpenChange={open => { if (!transferring) setTransferOpen(open); }}>
        <SheetContent className="w-full data-[side=right]:sm:max-w-2xl overflow-y-auto px-6">
          <SheetHeader className="mb-5"><SheetTitle>Transfer Between Warehouses</SheetTitle></SheetHeader>
          <form onSubmit={handleTransfer} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>Product <span className="text-destructive">*</span></Label>
              <ProductSearch value={txProductId} onChange={(id) => setTxProductId(id)} />
            </div>
            <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
              <div className="flex flex-col gap-1.5">
                <Label>From</Label>
                <Select value={txFrom} onValueChange={setTxFrom}>
                  <SelectTrigger><SelectValue/></SelectTrigger>
                  <SelectContent>{warehouses.map(w => <SelectItem key={w.label} value={w.label}>{w.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <ArrowRightIcon className="h-4 w-4 text-muted-foreground mb-2 shrink-0"/>
              <div className="flex flex-col gap-1.5">
                <Label>To</Label>
                <Select value={txTo} onValueChange={setTxTo}>
                  <SelectTrigger><SelectValue/></SelectTrigger>
                  <SelectContent>{warehouses.map(w => <SelectItem key={w.label} value={w.label}>{w.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Quantity <span className="text-destructive">*</span></Label>
              <Input type="number" min="0.0001" step="0.0001" placeholder="0" value={txQty} onChange={e => setTxQty(e.target.value)}/>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Notes <span className="text-muted-foreground font-normal text-xs">(opt)</span></Label>
              <Input placeholder="Reason for transfer…" value={txNotes} onChange={e => setTxNotes(e.target.value)}/>
            </div>
            <div className="flex gap-2 pt-2">
              <Button type="submit" disabled={transferring} className="flex-1">{transferring ? "Transferring…" : "Transfer"}</Button>
              <Button type="button" variant="outline" onClick={() => setTransferOpen(false)} disabled={transferring}>Cancel</Button>
            </div>
          </form>
        </SheetContent>
      </Sheet>

      {/* ── Reorder Settings Sheet ───────────────────────────────────────── */}
      <Sheet open={reorderOpen} onOpenChange={open => { if (!savingReorder) setReorderOpen(open); }}>
        <SheetContent className="w-full data-[side=right]:sm:max-w-2xl overflow-y-auto px-6">
          <SheetHeader className="mb-5">
            <SheetTitle>Stock Settings — {reorderItem?.productCode} @ {reorderItem?.warehouseLabel}</SheetTitle>
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
