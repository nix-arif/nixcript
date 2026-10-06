"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CalendarClockIcon, MapPinIcon, PackageIcon, PencilIcon, PlusIcon, SearchIcon, TagIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { assignLotToStock, editStockLot, getLotItemsAt, type LotItem } from "@/server/inventory";
import { getRegisterLocations } from "@/server/asset-units";

const n = (v: number) => (v % 1 === 0 ? String(v) : String(+v.toFixed(4)));
const ymd = (d: Date | string | null) => (d ? new Date(d).toISOString().slice(0, 10) : "");
const dShort = (d: Date | string) => new Date(d).toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" });

type Expiry = { tone: "ok" | "soon" | "expired" | "none"; text: string };
function expiryOf(d: Date | string | null, today: number): Expiry {
  if (!d) return { tone: "none", text: "No expiry" };
  const days = Math.ceil((new Date(d).getTime() - today) / 86_400_000);
  if (days < 0) return { tone: "expired", text: `Expired ${-days}d ago` };
  if (days <= 90) return { tone: "soon", text: `${days}d left` };
  return { tone: "ok", text: "OK" };
}
const TONE: Record<Expiry["tone"], string> = {
  ok: "bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400",
  soon: "bg-orange-50 text-orange-700 dark:bg-orange-900/20 dark:text-orange-400",
  expired: "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400",
  none: "bg-muted text-muted-foreground",
};

type Filter = "all" | "missing" | "expiring";

