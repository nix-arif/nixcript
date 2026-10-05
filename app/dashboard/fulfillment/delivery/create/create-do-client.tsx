"use client";

import { INTENDED_USE_LABELS, isLendable, unitUseLabel, LOAN_PURPOSE_LABELS } from "@/lib/inventory/constants";
import { getCaseTemplatesForCustomer, getProductsMda, saveCaseTemplate, type CaseTemplateRow } from "@/server/case-template";
import type { CustomerView } from "@/lib/delivery/customer-view";
import { Fragment, useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createDeliveryOrder, getSoRemainingItems, type DeliveryOrderItemInput, type SoItemRemaining } from "@/server/delivery-order";
import { searchConfirmedSalesOrders, getSalesOrderDetail, type CpoCustomer } from "@/server/sales-order";
import { searchProducts } from "@/server/inventory";
import { getCustomers, getCustomer } from "@/server/customer";
import { getFieldReps, getRepFieldStock, type OrgMember, type RepStockItem } from "@/server/field-stock";
import { getItemGroups, type ItemGroupRow } from "@/server/item-group";
import { recordCaseActuals } from "@/server/delivery-order";
import { pricedWithoutMdaMessage } from "@/lib/mda/priced-message";
import { ItemizedMdaWarning } from "@/components/itemized-mda-warning";
import { groupSections } from "@/lib/inventory/group-sections";
import { type DocumentCategoryRow } from "@/server/document-category";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/page-header";
import { Highlight } from "@/components/highlight";
import { cn } from "@/lib/utils";
import { uid } from "@/lib/uid";
import {
  ArrowLeftIcon, PlusIcon, TrashIcon, SearchIcon, XIcon,
  BuildingIcon, LinkIcon, CheckCircle2Icon, Loader2Icon,
  StethoscopeIcon, ShoppingCartIcon, PhoneIcon, MailIcon, ChevronDownIcon, ChevronRightIcon,
} from "lucide-react";

type Customer = Awaited<ReturnType<typeof getCustomer>>;
interface LineItem extends DeliveryOrderItemInput { _key: string; originalQty?: string; }
// A tagged sales person / application specialist — either a real member
// (isExt false, id is their user id — carries otherOrgName when they belong
// to a sibling org rather than the active one) or a plain typed name with no
// linked account (isExt true, id is a locally-generated placeholder).
interface PersonTag { id: string; name: string; isExt: boolean; otherOrgName?: string; }

const TOTAL_COLS = 4; // code, description, qty, uom

