"use client";

import { useState, useMemo, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  createInvoiceManual,
  type InvoiceListRow,
  type InvoiceItemInput,
  type InvoiceExpenseInput,
  type OrgMemberForInvoice,
} from "@/server/invoice";
import { type DocumentCategoryRow } from "@/server/document-category";
import { type CustomerPo } from "@/server/customer-purchase-order";
import { type Supplier } from "@/server/supplier";
import { getCustomers } from "@/server/customer";
import { getCustomerPosByCustomer } from "@/server/customer-purchase-order";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  PlusIcon, XIcon, SearchIcon, BuildingIcon, ChevronDownIcon, TrashIcon, UserIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { uid } from "@/lib/uid";

type Customer = Awaited<ReturnType<typeof getCustomers>>[number];
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

function calcCostTotal(costUnitPrice: string, qty: string) {
  return ((parseFloat(costUnitPrice) || 0) * (parseFloat(qty) || 0)).toFixed(2);
}

const STATUS_BADGE: Record<string, string> = {
  draft:     "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  sent:      "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  paid:      "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  overdue:   "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  cancelled: "bg-zinc-100 text-zinc-400 line-through dark:bg-zinc-800",
};

function fmtDate(d: Date | string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" });
}

function fmtNum(v: string | null | undefined) {
  return parseFloat(v ?? "0").toLocaleString("en-MY", { minimumFractionDigits: 2 });
}

// ── Sales person picker (shared with create invoice) ──────────────────────

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

  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((p, i) => (
            <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-800">
              <UserIcon className="w-2.5 h-2.5 shrink-0" />
              {p.name}
              {!p.id && <span className="text-[9px] opacity-60 ml-0.5">ext</span>}
              <button type="button" onClick={() => onChange(value.filter((_, j) => j !== i))} className="ml-0.5 hover:text-red-500 transition-colors">
                <XIcon className="w-2.5 h-2.5" />
              </button>
            </span>
          ))}
        </div>
      )}
      {available.length > 0 && (
        <div className="relative">
          <select
            value=""
            onChange={(e) => { if (e.target.value) { addMember(e.target.value); e.target.value = ""; } }}
            className="w-full h-8 rounded-md border border-border bg-background px-2 pr-8 text-xs appearance-none"
          >
            <option value="">+ Add member as sales person…</option>
            {available.map((m) => <option key={m.userId} value={m.userId}>{m.name}{m.email ? ` (${m.email})` : ""}</option>)}
          </select>
          <ChevronDownIcon className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
        </div>
      )}
      <div className="flex gap-2">
        <Input
          value={externalName}
          onChange={(e) => setExternalName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addExternal(); } }}
          placeholder="Add external person (name + Enter)"
          className="h-8 text-xs flex-1"
        />
        <Button type="button" variant="outline" size="sm" className="h-8 text-xs shrink-0" onClick={addExternal} disabled={!externalName.trim()}>Add</Button>
      </div>
    </div>
  );
}

// ── Create drawer ─────────────────────────────────────────────────────────

interface CreateDrawerProps {
  categories: DocumentCategoryRow[];
  suppliers: Supplier[];
  allCustomerPos: CustomerPo[];
  members: OrgMemberForInvoice[];
  onClose: () => void;
  onCreated: () => void;
}

