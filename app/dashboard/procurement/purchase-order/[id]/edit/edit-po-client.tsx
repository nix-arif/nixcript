"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  updatePurchaseOrder,
  getSalesOrderItemsForPo,
  getPoSupplierQuotationUploadUrl,
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
  PaperclipIcon,
  XIcon,
  SearchIcon,
} from "lucide-react";
import {
  type LineItem,
  newLine,
  calcTotals,
  CURRENCIES,
  detectCurrency,
  fmt,
  useUpdateItem,
  useAddLine,
  useRemoveLine,
  useHandleProductCodeBlur,
  useItemImageHandlers,
  useCleanupOrphanedImages,
  PoItemsTable,
} from "../../_shared/po-item-fields";

interface ApprovedSo { id: string; soNo: string; customerName: string | null }
interface CustomerPoOption { id: string; customerPoNo: string; customerName: string | null; amount: string }

interface Props {
  order: PurchaseOrderWithItems;
  suppliers: Supplier[];
  approvedSos: ApprovedSo[];
  customerPos: CustomerPoOption[];
  updateFn?: typeof updatePurchaseOrder;
  detailHref?: string;
  // Same meaning as on CreatePurchaseOrderClient — gates the OEM columns
  // (sourcing type, design brand/code, emboss code) in PoItemsTable.
  businessType?: string;
  // Attributed to "X edited SPO" badges when the user changes a design/
  // customer field here, same as on create.
  currentUserName?: string;
}

// Every field on the saved item, not just the display-friendly ones — this
// is the actual fix for the bug where editing a PO silently erased sourcing
// type, design brand/code, emboss code, per-item customer, and set group
// off every line, since the old version of this form only ever read 8 of
// the ~25 fields a line item carries. See PurchaseOrderItemInput and
// applyPurchaseOrderUpdate in server/purchase-order.ts — both already fully
// support every field mapped here; the gap was purely on the read side.
function orderItemToLine(i: PurchaseOrderWithItems["items"][number]): LineItem {
  return {
    _key: i.id,
    rowNo: i.rowNo,
    productId: i.productId ?? undefined,
    productCode: i.productCode ?? "",
    description: i.description ?? "",
    qty: i.qty ?? "1",
    uom: i.uom ?? "",
    unitPrice: i.unitPrice ?? "0",
    currency: i.currency ?? "MYR",
    totalPrice: i.totalPrice ?? "0",
    imageKey: i.imageKey ?? undefined,
    _imagePreviewUrl: i.imageUrl ?? undefined,
    descriptionSource: i.descriptionSource ?? undefined,
    isAdditional: i.isAdditional ?? false,
    editedBy: i.editedBy ?? undefined,
    setGroupId: i.setGroupId ?? undefined,
    setGroupLabel: i.setGroupLabel ?? undefined,
    setQty: i.setQty ?? undefined,
    customerId: i.customerId ?? undefined,
    customerOrganizationId: i.customerOrganizationId ?? undefined,
    customerName: i.customerName ?? "",
    customerOrganization: i.customerOrganization ?? "",
    customerPoNo: i.customerPoNo ?? "",
    sourcingType: i.sourcingType ?? undefined,
    designBrandName: i.designBrandName ?? "",
    designBrandCode: i.designBrandCode ?? "",
    privateLabelCode: i.privateLabelCode ?? "",
    designBrandSource: i.designBrandSource ?? undefined,
    privateLabelSource: i.privateLabelSource ?? undefined,
    oemEditedBy: i.oemEditedBy ?? undefined,
  };
}

function toDateInput(d: Date | string | null | undefined): string {
  if (!d) return "";
  return new Date(d).toISOString().split("T")[0];
}

export function EditPurchaseOrderClient({
  order, suppliers, approvedSos, customerPos,
  updateFn = updatePurchaseOrder,
  detailHref,
  businessType = "trading",
  currentUserName = "",
}: Props) {
  const showSourcing = businessType !== "trading";
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
    order.items.length > 0 ? order.items.map(orderItemToLine) : [newLine(1)],
  );

  // PDF
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfKey, setPdfKey] = useState<string | undefined>(order.supplierQuotationKey ?? undefined);
  const [pdfUploading, setPdfUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingSoItems, setLoadingSoItems] = useState(false);

  const committedRef = useRef(false);
  const itemsRef = useRef(items);
  useEffect(() => { itemsRef.current = items; }, [items]);
  useCleanupOrphanedImages(itemsRef, committedRef);

  const updateItem = useUpdateItem(setItems);
  const addLine = useAddLine(setItems);
  const removeLine = useRemoveLine({ itemsRef, setItems });
  const handleProductCodeBlur = useHandleProductCodeBlur({ itemsRef, setItems });
  const { handleItemImage, removeItemImage } = useItemImageHandlers({ itemsRef, updateItem });

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
        items: items.map(({ _key, _imageFile, _imageUploading, _imagePreviewUrl, _imageInherited, _cpoId, _codeEditing, ...rest }) => rest),
      });
      committedRef.current = true;
      toast.success("Purchase order updated");
      router.push(backUrl);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
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
              <button onClick={() => { setSelectedSo(null); setItems([newLine(1)]); }} className="text-muted-foreground hover:text-foreground shrink-0">
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
              <input type="file" accept="application/pdf" className="hidden" onChange={handlePdfSelect} />
            </label>
          )}
        </section>

        {/* ── Items table ── */}
        <PoItemsTable
          items={items}
          showSourcing={showSourcing}
          currency={currency}
          currentUserName={currentUserName}
          loadingSoItems={loadingSoItems}
          updateItem={updateItem}
          addLine={addLine}
          removeLine={removeLine}
          handleProductCodeBlur={handleProductCodeBlur}
          handleItemImage={handleItemImage}
          removeItemImage={removeItemImage}
        />

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
