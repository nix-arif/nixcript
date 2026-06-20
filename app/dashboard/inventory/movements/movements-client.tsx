"use client";

import { useState, useTransition, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { ArrowLeftIcon, ArrowRightIcon, ArrowLeftRightIcon, TrendingUpIcon, TrendingDownIcon, PencilIcon, Trash2Icon, PlusIcon } from "lucide-react";
import type { MovementWithMeta, Warehouse } from "@/server/inventory";
import { adjustStock, transferStock, searchProducts, editStockMovement, deleteStockMovement } from "@/server/inventory";
import { MOVEMENT_LABELS, MOVEMENT_TYPE } from "@/lib/inventory/constants";

const TYPE_STYLE: Record<string, string> = {
  STOCK_IN:   "text-green-700 border-green-300 bg-green-50 dark:text-green-400 dark:border-green-700 dark:bg-green-900/20",
  OPENING:    "text-blue-700 border-blue-300 bg-blue-50 dark:text-blue-400 dark:border-blue-700",
  STOCK_OUT:  "text-red-700 border-red-300 bg-red-50 dark:text-red-400 dark:border-red-700",
  ADJUSTMENT: "text-purple-700 border-purple-300 bg-purple-50 dark:text-purple-400 dark:border-purple-700",
  RETURN:     "text-amber-700 border-amber-300 bg-amber-50 dark:text-amber-400 dark:border-amber-700",
};

function ProductSearch({ value, initialLabel, onChange }: { value: string; initialLabel?: string; onChange: (id: string, code: string) => void }) {
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
    onChange(item.id, item.productCode);
    setLabel(displayLabel);
    setQuery(""); setResults([]); setOpen(false);
  }

  return (
    <div className="relative">
      <textarea
        rows={1}
        value={label || query}
        onChange={e => { if (value) { onChange("", ""); setLabel(""); } onInput(e.target.value); }}
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

export function MovementsClient({ movements, warehouses, permissions }: { movements: MovementWithMeta[]; warehouses: Warehouse[]; permissions: string[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const canManage = permissions.includes("inventory:manage") || permissions.includes("*");
  const canAdjust = permissions.includes("inventory:adjust") || permissions.includes("*");

  // ── New Movement sheet ─────────────────────────────────────────────────────
  const [adjOpen, setAdjOpen] = useState(false);
  const [adjProductId, setAdjProductId] = useState("");
  const [adjWarehouse, setAdjWarehouse] = useState(warehouses[0]?.label ?? "Default");
  const [adjType, setAdjType] = useState<string>(MOVEMENT_TYPE.STOCK_IN);
  const [adjQty, setAdjQty] = useState("");
  const [adjCost, setAdjCost] = useState("");
  const [adjRef, setAdjRef] = useState("");
  const [adjNotes, setAdjNotes] = useState("");
  const [adjLotNo, setAdjLotNo] = useState("");
  const [adjExpiry, setAdjExpiry] = useState("");
  const [saving, setSaving] = useState(false);

  // ── Transfer sheet ─────────────────────────────────────────────────────────
  const [txOpen, setTxOpen] = useState(false);
  const [txProductId, setTxProductId] = useState("");
  const [txFrom, setTxFrom] = useState(warehouses[0]?.label ?? "Default");
  const [txTo, setTxTo] = useState(warehouses[1]?.label ?? warehouses[0]?.label ?? "Default");
  const [txQty, setTxQty] = useState("");
  const [txNotes, setTxNotes] = useState("");
  const [transferring, setTransferring] = useState(false);

  async function handleAdjust(e: React.FormEvent) {
    e.preventDefault();
    if (!adjProductId) { toast.error("Select a product"); return; }
    const qty = parseFloat(adjQty);
    if (isNaN(qty) || qty <= 0) { toast.error("Enter a valid quantity"); return; }
    setSaving(true);
    try {
      await adjustStock({ productId: adjProductId, warehouseLabel: adjWarehouse, movementType: adjType, quantity: qty, unitCost: adjCost || undefined, referenceNo: adjRef || undefined, notes: adjNotes || undefined, lotNo: adjLotNo || undefined, expiryDate: adjExpiry ? new Date(adjExpiry) : undefined });
      toast.success("Movement recorded");
      setAdjOpen(false);
      setAdjProductId(""); setAdjQty(""); setAdjCost(""); setAdjRef(""); setAdjNotes(""); setAdjLotNo(""); setAdjExpiry("");
      startTransition(() => router.refresh());
    } catch (err) { toast.error(err instanceof Error ? err.message : "Failed"); }
    finally { setSaving(false); }
  }

  async function handleTransfer(e: React.FormEvent) {
    e.preventDefault();
    if (!txProductId) { toast.error("Select a product"); return; }
    const qty = parseFloat(txQty);
    if (isNaN(qty) || qty <= 0) { toast.error("Enter a valid quantity"); return; }
    setTransferring(true);
    try {
      await transferStock({ productId: txProductId, fromWarehouse: txFrom, toWarehouse: txTo, quantity: qty, notes: txNotes || undefined });
      toast.success(`Transferred ${qty} units: ${txFrom} → ${txTo}`);
      setTxOpen(false);
      setTxProductId(""); setTxQty(""); setTxNotes("");
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
  const [editCost, setEditCost] = useState("");
  const [editRef, setEditRef] = useState("");
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
    setEditCost(m.unitCost ?? "");
    setEditRef(m.referenceNo ?? "");
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
        lotNo: editLotNo || null,
        expiryDate: editExpiry ? new Date(editExpiry) : null,
        ...(isPending && {
          productId: editProductId,
          warehouseLabel: editWarehouse,
          movementType: editType,
          quantity: qty,
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
    const matchType = typeFilter === "ALL" || m.movementType === typeFilter;
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
          {canAdjust && warehouses.length > 1 && (
            <Button size="sm" variant="outline" onClick={() => setTxOpen(true)} className="gap-1.5">
              <ArrowLeftRightIcon className="h-4 w-4"/>Transfer
            </Button>
          )}
          {canAdjust && (
            <Button size="sm" onClick={() => setAdjOpen(true)} className="gap-1.5">
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
              <TableHead className="w-24">Lot No.</TableHead>
              <TableHead className="w-28">Reference</TableHead>
              <TableHead>Notes</TableHead>
              <TableHead className="w-24">Status</TableHead>
              <TableHead className="w-32">By</TableHead>
              {canManage && <TableHead className="w-20"/>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={canManage ? 12 : 11} className="text-center py-10 text-sm text-muted-foreground">
                  No movements found.
                </TableCell>
              </TableRow>
            ) : filtered.map(m => {
              const qty = parseFloat(m.quantity);
              return (
                <TableRow key={m.id}>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{fmtDate(m.createdAt)}</TableCell>
                  <TableCell className="font-mono text-xs font-medium">{m.productCode}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {m.warehouseLabel}
                    {m.warehouseTo && <span className="text-muted-foreground"> → {m.warehouseTo}</span>}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`text-xs gap-1 ${TYPE_STYLE[m.movementType] ?? ""}`}>
                      {qty > 0 ? <TrendingUpIcon className="h-3 w-3"/> : <TrendingDownIcon className="h-3 w-3"/>}
                      {MOVEMENT_LABELS[m.movementType] ?? m.movementType}
                    </Badge>
                  </TableCell>
                  <TableCell className={`text-right font-semibold tabular-nums text-sm ${qty >= 0 ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}`}>
                    {fmt(m.quantity)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                    {m.balanceAfter ? parseFloat(m.balanceAfter).toLocaleString("en-MY", { maximumFractionDigits: 4 }) : "—"}
                  </TableCell>
                  <TableCell className="text-xs font-mono text-muted-foreground">{m.lotNo ?? "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{m.referenceNo ?? "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-48 truncate" title={m.notes ?? ""}>{m.notes ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`text-xs ${m.status === "APPROVED" ? "text-green-700 border-green-300 bg-green-50 dark:text-green-400" : m.status === "REJECTED" ? "text-red-700 border-red-300 bg-red-50 dark:text-red-400" : "text-amber-700 border-amber-300 bg-amber-50 dark:text-amber-400"}`}>
                      {m.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{m.createdByName ?? "—"}</TableCell>
                  {canManage && (
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(m)} title="Edit">
                          <PencilIcon className="h-3.5 w-3.5"/>
                        </Button>
                        {m.status !== "APPROVED" && (
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
                <p className="text-xs text-muted-foreground font-mono">{editItem.productCode} · {editItem.warehouseLabel} · {fmtDate(editItem.createdAt)}</p>
              </div>
            )}
          </SheetHeader>
          <form onSubmit={handleEdit} className="flex flex-col gap-4">
            {editItem?.status === "PENDING" ? (
              <>
                <div className="flex flex-col gap-1.5">
                  <Label>Warehouse <span className="text-destructive">*</span></Label>
                  <Select value={editWarehouse} onValueChange={setEditWarehouse}>
                    <SelectTrigger><SelectValue/></SelectTrigger>
                    <SelectContent>
                      {warehouses.map(w => <SelectItem key={w.label} value={w.label}>{w.label}{w.address ? ` — ${w.address}` : ""}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Product <span className="text-destructive">*</span></Label>
                  <ProductSearch value={editProductId} initialLabel={editProductLabel} onChange={(id, code) => { setEditProductId(id); setEditProductLabel(code); }}/>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Movement Type <span className="text-destructive">*</span></Label>
                  <Select value={editType} onValueChange={setEditType}>
                    <SelectTrigger><SelectValue/></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={MOVEMENT_TYPE.OPENING}>Opening Balance</SelectItem>
                      <SelectItem value={MOVEMENT_TYPE.STOCK_IN}>Stock In ↑</SelectItem>
                      <SelectItem value={MOVEMENT_TYPE.STOCK_OUT}>Stock Out ↓</SelectItem>
                      <SelectItem value={MOVEMENT_TYPE.ADJUSTMENT}>Adjustment</SelectItem>
                      <SelectItem value={MOVEMENT_TYPE.RETURN}>Return</SelectItem>
                    </SelectContent>
                  </Select>
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
              Only pending movements can be deleted. This cannot be undone.
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
              <ProductSearch value={adjProductId} onChange={(id) => setAdjProductId(id)}/>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Movement Type <span className="text-destructive">*</span></Label>
              <Select value={adjType} onValueChange={setAdjType}>
                <SelectTrigger><SelectValue/></SelectTrigger>
                <SelectContent>
                  <SelectItem value={MOVEMENT_TYPE.OPENING}>Opening Balance</SelectItem>
                  <SelectItem value={MOVEMENT_TYPE.STOCK_IN}>Stock In ↑</SelectItem>
                  <SelectItem value={MOVEMENT_TYPE.STOCK_OUT}>Stock Out ↓</SelectItem>
                  <SelectItem value={MOVEMENT_TYPE.ADJUSTMENT}>Adjustment</SelectItem>
                  <SelectItem value={MOVEMENT_TYPE.RETURN}>Return</SelectItem>
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
            <div className="flex flex-col gap-1.5">
              <Label>Product <span className="text-destructive">*</span></Label>
              <ProductSearch value={txProductId} onChange={(id) => setTxProductId(id)}/>
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
              <Button type="button" variant="outline" onClick={() => setTxOpen(false)} disabled={transferring}>Cancel</Button>
            </div>
          </form>
        </SheetContent>
      </Sheet>
    </div>
  );
}
