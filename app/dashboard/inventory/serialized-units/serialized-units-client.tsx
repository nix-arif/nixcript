"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { PlusIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  listAssetUnits, registerAssetUnit, markAssetUnitReturned, getAssetUnitHistory,
  type AssetUnitListRow, type RegisterAssetUnitInput,
} from "@/server/asset-units";
import { searchProducts } from "@/server/products";
import { getFieldReps, type OrgMember } from "@/server/field-stock";
import { getCustomers } from "@/server/customer";
import { ASSET_UNIT_STATUS_LABELS } from "@/lib/inventory/constants";
import { MOVEMENT_LABELS } from "@/lib/inventory/constants";

const STATUS_STYLE: Record<string, string> = {
  IN_STOCK:  "text-teal-700 border-teal-300 bg-teal-50 dark:text-teal-400 dark:border-teal-700 dark:bg-teal-900/20",
  WITH_REP:  "text-blue-700 border-blue-300 bg-blue-50 dark:text-blue-400 dark:border-blue-700 dark:bg-blue-900/20",
  ON_LOAN:   "text-amber-700 border-amber-300 bg-amber-50 dark:text-amber-400 dark:border-amber-700 dark:bg-amber-900/20",
  SOLD:      "text-gray-700 border-gray-300 bg-gray-50 dark:text-gray-400 dark:border-gray-700 dark:bg-gray-900/20",
  IN_REPAIR: "text-purple-700 border-purple-300 bg-purple-50 dark:text-purple-400 dark:border-purple-700 dark:bg-purple-900/20",
  DISPOSED:  "text-red-700 border-red-300 bg-red-50 dark:text-red-400 dark:border-red-700 dark:bg-red-900/20",
};

function resolveLocation(u: AssetUnitListRow): string {
  if (u.status === "WITH_REP" || u.status === "ON_LOAN") {
    const base = u.holderName ? `With ${u.holderName}` : "With rep";
    return u.status === "ON_LOAN" && u.customerName ? `${base} · on loan to ${u.customerName}` : base;
  }
  if (u.status === "SOLD") return u.customerName ? `Sold to ${u.customerName}` : "Sold";
  return u.currentWarehouseLabel ?? "Warehouse";
}

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

