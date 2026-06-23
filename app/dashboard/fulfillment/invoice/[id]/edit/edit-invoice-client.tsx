"use client";

import { useState, useRef, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  updateInvoice,
  type InvoiceWithDetails,
  type InvoiceItemInput,
  type InvoiceExpenseInput,
  type OrgMemberForInvoice,
} from "@/server/invoice";
import { type DocumentCategoryRow } from "@/server/document-category";
import { getCustomers } from "@/server/customer";
import { getCustomerPosByCustomer } from "@/server/customer-purchase-order";
import { type Supplier } from "@/server/supplier";
import { type CustomerPo } from "@/server/customer-purchase-order";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/page-header";
import { Highlight } from "@/components/highlight";
import { uid } from "@/lib/uid";
import {
  ArrowLeftIcon, PlusIcon, TrashIcon, SearchIcon, XIcon,
  BuildingIcon, ChevronDownIcon, LinkIcon, UserIcon,
} from "lucide-react";

export type Customer = Awaited<ReturnType<typeof getCustomers>>[number];

type SalesPerson = { id?: string | null; name: string };
interface LineItem extends InvoiceItemInput { _key: string; }
interface ExpenseRow extends InvoiceExpenseInput { _key: string; }

const newLine = (rowNo: number): LineItem => ({
  _key: uid(), rowNo,
  productCode: "", description: "", qty: "1", uom: "",
  unitPrice: "0", discountPct: "0", discountAmt: "0", totalPrice: "0",
  costUnitPrice: "0", costTotal: "0",
});
const newExpense = (): ExpenseRow => ({ _key: uid(), description: "", category: "other", amount: "0" });

const EXPENSE_CATEGORIES = ["transport", "handling", "customs", "other"] as const;

function calcLineTotal(unitPrice: string, qty: string, discountPct: string) {
  const up = parseFloat(unitPrice) || 0;
  const q = parseFloat(qty) || 0;
  const dp = parseFloat(discountPct) || 0;
  const gross = up * q;
  const disc = gross * dp / 100;
  return { discountAmt: disc.toFixed(2), totalPrice: (gross - disc).toFixed(2) };
}
function calcCostLineTotal(costUnitPrice: string, qty: string) {
  return ((parseFloat(costUnitPrice) || 0) * (parseFloat(qty) || 0)).toFixed(2);
}
function fmtNum(v: string | number) {
  return parseFloat(String(v) || "0").toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function SalesPersonPicker({ members, value, onChange }: {
  members: OrgMemberForInvoice[];
  value: SalesPerson[];
  onChange: (v: SalesPerson[]) => void;
}) {
  const [externalName, setExternalName] = useState("");
  const available = members.filter((m) => !value.some((p) => p.id === m.userId));
  function addMember(userId: string) {
    const m = members.find((m) => m.userId === userId);
    if (!m || value.some((p) => p.id === userId)) return;
    onChange([...value, { id: userId, name: m.name }]);
  }
  function addExternal() {
    const name = externalName.trim();
    if (!name) return;
    onChange([...value, { id: null, name }]);
    setExternalName("");
  }
  function remove(idx: number) { onChange(value.filter((_, i) => i !== idx)); }

  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((p, i) => (
            <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-800">
              <UserIcon className="w-2.5 h-2.5 shrink-0" />
              {p.name}
              {!p.id && <span className="text-[9px] opacity-60 ml-0.5">ext</span>}
              <button type="button" onClick={() => remove(i)} className="ml-0.5 hover:text-red-500 transition-colors"><XIcon className="w-2.5 h-2.5" /></button>
            </span>
          ))}
        </div>
      )}
      {available.length > 0 && (
        <div className="relative">
          <select value="" onChange={(e) => { if (e.target.value) { addMember(e.target.value); e.target.value = ""; } }}
            className="w-full h-8 rounded-md border border-border bg-background px-2 pr-8 text-xs appearance-none">
            <option value="">+ Add member as sales person…</option>
            {available.map((m) => <option key={m.userId} value={m.userId}>{m.name}{m.email ? ` (${m.email})` : ""}</option>)}
          </select>
          <ChevronDownIcon className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
        </div>
      )}
      <div className="flex gap-2">
        <Input value={externalName} onChange={(e) => setExternalName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addExternal(); } }}
          placeholder="Add external person (name + Enter or Add)" className="h-8 text-xs flex-1" />
        <Button type="button" variant="outline" size="sm" className="h-8 text-xs shrink-0" onClick={addExternal} disabled={!externalName.trim()}>Add</Button>
      </div>
    </div>
  );
}

