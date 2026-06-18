"use client";

import { useState, useMemo, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  createInvoiceManual,
  type InvoiceListRow,
  type InvoiceItemInput,
  type InvoiceExpenseInput,
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
  PlusIcon,
  XIcon,
  SearchIcon,
  BuildingIcon,
  ChevronDownIcon,
  TrashIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Customer = Awaited<ReturnType<typeof getCustomers>>[number];

interface LineItem extends InvoiceItemInput { _key: string; }

const newLine = (rowNo: number): LineItem => ({
  _key: crypto.randomUUID(), rowNo,
  productCode: "", description: "", qty: "1", uom: "",
  unitPrice: "0", discountPct: "0", discountAmt: "0", totalPrice: "0",
  costUnitPrice: "0", costTotal: "0",
});

function calcLineTotal(unitPrice: string, qty: string, discountPct: string) {
  const up = parseFloat(unitPrice) || 0;
  const q = parseFloat(qty) || 0;
  const dp = parseFloat(discountPct) || 0;
  const gross = up * q;
  const disc = gross * dp / 100;
  return { discountAmt: disc.toFixed(2), totalPrice: (gross - disc).toFixed(2) };
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

interface CreateDrawerProps {
  categories: DocumentCategoryRow[];
  suppliers: Supplier[];
  allCustomerPos: CustomerPo[];
  onClose: () => void;
  onCreated: () => void;
}

function CreateDrawer({ categories, suppliers, allCustomerPos, onClose, onCreated }: CreateDrawerProps) {
  const [manualInvoiceNo, setManualInvoiceNo] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [categoryId, setCategoryId] = useState<string>(() => {
    const def = categories.find((c) => c.isDefault);
    return def?.id ?? (categories[0]?.id ?? "");
  });
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

  // Supplier
  const [selectedSupplierId, setSelectedSupplierId] = useState("");

  // Items
  const [items, setItems] = useState<LineItem[]>([newLine(1)]);

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
        return merged;
      }),
    );
  }

  const grandTotal = useMemo(() => {
    return items.reduce((s, i) => s + (parseFloat(i.totalPrice ?? "0") || 0), 0).toFixed(2);
  }, [items]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!manualInvoiceNo.trim()) { toast.error("Invoice number is required"); return; }
    if (!categoryId) { toast.error("Category is required"); return; }
    setSaving(true);
    try {
      const selectedPo = customerPos.find((p) => p.id === selectedCustomerPoId);
      await createInvoiceManual({
        manualInvoiceNo: manualInvoiceNo.trim(),
        invoiceDate: invoiceDate ? new Date(invoiceDate) : undefined,
        customerId: selectedCustomer?.id,
        customerOrgMemberId: custOrgMemberId,
        customerPoId: selectedCustomerPoId || undefined,
        customerPoNo: selectedPo?.customerPoNo ?? (manualPoNo || undefined),
        supplierId: selectedSupplierId || undefined,
        categoryIds: categoryId ? [categoryId] : [],
        status,
        paymentTerms: paymentTerms || undefined,
        notes: notes || undefined,
        grandTotal,
        subtotal: grandTotal,
        items: items.map(({ _key, ...rest }) => rest),
        expenses: [],
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

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="flex-1 bg-black/40" onClick={onClose} />
      {/* Drawer */}
      <div className="w-full max-w-xl bg-background border-l border-border flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div>
            <h2 className="text-sm font-semibold">Create Missing Invoice</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Fill in gaps in the invoice sequence with a manual invoice number</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-md hover:bg-muted/50 text-muted-foreground hover:text-foreground">
            <XIcon className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Manual invoice number */}
          <div className="space-y-1.5">
            <Label className="text-xs">
              Invoice Number <span className="text-destructive">*</span>
            </Label>
            <Input
              value={manualInvoiceNo}
              onChange={(e) => setManualInvoiceNo(e.target.value)}
              placeholder="e.g. BMS-INV-2024-0031"
              className="h-9 text-sm font-mono"
              autoFocus
            />
            <p className="text-[11px] text-muted-foreground">
              Must be unique. Use this to backfill missing invoice numbers in the sequence.
            </p>
          </div>

          {/* Invoice date */}
          <div className="space-y-1.5">
            <Label className="text-xs">Invoice Date <span className="text-destructive">*</span></Label>
            <input
              type="date"
              value={invoiceDate}
              onChange={(e) => setInvoiceDate(e.target.value)}
              className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm"
            />
          </div>

          {/* Category */}
          <div className="space-y-1.5">
            <Label className="text-xs">Category <span className="text-destructive">*</span></Label>
            {categories.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">
                No categories yet — create one in Organization → Categories
              </p>
            ) : (
              <div className="relative">
                <select
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                  className="w-full h-9 rounded-md border border-border bg-background px-3 pr-8 text-sm appearance-none"
                >
                  <option value="">— Select category —</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}{c.isDefault ? " (default)" : ""}
                    </option>
                  ))}
                </select>
                <ChevronDownIcon className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              </div>
            )}
          </div>

          {/* Customer */}
          <div className="space-y-1.5">
            <Label className="text-xs">Customer</Label>
            {selectedCustomer ? (
              <div className="flex items-start gap-2 border border-border rounded-md px-3 py-2">
                <div className="flex-1">
                  <p className="text-sm font-medium">{[selectedCustomer.title, selectedCustomer.name].filter(Boolean).join(" ")}</p>
                  {allCompanies.length > 1 && (
                    <select
                      className="mt-1 w-full h-7 rounded border border-border bg-background px-2 text-xs"
                      value={custOrgMemberId ?? ""}
                      onChange={(e) => setCustOrgMemberId(e.target.value || undefined)}
                    >
                      <option value="">Primary / default</option>
                      {allCompanies.map((c) => (
                        <option key={c.id} value={c.id}>{c.organizationName}{c.isPrimary ? " (primary)" : ""}</option>
                      ))}
                    </select>
                  )}
                  {allCompanies.length === 1 && (
                    <p className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1">
                      <BuildingIcon className="w-3 h-3" />{allCompanies[0].organizationName}
                    </p>
                  )}
                </div>
                <button type="button" onClick={() => { setSelectedCustomer(null); setCustomerPos(allCustomerPos); }} className="text-muted-foreground hover:text-foreground">
                  <XIcon className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <div className="relative">
                <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <Input
                  value={custSearch}
                  onChange={(e) => handleCustSearch(e.target.value)}
                  placeholder="Search customer..."
                  className="pl-9 h-9 text-sm"
                />
                {custResults.length > 0 && (
                  <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-background border border-border rounded-lg shadow-lg overflow-hidden">
                    {custResults.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        className="w-full text-left px-3 py-2 hover:bg-muted/50 border-b border-border/30 last:border-0"
                        onClick={() => selectCustomer(c)}
                      >
                        <div className="text-sm font-medium">{[c.title, c.name].filter(Boolean).join(" ")}</div>
                        {c.memberships[0]?.orgName && <div className="text-[11px] text-muted-foreground">{c.memberships[0].orgName}</div>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Customer PO */}
          <div className="space-y-1.5">
            <Label className="text-xs">Customer PO</Label>
            {customerPos.length > 0 ? (
              <div className="space-y-1.5">
                <div className="relative">
                  <select
                    value={selectedCustomerPoId}
                    onChange={(e) => { setSelectedCustomerPoId(e.target.value); if (e.target.value) setManualPoNo(""); }}
                    className="w-full h-9 rounded-md border border-border bg-background px-3 pr-8 text-sm appearance-none"
                  >
                    <option value="">— Select PO (optional) —</option>
                    {customerPos.map((p) => (
                      <option key={p.id} value={p.id}>{p.customerPoNo}</option>
                    ))}
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

          {/* Supplier */}
          <div className="space-y-1.5">
            <Label className="text-xs">Supplier</Label>
            <div className="relative">
              <select
                value={selectedSupplierId}
                onChange={(e) => setSelectedSupplierId(e.target.value)}
                className="w-full h-9 rounded-md border border-border bg-background px-3 pr-8 text-sm appearance-none"
              >
                <option value="">— No supplier —</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
              <ChevronDownIcon className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            </div>
          </div>

          {/* Status & Payment terms */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Status</Label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm"
              >
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

          {/* Notes */}
          <div className="space-y-1.5">
            <Label className="text-xs">Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="text-sm" />
          </div>

          {/* Line items */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Line Items</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setItems((prev) => [...prev, newLine(prev.length + 1)])}
                className="h-6 text-xs gap-1"
              >
                <PlusIcon className="w-3 h-3" /> Add row
              </Button>
            </div>
            <div className="rounded-md border border-border overflow-hidden">
              <div className="grid grid-cols-[2fr_1fr_1fr_1fr_auto] gap-0 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-2 py-1.5 bg-muted/30 border-b border-border">
                <span>Description</span>
                <span>Qty</span>
                <span>Unit Price</span>
                <span>Total</span>
                <span />
              </div>
              {items.map((item) => (
                <div key={item._key} className="grid grid-cols-[2fr_1fr_1fr_1fr_auto] gap-1.5 items-center px-2 py-1.5 border-b border-border/40 last:border-0">
                  <Input
                    value={item.description ?? ""}
                    onChange={(e) => updateItem(item._key, { description: e.target.value })}
                    placeholder="Item description"
                    className="h-7 text-xs border-0 bg-transparent p-0 focus-visible:ring-0 shadow-none"
                  />
                  <Input
                    type="number"
                    value={item.qty ?? "1"}
                    onChange={(e) => updateItem(item._key, { qty: e.target.value })}
                    className="h-7 text-xs"
                    min="0"
                  />
                  <Input
                    type="number"
                    value={item.unitPrice ?? "0"}
                    onChange={(e) => updateItem(item._key, { unitPrice: e.target.value })}
                    className="h-7 text-xs"
                    min="0"
                  />
                  <span className="text-xs font-mono text-right pr-1">
                    {parseFloat(item.totalPrice ?? "0").toFixed(2)}
                  </span>
                  <button
                    type="button"
                    onClick={() => setItems((prev) => prev.filter((i) => i._key !== item._key).map((i, idx) => ({ ...i, rowNo: idx + 1 })))}
                    className="p-1 text-muted-foreground hover:text-red-600"
                    disabled={items.length === 1}
                  >
                    <TrashIcon className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
            <div className="text-right text-xs font-semibold pr-1">
              Grand Total: MYR {fmtNum(grandTotal)}
            </div>
          </div>

          <div className="flex items-center gap-2 pt-2 border-t border-border">
            <Button type="submit" disabled={saving} className="gap-1.5 text-xs">
              {saving ? "Creating…" : "Create Invoice"}
            </Button>
            <Button type="button" variant="ghost" onClick={onClose} className="text-xs">
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface Props {
  invoices: InvoiceListRow[];
  categories: DocumentCategoryRow[];
  customerPos: CustomerPo[];
  suppliers: Supplier[];
}

export function AdminInvoiceClient({ invoices, categories, customerPos, suppliers }: Props) {
  const router = useRouter();
  const [showDrawer, setShowDrawer] = useState(false);

  function handleCreated() {
    setShowDrawer(false);
    router.refresh();
  }

  return (
    <div
      className="p-6 space-y-6"
      style={{ background: "var(--color-background-secondary)", minHeight: "100vh" }}
    >
      <PageHeader
        title="Admin Invoices"
        description="View all invoices and create missing ones to fill sequence gaps"
        action={
          <Button size="sm" onClick={() => setShowDrawer(true)} className="gap-1.5 text-xs h-8">
            <PlusIcon className="w-3.5 h-3.5" />
            Create Missing Invoice
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
                  <th className="px-4 py-2.5 text-right">Amount</th>
                  <th className="px-4 py-2.5 text-left">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {invoices.map((inv) => {
                  const custName = (inv.customerSnapshot as any)?.name ?? "—";
                  return (
                    <tr key={inv.id} className="hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-2.5 font-mono text-xs font-semibold text-primary">
                        {inv.invoiceNo}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                        {fmtDate(inv.invoiceDate)}
                      </td>
                      <td className="px-4 py-2.5 text-xs max-w-[180px] truncate">{custName}</td>
                      <td className="px-4 py-2.5 text-xs font-mono text-right whitespace-nowrap">
                        MYR {fmtNum(inv.grandTotal)}
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className={cn(
                            "px-2 py-0.5 rounded-full text-[10px] font-semibold capitalize",
                            STATUS_BADGE[inv.status] ?? STATUS_BADGE.draft,
                          )}
                        >
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
          onClose={() => setShowDrawer(false)}
          onCreated={handleCreated}
        />
      )}
    </div>
  );
}
