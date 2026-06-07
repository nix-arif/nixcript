"use client";

import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  updateSalesOrder,
  type SalesOrderItemInput,
  type SalesOrderWithItems,
} from "@/server/sales-order";
import { getCustomers } from "@/server/customer";
import {
  getCustomerPoForSoCreate,
  searchCustomerPosByNo,
  type CustomerPoSearchResult,
} from "@/server/customer-purchase-order";
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
  LinkIcon,
} from "lucide-react";

type Customer = Awaited<ReturnType<typeof getCustomers>>[number];

type LinkedCpo = {
  id: string;
  customerPoNo: string;
  customerId: string | null;
  customerSnapshot: {
    title?: string; name: string; organizationName?: string;
    organizationAddress?: string; email?: string; contactNo?: string;
  } | null;
};

interface LineItem extends SalesOrderItemInput {
  _key: string;
  sourceCustomerPoId: string;
  sourceCustomerPoNo: string;
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
  sourceQuotationId: "",
  sourceCustomerPoId: "",
  sourceCustomerPoNo: "",
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
  return new Date(d).toISOString().split("T")[0];
}

interface Props {
  order: SalesOrderWithItems;
  members: OrgMember[];
}

export function EditSalesOrderClient({ order, members }: Props) {
  const router = useRouter();
  const snap = order.customerSnapshot as any;

  // ── Customer POs ─────────────────────────────────────────────────────────────
  const existingCpoLinks = (order.customerPoLinks as { customerPoId: string; customerPoNo: string }[] | null) ?? [];
  const [linkedCpos, setLinkedCpos] = useState<LinkedCpo[]>(
    existingCpoLinks.map((c) => ({ id: c.customerPoId, customerPoNo: c.customerPoNo, customerId: null, customerSnapshot: null })),
  );
  const [cpoSearch, setCpoSearch] = useState("");
  const [cpoResults, setCpoResults] = useState<CustomerPoSearchResult[]>([]);
  const [cpoHighlight, setCpoHighlight] = useState(-1);
  const [cpoLoading, setCpoLoading] = useState(false);
  const [showAddCpo, setShowAddCpo] = useState(false);
  const cpoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
          sourceQuotationId: i.sourceQuotationId ?? "",
          sourceCustomerPoId: (i as any).sourceCustomerPoId ?? "",
          sourceCustomerPoNo: (i as any).sourceCustomerPoNo ?? "",
        }))
      : [newLine(1)],
  );

  const [saving, setSaving] = useState(false);
  const tableRef = useRef<HTMLDivElement>(null);

  // ── CPO search ──────────────────────────────────────────────────────────────

  const handleCpoSearch = useCallback((val: string) => {
    setCpoSearch(val);
    setCpoHighlight(-1);
    if (val.length < 2) { setCpoResults([]); return; }
    if (cpoTimer.current) clearTimeout(cpoTimer.current);
    cpoTimer.current = setTimeout(async () => {
      setCpoResults(await searchCustomerPosByNo(val));
      setCpoHighlight(-1);
    }, 300);
  }, []);

  function handleCpoKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!cpoResults.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setCpoHighlight((i) => Math.min(i + 1, cpoResults.length - 1)); return; }
    if (e.key === "ArrowUp")   { e.preventDefault(); setCpoHighlight((i) => Math.max(i - 1, 0)); return; }
    if (e.key === "Enter")     { e.preventDefault(); const r = cpoResults[cpoHighlight] ?? cpoResults[0]; if (r) selectCpo(r.id); return; }
    if (e.key === "Escape")    { setCpoResults([]); setCpoHighlight(-1); setShowAddCpo(false); }
  }

  async function selectCpo(cpoId: string) {
    if (linkedCpos.some((c) => c.id === cpoId)) {
      toast.error("This customer PO is already linked");
      setCpoSearch(""); setCpoResults([]);
      return;
    }
    setCpoSearch(""); setCpoResults([]); setCpoLoading(true);
    try {
      const data = await getCustomerPoForSoCreate(cpoId);
      if (!data) return;
      setLinkedCpos((prev) => [...prev, {
        id: data.id,
        customerPoNo: data.customerPoNo,
        customerId: data.customerId,
        customerSnapshot: data.customerSnapshot,
      }]);
      setShowAddCpo(false);
    } catch {
      toast.error("Failed to load customer PO");
    } finally {
      setCpoLoading(false);
    }
  }

  function removeCpo(id: string) {
    setLinkedCpos((prev) => prev.filter((c) => c.id !== id));
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

  async function handleSave() {
    const primaryCustomerId =
      selectedCustomer?.id ??
      linkedCpos.find((c) => c.customerId)?.customerId ??
      null;
    if (!primaryCustomerId) { toast.error("Please select a customer"); return; }
    if (!items.some((i) => i.description || i.productCode)) { toast.error("Add at least one item"); return; }

    setSaving(true);
    try {
      const { subtotal, overallDiscAmt, sstAmt, grand } = calcTotals(items, sstPct, overallDiscPct);
      await updateSalesOrder({
        id: order.id,
        customerId: primaryCustomerId,
        customerCompanyId: selectedCustomer ? custCompanyId : undefined,
        customerPoLinks: linkedCpos.length > 0
          ? linkedCpos.map((c) => ({ customerPoId: c.id, customerPoNo: c.customerPoNo }))
          : undefined,
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
        items: items.map(({ _key, sourceCustomerPoId, sourceCustomerPoNo, ...rest }) => ({
          ...rest,
          sourceCustomerPoId: sourceCustomerPoId || undefined,
          sourceCustomerPoNo: sourceCustomerPoNo || undefined,
        })),
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
  const showCpoColumn = linkedCpos.length > 1;

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

        {/* ── 1. Linked Customer POs ── */}
        <section className="border border-border rounded-xl p-4">
          <h2 className="text-sm font-semibold mb-3">Customer POs</h2>
          <div className="space-y-2">
            {linkedCpos.map((c) => {
              const csnap = c.customerSnapshot;
              const custName = csnap ? [csnap.title, csnap.name].filter(Boolean).join(" ") : null;
              return (
                <div key={c.id} className="flex items-center gap-3 px-3 py-2 bg-muted/40 rounded-lg border border-border">
                  <LinkIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <span className="font-mono text-sm font-medium">{c.customerPoNo}</span>
                    {custName && <span className="text-[11px] text-muted-foreground ml-2">{custName}</span>}
                  </div>
                  <button onClick={() => removeCpo(c.id)} className="text-muted-foreground hover:text-foreground shrink-0">
                    <XIcon className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}

            {(linkedCpos.length === 0 || showAddCpo) && (
              <div className="relative">
                <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none z-10" />
                <Input
                  value={cpoSearch}
                  onChange={(e) => handleCpoSearch(e.target.value)}
                  onKeyDown={handleCpoKeyDown}
                  placeholder={linkedCpos.length === 0 ? "Search customer PO number…" : "Search another customer PO…"}
                  className="pl-9 h-9 text-sm"
                  disabled={cpoLoading}
                />
                {cpoLoading && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">Loading…</span>}
                {showAddCpo && (
                  <button className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() => { setShowAddCpo(false); setCpoSearch(""); setCpoResults([]); }}>
                    <XIcon className="w-3.5 h-3.5" />
                  </button>
                )}
                {cpoResults.length > 0 && (
                  <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-background border border-border rounded-lg shadow-lg overflow-hidden">
                    {cpoResults.map((r, idx) => {
                      const rsnap = r.customerSnapshot as any;
                      const custName = rsnap ? [rsnap.title, rsnap.name].filter(Boolean).join(" ") : null;
                      const alreadyLinked = linkedCpos.some((c) => c.id === r.id);
                      return (
                        <button
                          key={r.id}
                          disabled={alreadyLinked}
                          className={`w-full text-left px-3 py-2 transition-colors border-b border-border/30 last:border-0 disabled:opacity-40 ${idx === cpoHighlight ? "bg-muted" : "hover:bg-muted/50"}`}
                          onClick={() => !alreadyLinked && selectCpo(r.id)}
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-mono font-medium">{r.customerPoNo}</span>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                              r.status === "fulfilled" ? "bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400"
                              : r.status === "cancelled" ? "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400"
                              : "bg-muted text-muted-foreground"}`}>
                              {r.status}
                            </span>
                            {alreadyLinked && <span className="text-[10px] text-muted-foreground">already linked</span>}
                          </div>
                          {custName && <div className="text-[11px] text-muted-foreground mt-0.5">{custName}</div>}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {linkedCpos.length > 0 && !showAddCpo && (
              <button className="text-xs text-primary hover:underline flex items-center gap-1"
                onClick={() => setShowAddCpo(true)}>
                <PlusIcon className="w-3 h-3" /> Add another customer PO
              </button>
            )}

            {linkedCpos.length === 0 && (
              <p className="text-[11px] text-muted-foreground">
                Link customer POs that this sales order fulfils.
              </p>
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
                  {showCpoColumn && (
                    <th className="text-left pb-2 pr-2 w-28">From CPO</th>
                  )}
                  <th className="w-6" />
                </tr>
              </thead>
              <tbody>
                {items.map((item, rowIdx) => {
                  const sourceCpo = item.sourceCustomerPoId
                    ? linkedCpos.find((c) => c.id === item.sourceCustomerPoId)
                    : undefined;
                  const cpoCustomerName = sourceCpo?.customerSnapshot
                    ? [sourceCpo.customerSnapshot.title, sourceCpo.customerSnapshot.name].filter(Boolean).join(" ")
                    : null;
                  return (
                  <tr key={item._key} className="border-b border-border/50 last:border-0">
                    <td className="py-1.5 pr-2 text-muted-foreground">{item.rowNo}</td>
                    <td className="py-1.5 pr-2">
                      <Input data-row={rowIdx} data-col={0} value={item.productCode ?? ""} onChange={(e) => updateItem(item._key, { productCode: e.target.value })} onKeyDown={(e) => handleCellKeyDown(e, rowIdx, 0)} className="h-7 text-xs" />
                    </td>
                    <td className="py-1.5 pr-2">
                      <Input data-row={rowIdx} data-col={1} value={item.description ?? ""} onChange={(e) => updateItem(item._key, { description: e.target.value })} onKeyDown={(e) => handleCellKeyDown(e, rowIdx, 1)} className="h-7 text-xs" />
                    </td>
                    <td className="py-1.5 pr-2">
                      <Input data-row={rowIdx} data-col={2} value={item.qty} onChange={(e) => updateItem(item._key, { qty: e.target.value })} onKeyDown={(e) => handleCellKeyDown(e, rowIdx, 2)} className="h-7 text-xs text-right" />
                    </td>
                    <td className="py-1.5 pr-2">
                      <Input data-row={rowIdx} data-col={3} value={item.uom ?? ""} onChange={(e) => updateItem(item._key, { uom: e.target.value })} onKeyDown={(e) => handleCellKeyDown(e, rowIdx, 3)} className="h-7 text-xs" placeholder="unit" />
                    </td>
                    <td className="py-1.5 pr-2">
                      <Input data-row={rowIdx} data-col={4} value={item.unitPrice ?? "0"} onChange={(e) => updateItem(item._key, { unitPrice: e.target.value })} onKeyDown={(e) => handleCellKeyDown(e, rowIdx, 4)} className="h-7 text-xs text-right" />
                    </td>
                    <td className="py-1.5 pr-2">
                      <Input data-row={rowIdx} data-col={5} value={item.discountPct ?? "0"} onChange={(e) => updateItem(item._key, { discountPct: e.target.value })} onKeyDown={(e) => handleCellKeyDown(e, rowIdx, 5)} className="h-7 text-xs text-right" />
                    </td>
                    <td className="py-1.5 pr-2 text-right font-mono tabular-nums text-muted-foreground">
                      {fmt(parseFloat(item.totalPrice ?? "0"))}
                    </td>
                    {showCpoColumn && (
                      <td className="py-1.5 pr-2">
                        {sourceCpo ? (
                          <div className="space-y-0.5">
                            <span className="inline-block text-[10px] px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 font-mono">
                              {sourceCpo.customerPoNo}
                            </span>
                            {cpoCustomerName && (
                              <p className="text-[10px] text-muted-foreground truncate max-w-25" title={cpoCustomerName}>
                                {cpoCustomerName}
                              </p>
                            )}
                          </div>
                        ) : (
                          <select
                            value={item.sourceCustomerPoId ?? ""}
                            onChange={(e) => {
                              const cpo = linkedCpos.find((c) => c.id === e.target.value);
                              updateItem(item._key, {
                                sourceCustomerPoId: e.target.value || "",
                                sourceCustomerPoNo: cpo?.customerPoNo || "",
                              } as Partial<LineItem>);
                            }}
                            className="h-6 rounded border border-border bg-background px-1 text-[10px] max-w-27.5"
                          >
                            <option value="">— assign —</option>
                            {linkedCpos.map((c) => {
                              const csnap = c.customerSnapshot;
                              const label = csnap
                                ? `${c.customerPoNo} · ${[csnap.title, csnap.name].filter(Boolean).join(" ")}`
                                : c.customerPoNo;
                              return <option key={c.id} value={c.id}>{label}</option>;
                            })}
                          </select>
                        )}
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
