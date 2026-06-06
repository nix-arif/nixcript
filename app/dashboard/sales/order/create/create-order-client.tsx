"use client";

import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  createSalesOrder,
  submitSalesOrder,
  type SalesOrderItemInput,
} from "@/server/sales-order";
import { getCustomers, getCustomer } from "@/server/customer";
import {
  searchQuotationsByNo,
  getQuotationForSO,
  type QuotationForSO,
} from "@/server/quotation";
import { type OrgMember } from "@/server/members";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/page-header";
import { Highlight } from "@/components/highlight";
import {
  ArrowLeftIcon,
  PlusIcon,
  TrashIcon,
  SearchIcon,
  XIcon,
  BuildingIcon,
  FileTextIcon,
} from "lucide-react";

type Customer = Awaited<ReturnType<typeof getCustomers>>[number];

type LinkedQuotation = {
  id: string;
  quotationNo: string;
  customerId?: string | null;
  customerSnapshot?: {
    title?: string;
    name: string;
    organizationName?: string;
  } | null;
};

interface LineItem extends SalesOrderItemInput {
  _key: string;
  lineType: "sell" | "rent";
  rentalDuration: string;
  rentalUnit: string;
  setGroupId: string;
  setGroupLabel: string;
  setQty: string;
  sourceQuotationId: string;
}

const newLine = (rowNo: number): LineItem => ({
  _key: crypto.randomUUID(),
  rowNo,
  productCode: "",
  description: "",
  qty: "1",
  uom: "",
  unitPrice: "0",
  discountPct: "0",
  discountAmt: "0",
  totalPrice: "0",
  lineType: "sell",
  rentalDuration: "",
  rentalUnit: "case",
  setGroupId: "",
  setGroupLabel: "",
  setQty: "",
  sourceQuotationId: "",
});

function calcLine(item: LineItem): LineItem {
  const qty = parseFloat(item.qty || "0") || 0;
  const up = parseFloat(item.unitPrice || "0") || 0;
  const dPct = parseFloat(item.discountPct || "0") || 0;
  const gross = qty * up;
  const dAmt = (gross * dPct) / 100;
  return { ...item, discountAmt: dAmt.toFixed(2), totalPrice: (gross - dAmt).toFixed(2) };
}

function calcTotals(items: LineItem[], sstPct: string, discPct: string) {
  const subtotal = items.reduce((s, i) => s + parseFloat(i.totalPrice || "0"), 0);
  const overallDiscAmt = (subtotal * (parseFloat(discPct) || 0)) / 100;
  const afterDisc = subtotal - overallDiscAmt;
  const sstAmt = (afterDisc * (parseFloat(sstPct) || 0)) / 100;
  return { subtotal, overallDiscAmt, sstAmt, grand: afterDisc + sstAmt };
}

const fmt = (n: number) => `RM ${n.toLocaleString("en-MY", { minimumFractionDigits: 2 })}`;

interface Props {
  members: OrgMember[];
}