interface Props {
  invoice: InvoiceWithDetails;
  suppliers: Supplier[];
  allCustomerPos: CustomerPo[];
  categories?: DocumentCategoryRow[];
  members?: OrgMemberForInvoice[];
  initialCustomer?: Customer | null;
}

export function EditInvoiceClient({ invoice, suppliers, allCustomerPos, categories = [], members = [], initialCustomer }: Props) {
  const router = useRouter();
  const snap = invoice.customerSnapshot as any;

  // Customer
  const [custSearch, setCustSearch] = useState("");
  const [custResults, setCustResults] = useState<Customer[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(initialCustomer ?? null);
  const [custOrgMemberId, setCustOrgMemberId] = useState<string | undefined>(() => {
    const companies = (initialCustomer as any)?.companies ?? [];
    if (companies.length === 0) return undefined;
    if (snap?.organizationName) {
      const matched = companies.find((c: any) => c.organizationName === snap.organizationName);
      if (matched) return matched.id;
    }
    const primary = companies.find((c: any) => c.isPrimary) ?? companies[0];
    return primary?.id;
  });
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Customer PO
  const [customerPos, setCustomerPos] = useState<CustomerPo[]>(allCustomerPos);
  const [selectedCustomerPo, setSelectedCustomerPo] = useState<CustomerPo | null>(() =>
    invoice.customerPoId ? (allCustomerPos.find((p) => p.id === invoice.customerPoId) ?? null) : null,
  );
  const [manualCustomerPoNo, setManualCustomerPoNo] = useState(
    invoice.customerPoId ? "" : (invoice.customerPoNo ?? ""),
  );

  // Billing address
  const [billingAddress, setBillingAddress] = useState(() => {
    if (invoice.billingAddress) return invoice.billingAddress;
    if (snap?.organizationAddress) return snap.organizationAddress;
    const companies = (initialCustomer as any)?.companies ?? [];
    const primary = companies.find((c: any) => c.isPrimary) ?? companies[0];
    return primary?.organizationAddress ?? "";
  });

  // Document links
  const [quotationNo, setQuotationNo] = useState(invoice.quotationNo ?? "");
  const [salesOrderNo, setSalesOrderNo] = useState(invoice.salesOrderNo ?? "");
  const [deliveryOrderNo, setDeliveryOrderNo] = useState(invoice.deliveryOrderNo ?? "");

  // Supplier
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>(invoice.supplierId ?? "");

  // Sales persons — restore from stored data
  const [salesPersons, setSalesPersons] = useState<SalesPerson[]>(() => {
    const stored = (invoice.associateSalesPersons ?? []) as { id?: string | null; name: string }[];
    if (stored.length > 0) return stored;
    if (invoice.salesPersonName) return [{ id: invoice.salesPersonId ?? null, name: invoice.salesPersonName }];
    return [];
  });

  // Application specialist
  const [appSpecialist, setAppSpecialist] = useState<SalesPerson | null>(() => {
    if (invoice.applicationSpecialistName) return { id: invoice.applicationSpecialistId ?? null, name: invoice.applicationSpecialistName };
    return null;
  });
  const [appSpecExternal, setAppSpecExternal] = useState("");

  // Case details
  const [caseType, setCaseType] = useState(invoice.caseType ?? "");
  const [mrnNo, setMrnNo] = useState(invoice.mrnNo ?? "");
  const [caseDate, setCaseDate] = useState(() =>
    invoice.caseDate ? new Date(invoice.caseDate).toISOString().slice(0, 10) : "",
  );

  // Invoice header
  const [invoiceDate, setInvoiceDate] = useState(() =>
    invoice.invoiceDate ? new Date(invoice.invoiceDate).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
  );
  const [dueDate, setDueDate] = useState(() =>
    invoice.dueDate ? new Date(invoice.dueDate).toISOString().slice(0, 10) : "",
  );
  const [paymentTerms, setPaymentTerms] = useState(invoice.paymentTerms ?? "30 days");
  const [status, setStatus] = useState(invoice.status ?? "draft");
  const [notes, setNotes] = useState(invoice.notes ?? "");
  const [categoryIds, setCategoryIds] = useState<string[]>((invoice.categoryIds as string[]) ?? []);

  // Pricing
  const [overallDiscountPct, setOverallDiscountPct] = useState(invoice.overallDiscountPct ?? "0");
  const [sstPct, setSstPct] = useState(invoice.sstPct ?? "0");

  // Items
  const [items, setItems] = useState<LineItem[]>(() =>
    invoice.items.length > 0
      ? invoice.items.map((i) => {
          const { discountAmt, totalPrice } = calcLineTotal(i.unitPrice ?? "0", i.qty ?? "1", i.discountPct ?? "0");
          return {
            _key: uid(),
            rowNo: i.rowNo,
            productId: i.productId ?? undefined,
            productCode: i.productCode ?? "",
            description: i.description ?? "",
            qty: i.qty ?? "1",
            uom: i.uom ?? "",
            unitPrice: i.unitPrice ?? "0",
            discountPct: i.discountPct ?? "0",
            discountAmt,
            totalPrice,
            costUnitPrice: i.costUnitPrice ?? "0",
            costTotal: calcCostLineTotal(i.costUnitPrice ?? "0", i.qty ?? "1"),
            lineType: i.lineType ?? "sell",
            rentalDuration: i.rentalDuration ?? undefined,
            rentalUnit: i.rentalUnit ?? undefined,
            setGroupId: i.setGroupId ?? undefined,
            setGroupLabel: i.setGroupLabel ?? undefined,
            setQty: i.setQty ?? undefined,
          };
        })
      : [newLine(1)],
  );

  // Expenses
  const [expenses, setExpenses] = useState<ExpenseRow[]>(() =>
    invoice.expenses.map((e) => ({
      _key: uid(),
      description: e.description ?? "",
      category: e.category ?? "other",
      amount: e.amount ?? "0",
    })),
  );

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

  async function selectCustomer(c: Customer, membershipId?: string) {
    setSelectedCustomer(c);
    setCustSearch("");
    setCustResults([]);
    setSelectedCustomerPo(null);
    const pos = await getCustomerPosByCustomer(c.id);
    setCustomerPos(pos);
    const orgs = (c as any).companies ?? [];
    const targetOrg = membershipId
      ? orgs.find((co: any) => co.id === membershipId)
      : (orgs.find((co: any) => co.isPrimary) ?? orgs[0]);
    if (targetOrg) {
      setCustOrgMemberId(targetOrg.id);
      if (targetOrg.organizationAddress) setBillingAddress(targetOrg.organizationAddress);
    }
  }

  function clearCustomer() {
    setSelectedCustomer(null);
    setCustOrgMemberId(undefined);
    setCustSearch("");
    setCustResults([]);
    setCustomerPos(allCustomerPos);
    setSelectedCustomerPo(null);
  }

  // ── Items ────────────────────────────────────────────────────────────────
  function addLine() {
    setItems((prev) => [...prev, newLine(prev.length + 1)]);
  }
  function removeLine(key: string) {
    setItems((prev) => {
      const next = prev.filter((i) => i._key !== key);
      return next.map((i, idx) => ({ ...i, rowNo: idx + 1 }));
    });
  }
  function updateItem(key: string, patch: Partial<LineItem>) {
    setItems((prev) => prev.map((i) => i._key === key ? { ...i, ...patch } : i));
  }

  // ── Expenses ─────────────────────────────────────────────────────────────
  function addExpense() { setExpenses((prev) => [...prev, newExpense()]); }
  function removeExpense(key: string) { setExpenses((prev) => prev.filter((e) => e._key !== key)); }
  function updateExpense(key: string, patch: Partial<ExpenseRow>) {
    setExpenses((prev) => prev.map((e) => e._key === key ? { ...e, ...patch } : e));
  }

  // ── Totals ───────────────────────────────────────────────────────────────
  const totals = useMemo(() => {
    const itemsSubtotal = items.reduce((s, i) => s + (parseFloat(i.totalPrice ?? "0") || 0), 0);
    const disc = itemsSubtotal * (parseFloat(overallDiscountPct) || 0) / 100;
    const afterDisc = itemsSubtotal - disc;
    const sst = afterDisc * (parseFloat(sstPct) || 0) / 100;
    const grandTotal = afterDisc + sst;
    const costTotal = items.reduce((s, i) => s + (parseFloat(i.costTotal ?? "0") || 0), 0);
    const expensesTotal = expenses.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
    const profit = grandTotal - costTotal - expensesTotal;
    return {
      itemsSubtotal: itemsSubtotal.toFixed(2),
      overallDisc: disc.toFixed(2),
      sstAmt: sst.toFixed(2),
      grandTotal: grandTotal.toFixed(2),
      costTotal: costTotal.toFixed(2),
      expensesTotal: expensesTotal.toFixed(2),
      profit: profit.toFixed(2),
    };
  }, [items, expenses, overallDiscountPct, sstPct]);

  const profitVal = parseFloat(totals.profit);

  // ── Save ─────────────────────────────────────────────────────────────────
  async function handleSave() {
    if (!items.some((i) => i.description || i.productCode)) {
      toast.error("Add at least one item"); return;
    }
    if (!billingAddress.trim()) {
      toast.error("Billing address is required"); return;
    }
    setSaving(true);
    try {
      const primarySp = salesPersons[0];
      await updateInvoice({
        id: invoice.id,
        invoiceDate: invoiceDate ? new Date(invoiceDate) : undefined,
        customerId: selectedCustomer?.id,
        customerOrgMemberId: custOrgMemberId,
        customerPoId: selectedCustomerPo?.id,
        customerPoNo: selectedCustomerPo?.customerPoNo ?? (manualCustomerPoNo || undefined),
        quotationId: invoice.quotationId ?? undefined,
        quotationNo: quotationNo || undefined,
        salesOrderId: invoice.salesOrderId ?? undefined,
        salesOrderNo: salesOrderNo || undefined,
        deliveryOrderId: invoice.deliveryOrderId ?? undefined,
        deliveryOrderNo: deliveryOrderNo || undefined,
        supplierId: selectedSupplierId || undefined,
        salesPersonId: primarySp?.id ?? undefined,
        salesPersonName: primarySp?.name ?? undefined,
        associateSalesPersons: salesPersons,
        applicationSpecialistId: appSpecialist?.id ?? undefined,
        applicationSpecialistName: appSpecialist?.name ?? undefined,
        caseType: caseType || undefined,
        caseDate: caseDate ? new Date(caseDate) : undefined,
        mrnNo: mrnNo || undefined,
        billingAddress: billingAddress.trim(),
        subtotal: totals.itemsSubtotal,
        overallDiscountPct,
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
      toast.success("Invoice updated");
      router.push(`/dashboard/fulfillment/invoice/${invoice.id}`);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  }

  const allCompanies = (selectedCustomer as any)?.companies ?? [];

  return (
    <div className="p-6">
      <PageHeader
        title={`Edit ${invoice.invoiceNo}`}
        description="Only draft invoices can be edited"
        action={
          <Button variant="outline" size="sm" onClick={() => router.push(`/dashboard/fulfillment/invoice/${invoice.id}`)} className="gap-2">
            <ArrowLeftIcon className="w-3.5 h-3.5" /> Back
          </Button>
        }
      />

      <div className="space-y-6">
        {/* ── 1. Customer ─────────────────────────────────────────────── */}
        <section className="border border-border rounded-xl p-4">
          <h2 className="text-sm font-semibold mb-3">Customer</h2>
          {selectedCustomer ? (
            <div>
              <div className="flex items-start justify-between gap-2 mb-3">
                <div>
                  <p className="text-sm font-medium">{[selectedCustomer.title, selectedCustomer.name].filter(Boolean).join(" ")}</p>
                  {selectedCustomer.email && <p className="text-xs text-muted-foreground">{selectedCustomer.email}</p>}
                </div>
                <button onClick={clearCustomer} className="text-muted-foreground hover:text-foreground shrink-0 mt-0.5"><XIcon className="w-3.5 h-3.5" /></button>
              </div>
              {allCompanies.length === 0 && <p className="text-xs text-muted-foreground italic">No organisation on file</p>}
              {allCompanies.length === 1 && (
                <div className="rounded-lg border border-primary/40 bg-primary/5 px-3 py-2">
                  <div className="flex items-center gap-1.5">
                    <BuildingIcon className="w-3.5 h-3.5 text-primary shrink-0" />
                    <span className="text-xs font-medium">{allCompanies[0].organizationName}</span>
                    {allCompanies[0].isPrimary && <span className="text-[10px] text-muted-foreground ml-auto">primary</span>}
                  </div>
                  {allCompanies[0].organizationAddress && <p className="text-[11px] text-muted-foreground mt-0.5 ml-5">{allCompanies[0].organizationAddress}</p>}
                </div>
              )}
              {allCompanies.length > 1 && (
                <div className="space-y-1.5">
                  <p className="text-xs text-muted-foreground">Select organisation to bill:</p>
                  <div className="grid gap-1.5">
                    {allCompanies.map((co: any) => {
                      const isSelected = custOrgMemberId === co.id;
                      return (
                        <button key={co.id} type="button"
                          onClick={() => { setCustOrgMemberId(co.id); if (co.organizationAddress) setBillingAddress(co.organizationAddress); }}
                          className={cn("w-full text-left rounded-lg border px-3 py-2 transition-all", isSelected ? "border-primary bg-primary/5" : "border-border hover:border-primary/40 hover:bg-muted/30")}>
                          <div className="flex items-center gap-1.5">
                            <BuildingIcon className="w-3 h-3 shrink-0" />
                            <span className="text-xs font-medium flex-1">{co.organizationName}</span>
                            {co.isPrimary && <span className="text-[10px] text-muted-foreground">primary</span>}
                            {isSelected && <span className="text-[10px] text-primary font-semibold">selected</span>}
                          </div>
                          {co.organizationAddress && <p className="text-[11px] text-muted-foreground mt-0.5 ml-5 truncate">{co.organizationAddress}</p>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div>
              {snap?.name && (
                <div className="mb-2 p-2 rounded-lg bg-muted/30 border border-border text-xs text-muted-foreground flex items-center gap-2">
                  <span className="font-medium text-foreground">{[snap.title, snap.name].filter(Boolean).join(" ")}</span>
                  <span className="opacity-60">— current billing customer (search to replace)</span>
                </div>
              )}
              <div className="relative">
                <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <Input value={custSearch} onChange={(e) => handleCustSearch(e.target.value)} placeholder="Search customer…" className="pl-9 h-9 text-sm" />
                {custResults.length > 0 && (
                  <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-background border border-border rounded-lg shadow-lg overflow-hidden max-h-72 overflow-y-auto">
                    {custResults.map((c) => {
                      const orgs = (c as any).companies ?? [];
                      return orgs.length > 1 ? (
                        <div key={c.id} className="border-b border-border/30 last:border-0">
                          <div className="px-3 pt-2 pb-1 text-xs font-semibold text-muted-foreground">
                            <Highlight text={[c.title, c.name].filter(Boolean).join(" ")} query={custSearch} />
                          </div>
                          {orgs.map((org: any) => (
                            <button key={org.id} className="w-full text-left pl-6 pr-3 py-1.5 hover:bg-muted/50 transition-colors flex items-center gap-2 border-t border-border/20" onClick={() => selectCustomer(c, org.id)}>
                              <BuildingIcon className="w-3 h-3 text-muted-foreground shrink-0" />
                              <span className="text-xs flex-1"><Highlight text={org.organizationName ?? ""} query={custSearch} /></span>
                              {org.isPrimary && <span className="text-[10px] text-muted-foreground">primary</span>}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <button key={c.id} className="w-full text-left px-3 py-2 hover:bg-muted/50 transition-colors border-b border-border/30 last:border-0" onClick={() => selectCustomer(c)}>
                          <div className="text-sm font-medium"><Highlight text={[c.title, c.name].filter(Boolean).join(" ")} query={custSearch} /></div>
                          {orgs[0]?.organizationName && <div className="text-[11px] text-muted-foreground flex items-center gap-1 mt-0.5"><BuildingIcon className="w-3 h-3" /><Highlight text={orgs[0].organizationName} query={custSearch} /></div>}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </section>

        {/* ── 2. Billing address ──────────────────────────────────────── */}
        <section className="border border-border rounded-xl p-4">
          <h2 className="text-sm font-semibold mb-3">Billing Address <span className="text-destructive">*</span></h2>
          <Textarea value={billingAddress} onChange={(e) => setBillingAddress(e.target.value)}
            placeholder="Customer's official billing address" rows={3}
            className={cn("text-sm", !billingAddress.trim() && "border-destructive/50")} />
          {!billingAddress.trim() && <p className="text-xs text-destructive mt-1">Billing address is required</p>}
        </section>

        {/* ── 3. Customer PO ──────────────────────────────────────────── */}
        <section className="border border-border rounded-xl p-4">
          <h2 className="text-sm font-semibold mb-3">Customer Purchase Order</h2>
          {customerPos.length > 0 ? (
            <div className="space-y-2">
              <div className="relative">
                <select className="w-full h-9 rounded-md border border-border bg-background px-3 pr-8 text-sm appearance-none"
                  value={selectedCustomerPo?.id ?? ""}
                  onChange={(e) => { const found = customerPos.find((p) => p.id === e.target.value) ?? null; setSelectedCustomerPo(found); if (found) setManualCustomerPoNo(""); }}>
                  <option value="">— Select customer PO (optional) —</option>
                  {customerPos.map((p) => <option key={p.id} value={p.id}>{p.customerPoNo}{(p.customerSnapshot as any)?.organizationName ? ` · ${(p.customerSnapshot as any).organizationName}` : ""}</option>)}
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

        {/* ── 4. Invoice details ──────────────────────────────────────── */}
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
          </div>
          <div className="mt-3 space-y-1.5">
            <Label className="text-xs">Sales person(s)</Label>
            <SalesPersonPicker members={members} value={salesPersons} onChange={setSalesPersons} />
          </div>
          <div className="mt-3 space-y-1.5">
            <Label className="text-xs">Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="text-sm" />
          </div>
          <div className="mt-3 space-y-1.5">
            <Label className="text-xs">Categories</Label>
            {categories.length === 0 ? (
              <p className="text-xs text-muted-foreground italic py-1">No categories yet</p>
            ) : (
              <div className="flex flex-wrap gap-2 pt-0.5">
                {categories.map((c) => {
                  const selected = categoryIds.includes(c.id);
                  const hex = c.color ?? "#6366f1";
                  return (
                    <button key={c.id} type="button"
                      onClick={() => setCategoryIds((prev) => selected ? prev.filter((id) => id !== c.id) : [...prev, c.id])}
                      className={cn("inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold border-2 transition-all select-none", selected ? "text-white shadow-sm" : "bg-background text-foreground/70 hover:text-foreground")}
                      style={selected ? { backgroundColor: hex, borderColor: hex } : { borderColor: hex + "55" }}>
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

        {/* ── 4b. Case details ────────────────────────────────────────── */}
        <section className="border border-border rounded-xl p-4">
          <h2 className="text-sm font-semibold mb-3">Case details <span className="text-[11px] font-normal text-muted-foreground">(medical)</span></h2>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Case type</Label>
              <Input value={caseType} onChange={(e) => setCaseType(e.target.value)} placeholder="e.g. EVLT, MILH" className="h-9 text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Case date</Label>
              <input type="date" value={caseDate} onChange={(e) => setCaseDate(e.target.value)} className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">MRN no.</Label>
              <Input value={mrnNo} onChange={(e) => setMrnNo(e.target.value)} placeholder="Hospital medical record no." className="h-9 text-sm" />
            </div>
          </div>
          <div className="mt-3 space-y-1.5">
            <Label className="text-xs">Application specialist</Label>
            {appSpecialist ? (
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 border border-purple-200 dark:border-purple-800">
                  <UserIcon className="w-2.5 h-2.5 shrink-0" />
                  {appSpecialist.name}
                  {!appSpecialist.id && <span className="text-[9px] opacity-60 ml-0.5">ext</span>}
                </span>
                <button type="button" onClick={() => setAppSpecialist(null)} className="text-muted-foreground hover:text-destructive">
                  <XIcon className="w-3 h-3" />
                </button>
              </div>
            ) : (
              <div className="space-y-1.5">
                {members.filter((m) => !appSpecialist || (appSpecialist as any).id !== m.userId).length > 0 && (
                  <div className="relative">
                    <select value="" onChange={(e) => {
                      if (!e.target.value) return;
                      const m = members.find((m) => m.userId === e.target.value);
                      if (m) { setAppSpecialist({ id: m.userId, name: m.name }); setAppSpecExternal(""); }
                      e.target.value = "";
                    }} className="w-full h-8 rounded-md border border-border bg-background px-2 pr-8 text-xs appearance-none">
                      <option value="">+ Select from org members…</option>
                      {members.map((m) => <option key={m.userId} value={m.userId}>{m.name}{m.email ? ` (${m.email})` : ""}</option>)}
                    </select>
                    <ChevronDownIcon className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
                  </div>
                )}
                <div className="flex gap-2">
                  <Input value={appSpecExternal} onChange={(e) => setAppSpecExternal(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && appSpecExternal.trim()) { e.preventDefault(); setAppSpecialist({ id: null, name: appSpecExternal.trim() }); setAppSpecExternal(""); } }}
                    placeholder="Or enter name manually (Enter to set)" className="h-8 text-xs flex-1" />
                  <Button type="button" variant="outline" size="sm" className="h-8 text-xs shrink-0"
                    onClick={() => { if (appSpecExternal.trim()) { setAppSpecialist({ id: null, name: appSpecExternal.trim() }); setAppSpecExternal(""); } }}
                    disabled={!appSpecExternal.trim()}>Set</Button>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* ── 5. Document links ───────────────────────────────────────── */}
        <section className="border border-border rounded-xl p-4">
          <h2 className="text-sm font-semibold mb-3">Links to other documents</h2>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <Label className="text-xs">Quotation no.</Label>
                {invoice.quotationId && <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-green-50 text-green-700 border border-green-200 dark:bg-green-950/40 dark:text-green-400 dark:border-green-800"><LinkIcon className="w-2.5 h-2.5" />inherited</span>}
              </div>
              <Input value={quotationNo} onChange={(e) => setQuotationNo(e.target.value)} placeholder="QT-2025-XXXX" readOnly={!!invoice.quotationId} className={cn("h-9 text-sm", invoice.quotationId && "bg-muted/40 cursor-not-allowed")} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Sales order no.</Label>
              <Input value={salesOrderNo} onChange={(e) => setSalesOrderNo(e.target.value)} placeholder="SO-2025-XXXX" readOnly={!!invoice.salesOrderId} className={cn("h-9 text-sm", invoice.salesOrderId && "bg-muted/40 cursor-not-allowed")} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Delivery order no.</Label>
              <Input value={deliveryOrderNo} onChange={(e) => setDeliveryOrderNo(e.target.value)} placeholder="DO-2025-XXXX" readOnly={!!invoice.deliveryOrderId} className={cn("h-9 text-sm", invoice.deliveryOrderId && "bg-muted/40 cursor-not-allowed")} />
            </div>
          </div>
        </section>

        {/* ── 6. Supplier ─────────────────────────────────────────────── */}
        <section className="border border-border rounded-xl p-4">
          <h2 className="text-sm font-semibold mb-3">Supplier <span className="text-[11px] font-normal text-muted-foreground">(cost reference)</span></h2>
          <div className="relative">
            <select className="w-full h-9 rounded-md border border-border bg-background px-3 pr-8 text-sm appearance-none"
              value={selectedSupplierId} onChange={(e) => setSelectedSupplierId(e.target.value)}>
              <option value="">— No supplier —</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}{s.registrationNo ? ` (${s.registrationNo})` : ""}</option>)}
            </select>
            <ChevronDownIcon className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          </div>
        </section>

        {/* ── 7. Line items ───────────────────────────────────────────── */}
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
                  <th className="text-left pb-2 pr-2 w-32">Code</th>
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
                    <td className="py-2 pr-2"><Input value={item.productCode ?? ""} onChange={(e) => updateItem(item._key, { productCode: e.target.value })} className="h-7 text-xs font-mono w-full min-w-28" /></td>
                    <td className="py-2 pr-2 min-w-48"><Input value={item.description ?? ""} onChange={(e) => updateItem(item._key, { description: e.target.value })} className="h-7 text-xs w-full" /></td>
                    <td className="py-2 pr-2">
                      <Input value={item.qty ?? "1"} onChange={(e) => {
                        const { discountAmt, totalPrice } = calcLineTotal(item.unitPrice ?? "0", e.target.value, item.discountPct ?? "0");
                        updateItem(item._key, { qty: e.target.value, discountAmt, totalPrice, costTotal: calcCostLineTotal(item.costUnitPrice ?? "0", e.target.value) });
                      }} className="h-7 text-xs text-right" />
                    </td>
                    <td className="py-2 pr-2"><Input value={item.uom ?? ""} onChange={(e) => updateItem(item._key, { uom: e.target.value })} className="h-7 text-xs" /></td>
                    <td className="py-2 pr-2">
                      <Input value={item.unitPrice ?? "0"} onChange={(e) => {
                        const { discountAmt, totalPrice } = calcLineTotal(e.target.value, item.qty ?? "1", item.discountPct ?? "0");
                        updateItem(item._key, { unitPrice: e.target.value, discountAmt, totalPrice });
                      }} className="h-7 text-xs text-right" />
                    </td>
                    <td className="py-2 pr-2">
                      <Input value={item.discountPct ?? "0"} onChange={(e) => {
                        const { discountAmt, totalPrice } = calcLineTotal(item.unitPrice ?? "0", item.qty ?? "1", e.target.value);
                        updateItem(item._key, { discountPct: e.target.value, discountAmt, totalPrice });
                      }} className="h-7 text-xs text-right" />
                    </td>
                    <td className="py-2 pr-2 text-right font-mono tabular-nums">{fmtNum(item.totalPrice ?? "0")}</td>
                    <td className="py-2 pr-2">
                      <Input value={item.costUnitPrice ?? "0"} onChange={(e) => updateItem(item._key, { costUnitPrice: e.target.value, costTotal: calcCostLineTotal(e.target.value, item.qty ?? "1") })} className="h-7 text-xs text-right border-amber-300 dark:border-amber-700 focus-visible:ring-amber-400" />
                    </td>
                    <td className="py-2 pr-2 text-right font-mono tabular-nums text-amber-700 dark:text-amber-400">{fmtNum(item.costTotal ?? "0")}</td>
                    <td className="py-2"><button onClick={() => removeLine(item._key)} disabled={items.length === 1} className="text-muted-foreground hover:text-destructive transition-colors disabled:opacity-30"><TrashIcon className="w-3.5 h-3.5" /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── 8. Expenses ─────────────────────────────────────────────── */}
        <section className="border border-border rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold">Other expenses</h2>
            <Button variant="outline" size="sm" className="gap-1.5 h-7 text-xs" onClick={addExpense}><PlusIcon className="w-3 h-3" /> Add expense</Button>
          </div>
          {expenses.length === 0 ? (
            <p className="text-xs text-muted-foreground">No additional expenses.</p>
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

        {/* ── 9. Pricing summary ──────────────────────────────────────── */}
        <section className="border border-border rounded-xl p-4">
          <h2 className="text-sm font-semibold mb-4">Pricing summary</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Invoice value</div>
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">Subtotal</span><span className="font-mono tabular-nums">MYR {fmtNum(totals.itemsSubtotal)}</span></div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground flex-1">Overall discount</span>
                <div className="flex items-center gap-1">
                  <Input value={overallDiscountPct} onChange={(e) => setOverallDiscountPct(e.target.value)} className="h-7 w-14 text-xs text-right" />
                  <span className="text-xs text-muted-foreground">%</span>
                </div>
                <span className="text-sm font-mono tabular-nums w-24 text-right text-red-600">- MYR {fmtNum(totals.overallDisc)}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground flex-1">SST</span>
                <div className="flex items-center gap-1">
                  <Input value={sstPct} onChange={(e) => setSstPct(e.target.value)} className="h-7 w-14 text-xs text-right" />
                  <span className="text-xs text-muted-foreground">%</span>
                </div>
                <span className="text-sm font-mono tabular-nums w-24 text-right">+ MYR {fmtNum(totals.sstAmt)}</span>
              </div>
              <div className="flex justify-between text-base font-semibold border-t border-border pt-2 mt-2">
                <span>Grand total</span>
                <span className="font-mono tabular-nums">MYR {fmtNum(totals.grandTotal)}</span>
              </div>
            </div>
            <div className="space-y-2">
              <div className="text-xs font-medium text-amber-700 dark:text-amber-400 uppercase tracking-wide mb-2">Cost & profit</div>
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">Cost of goods</span><span className="font-mono tabular-nums text-amber-700 dark:text-amber-400">MYR {fmtNum(totals.costTotal)}</span></div>
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">Other expenses</span><span className="font-mono tabular-nums text-amber-700 dark:text-amber-400">MYR {fmtNum(totals.expensesTotal)}</span></div>
              <div className={cn("flex justify-between text-base font-semibold border-t border-border pt-2 mt-2", profitVal < 0 ? "text-red-600" : "text-green-700 dark:text-green-400")}>
                <span>Profit</span>
                <span className="font-mono tabular-nums">MYR {fmtNum(totals.profit)}</span>
              </div>
            </div>
          </div>
        </section>

        <div className="flex gap-3 pb-8">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
          <Button variant="outline" onClick={() => router.push(`/dashboard/fulfillment/invoice/${invoice.id}`)}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
