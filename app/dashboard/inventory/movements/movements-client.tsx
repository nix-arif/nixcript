"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { ArrowLeftIcon, ArrowRightIcon, ArrowLeftRightIcon, TrendingUpIcon, TrendingDownIcon, PencilIcon, Trash2Icon, PlusIcon } from "lucide-react";
import type { MovementWithMeta, Warehouse } from "@/server/inventory";
import type { ConsignedInMovement } from "@/server/consign";

// A row of this company's own ledger, or (consignedIn set) a sister company's
// movement of stock consigned to us — read-only, quantity seen from our side.
type Movement = MovementWithMeta & { consignedIn?: ConsignedInMovement["consignedIn"] };
const CONSIGNED_IN = "CONSIGNED_IN"; // type filter value
const CONSIGNED_IN_LABELS: Record<string, string> = {
  CONSIGN_SEND: "Consigned in",
  CONSIGN_USE: "Consigned used",
  CONSIGN_BACK: "Returned to owner",
  CONSIGN_ADJUST: "Consigned count adj.",
  CONSIGN_REVERSE: "Consigned use reversed",
};
import { adjustStock, transferStock, searchProducts, editStockMovement, deleteStockMovement, getTransferStockInfo, getWarehouseStock, getProductSerialInfo, getUnitsAt } from "@/server/inventory";
import { MOVEMENT_LABELS, MOVEMENT_TYPE, INTENDED_USE_LABELS, isLendable, unitUseLabel } from "@/lib/inventory/constants";
import { getRepFieldStock, type RepStockItem } from "@/server/field-stock";
import { cn } from "@/lib/utils";

const TYPE_STYLE: Record<string, string> = {
  STOCK_IN:   "text-green-700 border-green-300 bg-green-50 dark:text-green-400 dark:border-green-700 dark:bg-green-900/20",
  OPENING:    "text-blue-700 border-blue-300 bg-blue-50 dark:text-blue-400 dark:border-blue-700",
  STOCK_OUT:  "text-red-700 border-red-300 bg-red-50 dark:text-red-400 dark:border-red-700",
  ADJUSTMENT: "text-purple-700 border-purple-300 bg-purple-50 dark:text-purple-400 dark:border-purple-700",
  RETURN:     "text-amber-700 border-amber-300 bg-amber-50 dark:text-amber-400 dark:border-amber-700",
};