function RegisterUnitDialog({ open, onOpenChange, onRegistered }: { open: boolean; onOpenChange: (v: boolean) => void; onRegistered: () => void }) {
  const [product, setProduct] = useState<{ id: string; productCode: string; description: string | null } | null>(null);
  const [serialNo, setSerialNo] = useState("");
  const [status, setStatus] = useState<string>("IN_STOCK");
  const [warehouseLabel, setWarehouseLabel] = useState("Default");
  const [reps, setReps] = useState<OrgMember[]>([]);
  const [repId, setRepId] = useState<string>("");
  const [custSearch, setCustSearch] = useState("");
  const [custResults, setCustResults] = useState<{ id: string; name: string }[]>([]);
  const [customerId, setCustomerId] = useState<string>("");
  const [customerName, setCustomerName] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const custTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (open) getFieldReps().then(setReps).catch(() => setReps([]));
  }, [open]);

  const needsRep = status === "WITH_REP" || status === "ON_LOAN";
  const needsCustomer = status === "SOLD" || status === "ON_LOAN";

  function searchCustomers(val: string) {
    setCustomerName(val);
    setCustomerId("");
    if (custTimer.current) clearTimeout(custTimer.current);
    if (val.trim().length < 2) { setCustResults([]); return; }
    custTimer.current = setTimeout(async () => {
      const r = await getCustomers(val);
      setCustResults(r.map((c: any) => ({ id: c.id, name: c.name })));
    }, 300);
  }

  function reset() {
    setProduct(null); setSerialNo(""); setStatus("IN_STOCK"); setWarehouseLabel("Default");
    setRepId(""); setCustSearch(""); setCustResults([]); setCustomerId(""); setCustomerName(""); setNotes("");
  }

  async function handleSubmit() {
    if (!product) { toast.error("Select a product"); return; }
    if (!serialNo.trim()) { toast.error("Enter a serial number"); return; }
    if (needsRep && !repId) { toast.error("Select which rep is holding this unit"); return; }
    if (needsCustomer && !customerId) { toast.error("Select the customer"); return; }

    setSaving(true);
    try {
      const input: RegisterAssetUnitInput = {
        productId: product.id, serialNo: serialNo.trim(), status,
        warehouseLabel: status === "IN_STOCK" || status === "IN_REPAIR" ? warehouseLabel : undefined,
        repId: needsRep ? repId : undefined,
        customerId: needsCustomer ? customerId : undefined,
        notes: notes.trim() || undefined,
      };
      await registerAssetUnit(input);
      toast.success("Unit registered");
      reset();
      onOpenChange(false);
      onRegistered();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to register unit");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Register existing unit</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Product</Label>
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
            <Label className="text-xs">Serial No <span className="text-destructive">*</span></Label>
            <Input value={serialNo} onChange={(e) => setSerialNo(e.target.value)} placeholder="e.g. 123456" className="h-9 text-sm" />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Current status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(ASSET_UNIT_STATUS_LABELS).map(([k, label]) => (
                  <SelectItem key={k} value={k}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {(status === "IN_STOCK" || status === "IN_REPAIR") && (
            <div className="space-y-1.5">
              <Label className="text-xs">Warehouse</Label>
              <Input value={warehouseLabel} onChange={(e) => setWarehouseLabel(e.target.value)} className="h-9 text-sm" />
            </div>
          )}

          {needsRep && (
            <div className="space-y-1.5">
              <Label className="text-xs">Rep holding this unit</Label>
              <Select value={repId} onValueChange={setRepId}>
                <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select rep…" /></SelectTrigger>
                <SelectContent>
                  {reps.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          {needsCustomer && (
            <div className="space-y-1.5 relative">
              <Label className="text-xs">Customer</Label>
              <Input value={customerName} onChange={(e) => searchCustomers(e.target.value)} placeholder="Search customer…" className="h-9 text-sm" />
              {custResults.length > 0 && !customerId && (
                <div className="absolute z-50 top-full left-0 mt-1 w-full rounded-md border border-border bg-background shadow-md max-h-40 overflow-y-auto text-sm">
                  {custResults.map((c) => (
                    <button key={c.id} type="button" className="w-full text-left px-3 py-2 hover:bg-accent"
                      onClick={() => { setCustomerId(c.id); setCustomerName(c.name); setCustResults([]); }}>
                      {c.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs">Notes</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" className="h-9 text-sm" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={saving}>{saving ? "Saving…" : "Register"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function HistorySheetContent({ unit }: { unit: AssetUnitListRow }) {
  const [history, setHistory] = useState<Awaited<ReturnType<typeof getAssetUnitHistory>> | null>(null);

  useEffect(() => {
    getAssetUnitHistory(unit.id).then(setHistory).catch(() => setHistory([]));
  }, [unit.id]);

  if (!history) return <p className="text-sm text-muted-foreground py-4">Loading…</p>;
  if (history.length === 0) return <p className="text-sm text-muted-foreground py-4">No movement history yet.</p>;

  return (
    <div className="space-y-2 py-2">
      {history.map((m) => (
        <div key={m.id} className="rounded-md border border-border px-3 py-2 text-sm flex items-center justify-between">
          <div>
            <p className="font-medium">{MOVEMENT_LABELS[m.movementType] ?? m.movementType}</p>
            <p className="text-xs text-muted-foreground">{m.referenceNo ?? m.notes ?? ""}</p>
          </div>
          <span className="text-xs text-muted-foreground">{new Date(m.createdAt).toLocaleDateString()}</span>
        </div>
      ))}
    </div>
  );
}

export function SerializedUnitsClient({ initialUnits }: { initialUnits: AssetUnitListRow[] }) {
  const [units, setUnits] = useState(initialUnits);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [registerOpen, setRegisterOpen] = useState(false);
  const [historyUnit, setHistoryUnit] = useState<AssetUnitListRow | null>(null);
  const [returning, setReturning] = useState<string | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback((s = search, st = statusFilter) => {
    listAssetUnits({ search: s || undefined, status: st === "all" ? undefined : st }).then(setUnits).catch(() => {});
  }, [search, statusFilter]);

  function handleSearch(val: string) {
    setSearch(val);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => refresh(val, statusFilter), 300);
  }

  function handleStatusFilter(val: string) {
    setStatusFilter(val);
    refresh(search, val);
  }

  async function handleMarkReturned(unitId: string) {
    setReturning(unitId);
    try {
      await markAssetUnitReturned(unitId);
      toast.success("Unit marked as returned");
      refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to mark as returned");
    } finally {
      setReturning(null);
    }
  }

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold">Serialized Units</h1>
          <p className="text-sm text-muted-foreground">Per-unit tracking for serial-tracked capital equipment.</p>
        </div>
        <Button size="sm" className="gap-1.5" onClick={() => setRegisterOpen(true)}>
          <PlusIcon className="w-4 h-4" /> Register existing unit
        </Button>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <Input value={search} onChange={(e) => handleSearch(e.target.value)} placeholder="Search serial no / product code…" className="h-9 text-sm max-w-xs" />
        <Select value={statusFilter} onValueChange={handleStatusFilter}>
          <SelectTrigger className="h-9 text-sm w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {Object.entries(ASSET_UNIT_STATUS_LABELS).map(([k, label]) => (
              <SelectItem key={k} value={k}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-lg border border-border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Product</TableHead>
              <TableHead>Serial No</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Location</TableHead>
              <TableHead>Last updated</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {units.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">No serialized units found.</TableCell></TableRow>
            ) : units.map((u) => (
              <TableRow key={u.id}>
                <TableCell>
                  <span className="font-mono text-xs font-medium">{u.productCode}</span>
                  {u.productDescription && <span className="text-xs text-muted-foreground ml-1.5">{u.productDescription}</span>}
                </TableCell>
                <TableCell className="font-mono text-xs">{u.serialNo}</TableCell>
                <TableCell>
                  <Badge variant="outline" className={cn("text-[11px]", STATUS_STYLE[u.status])}>
                    {ASSET_UNIT_STATUS_LABELS[u.status] ?? u.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm">{resolveLocation(u)}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{new Date(u.updatedAt).toLocaleDateString()}</TableCell>
                <TableCell className="text-right space-x-2 whitespace-nowrap">
                  <button className="text-xs text-primary hover:underline" onClick={() => setHistoryUnit(u)}>History</button>
                  {u.status === "ON_LOAN" && (
                    <button className="text-xs text-primary hover:underline disabled:opacity-50" disabled={returning === u.id}
                      onClick={() => handleMarkReturned(u.id)}>
                      {returning === u.id ? "Returning…" : "Mark returned"}
                    </button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <RegisterUnitDialog open={registerOpen} onOpenChange={setRegisterOpen} onRegistered={() => refresh()} />

      <Dialog open={!!historyUnit} onOpenChange={(v) => !v && setHistoryUnit(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{historyUnit?.productCode} · SN {historyUnit?.serialNo}</DialogTitle>
          </DialogHeader>
          {historyUnit && <HistorySheetContent unit={historyUnit} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
