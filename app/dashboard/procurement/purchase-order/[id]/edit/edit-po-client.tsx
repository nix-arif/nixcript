"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  updatePurchaseOrder,
  getSalesOrderItemsForPo,
  getPoSupplierQuotationUploadUrl,
  getPoItemImageUploadUrl,
  type PurchaseOrderItemInput,
  type PurchaseOrderWithItems,
} from "@/server/purchase-order";
import type { Supplier } from "@/server/supplier";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/page-header";
import { Highlight } from "@/components/highlight";
import { uid } from "@/lib/uid";
import {
  ArrowLeftIcon,
  PlusIcon,
  TrashIcon,
  PaperclipIcon,
  XIcon,
  ImageIcon,
  SearchIcon,
} from "lucide-react";

interface ApprovedSo { id: string; soNo: string; customerName: string | null }
interface CustomerPoOption { id: string; customerPoNo: string; customerName: string | null; amount: string }

interface Props {
  order: PurchaseOrderWithItems;
  suppliers: Supplier[];
  approvedSos: ApprovedSo[];
  customerPos: CustomerPoOption[];
  updateFn?: typeof updatePurchaseOrder;
  detailHref?: string;
}

interface LineItem extends PurchaseOrderItemInput {
  _key: string;
  _imageFile?: File;
  _imageUploading?: boolean;
}

function calcLine(item: LineItem): LineItem {
  const qty = parseFloat(item.qty || "0") || 0;
  const up = parseFloat(item.unitPrice || "0") || 0;
  return { ...item, totalPrice: (qty * up).toFixed(2) };
}

function calcTotals(items: LineItem[], sstPct: string) {
  const subtotal = items.reduce((s, i) => s + parseFloat(i.totalPrice || "0"), 0);
  const sstAmt = (subtotal * (parseFloat(sstPct) || 0)) / 100;
  return { subtotal, sstAmt, grand: subtotal + sstAmt };
}

const CURRENCIES = ["MYR", "USD", "EUR", "SGD", "GBP", "AUD", "JPY", "CNY", "IDR", "THB"];

function detectCurrency(items: { currency?: string | null }[]): string {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const c = item.currency;
    if (c) counts[c] = (counts[c] ?? 0) + 1;
  }
  const [top] = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return top?.[0] ?? "MYR";
}
const fmt = (n: number, currency: string) => `${currency} ${n.toLocaleString("en-MY", { minimumFractionDigits: 2 })}`;

function toDateInput(d: Date | string | null | undefined): string {
  if (!d) return "";
  return new Date(d).toISOString().split("T")[0];
}

