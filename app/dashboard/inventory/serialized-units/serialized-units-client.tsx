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
import { HashIcon, MapPinIcon, PlusIcon, SearchIcon } from "lucide-react";
import { LotsTab } from "./lots-tab";
import { cn } from "@/lib/utils";
import {
  listAssetUnits, updateAssetUnitIntendedUse, markAssetUnitReturned, getAssetUnitHistory,
  getRegisterLocations, getHeldItemsAt, registerUnitsAt, fixUnitSerial, removeUnitSerial,
  type AssetUnitListRow, type HeldItem,
} from "@/server/asset-units";
import { ASSET_UNIT_STATUS_LABELS, INTENDED_USE_LABELS, isLendable } from "@/lib/inventory/constants";
import { MOVEMENT_LABELS } from "@/lib/inventory/constants";

const INTENDED_USE_STYLE: Record<string, string> = {
  SALE:   "text-blue-700 border-blue-300 bg-blue-50 dark:text-blue-400 dark:border-blue-700 dark:bg-blue-900/20",
  ASSET:  "text-amber-700 border-amber-300 bg-amber-50 dark:text-amber-400 dark:border-amber-700 dark:bg-amber-900/20",
};

const STATUS_STYLE: Record<string, string> = {
  IN_STOCK:  "text-teal-700 border-teal-300 bg-teal-50 dark:text-teal-400 dark:border-teal-700 dark:bg-teal-900/20",
  WITH_REP:  "text-blue-700 border-blue-300 bg-blue-50 dark:text-blue-400 dark:border-blue-700 dark:bg-blue-900/20",
  ON_LOAN:   "text-amber-700 border-amber-300 bg-amber-50 dark:text-amber-400 dark:border-amber-700 dark:bg-amber-900/20",
  SOLD:      "text-gray-700 border-gray-300 bg-gray-50 dark:text-gray-400 dark:border-gray-700 dark:bg-gray-900/20",
  IN_REPAIR: "text-purple-700 border-purple-300 bg-purple-50 dark:text-purple-400 dark:border-purple-700 dark:bg-purple-900/20",
  DISPOSED:  "text-red-700 border-red-300 bg-red-50 dark:text-red-400 dark:border-red-700 dark:bg-red-900/20",
};

function resolveLocation(u: AssetUnitListRow, names: Record<string, string> = {}): string {
  // Consigned units: where they are, by name (with the agent's specialist / at a hospital / with a dealer)
  if (u.currentWarehouseLabel?.startsWith("CS:")) {
    const where = names[u.currentWarehouseLabel] ?? "Consigned";
    return u.status === "ON_LOAN" && u.customerName ? `${where} · on loan to ${u.customerName}` : where;
  }
  if (u.status === "WITH_REP" || u.status === "ON_LOAN") {
    const base = u.holderName ? `With ${u.holderName}` : "With rep";
    return u.status === "ON_LOAN" && u.customerName ? `${base} · on loan to ${u.customerName}` : base;
  }
  if (u.status === "SOLD") return u.customerName ? `Sold to ${u.customerName}` : "Sold";
  return (u.currentWarehouseLabel && names[u.currentWarehouseLabel]) ?? u.currentWarehouseLabel ?? "Warehouse";
}

