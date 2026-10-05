"use client";

import Link from "next/link";
import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { OrgMember } from "@/server/field-stock";
import { transferToRep, returnFromRep, getRepFieldStock } from "@/server/field-stock";
import { searchProducts, getTransferStockInfo, getConsignedStockBuckets } from "@/server/inventory";
import { createConsignment } from "@/server/consign";
import { fieldWarehouseLabel, consignedWarehouseLabel, INTENDED_USE_LABELS, isLendable, unitUseLabel } from "@/lib/inventory/constants";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/page-header";
import { ArrowLeftIcon, PlusIcon, TrashIcon, ArrowRightIcon, HandshakeIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { uid } from "@/lib/uid";

type Direction = "to_rep" | "from_rep" | "to_partner";
type Unit = { id: string; serialNo: string; intendedUse: string };

interface LineItem {
  _key: string;
  productId: string;
  productCode: string;
  description: string;
  uom: string;
  qty: string;
  maxQty?: number;     // for from_rep: rep's holding
  availableQty?: number; // for to_rep: main warehouse stock
  lots: { id: string; lotNo: string; expiryDate: Date | null; quantity: string }[];
  selectedLotId: string | null;
  serialNos: string[];
  // Serialized units (machines) at the source — picked one by one, qty follows
  units: Unit[];
  selectedUnitIds: string[];
  loadingInfo: boolean;
  // Owned stock vs. stock consigned in from a sibling org (still owned by
  // them) — only populated for the "to_rep" direction, since that's the only
  // side where the org's own warehouse can hold a mix of both.
  consignedBuckets?: { sourceOrgId: string; sourceOrgName: string; qty: number }[];
  selectedConsignedFromOrgId?: string | null; // null/undefined = owned bucket
}

const newLine = (): LineItem => ({
  _key: uid(),
  productId: "", productCode: "", description: "", uom: "", qty: "1",
  lots: [], selectedLotId: null, serialNos: [], units: [], selectedUnitIds: [], loadingInfo: false,
});

// ── Defined at module level to prevent remount on parent re-render ──────────

interface ProductCellProps {
  item: LineItem;
  onUpdate: (key: string, patch: Partial<LineItem>) => void;
  warehouseLabel: string;
}

function ProductCell({ item, onUpdate, warehouseLabel }: ProductCellProps) {
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
      if (exact) await pick(exact);
    }, 300);
  }

  async function pick(p: typeof results[0]) {
    onUpdate(item._key, {
      productId: p.id, productCode: p.productCode, description: p.description ?? "", uom: p.uom ?? "",
      availableQty: undefined, lots: [], selectedLotId: null, serialNos: [], units: [], selectedUnitIds: [], loadingInfo: true,
      consignedBuckets: [], selectedConsignedFromOrgId: null,
    });
    setQ(p.productCode);
    setResults([]);
    try {
      const [info, consignedBuckets] = await Promise.all([
        getTransferStockInfo(p.id, warehouseLabel),
        getConsignedStockBuckets(p.id).catch(() => []),
      ]);
      onUpdate(item._key, {
        availableQty: info.onHand, lots: info.lots, serialNos: info.serialNos, units: info.units, selectedUnitIds: [],
        ...(info.units.length ? { qty: "0" } : {}),
        selectedLotId: info.lots.length === 1 ? info.lots[0].id : null, loadingInfo: false,
        consignedBuckets,
      });
    } catch {
      onUpdate(item._key, { loadingInfo: false });
    }
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

interface LotPickerProps {
  item: LineItem;
  onSelect: (lotId: string) => void;
  onToggleUnit: (unitId: string) => void;
}

function LotPicker({ item, onSelect, onToggleUnit }: LotPickerProps) {
  if (item.loadingInfo) return <p className="text-[11px] text-muted-foreground">Loading lot info…</p>;
  if (item.units.length > 0) {
    return (
      <div className="flex flex-col gap-1.5 pt-1 border-t border-border/60">
        <p className={cn("text-[10px] font-medium uppercase tracking-wide", item.selectedUnitIds.length ? "text-muted-foreground" : "text-destructive")}>
          Serial No.{!item.selectedUnitIds.length && " — pick the unit(s) to move"}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {item.units.map((u) => {
            const on = item.selectedUnitIds.includes(u.id);
            return (
              <button key={u.id} type="button" onClick={() => onToggleUnit(u.id)}
                className={cn("text-[11px] font-mono px-2 py-0.5 rounded-full border transition-colors",
                  on ? "bg-teal-600 text-white border-teal-600" : "border-border bg-background hover:bg-muted")}>
                {on ? "✓ " : ""}{u.serialNo}
                <span className={cn("ml-1.5 font-sans", on ? "opacity-80" : isLendable(u.intendedUse) ? "text-amber-700 dark:text-amber-400" : "opacity-60")}>{unitUseLabel(u.intendedUse).toLowerCase()}</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }
  if (item.lots.length === 0 && item.serialNos.length === 0) return null;
  return (
    <div className="flex flex-col gap-2 pt-1 border-t border-border/60">
      {item.lots.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className={cn(
            "text-[10px] font-medium uppercase tracking-wide",
            item.selectedLotId ? "text-muted-foreground" : "text-destructive",
          )}>
            Lot{!item.selectedLotId && " — required, pick one"}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {item.lots.map((lot) => (
              <button key={lot.id} type="button"
                onClick={() => onSelect(lot.id)}
                className={cn(
                  "text-[11px] px-2 py-0.5 rounded-full border transition-colors",
                  item.selectedLotId === lot.id
                    ? "bg-teal-600 text-white border-teal-600"
                    : "border-border bg-background hover:bg-muted",
                )}
              >
                <span className="font-mono">{lot.lotNo}</span>
                {lot.expiryDate && <span className="ml-1.5 opacity-70">exp {new Date(lot.expiryDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</span>}
                <span className="ml-1.5 opacity-60">({lot.quantity})</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {item.serialNos.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Serial No.</p>
          <div className="flex flex-wrap gap-1">
            {item.serialNos.map((sn) => (
              <span key={sn} className="text-[11px] font-mono px-1.5 py-0.5 rounded border border-border bg-background">{sn}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

interface Props {
  reps: OrgMember[];
  mainWarehouseLabel: string;
  partners: { id: string; name: string; model: "dealer" | "sales_agent" }[];
}

export function TransferClient({ reps, mainWarehouseLabel, partners }: Props) {
  const router = useRouter();
  const [direction, setDirection] = useState<Direction>("to_rep");
  // Transfers go to this company's own specialists only; a sister company's
  // specialist can still return field stock they hold from this company
  const ownReps = reps.filter((r) => !r.otherOrgName);
  const [repId, setRepId] = useState(ownReps[0]?.id ?? "");
  const [partnerId, setPartnerId] = useState(partners[0]?.id ?? "");
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
      if (stock.length === 0) { setItems([newLine()]); return; }
      const fieldLabel = fieldWarehouseLabel(id);
      const loaded = stock.map((s) => ({
        _key: uid(),
        productId: s.productId,
        productCode: s.productCode,
        description: s.description,
        uom: s.uom ?? "",
        qty: "0",
        maxQty: s.qty,
        lots: [] as LineItem["lots"],
        selectedLotId: null as string | null,
        serialNos: [] as string[],
        units: [] as Unit[],
        selectedUnitIds: [] as string[],
        loadingInfo: true,
      }));
      setItems(loaded);
      const infos = await Promise.all(loaded.map((s) =>
        getTransferStockInfo(s.productId, fieldLabel).catch(() => ({ onHand: 0, lots: [], serialNos: [], units: [] as Unit[] }))
      ));
      setItems((prev) => prev.map((item, idx) => {
        const info = infos[idx];
        if (!info) return item;
        return { ...item, lots: info.lots, serialNos: info.serialNos, units: info.units, selectedUnitIds: [], selectedLotId: info.lots.length === 1 ? info.lots[0].id : null, loadingInfo: false };
      }));
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
      // transferring: only this company's specialists
      if (d === "to_rep" && repId && !ownReps.some((r) => r.id === repId)) setRepId(ownReps[0]?.id ?? "");
      setItems([newLine()]);
    }
  }

  function updateItem(key: string, patch: Partial<LineItem>) {
    setItems((prev) => prev.map((i) => i._key === key ? { ...i, ...patch } : i));
  }

  function removeItem(key: string) {
    setItems((prev) => prev.filter((i) => i._key !== key));
  }

  // Picking machines by serial number: qty is the number picked
  function toggleUnit(key: string, unitId: string) {
    setItems((prev) => prev.map((i) => {
      if (i._key !== key) return i;
      const sel = i.selectedUnitIds.includes(unitId) ? i.selectedUnitIds.filter((x) => x !== unitId) : [...i.selectedUnitIds, unitId];
      return { ...i, selectedUnitIds: sel, qty: String(sel.length) };
    }));
  }

  function handleLotSelect(key: string, lotId: string) {
    setItems((prev) => prev.map((i) =>
      i._key === key ? { ...i, selectedLotId: i.selectedLotId === lotId ? null : lotId } : i
    ));
  }

  // Switches which bucket (owned main warehouse, or consigned from a
  // sibling org) this line pulls from — re-fetches lot/onHand info for
  // whichever warehouse label that bucket actually lives under.
  async function handleBucketSelect(key: string, sourceOrgId: string | null) {
    updateItem(key, { selectedConsignedFromOrgId: sourceOrgId, loadingInfo: true, lots: [], selectedLotId: null });
    const item = items.find((i) => i._key === key);
    if (!item) return;
    const label = sourceOrgId ? consignedWarehouseLabel(sourceOrgId) : mainWarehouseLabel;
    try {
      const info = await getTransferStockInfo(item.productId, label);
      updateItem(key, {
        availableQty: info.onHand, lots: info.lots, serialNos: info.serialNos, units: info.units, selectedUnitIds: [],
        selectedLotId: info.lots.length === 1 ? info.lots[0].id : null, loadingInfo: false,
      });
    } catch {
      updateItem(key, { loadingInfo: false });
    }
  }

  async function handleSave() {
    if (direction === "to_partner" ? !partnerId : !repId) { toast.error(direction === "to_partner" ? "Select the dealer / sales agent" : "Select a rep"); return; }
    const validItems = items.filter((i) => i.productId && parseFloat(i.qty) > 0);
    if (validItems.length === 0) { toast.error("Add at least one item with qty > 0"); return; }
    const noUnit = validItems.find((i) => i.units.length > 0 && i.selectedUnitIds.length === 0);
    if (noUnit) { toast.error(`Pick the serial number(s) of ${noUnit.productCode} to move`); return; }

    // Silently dropping the lot here (rather than requiring a pick) is what
    // let lot-tracked items reach field stock with no lot/expiry attached —
    // transferToRep/returnFromRep only write a stockLot row when lotNo is
    // set, so an unselected lot meant that item's lot data just vanished.
    const missingLot = validItems.find((i) => i.lots.length > 0 && !i.selectedLotId);
    if (missingLot) {
      toast.error(`Select a lot for ${missingLot.productCode} — it has ${missingLot.lots.length} lot(s) available`);
      return;
    }

    setSaving(true);
    try {
      if (direction === "to_partner") {
        // Stock placed with a dealer / sales agent stays ours until used — a consignment
        const res = await createConsignment({
          consigneeType: "partner", partnerId, sourceWarehouseLabel: mainWarehouseLabel, notes: notes || undefined,
          items: validItems.map((i) => ({
            productId: i.productId, qty: parseFloat(i.qty),
            lotNo: i.lots.find((l) => l.id === i.selectedLotId)?.lotNo ?? null,
            unitIds: i.selectedUnitIds.length ? i.selectedUnitIds : undefined,
          })),
        });
        if (!res.ok) { toast.error(res.title, res.details?.length ? { description: res.details.join(" · ") } : undefined); return; }
        toast.success(`Consignment ${res.consignmentNo} sent`);
        router.push(`/dashboard/consignment/${res.id}`);
        return;
      }
      const fn = direction === "to_rep" ? transferToRep : returnFromRep;
      const ref = await fn({
        repId,
        repName: selectedRep?.name ?? repId,
        items: validItems.map((i) => {
          const lot = i.lots.find((l) => l.id === i.selectedLotId) ?? null;
          return {
            productId: i.productId,
            qty: parseFloat(i.qty),
            unitIds: i.selectedUnitIds.length ? i.selectedUnitIds : undefined,
            lotNo: lot?.lotNo || undefined,
            expiryDate: lot?.expiryDate ?? undefined,
            consignedFromOrgId: direction === "to_rep" ? (i.selectedConsignedFromOrgId ?? undefined) : undefined,
          };
        }),
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
        <div className={cn("grid grid-cols-1 gap-3", partners.length ? "sm:grid-cols-3" : "sm:grid-cols-2")}>
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
            ...(partners.length ? [{
              key: "to_partner" as const,
              icon: HandshakeIcon,
              label: "Send to dealer / sales agent",
              desc: "Warehouse → external agent (as a consignment)",
              accent: "border-violet-300 dark:border-violet-700 hover:bg-violet-50 dark:hover:bg-violet-900/20",
              active: "border-violet-500 bg-violet-50 dark:bg-violet-900/20",
            }] : []),
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

      {direction === "to_partner" ? (
        <section className="border border-border rounded-xl p-4">
          <h2 className="text-sm font-semibold mb-3">Dealer / sales agent</h2>
          <select value={partnerId} onChange={(e) => setPartnerId(e.target.value)}
            className="w-full h-10 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring">
            {partners.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.model === "dealer" ? "dealer" : "sales agent"})</option>)}
          </select>
          <p className="text-xs text-muted-foreground mt-2">The stock stays yours until they use it. This creates a consignment — usage, returns and billing follow that agent&apos;s settings in Consignment.</p>
        </section>
      ) : (
      <section className="border border-border rounded-xl p-4">
        <h2 className="text-sm font-semibold mb-3">Sales Rep</h2>
        <select
          value={repId}
          onChange={(e) => handleRepChange(e.target.value)}
          className="w-full h-10 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">Select rep…</option>
          {(direction === "to_rep" ? ownReps : reps).map((r) => (
            <option key={r.id} value={r.id}>{r.name} ({r.role}{r.otherOrgName ? ` — ${r.otherOrgName}` : ""})</option>
          ))}
        </select>
        {direction === "to_rep" && (
          <p className="mt-2 text-xs text-muted-foreground">
            Only this company&apos;s specialists. For a sister company&apos;s specialist (e.g. Affirma), use{" "}
            <Link href="/dashboard/consignment/new" className="text-primary hover:underline">Consignment → New</Link>{" "}
            (the stock stays yours until used) or sell it to that company.
          </p>
        )}
      </section>
      )}

      {/* Items */}
      <section className="border border-border rounded-xl p-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-semibold">Items</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {direction === "to_partner"
                ? `Products to send to ${partners.find((p) => p.id === partnerId)?.name ?? "the agent"}`
                : direction === "to_rep"
                ? "Products to send to rep's field stock"
                : `Products to return from ${selectedRep?.name ?? "rep"}'s field stock`}
            </p>
          </div>
          {direction !== "from_rep" && (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setItems((p) => [...p, newLine()])}>
              <PlusIcon className="w-3.5 h-3.5" /> Add item
            </Button>
          )}
        </div>

        {loadingRepStock ? (
          <p className="text-sm text-muted-foreground py-6 text-center">Loading rep's stock…</p>
        ) : direction !== "from_rep" ? (
          /* ── Send to rep / agent: free-entry rows ── */
          <div className="space-y-3">
            {items.map((item, idx) => (
              <div key={item._key} className="p-3 rounded-lg border border-border/60 bg-muted/20 space-y-3">
                <div className="grid grid-cols-[auto_1fr_1fr_auto_auto] items-center gap-3">
                  <span className="text-xs text-muted-foreground w-5 text-center">{idx + 1}</span>
                  <div className="space-y-1">
                    <Label className="text-xs">Product</Label>
                    <ProductCell item={item} onUpdate={updateItem} warehouseLabel={mainWarehouseLabel} />
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
                      readOnly={item.units.length > 0}
                      title={item.units.length > 0 ? "Pick serial numbers below" : undefined}
                      onChange={(e) => updateItem(item._key, { qty: e.target.value })}
                      className={cn(item.units.length > 0 && "bg-muted/40",
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
                {direction === "to_rep" && item.consignedBuckets && item.consignedBuckets.length > 0 && (
                  <div className="flex flex-col gap-1.5 pt-1 border-t border-border/60">
                    <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Which stock?</p>
                    <div className="flex flex-wrap gap-1.5">
                      <button type="button" onClick={() => handleBucketSelect(item._key, null)}
                        className={cn("text-[11px] px-2 py-0.5 rounded-full border transition-colors",
                          !item.selectedConsignedFromOrgId ? "bg-teal-600 text-white border-teal-600" : "border-border bg-background hover:bg-muted")}>
                        Owned
                      </button>
                      {item.consignedBuckets.map((b) => (
                        <button key={b.sourceOrgId} type="button" onClick={() => handleBucketSelect(item._key, b.sourceOrgId)}
                          className={cn("text-[11px] px-2 py-0.5 rounded-full border transition-colors",
                            item.selectedConsignedFromOrgId === b.sourceOrgId ? "bg-amber-600 text-white border-amber-600" : "border-amber-300 dark:border-amber-700 bg-background hover:bg-amber-50 dark:hover:bg-amber-900/20")}>
                          Consigned from {b.sourceOrgName} ({b.qty})
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <LotPicker item={item} onSelect={(lotId) => handleLotSelect(item._key, lotId)} onToggleUnit={(u) => toggleUnit(item._key, u)} />
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
                      "rounded-lg border transition-colors px-4 py-3 space-y-2",
                      used ? "border-orange-300 dark:border-orange-700 bg-orange-50/50 dark:bg-orange-900/10" : "border-border/60",
                    )}
                  >
                    <div className="grid grid-cols-[1fr_auto_auto] items-center gap-4">
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
                          readOnly={item.units.length > 0}
                          value={item.qty}
                          onChange={(e) => updateItem(item._key, { qty: e.target.value })}
                          className={cn("h-8 text-sm text-right", used ? "border-orange-400 dark:border-orange-600" : "")}
                          placeholder="0"
                        />
                      </div>
                    </div>
                    {(used || item.units.length > 0) && <LotPicker item={item} onSelect={(lotId) => handleLotSelect(item._key, lotId)} onToggleUnit={(u) => toggleUnit(item._key, u)} />}
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
          {saving ? "Saving…" : direction === "to_partner" ? "Send consignment" : direction === "to_rep" ? "Transfer to Rep" : "Record Return"}
        </Button>
        <Button variant="outline" size="lg" onClick={() => router.push("/dashboard/inventory/field-stock")}>Cancel</Button>
      </div>
    </div>
  );
}
