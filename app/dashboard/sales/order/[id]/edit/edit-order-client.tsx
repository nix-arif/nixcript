"use client";

import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  updateSalesOrder,
  type SalesOrderItemInput,
  type SalesOrderWithItems,
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

interface LineItem extends SalesOrderItemInput {
  _key: string;
}

const SO_STATUS = ["draft", "confirmed", "fulfilled", "cancelled"] as const;

const SO_STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  confirmed: "Confirmed",
  fulfilled: "Fulfilled",
  cancelled: "Cancelled",
};

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

function toDateInput(d: Date | string | null | undefined): string {
  if (!d) return "";
  const date = new Date(d);
  return date.toISOString().split("T")[0];
}

interface Props {
  order: SalesOrderWithItems;
  members: OrgMember[];
}

export function EditSalesOrderClient({ order, members }: Props) {
  const router = useRouter();
  const snap = order.customerSnapshot as any;

  // ── Quotation ───────────────────────────────────────────────────────────────
  const [qtSearch, setQtSearch] = useState("");
  const [qtResults, setQtResults] = useState<Awaited<ReturnType<typeof searchQuotationsByNo>>>([]);
  const [linkedQuotations, setLinkedQuotations] = useState<{ id: string; quotationNo: string }[]>(
    (order.linkedQuotations as { id: string; quotationNo: string }[] | null) ??
    (order.quotationId && order.quotationNo ? [{ id: order.quotationId, quotationNo: order.quotationNo }] : []),
  );
  const [qtLoading, setQtLoading] = useState(false);
  const qtTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Customer ────────────────────────────────────────────────────────────────
  const initialCustomer: Customer | null = order.customerId && snap
    ? ({
        id: order.customerId,
        title: snap.title ?? null,
        name: snap.name ?? "",
        contactNo: snap.contactNo ?? null,
        email: snap.email ?? null,
        createdAt: new Date(),
        createdByName: null,
        companies: snap.organizationName
          ? [{ id: "__snap__", customerId: order.customerId, organizationName: snap.organizationName, organizationAddress: snap.organizationAddress ?? null, isPrimary: true, createdAt: new Date() }]
          : [],
      } as unknown as Customer)
    : null;

  const [custSearch, setCustSearch] = useState("");
  const [custResults, setCustResults] = useState<Customer[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(initialCustomer);
  const [custCompanyId, setCustCompanyId] = useState<string | undefined>(undefined);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Header ──────────────────────────────────────────────────────────────────
  const [status, setStatus] = useState(order.status ?? "draft");
  const [salesPerson, setSalesPerson] = useState(order.salesPersonName ?? "");
  const [associateSalesPersons, setAssociateSalesPersons] = useState<{ id: string; name: string }[]>(
    (order.associateSalesPersons as { id: string; name: string }[] | null) ?? [],
  );
  const [deliveryDate, setDeliveryDate] = useState(toDateInput(order.deliveryDate));
  const [deliveryAddress, setDeliveryAddress] = useState(order.deliveryAddress ?? "");
  const [notes, setNotes] = useState(order.notes ?? "");

  // ── Pricing ─────────────────────────────────────────────────────────────────
  const [sstPct, setSstPct] = useState(order.sstPct ?? "0");
  const [overallDiscPct, setOverallDiscPct] = useState(order.overallDiscountPct ?? "0");

  // ── Items ───────────────────────────────────────────────────────────────────
  const [items, setItems] = useState<LineItem[]>(
    order.items.length > 0
      ? order.items.map((i) => ({
          _key: crypto.randomUUID(),
          rowNo: i.rowNo,
          productCode: i.productCode ?? "",
          description: i.description ?? "",
          qty: String(i.qty ?? "1"),
          uom: i.uom ?? "",
          unitPrice: String(i.unitPrice ?? "0"),
          discountPct: String(i.discountPct ?? "0"),
          discountAmt: String(i.discountAmt ?? "0"),
          totalPrice: String(i.totalPrice ?? "0"),
        }))
      : [newLine(1)],
  );

  const [saving, setSaving] = useState(false);

  // ── Quotation search ────────────────────────────────────────────────────────

  const handleQtSearch = useCallback((val: string) => {
    setQtSearch(val);
    if (val.length < 2) { setQtResults([]); return; }
    if (qtTimer.current) clearTimeout(qtTimer.current);
    qtTimer.current = setTimeout(async () => {
      const res = await searchQuotationsByNo(val);
      setQtResults(res);
    }, 300);
  }, []);

  async function selectQuotation(qtId: string) {
    if (linkedQuotations.some((q) => q.id === qtId)) {
      setQtSearch(""); setQtResults([]); return;
    }
    setQtSearch("");
    setQtResults([]);
    setQtLoading(true);
    try {
      const qt = await getQuotationForSO(qtId);
      if (!qt) return;
      setLinkedQuotations((prev) => [...prev, { id: qt.id, quotationNo: qt.quotationNo }]);

      // Append items
      const newItems = qt.items.map((item) =>
        calcLine({
          _key: crypto.randomUUID(),
          rowNo: 0,
          productCode: item.productCode ?? "",
          description: item.description ?? "",
          qty: String(item.qty ?? "1"),
          uom: item.uom ?? "",
          unitPrice: String(item.unitPrice ?? "0"),
          discountPct: String(item.discountPct ?? "0"),
          discountAmt: String(item.discountAmt ?? "0"),
          totalPrice: String(item.totalPrice ?? "0"),
        }),
      );
      setItems((prev) => {
        const combined = [...prev, ...newItems];
        return combined.map((i, idx) => ({ ...i, rowNo: idx + 1 }));
      });
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

  // ── Save ────────────────────────────────────────────────────────────────────

  async function handleSave() {
    if (!selectedCustomer) { toast.error("Please select a customer"); return; }
    if (!items.some((i) => i.description || i.productCode)) { toast.error("Add at least one item"); return; }

    setSaving(true);
    try {
      const { subtotal, overallDiscAmt, sstAmt, grand } = calcTotals(items, sstPct, overallDiscPct);
      await updateSalesOrder({
        id: order.id,
        customerId: selectedCustomer.id,
        customerCompanyId: custCompanyId,
        linkedQuotations: linkedQuotations.length > 0 ? linkedQuotations : undefined,
        status,
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
        items: items.map(({ _key, ...rest }) => rest),
      });
      toast.success("Sales order updated");
      router.push(`/dashboard/sales/order/${order.id}`);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  }

  const { subtotal, overallDiscAmt, sstAmt, grand } = calcTotals(items, sstPct, overallDiscPct);
  const allCompanies = selectedCustomer?.companies ?? [];

  return (
    <div className="p-6">
      <PageHeader
        title={order.soNo}
        description="Edit sales order"
        action={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => router.push(`/dashboard/sales/order/${order.id}`)} className="gap-2">
              <ArrowLeftIcon className="w-3.5 h-3.5" /> Back
            </Button>
          </div>
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
              placeholder="Add quotation…"
              className="pl-9 h-9 text-sm"
              disabled={qtLoading}
            />
            {qtLoading && (
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">Loading…</span>
            )}
            {qtResults.length > 0 && (
              <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-background border border-border rounded-lg shadow-lg overflow-hidden">
                {qtResults.map((qt) => {
                  const s = qt.customerSnapshot as any;
                  const custName = s ? [s.title, s.name].filter(Boolean).join(" ") : null;
                  const alreadyLinked = linkedQuotations.some((q) => q.id === qt.id);
                  return (
                    <button
                      key={qt.id}
                      disabled={alreadyLinked}
                      className="w-full text-left px-3 py-2 hover:bg-muted/50 transition-colors border-b border-border/30 last:border-0 disabled:opacity-40"
                      onClick={() => selectQuotation(qt.id)}
                    >
                      <div className="text-sm font-mono font-medium">{qt.quotationNo}{alreadyLinked ? " (added)" : ""}</div>
                      {custName && <div className="text-[11px] text-muted-foreground">{custName}</div>}
                    </button>
                  );
                })}
              </div>
            )}
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
            <div className="space-y-1.5">
              <Label className="text-xs">Status</Label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="w-full h-9 rounded-md border border-border bg-background px-2.5 text-sm"
              >
                {SO_STATUS.map((s) => (
                  <option key={s} value={s}>{SO_STATUS_LABELS[s]}</option>
                ))}
              </select>
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
            <div className="space-y-1.5 col-span-2">
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
          <div className="overflow-x-auto">
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
                  <th className="w-6" />
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item._key} className="border-b border-border/50 last:border-0">
                    <td className="py-1.5 pr-2 text-muted-foreground">{item.rowNo}</td>
                    <td className="py-1.5 pr-2">
                      <Input value={item.productCode ?? ""} onChange={(e) => updateItem(item._key, { productCode: e.target.value })} className="h-7 text-xs" />
                    </td>
                    <td className="py-1.5 pr-2">
                      <Input value={item.description ?? ""} onChange={(e) => updateItem(item._key, { description: e.target.value })} className="h-7 text-xs" />
                    </td>
                    <td className="py-1.5 pr-2">
                      <Input value={item.qty} onChange={(e) => updateItem(item._key, { qty: e.target.value })} className="h-7 text-xs text-right" />
                    </td>
                    <td className="py-1.5 pr-2">
                      <Input value={item.uom ?? ""} onChange={(e) => updateItem(item._key, { uom: e.target.value })} className="h-7 text-xs" placeholder="unit" />
                    </td>
                    <td className="py-1.5 pr-2">
                      <Input value={item.unitPrice ?? "0"} onChange={(e) => updateItem(item._key, { unitPrice: e.target.value })} className="h-7 text-xs text-right" />
                    </td>
                    <td className="py-1.5 pr-2">
                      <Input value={item.discountPct ?? "0"} onChange={(e) => updateItem(item._key, { discountPct: e.target.value })} className="h-7 text-xs text-right" />
                    </td>
                    <td className="py-1.5 pr-2 text-right font-mono tabular-nums text-muted-foreground">
                      {fmt(parseFloat(item.totalPrice ?? "0"))}
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
                  <Input value={overallDiscPct} onChange={(e) => setOverallDiscPct(e.target.value)} className="h-7 w-16 text-xs text-right" />
                  <span className="text-muted-foreground text-xs">%</span>
                </div>
                <span className="tabular-nums font-mono text-muted-foreground">−{fmt(overallDiscAmt)}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground shrink-0">SST</span>
                <div className="flex items-center gap-1">
                  <Input value={sstPct} onChange={(e) => setSstPct(e.target.value)} className="h-7 w-16 text-xs text-right" />
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
          <Button onClick={handleSave} disabled={saving} className="gap-2">
            {saving ? "Saving…" : "Save changes"}
          </Button>
          <Button variant="outline" onClick={() => router.push(`/dashboard/sales/order/${order.id}`)}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