function ProductSearch({ value, initialLabel, onChange }: { value: string; initialLabel?: string; onChange: (id: string, code: string, fullLabel: string) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ id: string; productCode: string; description: string | null }[]>([]);
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState(initialLabel ?? "");
  const latestQuery = useRef("");

  async function onInput(q: string) {
    setQuery(q); setLabel(q); latestQuery.current = q;
    if (q.length < 2) { setResults([]); setOpen(false); return; }
    try {
      const r = await searchProducts(q);
      if (latestQuery.current !== q) return;
      setResults(r); setOpen(r.length > 0);
    } catch { setResults([]); }
  }

  function pick(item: { id: string; productCode: string; description: string | null }) {
    const displayLabel = `${item.productCode}${item.description ? ` — ${item.description}` : ""}`;
    onChange(item.id, item.productCode, displayLabel);
    setLabel(displayLabel);
    setQuery(""); setResults([]); setOpen(false);
  }

  return (
    <div className="relative">
      <textarea
        rows={1}
        value={label || query}
        onChange={e => { if (value) { onChange("", "", ""); setLabel(""); } onInput(e.target.value); }}
        onFocus={() => results.length > 0 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Search by product code…"
        className="w-full min-h-9 rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none overflow-hidden whitespace-pre-wrap"
        style={{ fieldSizing: "content" } as React.CSSProperties}
      />
      {open && results.length > 0 && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 rounded-md border border-border bg-background shadow-lg max-h-60 overflow-y-auto">
          {results.map(r => (
            <button key={r.id} type="button" onMouseDown={() => pick(r)}
              className="w-full text-left px-3 py-2 text-sm hover:bg-muted flex flex-col gap-0.5">
              <span className="font-mono font-medium text-xs">{r.productCode}</span>
              {r.description && <span className="text-muted-foreground text-xs whitespace-normal wrap-break-word">{r.description}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function fmt(v: string | number) {
  const n = parseFloat(String(v));
  return (n > 0 ? "+" : "") + n.toLocaleString("en-MY", { minimumFractionDigits: 0, maximumFractionDigits: 4 });
}

function fmtDate(d: Date | string) {
  return new Date(d).toLocaleString("en-MY", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function MovementsClient({ movements, warehouses, permissions, isOwner, locationNames = {}, prefill }: { movements: Movement[]; warehouses: Warehouse[]; permissions: string[]; isOwner: boolean; locationNames?: Record<string, string>; prefill?: { location: string; productId: string; productLabel: string } }) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  function formatWarehouse(label: string) {
    if (locationNames[label]) return locationNames[label];
    if (!label.startsWith("Field:")) return label;
    const name = warehouses.find((w) => w.label === label)?.address;
    return name ? `Field: ${name.toLowerCase()}` : label;
  }

  const canManage = permissions.includes("inventory:manage") || permissions.includes("*") || isOwner;
  const canAdjust = permissions.includes("inventory:adjust") || permissions.includes("*") || isOwner;

  // ── New Movement sheet ─────────────────────────────────────────────────────
  // Opening Balance is temporarily allowed for field warehouses too, to seed
  // initial rep balances during rollout — remove MOVEMENT_TYPE.OPENING from
  // this list once that transition is done, so field stock goes back to
  // being replenished only via Transfer (an auditable warehouse origin).
  const FIELD_RESTRICTED = [MOVEMENT_TYPE.STOCK_IN];
  // Opened from Stock Overview's "Adjust quantity": that location and item, as an Adjustment
  const [adjOpen, setAdjOpen] = useState(!!prefill);
  const [adjProductId, setAdjProductId] = useState(prefill?.productId ?? "");
  const [adjProductLabel, setAdjProductLabel] = useState(prefill?.productLabel ?? "");
  // No location preselected: the user says where the stock is
  const [adjWarehouse, setAdjWarehouse] = useState(prefill?.location ?? "");
  const [adjType, setAdjType] = useState<string>(prefill ? MOVEMENT_TYPE.ADJUSTMENT : MOVEMENT_TYPE.STOCK_IN);
  // Adjustment (stock-count correction) goes either way
  const [adjDir, setAdjDir] = useState<"increase" | "decrease">("increase");
  const adjDecrease = adjType === MOVEMENT_TYPE.ADJUSTMENT && adjDir === "decrease";
  const [adjQty, setAdjQty] = useState("");
  const [adjCost, setAdjCost] = useState("");
  const [adjRef, setAdjRef] = useState("");
  const [adjNotes, setAdjNotes] = useState("");
  const [adjSerialNo, setAdjSerialNo] = useState("");
  // Machines / serial-numbered items: one row per unit, each with its own use
  const [adjMachine, setAdjMachine] = useState(false);
  const [adjUnits, setAdjUnits] = useState<{ serialNo: string; use: string }[]>([]);
  // Stock out of machines: which serial numbers leave
  const [outUnits, setOutUnits] = useState<{ id: string; serialNo: string; intendedUse: string }[]>([]);
  const [outPicked, setOutPicked] = useState<string[]>([]);
  const [adjLotNo, setAdjLotNo] = useState("");
  const [adjExpiry, setAdjExpiry] = useState("");
  const [saving, setSaving] = useState(false);
  const [adjFieldItems, setAdjFieldItems] = useState<RepStockItem[]>([]);
  const [adjLoadingField, setAdjLoadingField] = useState(false);

  // ── Transfer sheet ─────────────────────────────────────────────────────────
  const [txOpen, setTxOpen] = useState(false);
  const [txFrom, setTxFrom] = useState(warehouses[0]?.label ?? "Default");
  const [txTo, setTxTo] = useState(warehouses[1]?.label ?? warehouses[0]?.label ?? "Default");
  const [txNotes, setTxNotes] = useState("");
  const [transferring, setTransferring] = useState(false);
  const [txFromStock, setTxFromStock] = useState<{ productId: string; productCode: string; description: string | null; uom: string | null; quantity: number }[]>([]);
  const [txFromStockLoading, setTxFromStockLoading] = useState(false);
  type TxItem = {
    productId: string; productCode: string; description: string | null; uom: string | null;
    onHand: number; qty: string;
    lots: { id: string; lotNo: string; expiryDate: Date | null; quantity: string }[];
    selectedLotId: string | null;
    serialNos: string[];
    loadingInfo: boolean;
  };
  const [txSelected, setTxSelected] = useState<TxItem[]>([]);

  useEffect(() => {
    if (!adjOpen || !adjWarehouse.startsWith("Field:")) { setAdjFieldItems([]); return; }
    const repId = adjWarehouse.slice(6);
    if (!repId) return;
    setAdjLoadingField(true);
    getRepFieldStock(repId)
      .then(items => setAdjFieldItems(items))
      .catch(() => setAdjFieldItems([]))
      .finally(() => setAdjLoadingField(false));
  }, [adjOpen, adjWarehouse]);

  useEffect(() => {
    setTxFromStock([]); setTxSelected([]);
    if (!txOpen || !txFrom) return;
    setTxFromStockLoading(true);
    getWarehouseStock(txFrom)
      .then(items => setTxFromStock(items))
      .catch(() => setTxFromStock([]))
      .finally(() => setTxFromStockLoading(false));
  }, [txOpen, txFrom]);

  function handleTxProductToggle(item: typeof txFromStock[0]) {
    const alreadySelected = txSelected.some(p => p.productId === item.productId);
    if (alreadySelected) {
      setTxSelected(prev => prev.filter(p => p.productId !== item.productId));
      return;
    }
    const entry: TxItem = {
      productId: item.productId, productCode: item.productCode,
      description: item.description, uom: item.uom,
      onHand: item.quantity, qty: "",
      lots: [], selectedLotId: null, serialNos: [], loadingInfo: true,
    };
    setTxSelected(prev => [...prev, entry]);
    getTransferStockInfo(item.productId, txFrom)
      .then(info => setTxSelected(ps => ps.map(p =>
        p.productId === item.productId
          ? { ...p, lots: info.lots, serialNos: info.serialNos, selectedLotId: info.lots.length === 1 ? info.lots[0].id : null, loadingInfo: false }
          : p
      )))
      .catch(() => setTxSelected(ps => ps.map(p =>
        p.productId === item.productId ? { ...p, loadingInfo: false } : p
      )));
  }

  function handleTxLotSelect(productId: string, lotId: string) {
    setTxSelected(prev => prev.map(p =>
      p.productId === productId ? { ...p, selectedLotId: p.selectedLotId === lotId ? null : lotId } : p
    ));
  }

  function handleTxQtyChange(productId: string, qty: string) {
    setTxSelected(prev => prev.map(p => p.productId === productId ? { ...p, qty } : p));
  }

  const serialIncoming = adjType !== MOVEMENT_TYPE.STOCK_OUT && !adjDecrease;
  const unitMode = adjMachine && serialIncoming;
  const unitQty = Math.max(0, Math.min(200, Math.floor(parseFloat(adjQty) || 0)));
  // Rows follow the quantity — one per machine; entries already typed are kept
  const unitRows = Array.from({ length: unitMode ? unitQty : 0 }, (_, i) => adjUnits[i] ?? { serialNo: "", use: adjUnits[i - 1]?.use ?? adjUnits.at(-1)?.use ?? "SALE" });
  function setUnitRow(i: number, patch: Partial<{ serialNo: string; use: string }>) {
    setAdjUnits(() => unitRows.map((row, j) => (j === i ? { ...row, ...patch } : row)));
  }
  async function pickAdjProduct(id: string, label: string) {
    setAdjProductId(id); setAdjProductLabel(label);
    setAdjMachine(false); setAdjUnits([]); setOutUnits([]); setOutPicked([]);
    if (!id) return;
    try {
      const [info, here] = await Promise.all([getProductSerialInfo(id), getUnitsAt(id, adjWarehouse)]);
      setAdjMachine(info.serial); setOutUnits(here);
    } catch { /* optional */ }
  }
  // Prefilled item: whether it has serial numbers here (for a decrease, pick which machines)
  useEffect(() => {
    if (!prefill) return;
    let off = false;
    Promise.all([getProductSerialInfo(prefill.productId), getUnitsAt(prefill.productId, prefill.location)])
      .then(([info, here]) => { if (!off) { setAdjMachine(info.serial); setOutUnits(here); } })
      .catch(() => {});
    return () => { off = true; };
  }, [prefill]);
  const pickOut = outUnits.length > 0 && (adjType === MOVEMENT_TYPE.STOCK_OUT || adjDecrease);

  async function handleAdjust(e: React.FormEvent) {
    e.preventDefault();
    if (!adjWarehouse) { toast.error("Choose the location"); return; }
    if (!adjProductId) { toast.error("Select a product"); return; }
    const qty = pickOut && outPicked.length ? outPicked.length : parseFloat(adjQty);
    if (isNaN(qty) || qty <= 0) { toast.error("Enter a valid quantity"); return; }
    if (unitMode) {
      if (!Number.isInteger(qty)) { toast.error("Machines are counted in whole units"); return; }
      const missing = unitRows.findIndex((u) => !u.serialNo.trim());
      if (missing >= 0) { toast.error(`Enter the serial number for unit ${missing + 1} — one per machine`); return; }
      const seen = new Set<string>();
      const dup = unitRows.find((u) => { const k = u.serialNo.trim().toLowerCase(); if (seen.has(k)) return true; seen.add(k); return false; });
      if (dup) { toast.error(`Serial number ${dup.serialNo.trim()} is entered twice`); return; }
    }
    setSaving(true);
    try {
      await adjustStock({
        productId: adjProductId, warehouseLabel: adjWarehouse, movementType: adjType, quantity: adjDecrease ? -qty : qty, unitCost: adjCost || undefined,
        referenceNo: adjRef || undefined, notes: adjNotes || undefined,
        ...(unitMode ? { units: unitRows.map((u) => ({ serialNo: u.serialNo.trim(), intendedUse: u.use })) }
          : pickOut && outPicked.length ? { outUnitIds: outPicked }
          : { serialNo: adjSerialNo.trim() || undefined }),
        lotNo: adjLotNo || undefined, expiryDate: adjExpiry ? new Date(adjExpiry) : undefined,
      });
      toast.success(unitMode && qty > 1 ? `${qty} units recorded` : "Movement recorded");
      setAdjOpen(false);
      setAdjDir("increase");
      setAdjProductId(""); setAdjProductLabel(""); setAdjQty(""); setAdjCost(""); setAdjRef(""); setAdjNotes(""); setAdjLotNo(""); setAdjExpiry(""); setAdjSerialNo(""); setAdjMachine(false); setAdjUnits([]); setOutUnits([]); setOutPicked([]);
      startTransition(() => router.refresh());
    } catch (err) { toast.error(err instanceof Error ? err.message : "Failed"); }
    finally { setSaving(false); }
  }

  async function handleTransfer(e: React.FormEvent) {
    e.preventDefault();
    if (txSelected.length === 0) { toast.error("Select at least one product"); return; }
    for (const p of txSelected) {
      const qty = parseFloat(p.qty);
      if (isNaN(qty) || qty <= 0) { toast.error(`Enter a valid quantity for ${p.productCode}`); return; }
      if (qty > p.onHand) { toast.error(`${p.productCode}: only ${p.onHand} units on hand`); return; }
    }
    setTransferring(true);
    try {
      for (const p of txSelected) {
        const qty = parseFloat(p.qty);
        const lot = p.lots.find(l => l.id === p.selectedLotId) ?? null;
        await transferStock({
          productId: p.productId, fromWarehouse: txFrom, toWarehouse: txTo, quantity: qty,
          notes: txNotes || undefined,
          lotNo: lot?.lotNo || undefined,
          expiryDate: lot?.expiryDate ?? undefined,
        });
      }
      toast.success(`Transferred ${txSelected.length} product(s): ${formatWarehouse(txFrom)} → ${formatWarehouse(txTo)}`);
      setTxOpen(false);
      setTxSelected([]); setTxFromStock([]); setTxNotes("");
      startTransition(() => router.refresh());
    } catch (err) { toast.error(err instanceof Error ? err.message : "Failed"); }
    finally { setTransferring(false); }
  }

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("ALL");

  // ── Edit sheet ─────────────────────────────────────────────────────────────
  const [editOpen, setEditOpen] = useState(false);
  const [editItem, setEditItem] = useState<MovementWithMeta | null>(null);
  const [editProductId, setEditProductId] = useState("");
  const [editProductLabel, setEditProductLabel] = useState("");
  const [editWarehouse, setEditWarehouse] = useState("");
  const [editType, setEditType] = useState("");
  const [editQty, setEditQty] = useState("");
  const [editDir, setEditDir] = useState<"increase" | "decrease">("increase");
  const [editCost, setEditCost] = useState("");
  const [editRef, setEditRef] = useState("");
  const [editSerialNo, setEditSerialNo] = useState("");
  const [editLotNo, setEditLotNo] = useState("");
  const [editExpiry, setEditExpiry] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  // ── Delete confirm ─────────────────────────────────────────────────────────
  const [deleteTarget, setDeleteTarget] = useState<MovementWithMeta | null>(null);
  const [deleting, setDeleting] = useState(false);

  function openEdit(m: MovementWithMeta) {
    setEditItem(m);
    setEditProductId(m.productId);
    setEditProductLabel(m.productCode);
    setEditWarehouse(m.warehouseLabel);
    setEditType(m.movementType);
    setEditQty(String(Math.abs(parseFloat(m.quantity))));
    setEditDir(parseFloat(m.quantity) < 0 ? "decrease" : "increase");
    setEditCost(m.unitCost ?? "");
    setEditRef(m.referenceNo ?? "");
    setEditSerialNo(m.serialNo ?? "");
    setEditLotNo(m.lotNo ?? "");
    setEditExpiry(m.expiryDate ? new Date(m.expiryDate).toISOString().split("T")[0] : "");
    setEditNotes(m.notes ?? "");
    setEditOpen(true);
  }

  async function handleEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editItem) return;
    setSavingEdit(true);
    try {
      const isPending = editItem.status === "PENDING";
      const qty = parseFloat(editQty);
      if (isPending && (isNaN(qty) || qty <= 0)) { toast.error("Enter a valid quantity"); setSavingEdit(false); return; }
      await editStockMovement(editItem.id, {
        notes: editNotes || null,
        referenceNo: editRef || null,
        serialNo: editSerialNo || null,
        lotNo: editLotNo || null,
        expiryDate: editExpiry ? new Date(editExpiry) : null,
        ...(isPending && {
          productId: editProductId,
          warehouseLabel: editWarehouse,
          movementType: editType,
          quantity: editType === MOVEMENT_TYPE.ADJUSTMENT && editDir === "decrease" ? -qty : qty,
          unitCost: editCost || null,
        }),
      });
      toast.success("Movement updated");
      setEditOpen(false);
      startTransition(() => router.refresh());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally { setSavingEdit(false); }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteStockMovement(deleteTarget.id);
      toast.success("Movement deleted");
      setDeleteTarget(null);
      startTransition(() => router.refresh());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally { setDeleting(false); }
  }

  const filtered = movements.filter(m => {
    const matchSearch =
      m.productCode.toLowerCase().includes(search.toLowerCase()) ||
      (m.referenceNo ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (m.notes ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (m.lotNo ?? "").toLowerCase().includes(search.toLowerCase());
    const matchType = typeFilter === "ALL" || (typeFilter === CONSIGNED_IN ? !!m.consignedIn : !m.consignedIn && m.movementType === typeFilter);
    return matchSearch && matchType;
  });

  return (
    <div className="p-6 flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.push("/dashboard/inventory")} className="h-8 w-8">
          <ArrowLeftIcon className="h-4 w-4"/>
        </Button>
        <div>
          <h1 className="text-xl font-semibold">Movement History</h1>
          <p className="text-sm text-muted-foreground">{movements.length} records (latest 200)</p>
        </div>
        <div className="flex items-center gap-2 ml-auto">
          {canAdjust && warehouses.length > 0 && (
            <Button size="sm" variant="outline" onClick={() => setTxOpen(true)} className="gap-1.5">
              <ArrowLeftRightIcon className="h-4 w-4"/>Transfer
            </Button>
          )}
          {canAdjust && (
            <Button size="sm" onClick={() => { setAdjWarehouse(""); setAdjOpen(true); }} className="gap-1.5">
              <PlusIcon className="h-4 w-4"/>New Movement
            </Button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <Input placeholder="Search product, reference, lot, notes…" value={search} onChange={e => setSearch(e.target.value)} className="max-w-xs"/>
        <div className="flex items-center gap-1.5 flex-wrap">
          {["ALL", "STOCK_IN", "STOCK_OUT", "ADJUSTMENT", "RETURN", "OPENING"].map(t => (
            <Button key={t} size="sm" variant={typeFilter === t ? "default" : "outline"} className="h-7 text-xs" onClick={() => setTypeFilter(t)}>
              {t === "ALL" ? "All" : MOVEMENT_LABELS[t] ?? t}
            </Button>
          ))}
          {movements.some((m) => m.consignedIn) && (
            <Button size="sm" variant={typeFilter === CONSIGNED_IN ? "default" : "outline"} className="h-7 text-xs border-dashed" onClick={() => setTypeFilter(CONSIGNED_IN)}>Consigned in</Button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40">
              <TableHead className="w-40">Date</TableHead>
              <TableHead className="w-32">Product</TableHead>
              <TableHead className="w-28">Warehouse</TableHead>
              <TableHead className="w-28">Type</TableHead>
              <TableHead className="w-24 text-right">Qty</TableHead>
              <TableHead className="w-24 text-right">Balance</TableHead>
              <TableHead className="w-28">Serial No.</TableHead>
              <TableHead className="w-24">Lot No.</TableHead>
              <TableHead className="w-28">Reference</TableHead>
              <TableHead>Notes</TableHead>
              <TableHead className="w-24">Status</TableHead>
              <TableHead className="w-32">By</TableHead>
              {(canManage || isOwner) && <TableHead className="w-20"/>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={(canManage || isOwner) ? 12 : 11} className="text-center py-10 text-sm text-muted-foreground">
                  No movements found.
                </TableCell>
              </TableRow>
            ) : filtered.map(m => {
              const ci = m.consignedIn;
              const qty = ci ? ci.delta : parseFloat(m.quantity);
              const balance = ci ? ci.balance : m.balanceAfter;
              return (
                <TableRow key={m.id} className={ci ? "bg-violet-50/30 dark:bg-violet-900/5" : undefined}>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{fmtDate(m.createdAt)}</TableCell>
                  <TableCell className="font-mono text-xs font-medium">{m.productCode}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {ci ? ci.fromName : formatWarehouse(m.warehouseLabel)}
                    {(ci ? ci.toName : m.warehouseTo) && <span className="text-muted-foreground"> → {ci ? ci.toName : formatWarehouse(m.warehouseTo!)}</span>}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`text-xs gap-1 ${TYPE_STYLE[m.movementType] ?? ""}`}>
                      {qty > 0 ? <TrendingUpIcon className="h-3 w-3"/> : <TrendingDownIcon className="h-3 w-3"/>}
                      {ci ? (ci.internal ? "Consigned moved" : CONSIGNED_IN_LABELS[m.movementType] ?? MOVEMENT_LABELS[m.movementType] ?? m.movementType) : MOVEMENT_LABELS[m.movementType] ?? m.movementType}
                    </Badge>
                    {ci && <div className="mt-1 text-[10px] font-medium text-violet-700 dark:text-violet-300 whitespace-nowrap">Owner: {ci.ownerName}</div>}
                  </TableCell>
                  <TableCell className={`text-right font-semibold tabular-nums text-sm ${qty >= 0 ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}`}>
                    {ci ? fmt(qty) : fmt(m.quantity)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                    {balance ? parseFloat(balance).toLocaleString("en-MY", { maximumFractionDigits: 4 }) : "—"}
                  </TableCell>
                  <TableCell className="text-xs font-mono text-muted-foreground">{m.serialNo ?? "—"}</TableCell>
                  <TableCell className="text-xs font-mono text-muted-foreground">{m.lotNo ?? "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{m.referenceNo ?? "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-48 truncate" title={m.notes ?? ""}>{m.notes ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`text-xs ${m.status === "APPROVED" ? "text-green-700 border-green-300 bg-green-50 dark:text-green-400" : m.status === "REJECTED" ? "text-red-700 border-red-300 bg-red-50 dark:text-red-400" : "text-amber-700 border-amber-300 bg-amber-50 dark:text-amber-400"}`}>
                      {m.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{m.createdByName ?? "—"}</TableCell>
                  {(canManage || isOwner) && (ci ? <TableCell/> :
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {canManage && (
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(m)} title="Edit">
                            <PencilIcon className="h-3.5 w-3.5"/>
                          </Button>
                        )}
                        {isOwner && (
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => setDeleteTarget(m)} title="Delete">
                            <Trash2Icon className="h-3.5 w-3.5"/>
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* ── Edit Sheet ─────────────────────────────────────────────────────── */}
      <Sheet open={editOpen} onOpenChange={o => { if (!savingEdit) setEditOpen(o); }}>
        <SheetContent className="w-full data-[side=right]:sm:max-w-2xl overflow-y-auto px-6">
          <SheetHeader className="mb-5">
            <SheetTitle>Edit Movement</SheetTitle>
            {editItem && (
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline" className={`text-xs ${editItem.status === "APPROVED" ? "text-green-700 border-green-300 bg-green-50 dark:text-green-400" : "text-amber-700 border-amber-300 bg-amber-50 dark:text-amber-400"}`}>
                  {editItem.status}
                </Badge>
                <p className="text-xs text-muted-foreground font-mono">{editItem.productCode} · {formatWarehouse(editItem.warehouseLabel)} · {fmtDate(editItem.createdAt)}</p>
              </div>
            )}
          </SheetHeader>
          <form onSubmit={handleEdit} className="flex flex-col gap-4">
            {editItem?.status === "PENDING" ? (
              <>
                <div className="flex flex-col gap-1.5">
                  <Label>Location <span className="text-destructive">*</span></Label>
                  <Select value={editWarehouse} onValueChange={setEditWarehouse}>
                    <SelectTrigger className="w-full"><SelectValue/></SelectTrigger>
                    <LocationOptions warehouses={warehouses}/>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Product <span className="text-destructive">*</span></Label>
                  <ProductSearch value={editProductId} initialLabel={editProductLabel} onChange={(id, _code, fullLabel) => { setEditProductId(id); setEditProductLabel(fullLabel); }}/>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Movement Type <span className="text-destructive">*</span></Label>
                  <Select value={editType} onValueChange={setEditType}>
                    <SelectTrigger><SelectValue/></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={MOVEMENT_TYPE.OPENING}>Opening Balance</SelectItem>
                      {!editWarehouse.startsWith("Field:") && <SelectItem value={MOVEMENT_TYPE.STOCK_IN}>Stock In ↑</SelectItem>}
                      <SelectItem value={MOVEMENT_TYPE.STOCK_OUT}>Stock Out ↓</SelectItem>
                      <SelectItem value={MOVEMENT_TYPE.ADJUSTMENT}>Adjustment ↕</SelectItem>
                      <SelectItem value={MOVEMENT_TYPE.RETURN}>Return</SelectItem>
                    </SelectContent>
                  </Select>
                  {editType === MOVEMENT_TYPE.ADJUSTMENT && <DirectionToggle value={editDir} onChange={setEditDir}/>}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <Label>Quantity <span className="text-destructive">*</span></Label>
                    <Input type="number" min="0.0001" step="0.0001" placeholder="0" value={editQty} onChange={e => setEditQty(e.target.value)}/>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label>Unit Cost (RM) <span className="text-muted-foreground font-normal text-xs">(opt)</span></Label>
                    <Input type="number" min="0" step="0.01" placeholder="0.00" value={editCost} onChange={e => setEditCost(e.target.value)}/>
                  </div>
                </div>
              </>
            ) : (
              <p className="text-xs text-muted-foreground bg-muted rounded-md px-3 py-2">
                Approved movement — product, warehouse, type, and quantity are locked. Only reference, lot, expiry, and notes can be updated.
              </p>
            )}
            <div className="flex flex-col gap-1.5">
              <Label>Reference No. <span className="text-muted-foreground font-normal text-xs">(opt)</span></Label>
              <Input placeholder="e.g. PO-001" value={editRef} onChange={e => setEditRef(e.target.value)}/>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Serial No. <span className="text-muted-foreground font-normal text-xs">(opt)</span></Label>
              <Input placeholder="e.g. SN-2024-001" value={editSerialNo} onChange={e => setEditSerialNo(e.target.value)}/>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label>Lot No. <span className="text-muted-foreground font-normal text-xs">(opt)</span></Label>
                <Input placeholder="e.g. LOT-240301" value={editLotNo} onChange={e => setEditLotNo(e.target.value)}/>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Expiry Date <span className="text-muted-foreground font-normal text-xs">(opt)</span></Label>
                <Input type="date" value={editExpiry} onChange={e => setEditExpiry(e.target.value)}/>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Notes <span className="text-muted-foreground font-normal text-xs">(opt)</span></Label>
              <Input placeholder="Notes…" value={editNotes} onChange={e => setEditNotes(e.target.value)}/>
            </div>
            <div className="flex gap-2 pt-2">
              <Button type="submit" disabled={savingEdit} className="flex-1">{savingEdit ? "Saving…" : "Save"}</Button>
              <Button type="button" variant="outline" onClick={() => setEditOpen(false)} disabled={savingEdit}>Cancel</Button>
            </div>
          </form>
        </SheetContent>
      </Sheet>

      {/* ── Delete Confirmation ─────────────────────────────────────────────── */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-background rounded-xl border border-border shadow-xl p-6 max-w-sm w-full mx-4 flex flex-col gap-4">
            <h2 className="text-base font-semibold">Delete movement?</h2>
            <p className="text-sm text-muted-foreground">
              <span className="font-mono font-medium">{deleteTarget.productCode}</span> · {fmtDate(deleteTarget.createdAt)}
              <br/>{MOVEMENT_LABELS[deleteTarget.movementType] ?? deleteTarget.movementType} · {fmt(deleteTarget.quantity)}
            </p>
            <p className="text-xs text-muted-foreground">
              This cannot be undone.
            </p>
            <div className="flex gap-2">
              <Button variant="destructive" className="flex-1" disabled={deleting} onClick={handleDelete}>
                {deleting ? "Deleting…" : "Delete"}
              </Button>
              <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>Cancel</Button>
            </div>
          </div>
        </div>
      )}

      {/* ── New Movement Sheet ─────────────────────────────────────────────── */}
      <Sheet open={adjOpen} onOpenChange={o => { if (!saving) setAdjOpen(o); }}>
        <SheetContent className="w-full data-[side=right]:sm:max-w-2xl overflow-y-auto px-6">
          <SheetHeader className="mb-5"><SheetTitle>New Movement</SheetTitle></SheetHeader>
          <form onSubmit={handleAdjust} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>Location <span className="text-destructive">*</span></Label>
              <Select value={adjWarehouse} onValueChange={v => { setAdjWarehouse(v); setAdjProductId(""); setAdjProductLabel(""); if (v.startsWith("Field:") && FIELD_RESTRICTED.includes(adjType)) setAdjType(MOVEMENT_TYPE.STOCK_OUT); }}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Where is the stock? — a warehouse or a specialist's field stock"/></SelectTrigger>
                <LocationOptions warehouses={warehouses}/>
              </Select>
              {adjWarehouse && <p className="text-xs text-muted-foreground">{locationHint(warehouses, adjWarehouse)}</p>}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Product <span className="text-destructive">*</span></Label>
              {adjLoadingField && <p className="text-xs text-muted-foreground animate-pulse">Loading field stock…</p>}
              {adjFieldItems.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {adjFieldItems.map(item => {
                    const fl = `${item.productCode}${item.description ? ` — ${item.description}` : ""}`;
                    return (
                      <button key={item.productId} type="button"
                        onClick={() => pickAdjProduct(item.productId, fl)}
                        className={cn(
                          "text-xs px-2.5 py-1 rounded-full border transition-colors",
                          adjProductId === item.productId
                            ? "bg-teal-600 text-white border-teal-600 dark:bg-teal-700"
                            : "border-border bg-background hover:bg-muted"
                        )}
                      >
                        <span className="font-mono font-medium">{item.productCode}</span>
                        <span className="ml-1 opacity-60 text-[10px]">{item.qty}</span>
                      </button>
                    );
                  })}
                </div>
              )}
              <ProductSearch key={adjProductId} value={adjProductId} initialLabel={adjProductLabel} onChange={(id, _code, fullLabel) => pickAdjProduct(id, fullLabel)}/>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Movement Type <span className="text-destructive">*</span></Label>
              <Select value={adjType} onValueChange={setAdjType}>
                <SelectTrigger><SelectValue/></SelectTrigger>
                <SelectContent>
                  <SelectItem value={MOVEMENT_TYPE.OPENING}>Opening Balance</SelectItem>
                  {!adjWarehouse.startsWith("Field:") && <SelectItem value={MOVEMENT_TYPE.STOCK_IN}>Stock In ↑</SelectItem>}
                  <SelectItem value={MOVEMENT_TYPE.STOCK_OUT}>Stock Out ↓</SelectItem>
                  <SelectItem value={MOVEMENT_TYPE.ADJUSTMENT}>Adjustment ↕</SelectItem>
                  <SelectItem value={MOVEMENT_TYPE.RETURN}>Return</SelectItem>
                </SelectContent>
              </Select>
              {adjType === MOVEMENT_TYPE.ADJUSTMENT && <DirectionToggle value={adjDir} onChange={setAdjDir}/>}
              <p className="text-xs text-muted-foreground">{MOVEMENT_HINT[adjType]}</p>
              {adjWarehouse.startsWith("Field:") && (
                <p className="text-xs text-muted-foreground">Field stock is replenished via Transfer from a warehouse, not Stock In.</p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label>Quantity <span className="text-destructive">*</span></Label>
                {pickOut && outPicked.length > 0
                  ? <Input value={outPicked.length} readOnly className="bg-muted/40" title="One per serial number picked"/>
                  : <Input type="number" min={unitMode ? "1" : "0.0001"} step={unitMode ? "1" : "0.0001"} placeholder="0" value={adjQty} onChange={e => setAdjQty(e.target.value)}/>}
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
            {pickOut && (
              <div className="flex flex-col gap-1.5 rounded-md border border-border bg-muted/20 p-3">
                <Label>Which machine(s) are going out?</Label>
                <div className="flex flex-wrap gap-1.5">
                  {outUnits.map((u) => {
                    const on = outPicked.includes(u.id);
                    return (
                      <button key={u.id} type="button" onClick={() => setOutPicked((prev) => on ? prev.filter((x) => x !== u.id) : [...prev, u.id])}
                        className={cn("text-xs font-mono px-2 py-1 rounded-md border", on ? "bg-primary text-primary-foreground border-primary" : "border-border bg-background hover:bg-muted")}>
                        {on ? "✓ " : ""}{u.serialNo}<span className="ml-1.5 font-sans opacity-70">{unitUseLabel(u.intendedUse).toLowerCase()}</span>
                      </button>
                    );
                  })}
                </div>
                <p className="text-[11px] text-muted-foreground">The picked machines leave inventory. Leave none picked only for units here that have no serial number.</p>
              </div>
            )}
            {serialIncoming && (
              <label className="flex items-start gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={adjMachine} onChange={(e) => setAdjMachine(e.target.checked)} className="mt-1"/>
                <span><span className="font-medium">Each unit has its own serial number</span>
                  <span className="block text-xs text-muted-foreground">Machines and serial-tracked items — one serial number per unit, so each one can be picked on transfers, Case DOs and consignments.</span></span>
              </label>
            )}
            {unitMode ? (
              <div className="flex flex-col gap-2 rounded-md border border-border bg-muted/20 p-3">
                <div className="flex items-center justify-between gap-2">
                  <Label>Serial numbers <span className="text-destructive">*</span> <span className="text-muted-foreground font-normal text-xs">— {unitQty} unit{unitQty === 1 ? "" : "s"}, one per machine</span></Label>
                  {unitRows.length > 1 && (
                    <select className="h-7 rounded-md border border-input bg-background px-1.5 text-xs" value="" onChange={(e) => e.target.value && setAdjUnits(unitRows.map((u) => ({ ...u, use: e.target.value })))}>
                      <option value="">Set all to…</option>
                      {Object.entries(INTENDED_USE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </select>
                  )}
                </div>
                {unitRows.length === 0 ? <p className="text-xs text-muted-foreground">Enter the quantity above — a row appears for each machine.</p> : unitRows.map((u, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground w-5 text-right tabular-nums">{i + 1}</span>
                    <Input value={u.serialNo} onChange={(e) => setUnitRow(i, { serialNo: e.target.value })} placeholder="Serial no." className="h-8 font-mono text-sm flex-1"/>
                    <select value={u.use} onChange={(e) => setUnitRow(i, { use: e.target.value })}
                      className={cn("h-8 rounded-md border px-2 text-xs w-28", isLendable(u.use) ? "border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-900/20" : "border-input bg-background")}>
                      {Object.entries(INTENDED_USE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </select>
                  </div>
                ))}
                <p className="text-[11px] text-muted-foreground"><strong>For sale</strong> — sold / used up on a case. <strong>Rental, Loan, Demo</strong> — never sold: lent for a case and comes back.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                <Label>Serial No. <span className="text-muted-foreground font-normal text-xs">(opt)</span></Label>
                <Input placeholder="e.g. SN-2024-001" value={adjSerialNo} onChange={e => setAdjSerialNo(e.target.value)}/>
              </div>
            )}
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
              <Button type="button" variant="outline" onClick={() => setAdjOpen(false)} disabled={saving}>Cancel</Button>
            </div>
          </form>
        </SheetContent>
      </Sheet>

      {/* ── Transfer Sheet ─────────────────────────────────────────────────── */}
      <Sheet open={txOpen} onOpenChange={o => { if (!transferring) setTxOpen(o); }}>
        <SheetContent className="w-full data-[side=right]:sm:max-w-2xl overflow-y-auto px-6">
          <SheetHeader className="mb-5"><SheetTitle>Transfer Between Warehouses</SheetTitle></SheetHeader>
          <form onSubmit={handleTransfer} className="flex flex-col gap-4">
            <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
              <div className="flex flex-col gap-1.5">
                <Label>From</Label>
                <Select value={txFrom} onValueChange={setTxFrom}>
                  <SelectTrigger><SelectValue/></SelectTrigger>
                  <LocationOptions warehouses={warehouses}/>
                </Select>
              </div>
              <ArrowRightIcon className="h-4 w-4 text-muted-foreground mb-2 shrink-0"/>
              <div className="flex flex-col gap-1.5">
                <Label>To</Label>
                <Select value={txTo} onValueChange={setTxTo}>
                  <SelectTrigger><SelectValue/></SelectTrigger>
                  <LocationOptions warehouses={warehouses}/>
                </Select>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Product <span className="text-destructive">*</span></Label>
              {txFromStockLoading && <p className="text-xs text-muted-foreground">Loading…</p>}
              {!txFromStockLoading && txFromStock.length === 0 && (
                <p className="text-xs text-muted-foreground">No stock in this warehouse.</p>
              )}
              {!txFromStockLoading && txFromStock.length > 0 && (
                <div className="flex flex-col gap-0.5 max-h-48 overflow-y-auto rounded-md border border-border">
                  {txFromStock.map(item => {
                    const selected = txSelected.some(p => p.productId === item.productId);
                    return (
                      <button
                        key={item.productId}
                        type="button"
                        onClick={() => handleTxProductToggle(item)}
                        className={cn(
                          "flex items-center justify-between px-3 py-2 text-xs text-left transition-colors",
                          selected ? "bg-teal-600 text-white" : "hover:bg-muted"
                        )}
                      >
                        <span className="flex items-center gap-2">
                          <span className={cn("w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0", selected ? "bg-white border-white" : "border-border")}>
                            {selected && <span className="text-teal-600 font-bold text-[10px]">✓</span>}
                          </span>
                          <span className="font-mono font-medium">{item.productCode}</span>
                          {item.description && <span className="opacity-70">{item.description}</span>}
                        </span>
                        <span className={cn("tabular-nums shrink-0 ml-3", selected ? "text-white/80" : "text-muted-foreground")}>
                          {item.quantity.toLocaleString("en-MY", { maximumFractionDigits: 4 })} {item.uom ?? ""}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* ── Per-product detail cards ─────────────────────────────────────── */}
            {txSelected.map(p => {
              const qty = parseFloat(p.qty);
              const overQty = !isNaN(qty) && qty > p.onHand;
              return (
                <div key={p.productId} className="rounded-md border border-border bg-muted/20 flex flex-col gap-3 p-3">
                  {/* Header */}
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-xs font-mono font-semibold">{p.productCode}</p>
                      {p.description && <p className="text-[11px] text-muted-foreground mt-0.5">{p.description}</p>}
                    </div>
                    <button type="button" onClick={() => handleTxProductToggle({ productId: p.productId, productCode: p.productCode, description: p.description, uom: p.uom, quantity: p.onHand })}
                      className="text-muted-foreground hover:text-destructive text-xs ml-2 shrink-0">✕</button>
                  </div>

                  {/* Qty input */}
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs">Qty to transfer <span className="text-destructive">*</span></Label>
                      <span className="text-[11px] text-muted-foreground">On hand: <span className={overQty ? "text-destructive font-medium" : "font-medium"}>{p.onHand.toLocaleString("en-MY", { maximumFractionDigits: 4 })} {p.uom ?? ""}</span></span>
                    </div>
                    <Input type="number" min="0.0001" step="0.0001" placeholder="0"
                      value={p.qty} onChange={e => handleTxQtyChange(p.productId, e.target.value)}
                      className={overQty ? "border-destructive focus-visible:ring-destructive h-8 text-xs" : "h-8 text-xs"}
                    />
                    {overQty && <p className="text-[11px] text-destructive">Exceeds on-hand quantity</p>}
                  </div>

                  {/* Read-only lot + serial info */}
                  {p.loadingInfo ? (
                    <p className="text-[11px] text-muted-foreground">Loading stock info…</p>
                  ) : (
                    <>
                      {p.lots.length > 0 && (
                        <div className="flex flex-col gap-1.5">
                          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Lot</p>
                          <div className="flex flex-wrap gap-1.5">
                            {p.lots.map(lot => (
                              <button key={lot.id} type="button"
                                onClick={() => handleTxLotSelect(p.productId, lot.id)}
                                className={cn(
                                  "text-[11px] px-2 py-0.5 rounded-full border transition-colors",
                                  p.selectedLotId === lot.id
                                    ? "bg-teal-600 text-white border-teal-600"
                                    : "border-border bg-background hover:bg-muted"
                                )}
                              >
                                <span className="font-mono">{lot.lotNo}</span>
                                {lot.expiryDate && <span className="ml-1.5 opacity-70">exp {new Date(lot.expiryDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</span>}
                                <span className="ml-1.5 opacity-60">({lot.quantity})</span>
                              </button>
                            ))}
                          </div>
                          {p.selectedLotId && (() => {
                            const lot = p.lots.find(l => l.id === p.selectedLotId)!;
                            return (
                              <div className="grid grid-cols-2 gap-2 mt-0.5 text-xs">
                                <div><p className="text-[10px] text-muted-foreground">Lot No.</p><p className="font-mono font-medium">{lot.lotNo}</p></div>
                                <div><p className="text-[10px] text-muted-foreground">Expiry</p><p>{lot.expiryDate ? new Date(lot.expiryDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—"}</p></div>
                              </div>
                            );
                          })()}
                        </div>
                      )}
                      {p.serialNos.length > 0 && (
                        <div className="flex flex-col gap-1">
                          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Serial No.</p>
                          <div className="flex flex-wrap gap-1">
                            {p.serialNos.map(sn => (
                              <span key={sn} className="text-[11px] font-mono px-1.5 py-0.5 rounded border border-border bg-background">{sn}</span>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}

            <div className="flex flex-col gap-1.5">
              <Label>Notes <span className="text-muted-foreground font-normal text-xs">(opt)</span></Label>
              <Input placeholder="Reason for transfer…" value={txNotes} onChange={e => setTxNotes(e.target.value)}/>
            </div>
            <div className="flex gap-2 pt-2">
              <Button type="submit" disabled={transferring} className="flex-1">{transferring ? "Transferring…" : "Transfer"}</Button>
              <Button type="button" variant="outline" onClick={() => setTxOpen(false)} disabled={transferring}>Cancel</Button>
            </div>
          </form>
        </SheetContent>
      </Sheet>
    </div>
  );
}

// ── Location picker ──────────────────────────────────────────────────────────
// Warehouses and the company's specialists (field stock) in two labelled
// groups. A company with no warehouse set up keeps its stock under the
// placeholder label "Default" — shown as "Main warehouse" with a nudge to name it.
type LocationRow = { label: string; address: string; notMember?: boolean };

function warehouseName(w: LocationRow) {
  return w.label === "Default" ? "Main warehouse" : w.label;
}

function locationHint(warehouses: LocationRow[], label: string) {
  const w = warehouses.find((x) => x.label === label);
  if (!w) return "";
  if (label.startsWith("Field:")) return w.notMember ? "Not a member of this company — this balance can only be taken out." : `Stock held by ${w.address} (field stock).`;
  if (label === "Default") return "No warehouse is set up for this company yet — name it (with its address) in Organization → Organization Profile → Warehouses.";
  return w.address || "No address set for this warehouse.";
}

function LocationOptions({ warehouses }: { warehouses: LocationRow[] }) {
  const stores = warehouses.filter((w) => !w.label.startsWith("Field:"));
  const field = warehouses.filter((w) => w.label.startsWith("Field:"));
  return (
    <SelectContent>
      {stores.length > 0 && (
        <SelectGroup>
          <SelectLabel>Warehouses</SelectLabel>
          {stores.map((w) => (
            <SelectItem key={w.label} value={w.label}>
              {warehouseName(w)}{w.label === "Default" && <span className="text-muted-foreground text-xs"> (not set up)</span>}
            </SelectItem>
          ))}
        </SelectGroup>
      )}
      {stores.length > 0 && field.length > 0 && <SelectSeparator/>}
      {field.length > 0 && (
        <SelectGroup>
          <SelectLabel>Field stock — specialists</SelectLabel>
          {field.map((w) => (
            <SelectItem key={w.label} value={w.label}>
              {w.notMember ? <span className="text-amber-700 dark:text-amber-400">{w.address}</span> : w.address || w.label.slice(6)}
            </SelectItem>
          ))}
        </SelectGroup>
      )}
    </SelectContent>
  );
}

// What each manual movement type is for — shown under the Movement Type picker
const MOVEMENT_HINT: Record<string, string> = {
  [MOVEMENT_TYPE.OPENING]: "The starting quantity of this product here when you begin using the system. Not for later corrections — use Adjustment.",
  [MOVEMENT_TYPE.STOCK_IN]: "Goods received without a purchase order (supplier samples, stock found). Goods bought on a PO come in through Goods Receipt — don't enter them here as well.",
  [MOVEMENT_TYPE.STOCK_OUT]: "Goods leaving without a delivery order: damaged, expired, lost, internal use, samples given. Say why in Notes. To sell use a DO, for a case a Case DO, to move stock a Transfer.",
  [MOVEMENT_TYPE.ADJUSTMENT]: "Stock-count correction: Increase when you counted more than the system shows, Decrease when you counted less. Note which count it was.",
  [MOVEMENT_TYPE.RETURN]: "Goods coming back that aren't on any document (e.g. back from repair). A customer return goes on its DO (Record Return), a specialist's stock through Return from Rep, consigned stock through Consignment → Return.",
};

function DirectionToggle({ value, onChange }: { value: "increase" | "decrease"; onChange: (v: "increase" | "decrease") => void }) {
  return (
    <div className="inline-flex rounded-md border border-border overflow-hidden text-xs w-fit">
      {(["increase", "decrease"] as const).map((d) => (
        <button key={d} type="button" onClick={() => onChange(d)}
          className={cn("px-3 h-7", value === d ? (d === "increase" ? "bg-green-600 text-white" : "bg-red-600 text-white") : "hover:bg-muted")}>
          {d === "increase" ? "Increase (+)" : "Decrease (−)"}
        </button>
      ))}
    </div>
  );
}
