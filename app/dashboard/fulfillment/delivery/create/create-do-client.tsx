"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createDeliveryOrder, getSoRemainingItems, type DeliveryOrderItemInput, type SoItemRemaining } from "@/server/delivery-order";
import { searchConfirmedSalesOrders, getSalesOrderDetail, type CpoCustomer } from "@/server/sales-order";
import { searchProducts } from "@/server/inventory";
import { getCustomers, getCustomer } from "@/server/customer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/page-header";
import { Highlight } from "@/components/highlight";
import {
  ArrowLeftIcon, PlusIcon, TrashIcon, SearchIcon, XIcon,
  BuildingIcon, LinkIcon, CheckCircle2Icon, Loader2Icon,
} from "lucide-react";

type Customer = Awaited<ReturnType<typeof getCustomer>>;
interface LineItem extends DeliveryOrderItemInput { _key: string; originalQty?: string; }

const TOTAL_COLS = 4; // code, description, qty, uom

const newLine = (rowNo: number): LineItem => ({
  _key: crypto.randomUUID(), rowNo,
  productId: undefined, productCode: "", description: "", qty: "1", uom: "",
});

export interface PrefillData {
  salesOrderId: string;
  salesOrderNo: string;
  soType?: string;
  proformaReason?: string | null;
  customerPoId?: string;
  customerPoNo?: string;
  customer: Customer | null;
  deliveryAddress: string;
  deliveryDate: string;
  items: Omit<LineItem, "_key">[];  // includes soItemId?, originalQty?
}

// Defined outside component to avoid re-creation on every render
interface ProductCellProps {
  item: LineItem;
  rowIdx: number;
  onUpdate: (key: string, patch: Partial<LineItem>) => void;
  onCellKeyDown: (e: React.KeyboardEvent<HTMLInputElement>, row: number, col: number) => void;
}