const newLine = (rowNo: number): LineItem => ({
  _key: uid(), rowNo,
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

// ── Mode selector ──────────────────────────────────────────────────────────

function ModeSelector({ onSelect }: { onSelect: (mode: "case" | "so") => void }) {
  const router = useRouter();
  return (
    <div className="p-6">
      <PageHeader
        title="New Delivery Order"
        description="Choose the type of delivery order to create."
        action={
          <Button variant="outline" size="sm" onClick={() => router.back()} className="gap-1.5">
            <ArrowLeftIcon className="w-3.5 h-3.5" /> Back
          </Button>
        }
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-xl mt-2">
        {([
          {
            key: "case" as const,
            icon: StethoscopeIcon,
            title: "Case DO",
            desc: "Per-case billing — no Sales Order required. Deducts rep's field stock automatically.",
            accent: "border-teal-300 dark:border-teal-700 hover:bg-teal-50 dark:hover:bg-teal-900/20",
          },
          {
            key: "so" as const,
            icon: ShoppingCartIcon,
            title: "From Sales Order",
            desc: "Linked to a confirmed Sales Order. For tender/contract fulfilment.",
            accent: "border-blue-300 dark:border-blue-700 hover:bg-blue-50 dark:hover:bg-blue-900/20",
          },
        ]).map((opt) => (
          <button
            key={opt.key}
            onClick={() => onSelect(opt.key)}
            className={cn("rounded-xl border-2 p-5 text-left transition-colors bg-card", opt.accent)}
          >
            <opt.icon className="w-5 h-5 mb-2 text-muted-foreground" />
            <p className="text-sm font-semibold">{opt.title}</p>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{opt.desc}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export function CreateDeliveryOrderClient({ prefill, categories = [], currentUserId = "", currentUserName = "" }: { prefill?: PrefillData; categories?: DocumentCategoryRow[]; currentUserId?: string; currentUserName?: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<"case" | "so" | null>(prefill ? "so" : null);
  const [activePrefill, setActivePrefill] = useState<PrefillData | undefined>(prefill);

  if (!mode) return <ModeSelector onSelect={setMode} />;
  if (mode === "case") return <CaseDoForm categories={categories} currentUserId={currentUserId} currentUserName={currentUserName} />;
  if (!activePrefill) return <SoPicker onSelect={setActivePrefill} />;
  return <DoForm prefill={activePrefill} categories={categories} />;
}

// ── Form (always has prefill at this point) ────────────────────────────────

function DoForm({ prefill, categories = [] }: { prefill: PrefillData; categories?: DocumentCategoryRow[] }) {
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
  const [deliveryDate, setDeliveryDate] = useState(prefill.deliveryDate || new Date().toISOString().split("T")[0]);
  const [notes, setNotes] = useState("");
  const [categoryIds, setCategoryIds] = useState<string[]>(() =>
    categories.filter((c) => c.isDefault).map((c) => c.id),
  );
  const [items, setItems] = useState<LineItem[]>(() =>
    prefill.items?.length
      ? prefill.items.map((i) => ({ ...i, _key: uid() }))
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
        categoryIds: categoryIds.length > 0 ? categoryIds : undefined,
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

        <div className="mt-3 space-y-1.5">
          <Label className="text-xs">Categories</Label>
          {categories.length === 0 ? (
            <p className="text-xs text-muted-foreground italic py-1">No categories yet — create one in Organization → Categories</p>
          ) : (
            <div className="flex flex-wrap gap-2 pt-0.5">
              {categories.map((c) => {
                const selected = categoryIds.includes(c.id);
                const hex = c.color ?? "#6366f1";
                return (
                  <button key={c.id} type="button"
                    onClick={() => setCategoryIds((prev) => selected ? prev.filter((id) => id !== c.id) : [...prev, c.id])}
                    className={cn("inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold border-2 transition-all select-none",
                      selected ? "text-white shadow-sm" : "bg-background text-foreground/70 hover:text-foreground")}
                    style={selected ? { backgroundColor: hex, borderColor: hex } : { borderColor: hex + "55" }}
                  >
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: selected ? "rgba(255,255,255,0.8)" : hex }} />
                    {c.name}
                    {selected && <span className="ml-0.5 opacity-80">✓</span>}
                  </button>
                );
              })}
            </div>
          )}
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

// ── Case DO customer picker ─────────────────────────────────────────────────
// One option per customer × organisation membership, so picking
// "Dr A — Hospital X" sets the customer AND the hospital in one step (Case DOs
// are delivered per hospital). Keyboard navigable, with loading / empty states,
// and stale responses from slower earlier searches are ignored.

type CustomerSearchRow = Awaited<ReturnType<typeof getCustomers>>[number];
type CustomerOrg = CustomerSearchRow["companies"][number];

interface CustomerOption {
  key: string;
  customer: CustomerSearchRow;
  /** Orgs whose name matched the search — shown as a hint, and pre-selected
   *  after picking when exactly one matched (the user searched by hospital). */
  matchedOrgs: CustomerOrg[];
}

function customerDisplayName(c: { title?: string | null; name: string }) {
  return [c.title, c.name].filter(Boolean).join(" ");
}

function customerInitials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
}

// One option per customer — a customer with several organisations appears
// once; which organisation this DO is for is chosen after picking.
function buildCustomerOptions(rows: CustomerSearchRow[], query: string): CustomerOption[] {
  const q = query.trim().toLowerCase();
  return rows.slice(0, 12).map((c) => ({
    key: c.id,
    customer: c,
    matchedOrgs: c.companies.filter((o) => q && (o.organizationName ?? "").toLowerCase().includes(q)),
  }));
}

export function CaseCustomerPicker({
  onPick,
}: {
  onPick: (customer: CustomerSearchRow, preselectOrg: CustomerOrg | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<CustomerOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);

  const search = (val: string) => {
    setQuery(val);
    setOpen(true);
    if (timer.current) clearTimeout(timer.current);
    if (val.trim().length < 2) { setOptions([]); setLoading(false); return; }
    setLoading(true);
    const mySeq = ++seq.current;
    timer.current = setTimeout(async () => {
      try {
        const rows = await getCustomers(val.trim());
        if (mySeq !== seq.current) return; // a newer search superseded this one
        setOptions(buildCustomerOptions(rows, val));
        setActive(0);
      } catch {
        if (mySeq === seq.current) setOptions([]);
      } finally {
        if (mySeq === seq.current) setLoading(false);
      }
    }, 250);
  };

  const choose = (o: CustomerOption) => {
    const orgs = o.customer.companies;
    // Single org → it's the only choice. Several → pre-select only when the
    // search itself pinned one hospital down; otherwise the user picks next.
    const preselect = orgs.length === 1 ? orgs[0] : o.matchedOrgs.length === 1 ? o.matchedOrgs[0] : null;
    onPick(o.customer, preselect);
    setQuery(""); setOptions([]); setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || options.length === 0) {
      if (e.key === "Escape") setOpen(false);
      return;
    }
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(i + 1, options.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); choose(options[active]); }
    else if (e.key === "Escape") { setOpen(false); }
  };

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const showPanel = open && query.trim().length >= 2;

  return (
    <div className="relative">
      {/* Icons are centred against this wrapper, which holds ONLY the input —
          the hint line below must stay outside it or it shifts them down. */}
      <div className="relative">
      <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
      <Input
        value={query}
        onChange={(e) => search(e.target.value)}
        onFocus={() => setOpen(true)}
        // Delay so a click on an option registers before the panel closes
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKeyDown}
        placeholder="Search by customer, hospital, phone or email…"
        className="pl-9 pr-9 h-10 text-sm"
        role="combobox"
        aria-expanded={showPanel}
        aria-autocomplete="list"
        autoComplete="off"
      />
      {loading ? (
        <Loader2Icon className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground animate-spin" />
      ) : query ? (
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => { setQuery(""); setOptions([]); }}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          aria-label="Clear search"
        >
          <XIcon className="w-3.5 h-3.5" />
        </button>
      ) : null}
      </div>

      {!showPanel && query.length === 0 && (
        <p className="mt-1.5 text-[11px] text-muted-foreground">Type at least 2 characters to search by name, hospital, phone or email.</p>
      )}

      {showPanel && (
        <div
          ref={listRef}
          role="listbox"
          className="absolute z-20 top-full left-0 right-0 mt-1 max-h-80 overflow-y-auto bg-background border border-border rounded-lg shadow-lg"
        >
          {loading && options.length === 0 ? (
            <div className="px-3 py-3 text-xs text-muted-foreground flex items-center gap-2">
              <Loader2Icon className="w-3.5 h-3.5 animate-spin" /> Searching…
            </div>
          ) : options.length === 0 ? (
            <div className="px-3 py-3 text-xs text-muted-foreground">
              No customers match “{query.trim()}”.
            </div>
          ) : (
            options.map((o, i) => {
              const name = customerDisplayName(o.customer);
              const orgs = [...o.customer.companies].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));
              // Show the org that matched the search if any, else the primary
              const shownOrg = o.matchedOrgs[0] ?? orgs[0] ?? null;
              const moreOrgs = orgs.length - 1;
              const role = orgs.length === 1 ? [orgs[0].position, orgs[0].department].filter(Boolean).join(" · ") : "";
              return (
                <button
                  key={o.key}
                  type="button"
                  data-idx={i}
                  role="option"
                  aria-selected={i === active}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(o)}
                  className={cn(
                    "w-full text-left flex items-start gap-2.5 px-3 py-2.5 border-b border-border/40 last:border-0 transition-colors",
                    i === active ? "bg-muted/70" : "hover:bg-muted/40",
                  )}
                >
                  <div className="w-7 h-7 rounded-md bg-primary/10 text-primary text-[10px] font-semibold flex items-center justify-center shrink-0">
                    {customerInitials(o.customer.name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium leading-snug">
                      <Highlight text={name} query={query} />
                    </div>
                    {shownOrg ? (
                      <div className="flex items-center gap-1 text-[11px] text-foreground/80 mt-0.5 min-w-0">
                        <BuildingIcon className="w-3 h-3 shrink-0 text-muted-foreground" />
                        <span className="break-words"><Highlight text={shownOrg.organizationName ?? ""} query={query} /></span>
                        {moreOrgs > 0 && (
                          <span className="shrink-0 text-[9px] font-medium rounded bg-muted text-muted-foreground px-1 py-px">
                            +{moreOrgs} more
                          </span>
                        )}
                      </div>
                    ) : (
                      <div className="text-[11px] text-muted-foreground italic mt-0.5">No organisation on record</div>
                    )}
                    {(role || o.customer.contactNo) && (
                      <div className="text-[10px] text-muted-foreground mt-0.5 break-words">
                        {[role, o.customer.contactNo].filter(Boolean).join(" · ")}
                      </div>
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

// ── Case DO form ────────────────────────────────────────────────────────────

export interface CaseLineItem {
  _key: string;
  productId?: string;
  productCode: string;
  description: string;
  qty: string;
  uom: string;
  fromFieldStock?: boolean;
  fieldAvailable?: number;
  isRental?: boolean;
  loanOut?: boolean;
  // Rental-capable field-stock items can be split within one case: part of
  // the qty sold/consumed (in `qty`) and part loaned out (in `rentalQty`).
  // Only used for non-serial-tracked products — see `units` below.
  rentalQty?: string;
  // Serial-tracked products only: the specific units this rep currently
  // holds, each with a fixed Sale/Rental designation set in inventory (not
  // chosen here). When present, the qty/rentalQty split above is replaced
  // by a per-unit checklist — the user just picks which units were used.
  units?: { id: string; serialNo: string; intendedUse: string }[];
  selectedUnitIds?: string[];
  // Machines (loan-out): per selected rental unit, or for the bulk rental
  // qty — back the same day or left at the hospital, and the usage fee
  unitLoan?: Record<string, MachineLoan>;
  loan?: MachineLoan;
  // Part of fieldAvailable that is another company's stock on consignment
  // (used first or last per this company's consignment setting)
  consigned?: { sourceOrgName: string; qty: number; noTerms?: boolean }[];
  // How the customer copy prints this item (stock deducted stays this item)
  cust?: CustomerView;
  // User-defined item groups (picker headings; a product can be in several)
  itemGroupIds?: string[];
  // Selling price per unit (itemized pricing): set here or from the template;
  // undefined = the product's selling price
  unitPrice?: string;
  sellingPrice?: string | null;
}

// The price a line is charged per unit: what was entered, else the product's selling price
const priceOf = (i: CaseLineItem) => (i.unitPrice !== undefined ? i.unitPrice : i.sellingPrice ? String(Number(i.sellingPrice)) : "");

interface MachineLoan { purpose: "RENTAL" | "LOAN" | "DEMO"; mode: "same_day" | "stays"; charge: boolean; fee: string }
const defaultLoan = (): MachineLoan => ({ purpose: "RENTAL", mode: "same_day", charge: true, fee: "" });


// Per company asset, decided for this case: why it goes out (rental is
// usually charged, loan / demo usually free), whether it comes back with the
// specialist the same day, and the usage fee charged to the hospital, if any
function MachineLoanOptions({ value, onChange }: { value: MachineLoan; onChange: (v: MachineLoan) => void }) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-amber-200 dark:border-amber-800/60 bg-amber-50/50 dark:bg-amber-900/10 p-2">
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className="text-muted-foreground">Purpose</span>
        <div className="inline-flex rounded-md border border-border bg-background p-0.5">
          {(Object.keys(LOAN_PURPOSE_LABELS) as MachineLoan["purpose"][]).map((pp) => (
            <button key={pp} type="button"
              // rental is normally charged; a loan or demo normally isn't (either can be changed below)
              onClick={() => onChange({ ...value, purpose: pp, charge: pp === "RENTAL" })}
              className={cn("px-2.5 h-6 rounded", value.purpose === pp ? "bg-amber-100 dark:bg-amber-900/40 font-semibold text-amber-800 dark:text-amber-300" : "text-muted-foreground")}>
              {LOAN_PURPOSE_LABELS[pp]}
            </button>
          ))}
        </div>
      </div>
      <div className="inline-flex rounded-md border border-border bg-background p-0.5 text-[11px] w-fit">
        {(["same_day", "stays"] as const).map((m) => (
          <button key={m} type="button" onClick={() => onChange({ ...value, mode: m })}
            className={cn("px-2.5 h-6 rounded", value.mode === m ? "bg-amber-100 dark:bg-amber-900/40 font-semibold text-amber-800 dark:text-amber-300" : "text-muted-foreground")}>
            {m === "same_day" ? "Returned same day" : "Stays at hospital"}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={value.charge} onChange={(e) => onChange({ ...value, charge: e.target.checked })} /> Charge usage fee
        </label>
        {value.charge && (
          <span className="flex items-center gap-1">RM
            <Input type="number" min="0" step="0.01" placeholder="0.00" value={value.fee} onChange={(e) => onChange({ ...value, fee: e.target.value })} className="h-7 w-24 text-xs text-right" />
            <span className="text-muted-foreground">per case</span>
          </span>
        )}
      </div>
    </div>
  );
}

const newCaseLine = (): CaseLineItem => ({
  _key: uid(), productCode: "", description: "", qty: "1", uom: "",
});

// Defined at module level (not nested in CaseDoForm) so it doesn't get a new
// function identity — and get remounted, losing input focus — on every
// keystroke-triggered re-render of the parent form.
interface CaseExtraProductCellProps {
  item: CaseLineItem;
  onUpdate: (key: string, patch: Partial<CaseLineItem>) => void;
}

export function CaseExtraProductCell({ item, onUpdate }: CaseExtraProductCellProps) {
  const [q, setQ] = useState(item.productCode);
  const [results, setResults] = useState<{ id: string; productCode: string; description: string | null; uom: string | null }[]>([]);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleInput(val: string) {
    setQ(val);
    onUpdate(item._key, { productCode: val, productId: undefined });
    if (debounce.current) clearTimeout(debounce.current);
    if (!val.trim()) { setResults([]); return; }
    debounce.current = setTimeout(async () => {
      const r = await searchProducts(val);
      setResults(r);
      const exact = r.find((p) => p.productCode.toLowerCase() === val.trim().toLowerCase());
      if (exact) { onUpdate(item._key, { productId: exact.id, productCode: exact.productCode, description: item.description || exact.description || "", uom: exact.uom ?? "" }); setResults([]); }
    }, 300);
  }

  function pick(p: typeof results[0]) {
    onUpdate(item._key, { productId: p.id, productCode: p.productCode, description: item.description || p.description || "", uom: p.uom ?? "" });
    setQ(p.productCode); setResults([]);
  }

  return (
    <div className="relative">
      <Input value={q} onChange={(e) => handleInput(e.target.value)} className="h-7 text-xs" placeholder="Code / name…" />
      {results.length > 0 && (
        <div className="absolute z-50 top-full left-0 mt-0.5 w-56 rounded-md border border-border bg-background shadow-md max-h-40 overflow-y-auto text-xs">
          {results.map((p) => (
            <button key={p.id} type="button" className="w-full text-left px-2 py-1.5 hover:bg-accent flex gap-2" onClick={() => pick(p)}>
              <span className="font-mono font-medium">{p.productCode}</span>
              <span className="text-muted-foreground truncate">{p.description ?? ""}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Recording a two-step Case DO's actual items after the case: the same item
// picker as a new Case DO, for the DO's specialist, prefilled from its
// customer items and the doctor's template (machine choices)
export interface RecordCaseFor {
  doId: string; doNo: string;
  specialistId: string; specialistName: string;
  customerName: string | null; caseDate: string | null; caseDescription: string | null;
  items: { productId: string | null; productCode: string | null; description: string | null; qty: string; uom: string | null }[];
  template: CaseTemplateRow | null;
}

export function RecordCaseActualsForm(props: { recordFor: RecordCaseFor; categories?: DocumentCategoryRow[] }) {
  return <CaseDoForm categories={props.categories} recordFor={props.recordFor} />;
}

function CaseDoForm({ categories = [], currentUserId = "", currentUserName = "", recordFor }: { categories?: DocumentCategoryRow[]; currentUserId?: string; currentUserName?: string; recordFor?: RecordCaseFor }) {
  const router = useRouter();
  const isRecord = !!recordFor;

  const sessionTag = recordFor
    ? [{ id: recordFor.specialistId, name: recordFor.specialistName, isExt: false }]
    : currentUserId && currentUserName
    ? [{ id: currentUserId, name: currentUserName, isExt: false }]
    : [];

  // Reps / members
  const [reps, setReps] = useState<OrgMember[]>([]);
  const [loadingReps, setLoadingReps] = useState(true);

  // Application specialist (attends case, holds field stock) — tag input
  const [appSpecs, setAppSpecs] = useState<PersonTag[]>(sessionTag);
  const [asInput, setAsInput] = useState("");
  const asInputRef = useRef<HTMLInputElement>(null);
  const [loadingStock, setLoadingStock] = useState(false);

  // Sales person — tag input (members + external), mirrors quotation
  const [salesPersons, setSalesPersons] = useState<PersonTag[]>(sessionTag);
  const [spInput, setSpInput] = useState("");
  const spInputRef = useRef<HTMLInputElement>(null);
  // Ticked when the sales person is the same person as the application
  // specialist (the common case) — hides the separate sales person picker
  // entirely rather than making someone re-pick the same name twice; the
  // application specialist's own selection is used for both roles at submit.
  // On by default for a new Case DO — untick to pick a different sales person.
  const [salesPersonSameAsSpecialist, setSalesPersonSameAsSpecialist] = useState(true);

  // Case fields
  const [caseDate, setCaseDate] = useState(new Date().toISOString().split("T")[0]);
  const [mrnNo, setMrnNo] = useState("");

  // Customer
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [custCompanyId, setCustCompanyId] = useState<string | undefined>();

  function custAddress(cust: Customer | null, companyId: string | undefined): string {
    if (!cust) return "";
    const companies = (cust as any)?.companies ?? [];
    if (companyId) return companies.find((c: any) => c.id === companyId)?.organizationAddress ?? "";
    const primary = companies.find((c: any) => c.isPrimary) ?? companies[0];
    return primary?.organizationAddress ?? "";
  }

  // Items
  const [fieldPool, setFieldPool] = useState<CaseLineItem[]>([]);   // full stock list (read-only reference)
  const [fieldItems, setFieldItems] = useState<CaseLineItem[]>([]);  // user-selected items with qty
  const [extraItems, setExtraItems] = useState<CaseLineItem[]>([newCaseLine()]);
  // Customer items: what the customer copy shows and the invoice bills (from the
  // template). The actual items (field stock above, extras) are what was really
  // used — recorded after the case, or now if the case is already done.
  const [custItems, setCustItems] = useState<CaseLineItem[]>([newCaseLine()]);
  const [recordNow, setRecordNow] = useState(false);
  const showActual = isRecord || recordNow;
  const updateCustItem = (key: string, patch: Partial<CaseLineItem>) => setCustItems((prev) => prev.map((i) => (i._key === key ? { ...i, ...patch } : i)));
  // MDA of the customer items' products: one without a valid registration won't print on the customer copy
  const [mdaOf, setMdaOf] = useState<Record<string, { regNo: string | null; valid: boolean }>>({});
  const custProductKey = [...new Set(custItems.map((i) => i.productId).filter(Boolean))].sort().join(",");
  useEffect(() => {
    if (!custProductKey) return;
    let cancelled = false;
    getProductsMda(custProductKey.split(",")).then((m) => { if (!cancelled) setMdaOf((prev) => ({ ...prev, ...m })); }).catch(() => {});
    return () => { cancelled = true; };
  }, [custProductKey]);
  const noMda = (i: CaseLineItem) => !!i.productId && mdaOf[i.productId]?.valid === false;

  // The doctor's case templates: category + description + usual items
  const [caseDescription, setCaseDescription] = useState("");
  // Selling price: itemized (a price per item) or one total for the case — from the template, changeable
  const [priceMode, setPriceMode] = useState<"itemized" | "total">("itemized");
  const [casePrice, setCasePrice] = useState("");
  // Itemized total: sold / used qty × price (lent machines are charged their usage fee)
  const caseItemsTotal = () => custItems.reduce((sum, i) => sum + (parseFloat(i.qty || "0") || 0) * (parseFloat(priceOf(i)) || 0), 0);
  const caseFeesTotal = () => fieldItems.filter((i) => !custItems.some((c) => c.productId && c.productId === i.productId)).reduce((sum, i) => sum
    + Object.entries(i.unitLoan ?? {}).filter(([id, l]) => (i.selectedUnitIds ?? []).includes(id) && l.charge).reduce((a, [, l]) => a + (parseFloat(l.fee) || 0), 0)
    + ((parseFloat(i.rentalQty || "0") || 0) > 0 && i.loan?.charge ? parseFloat(i.loan.fee) || 0 : 0), 0);
  const [templates, setTemplates] = useState<CaseTemplateRow[]>([]);
  const [appliedTemplateId, setAppliedTemplateId] = useState<string | null>(null);
  const [tplSaving, setTplSaving] = useState<null | { name: string; overwrite: boolean }>(null);
  const [tplBusy, setTplBusy] = useState(false);

  // The doctor's default template fills the case in as soon as they're picked;
  // if the specialist's stock isn't loaded yet, it's applied once it is
  const pendingTemplate = useRef<CaseTemplateRow | null>(recordFor ? recordTemplateOf(recordFor) : null);
  const appliedTemplate = useRef<CaseTemplateRow | null>(null);
  // A doctor's templates can be per hospital: the hospital this DO is for
  // (customer organisation) decides which are offered and which default fills in
  function loadTemplates(customerId: string | null, hospitalId?: string | null, hospitalCount = 1) {
    setTemplates([]); setAppliedTemplateId(null); pendingTemplate.current = null; appliedTemplate.current = null;
    if (!customerId) return;
    getCaseTemplatesForCustomer(customerId).then((list) => {
      setTemplates(list);
      // several hospitals and none chosen yet: wait until one is
      if (!hospitalId && hospitalCount > 1 && list.some((t) => t.customerOrgId)) return;
      applyHospitalDefault(list, hospitalId ?? null);
    }).catch(() => setTemplates([]));
  }
  function applyHospitalDefault(list: CaseTemplateRow[], hospitalId: string | null) {
    const usable = list.filter((t) => !t.customerOrgId || t.customerOrgId === hospitalId);
    const def = usable.find((t) => t.isDefault && t.customerOrgId && t.customerOrgId === hospitalId)
      ?? usable.find((t) => t.isDefault && !t.customerOrgId)
      ?? (usable.length === 1 ? usable[0] : null);
    if (!def) return;
    if (repId && !loadingStock && fieldPool.length) applyTemplate(def, fieldPool, true);
    else {
      pendingTemplate.current = def; setAppliedTemplateId(def.id); setCategoryIds(matchCategories(def)); setCaseDescription(def.description ?? "");
      // the customer copy doesn't need the specialist's stock — fill it now
      applyTemplate(def, fieldPool, true);
    }
  }
  // membership (doctor at a hospital) → the hospital's id
  const hospitalOf = (cust: Customer | null, membershipId: string | undefined) =>
    ((cust as unknown as CustomerSearchRow | null)?.memberships ?? []).find((m) => m.id === membershipId)?.customerOrganizationId ?? null;
  const hospitalsOf = (cust: Customer | null) => ((cust as unknown as CustomerSearchRow | null)?.memberships ?? []);
  function clearCustomer() {
    setSelectedCustomer(null); setCustCompanyId(undefined); setDeliveryAddress(""); loadTemplates(null);
  }
  const onPickHospital = (e: React.MouseEvent<HTMLButtonElement>) => {
    const id = e.currentTarget.dataset.membership;
    if (id) pickHospital(id);
  };
  // switching hospital: its address, and its template default
  function pickHospital(membershipId: string) {
    setCustCompanyId(membershipId); setDeliveryAddress(custAddress(selectedCustomer, membershipId));
    if (membershipId !== custCompanyId) applyHospitalDefault(templates, hospitalOf(selectedCustomer, membershipId));
  }
  // the hospital this DO is for: the chosen membership's, or the doctor's only one
  const currentHospitalId = custCompanyId ? hospitalOf(selectedCustomer, custCompanyId)
    : hospitalsOf(selectedCustomer).length === 1 ? hospitalsOf(selectedCustomer)[0].customerOrganizationId : null;

  const matchCategories = (t: CaseTemplateRow) =>
    // matched by name: each company has its own categories
    categories.filter((c) => t.categoryNames.some((n) => n.toLowerCase() === c.name.toLowerCase())).map((c) => c.id);

  function applyTemplate(t: CaseTemplateRow, pool: CaseLineItem[] = fieldPool, auto = false) {
    appliedTemplate.current = t;
    if (!isRecord) {
      setAppliedTemplateId(t.id);
      setCategoryIds(matchCategories(t));
      setCaseDescription(t.description ?? "");
      setPriceMode(t.priceMode === "total" ? "total" : "itemized");
      setCasePrice(t.priceMode === "total" && t.totalPrice ? String(Number(t.totalPrice)) : "");
      // the customer copy: the template's items, as they are
      setCustItems(t.items.length ? t.items.map((it) => ({
        ...newCaseLine(), productId: it.productId ?? undefined, productCode: it.productCode ?? "", description: it.description ?? "",
        qty: it.qty, uom: it.uom ?? "",
        // its own price; a machine lent on the case is charged its usage fee (e.g. rental)
        unitPrice: it.unitPrice !== null && it.unitPrice !== undefined && it.unitPrice !== "" ? String(Number(it.unitPrice))
          : it.machineUse === "ASSET" && it.usageFee ? String(Number(it.usageFee)) : undefined,
      })) : [newCaseLine()]);
    }
    const picked: CaseLineItem[] = [];
    const notHeld: CaseLineItem[] = [];
    const short: string[] = []; // machines the specialist doesn't hold enough of, of the kind asked for
    for (const it of t.items) {
      const held = pool.find((p) => (it.productId && p.productId === it.productId) || (it.productCode && p.productCode === it.productCode));
      const unitPrice = it.unitPrice !== null && it.unitPrice !== undefined && it.unitPrice !== "" ? String(Number(it.unitPrice)) : undefined;
      const cust: CustomerView | undefined = it.custShow ? {
        custShow: it.custShow as CustomerView["custShow"], custProductId: it.custProductId, custCode: it.custCode, custDescription: it.custDescription,
        custQty: it.custQty, custUom: it.custUom, custReason: it.custReason,
      } : undefined;
      // the template's choices for a company asset going out
      const tplLoan = (): MachineLoan => ({
        purpose: (it.loanPurpose as MachineLoan["purpose"]) ?? "RENTAL", mode: it.loanReturnMode === "stays" ? "stays" : "same_day",
        charge: parseFloat(it.usageFee ?? "") > 0, fee: parseFloat(it.usageFee ?? "") > 0 ? String(it.usageFee) : "",
      });
      if (held) {
        if (held.units && held.units.length > 0) {
          // Pick this many units of the kind the template asks for (none asked: choose on the DO)
          const want = Math.max(1, Math.round(parseFloat(it.qty) || 1));
          const fits = it.machineUse === "ASSET" ? held.units.filter((u) => isLendable(u.intendedUse))
            : it.machineUse === "SALE" ? held.units.filter((u) => !isLendable(u.intendedUse)) : [];
          const chosen = fits.slice(0, want).map((u) => u.id);
          if (it.machineUse && chosen.length < want) short.push(`${held.productCode}: ${chosen.length} of ${want} ${it.machineUse === "ASSET" ? "company-asset" : "for-sale"} unit${want > 1 ? "s" : ""} held`);
          const unitLoan = Object.fromEntries(chosen.filter((id) => isLendable(held.units!.find((u) => u.id === id)?.intendedUse)).map((id) => [id, tplLoan()]));
          picked.push({ ...held, qty: "0", rentalQty: "0", selectedUnitIds: chosen, unitLoan, cust, unitPrice });
        } else {
          picked.push(held.isRental ? { ...held, qty: "0", rentalQty: it.qty, loan: it.machineUse === "ASSET" ? tplLoan() : defaultLoan(), cust, unitPrice } : { ...held, qty: it.qty, rentalQty: "0", cust, unitPrice });
        }
      } else {
        notHeld.push({ ...newCaseLine(), productId: it.productId ?? undefined, productCode: it.productCode ?? "", description: it.description ?? "", qty: it.qty, uom: it.uom ?? "", cust, unitPrice });
      }
    }
    if (short.length) toast.warning(`Not enough machines of the kind in the template — ${short.join("; ")}. Pick them on the DO.`, { duration: 9000 });
    setFieldItems(picked);
    setExtraItems(notHeld.length ? notHeld : [newCaseLine()]);
    const label = isRecord ? "Filled in from the customer items" : auto ? `Filled in from ${t.doctorName}'s default "${t.name}"` : `Applied "${t.name}"`;
    if (!isRecord && !recordNow) { toast.success(label); return; }
    if (notHeld.length) toast.info(`${label} — ${notHeld.map((n) => n.productCode || n.description).join(", ")} not in ${selectedRep?.name ?? "the specialist"}'s holding, added under Additional items`);
    else toast.success(`${label}${picked.some((p) => p.units?.length && !p.selectedUnitIds?.length) ? " — pick the serial number(s) for machines" : ""}`);
  }

  async function saveTemplate() {
    if (!selectedCustomer || !tplSaving) return;
    // Machines: the kind of unit picked (when all picked are the same kind) and how a company asset went out
    const machineOf = (i: CaseLineItem) => {
      const sel = (i.selectedUnitIds ?? []).map((id) => i.units?.find((u) => u.id === id)).filter(Boolean) as NonNullable<CaseLineItem["units"]>[number][];
      const kinds = new Set(sel.map((u) => (isLendable(u.intendedUse) ? "ASSET" : "SALE")));
      const machineUse = kinds.size === 1 ? ([...kinds][0] as "ASSET" | "SALE") : null;
      const l = machineUse === "ASSET" ? i.unitLoan?.[sel[0].id] : (parseFloat(i.rentalQty || "0") || 0) > 0 ? i.loan : undefined;
      return {
        machineUse: machineUse ?? (l ? "ASSET" as const : null),
        loanPurpose: l?.purpose ?? null, loanReturnMode: l?.mode ?? null, usageFee: l?.charge && parseFloat(l.fee) > 0 ? l.fee : null,
      };
    };
    // the customer items, with the machine choices of the matching actual picks
    const items = custItems.filter((i) => i.description || i.productCode).map((i) => {
      const used = fieldItems.find((f) => f.productId && f.productId === i.productId);
      return { productId: i.productId, productCode: i.productCode, description: i.description, uom: i.uom, qty: i.qty || "1", unitPrice: priceOf(i) || null, ...(used ? machineOf(used) : {}) };
    });
    setTplBusy(true);
    try {
      const res = await saveCaseTemplate({
        id: tplSaving.overwrite && appliedTemplateId ? appliedTemplateId : undefined,
        customerId: selectedCustomer.id, customerOrgId: currentHospitalId, name: tplSaving.name, categoryIds, description: caseDescription, items,
        priceMode, totalPrice: priceMode === "total" ? casePrice : null,
      });
      if (!res.ok) { toast.error(res.title); return; }
      toast.success(`Template "${tplSaving.name}" saved`);
      setTplSaving(null);
      setAppliedTemplateId(res.id);
      setTemplates(await getCaseTemplatesForCustomer(selectedCustomer.id));
    } finally { setTplBusy(false); }
  }

  // Other
  const [customerPoNo, setCustomerPoNo] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [categoryIds, setCategoryIds] = useState<string[]>(() =>
    categories.filter((c) => c.isDefault).map((c) => c.id),
  );
  const [saving, setSaving] = useState(false);

  // Field stock picker under the user's item groups. A group named like the
  // chosen case type (e.g. "milh" for a MILH case) comes first and open; the
  // other groups start folded, so the eye goes to what this case usually uses.
  const [itemGroups, setItemGroups] = useState<ItemGroupRow[]>([]);
  const [groupOpen, setGroupOpen] = useState<Record<string, boolean>>({});

  useEffect(() => {
    getFieldReps().then((r) => { setReps(r); setLoadingReps(false); }).catch(() => setLoadingReps(false));
    getItemGroups().then(setItemGroups).catch(() => setItemGroups([]));
  }, []);
  const caseNames = categories.filter((c) => categoryIds.includes(c.id)).map((c) => c.name.trim().toLowerCase());
  const caseKey = caseNames.join(",");
  // Each item once: under the case-type group when it's in one, else its first group
  const matchIds = itemGroups.filter((g) => caseNames.includes(g.name.trim().toLowerCase())).map((g) => g.id);
  const poolSections = groupSections(fieldPool, (i) => i.itemGroupIds, itemGroups, { prefer: matchIds })
    .map((x) => ({ ...x, match: matchIds.includes(x.key) }))
    // matching the case type first, then the users' order
    .sort((a, b) => Number(b.match) - Number(a.match));
  const anyMatch = poolSections.some((x) => x.match);
  // The items picked as used, under the same group headings and order as the list above
  const poolOrder = new Map(poolSections.flatMap((x) => x.items).map((it, k) => [it.productId, k]));
  const pickedSections = groupSections(
    [...fieldItems].sort((a, b) => (poolOrder.get(a.productId) ?? 1e9) - (poolOrder.get(b.productId) ?? 1e9)),
    (i) => i.itemGroupIds, itemGroups, { prefer: matchIds },
  ).map((x) => ({ ...x, match: matchIds.includes(x.key) })).sort((a, b) => Number(b.match) - Number(a.match));
  const isGroupOpen = (sec: { key: string; match: boolean }) => groupOpen[`${caseKey}|${sec.key}`] ?? (!anyMatch || sec.match);
  const toggleGroup = (sec: { key: string; match: boolean }) => setGroupOpen((o) => ({ ...o, [`${caseKey}|${sec.key}`]: !isGroupOpen(sec) }));

  const repId = appSpecs.find((s) => !s.isExt)?.id ?? "";

  useEffect(() => {
    if (!repId) { setFieldPool([]); setFieldItems([]); return; }
    setLoadingStock(true);
    getRepFieldStock(repId).then((stock) => {
      const pool: CaseLineItem[] = stock.map((s) => ({
        _key: uid(),
        productId: s.productId,
        productCode: s.productCode,
        description: s.description,
        qty: "0",
        rentalQty: "0",
        uom: s.uom ?? "",
        fromFieldStock: true,
        fieldAvailable: s.qty,
        isRental: s.isRental,
        units: s.units,
        selectedUnitIds: [],
        consigned: s.consignedBreakdown?.map((c) => ({ sourceOrgName: c.sourceOrgName, qty: c.qty, noTerms: c.noTerms })),
        itemGroupIds: s.itemGroupIds ?? [],
        sellingPrice: s.sellingPrice ?? null,
      }));
      setFieldPool(pool);
      setFieldItems([]);
      // A doctor's default template picked before the specialist: fill the items now
      // (or the specialist changed after a template was applied: re-fill from the new holding)
      const pending = pendingTemplate.current ?? appliedTemplate.current;
      // (waits for a specialist who actually holds stock — an empty holding would push every item to "Additional items")
      if (pending && pool.length) { pendingTemplate.current = null; applyTemplate(pending, pool, true); }
      else if (pending) pendingTemplate.current = pending;
    }).catch(() => { setFieldPool([]); setFieldItems([]); }).finally(() => setLoadingStock(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repId]);

  function toggleFieldItem(poolItem: CaseLineItem) {
    const already = fieldItems.some((i) => i.productId === poolItem.productId);
    if (already) {
      setFieldItems((prev) => prev.filter((i) => i.productId !== poolItem.productId));
    } else {
      setFieldItems((prev) => [
        ...prev,
        poolItem.units && poolItem.units.length > 0
          // Serial-tracked: no default qty/split — the user picks specific units below.
          ? { ...poolItem, qty: "0", rentalQty: "0", selectedUnitIds: [] }
          // Rental-capable (bulk): defaults to fully on loan (matches prior
          // behavior); the user can move some qty into "Sell" afterwards.
          : poolItem.isRental ? { ...poolItem, qty: "0", rentalQty: "1", loan: defaultLoan() } : { ...poolItem, qty: "1", rentalQty: "0" },
      ]);
    }
  }

  function toggleUnitSelection(itemKey: string, unitId: string) {
    setFieldItems((prev) => prev.map((i) => {
      if (i._key !== itemKey) return i;
      const selected = i.selectedUnitIds ?? [];
      const nextSelected = selected.includes(unitId) ? selected.filter((id) => id !== unitId) : [...selected, unitId];
      const unitLoan = { ...(i.unitLoan ?? {}) };
      if (!unitLoan[unitId]) unitLoan[unitId] = defaultLoan();
      return { ...i, selectedUnitIds: nextSelected, unitLoan };
    }));
  }

  function updateFieldItem(key: string, patch: Partial<CaseLineItem>) {
    setFieldItems((prev) => prev.map((i) => i._key === key ? { ...i, ...patch } : i));
  }

  function updateExtraItem(key: string, patch: Partial<CaseLineItem>) {
    setExtraItems((prev) => prev.map((i) => i._key === key ? { ...i, ...patch } : i));
  }


  const selectedRep = reps.find((r) => r.id === repId);

  async function handleSave() {
    if (appSpecs.length === 0) { toast.error("Select the application specialist"); return; }
    if (!isRecord && selectedCustomer && ((selectedCustomer as unknown as CustomerSearchRow).companies?.length ?? 0) > 1 && !custCompanyId) {
      toast.error("Select which organisation this DO is for"); return;
    }
    const customerItems = custItems.filter((i) => i.description || i.productCode).map((i) => ({
      productId: i.productId ?? null, productCode: i.productCode || null, description: i.description || null, qty: i.qty || "1", uom: i.uom || null,
      unitPrice: priceMode === "itemized" ? priceOf(i) || null : null,
    }));
    if (!isRecord && customerItems.length === 0) { toast.error("Add the items for the customer copy (or pick the doctor's template)"); return; }
    if (!isRecord && priceMode === "itemized" && custItems.some(noMda)) { toast.error(pricedWithoutMdaMessage(custItems.filter(noMda).map((i) => i.productCode)), { duration: 12000 }); return; }
    const usedFieldItems = (showActual ? fieldItems : []).filter((i) =>
      i.units && i.units.length > 0
        ? (i.selectedUnitIds ?? []).length > 0
        : (parseFloat(i.qty || "0") || 0) + (parseFloat(i.rentalQty || "0") || 0) > 0
    );
    const validExtras = showActual ? extraItems.filter((i) => i.description || i.productCode) : [];
    if (showActual && usedFieldItems.length === 0 && validExtras.length === 0) {
      toast.error("Select at least one item actually used"); return;
    }

    // A machine charged a usage fee needs the amount
    const loans = usedFieldItems.flatMap((i) => i.units && i.units.length > 0
      ? (i.selectedUnitIds ?? []).filter((u) => isLendable(i.units!.find((x) => x.id === u)?.intendedUse)).map((u) => ({ code: i.productCode, l: i.unitLoan?.[u] }))
      : (parseFloat(i.rentalQty || "0") || 0) > 0 ? [{ code: i.productCode, l: i.loan }] : []);
    const noFee = loans.find((x) => x.l?.charge && !(parseFloat(x.l.fee) > 0));
    if (noFee) { toast.error(`Enter the usage fee for ${noFee.code}, or untick "Charge usage fee"`); return; }
    if (priceMode === "total" && !(parseFloat(casePrice) >= 0)) { toast.error("Enter the total price for the case, or choose itemized pricing"); return; }
    const loanFields = (l?: MachineLoan) => ({ loanPurpose: l?.purpose ?? "RENTAL", loanReturnMode: l?.mode ?? "same_day", usageFee: l?.charge ? l.fee : undefined });

    // A rental-capable item can be split across one case: part sold/consumed
    // and part loaned out. Each portion becomes its own DO line so the
    // server records the right movement type (CASE_USE vs LOAN_OUT) for each.
    // Serial-tracked items fan out one line per selected physical unit
    // instead — the server derives loanOut from that unit's own fixed
    // intendedUse (set in inventory), ignoring whatever we send here.
    const fieldOrderItems: Omit<DeliveryOrderItemInput, "rowNo">[] = [];
    for (const i of usedFieldItems) {
      if (i.units && i.units.length > 0) {
        for (const unitId of i.selectedUnitIds ?? []) {
          const unit = i.units.find((u) => u.id === unitId);
          const isLoan = isLendable(unit?.intendedUse);
          fieldOrderItems.push({ productId: i.productId, productCode: i.productCode, description: i.description, qty: "1", uom: i.uom, loanOut: isLoan, unitId, ...(isLoan ? loanFields(i.unitLoan?.[unitId]) : {}), ...(i.cust ?? {}), ...(isLoan ? {} : { unitPrice: priceOf(i) }) });
        }
        continue;
      }
      const sellQty = parseFloat(i.qty || "0") || 0;
      const rentalQty = parseFloat(i.rentalQty || "0") || 0;
      if (sellQty > 0) {
        fieldOrderItems.push({ productId: i.productId, productCode: i.productCode, description: i.description, qty: String(sellQty), uom: i.uom, loanOut: false, ...(i.cust ?? {}), unitPrice: priceOf(i) });
      }
      if (rentalQty > 0) {
        fieldOrderItems.push({ productId: i.productId, productCode: i.productCode, description: i.description, qty: String(rentalQty), uom: i.uom, loanOut: true, ...loanFields(i.loan), ...(i.cust ?? {}) });
      }
    }

    const allItems: DeliveryOrderItemInput[] = [
      ...fieldOrderItems.map((i, idx) => ({ ...i, rowNo: idx + 1 })),
      ...validExtras.map((i, idx) => ({
        rowNo: fieldOrderItems.length + idx + 1, productId: i.productId, productCode: i.productCode,
        description: i.description, qty: i.qty || "1", uom: i.uom,
        loanOut: i.loanOut, ...(i.cust ?? {}), unitPrice: priceOf(i),
      })),
    ];

    if (isRecord) {
      setSaving(true);
      try {
        const res = await recordCaseActuals(recordFor!.doId, allItems);
        if (!res.ok) { toast.error(res.title, { duration: 10000 }); return; }
        toast.success("Actual items recorded — stock deducted; the internal copy is ready");
        router.push(`/dashboard/fulfillment/delivery/${recordFor!.doId}`);
      } finally { setSaving(false); }
      return;
    }

    setSaving(true);
    try {
      const effectiveSalesPersons = salesPersonSameAsSpecialist ? appSpecs : salesPersons;
      const primarySp = effectiveSalesPersons.find((s) => !s.isExt) ?? effectiveSalesPersons[0];
      const primaryAs = appSpecs.find((s) => !s.isExt) ?? appSpecs[0];
      await createDeliveryOrder({
        customerId: selectedCustomer?.id,
        customerOrgMemberId: custCompanyId || undefined,
        customerPoNo: customerPoNo || undefined,
        deliveryAddress: deliveryAddress || undefined,
        notes: notes || undefined,
        categoryIds: categoryIds.length > 0 ? categoryIds : undefined,
        items: allItems,
        customerItems,
        isCaseDo: true,
        priceMode, casePrice: priceMode === "total" ? casePrice : undefined,
        salesPersonId: primarySp?.isExt ? undefined : primarySp?.id,
        salesPersonName: primarySp?.name,
        applicationSpecialistId: primaryAs?.isExt ? undefined : primaryAs?.id,
        applicationSpecialistName: primaryAs?.name,
        caseDate: caseDate ? new Date(caseDate) : undefined,
        mrnNo: mrnNo || undefined,
        caseDescription: caseDescription.trim() || undefined,
        caseTemplateId: appliedTemplateId ?? undefined,
      });
      toast.success(recordNow ? "Case DO created — actual items recorded" : "Case DO created — record the actual items on the DO page after the case");
      router.push("/dashboard/fulfillment/delivery");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <PageHeader
        title={isRecord ? `Record actual items — ${recordFor!.doNo}` : "New Case DO"}
        description={isRecord
          ? "After the case: tick what was actually used from the specialist's field stock. Stock is deducted when you record."
          : "Customer items (from the doctor's template) go on the customer copy and the invoice; the items actually used are recorded after the case."}
        action={
          <Button variant="outline" size="sm" onClick={() => router.back()} className="gap-1.5">
            <ArrowLeftIcon className="w-3.5 h-3.5" /> Back
          </Button>
        }
      />

      {isRecord && (
        <section className="border border-border rounded-xl p-4 text-sm grid gap-1 sm:grid-cols-2">
          <div><span className="text-muted-foreground">Doctor:</span> {recordFor!.customerName ?? "—"}</div>
          <div><span className="text-muted-foreground">Case date:</span> {recordFor!.caseDate ? new Date(recordFor!.caseDate).toLocaleDateString("en-GB") : "—"}</div>
          <div><span className="text-muted-foreground">Specialist:</span> {recordFor!.specialistName}</div>
          <div className="sm:col-span-2"><span className="text-muted-foreground">Customer copy items:</span> {recordFor!.items.map((i) => `${i.productCode || i.description} × ${Number(i.qty)}`).join(", ") || "—"}</div>
        </section>
      )}
      {!isRecord && (<>
      {/* Case details */}
      <section className="border border-border rounded-xl p-4">
        <h2 className="text-sm font-semibold mb-3">Case details</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Case date <span className="text-destructive">*</span></Label>
            <input type="date" value={caseDate} onChange={(e) => setCaseDate(e.target.value)}
              className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">MRN no.</Label>
            <Input value={mrnNo} onChange={(e) => setMrnNo(e.target.value)} placeholder="Medical record number" className="h-9 text-sm" />
          </div>
        </div>
        <div className="mt-3 space-y-1.5">
          <Label className="text-xs">Categories</Label>
          {categories.length === 0 ? (
            <p className="text-xs text-muted-foreground italic py-1">No categories yet — create one in Organization → Categories</p>
          ) : (
            <div className="flex flex-wrap gap-2 pt-0.5">
              {categories.map((c) => {
                const selected = categoryIds.includes(c.id);
                const hex = c.color ?? "#6366f1";
                return (
                  <button key={c.id} type="button"
                    onClick={() => setCategoryIds((prev) => selected ? prev.filter((id) => id !== c.id) : [...prev, c.id])}
                    className={cn("inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold border-2 transition-all select-none",
                      selected ? "text-white shadow-sm" : "bg-background text-foreground/70 hover:text-foreground")}
                    style={selected ? { backgroundColor: hex, borderColor: hex } : { borderColor: hex + "55" }}
                  >
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: selected ? "rgba(255,255,255,0.8)" : hex }} />
                    {c.name}
                    {selected && <span className="ml-0.5 opacity-80">✓</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* Personnel */}
      <section className="border border-border rounded-xl p-4">
        <h2 className="text-sm font-semibold mb-3">Personnel</h2>
        {loadingReps ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="space-y-3">
            {/* Application specialist */}
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-muted-foreground">application specialist <span className="text-destructive">*</span></label>
              <div
                className="min-h-9 rounded-md border border-input bg-background px-2 py-1.5 flex flex-wrap gap-1.5 items-center cursor-text focus-within:ring-2 focus-within:ring-ring/20 focus-within:border-ring transition-colors"
                onClick={() => asInputRef.current?.focus()}
              >
                {appSpecs.map((s) => (
                  <span key={s.id} className="inline-flex items-center gap-1 text-xs bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300 rounded px-2 py-0.5 shrink-0">
                    {s.name.toLowerCase()}
                    {s.isExt && <span className="relative -top-0.5 text-[8px] font-bold leading-none">ext</span>}
                    {s.otherOrgName && (
                      <span className="relative -top-0.5 text-[8px] font-medium leading-none opacity-70">{s.otherOrgName}</span>
                    )}
                    <button type="button"
                      onClick={(e) => { e.stopPropagation(); setAppSpecs((prev) => prev.filter((x) => x.id !== s.id)); }}
                      className="text-blue-500/60 hover:text-blue-700 ml-0.5">
                      <XIcon className="w-3 h-3" />
                    </button>
                  </span>
                ))}
                <select value="" onClick={(e) => e.stopPropagation()}
                  onChange={(e) => {
                    const r = reps.find((x) => x.id === e.target.value);
                    if (!r) return;
                    if (appSpecs.some((s) => s.id === r.id || s.name.toLowerCase() === r.name.toLowerCase())) return;
                    setAppSpecs((prev) => [...prev, { id: r.id, name: r.name, isExt: false, otherOrgName: r.otherOrgName }]);
                  }}
                  className="h-6 text-xs bg-transparent border-0 outline-none text-muted-foreground cursor-pointer">
                  <option value="">+ member</option>
                  {reps.filter((r) => !appSpecs.some((s) => s.id === r.id || s.name.toLowerCase() === r.name.toLowerCase())).map((r) => (
                    <option key={r.id} value={r.id}>{r.name.toLowerCase()}{r.otherOrgName ? ` — ${r.otherOrgName}` : ""}</option>
                  ))}
                </select>
                <input ref={asInputRef} type="text" value={asInput}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val.includes(",")) {
                      const parts = val.split(",");
                      const toAdd = parts.slice(0, -1).map((p) => p.trim()).filter(Boolean);
                      if (toAdd.length) {
                        const repNames = new Set(reps.map((r) => r.name.toLowerCase()));
                        const blocked = toAdd.filter((n) => repNames.has(n.toLowerCase()));
                        if (blocked.length) { toast.error(`"${blocked.join('", "')}" is a member — select from the member list`); }
                        const t = Date.now();
                        setAppSpecs((prev) => {
                          const existing = new Set(prev.map((s) => s.name.toLowerCase()));
                          const unique = toAdd.filter((n) => !existing.has(n.toLowerCase()) && !repNames.has(n.toLowerCase()));
                          return unique.length ? [...prev, ...unique.map((name, i) => ({ id: `ext-${t}-${i}`, name, isExt: true }))] : prev;
                        });
                      }
                      setAsInput(parts[parts.length - 1].trimStart());
                    } else {
                      setAsInput(val);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Backspace" && !asInput && appSpecs.length > 0) {
                      setAppSpecs((prev) => prev.slice(0, -1));
                      return;
                    }
                    if (e.key === "Enter") {
                      e.preventDefault();
                      if (!asInput.trim()) return;
                      const names = asInput.split(",").map((p) => p.trim()).filter(Boolean);
                      const repNames = new Set(reps.map((r) => r.name.toLowerCase()));
                      const blocked = names.filter((n) => repNames.has(n.toLowerCase()));
                      if (blocked.length) { toast.error(`"${blocked.join('", "')}" is a member — select from the member list`); return; }
                      const t = Date.now();
                      setAppSpecs((prev) => {
                        const existing = new Set(prev.map((s) => s.name.toLowerCase()));
                        const unique = names.filter((n) => !existing.has(n.toLowerCase()));
                        return unique.length ? [...prev, ...unique.map((name, i) => ({ id: `ext-${t}-${i}`, name, isExt: true }))] : prev;
                      });
                      setAsInput("");
                    }
                  }}
                  placeholder={appSpecs.length === 0 ? "Type a name… (Enter or , to add)" : ""}
                  className="flex-1 min-w-24 h-6 bg-transparent outline-none text-sm placeholder:text-muted-foreground"
                />
              </div>
              <p className="text-[11px] text-muted-foreground">Attends the case · carries field stock (first member drives field stock)</p>
            </div>

            {/* Sales person */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-3">
                <label className="block text-xs font-medium text-muted-foreground">sales person</label>
                <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={salesPersonSameAsSpecialist}
                    onChange={(e) => setSalesPersonSameAsSpecialist(e.target.checked)}
                    className="h-3 w-3 rounded"
                  />
                  Same as application specialist
                </label>
              </div>
              {salesPersonSameAsSpecialist ? (
                <p className="text-xs text-muted-foreground italic px-1">
                  Using {appSpecs.length > 0 ? appSpecs.map((s) => s.name.toLowerCase()).join(", ") : "the application specialist"} as sales person too.
                </p>
              ) : (
              <div
                className="min-h-9 rounded-md border border-input bg-background px-2 py-1.5 flex flex-wrap gap-1.5 items-center cursor-text focus-within:ring-2 focus-within:ring-ring/20 focus-within:border-ring transition-colors"
                onClick={() => spInputRef.current?.focus()}
              >
                {salesPersons.map((s) => (
                  <span key={s.id} className="inline-flex items-center gap-1 text-xs bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300 rounded px-2 py-0.5 shrink-0">
                    {s.name.toLowerCase()}
                    {s.isExt && <span className="relative -top-0.5 text-[8px] font-bold leading-none">ext</span>}
                    {s.otherOrgName && (
                      <span className="relative -top-0.5 text-[8px] font-medium leading-none opacity-70">{s.otherOrgName}</span>
                    )}
                    <button type="button"
                      onClick={(e) => { e.stopPropagation(); setSalesPersons((prev) => prev.filter((x) => x.id !== s.id)); }}
                      className="text-blue-500/60 hover:text-blue-700 ml-0.5">
                      <XIcon className="w-3 h-3" />
                    </button>
                  </span>
                ))}
                <select value="" onClick={(e) => e.stopPropagation()}
                  onChange={(e) => {
                    const r = reps.find((x) => x.id === e.target.value);
                    if (!r) return;
                    if (salesPersons.some((s) => s.id === r.id || s.name.toLowerCase() === r.name.toLowerCase())) return;
                    setSalesPersons((prev) => [...prev, { id: r.id, name: r.name, isExt: false, otherOrgName: r.otherOrgName }]);
                  }}
                  className="h-6 text-xs bg-transparent border-0 outline-none text-muted-foreground cursor-pointer">
                  <option value="">+ member</option>
                  {reps.filter((r) => !salesPersons.some((s) => s.id === r.id || s.name.toLowerCase() === r.name.toLowerCase())).map((r) => (
                    <option key={r.id} value={r.id}>{r.name.toLowerCase()}{r.otherOrgName ? ` — ${r.otherOrgName}` : ""}</option>
                  ))}
                </select>
                <input ref={spInputRef} type="text" value={spInput}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val.includes(",")) {
                      const parts = val.split(",");
                      const toAdd = parts.slice(0, -1).map((p) => p.trim()).filter(Boolean);
                      if (toAdd.length) {
                        const repNames = new Set(reps.map((r) => r.name.toLowerCase()));
                        const blocked = toAdd.filter((n) => repNames.has(n.toLowerCase()));
                        if (blocked.length) { toast.error(`"${blocked.join('", "')}" is a member — select from the member list`); }
                        const t = Date.now();
                        setSalesPersons((prev) => {
                          const existing = new Set(prev.map((s) => s.name.toLowerCase()));
                          const unique = toAdd.filter((n) => !existing.has(n.toLowerCase()) && !repNames.has(n.toLowerCase()));
                          return unique.length ? [...prev, ...unique.map((name, i) => ({ id: `ext-${t}-${i}`, name, isExt: true }))] : prev;
                        });
                      }
                      setSpInput(parts[parts.length - 1].trimStart());
                    } else {
                      setSpInput(val);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Backspace" && !spInput && salesPersons.length > 0) {
                      setSalesPersons((prev) => prev.slice(0, -1));
                      return;
                    }
                    if (e.key === "Enter") {
                      e.preventDefault();
                      if (!spInput.trim()) return;
                      const names = spInput.split(",").map((p) => p.trim()).filter(Boolean);
                      const repNames = new Set(reps.map((r) => r.name.toLowerCase()));
                      const blocked = names.filter((n) => repNames.has(n.toLowerCase()));
                      if (blocked.length) { toast.error(`"${blocked.join('", "')}" is a member — select from the member list`); return; }
                      const t = Date.now();
                      setSalesPersons((prev) => {
                        const existing = new Set(prev.map((s) => s.name.toLowerCase()));
                        const unique = names.filter((n) => !existing.has(n.toLowerCase()));
                        return unique.length ? [...prev, ...unique.map((name, i) => ({ id: `ext-${t}-${i}`, name, isExt: true }))] : prev;
                      });
                      setSpInput("");
                    }
                  }}
                  placeholder={salesPersons.length === 0 ? "Type a name… (Enter or , to add)" : ""}
                  className="flex-1 min-w-24 h-6 bg-transparent outline-none text-sm placeholder:text-muted-foreground"
                />
              </div>
              )}
            </div>
          </div>
        )}
      </section>

      {/* Customer */}
      <section className="border border-border rounded-xl p-4">
        <h2 className="text-sm font-semibold mb-3">Customer</h2>
        {selectedCustomer ? (() => {
          const cust = selectedCustomer as unknown as CustomerSearchRow;
          const companies = [...(cust.companies ?? [])].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));
          // Several orgs → nothing is assumed; the user must pick one below.
          const effectiveOrgId = custCompanyId ?? (companies.length === 1 ? companies[0].id : undefined);
          const org = companies.find((c) => c.id === effectiveOrgId) ?? null;
          const needsOrg = companies.length > 1 && !org;
          const role = [org?.position, org?.department].filter(Boolean).join(" · ");
          return (
            <div className={cn("rounded-lg border p-3", needsOrg ? "border-amber-300 bg-amber-50/60 dark:border-amber-800 dark:bg-amber-950/20" : "border-primary/20 bg-primary/5")}>
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary text-xs font-semibold flex items-center justify-center shrink-0">
                  {customerInitials(cust.name)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold leading-snug break-words">{customerDisplayName(cust)}</div>
                  {org && (
                    <div className="flex items-center gap-1 text-xs text-foreground/80 mt-0.5">
                      <BuildingIcon className="w-3 h-3 shrink-0 text-muted-foreground" />
                      <span className="break-words">{org.organizationName}</span>
                    </div>
                  )}
                  {role && <div className="text-[11px] text-muted-foreground mt-0.5">{role}</div>}
                  {(cust.contactNo || cust.email) && (
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-[11px] text-muted-foreground">
                      {cust.contactNo && <span className="inline-flex items-center gap-1"><PhoneIcon className="w-3 h-3" />{cust.contactNo}</span>}
                      {cust.email && <span className="inline-flex items-center gap-1 min-w-0"><MailIcon className="w-3 h-3 shrink-0" /><span className="truncate">{cust.email}</span></span>}
                    </div>
                  )}
                </div>
                <Button
                  type="button" variant="outline" size="sm" className="h-7 text-xs shrink-0"
                  onClick={clearCustomer}
                >
                  Change
                </Button>
              </div>

              {/* Hospital switcher — only when the customer belongs to several */}
              {companies.length > 1 && (
                <div className="mt-3 pt-3 border-t border-primary/15">
                  <div className={cn("text-[11px] mb-1.5", needsOrg ? "font-medium text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>
                    {needsOrg
                      ? `Select the organisation for this DO — ${customerDisplayName(cust)} belongs to ${companies.length}:`
                      : "Delivering to which organisation?"}
                  </div>
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    {companies.map((c) => {
                      const isSel = c.id === effectiveOrgId;
                      return (
                        <button
                          key={c.id}
                          type="button"
                          data-membership={c.id}
                          onClick={onPickHospital}
                          className={cn(
                            "text-left rounded-md border px-2.5 py-2 text-xs transition-colors",
                            isSel ? "border-primary bg-background ring-1 ring-primary/30" : "border-border bg-background/60 hover:bg-background",
                          )}
                        >
                          <div className="flex items-start gap-1.5">
                            <span className={cn("mt-0.5 w-3 h-3 rounded-full border shrink-0", isSel ? "border-primary bg-primary ring-2 ring-primary/20 ring-offset-1 ring-offset-background" : "border-muted-foreground/40")} />
                            <div className="min-w-0">
                              <div className={cn("leading-snug break-words", isSel && "font-medium")}>{c.organizationName}</div>
                              {c.isPrimary && <div className="text-[10px] text-muted-foreground">primary</div>}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })() : (
          <CaseCustomerPicker
            onPick={(c, org) => {
              setSelectedCustomer(c as unknown as Customer);
              setCustCompanyId(org?.id);
              {
                const cust = c as unknown as Customer | null;
                const hs = hospitalsOf(cust);
                loadTemplates(cust?.id ?? null, org ? hospitalOf(cust, org.id) : hs.length === 1 ? hs[0].customerOrganizationId : null, hs.length);
              }
              // Fill the address only once the organisation is known
              setDeliveryAddress(org ? custAddress(c as unknown as Customer, org.id) : "");
            }}
          />
        )}
        {selectedCustomer && (
          <div className="mt-3 rounded-lg border border-border bg-muted/20 p-3 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-medium">Case templates for {[(selectedCustomer as any).title, (selectedCustomer as any).name].filter(Boolean).join(" ")}</span>
              {!tplSaving && (
                <button type="button" className="text-[11px] underline text-muted-foreground hover:text-foreground"
                  onClick={() => setTplSaving({ name: templates.find((t) => t.id === appliedTemplateId)?.name ?? "", overwrite: !!appliedTemplateId })}>
                  Save this case as a template
                </button>
              )}
            </div>
            {templates.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">No templates yet — fill in the case below and save it as a template for next time.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {templates.filter((t) => !t.customerOrgId || t.customerOrgId === currentHospitalId).map((t) => (
                  <button key={t.id} type="button" onClick={() => applyTemplate(t)} title={t.description ?? undefined}
                    className={cn("text-xs rounded-md border px-2.5 py-1 transition-colors",
                      appliedTemplateId === t.id ? "border-primary bg-primary/10 font-medium" : "border-border bg-background hover:bg-muted")}>
                    {t.name}<span className="ml-1.5 text-muted-foreground">{t.items.length} item{t.items.length === 1 ? "" : "s"}{t.hospitalName ? ` · ${t.hospitalName}` : ""}</span>
                  </button>
                ))}
              </div>
            )}
            {tplSaving && (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Input value={tplSaving.name} onChange={(e) => setTplSaving({ ...tplSaving, name: e.target.value })} placeholder='Template name, e.g. "MILH standard"' className="h-8 text-xs w-56" autoFocus />
                {appliedTemplateId && (
                  <label className="flex items-center gap-1.5 text-[11px]">
                    <input type="checkbox" checked={tplSaving.overwrite} onChange={(e) => setTplSaving({ ...tplSaving, overwrite: e.target.checked })} />
                    update &ldquo;{templates.find((t) => t.id === appliedTemplateId)?.name}&rdquo;
                  </label>
                )}
                <Button type="button" size="sm" className="h-8 text-xs" disabled={tplBusy} onClick={saveTemplate}>{tplBusy ? "Saving…" : "Save template"}</Button>
                <Button type="button" size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setTplSaving(null)}>Cancel</Button>
                <span className="w-full text-[10px] text-muted-foreground">Saves the categories, case description and the items currently selected below.</span>
              </div>
            )}
          </div>
        )}
        <div className="mt-3 space-y-1.5">
          <Label className="text-xs">Case description <span className="text-muted-foreground font-normal">(printed on the DO)</span></Label>
          <Textarea value={caseDescription} onChange={(e) => setCaseDescription(e.target.value)} rows={2} placeholder="e.g. Laser haemorrhoidoplasty (MILH), grade III" className="text-sm" />
        </div>
        <div className="mt-3 space-y-1.5">
          <Label className="text-xs">Customer PO no. (optional — can fill later)</Label>
          <Input value={customerPoNo} onChange={(e) => setCustomerPoNo(e.target.value)}
            placeholder="e.g. PO-2025-0001" className="h-9 text-sm" />
        </div>
        <div className="mt-3 space-y-1.5">
          <div className="flex items-center justify-between">
            <Label className="text-xs">Hospital / delivery address</Label>
            {selectedCustomer && deliveryAddress && deliveryAddress === custAddress(selectedCustomer, custCompanyId) && (
              <span className="text-[10px] text-muted-foreground">from customer record</span>
            )}
            {selectedCustomer && deliveryAddress && deliveryAddress !== custAddress(selectedCustomer, custCompanyId) && (
              <button type="button" className="text-[10px] text-muted-foreground hover:text-foreground underline"
                onClick={() => setDeliveryAddress(custAddress(selectedCustomer, custCompanyId))}>
                reset to customer address
              </button>
            )}
          </div>
          <Textarea value={deliveryAddress} onChange={(e) => setDeliveryAddress(e.target.value)} placeholder="Hospital name and address" rows={3} className="text-sm resize-none" />
        </div>
        <div className="mt-3 space-y-1.5">
          <Label className="text-xs">Notes</Label>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="text-sm" />
        </div>
      </section>


      {/* Customer copy items */}
      <section className="border border-border rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-sm font-semibold">Customer copy items</h2>
            <p className="text-xs text-muted-foreground mt-0.5">What the hospital sees on the customer copy (with MDA certificates) and is billed for — from the doctor&apos;s template; change as needed. A line without a product code (e.g. a package name) prints as written.</p>
          </div>
          <Button variant="outline" size="sm" className="gap-1.5 h-7 text-xs" onClick={() => setCustItems((p) => [...p, newCaseLine()])}>
            <PlusIcon className="w-3 h-3" /> Add row
          </Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[520px]">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="text-left pb-2 pr-2 w-32">Code</th>
                <th className="text-left pb-2 pr-2">Description</th>
                <th className="text-right pb-2 pr-2 w-16">Qty</th>
                <th className="text-left pb-2 pr-2 w-16">UOM</th>
                {priceMode === "itemized" && <th className="text-right pb-2 pr-2 w-24">Price (RM)</th>}
                <th className="w-6" />
              </tr>
            </thead>
            <tbody>
              {custItems.map((item) => (
                <tr key={item._key} className={cn("border-b border-border/50 last:border-0", noMda(item) && "bg-red-50 dark:bg-red-950/30 outline outline-1 outline-red-400")}
                  title={noMda(item) ? "No valid MDA registration — won't print on the customer copy" : undefined}>
                  <td className="py-1.5 pr-2"><CaseExtraProductCell item={item} onUpdate={updateCustItem} /></td>
                  <td className="py-1.5 pr-2"><Input value={item.description} onChange={(e) => updateCustItem(item._key, { description: e.target.value })} className="h-7 text-xs" placeholder="e.g. MILH procedure kit" /></td>
                  <td className="py-1.5 pr-2"><Input type="number" min="0" step="any" value={item.qty} onChange={(e) => updateCustItem(item._key, { qty: e.target.value })} className="h-7 text-xs text-right" /></td>
                  <td className="py-1.5 pr-2"><Input value={item.uom} onChange={(e) => updateCustItem(item._key, { uom: e.target.value })} className="h-7 text-xs" placeholder="pc / set" /></td>
                  {priceMode === "itemized" && (
                    <td className="py-1.5 pr-2"><Input type="number" min="0" step="0.01" value={priceOf(item)} onChange={(e) => updateCustItem(item._key, { unitPrice: e.target.value })} className="h-7 text-xs text-right" placeholder="0.00" /></td>
                  )}
                  <td className="py-1.5">
                    <button onClick={() => setCustItems((p) => p.filter((i) => i._key !== item._key))} disabled={custItems.length === 1}
                      className="text-muted-foreground hover:text-destructive transition-colors disabled:opacity-30"><TrashIcon className="w-3.5 h-3.5" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {custItems.some(noMda) && (
          <p className="mt-2 text-xs font-medium text-red-700 dark:text-red-400">
            {custItems.filter(noMda).map((i) => i.productCode).join(", ")}: no valid MDA registration — won&apos;t print on the customer copy.
          </p>
        )}
      </section>

      {/* Selling price */}
      <section className="border border-border rounded-xl p-4 flex flex-col gap-2">
        <div>
          <h2 className="text-sm font-semibold">Selling price</h2>
          <p className="text-xs text-muted-foreground mt-0.5">For the customer items, from the doctor&apos;s template; the invoice made from this DO starts with it.</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {([["itemized", "Itemized — a price per item"], ["total", "Total — one price for the case"]] as const).map(([m, label]) => (
            <button key={m} type="button" onClick={() => setPriceMode(m)}
              className={cn("rounded-full border px-2.5 py-1", priceMode === m ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:bg-muted/40")}>{label}</button>
          ))}
        </div>
        {priceMode === "itemized" && <ItemizedMdaWarning codes={custItems.filter(noMda).map((i) => i.productCode)} />}
        {priceMode === "total" ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span>Case price RM</span>
            <Input type="number" min="0" step="0.01" value={casePrice} onChange={(e) => setCasePrice(e.target.value)} placeholder="0.00" className="h-9 w-36 text-right" />
            <span className="text-xs text-muted-foreground">covers all items; machine usage fees are charged on top</span>
          </div>
        ) : (
          <p className="text-sm">Items total: <b className="tabular-nums">RM {caseItemsTotal().toFixed(2)}</b>
            {showActual && caseFeesTotal() > 0 && <span className="text-xs text-muted-foreground"> + usage fees of machines not on the customer copy RM {caseFeesTotal().toFixed(2)}</span>}</p>
        )}
      </section>

      {/* Actual items: after the case (DO page), or now */}
      <label className="flex items-start gap-2 rounded-xl border border-dashed border-border p-4 text-sm cursor-pointer">
        <input type="checkbox" checked={recordNow} onChange={(e) => setRecordNow(e.target.checked)} className="mt-0.5" />
        <span><span className="font-medium">The case is done — record the items actually used now</span>
          <span className="block text-xs text-muted-foreground">Otherwise record them on the DO page after the case. Stock is deducted only when the actual items are recorded.</span></span>
      </label>
      </>)}

      {/* Field stock items (actual) */}
      {showActual && repId && (
        <section className="border border-teal-200 dark:border-teal-800/50 rounded-xl p-4 bg-teal-50/40 dark:bg-teal-900/10">
          <div className="mb-3">
            <h2 className="text-sm font-semibold">Items actually used — from field stock</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Select items used from {selectedRep?.name}'s holding.</p>
          </div>

          {/* Checklist */}
          {loadingStock ? (
            <p className="text-sm text-muted-foreground py-2">Loading rep stock…</p>
          ) : fieldPool.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">No field stock found for this rep.</p>
          ) : (
            <div className="flex flex-col gap-0.5 rounded-md border border-teal-200 dark:border-teal-800/50 overflow-hidden mb-4">
              {poolSections.map((sec) => {
                const open = isGroupOpen(sec);
                const picked = sec.items.filter((it) => fieldItems.some((f) => f.productId === it.productId)).length;
                return (
                <Fragment key={sec.key}>
                {sec.name && (
                  <button type="button" onClick={() => toggleGroup(sec)}
                    className={cn("flex items-center gap-2 px-3 py-1.5 text-xs font-semibold text-left w-full",
                      sec.match ? "bg-teal-100/80 dark:bg-teal-900/40" : "bg-muted/40 hover:bg-muted/60")}>
                    {open ? <ChevronDownIcon className="w-3.5 h-3.5" /> : <ChevronRightIcon className="w-3.5 h-3.5" />}
                    <span className="w-2 h-2 rounded-full" style={{ background: sec.color ?? "var(--muted-foreground)" }} />
                    {sec.name}
                    <span className="font-normal text-muted-foreground">{sec.items.length} item{sec.items.length !== 1 ? "s" : ""}{picked ? ` · ${picked} selected` : ""}</span>
                    {sec.match && <span className="ml-auto text-[10px] font-medium rounded px-1.5 py-0.5 bg-teal-600 text-white">matches case type</span>}
                  </button>
                )}
                {open && sec.items.map((item) => {
                const selected = fieldItems.some((i) => i.productId === item.productId);
                return (
                  <button key={item._key} type="button" onClick={() => toggleFieldItem(item)}
                    className={cn(
                      "flex flex-wrap items-center gap-x-2.5 gap-y-1 px-3 py-2.5 text-xs text-left transition-colors w-full",
                      selected ? "bg-teal-600 text-white" : "hover:bg-teal-50/60 dark:hover:bg-teal-900/20"
                    )}>
                    <span className={cn("w-4 h-4 rounded border flex items-center justify-center shrink-0 text-[10px] font-bold",
                      selected ? "bg-white border-white text-teal-600" : "border-teal-300 dark:border-teal-700")}>
                      {selected ? "✓" : ""}
                    </span>
                    <span className="font-mono font-medium shrink-0">{item.productCode}</span>
                    {item.description && <span className={cn("opacity-70 truncate flex-1 min-w-20", selected ? "" : "text-muted-foreground")}>{item.description}</span>}
                    <span className="w-full sm:w-auto flex items-center justify-between sm:justify-normal gap-2 sm:ml-auto shrink-0 pl-6 sm:pl-0">
                      {item.isRental ? (
                        <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-semibold border", selected ? "bg-white/20 border-white/30 text-white" : "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-700")}>rental</span>
                      ) : (
                        <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-semibold border", selected ? "bg-white/20 border-white/30 text-white" : "bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-900/20 dark:text-teal-400 dark:border-teal-700")}>disposable</span>
                      )}
                      <span className={cn("tabular-nums", selected ? "text-white/80" : "text-muted-foreground")}>{item.fieldAvailable?.toFixed(0)} {item.uom}</span>
                    </span>
                    {item.consigned?.length ? (
                      <span className={cn("w-full pl-6 text-[10px]", selected ? "text-white/80" : "text-violet-700 dark:text-violet-400")}>
                        incl. {item.consigned.map((c) => `${c.qty} from ${c.sourceOrgName}${c.noTerms ? " — no consignment terms, can't be used" : ""}`).join(", ")} (consigned)
                      </span>
                    ) : null}
                  </button>
                );
              })}
                </Fragment>
                );
              })}
            </div>
          )}

          {/* Selected item cards */}
          {fieldItems.length > 0 && (
            <div className="flex flex-col gap-3">
              {pickedSections.map((sec) => (
              <Fragment key={sec.key}>
              {sec.name && (
                <div className="flex items-center gap-2 text-xs font-semibold -mb-1 mt-1 first:mt-0">
                  <span className="w-2 h-2 rounded-full" style={{ background: sec.color ?? "var(--muted-foreground)" }} />
                  {sec.name}
                  <span className="font-normal text-muted-foreground">{sec.items.length} item{sec.items.length !== 1 ? "s" : ""}</span>
                </div>
              )}
              {sec.items.map((item) => {
                const sellQty = parseFloat(item.qty || "0") || 0;
                const rentalQty = parseFloat(item.rentalQty || "0") || 0;
                const over = (sellQty + rentalQty) > (item.fieldAvailable ?? Infinity);
                const hasUnits = !!item.units && item.units.length > 0;
                return (
                  <div key={item._key} className="rounded-lg border border-border bg-background p-3 flex flex-col gap-2.5">
                    <div className="flex items-start justify-between">
                      <div>
                        <span className="text-xs font-mono font-semibold">{item.productCode}</span>
                        {item.description && <span className="text-[11px] text-muted-foreground ml-2">{item.description}</span>}
                      </div>
                      <button type="button" onClick={() => toggleFieldItem(item)}
                        className="text-muted-foreground hover:text-destructive text-xs ml-2 shrink-0">✕</button>
                    </div>

                    {hasUnits ? (
                      <div className="flex flex-col gap-1.5">
                        <Label className="text-[11px]">Pick unit(s) used <span className="text-destructive">*</span></Label>
                        <p className="text-[11px] text-muted-foreground -mt-1">Sale/Rental is fixed per unit in inventory — just select which ones were used. Company assets (machines) are lent for the case, not used up — choose why below.</p>
                        <div className="flex flex-col gap-1">
                          {item.units!.map((u) => {
                            const selected = (item.selectedUnitIds ?? []).includes(u.id);
                            return (
                              <div key={u.id} className="flex flex-col gap-1">
                              <button type="button"
                                onClick={() => toggleUnitSelection(item._key, u.id)}
                                className={cn("flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md border text-xs transition-colors",
                                  selected ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40")}
                              >
                                <span className="flex items-center gap-2">
                                  <span className={cn("w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 text-[9px] font-bold",
                                    selected ? "bg-primary border-primary text-primary-foreground" : "border-input")}>
                                    {selected ? "✓" : ""}
                                  </span>
                                  <span className="font-mono">{u.serialNo}</span>
                                </span>
                                <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-semibold border",
                                  isLendable(u.intendedUse)
                                    ? "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-700"
                                    : "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-700")}>
                                  {unitUseLabel(u.intendedUse)}
                                </span>
                              </button>
                              {selected && isLendable(u.intendedUse) && (
                                <MachineLoanOptions value={item.unitLoan?.[u.id] ?? defaultLoan()}
                                  onChange={(v) => updateFieldItem(item._key, { unitLoan: { ...(item.unitLoan ?? {}), [u.id]: v } })} />
                              )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ) : (
                    <>
                    <div className="flex items-center justify-between">
                      <Label className="text-[11px]">{item.isRental ? "Sell qty / Rental qty" : <>Qty <span className="text-destructive">*</span></>}</Label>
                      <span className="text-[11px] text-muted-foreground">
                        Available: <span className={cn("font-medium", over ? "text-destructive" : "")}>{item.fieldAvailable?.toFixed(0)} {item.uom}</span>
                      </span>
                    </div>

                    {item.isRental ? (
                      <div className="flex items-center gap-2">
                        <div className="flex flex-col gap-1 flex-1">
                          <span className="text-[10px] text-blue-700 dark:text-blue-400 font-medium">Sell</span>
                          <Input type="number" min="0" step="0.0001" placeholder="0"
                            value={item.qty} onChange={(e) => updateFieldItem(item._key, { qty: e.target.value })}
                            className={cn("h-8 text-xs text-right", over ? "border-destructive" : "border-blue-300 dark:border-blue-700")}
                          />
                        </div>
                        <div className="flex flex-col gap-1 flex-1">
                          <span className="text-[10px] text-amber-700 dark:text-amber-400 font-medium">Rental (loan out)</span>
                          <Input type="number" min="0" step="0.0001" placeholder="0"
                            value={item.rentalQty ?? "0"} onChange={(e) => updateFieldItem(item._key, { rentalQty: e.target.value })}
                            className={cn("h-8 text-xs text-right", over ? "border-destructive" : "border-amber-300 dark:border-amber-700")}
                          />
                        </div>
                      </div>
                    ) : (
                      <Input type="number" min="0.0001" step="0.0001" placeholder="0"
                        value={item.qty} onChange={(e) => updateFieldItem(item._key, { qty: e.target.value })}
                        className={cn("h-8 text-xs text-right", over ? "border-destructive" : "border-teal-400 dark:border-teal-600")}
                      />
                    )}
                    {item.isRental && rentalQty > 0 && (
                      <MachineLoanOptions value={item.loan ?? defaultLoan()} onChange={(v) => updateFieldItem(item._key, { loan: v })} />
                    )}
                    {over && <p className="text-[11px] text-destructive">{item.isRental ? "Sell + rental qty exceeds available quantity" : "Exceeds available quantity"}</p>}
                    </>
                    )}
                  </div>
                );
              })}
              </Fragment>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Other items actually used (not from field stock) */}
      {showActual && (
      <section className="border border-border rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-sm font-semibold">Other items used</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Items used that aren&apos;t in the specialist&apos;s field stock.</p>
          </div>
          <Button variant="outline" size="sm" className="gap-1.5 h-7 text-xs" onClick={() => setExtraItems((p) => [...p, newCaseLine()])}>
            <PlusIcon className="w-3 h-3" /> Add row
          </Button>
        </div>
        {/* Mobile: stacked cards (a 4-input-column table doesn't fit a phone screen) */}
        <div className="flex flex-col gap-3 sm:hidden">
          {extraItems.map((item) => (
            <div key={item._key} className="rounded-lg border border-border p-3 flex flex-col gap-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 space-y-1">
                  <Label className="text-[11px]">Code</Label>
                  <CaseExtraProductCell item={item} onUpdate={updateExtraItem} />
                </div>
                <button onClick={() => setExtraItems((p) => p.filter((i) => i._key !== item._key))} disabled={extraItems.length === 1}
                  className="text-muted-foreground hover:text-destructive transition-colors disabled:opacity-30 mt-5 shrink-0">
                  <TrashIcon className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="space-y-1">
                <Label className="text-[11px]">Description</Label>
                <Input value={item.description} onChange={(e) => updateExtraItem(item._key, { description: e.target.value })} className="h-8 text-xs" placeholder="e.g. Machine rental — TKR set" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-[11px]">Qty</Label>
                  <Input type="number" min="1" value={item.qty} onChange={(e) => updateExtraItem(item._key, { qty: e.target.value })} className="h-8 text-xs" />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]">UOM</Label>
                  <Input value={item.uom} onChange={(e) => updateExtraItem(item._key, { uom: e.target.value })} className="h-8 text-xs" placeholder="case/set/unit" />
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* sm and up: compact table */}
        <div className="hidden sm:block overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="text-left pb-2 pr-2 w-24">Code</th>
                <th className="text-left pb-2 pr-2">Description</th>
                <th className="text-right pb-2 pr-2 w-16">Qty</th>
                <th className="text-left pb-2 pr-2 w-14">UOM</th>
                <th className="w-6" />
              </tr>
            </thead>
            <tbody>
              {extraItems.map((item) => (
                <tr key={item._key} className="border-b border-border/50 last:border-0">
                  <td className="py-1.5 pr-2"><CaseExtraProductCell item={item} onUpdate={updateExtraItem} /></td>
                  <td className="py-1.5 pr-2">
                    <Input value={item.description} onChange={(e) => updateExtraItem(item._key, { description: e.target.value })} className="h-7 text-xs" placeholder="e.g. Machine rental — TKR set" />
                  </td>
                  <td className="py-1.5 pr-2">
                    <Input type="number" min="1" value={item.qty} onChange={(e) => updateExtraItem(item._key, { qty: e.target.value })} className="h-7 text-xs text-right" />
                  </td>
                  <td className="py-1.5 pr-2">
                    <Input value={item.uom} onChange={(e) => updateExtraItem(item._key, { uom: e.target.value })} className="h-7 text-xs" placeholder="case/set/unit" />
                  </td>
                  <td className="py-1.5">
                    <button onClick={() => setExtraItems((p) => p.filter((i) => i._key !== item._key))} disabled={extraItems.length === 1}
                      className="text-muted-foreground hover:text-destructive transition-colors disabled:opacity-30">
                      <TrashIcon className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      )}

      <div className="flex flex-col sm:flex-row gap-3 pb-8">
        <Button onClick={handleSave} disabled={saving} className="w-full sm:w-auto">
          {isRecord ? (saving ? "Recording…" : "Record actual items") : saving ? "Creating…" : "Create Case DO"}
        </Button>
        <Button variant="outline" onClick={() => router.back()} className="w-full sm:w-auto">Cancel</Button>
      </div>
    </div>
  );
}

// The DO's customer items as a template for prefilling the actual items, with
// the doctor's template's machine choices (which kind of unit, loan, fee)
function recordTemplateOf(r: RecordCaseFor): CaseTemplateRow {
  const t = r.template;
  const base = (t ?? { id: "record", name: "customer items", doctorName: r.customerName ?? "", items: [] }) as CaseTemplateRow;
  return {
    ...base,
    // only catalogue products can have been used from stock — a free-text
    // customer line (e.g. a package name) isn't an item to record
    items: r.items.filter((ci) => ci.productId || ci.productCode).map((ci, idx) => {
      const ti = t?.items.find((x) => (x.productId && x.productId === ci.productId) || (x.productCode && x.productCode === ci.productCode));
      return {
        ...(ti ?? {}), id: ti?.id ?? `r${idx}`, templateId: base.id, rowNo: idx + 1,
        productId: ci.productId, productCode: ci.productCode, description: ci.description, qty: ci.qty, uom: ci.uom,
        unitPrice: null, custShow: null, custProductId: null, custCode: null, custDescription: null, custQty: null, custUom: null, custReason: null,
        machineUse: ti?.machineUse ?? null, loanPurpose: ti?.loanPurpose ?? null, loanReturnMode: ti?.loanReturnMode ?? null, usageFee: ti?.usageFee ?? null,
        isMachine: ti?.isMachine ?? false,
      };
    }),
  } as CaseTemplateRow;
}