export function EditPurchaseOrderClient({
  order, suppliers, approvedSos, customerPos,
  updateFn = updatePurchaseOrder,
  detailHref,
}: Props) {
  const router = useRouter();
  const backUrl = detailHref ?? `/dashboard/procurement/purchase-order/${order.id}`;

  // Supplier (required)
  const [supplierId, setSupplierId] = useState(order.supplierId ?? "");

  // Linked SO
  const existingSo = order.salesOrderId
    ? approvedSos.find((s) => s.id === order.salesOrderId) ?? null
    : null;
  const [selectedSo, setSelectedSo] = useState<ApprovedSo | null>(existingSo);
  const [soSearch, setSoSearch] = useState("");

  // Linked Customer POs
  const [selectedCpos, setSelectedCpos] = useState<CustomerPoOption[]>(() =>
    order.customerPos.map((cp) => {
      const found = customerPos.find((c) => c.id === cp.customerPoId);
      return found ?? { id: cp.customerPoId, customerPoNo: cp.customerPoNo, customerName: null, amount: "0" };
    }),
  );
  const [cpoSearch, setCpoSearch] = useState("");

  // Header
  const [deliveryDate, setDeliveryDate] = useState(toDateInput(order.expectedDeliveryDate));
  const [deliveryAddress, setDeliveryAddress] = useState(order.deliveryAddress ?? "");
  const [notes, setNotes] = useState(order.notes ?? "");
  const [sstPct, setSstPct] = useState(order.sstPct ?? "0");
  const [currency, setCurrency] = useState(order.currency ?? "MYR");

  function handleCurrencyChange(next: string) {
    setCurrency(next);
    setItems((prev) => prev.map((i) => ({ ...i, currency: next })));
  }

  // Items
  const [items, setItems] = useState<LineItem[]>(
    order.items.length > 0
      ? order.items.map((i) => ({
          _key: uid(),
          rowNo: i.rowNo,
          productCode: i.productCode ?? "",
          description: i.description ?? "",
          qty: i.qty ?? "1",
          uom: i.uom ?? "",
          unitPrice: i.unitPrice ?? "0",
          currency: i.currency ?? "MYR",
          totalPrice: i.totalPrice ?? "0",
          imageKey: i.imageKey ?? undefined,
        }))
      : [{ _key: uid(), rowNo: 1, productCode: "", description: "", qty: "1", uom: "", unitPrice: "0", currency: "MYR", totalPrice: "0" }],
  );

  // PDF
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfKey, setPdfKey] = useState<string | undefined>(order.supplierQuotationKey ?? undefined);
  const [pdfUploading, setPdfUploading] = useState(false);
  const pdfRef = useRef<HTMLInputElement>(null);

  const [saving, setSaving] = useState(false);
  const [loadingSoItems, setLoadingSoItems] = useState(false);

  // SO search filter
  const filteredSos = approvedSos.filter((s) => {
    if (!soSearch) return true;
    const q = soSearch.toLowerCase();
    return s.soNo.toLowerCase().includes(q) || s.customerName?.toLowerCase().includes(q);
  });

  // Customer PO search filter (exclude already selected)
  const selectedCpoIds = new Set(selectedCpos.map((c) => c.id));
  const filteredCpos = customerPos.filter((c) => {
    if (selectedCpoIds.has(c.id)) return false;
    if (!cpoSearch) return true;
    const q = cpoSearch.toLowerCase();
    return c.customerPoNo.toLowerCase().includes(q) || c.customerName?.toLowerCase().includes(q);
  });

  function addCpo(cpo: CustomerPoOption) {
    setSelectedCpos((prev) => [...prev, cpo]);
    setCpoSearch("");
  }

  function removeCpo(id: string) {
    setSelectedCpos((prev) => prev.filter((c) => c.id !== id));
  }

  function updateItem(key: string, patch: Partial<LineItem>) {
    setItems((prev) =>
      prev.map((i) => {
        if (i._key !== key) return i;
        const updated = { ...i, ...patch };
        return ["qty", "unitPrice"].some((k) => k in patch) ? calcLine(updated) : updated;
      }),
    );
  }

  function addLine() {
    setItems((prev) => [...prev, { _key: uid(), rowNo: prev.length + 1, productCode: "", description: "", qty: "1", uom: "", unitPrice: "0", currency: "MYR", totalPrice: "0" }]);
  }

  function removeLine(key: string) {
    setItems((prev) => {
      const next = prev.filter((i) => i._key !== key);
      return next.map((i, idx) => ({ ...i, rowNo: idx + 1 }));
    });
  }

  async function handleItemImage(key: string, e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    updateItem(key, { _imageFile: file, _imageUploading: true });
    try {
      const { key: r2Key, uploadUrl } = await getPoItemImageUploadUrl(file.name);
      await fetch(uploadUrl, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
      updateItem(key, { imageKey: r2Key, _imageUploading: false });
      toast.success("Image uploaded");
    } catch {
      toast.error("Failed to upload image");
      updateItem(key, { _imageFile: undefined, _imageUploading: false });
    }
  }

  function removeItemImage(key: string) {
    updateItem(key, { imageKey: undefined, _imageFile: undefined });
  }

  async function handlePdfSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type !== "application/pdf") { toast.error("Only PDF files are allowed"); return; }
    setPdfFile(file);
    setPdfUploading(true);
    try {
      const { key, uploadUrl } = await getPoSupplierQuotationUploadUrl(file.name);
      await fetch(uploadUrl, { method: "PUT", body: file, headers: { "Content-Type": "application/pdf" } });
      setPdfKey(key);
      toast.success("PDF uploaded");
    } catch {
      toast.error("Failed to upload PDF");
      setPdfFile(null);
    } finally {
      setPdfUploading(false);
    }
  }

  function removePdf() {
    setPdfFile(null);
    setPdfKey(undefined);
    if (pdfRef.current) pdfRef.current.value = "";
  }

  async function handleSave() {
    if (!selectedSo) { toast.error("A linked sales order is required"); return; }
    if (!supplierId) { toast.error("Supplier is required"); return; }
    const hasItems = items.some((i) => i.description || i.productCode);
    if (!hasItems) { toast.error("Add at least one item"); return; }
    if (items.some((i) => i._imageUploading)) { toast.error("Please wait for image uploads to finish"); return; }

    setSaving(true);
    try {
      const { subtotal, sstAmt, grand } = calcTotals(items, sstPct);
      await updateFn({
        id: order.id,
        supplierId,
        salesOrderId: selectedSo!.id,
        customerPoIds: selectedCpos.map((c) => c.id),
        supplierQuotationKey: pdfKey,
        currency,
        subtotal: subtotal.toFixed(2),
        sstPct,
        sst: sstAmt.toFixed(2),
        grandTotal: grand.toFixed(2),
        notes: notes || undefined,
        expectedDeliveryDate: deliveryDate ? new Date(deliveryDate) : undefined,
        deliveryAddress: deliveryAddress || undefined,
        items: items.map(({ _key, _imageFile, _imageUploading, ...rest }) => rest),
      });
      toast.success("Purchase order updated");
      router.push(backUrl);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  }

  const existingPdfName = pdfKey?.split("/").pop();
  const { subtotal, sstAmt, grand } = calcTotals(items, sstPct);

  return (
    <div className="p-6">
      <PageHeader
        title={`Edit ${order.poNo}`}
        description="Update draft purchase order"
        action={
          <Button variant="outline" size="sm" onClick={() => router.push(backUrl)} className="gap-2">
            <ArrowLeftIcon className="w-3.5 h-3.5" /> Back
          </Button>
        }
      />

      <div className="space-y-6">
        {/* ── Supplier (required) ── */}
        <section className="border border-border rounded-xl p-4">
          <h2 className="text-sm font-semibold mb-1">
            Supplier <span className="text-destructive">*</span>
          </h2>
          <p className="text-xs text-muted-foreground mb-3">Select the supplier you are purchasing from</p>
          {suppliers.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No suppliers found.{" "}
              <button className="underline" onClick={() => router.push("/dashboard/procurement/supplier")}>
                Add one first.
              </button>
            </p>
          ) : (
            <select
              className={`w-full h-9 rounded-md border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring ${!supplierId ? "border-destructive/50" : "border-border"}`}
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
            >
              <option value="">— Select supplier —</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}{s.registrationNo ? ` (${s.registrationNo})` : ""}
                </option>
              ))}
            </select>
          )}
        </section>

        {/* ── Linked SO (single, optional) ── */}
        <section className="border border-border rounded-xl p-4">
          <h2 className="text-sm font-semibold mb-1">
            Linked Sales Order <span className="text-destructive">*</span>
          </h2>
          <p className="text-xs text-muted-foreground mb-3">Select the approved sales order this PO is raised for</p>
          {selectedSo ? (
            <div className="flex items-center gap-2 bg-muted/30 rounded-lg px-3 py-2">
              <div className="flex-1">
                <span className="text-sm font-mono font-medium">{selectedSo.soNo}</span>
                {selectedSo.customerName && (
                  <span className="text-xs text-muted-foreground ml-2">— {selectedSo.customerName}</span>
                )}
              </div>
              <button onClick={() => { setSelectedSo(null); setItems([{ _key: uid(), rowNo: 1, productCode: "", description: "", qty: "1", uom: "", unitPrice: "0", totalPrice: "0" }]); }} className="text-muted-foreground hover:text-foreground shrink-0">
                <XIcon className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : approvedSos.length === 0 ? (
            <p className="text-xs text-muted-foreground">No approved sales orders available</p>
          ) : (
            <div className="space-y-2">
              <div className="relative">
                <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <Input
                  value={soSearch}
                  onChange={(e) => setSoSearch(e.target.value)}
                  placeholder="Search by SO no. or customer..."
                  className="pl-9 h-8 text-sm"
                />
              </div>
              {(soSearch ? filteredSos : approvedSos).slice(0, 6).map((so) => (
                <button
                  key={so.id}
                  className="w-full text-left px-3 py-2 rounded-lg border border-border hover:bg-muted/40 transition-colors text-sm"
                  onClick={async () => {
                    setSelectedSo(so);
                    setSoSearch("");
                    setLoadingSoItems(true);
                    try {
                      const { items: soItems } = await getSalesOrderItemsForPo(so.id);
                      if (soItems.length > 0) {
                        const detected = detectCurrency(soItems);
                        setCurrency(detected);
                        setItems(soItems.map((si) => ({
                          _key: uid(),
                          rowNo: si.rowNo,
                          productId: si.productId ?? undefined,
                          productCode: si.productCode ?? "",
                          description: si.description ?? "",
                          qty: si.qty,
                          uom: si.uom ?? "",
                          unitPrice: si.unitPrice ?? "0",
                          currency: detected,
                          totalPrice: si.totalPrice ?? "0",
                          imageKey: si.imageKey ?? undefined,
                        })));
                      }
                    } catch {
                      toast.error("Failed to load SO items");
                    } finally {
                      setLoadingSoItems(false);
                    }
                  }}
                >
                  <span className="font-mono font-medium">
                    <Highlight text={so.soNo} query={soSearch} />
                  </span>
                  {so.customerName && (
                    <span className="text-xs text-muted-foreground ml-2">
                      — <Highlight text={so.customerName} query={soSearch} />
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </section>

        {/* ── Linked Customer POs (multi, optional) ── */}
        <section className="border border-border rounded-xl p-4">
          <h2 className="text-sm font-semibold mb-1">Customer Purchase Orders</h2>
          <p className="text-xs text-muted-foreground mb-3">Link customer POs that this purchase order fulfills (optional)</p>

          {selectedCpos.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3">
              {selectedCpos.map((cpo) => (
                <div key={cpo.id} className="flex items-center gap-1.5 bg-muted/40 border border-border rounded-md px-2.5 py-1 text-xs">
                  <span className="font-mono font-medium">{cpo.customerPoNo}</span>
                  {cpo.customerName && <span className="text-muted-foreground">· {cpo.customerName}</span>}
                  <button onClick={() => removeCpo(cpo.id)} className="text-muted-foreground hover:text-foreground ml-0.5">
                    <XIcon className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {customerPos.length === 0 ? (
            <p className="text-xs text-muted-foreground">No active customer POs available</p>
          ) : (
            <div className="space-y-2">
              <div className="relative">
                <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <Input
                  value={cpoSearch}
                  onChange={(e) => setCpoSearch(e.target.value)}
                  placeholder="Search by customer PO no. or customer..."
                  className="pl-9 h-8 text-sm"
                />
              </div>
              {filteredCpos.slice(0, 6).map((cpo) => (
                <button
                  key={cpo.id}
                  className="w-full text-left px-3 py-2 rounded-lg border border-border hover:bg-muted/40 transition-colors text-sm"
                  onClick={() => addCpo(cpo)}
                >
                  <span className="font-mono font-medium">
                    <Highlight text={cpo.customerPoNo} query={cpoSearch} />
                  </span>
                  {cpo.customerName && (
                    <span className="text-xs text-muted-foreground ml-2">
                      — <Highlight text={cpo.customerName} query={cpoSearch} />
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground ml-2">MYR {parseFloat(cpo.amount).toLocaleString("en-MY", { minimumFractionDigits: 2 })}</span>
                </button>
              ))}
            </div>
          )}
        </section>

        {/* ── Header info ── */}
        <section className="border border-border rounded-xl p-4">
          <h2 className="text-sm font-semibold mb-3">Order details</h2>
          <div className="grid grid-cols-3 gap-3 mb-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Currency</Label>
              <select
                value={currency}
                onChange={(e) => handleCurrencyChange(e.target.value)}
                className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Expected delivery date</Label>
              <input
                type="date"
                value={deliveryDate}
                onChange={(e) => setDeliveryDate(e.target.value)}
                className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Delivery address</Label>
              <Input value={deliveryAddress} onChange={(e) => setDeliveryAddress(e.target.value)} placeholder="Address" className="h-9 text-sm" />
            </div>
          </div>
          <div className="mt-3 space-y-1.5">
            <Label className="text-xs">Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Internal notes or delivery instructions..." rows={2} className="text-sm" />
          </div>
        </section>

        {/* ── Supplier quotation PDF ── */}
        <section className="border border-border rounded-xl p-4">
          <h2 className="text-sm font-semibold mb-3">Supplier quotation PDF (optional)</h2>
          {pdfFile ? (
            <div className="flex items-center gap-2 text-sm">
              <PaperclipIcon className="w-4 h-4 text-muted-foreground" />
              <span className="flex-1 truncate text-[13px]">{pdfFile.name}</span>
              {pdfUploading && <span className="text-xs text-muted-foreground">Uploading…</span>}
              {!pdfUploading && pdfKey && <span className="text-xs text-green-600">Uploaded</span>}
              <button onClick={removePdf} className="text-muted-foreground hover:text-foreground"><XIcon className="w-3.5 h-3.5" /></button>
            </div>
          ) : pdfKey && existingPdfName ? (
            <div className="flex items-center gap-2 text-sm">
              <PaperclipIcon className="w-4 h-4 text-muted-foreground" />
              <span className="flex-1 truncate text-[13px] text-muted-foreground">{existingPdfName}</span>
              <span className="text-xs text-green-600">Attached</span>
              <button onClick={removePdf} className="text-muted-foreground hover:text-foreground"><XIcon className="w-3.5 h-3.5" /></button>
            </div>
          ) : (
            <label className="flex items-center gap-2 cursor-pointer text-sm text-muted-foreground hover:text-foreground transition-colors">
              <PaperclipIcon className="w-4 h-4" />
              <span>Attach supplier quotation PDF</span>
              <input ref={pdfRef} type="file" accept="application/pdf" className="hidden" onChange={handlePdfSelect} />
            </label>
          )}
        </section>

        {/* ── Items table ── */}
        <section className="border border-border rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold">
              Items
              {loadingSoItems && <span className="ml-2 text-xs font-normal text-muted-foreground">Loading from SO…</span>}
            </h2>
            <Button variant="outline" size="sm" className="gap-1.5 h-7 text-xs" onClick={addLine} disabled={loadingSoItems}>
              <PlusIcon className="w-3 h-3" /> Add row
            </Button>
          </div>

          <div className="space-y-2">
            {items.map((item) => (
              <div key={item._key} className="border border-border/50 rounded-lg p-3">
                <div className="grid grid-cols-12 gap-2 items-start">
                  <div className="col-span-1 pt-1.5 text-xs text-muted-foreground text-center">{item.rowNo}</div>

                  <div className="col-span-4 space-y-1.5">
                    <Input value={item.productCode ?? ""} onChange={(e) => updateItem(item._key, { productCode: e.target.value })} placeholder="Product code" className="h-7 text-xs" />
                    <Input value={item.description ?? ""} onChange={(e) => updateItem(item._key, { description: e.target.value })} placeholder="Description" className="h-7 text-xs" />
                  </div>

                  <div className="col-span-2 space-y-1.5">
                    <Input value={item.qty} onChange={(e) => updateItem(item._key, { qty: e.target.value })} placeholder="Qty" className="h-7 text-xs text-right" />
                    <Input value={item.uom ?? ""} onChange={(e) => updateItem(item._key, { uom: e.target.value })} placeholder="UOM" className="h-7 text-xs" />
                  </div>

                  <div className="col-span-3 space-y-1.5">
                    <div className="flex gap-1">
                      <Input value={item.currency ?? "MYR"} onChange={(e) => updateItem(item._key, { currency: e.target.value.toUpperCase().slice(0, 3) })} className="h-7 text-xs w-14 shrink-0 font-mono" maxLength={3} />
                      <Input value={item.unitPrice ?? "0"} onChange={(e) => updateItem(item._key, { unitPrice: e.target.value })} placeholder="Unit price" className="h-7 text-xs text-right flex-1" />
                    </div>
                    <div className="h-7 px-3 flex items-center justify-end text-xs text-muted-foreground font-mono bg-muted/30 rounded-md">
                      {fmt(parseFloat(item.totalPrice || "0"), currency)}
                    </div>
                  </div>

                  <div className="col-span-2 flex items-start gap-1 pt-0.5">
                    <div className="flex-1">
                      {item.imageKey || item._imageFile ? (
                        <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          <ImageIcon className="w-3 h-3" />
                          <span className="truncate flex-1">
                            {item._imageUploading ? "Uploading…" : (item._imageFile?.name ?? "Image attached")}
                          </span>
                          {!item._imageUploading && (
                            <button onClick={() => removeItemImage(item._key)}><XIcon className="w-3 h-3" /></button>
                          )}
                        </div>
                      ) : (
                        <label className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground cursor-pointer transition-colors">
                          <ImageIcon className="w-3 h-3" />
                          <span>Add image</span>
                          <input type="file" accept="image/*" className="hidden" onChange={(e) => handleItemImage(item._key, e)} />
                        </label>
                      )}
                    </div>
                    <button onClick={() => removeLine(item._key)} disabled={items.length === 1} className="text-muted-foreground hover:text-destructive transition-colors disabled:opacity-30 mt-0.5">
                      <TrashIcon className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── Pricing summary ── */}
        <section className="border border-border rounded-xl p-4">
          <h2 className="text-sm font-semibold mb-3">Pricing</h2>
          <div className="flex justify-end">
            <div className="w-64 space-y-2 text-sm">
              <div className="flex justify-between text-muted-foreground">
                <span>Subtotal</span>
                <span className="tabular-nums font-mono">{fmt(subtotal, currency)}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground shrink-0">SST</span>
                <div className="flex items-center gap-1">
                  <Input value={sstPct} onChange={(e) => setSstPct(e.target.value)} className="h-7 w-16 text-xs text-right" />
                  <span className="text-muted-foreground text-xs">%</span>
                </div>
                <span className="tabular-nums font-mono text-muted-foreground">{fmt(sstAmt, currency)}</span>
              </div>
              <div className="flex justify-between font-semibold border-t border-border pt-2">
                <span>Grand total</span>
                <span className="tabular-nums font-mono">{fmt(grand, currency)}</span>
              </div>
            </div>
          </div>
        </section>

        {/* ── Actions ── */}
        <div className="flex gap-3 pb-8">
          <Button onClick={handleSave} disabled={saving || pdfUploading || loadingSoItems} className="gap-2">
            {saving ? "Saving…" : "Save changes"}
          </Button>
          <Button variant="outline" onClick={() => router.push(backUrl)}>Cancel</Button>
        </div>
      </div>
    </div>
  );
}
