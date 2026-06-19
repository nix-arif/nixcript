"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { updateDeliveryOrder, type DeliveryOrderItemInput, type DeliveryOrderWithItems } from "@/server/delivery-order";
import { searchProducts } from "@/server/inventory";
import { getCustomers } from "@/server/customer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/page-header";
import { Highlight } from "@/components/highlight";
import { ArrowLeftIcon, PlusIcon, TrashIcon, SearchIcon, XIcon, BuildingIcon } from "lucide-react";

type Customer = Awaited<ReturnType<typeof getCustomers>>[number];
interface LineItem extends DeliveryOrderItemInput { _key: string; }

const newLine = (rowNo: number): LineItem => ({
  _key: crypto.randomUUID(), rowNo, productId: undefined, productCode: "", description: "", qty: "1", uom: "",
});

function toDateInput(d: Date | string | null | undefined): string {
  if (!d) return "";
  return new Date(d).toISOString().split("T")[0];
}

export function EditDeliveryOrderClient({ order }: { order: DeliveryOrderWithItems }) {
  const router = useRouter();
  const backUrl = `/dashboard/fulfillment/delivery/${order.id}`;

  const snap = order.customerSnapshot as any;

  const [custSearch, setCustSearch] = useState("");
  const [custResults, setCustResults] = useState<Customer[]>([]);
  const [selectedCustomerName] = useState<string | null>(snap ? `${snap.title ? snap.title + " " : ""}${snap.name}` : null);
  const [clearCustomer, setClearCustomer] = useState(false);

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [customerPoNo, setCustomerPoNo] = useState(order.customerPoNo ?? "");
  const [salesOrderNo, setSalesOrderNo] = useState(order.salesOrderNo ?? "");
  const [deliveredTo, setDeliveredTo] = useState(order.deliveredTo ?? "");
  const [deliveryAddress, setDeliveryAddress] = useState(order.deliveryAddress ?? "");
  const [deliveryDate, setDeliveryDate] = useState(toDateInput(order.deliveryDate));
  const [notes, setNotes] = useState(order.notes ?? "");

  const [items, setItems] = useState<LineItem[]>(
    order.items.length > 0
      ? order.items.map((i) => ({
          _key: crypto.randomUUID(),
          rowNo: i.rowNo,
          productId: i.productId ?? undefined,
          productCode: i.productCode ?? "",
          description: i.description ?? "",
          qty: i.qty ?? "1",
          uom: i.uom ?? "",
        }))
      : [newLine(1)],
  );

  const [newCustomer, setNewCustomer] = useState<Customer | null>(null);
  const [custOrgMemberId, setCustOrgMemberId] = useState<string | undefined>();
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

  function updateItem(key: string, patch: Partial<LineItem>) {
    setItems((prev) => prev.map((i) => i._key === key ? { ...i, ...patch } : i));
  }

  function DoProductCell({ item }: { item: LineItem }) {
    const [q, setQ] = useState(item.productCode ?? "");
    const [results, setResults] = useState<{ id: string; productCode: string; description: string | null }[]>([]);
    const [open, setOpen] = useState(false);
    const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => { setQ(item.productCode ?? ""); }, [item.productCode]);

    function handleInput(val: string) {
      setQ(val);
      updateItem(item._key, { productCode: val, productId: undefined });
      if (debounce.current) clearTimeout(debounce.current);
      if (!val.trim()) { setResults([]); setOpen(false); return; }
      debounce.current = setTimeout(async () => {
        const r = await searchProducts(val);
        setResults(r);
        setOpen(r.length > 0);
        const exact = r.find((p) => p.productCode.toLowerCase() === val.trim().toLowerCase());
        if (exact) { updateItem(item._key, { productId: exact.id, productCode: exact.productCode, description: item.description || exact.description || "" }); setOpen(false); }
      }, 300);
    }

    function pick(p: { id: string; productCode: string; description: string | null }) {
      updateItem(item._key, { productId: p.id, productCode: p.productCode, description: item.description || p.description || "" });
      setQ(p.productCode);
      setResults([]);
      setOpen(false);
    }

    return (
      <div className="relative">
        <Input value={q} onChange={(e) => handleInput(e.target.value)} className="h-7 text-xs" placeholder="Code…" />
        {open && (
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

  function addLine() { setItems((prev) => [...prev, newLine(prev.length + 1)]); }
  function removeLine(key: string) {
    setItems((prev) => prev.filter((i) => i._key !== key).map((i, idx) => ({ ...i, rowNo: idx + 1 })));
  }

  async function handleSave() {
    if (!items.some((i) => i.description || i.productCode)) { toast.error("Add at least one item"); return; }
    setSaving(true);
    try {
      await updateDeliveryOrder({
        id: order.id,
        customerId: newCustomer?.id ?? (clearCustomer ? undefined : order.customerId ?? undefined),
        customerOrgMemberId: newCustomer ? custOrgMemberId : undefined,
        customerPoNo: customerPoNo || undefined,
        salesOrderNo: salesOrderNo || undefined,
        deliveredTo: deliveredTo || undefined,
        deliveryAddress: deliveryAddress || undefined,
        deliveryDate: deliveryDate ? new Date(deliveryDate) : undefined,
        notes: notes || undefined,
        items: items.map(({ _key, ...rest }) => rest),
      });
      toast.success("Delivery order updated");
      router.push(backUrl);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  }

  const showExistingCustomer = !clearCustomer && !newCustomer && selectedCustomerName;
  const allCompanies = newCustomer?.companies ?? [];

  return (
    <div className="p-6">
      <PageHeader
        title={`Edit ${order.doNo}`}
        description="Update draft delivery order"
        action={
          <Button variant="outline" size="sm" onClick={() => router.push(backUrl)} className="gap-2">
            <ArrowLeftIcon className="w-3.5 h-3.5" /> Back
          </Button>
        }
      />

      <div className="space-y-6">
        {/* Customer */}
        <section className="border border-border rounded-xl p-4">
          <h2 className="text-sm font-semibold mb-3">Customer</h2>
          {showExistingCustomer ? (
            <div className="flex items-center gap-2">
              <span className="flex-1 text-sm">{selectedCustomerName}</span>
              <button onClick={() => setClearCustomer(true)} className="text-muted-foreground hover:text-foreground">
                <XIcon className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : newCustomer ? (
            <div className="flex items-start gap-2">
              <div className="flex-1">
                <div className="text-sm font-medium">{[newCustomer.title, newCustomer.name].filter(Boolean).join(" ")}</div>
                {allCompanies.length > 1 && (
                  <select className="mt-2 w-full h-8 rounded-md border border-border bg-background px-2.5 text-sm" value={custOrgMemberId ?? ""} onChange={(e) => setCustOrgMemberId(e.target.value || undefined)}>
                    <option value="">Primary / default</option>
                    {allCompanies.map((c) => <option key={c.id} value={c.id}>{c.organizationName}{c.isPrimary ? " (primary)" : ""}</option>)}
                  </select>
                )}
                {allCompanies.length === 1 && <p className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1"><BuildingIcon className="w-3 h-3" />{allCompanies[0].organizationName}</p>}
              </div>
              <button onClick={() => { setNewCustomer(null); setCustOrgMemberId(undefined); }} className="text-muted-foreground hover:text-foreground">
                <XIcon className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <div className="relative">
              <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input value={custSearch} onChange={(e) => handleCustSearch(e.target.value)} placeholder="Search customer..." className="pl-9 h-9 text-sm" />
              {custResults.length > 0 && (
                <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-background border border-border rounded-lg shadow-lg overflow-hidden">
                  {custResults.map((c) => (
                    <button key={c.id} className="w-full text-left px-3 py-2 hover:bg-muted/50 transition-colors border-b border-border/30 last:border-0"
                      onClick={() => { setNewCustomer(c); setClearCustomer(false); setCustSearch(""); setCustResults([]); }}>
                      <div className="text-sm font-medium"><Highlight text={[c.title, c.name].filter(Boolean).join(" ")} query={custSearch} /></div>
                      {c.memberships[0]?.orgName && <div className="text-[11px] text-muted-foreground"><Highlight text={c.memberships[0].orgName} query={custSearch} /></div>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>

        {/* Delivery details */}
        <section className="border border-border rounded-xl p-4">
          <h2 className="text-sm font-semibold mb-3">Delivery details</h2>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Customer PO no.</Label>
              <Input value={customerPoNo} onChange={(e) => setCustomerPoNo(e.target.value)} placeholder="Customer PO reference" className="h-9 text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Linked SO no.</Label>
              <Input value={salesOrderNo} onChange={(e) => setSalesOrderNo(e.target.value)} placeholder="BMS-SO-2025-XXXX" className="h-9 text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Delivery date</Label>
              <input type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Delivered to (person)</Label>
              <Input value={deliveredTo} onChange={(e) => setDeliveredTo(e.target.value)} placeholder="Recipient name" className="h-9 text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Delivery address</Label>
              <Input value={deliveryAddress} onChange={(e) => setDeliveryAddress(e.target.value)} placeholder="Address" className="h-9 text-sm" />
            </div>
          </div>
          <div className="mt-3 space-y-1.5">
            <Label className="text-xs">Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="text-sm" />
          </div>
        </section>

        {/* Items */}
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
                  <th className="w-6" />
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item._key} className="border-b border-border/50 last:border-0">
                    <td className="py-1.5 pr-2 text-muted-foreground">{item.rowNo}</td>
                    <td className="py-1.5 pr-2"><DoProductCell item={item} /></td>
                    <td className="py-1.5 pr-2"><Input value={item.description ?? ""} onChange={(e) => updateItem(item._key, { description: e.target.value })} className="h-7 text-xs" /></td>
                    <td className="py-1.5 pr-2"><Input value={item.qty} onChange={(e) => updateItem(item._key, { qty: e.target.value })} className="h-7 text-xs text-right" /></td>
                    <td className="py-1.5 pr-2"><Input value={item.uom ?? ""} onChange={(e) => updateItem(item._key, { uom: e.target.value })} className="h-7 text-xs" placeholder="unit" /></td>
                    <td className="py-1.5">
                      <button onClick={() => removeLine(item._key)} disabled={items.length === 1} className="text-muted-foreground hover:text-destructive transition-colors disabled:opacity-30">
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
          <Button onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Save changes"}</Button>
          <Button variant="outline" onClick={() => router.push(backUrl)}>Cancel</Button>
        </div>
      </div>
    </div>
  );
}
