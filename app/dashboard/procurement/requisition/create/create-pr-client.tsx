"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  createPurchaseRequisition,
  searchSuppliersForPr,
  getSoItemsForPr,
  searchConfirmedSosForPr,
  type PrItemInput,
} from "@/server/purchase-requisition";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/page-header";
import { ArrowLeftIcon, PlusIcon, TrashIcon, SearchIcon, XIcon, ChevronDownIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const CURRENCIES = ["MYR", "USD", "EUR", "SGD", "GBP", "AUD", "JPY", "CNY", "IDR", "THB"];

type SoOption = { id: string; soNo: string };

// ── Supplier autocomplete ─────────────────────────────────────────────────────

function SupplierCell({
  value,
  onSelect,
  onClear,
}: {
  value: string;
  onSelect: (id: string, name: string) => void;
  onClear: () => void;
}) {
  const [query, setQuery]   = useState(value);
  const [results, setResults] = useState<{ id: string; name: string }[]>([]);
  const [open, setOpen]     = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => { setQuery(value); }, [value]);

  useEffect(() => {
    if (!query.trim() || query === value) { setResults([]); return; }
    const t = setTimeout(async () => {
      const r = await searchSuppliersForPr(query);
      setResults(r);
      setOpen(r.length > 0);
    }, 250);
    return () => clearTimeout(t);
  }, [query, value]);

  useEffect(() => {
    function close(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  return (
    <div ref={ref} className="relative">
      <div className="flex items-center gap-1">
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search supplier…" className="h-7 text-xs" />
        {value && (
          <button onClick={onClear} className="text-muted-foreground hover:text-foreground">
            <XIcon className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {open && (
        <div className="absolute z-50 left-0 top-full mt-1 bg-popover border border-border rounded-lg shadow-lg text-xs w-56 max-h-48 overflow-y-auto">
          {results.map((r) => (
            <button
              key={r.id}
              className="w-full text-left px-3 py-2 hover:bg-muted/50 transition-colors"
              onClick={() => { onSelect(r.id, r.name); setQuery(r.name); setOpen(false); }}
            >
              {r.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Line item ─────────────────────────────────────────────────────────────────

interface LineItem extends PrItemInput {
  _key: string;
  _supplierId?: string;
  _supplierName?: string;
  // CPO tag — set when item was imported from an SO that has CPOs
  _cpoId?:        string | null;
  _cpoNo?:        string | null;
  _customerName?: string | null;
}

const newLine = (rowNo: number): LineItem => ({
  _key: crypto.randomUUID(),
  rowNo,
  productCode: "",
  description: "",
  qty: "1",
  uom: "",
  estimatedUnitCost: "0",
  currency: "MYR",
});

function calcTotal(item: LineItem) {
  return ((parseFloat(item.qty || "1") || 1) * (parseFloat(item.estimatedUnitCost || "0") || 0)).toFixed(2);
}

// ── Main form ─────────────────────────────────────────────────────────────────

interface Props {
  initialSoId?: string;
  openSos: SoOption[];
}

export function CreatePrClient({ initialSoId, openSos }: Props) {
  const router = useRouter();
  const [lines, setLines]         = useState<LineItem[]>([newLine(1)]);
  const [notes, setNotes]         = useState("");
  const [linkedSoId, setLinkedSoId] = useState<string | undefined>(initialSoId);
  const [linkedSoNo, setLinkedSoNo] = useState<string | undefined>();
  const [saving, setSaving]       = useState(false);
  const [loadingSo, setLoadingSo] = useState(false);

  const [soDropdownOpen, setSoDropdownOpen] = useState(false);
  const [soSearch, setSoSearch]             = useState("");
  const [soResults, setSoResults]           = useState<SoOption[]>([]);
  const [soHighlight, setSoHighlight]       = useState(-1);
  const [soSearching, setSoSearching]       = useState(false);
  const soTimer       = useRef<ReturnType<typeof setTimeout> | null>(null);
  const soDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function close(e: MouseEvent) {
      if (soDropdownRef.current && !soDropdownRef.current.contains(e.target as Node))
        setSoDropdownOpen(false);
    }
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  useEffect(() => {
    if (!initialSoId) return;
    const existing = openSos.find((s) => s.id === initialSoId);
    importSo(existing?.id ?? initialSoId, existing?.soNo ?? "");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSoSearch = useCallback((val: string) => {
    setSoSearch(val);
    setSoHighlight(-1);
    if (val.length < 2) { setSoResults([]); return; }
    if (soTimer.current) clearTimeout(soTimer.current);
    soTimer.current = setTimeout(async () => {
      setSoSearching(true);
      try { const r = await searchConfirmedSosForPr(val); setSoResults(r); setSoHighlight(-1); }
      finally { setSoSearching(false); }
    }, 300);
  }, []);

  function handleSoKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    const rows = soSearch.length >= 2 ? soResults : openSos.filter((s) => s.id !== linkedSoId);
    if (!rows.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setSoHighlight((i) => Math.min(i + 1, rows.length - 1)); return; }
    if (e.key === "ArrowUp")   { e.preventDefault(); setSoHighlight((i) => Math.max(i - 1, 0)); return; }
    if (e.key === "Enter")     { e.preventDefault(); const r = rows[soHighlight] ?? rows[0]; if (r) selectSo(r); return; }
    if (e.key === "Escape")    { setSoDropdownOpen(false); setSoSearch(""); setSoResults([]); }
  }

  async function importSo(soId: string, soNo: string) {
    setLoadingSo(true);
    try {
      const result = await getSoItemsForPr(soId);
      if (!result) { toast.error("SO not found"); return; }
      setLinkedSoId(soId);
      setLinkedSoNo(result.soNo);
      setLines(result.items.map((i) => ({
        _key: crypto.randomUUID(),
        rowNo: i.rowNo,
        productId: i.productId,
        productCode: i.productCode,
        description: i.description,
        qty: i.qty,
        uom: i.uom,
        estimatedUnitCost: String(i.estimatedUnitCost ?? "0"),
        currency: "MYR",
        _supplierId: undefined,
        _supplierName: undefined,
        _cpoId:        i.cpoId,
        _cpoNo:        i.cpoNo,
        _customerName: i.customerName,
      })));
      if (result.items.length > 0) toast.success(`Imported ${result.items.length} items from ${result.soNo}`);
    } catch {
      toast.error("Failed to load SO items");
    } finally {
      setLoadingSo(false);
    }
  }

  function selectSo(so: SoOption) {
    setSoDropdownOpen(false); setSoSearch(""); setSoResults([]); setSoHighlight(-1);
    if (so.id === linkedSoId) return;
    importSo(so.id, so.soNo);
  }

  function unlinkSo() {
    setLinkedSoId(undefined);
    setLinkedSoNo(undefined);
  }

  function setLine(key: string, patch: Partial<LineItem>) {
    setLines((prev) => prev.map((l) => l._key === key ? { ...l, ...patch } : l));
  }

  function addLine() {
    setLines((prev) => [...prev, newLine(prev.length + 1)]);
  }

  function removeLine(key: string) {
    setLines((prev) => prev.filter((l) => l._key !== key).map((l, i) => ({ ...l, rowNo: i + 1 })));
  }

  const totalsByCurrency = lines
    .filter((l) => l.description || l.productCode)
    .reduce<Record<string, number>>((acc, l) => {
      const ccy = l.currency ?? "MYR";
      acc[ccy] = (acc[ccy] ?? 0) + parseFloat(calcTotal(l));
      return acc;
    }, {});

  const totalBySupplier = lines
    .filter((l) => l._supplierName)
    .reduce<Record<string, { name: string; currency: string; total: number }>>((acc, l) => {
      const ccy = l.currency ?? "MYR";
      const key = `${l._supplierId ?? l._supplierName}::${ccy}`;
      if (!acc[key]) acc[key] = { name: l._supplierName!, currency: ccy, total: 0 };
      acc[key].total += parseFloat(calcTotal(l));
      return acc;
    }, {});

  async function handleSave() {
    const validLines = lines.filter((l) => l.description || l.productCode);
    if (!validLines.length) { toast.error("Add at least one item"); return; }

    // Auto-derive PR-level CPO: use it only if every filled item shares the same CPO
    const cpoIds = [...new Set(validLines.map((l) => l._cpoId).filter(Boolean))];
    const cpoId  = cpoIds.length === 1 ? cpoIds[0]! : undefined;
    const cpoNo  = cpoId ? validLines.find((l) => l._cpoId === cpoId)?._cpoNo ?? undefined : undefined;

    setSaving(true);
    try {
      const pr = await createPurchaseRequisition({
        salesOrderId: linkedSoId,
        salesOrderNo: linkedSoNo,
        customerPoId: cpoId,
        customerPoNo: cpoNo,
        notes: notes.trim() || undefined,
        items: validLines.map((l) => ({
          rowNo: l.rowNo,
          productId: l.productId,
          productCode: l.productCode,
          description: l.description,
          qty: l.qty,
          uom: l.uom,
          estimatedUnitCost: l.estimatedUnitCost,
          currency: l.currency,
          preferredSupplierId: l._supplierId,
          preferredSupplierName: l._supplierName,
        })),
      });
      toast.success("Purchase requisition created");
      router.push(`/dashboard/procurement/requisition/${pr.id}`);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  }

  const defaultSoRows = openSos.filter((s) => s.id !== linkedSoId);
  const dropdownRows  = soSearch.length >= 2 ? soResults : defaultSoRows;

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="New Purchase Requisition"
        action={
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => router.back()}>
              <ArrowLeftIcon className="w-3.5 h-3.5" /> Back
            </Button>
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : "Create Requisition"}
            </Button>
          </div>
        }
      />

      {/* ── Sales Order ── */}
      <section className="border border-border rounded-xl p-5 space-y-1.5">
        <Label className="text-sm font-semibold">Sales Order</Label>
        <p className="text-[11px] text-muted-foreground pb-1">
          Linking an SO imports all items with their Customer PO tags. Delete any lines you don&apos;t want in this PR.
        </p>

        <div className="relative" ref={soDropdownRef}>
          <div
            className={`min-h-9 flex flex-wrap gap-1.5 items-center px-3 py-2 rounded-md border cursor-pointer transition-colors ${soDropdownOpen ? "border-ring ring-1 ring-ring" : "border-border hover:border-ring/50"}`}
            onClick={() => { if (!linkedSoId || !loadingSo) setSoDropdownOpen((o) => !o); }}
          >
            {linkedSoId ? (
              <span className="flex items-center gap-1.5 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-md px-2 py-0.5 text-xs font-mono text-blue-700 dark:text-blue-300 leading-5">
                {loadingSo ? "Loading…" : linkedSoNo}
                <button className="text-blue-400 hover:text-blue-700 dark:hover:text-blue-200 -mr-0.5" onClick={(e) => { e.stopPropagation(); unlinkSo(); }}>
                  <XIcon className="w-3 h-3" />
                </button>
              </span>
            ) : (
              <span className="text-sm text-muted-foreground flex-1 select-none">Select sales order…</span>
            )}
            <ChevronDownIcon className={`w-3.5 h-3.5 text-muted-foreground ml-auto shrink-0 transition-transform duration-150 ${soDropdownOpen ? "rotate-180" : ""}`} />
          </div>

          {soDropdownOpen && (
            <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-background border border-border rounded-lg shadow-lg overflow-hidden">
              <div className="p-2 border-b border-border/60">
                <div className="relative">
                  <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                  <Input value={soSearch} onChange={(e) => handleSoSearch(e.target.value)} onKeyDown={handleSoKeyDown} placeholder="Search SO number…" className="pl-8 h-8 text-sm" autoFocus />
                  {soSearching && <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">Searching…</span>}
                </div>
              </div>
              <div className="max-h-64 overflow-y-auto">
                {dropdownRows.length === 0 ? (
                  <p className="px-3 py-5 text-sm text-muted-foreground text-center">
                    {soSearch.length >= 2 ? "No results" : openSos.length > 0 ? "All confirmed SOs selected" : "No confirmed SOs — search above"}
                  </p>
                ) : (
                  dropdownRows.map((s, idx) => {
                    const isSelected = s.id === linkedSoId;
                    return (
                      <button
                        key={s.id}
                        disabled={isSelected}
                        className={`w-full text-left px-3 py-2.5 transition-colors border-b border-border/30 last:border-0 disabled:opacity-40 ${idx === soHighlight ? "bg-muted" : "hover:bg-muted/50"}`}
                        onClick={() => { if (!isSelected) selectSo(s); }}
                      >
                        <span className="text-sm font-mono font-medium">{s.soNo}</span>
                        {isSelected && <span className="text-[10px] text-muted-foreground ml-2">selected</span>}
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ── Supplier summary ── */}
      {Object.keys(totalBySupplier).length > 0 && (
        <div className="rounded-xl border border-border bg-background p-5 space-y-3">
          <h2 className="text-sm font-semibold">Supplier Summary</h2>
          <div className="space-y-1.5">
            {Object.values(totalBySupplier).map((s, i) => (
              <div key={i} className="flex justify-between text-sm">
                <span className="text-muted-foreground">{s.name}</span>
                <span className="font-medium tabular-nums">
                  <span className="text-xs text-muted-foreground mr-1">{s.currency}</span>
                  {s.total.toLocaleString("en-MY", { minimumFractionDigits: 2 })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── PR line items ── */}
      <div className="rounded-xl border border-border bg-background overflow-hidden">
        <div className="px-5 py-3 border-b border-border bg-muted/20 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold">Items</h2>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Delete rows you don&apos;t need for this PR. CPO and customer tags are for reference only.
            </p>
          </div>
          {loadingSo && <span className="text-xs text-muted-foreground animate-pulse">Loading…</span>}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/30 text-muted-foreground">
                <th className="text-left px-3 py-2 font-medium w-8">#</th>
                <th className="text-left px-3 py-2 font-medium w-28">Code</th>
                <th className="text-left px-3 py-2 font-medium">Description</th>
                <th className="text-left px-3 py-2 font-medium w-28">Qty</th>
                <th className="text-left px-3 py-2 font-medium w-16">UOM</th>
                <th className="text-left px-3 py-2 font-medium w-20">Currency</th>
                <th className="text-left px-3 py-2 font-medium w-28">Est. Unit Cost</th>
                <th className="text-left px-3 py-2 font-medium w-24">Total</th>
                <th className="text-left px-3 py-2 font-medium w-40">Preferred Supplier</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {lines.map((line) => (
                <tr key={line._key} className="group align-top">
                  <td className="px-3 py-2.5 text-muted-foreground">{line.rowNo}</td>
                  <td className="px-2 py-1.5">
                    <Input
                      value={line.productCode ?? ""}
                      onChange={(e) => setLine(line._key, { productCode: e.target.value })}
                      className="h-7 text-xs"
                      placeholder="Code"
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    {/* CPO + Customer badges */}
                    {(line._cpoNo || line._customerName) && (
                      <div className="flex flex-wrap gap-1 mb-1">
                        {line._cpoNo && (
                          <span className={cn(
                            "inline-flex items-center text-[10px] font-mono font-medium px-1.5 py-0.5 rounded-md border",
                            "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800"
                          )}>
                            {line._cpoNo}
                          </span>
                        )}
                        {line._customerName && (
                          <span className="inline-flex items-center text-[10px] px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground border border-border/60">
                            {line._customerName}
                          </span>
                        )}
                      </div>
                    )}
                    <Input
                      value={line.description ?? ""}
                      onChange={(e) => setLine(line._key, { description: e.target.value })}
                      className="h-7 text-xs"
                      placeholder="Description"
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <Input type="number" value={line.qty ?? "1"} onChange={(e) => setLine(line._key, { qty: e.target.value })} className="h-7 text-xs text-center" />
                  </td>
                  <td className="px-2 py-1.5">
                    <Input value={line.uom ?? ""} onChange={(e) => setLine(line._key, { uom: e.target.value })} className="h-7 text-xs" placeholder="UOM" />
                  </td>
                  <td className="px-2 py-1.5">
                    <select
                      value={line.currency ?? "MYR"}
                      onChange={(e) => setLine(line._key, { currency: e.target.value })}
                      className="h-7 w-full rounded-md border border-border bg-background px-1.5 text-xs"
                    >
                      {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </td>
                  <td className="px-2 py-1.5">
                    <Input type="number" value={line.estimatedUnitCost ?? "0"} onChange={(e) => setLine(line._key, { estimatedUnitCost: e.target.value })} className="h-7 text-xs" />
                  </td>
                  <td className="px-3 py-2.5 tabular-nums font-medium">
                    <span className="text-[10px] text-muted-foreground mr-0.5">{line.currency ?? "MYR"}</span>
                    {parseFloat(calcTotal(line)).toLocaleString("en-MY", { minimumFractionDigits: 2 })}
                  </td>
                  <td className="px-2 py-1.5">
                    <SupplierCell
                      value={line._supplierName ?? ""}
                      onSelect={(id, name) => setLine(line._key, { _supplierId: id, _supplierName: name })}
                      onClear={() => setLine(line._key, { _supplierId: undefined, _supplierName: undefined })}
                    />
                  </td>
                  <td className="px-2 py-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => removeLine(line._key)} className="text-muted-foreground hover:text-destructive">
                      <TrashIcon className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 border-t border-border flex items-center justify-between">
          <Button variant="ghost" size="sm" className="gap-1.5 text-xs" onClick={addLine}>
            <PlusIcon className="w-3 h-3" /> Add Item
          </Button>
          {Object.entries(totalsByCurrency).length > 0 && (
            <div className="flex items-center gap-3 text-xs text-muted-foreground tabular-nums">
              {Object.entries(totalsByCurrency).map(([ccy, amt]) => (
                <span key={ccy}>
                  <span className="font-medium text-foreground">{ccy}</span>{" "}
                  <span className="font-semibold text-foreground">{amt.toLocaleString("en-MY", { minimumFractionDigits: 2 })}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Notes ── */}
      <div className="rounded-xl border border-border bg-background p-5 space-y-2">
        <Label className="text-sm font-semibold">Notes / Justification</Label>
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Reason for purchase, urgency, special requirements…"
          rows={3}
          className="text-sm resize-none"
        />
      </div>

      <div className="flex justify-end gap-2 pb-6">
        <Button variant="ghost" size="sm" onClick={() => router.back()}>Cancel</Button>
        <Button size="sm" onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Create Requisition"}
        </Button>
      </div>
    </div>
  );
}
