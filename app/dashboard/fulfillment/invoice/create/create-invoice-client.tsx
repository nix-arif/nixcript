"use client";

import { useState, useRef, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createInvoice, type InvoiceItemInput, type InvoiceExpenseInput } from "@/server/invoice";
import { type DocumentCategoryRow } from "@/server/document-category";
import { getCustomers } from "@/server/customer";
import { getCustomerPosByCustomer } from "@/server/customer-purchase-order";
import { type Supplier } from "@/server/supplier";
import { type CustomerPo } from "@/server/customer-purchase-order";
import { type DoForInvoice } from "@/server/delivery-order";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/page-header";
import { Highlight } from "@/components/highlight";
import {
  ArrowLeftIcon, PlusIcon, TrashIcon, SearchIcon, XIcon,
  BuildingIcon, ChevronDownIcon, LinkIcon,
} from "lucide-react";

export type Customer = Awaited<ReturnType<typeof getCustomers>>[number];

interface LineItem extends InvoiceItemInput { _key: string; }
interface ExpenseRow extends InvoiceExpenseInput { _key: string; }

const newLine = (rowNo: number): LineItem => ({
  _key: crypto.randomUUID(), rowNo,
  productCode: "", description: "", qty: "1", uom: "",
  unitPrice: "0", discountPct: "0", discountAmt: "0", totalPrice: "0",
  costUnitPrice: "0", costTotal: "0",
});
const newExpense = (): ExpenseRow => ({ _key: crypto.randomUUID(), description: "", category: "other", amount: "0" });

const EXPENSE_CATEGORIES = ["transport", "handling", "customs", "other"] as const;

function calcLineTotal(unitPrice: string, qty: string, discountPct: string): { discountAmt: string; totalPrice: string } {
  const up = parseFloat(unitPrice) || 0;
  const q = parseFloat(qty) || 0;
  const dp = parseFloat(discountPct) || 0;
  const gross = up * q;
  const disc = gross * dp / 100;
  return { discountAmt: disc.toFixed(2), totalPrice: (gross - disc).toFixed(2) };
}

function calcCostLineTotal(costUnitPrice: string, qty: string): string {
  const cup = parseFloat(costUnitPrice) || 0;
  const q = parseFloat(qty) || 0;
  return (cup * q).toFixed(2);
}

