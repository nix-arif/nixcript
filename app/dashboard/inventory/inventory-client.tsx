"use client";

import React, { useState, useTransition, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  PackageIcon, AlertTriangleIcon, ArrowRightIcon, ChevronDownIcon, ChevronRightIcon, PencilIcon, XIcon,
} from "lucide-react";
import type { StockWithProduct, Warehouse, StockLotRow, ExpiringLot } from "@/server/inventory";
import { searchProducts, getProductLots, editStockLot, assignLotToStock } from "@/server/inventory";
import type { ConsignmentItemRow } from "@/server/consignment";

const EXPIRY_WARN_DAYS = 90;

function expiryStatus(date: Date | null): "ok" | "warn" | "expired" {
  if (!date) return "ok";
  const days = Math.ceil((date.getTime() - Date.now()) / 86_400_000);
  if (days < 0) return "expired";
  if (days <= EXPIRY_WARN_DAYS) return "warn";
  return "ok";
}

function fmtDate(d: Date | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" });
}

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
  expiringLots?: ExpiringLot[];
}

function ProductSearch({ value, initialLabel, onChange }: { value: string; initialLabel?: string; onChange: (id: string, code: string) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Product[]>([]);
  const [open, setOpen] = useState(false);
  const [selectedLabel, setSelectedLabel] = useState(initialLabel ?? "");
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

function ExpiringLotsAlert({ lots }: { lots: ExpiringLot[] }) {
  const [dismissed, setDismissed] = useState(false);
  const [expanded, setExpanded] = useState(true);

  if (dismissed || lots.length === 0) return null;

  const now = new Date();
  const expired = lots.filter(l => new Date(l.expiryDate) < now);
  const expiring = lots.filter(l => new Date(l.expiryDate) >= now);

  const daysLeft = (d: Date) => Math.ceil((new Date(d).getTime() - now.getTime()) / 86_400_000);

  return (
    <div className={`rounded-lg border px-4 py-3 flex flex-col gap-2 ${expired.length > 0 ? "border-red-300 bg-red-50 dark:border-red-700 dark:bg-red-950/30" : "border-orange-300 bg-orange-50 dark:border-orange-700 dark:bg-orange-950/30"}`}>
      <div className="flex items-center gap-2">
        <AlertTriangleIcon className={`h-4 w-4 shrink-0 ${expired.length > 0 ? "text-red-600 dark:text-red-400" : "text-orange-600 dark:text-orange-400"}`}/>
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          className={`flex-1 text-left text-sm font-semibold ${expired.length > 0 ? "text-red-800 dark:text-red-300" : "text-orange-800 dark:text-orange-300"}`}
        >
          {expired.length > 0
            ? `${expired.length} expired lot${expired.length > 1 ? "s" : ""} in stock`
            : null}
          {expired.length > 0 && expiring.length > 0 ? " · " : null}
          {expiring.length > 0
            ? `${expiring.length} lot${expiring.length > 1 ? "s" : ""} expiring within ${EXPIRY_WARN_DAYS} days`
            : null}
          <ChevronDownIcon className={`inline h-3.5 w-3.5 ml-1 transition-transform ${expanded ? "rotate-0" : "-rotate-90"}`}/>
        </button>
        <button type="button" onClick={() => setDismissed(true)} className="text-muted-foreground hover:text-foreground transition-colors" title="Dismiss">
          <XIcon className="h-4 w-4"/>
        </button>
      </div>

      {expanded && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted-foreground">
                <th className="text-left pb-1 pr-4 font-medium">Product</th>
                <th className="text-left pb-1 pr-4 font-medium">Description</th>
                <th className="text-left pb-1 pr-4 font-medium">Warehouse</th>
                <th className="text-left pb-1 pr-4 font-medium">Lot No.</th>
                <th className="text-right pb-1 pr-4 font-medium">Qty</th>
                <th className="text-right pb-1 pr-4 font-medium">Expiry</th>
                <th className="text-left pb-1 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {lots.map(l => {
                const expDate = new Date(l.expiryDate);
                const isExpired = expDate < now;
                const days = daysLeft(expDate);
                return (
                  <tr key={l.id} className="border-t border-black/10 dark:border-white/10">
                    <td className="py-1 pr-4 font-mono font-medium">{l.productCode}</td>
                    <td className="py-1 pr-4 text-muted-foreground max-w-48 truncate" title={l.description ?? ""}>{l.description ?? "—"}</td>
                    <td className="py-1 pr-4 text-muted-foreground">{l.warehouseLabel}</td>
                    <td className="py-1 pr-4 font-mono">{l.lotNo}</td>
                    <td className="py-1 pr-4 text-right tabular-nums">{parseFloat(l.quantity).toLocaleString("en-MY", { maximumFractionDigits: 4 })}</td>
                    <td className="py-1 pr-4 text-right tabular-nums whitespace-nowrap">
                      {expDate.toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" })}
                    </td>
                    <td className="py-1">
                      {isExpired
                        ? <span className="font-semibold text-red-600 dark:text-red-400">Expired {Math.abs(days)}d ago</span>
                        : <span className="text-orange-600 dark:text-orange-400">Expires in {days}d</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function LotSubTable({ lots, canManage, productId, warehouseLabel, currentBalance, onLotUpdated, onLotAdded }: {
  lots: StockLotRow[];
  canManage: boolean;
  productId: string;
  warehouseLabel: string;
  currentBalance: number;
  onLotUpdated: (updated: StockLotRow) => void;
  onLotAdded: (newLot: StockLotRow) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [newLotNo, setNewLotNo] = useState("");
  const [newExpiry, setNewExpiry] = useState("");
  const [newQty, setNewQty] = useState(currentBalance > 0 ? String(currentBalance) : "");
  const [saving, setSaving] = useState(false);

  async function saveNew() {
    if (!newLotNo.trim()) { toast.error("Lot number required"); return; }
    const qty = parseFloat(newQty);
    if (isNaN(qty) || qty <= 0) { toast.error("Enter a valid quantity"); return; }
    setSaving(true);
    try {
      await assignLotToStock({
        productId,
        warehouseLabel,
        lotNo: newLotNo.trim(),
        expiryDate: newExpiry ? new Date(newExpiry) : null,
        quantity: qty,
      });
      // optimistic: reload will happen via revalidatePath, but also push locally
      // We don't have the new ID here — just trigger a refresh which will reload lot data
      toast.success("Lot assigned");
      setAdding(false);
      setNewLotNo(""); setNewExpiry(""); setNewQty("");
      // Trigger re-fetch of lots by dispatching a dummy lot to force parent refresh
      // The revalidatePath will refresh the page data; caller should reload lots
      onLotAdded({ id: "__refresh__", organizationId: "", productId, warehouseLabel, lotNo: newLotNo.trim(), expiryDate: newExpiry ? new Date(newExpiry) : null, quantity: String(qty), reservedQty: "0", unitCost: null, createdAt: new Date(), updatedAt: new Date() });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally { setSaving(false); }
  }

  function cancelNew() { setAdding(false); setNewLotNo(""); setNewExpiry(""); setNewQty(""); }

  if (lots.length === 0 && !adding) {
    return (
      <div className="flex items-center gap-3">
        <p className="text-xs text-muted-foreground italic">No lot records — stock was added without a lot number.</p>
        {canManage && (
          <button onClick={() => { setNewQty(String(currentBalance)); setAdding(true); }} className="text-xs text-primary hover:underline">
            + Assign lot
          </button>
        )}
      </div>
    );
  }

  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-muted-foreground">
          <th className="text-left pb-1 pr-4 font-medium">Lot No.</th>
          <th className="text-right pb-1 pr-4 font-medium">Qty</th>
          <th className="text-right pb-1 pr-4 font-medium">Expiry</th>
          <th className="text-left pb-1 font-medium">Status</th>
          {canManage && <th className="w-14"/>}
        </tr>
      </thead>
      <tbody>
        {lots.map(lot => (
          <LotRow key={lot.id} lot={lot} canManage={canManage} onSaved={onLotUpdated}/>
        ))}
        {adding && (
          <tr className="border-t border-border/30 bg-muted/30">
            <td className="py-1.5 pr-4">
              <input value={newLotNo} onChange={e => setNewLotNo(e.target.value)} placeholder="Lot number"
                className="h-7 w-28 rounded border border-border bg-background px-2 font-mono text-xs"/>
            </td>
            <td className="py-1.5 pr-4 text-right">
              <input type="number" min="0.0001" step="0.0001" value={newQty} onChange={e => setNewQty(e.target.value)}
                className="h-7 w-24 rounded border border-border bg-background px-2 text-xs text-right tabular-nums"/>
            </td>
            <td className="py-1.5 pr-4 text-right">
              <input type="date" value={newExpiry} onChange={e => setNewExpiry(e.target.value)}
                className="h-7 rounded border border-border bg-background px-2 text-xs"/>
            </td>
            <td/>
            <td className="py-1.5">
              <div className="flex gap-1">
                <button onClick={saveNew} disabled={saving} className="text-xs text-primary hover:underline disabled:opacity-50">{saving ? "…" : "Save"}</button>
                <button onClick={cancelNew} className="text-xs text-muted-foreground hover:text-foreground">Cancel</button>
              </div>
            </td>
          </tr>
        )}
        {canManage && !adding && (
          <tr>
            <td colSpan={5} className="pt-2">
              <button onClick={() => setAdding(true)} className="text-xs text-primary hover:underline">+ Add lot</button>
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

function LotRow({ lot, canManage, onSaved }: { lot: StockLotRow; canManage: boolean; onSaved: (updated: StockLotRow) => void }) {
  const [editing, setEditing] = useState(false);
  const [lotNo, setLotNo] = useState(lot.lotNo);
  const [expiry, setExpiry] = useState(lot.expiryDate ? new Date(lot.expiryDate).toISOString().split("T")[0] : "");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!lotNo.trim()) { toast.error("Lot number required"); return; }
    setSaving(true);
    try {
      await editStockLot(lot.id, { lotNo: lotNo.trim(), expiryDate: expiry ? new Date(expiry) : null });
      onSaved({ ...lot, lotNo: lotNo.trim(), expiryDate: expiry ? new Date(expiry) : null });
      setEditing(false);
      toast.success("Lot updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally { setSaving(false); }
  }

  const st = expiryStatus(lot.expiryDate ? new Date(lot.expiryDate) : null);

  if (editing) {
    return (
      <tr className="border-t border-border/30 bg-muted/30">
        <td className="py-1.5 pr-4">
          <input value={lotNo} onChange={e => setLotNo(e.target.value)}
            className="h-7 w-28 rounded border border-border bg-background px-2 font-mono text-xs"/>
        </td>
        <td className="py-1.5 pr-4 text-right tabular-nums text-muted-foreground">{fmt(lot.quantity)}</td>
        <td className="py-1.5 pr-4">
          <input type="date" value={expiry} onChange={e => setExpiry(e.target.value)}
            className="h-7 rounded border border-border bg-background px-2 text-xs"/>
        </td>
        <td/>
        <td className="py-1.5">
          <div className="flex gap-1">
            <button onClick={save} disabled={saving} className="text-xs text-primary hover:underline disabled:opacity-50">{saving ? "…" : "Save"}</button>
            <button onClick={() => { setEditing(false); setLotNo(lot.lotNo); setExpiry(lot.expiryDate ? new Date(lot.expiryDate).toISOString().split("T")[0] : ""); }} className="text-xs text-muted-foreground hover:text-foreground">Cancel</button>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr className="border-t border-border/30">
      <td className="py-1 pr-4 font-mono font-medium">{lot.lotNo}</td>
      <td className="py-1 pr-4 text-right tabular-nums">{fmt(lot.quantity)}</td>
      <td className={`py-1 pr-4 text-right tabular-nums ${st === "expired" ? "text-red-600" : st === "warn" ? "text-orange-600" : "text-muted-foreground"}`}>
        {fmtDate(lot.expiryDate ? new Date(lot.expiryDate) : null)}
      </td>
      <td className="py-1">
        {st === "expired" && <span className="text-red-600 font-medium">Expired</span>}
        {st === "warn" && <span className="text-orange-600">Expiring soon</span>}
        {st === "ok" && lot.expiryDate && <span className="text-green-600">OK</span>}
      </td>
      {canManage && (
        <td className="py-1">
          <button onClick={() => setEditing(true)} className="text-muted-foreground hover:text-foreground transition-colors">
            <PencilIcon className="h-3 w-3"/>
          </button>
        </td>
      )}
    </tr>
  );
}

function fmt(v: string | number) {
  return parseFloat(String(v)).toLocaleString("en-MY", { minimumFractionDigits: 0, maximumFractionDigits: 4 });
}

export function InventoryClient({ inventory, warehouses, permissions, activeConsignments = [], expiringLots = [] }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [search, setSearch] = useState("");
  const [warehouseFilter, setWarehouseFilter] = useState("ALL");



  const allWarehouses = Array.from(new Set(inventory.map(i => i.warehouseLabel)));
  const lowStockCount = inventory.filter(i => i.isLowStock).length;

  // Lot expansion
  const [expandedLots, setExpandedLots] = useState<Set<string>>(new Set());
  const [lotData, setLotData] = useState<Record<string, StockLotRow[]>>({});
  const [loadingLots, setLoadingLots] = useState<Set<string>>(new Set());

  async function toggleLots(item: StockWithProduct) {
    const key = item.id;
    if (expandedLots.has(key)) {
      setExpandedLots(prev => { const s = new Set(prev); s.delete(key); return s; });
      return;
    }
    if (!lotData[key]) {
      setLoadingLots(prev => new Set(prev).add(key));
      try {
        const lots = await getProductLots(item.productId, item.warehouseLabel);
        setLotData(prev => ({ ...prev, [key]: lots }));
      } finally {
        setLoadingLots(prev => { const s = new Set(prev); s.delete(key); return s; });
      }
    }
    setExpandedLots(prev => new Set(prev).add(key));
  }

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
        <Button size="sm" variant="outline" onClick={() => router.push("/dashboard/inventory/movements")} className="gap-1.5">
          <ArrowRightIcon className="h-4 w-4"/>Movement History
        </Button>
      </div>

      {/* Expiring Lots Alert */}
      <ExpiringLotsAlert lots={expiringLots}/>

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
                <TableHead className="w-6"/>
                <TableHead className="w-36">Product Code</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="w-16 text-center">UOM</TableHead>
                <TableHead className="w-28 text-right">On Hand</TableHead>
                <TableHead className="w-28 text-right">Available</TableHead>
                <TableHead className="w-28 text-right">Reorder Pt.</TableHead>
                <TableHead className="w-20 text-center">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {group.rows.map(item => {
                const isExpanded = expandedLots.has(item.id);
                const isLoading = loadingLots.has(item.id);
                const lots = lotData[item.id] ?? [];
                const expiredLot = isExpanded && lots.some(l => l.expiryDate && expiryStatus(new Date(l.expiryDate)) === "expired");
                const warnLot = isExpanded && !expiredLot && lots.some(l => l.expiryDate && expiryStatus(new Date(l.expiryDate)) === "warn");
                return (
                  <React.Fragment key={item.id}>
                    <TableRow className={item.isLowStock ? "bg-amber-50/40 dark:bg-amber-900/10" : ""}>
                      <TableCell className="pr-0 pl-3">
                        <button onClick={() => toggleLots(item)} className="text-muted-foreground hover:text-foreground transition-colors">
                          {isLoading ? <span className="text-xs">…</span> : isExpanded ? <ChevronDownIcon className="h-3.5 w-3.5"/> : <ChevronRightIcon className="h-3.5 w-3.5"/>}
                        </button>
                      </TableCell>
                      <TableCell className="font-mono text-xs font-medium">{item.productCode}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{item.description ?? "—"}</TableCell>
                      <TableCell className="text-center text-xs text-muted-foreground">{item.uom ?? "—"}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{fmt(item.quantity)}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums text-green-700 dark:text-green-400">{fmt(item.availableQty)}</TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground tabular-nums">{item.reorderPoint ? fmt(item.reorderPoint) : "—"}</TableCell>
                      <TableCell className="text-center">
                        {item.isLowStock ? (
                          <Badge variant="outline" className="text-xs bg-amber-50 text-amber-700 border-amber-300 dark:bg-amber-900/20 dark:text-amber-400 gap-1">
                            <AlertTriangleIcon className="h-3 w-3"/>Low
                          </Badge>
                        ) : expiredLot ? (
                          <Badge variant="outline" className="text-xs bg-red-50 text-red-700 border-red-300">Expired lot</Badge>
                        ) : warnLot ? (
                          <Badge variant="outline" className="text-xs bg-orange-50 text-orange-700 border-orange-300">Expiring</Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs text-green-700 border-green-300 bg-green-50 dark:text-green-400">OK</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                    {isExpanded && (
                      <TableRow className="bg-muted/20 hover:bg-muted/20">
                        <TableCell/>
                        <TableCell colSpan={7} className="py-2 pb-3">
                          <LotSubTable
                            lots={lots}
                            canManage={false}
                            productId={item.productId}
                            warehouseLabel={item.warehouseLabel}
                            currentBalance={parseFloat(item.quantity)}
                            onLotUpdated={(updated) => setLotData(prev => ({
                              ...prev,
                              [item.id]: (prev[item.id] ?? []).map(l => l.id === updated.id ? updated : l),
                            }))}
                            onLotAdded={(newLot) => setLotData(prev => ({
                              ...prev,
                              [item.id]: [...(prev[item.id] ?? []), newLot],
                            }))}
                          />
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                );
              })}
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

    </div>
  );
}