// Register serial numbers for machines already held somewhere: pick the
// location, then one of the items held there — only as many serial numbers as
// it still lacks. Stock quantities and Movement History don't change.
function RegisterUnitDialog({ open, onOpenChange, onRegistered, initial }: { open: boolean; onOpenChange: (v: boolean) => void; onRegistered: () => void; initial?: { location: string; productId: string } }) {
  const [locations, setLocations] = useState<{ label: string; name: string; field: boolean }[]>([]);
  const [label, setLabel] = useState("");
  const [items, setItems] = useState<HeldItem[] | null>(null);
  const [showOthers, setShowOthers] = useState(false);
  const [productId, setProductId] = useState("");
  const [rows, setRows] = useState<{ serialNo: string; intendedUse: string }[]>([{ serialNo: "", intendedUse: "SALE" }]);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    let off = false;
    getRegisterLocations().then(async (locs) => {
      if (off) return;
      setLocations(locs);
      // opened from a Stock Overview row: start on that location and item
      if (initial && locs.some((l) => l.label === initial.location)) {
        setLabel(initial.location);
        const held = await getHeldItemsAt(initial.location).catch(() => [] as HeldItem[]);
        if (off) return;
        setItems(held);
        if (held.some((h) => h.productId === initial.productId && h.missing > 0)) setProductId(initial.productId);
      }
    }).catch(() => setLocations([]));
    return () => { off = true; };
  }, [open, initial]);

  async function pickLocation(v: string) {
    setLabel(v); setProductId(""); setItems(null); setShowOthers(false);
    setRows([{ serialNo: "", intendedUse: "SALE" }]);
    try { setItems(await getHeldItemsAt(v)); } catch { setItems([]); }
  }
  const item = items?.find((i) => i.productId === productId);
  function reset() {
    setLabel(""); setItems(null); setProductId(""); setRows([{ serialNo: "", intendedUse: "SALE" }]); setNotes("");
  }

  async function handleSubmit() {
    if (!item) { toast.error("Choose the item"); return; }
    setSaving(true);
    const res = await registerUnitsAt({ label, productId, units: rows, notes });
    setSaving(false);
    if (!res.ok) { toast.error(res.title); return; }
    toast.success(`${res.count} serial number${res.count !== 1 ? "s" : ""} registered`);
    reset(); onOpenChange(false); onRegistered();
  }

  const stores = locations.filter((l) => !l.field), field = locations.filter((l) => l.field);
  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] grid-cols-1 overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Register serial numbers</DialogTitle>
        </DialogHeader>
        <p className="min-w-0 text-xs text-muted-foreground -mt-2">For machines already in stock that have no serial number on record. Quantities and Movement History don&apos;t change. To add new stock, use New Movement.</p>
        <div className="min-w-0 space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs">1. Where is it?</Label>
            <select value={label} onChange={(e) => pickLocation(e.target.value)} className="w-full h-9 rounded-md border border-input bg-background px-2.5 text-sm">
              <option value="">Choose a warehouse or specialist…</option>
              {stores.length > 0 && <optgroup label="Warehouses">{stores.map((l) => <option key={l.label} value={l.label}>{l.name}</option>)}</optgroup>}
              {field.length > 0 && <optgroup label="Field stock — specialists">{field.map((l) => <option key={l.label} value={l.label}>{l.name}</option>)}</optgroup>}
            </select>
          </div>

          {label && (
            <div className="space-y-1.5">
              <Label className="text-xs">2. Which item?</Label>
              {items === null ? <p className="text-xs text-muted-foreground">Loading…</p>
                : items.length === 0 ? <p className="text-xs text-muted-foreground">Nothing is held here.</p>
                : (() => {
                  const machines = items.filter((i) => i.machine), others = items.filter((i) => !i.machine);
                  const list = showOthers || !machines.length ? [...machines, ...others] : machines;
                  return (
                    <>
                      <div className="max-h-56 overflow-y-auto rounded-md border divide-y">
                        {list.map((i) => (
                          <button key={i.productId} type="button" disabled={i.missing === 0}
                            onClick={() => { setProductId(i.productId); setRows([{ serialNo: "", intendedUse: "SALE" }]); }}
                            className={cn("w-full min-w-0 flex items-center gap-2 px-3 py-2 text-left text-xs", productId === i.productId ? "bg-primary/10" : "hover:bg-muted/40", i.missing === 0 && "opacity-50 cursor-not-allowed")}>
                            <span className="font-mono font-medium shrink-0">{i.productCode}</span>
                            <span className="flex-1 min-w-0 truncate text-muted-foreground" title={i.description ?? undefined}>{i.description}</span>
                            <span className="tabular-nums shrink-0 whitespace-nowrap">{i.qty} held</span>
                            <span className={cn("tabular-nums shrink-0 whitespace-nowrap rounded px-1.5", i.missing ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300" : "text-muted-foreground")}>
                              {i.missing ? `${i.missing} without serial` : "all have serials"}
                            </span>
                          </button>
                        ))}
                      </div>
                      {machines.length > 0 && others.length > 0 && (
                        <button type="button" className="text-xs text-primary hover:underline" onClick={() => setShowOthers((v) => !v)}>
                          {showOthers ? "Show machines only" : `Show other items held here (${others.length})`}
                        </button>
                      )}
                      {!machines.length && <p className="text-[11px] text-muted-foreground">None of these is set up as a serial-tracked machine — pick the item if it should have a serial number.</p>}
                    </>
                  );
                })()}
            </div>
          )}

          {item && (
            <div className="space-y-1.5">
              <Label className="text-xs">3. Serial number and use — {item.missing} still need one</Label>
              {rows.map((r, i) => (
                <div key={i} className="flex gap-2">
                  <Input value={r.serialNo} placeholder={`Serial number ${i + 1}`} className="h-8 min-w-0 flex-1 text-sm font-mono"
                    onChange={(e) => setRows((x) => x.map((y, j) => (j === i ? { ...y, serialNo: e.target.value } : y)))} />
                  <select value={r.intendedUse} onChange={(e) => setRows((x) => x.map((y, j) => (j === i ? { ...y, intendedUse: e.target.value } : y)))}
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs">
                    {Object.entries(INTENDED_USE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                  {rows.length > 1 && <button type="button" className="text-xs text-muted-foreground hover:text-destructive" onClick={() => setRows((x) => x.filter((_, j) => j !== i))}>✕</button>}
                </div>
              ))}
              {rows.length < item.missing && (
                <button type="button" className="text-xs text-primary hover:underline" onClick={() => setRows((x) => [...x, { serialNo: "", intendedUse: x.at(-1)?.intendedUse ?? "SALE" }])}>+ another machine</button>
              )}
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (optional)" className="h-8 text-sm mt-2" />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={saving || !item || rows.some((r) => !r.serialNo.trim())}>{saving ? "Saving…" : "Register"}</Button>
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
          <span className="text-xs text-muted-foreground">{new Date(m.createdAt).toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" })}</span>
        </div>
      ))}
    </div>
  );
}

export function SerializedUnitsClient({ initialUnits, locationNames = {}, focus: focusIn, canManage = false, initialTab = "serials" }: {
  initialUnits: AssetUnitListRow[]; locationNames?: Record<string, string>;
  focus?: { location: string; productId: string }; canManage?: boolean; initialTab?: "lots" | "serials";
}) {
  const [tab, setTab] = useState<"lots" | "serials">(initialTab);
  const [units, setUnits] = useState(initialUnits);
  const [focus, setFocus] = useState(initialTab === "serials" ? focusIn : undefined);
  // Fix a mistyped serial number, or remove one entered by mistake — with a reason
  const [correct, setCorrect] = useState<null | { unit: AssetUnitListRow; mode: "fix" | "remove"; serialNo: string; reason: string }>(null);
  const [correcting, setCorrecting] = useState(false);
  // Server data re-sent (live refresh / router.refresh): show it
  const [seenInitialUnits, setSeenInitialUnits] = useState(initialUnits);
  if (initialUnits !== seenInitialUnits) { setSeenInitialUnits(initialUnits); setUnits(initialUnits); }
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [registerOpen, setRegisterOpen] = useState(false);
  const [historyUnit, setHistoryUnit] = useState<AssetUnitListRow | null>(null);
  const [returning, setReturning] = useState<string | null>(null);
  const [changingUseId, setChangingUseId] = useState<string | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const shown = focus ? units.filter((u) => u.productId === focus.productId && u.currentWarehouseLabel === focus.location) : units;

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

  async function saveCorrection() {
    if (!correct) return;
    setCorrecting(true);
    const res = correct.mode === "fix"
      ? await fixUnitSerial(correct.unit.id, correct.serialNo, correct.reason)
      : await removeUnitSerial(correct.unit.id, correct.reason);
    setCorrecting(false);
    if (!res.ok) { toast.error(res.title); return; }
    toast.success(correct.mode === "fix" ? "Serial number corrected" : "Serial number removed — the quantity in stock is unchanged");
    setCorrect(null);
    refresh();
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

  async function handleChangeIntendedUse(unit: AssetUnitListRow, next: string) {
    if (next === unit.intendedUse) return;
    setChangingUseId(unit.id);
    try {
      await updateAssetUnitIntendedUse(unit.id, next);
      setUnits((prev) => prev.map((u) => (u.id === unit.id ? { ...u, intendedUse: next } : u)));
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to update designation");
    } finally {
      setChangingUseId(null);
    }
  }

  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-6xl">
      <div>
        <h1 className="text-lg sm:text-xl font-semibold">Lots &amp; Serial Numbers</h1>
        <p className="text-sm text-muted-foreground">Lot numbers, expiry dates and machines&apos; serial numbers of the stock you hold. Quantities never change here.</p>
      </div>

      {/* tabs */}
      <div className="inline-flex w-full sm:w-auto rounded-lg bg-muted p-1">
        {([["lots", "Lots & expiry", null], ["serials", "Serial numbers", units.length]] as const).map(([k, l, c]) => (
          <button key={k} type="button" onClick={() => setTab(k)}
            className={cn("flex-1 sm:flex-none px-4 h-8 rounded-md text-sm transition-colors whitespace-nowrap",
              tab === k ? "bg-background shadow-sm font-medium" : "text-muted-foreground hover:text-foreground")}>
            {l}{c !== null && <span className="ml-1.5 text-xs text-muted-foreground tabular-nums">{c}</span>}
          </button>
        ))}
      </div>

      {tab === "lots" ? <LotsTab canManage={canManage} focus={initialTab === "lots" ? focusIn : undefined} /> : <>
      {focus && (
        <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-xs">
          <span className="min-w-0">Showing <b>{units.find((u) => u.productId === focus.productId)?.productCode ?? "this item"}</b> at <b>{locationNames[focus.location] ?? (focus.location.startsWith("Field:") ? "the specialist's field stock" : focus.location)}</b>.</span>
          <button type="button" className="ml-auto shrink-0 text-primary hover:underline" onClick={() => setFocus(undefined)}>Show all</button>
        </div>
      )}

      {/* toolbar */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1 sm:max-w-xs">
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input value={search} onChange={(e) => handleSearch(e.target.value)} placeholder="Serial no. or product code…" className="h-10 pl-9 rounded-lg" />
        </div>
        <Select value={statusFilter} onValueChange={handleStatusFilter}>
          <SelectTrigger className="h-10 w-full sm:w-44 rounded-lg"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {Object.entries(ASSET_UNIT_STATUS_LABELS).map(([k, label]) => (
              <SelectItem key={k} value={k}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {canManage && (
          <Button className="h-10 gap-1.5 sm:ml-auto rounded-lg" onClick={() => setRegisterOpen(true)}>
            <PlusIcon className="w-4 h-4" /> Register serial numbers
          </Button>
        )}
      </div>

      {(() => {
        const purposeSelect = (u: AssetUnitListRow, terminal: boolean) => (
          <select
            value={isLendable(u.intendedUse) ? "ASSET" : "SALE"}
            disabled={terminal || changingUseId === u.id}
            onChange={(e) => handleChangeIntendedUse(u, e.target.value)}
            title={terminal ? "Locked — unit already sold/disposed" : "For sale, or a company asset (lent out for cases — rental / loan / demo chosen each time)"}
            className={cn("px-1.5 py-0.5 rounded-md text-[11px] font-semibold border transition-colors",
              INTENDED_USE_STYLE[isLendable(u.intendedUse) ? "ASSET" : "SALE"], terminal ? "opacity-60 cursor-not-allowed" : "cursor-pointer")}
          >
            {Object.entries(INTENDED_USE_LABELS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
        );
        const actions = (u: AssetUnitListRow, held: boolean) => (
          <>
            <button className="text-xs text-primary hover:underline" onClick={() => setHistoryUnit(u)}>History</button>
            {canManage && held && (
              <>
                <button className="text-xs text-primary hover:underline" onClick={() => setCorrect({ unit: u, mode: "fix", serialNo: u.serialNo, reason: "" })}>Fix serial no.</button>
                <button className="text-xs text-muted-foreground hover:text-destructive hover:underline" onClick={() => setCorrect({ unit: u, mode: "remove", serialNo: u.serialNo, reason: "" })}>Remove</button>
              </>
            )}
            {u.status === "ON_LOAN" && (
              <button className="text-xs text-primary hover:underline disabled:opacity-50" disabled={returning === u.id} onClick={() => handleMarkReturned(u.id)}>
                {returning === u.id ? "Returning…" : "Mark returned"}
              </button>
            )}
          </>
        );
        const updated = (u: AssetUnitListRow) => new Date(u.updatedAt).toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" });

        if (shown.length === 0) {
          return (
            <div className="rounded-xl border border-dashed p-8 text-center">
              <HashIcon className="mx-auto h-6 w-6 text-muted-foreground" />
              <p className="mt-2 text-sm font-medium">No serial numbers found</p>
              <p className="mt-1 text-xs text-muted-foreground">{canManage ? "Machines already in stock get theirs with Register serial numbers." : "Nothing matches the search or status."}</p>
            </div>
          );
        }
        return (
          <>
            {/* phones: one card per machine */}
            <div className="space-y-2.5 md:hidden">
              {shown.map((u) => {
                const terminal = u.status === "SOLD" || u.status === "DISPOSED";
                const held = u.status === "IN_STOCK" || u.status === "WITH_REP";
                return (
                  <div key={u.id} className="rounded-xl border bg-card p-3 space-y-2">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="font-mono text-base font-semibold break-all">{u.serialNo}</div>
                        <div className="text-xs text-muted-foreground"><span className="font-mono">{u.productCode}</span>{u.productDescription ? ` · ${u.productDescription}` : ""}</div>
                      </div>
                      <Badge variant="outline" className={cn("shrink-0 text-[11px]", STATUS_STYLE[u.status])}>{ASSET_UNIT_STATUS_LABELS[u.status] ?? u.status}</Badge>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <MapPinIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">{resolveLocation(u, locationNames)}</span>
                      {purposeSelect(u, terminal)}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t pt-2">
                      {actions(u, held)}
                      <span className="ml-auto text-[11px] text-muted-foreground">{updated(u)}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* larger screens: table */}
            <div className="hidden md:block rounded-xl border border-border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead>Serial no.</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead>Use</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Updated</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shown.map((u) => {
                    const terminal = u.status === "SOLD" || u.status === "DISPOSED";
                    const held = u.status === "IN_STOCK" || u.status === "WITH_REP";
                    return (
                      <TableRow key={u.id}>
                        <TableCell className="font-mono text-sm font-medium">{u.serialNo}</TableCell>
                        <TableCell className="max-w-72">
                          <div className="font-mono text-xs font-medium">{u.productCode}</div>
                          {u.productDescription && <div className="text-xs text-muted-foreground truncate" title={u.productDescription}>{u.productDescription}</div>}
                        </TableCell>
                        <TableCell>{purposeSelect(u, terminal)}</TableCell>
                        <TableCell><Badge variant="outline" className={cn("text-[11px]", STATUS_STYLE[u.status])}>{ASSET_UNIT_STATUS_LABELS[u.status] ?? u.status}</Badge></TableCell>
                        <TableCell className="text-sm">{resolveLocation(u, locationNames)}</TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{updated(u)}</TableCell>
                        <TableCell className="text-right space-x-3 whitespace-nowrap">{actions(u, held)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </>
        );
      })()}

      </>}

      <RegisterUnitDialog open={registerOpen} onOpenChange={setRegisterOpen} onRegistered={() => refresh()} initial={focus} />

      <Dialog open={!!correct} onOpenChange={(v) => { if (!v && !correcting) setCorrect(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{correct?.mode === "fix" ? "Fix serial number" : "Remove serial number"}</DialogTitle>
          </DialogHeader>
          {correct && (
            <div className="space-y-3 text-sm">
              <p className="text-xs text-muted-foreground">
                <span className="font-mono">{correct.unit.productCode}</span> · SN <span className="font-mono">{correct.unit.serialNo}</span> · {resolveLocation(correct.unit, locationNames)}
              </p>
              <p className="text-xs text-muted-foreground">
                {correct.mode === "fix"
                  ? "For a mistyped serial number. Its history keeps pointing at this machine, with the corrected number."
                  : "For a serial number entered for a machine that was never here. The quantity in stock stays the same — only the serial record is taken off. Not possible once it has been on a Case DO or consignment (fix it instead)."}
              </p>
              {correct.mode === "fix" && (
                <div className="space-y-1.5">
                  <Label className="text-xs">Correct serial number</Label>
                  <Input value={correct.serialNo} onChange={(e) => setCorrect({ ...correct, serialNo: e.target.value })} className="h-9 font-mono" autoFocus />
                </div>
              )}
              <div className="space-y-1.5">
                <Label className="text-xs">Reason *</Label>
                <Input value={correct.reason} onChange={(e) => setCorrect({ ...correct, reason: e.target.value })} placeholder={correct.mode === "fix" ? "e.g. typo — label on the machine reads LD15421JW" : "e.g. entered twice by mistake"} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCorrect(null)} disabled={correcting}>Cancel</Button>
            <Button variant={correct?.mode === "remove" ? "destructive" : "default"} onClick={saveCorrection} disabled={correcting || !correct || correct.reason.trim().length < 3 || (correct.mode === "fix" && !correct.serialNo.trim())}>
              {correcting ? "Saving…" : correct?.mode === "fix" ? "Save" : "Remove"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