export function CreateSalesOrderClient({ members }: Props) {
  const router = useRouter();

  // Quotation search
  const [qtSearch, setQtSearch] = useState("");
  const [qtResults, setQtResults] = useState<Awaited<ReturnType<typeof searchQuotationsByNo>>>([]);
  const [qtHighlight, setQtHighlight] = useState(-1);
  const [linkedQuotations, setLinkedQuotations] = useState<LinkedQuotation[]>([]);
  const [qtLoading, setQtLoading] = useState(false);
  const [includeDummy, setIncludeDummy] = useState(false);
  const qtTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Customer
  const [custSearch, setCustSearch] = useState("");
  const [custResults, setCustResults] = useState<Customer[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [custCompanyId, setCustCompanyId] = useState<string | undefined>();
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Header
  const [salesPerson, setSalesPerson] = useState("");
  const [associateSalesPersons, setAssociateSalesPersons] = useState<{ id: string; name: string }[]>([]);
  const [deliveryDate, setDeliveryDate] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [notes, setNotes] = useState("");

  // Pricing
  const [sstPct, setSstPct] = useState("0");
  const [overallDiscPct, setOverallDiscPct] = useState("0");

  // Items
  const [items, setItems] = useState<LineItem[]>([newLine(1)]);

  const [saving, setSaving] = useState(false);
  const tableRef = useRef<HTMLDivElement>(null);

  // ── Quotation search ────────────────────────────────────────────────────────

  const handleQtSearch = useCallback((val: string, withDummy = includeDummy) => {
    setQtSearch(val);
    setQtHighlight(-1);
    if (val.length < 2) { setQtResults([]); return; }
    if (qtTimer.current) clearTimeout(qtTimer.current);
    qtTimer.current = setTimeout(async () => {
      const res = await searchQuotationsByNo(val, withDummy);
      setQtResults(res);
      setQtHighlight(-1);
    }, 300);
  }, [includeDummy]);

  function handleToggleDummy() {
    const next = !includeDummy;
    setIncludeDummy(next);
    if (qtSearch.length >= 2) handleQtSearch(qtSearch, next);
  }

  function handleQtKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!qtResults.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setQtHighlight((i) => Math.min(i + 1, qtResults.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setQtHighlight((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = qtResults[qtHighlight] ?? qtResults[0];
      if (item) selectQuotation(item.id, item.quotationNo);
    } else if (e.key === "Escape") {
      setQtResults([]);
      setQtHighlight(-1);
    }
  }

  async function selectQuotation(qtId: string, qtNo: string) {
    if (linkedQuotations.some((q) => q.id === qtId)) {
      setQtSearch(""); setQtResults([]); return;
    }
    setQtSearch("");
    setQtResults([]);
    setQtLoading(true);
    try {
      const qt = await getQuotationForSO(qtId);
      if (!qt) return;

      const isFirst = linkedQuotations.length === 0;
      setLinkedQuotations((prev) => [...prev, {
        id: qt.id,
        quotationNo: qt.quotationNo,
        customerId: qt.customerId ?? null,
        customerSnapshot: qt.customerSnapshot ?? null,
      }]);

      // Append items (renumber after existing), tag with source quotation
      const newItems = qt.items.map((item) =>
        calcLine({
          _key: crypto.randomUUID(),
          rowNo: 0, // renumbered below
          productCode: item.productCode ?? "",
          description: item.description ?? "",
          qty: String(item.qty ?? "1"),
          uom: item.uom ?? "",
          unitPrice: String(item.unitPrice ?? "0"),
          discountPct: String(item.discountPct ?? "0"),
          discountAmt: String(item.discountAmt ?? "0"),
          totalPrice: String(item.totalPrice ?? "0"),
          lineType: (item.lineType ?? "sell") as "sell" | "rent",
          rentalDuration: item.rentalDuration ?? "",
          rentalUnit: item.rentalUnit ?? "case",
          setGroupId: item.setGroupId ?? "",
          setGroupLabel: item.setGroupLabel ?? "",
          setQty: item.setQty ?? "",
          sourceQuotationId: qt.id,
        }),
      );
      setItems((prev) => {
        const base = isFirst ? [] : prev.filter((i) => i.description || i.productCode);
        const combined = [...base, ...newItems];
        return combined.map((i, idx) => ({ ...i, rowNo: idx + 1 }));
      });

      // Auto-fill header fields from the first quotation only
      if (isFirst) {
        setSstPct(qt.sstPct ?? "0");
        setOverallDiscPct(qt.overallDiscountPct ?? "0");
        if (qt.salesPersonName) setSalesPerson(qt.salesPersonName);
      }

      // Auto-fill customer whenever not yet set
      if (!selectedCustomer && qt.customerId) {
        const cust = await getCustomer(qt.customerId);
        if (cust) {
          setSelectedCustomer(cust as unknown as Customer);
          const primary = cust.companies.find((c) => c.isPrimary);
          if (primary) setCustCompanyId(primary.id);
          else if (cust.companies.length === 1) setCustCompanyId(cust.companies[0].id);
        } else if (qt.customerSnapshot) {
          // Customer belongs to a sibling org (dummy quotation) or was deleted — use snapshot
          const snap = qt.customerSnapshot;
          setSelectedCustomer({
            id: qt.customerId,
            title: snap.title ?? null,
            name: snap.name ?? "",
            contactNo: snap.contactNo ?? null,
            email: snap.email ?? null,
            createdAt: new Date(),
            createdByName: null,
            companies: snap.organizationName
              ? [{ id: "__snap__", customerId: qt.customerId, organizationName: snap.organizationName, organizationAddress: snap.organizationAddress ?? null, isPrimary: true, createdAt: new Date() }]
              : [],
          } as unknown as Customer);
          if (snap.organizationName) setCustCompanyId("__snap__");
        }
      }
    } catch {
      toast.error("Failed to load quotation");
    } finally {
      setQtLoading(false);
    }
  }

  function removeLinkedQuotation(id: string) {
    setLinkedQuotations((prev) => prev.filter((q) => q.id !== id));
  }

  // ── Customer search ─────────────────────────────────────────────────────────

  const handleCustSearch = useCallback((val: string) => {
    setCustSearch(val);
    if (val.length < 2) { setCustResults([]); return; }
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(async () => {
      const res = await getCustomers(val);
      setCustResults(res.slice(0, 8));
    }, 300);
  }, []);

  function selectCustomer(c: Customer) {
    setSelectedCustomer(c);
    setCustSearch("");
    setCustResults([]);
    setCustCompanyId(undefined);
  }

  // ── Items ───────────────────────────────────────────────────────────────────

  function updateItem(key: string, patch: Partial<LineItem>) {
    setItems((prev) =>
      prev.map((i) => {
        if (i._key !== key) return i;
        const updated = { ...i, ...patch };
        return ["qty", "unitPrice", "discountPct"].some((k) => k in patch) ? calcLine(updated) : updated;
      }),
    );
  }

  function addLine() {
    setItems((prev) => [...prev, newLine(prev.length + 1)]);
  }

  function removeLine(key: string) {
    setItems((prev) => prev.filter((i) => i._key !== key).map((i, idx) => ({ ...i, rowNo: idx + 1 })));
  }

  // ── Cell keyboard navigation ────────────────────────────────────────────────

  function handleCellKeyDown(
    e: React.KeyboardEvent<HTMLInputElement>,
    rowIdx: number,
    colIdx: number,
  ) {
    const el = e.currentTarget;
    const COLS = 6;

    const focus = (r: number, c: number) => {
      const target = tableRef.current?.querySelector<HTMLInputElement>(
        `[data-row="${r}"][data-col="${c}"]`,
      );
      if (target) { target.focus(); target.select(); }
    };

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        focus(rowIdx + 1, colIdx);
        break;
      case "ArrowUp":
        e.preventDefault();
        if (rowIdx > 0) focus(rowIdx - 1, colIdx);
        break;
      case "Enter":
        e.preventDefault();
        if (rowIdx < items.length - 1) {
          focus(rowIdx + 1, colIdx);
        } else {
          addLine();
          setTimeout(() => focus(rowIdx + 1, colIdx), 0);
        }
        break;
      case "ArrowRight":
        if (el.selectionStart === el.value.length) {
          e.preventDefault();
          if (colIdx < COLS - 1) focus(rowIdx, colIdx + 1);
          else focus(rowIdx + 1, 0);
        }
        break;
      case "ArrowLeft":
        if (el.selectionStart === 0) {
          e.preventDefault();
          if (colIdx > 0) focus(rowIdx, colIdx - 1);
          else if (rowIdx > 0) focus(rowIdx - 1, COLS - 1);
        }
        break;
    }
  }

  // ── Save ────────────────────────────────────────────────────────────────────

  async function buildAndCreate() {
    const primaryCustomerId = selectedCustomer?.id ?? linkedQuotations.find((q) => q.customerId)?.customerId ?? null;
    if (!primaryCustomerId) { toast.error("Please select a customer"); return null; }
    if (!items.some((i) => i.description || i.productCode)) { toast.error("Add at least one item"); return null; }

    const { subtotal, overallDiscAmt, sstAmt, grand } = calcTotals(items, sstPct, overallDiscPct);
    return createSalesOrder({
      customerId: primaryCustomerId,
      customerCompanyId: selectedCustomer ? custCompanyId : undefined,
      linkedQuotations: linkedQuotations.length > 0 ? linkedQuotations : undefined,
      salesPersonName: salesPerson || undefined,
      associateSalesPersons: associateSalesPersons.length > 0 ? associateSalesPersons : undefined,
      deliveryDate: deliveryDate ? new Date(deliveryDate) : undefined,
      deliveryAddress: deliveryAddress || undefined,
      notes: notes || undefined,
      subtotal: subtotal.toFixed(2),
      overallDiscountPct: overallDiscPct,
      overallDiscountAmt: overallDiscAmt.toFixed(2),
      sstPct,
      sst: sstAmt.toFixed(2),
      grandTotal: grand.toFixed(2),
      items: items.map(({ _key, lineType, rentalDuration, rentalUnit, setGroupId, setGroupLabel, setQty, sourceQuotationId, ...rest }) => ({
        ...rest,
        lineType,
        rentalDuration: rentalDuration || undefined,
        rentalUnit: rentalUnit || undefined,
        setGroupId: setGroupId || undefined,
        setGroupLabel: setGroupLabel || undefined,
        setQty: setQty || undefined,
        sourceQuotationId: sourceQuotationId || undefined,
      })),
    });
  }

  async function handleSave() {
    setSaving(true);
    try {
      const so = await buildAndCreate();
      if (!so) return;
      toast.success("Sales order created");
      router.push("/dashboard/sales/order");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveAndSubmit() {
    setSaving(true);
    try {
      const so = await buildAndCreate();
      if (!so) return;
      await submitSalesOrder(so.id);
      toast.success("Sales order created and submitted for approval");
      router.push("/dashboard/sales/order");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  }

  const { subtotal, overallDiscAmt, sstAmt, grand } = calcTotals(items, sstPct, overallDiscPct);
  const allCompanies = selectedCustomer?.companies ?? [];
  const linkedCustomers = linkedQuotations.filter((q) => q.customerId || q.customerSnapshot);

  return (
    <div className="p-6">
      <PageHeader
        title="New Sales Order"
        description="Create a new sales order"
        action={
          <Button variant="outline" size="sm" onClick={() => router.push("/dashboard/sales/order")} className="gap-2">
            <ArrowLeftIcon className="w-3.5 h-3.5" /> Back
          </Button>
        }
      />

      <div className="space-y-6">

        {/* ── 1. Linked quotations ── */}
        <section className="border border-border rounded-xl p-4">
          <h2 className="text-sm font-semibold mb-3">Linked quotations</h2>
          <div className="flex items-center gap-2 flex-wrap mb-2">
            {linkedQuotations.map((q) => (
              <span key={q.id} className="flex items-center gap-1 text-[11px] bg-muted rounded-full px-2.5 py-1 font-mono">
                <FileTextIcon className="w-3 h-3 text-muted-foreground" />
                {q.quotationNo}
                <button onClick={() => removeLinkedQuotation(q.id)} className="text-muted-foreground hover:text-foreground ml-0.5">
                  <XIcon className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
          <div className="relative">
            <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              value={qtSearch}
              onChange={(e) => handleQtSearch(e.target.value)}
              onKeyDown={handleQtKeyDown}
              placeholder={linkedQuotations.length === 0 ? "Search quotation no. to auto-fill…" : "Add another quotation…"}
              className="pl-9 h-9 text-sm"
              disabled={qtLoading}
            />
            {qtLoading && (
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">Loading…</span>
            )}
            {qtResults.length > 0 && (
              <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-background border border-border rounded-lg shadow-lg overflow-hidden">
                {qtResults.map((qt, idx) => {
                  const snap = qt.customerSnapshot as any;
                  const custName = snap ? [snap.title, snap.name].filter(Boolean).join(" ") : null;
                  const alreadyLinked = linkedQuotations.some((q) => q.id === qt.id);
                  const isHighlighted = idx === qtHighlight;
                  return (
                    <button
                      key={qt.id}
                      disabled={alreadyLinked}
                      className={`w-full text-left px-3 py-2 transition-colors border-b border-border/30 last:border-0 disabled:opacity-40 ${isHighlighted ? "bg-muted" : "hover:bg-muted/50"}`}
                      onClick={() => selectQuotation(qt.id, qt.quotationNo)}
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-mono font-medium">{qt.quotationNo}{alreadyLinked ? " (added)" : ""}</span>
                        {qt.isDummy === 1 && (
                          <span className="text-[9px] font-medium px-1.5 py-0.5 rounded border border-muted-foreground/30 bg-muted text-muted-foreground">Dummy</span>
                        )}
                      </div>
                      {custName && <div className="text-[11px] text-muted-foreground">{custName}</div>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <div className="flex items-center justify-between mt-2">
            {linkedQuotations.length === 0 && (
              <p className="text-[11px] text-muted-foreground">
                First quotation auto-fills customer, pricing, and items. Additional quotations append their items.
              </p>
            )}
            <button
              type="button"
              onClick={handleToggleDummy}
              className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground ml-auto"
            >
              <div className={`w-7 h-4 rounded-full transition-colors flex items-center px-0.5 ${includeDummy ? "bg-primary" : "bg-muted-foreground/30"}`}>
                <div className={`w-3 h-3 rounded-full bg-white shadow transition-transform ${includeDummy ? "translate-x-3" : "translate-x-0"}`} />
              </div>
              Include dummy quotations
            </button>
          </div>
        </section>

        {/* ── 2. Customer ── */}
        <section className="border border-border rounded-xl p-4">
          <h2 className="text-sm font-semibold mb-3">Customer{linkedCustomers.length > 1 ? "s" : ""}</h2>

          {linkedCustomers.length > 0 ? (
            <div className="divide-y divide-border/40">
              {linkedCustomers.map((lq) => {
                const snap = lq.customerSnapshot;
                if (!snap) return null;
                const name = [snap.title, snap.name].filter(Boolean).join(" ");
                return (
                  <div key={lq.id} className="py-2 first:pt-0 last:pb-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-sm">{name}</span>
                      <span className="text-[10px] text-muted-foreground font-mono shrink-0">via {lq.quotationNo}</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground flex items-center gap-1 mt-0.5">
                      <BuildingIcon className="w-3 h-3 shrink-0" />{snap.organizationName || "—"}
                    </p>
                  </div>
                );
              })}
            </div>
          ) : selectedCustomer ? (
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm">
                    {[selectedCustomer.title, selectedCustomer.name].filter(Boolean).join(" ")}
                  </span>
                  <button
                    onClick={() => { setSelectedCustomer(null); setCustCompanyId(undefined); }}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <XIcon className="w-3.5 h-3.5" />
                  </button>
                </div>
                {allCompanies.length > 0 && (
                  <div className="mt-2">
                    {allCompanies.length === 1 ? (
                      <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                        <BuildingIcon className="w-3 h-3" /> {allCompanies[0].organizationName}
                      </p>
                    ) : (
                      <div className="space-y-1 mt-2">
                        <Label className="text-[11px] text-muted-foreground">Select company</Label>
                        <select
                          className="w-full h-8 rounded-md border border-border bg-background px-2.5 text-sm"
                          value={custCompanyId ?? ""}
                          onChange={(e) => setCustCompanyId(e.target.value || undefined)}
                        >
                          <option value="">Primary / default</option>
                          {allCompanies.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.organizationName}{c.isPrimary ? " (primary)" : ""}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                )}
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
                  {custResults.map((c) => {
                    const co = c.companies[0];
                    return (
                      <button
                        key={c.id}
                        className="w-full text-left px-3 py-2 hover:bg-muted/50 transition-colors border-b border-border/30 last:border-0"
                        onClick={() => selectCustomer(c)}
                      >
                        <div className="text-sm font-medium">
                          <Highlight text={[c.title, c.name].filter(Boolean).join(" ")} query={custSearch} />
                        </div>
                        {co?.organizationName && (
                          <div className="text-[11px] text-muted-foreground">
                            <Highlight text={co.organizationName} query={custSearch} />
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </section>

        {/* ── 3. Order details ── */}
        <section className="border border-border rounded-xl p-4">
          <h2 className="text-sm font-semibold mb-3">Order details</h2>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1.5">
              <Label className="text-xs">Sales person</Label>
              <div className="flex items-center gap-2 flex-wrap">
                <select
                  value={salesPerson}
                  onChange={(e) => setSalesPerson(e.target.value)}
                  className="h-9 rounded-md border border-border bg-background px-2.5 text-sm shrink-0"
                >
                  <option value="">— Select —</option>
                  {members.map((m) => (
                    <option key={m.userId} value={m.name ?? m.email}>{m.name ?? m.email}</option>
                  ))}
                </select>
                {associateSalesPersons.map((a) => (
                  <span key={a.id} className="flex items-center gap-1 text-[11px] bg-muted rounded-full px-2.5 py-1 shrink-0">
                    {a.name}
                    <button
                      onClick={() => setAssociateSalesPersons((prev) => prev.filter((x) => x.id !== a.id))}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <XIcon className="w-3 h-3" />
                    </button>
                  </span>
                ))}
                <select
                  value=""
                  onChange={(e) => {
                    const m = members.find((x) => x.userId === e.target.value);
                    if (!m) return;
                    if (associateSalesPersons.some((a) => a.id === m.userId)) return;
                    setAssociateSalesPersons((prev) => [...prev, { id: m.userId, name: m.name ?? m.email }]);
                  }}
                  className="h-9 rounded-md border border-dashed border-border bg-background px-2.5 text-sm text-muted-foreground shrink-0"
                >
                  <option value="">+ Add associate…</option>
                  {members
                    .filter((m) => !associateSalesPersons.some((a) => a.id === m.userId))
                    .map((m) => (
                      <option key={m.userId} value={m.userId}>{m.name ?? m.email}</option>
                    ))}
                </select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Due delivery date</Label>
              <input
                type="date"
                value={deliveryDate}
                onChange={(e) => setDeliveryDate(e.target.value)}
                className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Delivery address</Label>
              <Input
                value={deliveryAddress}
                onChange={(e) => setDeliveryAddress(e.target.value)}
                placeholder="Address"
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

        {/* ── 4. Items table ── */}
        <section className="border border-border rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold">Items</h2>
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
                  <th className="text-right pb-2 pr-2 w-24">Unit price</th>
                  <th className="text-right pb-2 pr-2 w-16">Disc %</th>
                  <th className="text-right pb-2 pr-2 w-24">Total</th>
                  {linkedQuotations.some((q) => q.customerId || q.customerSnapshot) && (
                    <th className="text-left pb-2 pr-2 w-28">Customer</th>
                  )}
                  <th className="w-6" />
                </tr>
              </thead>
              <tbody>
                {items.map((item, rowIdx) => {
                  const hasCustomers = linkedQuotations.some((q) => q.customerId || q.customerSnapshot);
                  const sourceQt = item.sourceQuotationId
                    ? linkedQuotations.find((q) => q.id === item.sourceQuotationId)
                    : undefined;
                  const custName = sourceQt?.customerSnapshot
                    ? [sourceQt.customerSnapshot.title, sourceQt.customerSnapshot.name].filter(Boolean).join(" ")
                    : null;
                  const unassignedLinked = linkedQuotations.filter((q) => q.customerId || q.customerSnapshot);
                  return (
                  <tr key={item._key} className="border-b border-border/50 last:border-0">
                    <td className="py-1.5 pr-2 text-muted-foreground">{item.rowNo}</td>
                    <td className="py-1.5 pr-2">
                      <Input
                        data-row={rowIdx} data-col={0}
                        value={item.productCode ?? ""}
                        onChange={(e) => updateItem(item._key, { productCode: e.target.value })}
                        onKeyDown={(e) => handleCellKeyDown(e, rowIdx, 0)}
                        className="h-7 text-xs"
                      />
                    </td>
                    <td className="py-1.5 pr-2">
                      <Input
                        data-row={rowIdx} data-col={1}
                        value={item.description ?? ""}
                        onChange={(e) => updateItem(item._key, { description: e.target.value })}
                        onKeyDown={(e) => handleCellKeyDown(e, rowIdx, 1)}
                        className="h-7 text-xs"
                      />
                    </td>
                    <td className="py-1.5 pr-2">
                      <Input
                        data-row={rowIdx} data-col={2}
                        value={item.qty}
                        onChange={(e) => updateItem(item._key, { qty: e.target.value })}
                        onKeyDown={(e) => handleCellKeyDown(e, rowIdx, 2)}
                        className="h-7 text-xs text-right"
                      />
                    </td>
                    <td className="py-1.5 pr-2">
                      <Input
                        data-row={rowIdx} data-col={3}
                        value={item.uom ?? ""}
                        onChange={(e) => updateItem(item._key, { uom: e.target.value })}
                        onKeyDown={(e) => handleCellKeyDown(e, rowIdx, 3)}
                        className="h-7 text-xs"
                        placeholder="unit"
                      />
                    </td>
                    <td className="py-1.5 pr-2">
                      <Input
                        data-row={rowIdx} data-col={4}
                        value={item.unitPrice ?? "0"}
                        onChange={(e) => updateItem(item._key, { unitPrice: e.target.value })}
                        onKeyDown={(e) => handleCellKeyDown(e, rowIdx, 4)}
                        className="h-7 text-xs text-right"
                      />
                    </td>
                    <td className="py-1.5 pr-2">
                      <Input
                        data-row={rowIdx} data-col={5}
                        value={item.discountPct ?? "0"}
                        onChange={(e) => updateItem(item._key, { discountPct: e.target.value })}
                        onKeyDown={(e) => handleCellKeyDown(e, rowIdx, 5)}
                        className="h-7 text-xs text-right"
                      />
                    </td>
                    <td className="py-1.5 pr-2 text-right font-mono tabular-nums text-muted-foreground">
                      {fmt(parseFloat(item.totalPrice ?? "0"))}
                    </td>
                    {hasCustomers && (
                      <td className="py-1.5 pr-2">
                        {custName ? (
                          <span className="inline-block text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground max-w-25 truncate" title={custName}>
                            {custName}
                          </span>
                        ) : unassignedLinked.length > 0 ? (
                          <select
                            value={item.sourceQuotationId ?? ""}
                            onChange={(e) => updateItem(item._key, { sourceQuotationId: e.target.value })}
                            className="h-6 rounded border border-border bg-background px-1 text-[10px] max-w-25"
                          >
                            <option value="">—</option>
                            {unassignedLinked.map((q) => {
                              const n = q.customerSnapshot
                                ? [q.customerSnapshot.title, q.customerSnapshot.name].filter(Boolean).join(" ")
                                : q.quotationNo;
                              return <option key={q.id} value={q.id}>{n}</option>;
                            })}
                          </select>
                        ) : null}
                      </td>
                    )}
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
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── 5. Pricing summary ── */}
        <section className="border border-border rounded-xl p-4">
          <h2 className="text-sm font-semibold mb-3">Pricing</h2>
          <div className="flex justify-end">
            <div className="w-72 space-y-2 text-sm">
              <div className="flex justify-between text-muted-foreground">
                <span>Subtotal</span>
                <span className="tabular-nums font-mono">{fmt(subtotal)}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground shrink-0">Overall disc.</span>
                <div className="flex items-center gap-1">
                  <Input
                    value={overallDiscPct}
                    onChange={(e) => setOverallDiscPct(e.target.value)}
                    className="h-7 w-16 text-xs text-right"
                  />
                  <span className="text-muted-foreground text-xs">%</span>
                </div>
                <span className="tabular-nums font-mono text-muted-foreground">−{fmt(overallDiscAmt)}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground shrink-0">SST</span>
                <div className="flex items-center gap-1">
                  <Input
                    value={sstPct}
                    onChange={(e) => setSstPct(e.target.value)}
                    className="h-7 w-16 text-xs text-right"
                  />
                  <span className="text-muted-foreground text-xs">%</span>
                </div>
                <span className="tabular-nums font-mono text-muted-foreground">{fmt(sstAmt)}</span>
              </div>
              <div className="flex justify-between font-semibold border-t border-border pt-2">
                <span>Grand total</span>
                <span className="tabular-nums font-mono">{fmt(grand)}</span>
              </div>
            </div>
          </div>
        </section>

        {/* ── Actions ── */}
        <div className="flex gap-3 pb-8">
          <Button onClick={handleSaveAndSubmit} disabled={saving} className="gap-2">
            {saving ? "Creating…" : "Create & Submit"}
          </Button>
          <Button variant="outline" onClick={handleSave} disabled={saving}>
            Save as Draft
          </Button>
          <Button variant="outline" onClick={() => router.push("/dashboard/sales/order")}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