function fmtNum(v: string | number) {
  return parseFloat(String(v) || "0").toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

interface Props {
  suppliers: Supplier[];
  allCustomerPos: CustomerPo[];
  doData?: DoForInvoice | null;
  initialCustomer?: Customer | null;
  categories?: DocumentCategoryRow[];
}

export function CreateInvoiceClient({ suppliers, allCustomerPos, doData, initialCustomer, categories = [] }: Props) {
  const router = useRouter();

  // Customer
  const [custSearch, setCustSearch] = useState("");
  const [custResults, setCustResults] = useState<Customer[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(initialCustomer ?? null);
  const [custOrgMemberId, setCustOrgMemberId] = useState<string | undefined>(() => {
    if (!initialCustomer) return undefined;
    const primary = (initialCustomer as any).memberships?.find((m: any) => m.isPrimary) ?? (initialCustomer as any).memberships?.[0];
    return primary?.id;
  });
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Customer PO
  const [customerPos, setCustomerPos] = useState<CustomerPo[]>(allCustomerPos);
  const [selectedCustomerPo, setSelectedCustomerPo] = useState<CustomerPo | null>(() =>
    doData?.customerPoId ? (allCustomerPos.find((p) => p.id === doData.customerPoId) ?? null) : null,
  );
  const [manualCustomerPoNo, setManualCustomerPoNo] = useState(
    doData?.customerPoId ? "" : (doData?.customerPoNo ?? ""),
  );

  // Document links
  const [quotationNo, setQuotationNo] = useState("");
  const [salesOrderNo, setSalesOrderNo] = useState(doData?.salesOrderNo ?? "");
  const [deliveryOrderId] = useState(doData?.id ?? "");
  const [deliveryOrderNo, setDeliveryOrderNo] = useState(doData?.doNo ?? "");

  // Supplier
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>("");

  // Sales person
  const [salesPersonName, setSalesPersonName] = useState("");

  // Invoice header
  const [invoiceDate, setInvoiceDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState("");
  const [paymentTerms, setPaymentTerms] = useState("");
  const [status, setStatus] = useState("draft");
  const [notes, setNotes] = useState("");
  const [categoryIds, setCategoryIds] = useState<string[]>(() =>
    categories.filter((c) => c.isDefault).map((c) => c.id),
  );

  // Pricing
  const [overallDiscountPct, setOverallDiscountPct] = useState("0");
  const [sstPct, setSstPct] = useState("0");

  // Items — pre-populate from DO if present
  const [items, setItems] = useState<LineItem[]>(() => {
    if (doData?.items && doData.items.length > 0) {
      return doData.items.map((i, idx) => ({
        _key: crypto.randomUUID(),
        rowNo: idx + 1,
        productCode: i.productCode ?? "",
        description: i.description ?? "",
        qty: i.qty ?? "1",
        uom: i.uom ?? "",
        unitPrice: "0",
        discountPct: "0",
        discountAmt: "0",
        totalPrice: "0",
        costUnitPrice: "0",
        costTotal: "0",
      }));
    }
    return [newLine(1)];
  });

  // Expenses
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);

  const [saving, setSaving] = useState(false);

  // ── Customer search ──────────────────────────────────────────────────────
  const handleCustSearch = useCallback((val: string) => {
    setCustSearch(val);
    if (val.length < 2) { setCustResults([]); return; }
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(async () => {
      const res = await getCustomers(val);
      setCustResults(res.slice(0, 8));
    }, 300);
  }, []);

  async function selectCustomer(c: Customer) {
    setSelectedCustomer(c);
    setCustSearch("");
    setCustResults([]);
    setSelectedCustomerPo(null);
    const pos = await getCustomerPosByCustomer(c.id);
    setCustomerPos(pos);
  }

  function clearCustomer() {
    setSelectedCustomer(null);
    setCustOrgMemberId(undefined);
    setSelectedCustomerPo(null);
    setCustomerPos(allCustomerPos);
  }

  // ── Items ────────────────────────────────────────────────────────────────
  function updateItem(key: string, patch: Partial<LineItem>) {
    setItems((prev) =>
      prev.map((i) => {
        if (i._key !== key) return i;
        const merged = { ...i, ...patch };
        if ("unitPrice" in patch || "qty" in patch || "discountPct" in patch) {
          const { discountAmt, totalPrice } = calcLineTotal(merged.unitPrice ?? "0", merged.qty ?? "1", merged.discountPct ?? "0");
          merged.discountAmt = discountAmt;
          merged.totalPrice = totalPrice;
        }
        if ("costUnitPrice" in patch || "qty" in patch) {
          merged.costTotal = calcCostLineTotal(merged.costUnitPrice ?? "0", merged.qty ?? "1");
        }
        return merged;
      }),
    );
  }

  function addLine() { setItems((prev) => [...prev, newLine(prev.length + 1)]); }
  function removeLine(key: string) {
    setItems((prev) => prev.filter((i) => i._key !== key).map((i, idx) => ({ ...i, rowNo: idx + 1 })));
  }

  // ── Expenses ─────────────────────────────────────────────────────────────
  function updateExpense(key: string, patch: Partial<ExpenseRow>) {
    setExpenses((prev) => prev.map((e) => e._key === key ? { ...e, ...patch } : e));
  }
  function addExpense() { setExpenses((prev) => [...prev, newExpense()]); }
  function removeExpense(key: string) { setExpenses((prev) => prev.filter((e) => e._key !== key)); }

  // ── Computed totals ──────────────────────────────────────────────────────
  const totals = useMemo(() => {
    const itemsSubtotal = items.reduce((s, i) => s + (parseFloat(i.totalPrice ?? "0") || 0), 0);
    const overallDisc = itemsSubtotal * (parseFloat(overallDiscountPct) || 0) / 100;
    const afterDisc = itemsSubtotal - overallDisc;
    const sstAmt = afterDisc * (parseFloat(sstPct) || 0) / 100;
    const grandTotal = afterDisc + sstAmt;

    const costTotal = items.reduce((s, i) => s + (parseFloat(i.costTotal ?? "0") || 0), 0);
    const expensesTotal = expenses.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
    const profit = grandTotal - costTotal - expensesTotal;

    return {
      itemsSubtotal: itemsSubtotal.toFixed(2),
      overallDisc: overallDisc.toFixed(2),
      afterDisc: afterDisc.toFixed(2),
      sstAmt: sstAmt.toFixed(2),
      grandTotal: grandTotal.toFixed(2),
      costTotal: costTotal.toFixed(2),
      expensesTotal: expensesTotal.toFixed(2),
      profit: profit.toFixed(2),
    };
  }, [items, expenses, overallDiscountPct, sstPct]);

  // ── Save ─────────────────────────────────────────────────────────────────
  async function handleSave() {
    if (!items.some((i) => i.description || i.productCode)) {
      toast.error("Add at least one item"); return;
    }
    setSaving(true);
    try {
      await createInvoice({
        invoiceDate: invoiceDate ? new Date(invoiceDate) : undefined,
        customerId: selectedCustomer?.id,
        customerOrgMemberId: custOrgMemberId,
        customerPoId: selectedCustomerPo?.id,
        customerPoNo: selectedCustomerPo?.customerPoNo ?? (manualCustomerPoNo || undefined),
        quotationNo: quotationNo || undefined,
        salesOrderNo: salesOrderNo || undefined,
        deliveryOrderId: deliveryOrderId || undefined,
        deliveryOrderNo: deliveryOrderNo || undefined,
        supplierId: selectedSupplierId || undefined,
        salesPersonName: salesPersonName || undefined,
        subtotal: totals.itemsSubtotal,
        overallDiscountPct: overallDiscountPct,
        overallDiscountAmt: totals.overallDisc,
        sstPct,
        sst: totals.sstAmt,
        grandTotal: totals.grandTotal,
        costTotal: totals.costTotal,
        expensesTotal: totals.expensesTotal,
        profit: totals.profit,
        status,
        paymentTerms: paymentTerms || undefined,
        dueDate: dueDate ? new Date(dueDate) : undefined,
        notes: notes || undefined,
        categoryIds: categoryIds.length > 0 ? categoryIds : undefined,
        items: items.map(({ _key, ...rest }) => rest),
        expenses: expenses.map(({ _key, ...rest }) => rest),
      });
      toast.success("Invoice created");
      router.push("/dashboard/fulfillment/invoice");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  }

  const allCompanies = selectedCustomer?.companies ?? [];
  const profitVal = parseFloat(totals.profit);

  return (
    <div className="p-6">
      <PageHeader
        title="New Invoice"
        description="Create a tax invoice for a customer"
        action={<Button variant="outline" size="sm" onClick={() => router.push("/dashboard/fulfillment/invoice")} className="gap-2"><ArrowLeftIcon className="w-3.5 h-3.5" /> Back</Button>}
      />

      <div className="space-y-6">
        {/* ── From DO banner ───────────────────────────────────────────── */}
        {doData && (
          <div className="flex items-center gap-2 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 px-4 py-3 text-sm text-blue-700 dark:text-blue-400">
            <LinkIcon className="w-4 h-4 shrink-0" />
            <span>Pre-filled from delivery order <span className="font-mono font-semibold">{doData.doNo}</span>. Review and complete pricing before saving.</span>
          </div>
        )}

        {/* ── Customer ─────────────────────────────────────────────────── */}
        <section className="border border-border rounded-xl p-4">
          <h2 className="text-sm font-semibold mb-3">Customer</h2>
          {selectedCustomer ? (
            <div className="flex items-start gap-2">
              <div className="flex-1">
                <div className="text-sm font-medium">{[selectedCustomer.title, selectedCustomer.name].filter(Boolean).join(" ")}</div>
                {allCompanies.length > 1 && (
                  <select className="mt-2 w-full h-8 rounded-md border border-border bg-background px-2.5 text-sm" value={custOrgMemberId ?? ""} onChange={(e) => setCustOrgMemberId(e.target.value || undefined)}>
                    <option value="">Primary / default</option>
                    {allCompanies.map((c) => <option key={c.id} value={c.id}>{c.organizationName}{c.isPrimary ? " (primary)" : ""}</option>)}
                  </select>
                )}
                {allCompanies.length === 1 && <p className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1"><BuildingIcon className="w-3 h-3" />{allCompanies[0].organizationName}</p>}
              </div>
              <button onClick={clearCustomer} className="text-muted-foreground hover:text-foreground"><XIcon className="w-3.5 h-3.5" /></button>
            </div>
          ) : (
            <div className="relative">
              <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input value={custSearch} onChange={(e) => handleCustSearch(e.target.value)} placeholder="Search customer..." className="pl-9 h-9 text-sm" />
              {custResults.length > 0 && (
                <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-background border border-border rounded-lg shadow-lg overflow-hidden">
                  {custResults.map((c) => (
                    <button key={c.id} className="w-full text-left px-3 py-2 hover:bg-muted/50 transition-colors border-b border-border/30 last:border-0" onClick={() => selectCustomer(c)}>
                      <div className="text-sm font-medium"><Highlight text={[c.title, c.name].filter(Boolean).join(" ")} query={custSearch} /></div>
                      {c.memberships[0]?.orgName && <div className="text-[11px] text-muted-foreground"><Highlight text={c.memberships[0].orgName} query={custSearch} /></div>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>

        {/* ── Customer PO ───────────────────────────────────────────────── */}
        <section className="border border-border rounded-xl p-4">
          <h2 className="text-sm font-semibold mb-3">Customer Purchase Order</h2>
          {customerPos.length > 0 ? (
            <div className="space-y-2">
              <div className="relative">
                <select
                  className="w-full h-9 rounded-md border border-border bg-background px-3 pr-8 text-sm appearance-none"
                  value={selectedCustomerPo?.id ?? ""}
                  onChange={(e) => {
                    const found = customerPos.find((p) => p.id === e.target.value) ?? null;
                    setSelectedCustomerPo(found);
                    if (found) setManualCustomerPoNo("");
                  }}
                >
                  <option value="">— Select customer PO (optional) —</option>
                  {customerPos.map((p) => (
                    <option key={p.id} value={p.id}>{p.customerPoNo}{(p.customerSnapshot as any)?.organizationName ? ` · ${(p.customerSnapshot as any).organizationName}` : ""}</option>
                  ))}
                </select>
                <ChevronDownIcon className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              </div>
              {!selectedCustomerPo && (
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Or enter PO number manually</Label>
                  <Input value={manualCustomerPoNo} onChange={(e) => setManualCustomerPoNo(e.target.value)} placeholder="Customer PO no." className="h-8 text-xs" />
                </div>
              )}
            </div>
          ) : (
            <Input value={manualCustomerPoNo} onChange={(e) => setManualCustomerPoNo(e.target.value)} placeholder="Customer PO no. (manual entry)" className="h-9 text-sm" />
          )}
        </section>

        {/* ── Invoice header ────────────────────────────────────────────── */}
        <section className="border border-border rounded-xl p-4">
          <h2 className="text-sm font-semibold mb-3">Invoice details</h2>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Invoice date <span className="text-destructive">*</span></Label>
              <input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Due date</Label>
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Payment terms</Label>
              <Input value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} placeholder="e.g. Net 30" className="h-9 text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Status</Label>
              <select value={status} onChange={(e) => setStatus(e.target.value)} className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm">
                <option value="draft">Draft</option>
                <option value="sent">Sent</option>
                <option value="paid">Paid</option>
                <option value="overdue">Overdue</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Sales person</Label>
              <Input value={salesPersonName} onChange={(e) => setSalesPersonName(e.target.value)} placeholder="Name" className="h-9 text-sm" />
            </div>
          </div>
          <div className="mt-3 space-y-1.5">
            <Label className="text-xs">Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="text-sm" />
          </div>
          <div className="mt-3 space-y-1.5">
            <Label className="text-xs">
              Categories <span className="text-destructive">*</span>
            </Label>
            {categories.length === 0 ? (
              <p className="text-xs text-muted-foreground italic py-1">
                No categories yet — create one in Organization → Categories
              </p>
            ) : (
              <div className="flex flex-wrap gap-2 pt-0.5">
                {categories.map((c) => {
                  const selected = categoryIds.includes(c.id);
                  const hex = c.color ?? "#6366f1";
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() =>
                        setCategoryIds((prev) =>
                          selected ? prev.filter((id) => id !== c.id) : [...prev, c.id],
                        )
                      }
                      className={cn(
                        "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold border-2 transition-all select-none",
                        selected
                          ? "text-white shadow-sm"
                          : "bg-background text-foreground/70 hover:text-foreground",
                      )}
                      style={
                        selected
                          ? { backgroundColor: hex, borderColor: hex }
                          : { borderColor: hex + "55" }
                      }
                    >
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: selected ? "rgba(255,255,255,0.8)" : hex }}
                      />
                      {c.name}
                      {selected && <span className="ml-0.5 opacity-80">✓</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {/* ── Document links ────────────────────────────────────────────── */}
        <section className="border border-border rounded-xl p-4">
          <h2 className="text-sm font-semibold mb-3">Links to other documents</h2>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label className="text-xs">Quotation no.</Label><Input value={quotationNo} onChange={(e) => setQuotationNo(e.target.value)} placeholder="BMS-QT-2025-XXXX" className="h-9 text-sm" /></div>
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <Label className="text-xs">Sales order no.</Label>
                {doData?.salesOrderNo && salesOrderNo === doData.salesOrderNo && (
                  <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-green-50 text-green-700 border border-green-200 dark:bg-green-950/40 dark:text-green-400 dark:border-green-800"><LinkIcon className="w-3 h-3 shrink-0" />from DO</span>
                )}
              </div>
              <Input value={salesOrderNo} onChange={(e) => setSalesOrderNo(e.target.value)} placeholder="BMS-SO-2025-XXXX" className="h-9 text-sm" />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <Label className="text-xs">Delivery order no.</Label>
                {doData && (
                  <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-green-50 text-green-700 border border-green-200 dark:bg-green-950/40 dark:text-green-400 dark:border-green-800"><LinkIcon className="w-3 h-3 shrink-0" />from DO</span>
                )}
              </div>
              <Input value={deliveryOrderNo} onChange={(e) => setDeliveryOrderNo(e.target.value)} placeholder="BMS-DO-2025-XXXX" className="h-9 text-sm" readOnly={!!doData} />
            </div>
          </div>
        </section>

        {/* ── Supplier (cost side) ──────────────────────────────────────── */}
        <section className="border border-border rounded-xl p-4">
          <h2 className="text-sm font-semibold mb-3">Supplier <span className="text-[11px] font-normal text-muted-foreground">(cost reference)</span></h2>
          <div className="relative">
            <select
              className="w-full h-9 rounded-md border border-border bg-background px-3 pr-8 text-sm appearance-none"
              value={selectedSupplierId}
              onChange={(e) => setSelectedSupplierId(e.target.value)}
            >
              <option value="">— No supplier —</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}{s.registrationNo ? ` (${s.registrationNo})` : ""}</option>)}
            </select>
            <ChevronDownIcon className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          </div>
        </section>

        {/* ── Line items ────────────────────────────────────────────────── */}
        <section className="border border-border rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold">Items</h2>
            <Button variant="outline" size="sm" className="gap-1.5 h-7 text-xs" onClick={addLine}><PlusIcon className="w-3 h-3" /> Add row</Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-215">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left pb-2 pr-2 w-6">#</th>
                  <th className="text-left pb-2 pr-2 w-20">Code</th>
                  <th className="text-left pb-2 pr-2">Description</th>
                  <th className="text-right pb-2 pr-2 w-12">Qty</th>
                  <th className="text-left pb-2 pr-2 w-12">UOM</th>
                  <th className="text-right pb-2 pr-2 w-20">Unit price</th>
                  <th className="text-right pb-2 pr-2 w-14">Disc%</th>
                  <th className="text-right pb-2 pr-2 w-22">Total</th>
                  <th className="text-right pb-2 pr-2 w-20 text-amber-700 dark:text-amber-400">Cost/unit</th>
                  <th className="text-right pb-2 pr-2 w-20 text-amber-700 dark:text-amber-400">Cost total</th>
                  <th className="w-6" />
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item._key} className="border-b border-border/50 last:border-0">
                    <td className="py-1.5 pr-2 text-muted-foreground">{item.rowNo}</td>
                    <td className="py-1.5 pr-2"><Input value={item.productCode ?? ""} onChange={(e) => updateItem(item._key, { productCode: e.target.value })} className="h-7 text-xs" /></td>
                    <td className="py-1.5 pr-2"><Input value={item.description ?? ""} onChange={(e) => updateItem(item._key, { description: e.target.value })} className="h-7 text-xs" /></td>
                    <td className="py-1.5 pr-2"><Input value={item.qty ?? "1"} onChange={(e) => updateItem(item._key, { qty: e.target.value })} className="h-7 text-xs text-right" /></td>
                    <td className="py-1.5 pr-2"><Input value={item.uom ?? ""} onChange={(e) => updateItem(item._key, { uom: e.target.value })} className="h-7 text-xs" placeholder="pcs" /></td>
                    <td className="py-1.5 pr-2"><Input value={item.unitPrice ?? "0"} onChange={(e) => updateItem(item._key, { unitPrice: e.target.value })} className="h-7 text-xs text-right" /></td>
                    <td className="py-1.5 pr-2"><Input value={item.discountPct ?? "0"} onChange={(e) => updateItem(item._key, { discountPct: e.target.value })} className="h-7 text-xs text-right" /></td>
                    <td className="py-1.5 pr-2 text-right font-mono tabular-nums text-muted-foreground">{fmtNum(item.totalPrice ?? "0")}</td>
                    <td className="py-1.5 pr-2"><Input value={item.costUnitPrice ?? "0"} onChange={(e) => updateItem(item._key, { costUnitPrice: e.target.value })} className="h-7 text-xs text-right border-amber-300 dark:border-amber-700 focus-visible:ring-amber-400" /></td>
                    <td className="py-1.5 pr-2 text-right font-mono tabular-nums text-amber-700 dark:text-amber-400">{fmtNum(item.costTotal ?? "0")}</td>
                    <td className="py-1.5"><button onClick={() => removeLine(item._key)} disabled={items.length === 1} className="text-muted-foreground hover:text-destructive transition-colors disabled:opacity-30"><TrashIcon className="w-3.5 h-3.5" /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── Expenses ──────────────────────────────────────────────────── */}
        <section className="border border-border rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold">Other expenses</h2>
            <Button variant="outline" size="sm" className="gap-1.5 h-7 text-xs" onClick={addExpense}><PlusIcon className="w-3 h-3" /> Add expense</Button>
          </div>
          {expenses.length === 0 ? (
            <p className="text-xs text-muted-foreground">No additional expenses. Click "Add expense" to add transport, handling, customs duties, etc.</p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left pb-2 pr-2">Description</th>
                  <th className="text-left pb-2 pr-2 w-32">Category</th>
                  <th className="text-right pb-2 pr-2 w-28">Amount (MYR)</th>
                  <th className="w-6" />
                </tr>
              </thead>
              <tbody>
                {expenses.map((exp) => (
                  <tr key={exp._key} className="border-b border-border/50 last:border-0">
                    <td className="py-1.5 pr-2"><Input value={exp.description} onChange={(e) => updateExpense(exp._key, { description: e.target.value })} className="h-7 text-xs" placeholder="e.g. Freight charges" /></td>
                    <td className="py-1.5 pr-2">
                      <select value={exp.category ?? "other"} onChange={(e) => updateExpense(exp._key, { category: e.target.value })} className="w-full h-7 rounded-md border border-border bg-background px-2 text-xs">
                        {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
                      </select>
                    </td>
                    <td className="py-1.5 pr-2"><Input value={exp.amount} onChange={(e) => updateExpense(exp._key, { amount: e.target.value })} className="h-7 text-xs text-right" /></td>
                    <td className="py-1.5"><button onClick={() => removeExpense(exp._key)} className="text-muted-foreground hover:text-destructive transition-colors"><TrashIcon className="w-3.5 h-3.5" /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* ── Pricing summary ───────────────────────────────────────────── */}
        <section className="border border-border rounded-xl p-4">
          <h2 className="text-sm font-semibold mb-4">Pricing summary</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Selling side */}
            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Invoice value</div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="font-mono tabular-nums">MYR {fmtNum(totals.itemsSubtotal)}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground flex-1">Overall discount</span>
                <div className="flex items-center gap-1">
                  <Input value={overallDiscountPct} onChange={(e) => setOverallDiscountPct(e.target.value)} className="h-7 w-14 text-xs text-right" />
                  <span className="text-xs text-muted-foreground">%</span>
                </div>
                <span className="font-mono tabular-nums text-sm w-28 text-right">−MYR {fmtNum(totals.overallDisc)}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground flex-1">SST</span>
                <div className="flex items-center gap-1">
                  <Input value={sstPct} onChange={(e) => setSstPct(e.target.value)} className="h-7 w-14 text-xs text-right" />
                  <span className="text-xs text-muted-foreground">%</span>
                </div>
                <span className="font-mono tabular-nums text-sm w-28 text-right">+MYR {fmtNum(totals.sstAmt)}</span>
              </div>
              <div className="flex justify-between text-sm font-semibold border-t border-border pt-2 mt-2">
                <span>Grand total</span>
                <span className="font-mono tabular-nums">MYR {fmtNum(totals.grandTotal)}</span>
              </div>
            </div>

            {/* Cost side */}
            <div className="space-y-2">
              <div className="text-xs font-medium text-amber-700 dark:text-amber-400 uppercase tracking-wide mb-2">Cost & profit</div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Cost of goods</span>
                <span className="font-mono tabular-nums text-amber-700 dark:text-amber-400">MYR {fmtNum(totals.costTotal)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Other expenses</span>
                <span className="font-mono tabular-nums text-amber-700 dark:text-amber-400">MYR {fmtNum(totals.expensesTotal)}</span>
              </div>
              <div className="flex justify-between text-sm border-t border-border pt-2 mt-2 font-semibold">
                <span>Total cost</span>
                <span className="font-mono tabular-nums text-amber-700 dark:text-amber-400">MYR {fmtNum((parseFloat(totals.costTotal) + parseFloat(totals.expensesTotal)).toFixed(2))}</span>
              </div>
              <div className={`flex justify-between text-sm font-bold border-t border-border pt-2 mt-2 ${profitVal >= 0 ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                <span>Profit</span>
                <span className="font-mono tabular-nums">{profitVal >= 0 ? "+" : ""}MYR {fmtNum(totals.profit)}</span>
              </div>
              {parseFloat(totals.grandTotal) > 0 && (
                <div className={`text-xs text-right tabular-nums ${profitVal >= 0 ? "text-green-600 dark:text-green-500" : "text-red-500"}`}>
                  {((profitVal / parseFloat(totals.grandTotal)) * 100).toFixed(1)}% margin
                </div>
              )}
            </div>
          </div>
        </section>

        <div className="flex gap-3 pb-8">
          <Button onClick={handleSave} disabled={saving}>{saving ? "Creating…" : "Create invoice"}</Button>
          <Button variant="outline" onClick={() => router.push("/dashboard/fulfillment/invoice")}>Cancel</Button>
        </div>
      </div>
    </div>
  );
}