// Lot numbers and expiry dates of stock already held — give stock without a
// lot one, or correct a lot. Quantities and Movement History don't change.
export function LotsTab({ canManage, focus }: { canManage: boolean; focus?: { location: string; productId: string } }) {
  const [locations, setLocations] = useState<{ label: string; name: string; field: boolean }[]>([]);
  const [label, setLabel] = useState(focus?.location ?? "");
  const [items, setItems] = useState<LotItem[] | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [only, setOnly] = useState(focus?.productId ?? "");
  const [reload, setReload] = useState(0);
  const [today, setToday] = useState(0);

  useEffect(() => {
    let off = false;
    getRegisterLocations().then((l) => { if (!off) setLocations(l); }).catch(() => {});
    return () => { off = true; };
  }, []);
  useEffect(() => {
    if (!label) return;
    let off = false;
    getLotItemsAt(label).then((r) => { if (!off) { setItems(r); setToday(Date.now()); } }).catch(() => { if (!off) setItems([]); });
    return () => { off = true; };
  }, [label, reload]);

  const all = items ?? [];
  const isExpiring = (i: LotItem) => i.lots.some((l) => ["soon", "expired"].includes(expiryOf(l.expiryDate, today).tone));
  const counts = { all: all.length, missing: all.filter((i) => i.withoutLot > 0).length, expiring: all.filter(isExpiring).length };
  const term = q.trim().toLowerCase();
  const shown = all.filter((i) =>
    (!only || i.productId === only) &&
    (filter === "all" || (filter === "missing" ? i.withoutLot > 0 : isExpiring(i))) &&
    (!term || i.productCode.toLowerCase().includes(term) || (i.description ?? "").toLowerCase().includes(term)));
  const stores = locations.filter((l) => !l.field), field = locations.filter((l) => l.field);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative sm:w-80">
          <MapPinIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <select value={label} onChange={(e) => { setLabel(e.target.value); setItems(null); setOnly(""); setFilter("all"); }}
            className="w-full h-10 rounded-lg border border-input bg-background pl-9 pr-3 text-sm appearance-none">
            <option value="">Choose a warehouse or specialist…</option>
            {stores.length > 0 && <optgroup label="Warehouses">{stores.map((l) => <option key={l.label} value={l.label}>{l.name}</option>)}</optgroup>}
            {field.length > 0 && <optgroup label="Field stock — specialists">{field.map((l) => <option key={l.label} value={l.label}>{l.name}</option>)}</optgroup>}
          </select>
        </div>
        {label && items && items.length > 0 && !only && (
          <div className="relative flex-1 sm:max-w-xs">
            <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find an item…" className="h-10 pl-9 rounded-lg" />
          </div>
        )}
      </div>

      {!label ? (
        <EmptyHint icon={MapPinIcon} title="Choose where the stock is" text="Pick a warehouse or a specialist to see the lot numbers and expiry dates of what's held there." />
      ) : items === null ? (
        <div className="space-y-2">{[0, 1, 2].map((k) => <div key={k} className="h-20 rounded-xl bg-muted/50 animate-pulse" />)}</div>
      ) : all.length === 0 ? (
        <EmptyHint icon={PackageIcon} title="Nothing held here" text="This location has no stock right now." />
      ) : (
        <>
          {!only && (
            <div className="grid grid-cols-3 gap-2">
              {([["all", "Items", counts.all, ""], ["missing", "Without a lot", counts.missing, "text-amber-700 dark:text-amber-400"], ["expiring", "Expiring / expired", counts.expiring, "text-orange-700 dark:text-orange-400"]] as const).map(([k, l, v, tone]) => (
                <button key={k} type="button" onClick={() => setFilter(k)}
                  className={cn("rounded-xl border p-2.5 sm:p-3 text-left transition-colors", filter === k ? "border-foreground bg-muted/40" : "hover:bg-muted/30")}>
                  <div className={cn("text-lg sm:text-xl font-semibold tabular-nums", v ? tone : "")}>{v}</div>
                  <div className="text-[11px] sm:text-xs text-muted-foreground leading-tight">{l}</div>
                </button>
              ))}
            </div>
          )}
          {only && (
            <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-xs">
              <span className="min-w-0 truncate">Showing one item from Stock Overview</span>
              <button type="button" className="ml-auto shrink-0 text-primary hover:underline" onClick={() => setOnly("")}>Show all items here</button>
            </div>
          )}
          {shown.length === 0 ? (
            <EmptyHint icon={TagIcon} title={filter === "missing" ? "Every item here has its lot numbers" : filter === "expiring" ? "Nothing here is expiring" : "No item matches"} text="" />
          ) : (
            <div className="grid gap-2.5 xl:grid-cols-2 items-start">
              {shown.map((it) => <LotItemCard key={it.productId} it={it} label={label} canManage={canManage} today={today} onChanged={() => setReload((r) => r + 1)} />)}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function EmptyHint({ icon: Icon, title, text }: { icon: React.ElementType; title: string; text: string }) {
  return (
    <div className="rounded-xl border border-dashed p-8 text-center">
      <Icon className="mx-auto h-6 w-6 text-muted-foreground" />
      <p className="mt-2 text-sm font-medium">{title}</p>
      {text && <p className="mt-1 text-xs text-muted-foreground max-w-sm mx-auto">{text}</p>}
    </div>
  );
}

function LotItemCard({ it, label, canManage, today, onChanged }: { it: LotItem; label: string; canManage: boolean; today: number; onChanged: () => void }) {
  const [adding, setAdding] = useState(false);
  const [lotNo, setLotNo] = useState("");
  const [qty, setQty] = useState("");
  const [expiry, setExpiry] = useState("");
  const [saving, setSaving] = useState(false);
  const lotted = it.qty - it.withoutLot;
  const pct = it.qty > 0 ? Math.min(100, (lotted / it.qty) * 100) : 0;

  async function assign() {
    const qn = parseFloat(qty);
    if (!lotNo.trim()) { toast.error("Enter the lot number"); return; }
    if (!(qn > 0)) { toast.error("Enter the quantity"); return; }
    setSaving(true);
    try {
      await assignLotToStock({ productId: it.productId, warehouseLabel: label, lotNo: lotNo.trim(), expiryDate: expiry ? new Date(expiry) : null, quantity: qn });
      toast.success(`Lot ${lotNo.trim()} assigned to ${n(qn)} ${it.uom ?? ""}`.trim());
      setAdding(false); setLotNo(""); setExpiry("");
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't assign the lot");
    } finally { setSaving(false); }
  }

  return (
    <div className="rounded-xl border bg-card p-3 sm:p-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-mono text-sm font-semibold">{it.productCode}</div>
          <div className="text-xs text-muted-foreground line-clamp-2" title={it.description ?? undefined}>{it.description}</div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-sm font-semibold tabular-nums">{n(it.qty)} <span className="text-xs font-normal text-muted-foreground">{it.uom}</span></div>
          <div className="text-[11px] text-muted-foreground">held</div>
        </div>
      </div>

      {/* how much of it is under a lot */}
      <div className="mt-2.5 flex items-center gap-2">
        <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
          <div className={cn("h-full rounded-full", it.withoutLot > 0 ? "bg-amber-400" : "bg-green-500")} style={{ width: `${pct}%` }} />
        </div>
        <span className={cn("text-[11px] whitespace-nowrap", it.withoutLot > 0 ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>
          {it.withoutLot > 0 ? `${n(it.withoutLot)} without a lot` : "all lotted"}
        </span>
      </div>

      {it.lots.length > 0 && (
        <ul className="mt-3 divide-y rounded-lg border">
          {it.lots.map((l) => <LotLine key={l.id} lot={l} uom={it.uom} canManage={canManage} today={today} onChanged={onChanged} />)}
        </ul>
      )}

      {canManage && it.withoutLot > 0 && (adding ? (
        <div className="mt-3 rounded-lg border border-dashed bg-muted/30 p-3 space-y-2.5">
          <div className="grid grid-cols-2 sm:grid-cols-[1fr_7rem_10rem] gap-2">
            <label className="col-span-2 sm:col-span-1 space-y-1">
              <span className="text-[11px] font-medium text-muted-foreground">Lot number</span>
              <Input value={lotNo} onChange={(e) => setLotNo(e.target.value)} placeholder="e.g. 20250315" className="h-9 font-mono" autoFocus />
            </label>
            <label className="space-y-1">
              <span className="text-[11px] font-medium text-muted-foreground">Quantity (max {n(it.withoutLot)})</span>
              <Input type="number" inputMode="decimal" min="0.0001" step="0.0001" value={qty} onChange={(e) => setQty(e.target.value)} className="h-9 text-right" />
            </label>
            <label className="space-y-1">
              <span className="text-[11px] font-medium text-muted-foreground">Expiry date</span>
              <Input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} className="h-9" />
            </label>
          </div>
          <div className="flex flex-col-reverse sm:flex-row sm:items-center gap-2">
            <span className="text-[11px] text-muted-foreground sm:mr-auto">More than one lot? Save one, then assign the rest.</span>
            <Button size="sm" variant="outline" onClick={() => setAdding(false)} disabled={saving}>Cancel</Button>
            <Button size="sm" onClick={assign} disabled={saving}>{saving ? "Saving…" : "Save lot"}</Button>
          </div>
        </div>
      ) : (
        <Button size="sm" variant="outline" className="mt-3 w-full sm:w-auto gap-1.5" onClick={() => { setQty(String(it.withoutLot)); setAdding(true); }}>
          <PlusIcon className="h-3.5 w-3.5" /> Assign lot no. &amp; expiry
        </Button>
      ))}
    </div>
  );
}

function LotLine({ lot, uom, canManage, today, onChanged }: { lot: LotItem["lots"][number]; uom: string | null; canManage: boolean; today: number; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [lotNo, setLotNo] = useState(lot.lotNo);
  const [expiry, setExpiry] = useState(ymd(lot.expiryDate));
  const [saving, setSaving] = useState(false);
  const ex = expiryOf(lot.expiryDate, today);
  async function save() {
    if (!lotNo.trim()) { toast.error("Enter the lot number"); return; }
    setSaving(true);
    try {
      await editStockLot(lot.id, { lotNo: lotNo.trim(), expiryDate: expiry ? new Date(expiry) : null });
      toast.success("Lot updated");
      setEditing(false);
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't update the lot");
    } finally { setSaving(false); }
  }
  if (editing) {
    return (
      <li className="p-2.5 space-y-2 bg-muted/20">
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_10rem] gap-2">
          <Input value={lotNo} onChange={(e) => setLotNo(e.target.value)} className="h-9 font-mono" aria-label="Lot number" />
          <Input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} className="h-9" aria-label="Expiry date" />
        </div>
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => { setEditing(false); setLotNo(lot.lotNo); setExpiry(ymd(lot.expiryDate)); }} disabled={saving}>Cancel</Button>
          <Button size="sm" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        </div>
      </li>
    );
  }
  return (
    <li className="flex items-center gap-3 px-2.5 py-2">
      <TagIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="font-mono text-sm truncate">{lot.lotNo}</div>
        <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <CalendarClockIcon className="h-3 w-3" />{lot.expiryDate ? dShort(lot.expiryDate) : "no expiry date"}
        </div>
      </div>
      <div className="text-right shrink-0">
        <div className="text-sm font-medium tabular-nums">{n(lot.quantity)} <span className="text-[11px] font-normal text-muted-foreground">{uom}</span></div>
        <span className={cn("inline-block rounded-full px-1.5 text-[10px] font-medium", TONE[ex.tone])}>{ex.text}</span>
      </div>
      {canManage && (
        <button type="button" onClick={() => setEditing(true)} className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" title="Edit lot no. / expiry" aria-label="Edit lot">
          <PencilIcon className="h-3.5 w-3.5" />
        </button>
      )}
    </li>
  );
}