function CreateDrawer({ categories, suppliers, allCustomerPos, members, onClose, onCreated }: CreateDrawerProps) {
  const [manualInvoiceNo, setManualInvoiceNo] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState("");
  const [categoryIds, setCategoryIds] = useState<string[]>(() =>
    categories.filter((c) => c.isDefault).map((c) => c.id),
  );
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState("draft");
  const [paymentTerms, setPaymentTerms] = useState("");

  // Customer
  const [custSearch, setCustSearch] = useState("");
  const [custResults, setCustResults] = useState<Customer[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [custOrgMemberId, setCustOrgMemberId] = useState<string | undefined>(undefined);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Customer PO
  const [customerPos, setCustomerPos] = useState<CustomerPo[]>(allCustomerPos);
  const [selectedCustomerPoId, setSelectedCustomerPoId] = useState("");
  const [manualPoNo, setManualPoNo] = useState("");

  // Billing address
  const [billingAddress, setBillingAddress] = useState("");

  // Supplier
  const [selectedSupplierId, setSelectedSupplierId] = useState("");

  // Sales persons
  const [salesPersons, setSalesPersons] = useState<SalesPerson[]>([]);

  // Doc links
  const [salesOrderNo, setSalesOrderNo] = useState("");
  const [deliveryOrderNo, setDeliveryOrderNo] = useState("");

  // Items + expenses + pricing
  const [items, setItems] = useState<LineItem[]>([newLine(1)]);
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [overallDiscountPct, setOverallDiscountPct] = useState("0");
  const [sstPct, setSstPct] = useState("0");
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

  async function selectCustomer(c: Customer) {
    setSelectedCustomer(c);
    setCustSearch("");
    setCustResults([]);
    setSelectedCustomerPoId("");
    const pos = await getCustomerPosByCustomer(c.id);
    setCustomerPos(pos);
    const primaryOrg = (c as any).companies?.find((co: any) => co.isPrimary) ?? (c as any).companies?.[0];
    if (primaryOrg?.organizationAddress && !billingAddress) {
      setBillingAddress(primaryOrg.organizationAddress);
    }
  }

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
          merged.costTotal = calcCostTotal(merged.costUnitPrice ?? "0", merged.qty ?? "1");
        }
        return merged;
      }),
    );
  }

  function updateExpense(key: string, patch: Partial<ExpenseRow>) {
    setExpenses((prev) => prev.map((e) => e._key === key ? { ...e, ...patch } : e));
  }

  const totals = useMemo(() => {
    const itemsSubtotal = items.reduce((s, i) => s + (parseFloat(i.totalPrice ?? "0") || 0), 0);
    const overallDisc = itemsSubtotal * (parseFloat(overallDiscountPct) || 0) / 100;
    const afterDisc = itemsSubtotal - overallDisc;
    const sstAmt = afterDisc * (parseFloat(sstPct) || 0) / 100;
    const grandTotal = afterDisc + sstAmt;
    const costTotal = items.reduce((s, i) => s + (parseFloat(i.costTotal ?? "0") || 0), 0);
    const expensesTotal = expenses.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
    return {
      itemsSubtotal: itemsSubtotal.toFixed(2),
      overallDisc: overallDisc.toFixed(2),
      sstAmt: sstAmt.toFixed(2),
      grandTotal: grandTotal.toFixed(2),
      costTotal: costTotal.toFixed(2),
      expensesTotal: expensesTotal.toFixed(2),
      profit: (grandTotal - costTotal - expensesTotal).toFixed(2),
    };
  }, [items, expenses, overallDiscountPct, sstPct]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!manualInvoiceNo.trim()) { toast.error("Invoice number is required"); return; }
    if (categoryIds.length === 0) { toast.error("Category is required"); return; }
    if (!billingAddress.trim()) { toast.error("Billing address is required"); return; }
    setSaving(true);
    try {
      const selectedPo = customerPos.find((p) => p.id === selectedCustomerPoId);
      const primarySp = salesPersons[0];
      await createInvoiceManual({
        manualInvoiceNo: manualInvoiceNo.trim(),
        invoiceDate: invoiceDate ? new Date(invoiceDate) : undefined,
        dueDate: dueDate ? new Date(dueDate) : undefined,
        customerId: selectedCustomer?.id,
        customerOrgMemberId: custOrgMemberId,
        customerPoId: selectedCustomerPoId || undefined,
        customerPoNo: selectedPo?.customerPoNo ?? (manualPoNo || undefined),
        supplierId: selectedSupplierId || undefined,
        salesOrderNo: salesOrderNo || undefined,
        deliveryOrderNo: deliveryOrderNo || undefined,
        salesPersonId: primarySp?.id ?? undefined,
        salesPersonName: primarySp?.name ?? undefined,
        associateSalesPersons: salesPersons,
        billingAddress: billingAddress.trim(),
        categoryIds,
        status,
        paymentTerms: paymentTerms || undefined,
        notes: notes || undefined,
        subtotal: totals.itemsSubtotal,
        overallDiscountPct,
        overallDiscountAmt: totals.overallDisc,
        sstPct,
        sst: totals.sstAmt,
        grandTotal: totals.grandTotal,
        costTotal: totals.costTotal,
        expensesTotal: totals.expensesTotal,
        profit: totals.profit,
        items: items.map(({ _key, ...rest }) => rest),
        expenses: expenses.map(({ _key, ...rest }) => rest),
      });
      toast.success(`Invoice ${manualInvoiceNo} created`);
      onCreated();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  const allCompanies = selectedCustomer?.companies ?? [];
  const profitVal = parseFloat(totals.profit);

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <div className="w-full max-w-2xl bg-background border-l border-border flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div>
            <h2 className="text-sm font-semibold">Create Missing Invoice</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Backfill gaps in the invoice sequence with a manual invoice number</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-md hover:bg-muted/50 text-muted-foreground hover:text-foreground">
            <XIcon className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-5">

          {/* ── Invoice number ─────────────────────────────────────── */}
          <div className="space-y-1.5">
            <Label className="text-xs">Invoice Number <span className="text-destructive">*</span></Label>
            <Input value={manualInvoiceNo} onChange={(e) => setManualInvoiceNo(e.target.value)} placeholder="e.g. BMS-INV-2024-0031" className="h-9 text-sm font-mono" autoFocus />
            <p className="text-[11px] text-muted-foreground">Must be unique. Use to backfill missing numbers in the sequence.</p>
          </div>

          {/* ── Dates ─────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Invoice Date <span className="text-destructive">*</span></Label>
              <input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Due Date</Label>
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm" />
            </div>
          </div>

          {/* ── Categories ─────────────────────────────────────────── */}
          <div className="space-y-1.5">
            <Label className="text-xs">Category <span className="text-destructive">*</span></Label>
            {categories.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">No categories yet — create one in Organization → Categories</p>
            ) : (
              <div className="flex flex-wrap gap-2 pt-0.5">
                {categories.map((c) => {
                  const selected = categoryIds.includes(c.id);
                  const hex = c.color ?? "#6366f1";
                  return (
                    <button key={c.id} type="button"
                      onClick={() => setCategoryIds((prev) => selected ? prev.filter((id) => id !== c.id) : [...prev, c.id])}
                      className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold border-2 transition-all select-none", selected ? "text-white shadow-sm" : "bg-background text-foreground/70 hover:text-foreground")}
                      style={selected ? { backgroundColor: hex, borderColor: hex } : { borderColor: hex + "55" }}
                    >
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: selected ? "rgba(255,255,255,0.8)" : hex }} />
                      {c.name}
                      {selected && <span className="ml-0.5 opacity-80">✓</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── Customer ───────────────────────────────────────────── */}
          <div className="space-y-1.5">
            <Label className="text-xs">Customer</Label>
            {selectedCustomer ? (
              <div className="flex items-start gap-2 border border-border rounded-md px-3 py-2">
                <div className="flex-1">
                  <p className="text-sm font-medium">{[selectedCustomer.title, selectedCustomer.name].filter(Boolean).join(" ")}</p>
                  {allCompanies.length > 1 && (
                    <select className="mt-1 w-full h-7 rounded border border-border bg-background px-2 text-xs" value={custOrgMemberId ?? ""} onChange={(e) => setCustOrgMemberId(e.target.value || undefined)}>
                      <option value="">Primary / default</option>
                      {allCompanies.map((c) => <option key={c.id} value={c.id}>{c.organizationName}{c.isPrimary ? " (primary)" : ""}</option>)}
                    </select>
                  )}
                  {allCompanies.length === 1 && <p className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1"><BuildingIcon className="w-3 h-3" />{allCompanies[0].organizationName}</p>}
                </div>
                <button type="button" onClick={() => { setSelectedCustomer(null); setCustomerPos(allCustomerPos); setBillingAddress(""); }} className="text-muted-foreground hover:text-foreground"><XIcon className="w-3.5 h-3.5" /></button>
              </div>
            ) : (
              <div className="relative">
                <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <Input value={custSearch} onChange={(e) => handleCustSearch(e.target.value)} placeholder="Search customer..." className="pl-9 h-9 text-sm" />
                {custResults.length > 0 && (
                  <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-background border border-border rounded-lg shadow-lg overflow-hidden">
                    {custResults.map((c) => (
                      <button key={c.id} type="button" className="w-full text-left px-3 py-2 hover:bg-muted/50 border-b border-border/30 last:border-0" onClick={() => selectCustomer(c)}>
                        <div className="text-sm font-medium">{[c.title, c.name].filter(Boolean).join(" ")}</div>
                        {c.memberships[0]?.orgName && <div className="text-[11px] text-muted-foreground">{c.memberships[0].orgName}</div>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Billing address ────────────────────────────────────── */}
          <div className="space-y-1.5">
            <Label className="text-xs">Billing Address <span className="text-destructive">*</span></Label>
            <Textarea value={billingAddress} onChange={(e) => setBillingAddress(e.target.value)} placeholder="Customer's official billing address (appears on invoice)" rows={3} className={cn("text-xs", !billingAddress.trim() && "border-destructive/50")} />
            {!billingAddress.trim() && <p className="text-xs text-destructive">Required on tax invoices</p>}
          </div>

          {/* ── Customer PO ────────────────────────────────────────── */}
          <div className="space-y-1.5">
            <Label className="text-xs">Customer PO</Label>
            {customerPos.length > 0 ? (
              <div className="space-y-1.5">
                <div className="relative">
                  <select value={selectedCustomerPoId} onChange={(e) => { setSelectedCustomerPoId(e.target.value); if (e.target.value) setManualPoNo(""); }} className="w-full h-9 rounded-md border border-border bg-background px-3 pr-8 text-sm appearance-none">
                    <option value="">— Select PO (optional) —</option>
                    {customerPos.map((p) => <option key={p.id} value={p.id}>{p.customerPoNo}</option>)}
                  </select>
                  <ChevronDownIcon className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                </div>
                {!selectedCustomerPoId && (
                  <Input value={manualPoNo} onChange={(e) => setManualPoNo(e.target.value)} placeholder="Or enter PO no. manually" className="h-8 text-xs" />
                )}
              </div>
            ) : (
              <Input value={manualPoNo} onChange={(e) => setManualPoNo(e.target.value)} placeholder="PO no. (manual)" className="h-9 text-sm" />
            )}
          </div>

          {/* ── Document links ─────────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Sales Order No.</Label>
              <Input value={salesOrderNo} onChange={(e) => setSalesOrderNo(e.target.value)} placeholder="BMS-SO-XXXX" className="h-8 text-xs" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Delivery Order No.</Label>
              <Input value={deliveryOrderNo} onChange={(e) => setDeliveryOrderNo(e.target.value)} placeholder="BMS-DO-XXXX" className="h-8 text-xs" />
            </div>
          </div>

          {/* ── Sales persons ──────────────────────────────────────── */}
          <div className="space-y-1.5">
            <Label className="text-xs">Sales Person(s)</Label>
            <SalesPersonPicker members={members} value={salesPersons} onChange={setSalesPersons} />
          </div>

          {/* ── Supplier ───────────────────────────────────────────── */}
          <div className="space-y-1.5">
            <Label className="text-xs">Supplier <span className="text-[10px] font-normal text-muted-foreground">(cost reference)</span></Label>
            <div className="relative">
              <select value={selectedSupplierId} onChange={(e) => setSelectedSupplierId(e.target.value)} className="w-full h-9 rounded-md border border-border bg-background px-3 pr-8 text-sm appearance-none">
                <option value="">— No supplier —</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <ChevronDownIcon className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            </div>
          </div>

          {/* ── Status & Payment terms ─────────────────────────────── */}
          <div className="grid grid-cols-2 gap-3">
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
              <Label className="text-xs">Payment Terms</Label>
              <Input value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} placeholder="e.g. Net 30" className="h-9 text-sm" />
            </div>
          </div>

          {/* ── Notes ─────────────────────────────────────────────── */}
          <div className="space-y-1.5">
            <Label className="text-xs">Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="text-sm" />
          </div>

          {/* ── Line items ─────────────────────────────────────────── */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Line Items</Label>
              <Button type="button" variant="outline" size="sm" onClick={() => setItems((prev) => [...prev, newLine(prev.length + 1)])} className="h-6 text-xs gap-1">
                <PlusIcon className="w-3 h-3" /> Add row
              </Button>
            </div>
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-xs min-w-170">
                <thead>
                  <tr className="border-b border-border bg-muted/30 text-muted-foreground">
                    <th className="text-left px-2 py-1.5 w-5">#</th>
                    <th className="text-left px-2 py-1.5 w-16">Code</th>
                    <th className="text-left px-2 py-1.5">Description</th>
                    <th className="text-right px-2 py-1.5 w-10">Qty</th>
                    <th className="text-left px-2 py-1.5 w-10">UOM</th>
                    <th className="text-right px-2 py-1.5 w-18">Unit Price</th>
                    <th className="text-right px-2 py-1.5 w-12">Disc%</th>
                    <th className="text-right px-2 py-1.5 w-18">Total</th>
                    <th className="text-right px-2 py-1.5 w-18 text-amber-700 dark:text-amber-400">Cost/unit</th>
                    <th className="text-right px-2 py-1.5 w-18 text-amber-700 dark:text-amber-400">Cost total</th>
                    <th className="w-5" />
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item._key} className="border-b border-border/40 last:border-0">
                      <td className="px-2 py-1.5 text-muted-foreground">{item.rowNo}</td>
                      <td className="px-2 py-1.5"><Input value={item.productCode ?? ""} onChange={(e) => updateItem(item._key, { productCode: e.target.value })} className="h-7 text-xs w-full" /></td>
                      <td className="px-2 py-1.5"><Input value={item.description ?? ""} onChange={(e) => updateItem(item._key, { description: e.target.value })} placeholder="Item description" className="h-7 text-xs w-full" /></td>
                      <td className="px-2 py-1.5"><Input value={item.qty ?? "1"} onChange={(e) => updateItem(item._key, { qty: e.target.value })} className="h-7 text-xs text-right" /></td>
                      <td className="px-2 py-1.5"><Input value={item.uom ?? ""} onChange={(e) => updateItem(item._key, { uom: e.target.value })} placeholder="pcs" className="h-7 text-xs" /></td>
                      <td className="px-2 py-1.5"><Input value={item.unitPrice ?? "0"} onChange={(e) => updateItem(item._key, { unitPrice: e.target.value })} className="h-7 text-xs text-right" /></td>
                      <td className="px-2 py-1.5"><Input value={item.discountPct ?? "0"} onChange={(e) => updateItem(item._key, { discountPct: e.target.value })} className="h-7 text-xs text-right" /></td>
                      <td className="px-2 py-1.5 text-right font-mono tabular-nums text-muted-foreground whitespace-nowrap">{fmtNum(item.totalPrice ?? "0")}</td>
                      <td className="px-2 py-1.5"><Input value={item.costUnitPrice ?? "0"} onChange={(e) => updateItem(item._key, { costUnitPrice: e.target.value })} className="h-7 text-xs text-right border-amber-300 dark:border-amber-700 focus-visible:ring-amber-400" /></td>
                      <td className="px-2 py-1.5 text-right font-mono tabular-nums text-amber-700 dark:text-amber-400 whitespace-nowrap">{fmtNum(item.costTotal ?? "0")}</td>
                      <td className="px-2 py-1.5">
                        <button type="button" onClick={() => setItems((prev) => prev.filter((i) => i._key !== item._key).map((i, idx) => ({ ...i, rowNo: idx + 1 })))} disabled={items.length === 1} className="text-muted-foreground hover:text-destructive disabled:opacity-30">
                          <TrashIcon className="w-3 h-3" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── Other expenses ─────────────────────────────────────── */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Other Expenses</Label>
              <Button type="button" variant="outline" size="sm" onClick={() => setExpenses((prev) => [...prev, newExpense()])} className="h-6 text-xs gap-1">
                <PlusIcon className="w-3 h-3" /> Add expense
              </Button>
            </div>
            {expenses.length === 0 ? (
              <p className="text-xs text-muted-foreground">No additional expenses.</p>
            ) : (
              <div className="rounded-md border border-border overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border bg-muted/30 text-muted-foreground">
                      <th className="text-left px-2 py-1.5">Description</th>
                      <th className="text-left px-2 py-1.5 w-24">Category</th>
                      <th className="text-right px-2 py-1.5 w-24">Amount (MYR)</th>
                      <th className="w-5" />
                    </tr>
                  </thead>
                  <tbody>
                    {expenses.map((exp) => (
                      <tr key={exp._key} className="border-b border-border/40 last:border-0">
                        <td className="px-2 py-1.5"><Input value={exp.description} onChange={(e) => updateExpense(exp._key, { description: e.target.value })} placeholder="e.g. Freight" className="h-7 text-xs" /></td>
                        <td className="px-2 py-1.5">
                          <select value={exp.category ?? "other"} onChange={(e) => updateExpense(exp._key, { category: e.target.value })} className="w-full h-7 rounded-md border border-border bg-background px-1.5 text-xs">
                            {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
                          </select>
                        </td>
                        <td className="px-2 py-1.5"><Input value={exp.amount} onChange={(e) => updateExpense(exp._key, { amount: e.target.value })} className="h-7 text-xs text-right" /></td>
                        <td className="px-2 py-1.5">
                          <button type="button" onClick={() => setExpenses((prev) => prev.filter((e) => e._key !== exp._key))} className="text-muted-foreground hover:text-destructive">
                            <TrashIcon className="w-3 h-3" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ── Pricing summary ────────────────────────────────────── */}
          <div className="rounded-lg border border-border p-3 space-y-2 bg-muted/20">
            <p className="text-xs font-semibold mb-1">Pricing Summary</p>
            <div className="flex justify-between text-xs"><span className="text-muted-foreground">Items subtotal</span><span className="font-mono">MYR {fmtNum(totals.itemsSubtotal)}</span></div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground flex-1">Overall discount</span>
              <div className="flex items-center gap-1">
                <Input value={overallDiscountPct} onChange={(e) => setOverallDiscountPct(e.target.value)} className="h-6 w-12 text-xs text-right" />
                <span className="text-xs text-muted-foreground">%</span>
              </div>
              <span className="text-xs font-mono w-20 text-right text-red-600">- MYR {fmtNum(totals.overallDisc)}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground flex-1">SST</span>
              <div className="flex items-center gap-1">
                <Input value={sstPct} onChange={(e) => setSstPct(e.target.value)} className="h-6 w-12 text-xs text-right" />
                <span className="text-xs text-muted-foreground">%</span>
              </div>
              <span className="text-xs font-mono w-20 text-right">+ MYR {fmtNum(totals.sstAmt)}</span>
            </div>
            <div className="flex justify-between text-sm font-semibold border-t border-border pt-2">
              <span>Grand total</span>
              <span className="font-mono">MYR {fmtNum(totals.grandTotal)}</span>
            </div>
            <div className="border-t border-border/50 pt-2 space-y-1">
              <div className="flex justify-between text-xs"><span className="text-muted-foreground">Cost of goods</span><span className="font-mono text-amber-700 dark:text-amber-400">MYR {fmtNum(totals.costTotal)}</span></div>
              <div className="flex justify-between text-xs"><span className="text-muted-foreground">Other expenses</span><span className="font-mono text-amber-700 dark:text-amber-400">MYR {fmtNum(totals.expensesTotal)}</span></div>
              <div className={cn("flex justify-between text-xs font-semibold", profitVal < 0 ? "text-red-600" : "text-green-700 dark:text-green-400")}>
                <span>Profit</span><span className="font-mono">MYR {fmtNum(totals.profit)}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 pt-2 border-t border-border">
            <Button type="submit" disabled={saving} className="gap-1.5 text-xs">{saving ? "Creating…" : "Create Invoice"}</Button>
            <Button type="button" variant="ghost" onClick={onClose} className="text-xs">Cancel</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────

interface Props {
  invoices: InvoiceListRow[];
  categories: DocumentCategoryRow[];
  customerPos: CustomerPo[];
  suppliers: Supplier[];
  members: OrgMemberForInvoice[];
}

export function AdminInvoiceClient({ invoices, categories, customerPos, suppliers, members }: Props) {
  const router = useRouter();
  const [showDrawer, setShowDrawer] = useState(false);

  function handleCreated() {
    setShowDrawer(false);
    router.refresh();
  }

  return (
    <div className="p-6 space-y-6" style={{ background: "var(--color-background-secondary)", minHeight: "100vh" }}>
      <PageHeader
        title="Admin Invoices"
        description="View all invoices and create missing ones to fill sequence gaps"
        action={
          <Button size="sm" onClick={() => setShowDrawer(true)} className="gap-1.5 text-xs h-8">
            <PlusIcon className="w-3.5 h-3.5" /> Create Missing Invoice
          </Button>
        }
      />

      <section className="bg-background border border-border/50 rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border bg-muted/30">
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            All Invoices ({invoices.length})
          </h2>
        </div>

        {invoices.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">No invoices found.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/20 text-xs text-muted-foreground font-medium">
                  <th className="px-4 py-2.5 text-left">Invoice No.</th>
                  <th className="px-4 py-2.5 text-left">Date</th>
                  <th className="px-4 py-2.5 text-left">Customer</th>
                  <th className="px-4 py-2.5 text-left">CPO No.</th>
                  <th className="px-4 py-2.5 text-left">SO No.</th>
                  <th className="px-4 py-2.5 text-left">DO No.</th>
                  <th className="px-4 py-2.5 text-left">Sales Person</th>
                  <th className="px-4 py-2.5 text-right">Amount</th>
                  <th className="px-4 py-2.5 text-left">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {invoices.map((inv) => {
                  const snap = inv.customerSnapshot as any;
                  const custName = snap?.organizationName ?? snap?.name ?? "—";
                  const spName = inv.salesPersonName ?? "—";
                  return (
                    <tr
                      key={inv.id}
                      className="hover:bg-muted/20 transition-colors cursor-pointer"
                      onClick={() => router.push(`/dashboard/fulfillment/invoice/${inv.id}`)}
                    >
                      <td className="px-4 py-2.5 font-mono text-xs font-semibold text-primary whitespace-nowrap">{inv.invoiceNo}</td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">{fmtDate(inv.invoiceDate)}</td>
                      <td className="px-4 py-2.5 text-xs max-w-40 truncate">{custName}</td>
                      <td className="px-4 py-2.5 text-xs font-mono text-muted-foreground whitespace-nowrap">{inv.customerPoNo ?? "—"}</td>
                      <td className="px-4 py-2.5 text-xs font-mono text-muted-foreground whitespace-nowrap">{inv.salesOrderNo ?? "—"}</td>
                      <td className="px-4 py-2.5 text-xs font-mono text-muted-foreground whitespace-nowrap">{inv.deliveryOrderNo ?? "—"}</td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground max-w-30 truncate">{spName}</td>
                      <td className="px-4 py-2.5 text-xs font-mono text-right whitespace-nowrap">MYR {fmtNum(inv.grandTotal)}</td>
                      <td className="px-4 py-2.5">
                        <span className={cn("px-2 py-0.5 rounded-full text-[10px] font-semibold capitalize", STATUS_BADGE[inv.status] ?? STATUS_BADGE.draft)}>
                          {inv.status}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {showDrawer && (
        <CreateDrawer
          categories={categories}
          suppliers={suppliers}
          allCustomerPos={customerPos}
          members={members}
          onClose={() => setShowDrawer(false)}
          onCreated={handleCreated}
        />
      )}
    </div>
  );
}