function ProductCell({ item, rowIdx, onUpdate, onCellKeyDown }: ProductCellProps) {
  const [q, setQ] = useState(item.productCode ?? "");
  const [results, setResults] = useState<{ id: string; productCode: string; description: string | null }[]>([]);
  const [open, setOpen] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { setQ(item.productCode ?? ""); }, [item.productCode]);

  function handleInput(val: string) {
    setQ(val);
    onUpdate(item._key, { productCode: val, productId: undefined });
    if (debounce.current) clearTimeout(debounce.current);
    if (!val.trim()) { setResults([]); setOpen(false); return; }
    debounce.current = setTimeout(async () => {
      const r = await searchProducts(val);
      setResults(r);
      setOpen(r.length > 0);
      const exact = r.find((p) => p.productCode.toLowerCase() === val.trim().toLowerCase());
      if (exact) {
        onUpdate(item._key, { productId: exact.id, productCode: exact.productCode, description: item.description || exact.description || "" });
        setOpen(false);
      }
    }, 300);
  }

  function pick(p: { id: string; productCode: string; description: string | null }) {
    onUpdate(item._key, { productId: p.id, productCode: p.productCode, description: item.description || p.description || "" });
    setQ(p.productCode);
    setResults([]);
    setOpen(false);
  }

  return (
    <div className="relative">
      <Input
        data-row={rowIdx}
        data-col={0}
        value={q}
        onChange={(e) => handleInput(e.target.value)}
        onKeyDown={(e) => {
          if (open && (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter")) return;
          onCellKeyDown(e, rowIdx, 0);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="h-7 text-xs"
        placeholder="Code…"
      />
      {open && (
        <div className="absolute z-50 top-full left-0 mt-0.5 w-56 rounded-md border border-border bg-background shadow-md max-h-40 overflow-y-auto text-xs">
          {results.map((p) => (
            <button key={p.id} type="button"
              className="w-full text-left px-2 py-1.5 hover:bg-accent flex gap-2"
              onClick={() => pick(p)}
            >
              <span className="font-mono font-medium">{p.productCode}</span>
              <span className="text-muted-foreground truncate">{p.description ?? ""}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Step 1: SO picker (shown when no prefill) ──────────────────────────────

type SoSearchResult = Awaited<ReturnType<typeof searchConfirmedSalesOrders>>[number];

interface SoPickerProps {
  onSelect: (prefill: PrefillData) => void;
}

function SoPicker({ onSelect }: SoPickerProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SoSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // CPO picker state — set after SO is selected when >1 CPO
  const [pendingSo, setPendingSo] = useState<{
    detail: NonNullable<Awaited<ReturnType<typeof getSalesOrderDetail>>>;
    remaining: SoItemRemaining[];
  } | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await searchConfirmedSalesOrders(query);
        setResults(r);
      } finally {
        setLoading(false);
      }
    }, query.length === 0 ? 0 : 300);
  }, [query]);

  function buildPrefill(
    detail: NonNullable<Awaited<ReturnType<typeof getSalesOrderDetail>>>,
    cpo?: CpoCustomer,
    remaining?: SoItemRemaining[],
  ): PrefillData {
    const filteredItems = cpo
      ? detail.items.filter((i) => i.sourceCustomerPoId === cpo.customerPoId)
      : detail.items;

    const remainingMap = new Map(remaining?.map((r) => [r.soItemId, r]) ?? []);

    const rawSnap = (cpo?.customerSnapshot ?? detail.customerSnapshot) as any;
    const customerId = cpo?.customerId ?? detail.customerId ?? "";
    const customer = rawSnap
      ? { id: customerId, name: rawSnap.name, title: rawSnap.title ?? null, companies: rawSnap.organizationName ? [{ organizationName: rawSnap.organizationName, isPrimary: true }] : [] }
      : null;

    return {
      salesOrderId: detail.id,
      salesOrderNo: detail.soNo,
      soType: detail.soType,
      proformaReason: detail.proformaReason,
      customerPoId: cpo?.customerPoId,
      customerPoNo: cpo?.customerPoNo,
      customer: customer as any,
      deliveryAddress: detail.deliveryAddress ?? "",
      deliveryDate: detail.deliveryDate
        ? new Date(detail.deliveryDate).toISOString().split("T")[0]
        : "",
      items: filteredItems
        .filter((i) => i.description || i.productCode)
        .map((i, idx) => {
          const rem = remainingMap.get(i.id);
          return {
            rowNo: idx + 1,
            soItemId: i.id,
            originalQty: rem?.originalQty ?? i.qty ?? "1",
            productId: i.productId ?? undefined,
            productCode: i.productCode ?? "",
            description: i.description ?? "",
            qty: rem ? rem.remainingQty : (i.qty ?? "1"),
            uom: i.uom ?? "",
          };
        })
        .filter((item) => parseFloat(item.qty || "0") > 0),
    };
  }

  async function pickSo(so: SoSearchResult) {
    setLoadingId(so.id);
    try {
      const [detail, remaining] = await Promise.all([
        getSalesOrderDetail(so.id),
        getSoRemainingItems(so.id).catch(() => [] as SoItemRemaining[]),
      ]);
      if (!detail) { toast.error("Sales order not found"); return; }

      if (detail.cpoCustomers.length > 1) {
        setPendingSo({ detail, remaining });
      } else if (detail.cpoCustomers.length === 1) {
        onSelect(buildPrefill(detail, detail.cpoCustomers[0], remaining));
      } else {
        onSelect(buildPrefill(detail, undefined, remaining));
      }
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoadingId(null);
    }
  }

  // ── CPO picker step ──
  if (pendingSo) {
    const { detail: so, remaining } = pendingSo;
    return (
      <div className="p-6 space-y-5">
        <PageHeader
          title="New Delivery Order"
          description={`Select the customer PO to deliver for SO ${so.soNo}`}
          action={
            <Button variant="outline" size="sm" onClick={() => setPendingSo(null)} className="gap-1.5">
              <ArrowLeftIcon className="w-3.5 h-3.5" /> Back
            </Button>
          }
        />
        <section className="border border-border rounded-xl p-4">
          <h2 className="text-sm font-semibold mb-1">Select Customer PO</h2>
          <p className="text-xs text-muted-foreground mb-3">
            This SO covers {so.cpoCustomers.length} customer purchase orders. A separate Delivery Order is created for each.
          </p>
          <div className="divide-y divide-border/40 rounded-lg border border-border overflow-hidden">
            {so.cpoCustomers.map((cpo) => {
              const snap = cpo.customerSnapshot as any;
              const orgName = snap?.organizationName;
              const personName = snap ? [snap.title, snap.name].filter(Boolean).join(" ") : null;
              const itemCount = so.items.filter((i) => i.sourceCustomerPoId === cpo.customerPoId).length;
              return (
                <button
                  key={cpo.customerPoId}
                  className="w-full text-left px-3 py-3 hover:bg-muted/50 transition-colors flex items-center justify-between gap-3"
                  onClick={() => onSelect(buildPrefill(so, cpo, remaining))}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-mono font-semibold">{cpo.customerPoNo}</span>
                      <span className="text-[10px] text-muted-foreground">{itemCount} item{itemCount !== 1 ? "s" : ""}</span>
                    </div>
                    {orgName && <p className="text-[11px] text-muted-foreground mt-0.5">{orgName}</p>}
                    {personName && !orgName && <p className="text-[11px] text-muted-foreground mt-0.5">{personName}</p>}
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">Select →</span>
                </button>
              );
            })}
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-5">
      <PageHeader
        title="New Delivery Order"
        description="Select a confirmed Sales Order to create a delivery against"
        action={
          <Button variant="outline" size="sm" onClick={() => router.back()} className="gap-1.5">
            <ArrowLeftIcon className="w-3.5 h-3.5" /> Back
          </Button>
        }
      />

      <section className="border border-border rounded-xl p-4">
        <h2 className="text-sm font-semibold mb-1">Select Sales Order</h2>
        <p className="text-xs text-muted-foreground mb-3">
          A Delivery Order must be linked to a confirmed SO. To ship samples, warranty replacements, or free goods, create a Pro-forma SO first.
        </p>

        <div className="relative mb-3">
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by SO number…"
            className="pl-9 h-9 text-sm"
            autoFocus
          />
          {loading && (
            <Loader2Icon className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground animate-spin" />
          )}
        </div>

        {results.length === 0 && !loading ? (
          <p className="text-xs text-muted-foreground py-4 text-center">
            {query.length === 0
              ? "Type to search — only SOs with stock reserved are shown"
              : "No matching SO found, or its stock has not been reserved yet"}
          </p>
        ) : (
          <div className="divide-y divide-border/40 rounded-lg border border-border overflow-hidden">
            {results.map((so) => {
              const snap = so.customerSnapshot as any;
              const orgName = snap?.organizationName;
              const personName = snap ? [snap.title, snap.name].filter(Boolean).join(" ") : null;
              return (
                <button
                  key={so.id}
                  className="w-full text-left px-3 py-2.5 hover:bg-muted/50 transition-colors flex items-center justify-between gap-3"
                  onClick={() => pickSo(so)}
                  disabled={loadingId === so.id}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-mono font-semibold">
                        <Highlight text={so.soNo} query={query} />
                      </span>
                      {so.soType === "proforma" && (
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-400 capitalize">
                          Pro-forma · {so.proformaReason ?? ""}
                        </span>
                      )}
                    </div>
                    {orgName && <p className="text-[11px] text-muted-foreground mt-0.5">{orgName}</p>}
                    {personName && !orgName && <p className="text-[11px] text-muted-foreground mt-0.5">{personName}</p>}
                  </div>
                  {loadingId === so.id ? (
                    <Loader2Icon className="w-3.5 h-3.5 text-muted-foreground animate-spin shrink-0" />
                  ) : (
                    <span className="text-xs text-muted-foreground shrink-0">Select →</span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export function CreateDeliveryOrderClient({ prefill }: { prefill?: PrefillData }) {
  const router = useRouter();
  const [activePrefill, setActivePrefill] = useState<PrefillData | undefined>(prefill);

  // Show SO picker when no prefill
  if (!activePrefill) {
    return <SoPicker onSelect={setActivePrefill} />;
  }

  return <DoForm prefill={activePrefill} />;
}

// ── Form (always has prefill at this point) ────────────────────────────────

function DoForm({ prefill }: { prefill: PrefillData }) {
  const router = useRouter();
  const tableRef = useRef<HTMLDivElement>(null);

  const fromSo = !!prefill.salesOrderId;
  const isProforma = prefill.soType === "proforma";

  // Customer
  const [custSearch, setCustSearch] = useState("");
  const [custResults, setCustResults] = useState<Awaited<ReturnType<typeof getCustomers>>>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(prefill.customer ?? null);
  const [custCompanyId, setCustCompanyId] = useState<string | undefined>();
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fields
  const [salesOrderId] = useState(prefill.salesOrderId ?? "");
  const [salesOrderNo] = useState(prefill.salesOrderNo ?? "");
  const [deliveredTo, setDeliveredTo] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState(prefill.deliveryAddress ?? "");
  const [deliveryDate, setDeliveryDate] = useState(prefill.deliveryDate ?? "");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<LineItem[]>(() =>
    prefill.items?.length
      ? prefill.items.map((i) => ({ ...i, _key: crypto.randomUUID() }))
      : [newLine(1)],
  );
  const [saving, setSaving] = useState(false);

  const handleCustSearch = useCallback((val: string) => {
    setCustSearch(val);
    if (val.length < 2) { setCustResults([]); return; }
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(async () => {
      const res = await getCustomers(val);
      setCustResults(res.slice(0, 8));
    }, 300);
  }, []);

  const updateItem = useCallback((key: string, patch: Partial<LineItem>) => {
    setItems((prev) => prev.map((i) => (i._key === key ? { ...i, ...patch } : i)));
  }, []);

  function addLine() {
    setItems((prev) => [...prev, newLine(prev.length + 1)]);
  }

  function removeLine(key: string) {
    setItems((prev) =>
      prev.filter((i) => i._key !== key).map((i, idx) => ({ ...i, rowNo: idx + 1 })),
    );
  }

  function handleCellKeyDown(
    e: React.KeyboardEvent<HTMLInputElement>,
    rowIdx: number,
    colIdx: number,
  ) {
    const container = tableRef.current;
    if (!container) return;

    function focus(r: number, c: number) {
      const el = container!.querySelector<HTMLInputElement>(`[data-row="${r}"][data-col="${c}"]`);
      el?.focus();
      el?.select();
    }

    if (e.key === "ArrowRight" || (e.key === "Tab" && !e.shiftKey)) {
      e.preventDefault();
      if (colIdx < TOTAL_COLS - 1) focus(rowIdx, colIdx + 1);
      else if (rowIdx < items.length - 1) focus(rowIdx + 1, 0);
    } else if (e.key === "ArrowLeft" || (e.key === "Tab" && e.shiftKey)) {
      e.preventDefault();
      if (colIdx > 0) focus(rowIdx, colIdx - 1);
      else if (rowIdx > 0) focus(rowIdx - 1, TOTAL_COLS - 1);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      focus(rowIdx + 1, colIdx);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (rowIdx > 0) focus(rowIdx - 1, colIdx);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (colIdx === TOTAL_COLS - 1 && rowIdx === items.length - 1) {
        addLine();
        setTimeout(() => focus(rowIdx + 1, 0), 50);
      } else {
        focus(rowIdx, colIdx + 1);
      }
    }
  }

  async function handleSave() {
    if (!items.some((i) => i.description || i.productCode)) {
      toast.error("Add at least one item");
      return;
    }
    setSaving(true);
    try {
      await createDeliveryOrder({
        customerId: selectedCustomer?.id,
        salesOrderId: salesOrderId || undefined,
        salesOrderNo: salesOrderNo || undefined,
        customerPoId: prefill.customerPoId || undefined,
        customerPoNo: prefill.customerPoNo || undefined,
        deliveredTo: deliveredTo || undefined,
        deliveryAddress: deliveryAddress || undefined,
        deliveryDate: deliveryDate ? new Date(deliveryDate) : undefined,
        notes: notes || undefined,
        items: items.map(({ _key, originalQty: _oq, ...rest }) => rest),
      });
      toast.success("Delivery order created");
      router.refresh();
      router.push("/dashboard/fulfillment/delivery");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  }

  const allCompanies = (selectedCustomer as any)?.companies ?? [];

  return (
    <div className="p-6 space-y-4">
      <PageHeader
        title="New Delivery Order"
        description="Create a delivery order for a customer shipment"
        action={
          <Button variant="outline" size="sm" onClick={() => router.back()} className="gap-1.5">
            <ArrowLeftIcon className="w-3.5 h-3.5" /> Back
          </Button>
        }
      />

      {/* ── 1. Linked SO banner ── */}
      <section className={`rounded-xl p-4 border ${isProforma ? "border-violet-200 dark:border-violet-800/50 bg-violet-50 dark:bg-violet-900/10" : "border-blue-200 dark:border-blue-800/50 bg-blue-50 dark:bg-blue-900/10"}`}>
        <div className="flex items-center gap-2.5">
          <LinkIcon className={`w-4 h-4 shrink-0 ${isProforma ? "text-violet-600 dark:text-violet-400" : "text-blue-600 dark:text-blue-400"}`} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className={`text-sm font-medium ${isProforma ? "text-violet-800 dark:text-violet-300" : "text-blue-800 dark:text-blue-300"}`}>
                Linked to Sales Order <span className="font-mono">{salesOrderNo}</span>
              </p>
              {isProforma && (
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-violet-200 dark:bg-violet-800/50 text-violet-800 dark:text-violet-300 capitalize">
                  Pro-forma · {prefill.proformaReason ?? ""}
                </span>
              )}
              {prefill.customerPoNo && (
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 font-mono">
                  CPO: {prefill.customerPoNo}
                </span>
              )}
            </div>
            <p className={`text-xs mt-0.5 ${isProforma ? "text-violet-600/80 dark:text-violet-400/80" : "text-blue-600/80 dark:text-blue-400/80"}`}>
              {isProforma
                ? "Pro-forma delivery — no commercial invoice will be raised."
                : "Customer and items pre-filled from confirmed SO. Adjust quantities for partial delivery."}
            </p>
          </div>
          <CheckCircle2Icon className={`w-4 h-4 shrink-0 ${isProforma ? "text-violet-500" : "text-blue-500"}`} />
        </div>
      </section>

      {/* ── 2. Customer ── */}
      <section className="border border-border rounded-xl p-4">
        <h2 className="text-sm font-semibold mb-3">Customer</h2>
        {selectedCustomer ? (
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-sm">
                  {[(selectedCustomer as any).title, (selectedCustomer as any).name]
                    .filter(Boolean)
                    .join(" ")}
                </span>
                {!fromSo && (
                  <button
                    onClick={() => { setSelectedCustomer(null); setCustCompanyId(undefined); }}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <XIcon className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              {allCompanies.length > 1 ? (
                <div className="mt-2 space-y-1">
                  <Label className="text-[11px] text-muted-foreground">Select company</Label>
                  <select
                    className="w-full h-8 rounded-md border border-border bg-background px-2.5 text-sm"
                    value={custCompanyId ?? ""}
                    onChange={(e) => setCustCompanyId(e.target.value || undefined)}
                  >
                    <option value="">Primary / default</option>
                    {allCompanies.map((c: any) => (
                      <option key={c.id} value={c.id}>{c.organizationName}{c.isPrimary ? " (primary)" : ""}</option>
                    ))}
                  </select>
                </div>
              ) : allCompanies.length === 1 ? (
                <p className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1">
                  <BuildingIcon className="w-3 h-3" /> {allCompanies[0].organizationName}
                </p>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="relative">
            <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              value={custSearch}
              onChange={(e) => handleCustSearch(e.target.value)}
              placeholder="Search customer by name..."
              className="pl-9 h-9 text-sm"
            />
            {custResults.length > 0 && (
              <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-background border border-border rounded-lg shadow-lg overflow-hidden">
                {custResults.map((c) => (
                  <button
                    key={c.id}
                    className="w-full text-left px-3 py-2 hover:bg-muted/50 transition-colors border-b border-border/30 last:border-0"
                    onClick={() => { setSelectedCustomer(c as any); setCustSearch(""); setCustResults([]); }}
                  >
                    <div className="text-sm font-medium">
                      <Highlight text={[c.title, c.name].filter(Boolean).join(" ")} query={custSearch} />
                    </div>
                    {c.companies[0]?.organizationName && (
                      <div className="text-[11px] text-muted-foreground">
                        <Highlight text={c.companies[0].organizationName} query={custSearch} />
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {/* ── 3. Delivery details ── */}
      <section className="border border-border rounded-xl p-4">
        <h2 className="text-sm font-semibold mb-3">Delivery details</h2>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Delivery date</Label>
            <input
              type="date"
              value={deliveryDate}
              onChange={(e) => setDeliveryDate(e.target.value)}
              className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Delivered to (person)</Label>
            <Input
              value={deliveredTo}
              onChange={(e) => setDeliveredTo(e.target.value)}
              placeholder="Recipient name"
              className="h-9 text-sm"
            />
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label className="text-xs">Delivery address</Label>
            <Input
              value={deliveryAddress}
              onChange={(e) => setDeliveryAddress(e.target.value)}
              placeholder="Delivery address"
              className="h-9 text-sm"
            />
          </div>
        </div>
        <div className="mt-3 space-y-1.5">
          <Label className="text-xs">Notes</Label>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Internal notes..."
            rows={2}
            className="text-sm"
          />
        </div>
      </section>

      {/* ── 4. Items ── */}
      <section className="border border-border rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-sm font-semibold">Items</h2>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Pre-filled from SO — adjust quantities for partial delivery if needed.
            </p>
          </div>
          <Button variant="outline" size="sm" className="gap-1.5 h-7 text-xs" onClick={addLine}>
            <PlusIcon className="w-3 h-3" /> Add row
          </Button>
        </div>

        <div className="overflow-x-auto" ref={tableRef}>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="text-left pb-2 pr-2 w-8">#</th>
                <th className="text-left pb-2 pr-2 w-24">Code</th>
                <th className="text-left pb-2 pr-2">Description</th>
                <th className="text-right pb-2 pr-2 w-16">Qty</th>
                <th className="text-left pb-2 pr-2 w-14">UOM</th>
                <th className="w-6" />
              </tr>
            </thead>
            <tbody>
              {items.map((item, rowIdx) => (
                <tr key={item._key} className="border-b border-border/50 last:border-0">
                  <td className="py-1.5 pr-2 text-muted-foreground">{item.rowNo}</td>
                  <td className="py-1.5 pr-2">
                    <ProductCell
                      item={item}
                      rowIdx={rowIdx}
                      onUpdate={updateItem}
                      onCellKeyDown={handleCellKeyDown}
                    />
                  </td>
                  <td className="py-1.5 pr-2">
                    <Input
                      data-row={rowIdx}
                      data-col={1}
                      value={item.description ?? ""}
                      onChange={(e) => updateItem(item._key, { description: e.target.value })}
                      onKeyDown={(e) => handleCellKeyDown(e, rowIdx, 1)}
                      className="h-7 text-xs"
                    />
                  </td>
                  <td className="py-1.5 pr-2">
                    <Input
                      data-row={rowIdx}
                      data-col={2}
                      value={item.qty}
                      onChange={(e) => updateItem(item._key, { qty: e.target.value })}
                      onKeyDown={(e) => handleCellKeyDown(e, rowIdx, 2)}
                      className="h-7 text-xs text-right"
                    />
                    {item.originalQty && item.originalQty !== item.qty && (
                      <p className="text-[9px] text-muted-foreground mt-0.5 text-right">
                        of {item.originalQty}
                      </p>
                    )}
                  </td>
                  <td className="py-1.5 pr-2">
                    <Input
                      data-row={rowIdx}
                      data-col={3}
                      value={item.uom ?? ""}
                      onChange={(e) => updateItem(item._key, { uom: e.target.value })}
                      onKeyDown={(e) => handleCellKeyDown(e, rowIdx, 3)}
                      className="h-7 text-xs"
                      placeholder="unit"
                    />
                  </td>
                  <td className="py-1.5">
                    <button
                      onClick={() => removeLine(item._key)}
                      disabled={items.length === 1}
                      className="text-muted-foreground hover:text-destructive transition-colors disabled:opacity-30"
                    >
                      <TrashIcon className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="flex gap-3 pb-8">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Creating…" : "Create delivery order"}
        </Button>
        <Button variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
