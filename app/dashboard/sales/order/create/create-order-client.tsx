"use client";

import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  createSalesOrder,
  getSupplierQuotationUploadUrl,
  type SalesOrderItemInput,
} from "@/server/sales-order";
import { getCustomers, type CustomerCompany } from "@/server/customer";
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
  PaperclipIcon,
  XIcon,
  BuildingIcon,
} from "lucide-react";

type Customer = Awaited<ReturnType<typeof getCustomers>>[number];

interface LineItem extends SalesOrderItemInput {
  _key: string;
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

export function CreateSalesOrderClient() {
  const router = useRouter();

  // Customer
  const [custSearch, setCustSearch] = useState("");
  const [custResults, setCustResults] = useState<Customer[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [custCompanyId, setCustCompanyId] = useState<string | undefined>();
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Header
  const [quotationNo, setQuotationNo] = useState("");
  const [salesPerson, setSalesPerson] = useState("");
  const [deliveryDate, setDeliveryDate] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [notes, setNotes] = useState("");

  // Pricing
  const [sstPct, setSstPct] = useState("0");
  const [overallDiscPct, setOverallDiscPct] = useState("0");

  // Items
  const [items, setItems] = useState<LineItem[]>([newLine(1)]);

  // Supplier quotation PDF
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfKey, setPdfKey] = useState<string | undefined>();
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

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

  function selectCustomer(c: Customer) {
    setSelectedCustomer(c);
    setCustSearch("");
    setCustResults([]);
    setCustCompanyId(undefined);
  }

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

  async function handlePdfSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type !== "application/pdf") { toast.error("Only PDF files are allowed"); return; }
    setPdfFile(file);
    setUploading(true);
    try {
      const { key, uploadUrl } = await getSupplierQuotationUploadUrl(file.name);
      await fetch(uploadUrl, { method: "PUT", body: file, headers: { "Content-Type": "application/pdf" } });
      setPdfKey(key);
      toast.success("PDF uploaded");
    } catch {
      toast.error("Failed to upload PDF");
      setPdfFile(null);
    } finally {
      setUploading(false);
    }
  }

  function removePdf() {
    setPdfFile(null);
    setPdfKey(undefined);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function handleSave() {
    if (!selectedCustomer) { toast.error("Please select a customer"); return; }
    if (!items.some((i) => i.description || i.productCode)) { toast.error("Add at least one item"); return; }

    setSaving(true);
    try {
      const { subtotal, overallDiscAmt, sstAmt, grand } = calcTotals(items, sstPct, overallDiscPct);
      await createSalesOrder({
        customerId: selectedCustomer.id,
        customerCompanyId: custCompanyId,
        quotationNo: quotationNo || undefined,
        salesPersonName: salesPerson || undefined,
        deliveryDate: deliveryDate ? new Date(deliveryDate) : undefined,
        deliveryAddress: deliveryAddress || undefined,
        notes: notes || undefined,
        supplierQuotationKey: pdfKey,
        subtotal: subtotal.toFixed(2),
        overallDiscountPct: overallDiscPct,
        overallDiscountAmt: overallDiscAmt.toFixed(2),
        sstPct,
        sst: sstAmt.toFixed(2),
        grandTotal: grand.toFixed(2),
        items: items.map(({ _key, ...rest }) => rest),
      });
      toast.success("Sales order created");
      router.push("/dashboard/sales/order");
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
        title="New Sales Order"
        description="Create a new sales order"
        action={
          <Button variant="outline" size="sm" onClick={() => router.push("/dashboard/sales/order")} className="gap-2">
            <ArrowLeftIcon className="w-3.5 h-3.5" /> Back
          </Button>
        }
      />

      <div className="space-y-6">
        {/* ── Customer ── */}
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

        {/* ── Header info ── */}
        <section className="border border-border rounded-xl p-4">
          <h2 className="text-sm font-semibold mb-3">Order details</h2>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Linked quotation no.</Label>
              <Input
                value={quotationNo}
                onChange={(e) => setQuotationNo(e.target.value)}
                placeholder="e.g. BMS-QT-2025-0001"
                className="h-9 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Sales person</Label>
              <Input
                value={salesPerson}
                onChange={(e) => setSalesPerson(e.target.value)}
                placeholder="Name"
                className="h-9 text-sm"
              />
            </div>
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

        {/* ── Supplier quotation PDF ── */}
        <section className="border border-border rounded-xl p-4">
          <h2 className="text-sm font-semibold mb-3">Supplier quotation PDF (optional)</h2>
          {pdfFile ? (
            <div className="flex items-center gap-2 text-sm">
              <PaperclipIcon className="w-4 h-4 text-muted-foreground" />
              <span className="flex-1 truncate text-[13px]">{pdfFile.name}</span>
              {uploading && <span className="text-xs text-muted-foreground">Uploading…</span>}
              {!uploading && pdfKey && <span className="text-xs text-green-600">Uploaded</span>}
              <button onClick={removePdf} className="text-muted-foreground hover:text-foreground">
                <XIcon className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <label className="flex items-center gap-2 cursor-pointer text-sm text-muted-foreground hover:text-foreground transition-colors">
              <PaperclipIcon className="w-4 h-4" />
              <span>Attach supplier quotation PDF</span>
              <input
                ref={fileRef}
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={handlePdfSelect}
              />
            </label>
          )}
        </section>

        {/* ── Items table ── */}
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
                      <Input
                        value={item.productCode ?? ""}
                        onChange={(e) => updateItem(item._key, { productCode: e.target.value })}
                        className="h-7 text-xs"
                      />
                    </td>
                    <td className="py-1.5 pr-2">
                      <Input
                        value={item.description ?? ""}
                        onChange={(e) => updateItem(item._key, { description: e.target.value })}
                        className="h-7 text-xs"
                      />
                    </td>
                    <td className="py-1.5 pr-2">
                      <Input
                        value={item.qty}
                        onChange={(e) => updateItem(item._key, { qty: e.target.value })}
                        className="h-7 text-xs text-right"
                      />
                    </td>
                    <td className="py-1.5 pr-2">
                      <Input
                        value={item.uom ?? ""}
                        onChange={(e) => updateItem(item._key, { uom: e.target.value })}
                        className="h-7 text-xs"
                        placeholder="unit"
                      />
                    </td>
                    <td className="py-1.5 pr-2">
                      <Input
                        value={item.unitPrice ?? "0"}
                        onChange={(e) => updateItem(item._key, { unitPrice: e.target.value })}
                        className="h-7 text-xs text-right"
                      />
                    </td>
                    <td className="py-1.5 pr-2">
                      <Input
                        value={item.discountPct ?? "0"}
                        onChange={(e) => updateItem(item._key, { discountPct: e.target.value })}
                        className="h-7 text-xs text-right"
                      />
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

        {/* ── Pricing summary ── */}
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
          <Button onClick={handleSave} disabled={saving || uploading} className="gap-2">
            {saving ? "Creating…" : "Create sales order"}
          </Button>
          <Button variant="outline" onClick={() => router.push("/dashboard/sales/order")}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
