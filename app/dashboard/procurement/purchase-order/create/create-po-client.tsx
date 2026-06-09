"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  createPurchaseOrder,
  getSalesOrderItemsForPo,
  getPoSupplierQuotationUploadUrl,
  getPoItemImageUploadUrl,
  type PurchaseOrderItemInput,
  type PrForPoConversion,
} from "@/server/purchase-order";
import type { Supplier } from "@/server/supplier";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/page-header";
import {
  ArrowLeftIcon,
  PlusIcon,
  TrashIcon,
  PaperclipIcon,
  XIcon,
  ImageIcon,
  SearchIcon,
  ClipboardListIcon,
  LinkIcon,
} from "lucide-react";
import { Highlight } from "@/components/highlight";

interface ApprovedSo { id: string; soNo: string; customerName: string | null }
interface CustomerPoOption { id: string; customerPoNo: string; customerName: string | null; amount: string }

interface Props {
  suppliers: Supplier[];
  // Direct creation mode
  approvedSos?: ApprovedSo[];
  customerPos?: CustomerPoOption[];
  initialSoId?: string;
  // PR conversion mode
  prData?: PrForPoConversion;
}

interface LineItem extends PurchaseOrderItemInput {
  _key: string;
  _imageFile?: File;
  _imageUploading?: boolean;
}

const newLine = (rowNo: number): LineItem => ({
  _key: crypto.randomUUID(),
  rowNo,
  productCode: "",
  description: "",
  qty: "1",
  uom: "",
  unitPrice: "0",
  currency: "MYR",
  totalPrice: "0",
  imageKey: undefined,
});

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

function prItemToLine(pi: PrForPoConversion["items"][number]): LineItem {
  return {
    _key: crypto.randomUUID(),
    rowNo: pi.rowNo,
    productId: pi.productId ?? undefined,
    productCode: pi.productCode ?? "",
    description: pi.description ?? "",
    qty: pi.qty,
    uom: pi.uom ?? "",
    unitPrice: pi.estimatedUnitCost,
    currency: pi.currency,
    totalPrice: (parseFloat(pi.qty) * parseFloat(pi.estimatedUnitCost)).toFixed(2),
    imageKey: undefined,
  };
}

export function CreatePurchaseOrderClient({ suppliers, approvedSos = [], customerPos = [], initialSoId, prData }: Props) {
  const router = useRouter();
  const isPrMode = !!prData;

  // Keep original PR items for re-filtering when supplier changes
  const prItemsRef = useRef(prData?.items ?? []);

  // Derive initial supplier: pre-select only when all PR items share exactly one preferred supplier
  const initialSupplierId = (() => {
    if (!prData) return "";
    const ids = [...new Set(prData.items.map((i) => i.preferredSupplierId).filter(Boolean))];
    return ids.length === 1 ? (ids[0] ?? "") : "";
  })();

  const [supplierId, setSupplierId] = useState(initialSupplierId);

  // Linked SO (direct mode only)
  const [selectedSo, setSelectedSo] = useState<ApprovedSo | null>(() =>
    initialSoId ? (approvedSos.find((s) => s.id === initialSoId) ?? null) : null,
  );
  const [soSearch, setSoSearch] = useState("");

  // Linked Customer POs (direct mode only)
  const [selectedCpos, setSelectedCpos] = useState<CustomerPoOption[]>([]);
  const [cpoSearch, setCpoSearch] = useState("");

  // Header fields
  const [deliveryDate, setDeliveryDate] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [notes, setNotes] = useState(prData?.notes ?? "");
  const [sstPct, setSstPct] = useState("0");
  const [currency, setCurrency] = useState(() => {
    if (prData) return detectCurrency(prData.items);
    return "MYR";
  });

  function handleCurrencyChange(next: string) {
    setCurrency(next);
    setItems((prev) => prev.map((i) => ({ ...i, currency: next })));
  }

  // Items — in PR mode: filtered by selected supplier; in direct mode: manual or from SO
  const [items, setItems] = useState<LineItem[]>(() => {
    if (isPrMode) {
      if (!initialSupplierId) return [];
      return prItemsRef.current
        .filter((pi) => !pi.preferredSupplierId || pi.preferredSupplierId === initialSupplierId)
        .map(prItemToLine);
    }
    return [newLine(1)];
  });
  const [loadingSoItems, setLoadingSoItems] = useState(false);

  // Supplier change: in PR mode, re-filter items by the new supplier
  function handleSupplierChange(newId: string) {
    setSupplierId(newId);
    if (!isPrMode) return;
    if (!newId) {
      setItems([]);
      return;
    }
    setItems(
      prItemsRef.current
        .filter((pi) => !pi.preferredSupplierId || pi.preferredSupplierId === newId)
        .map(prItemToLine),
    );
  }

  // Auto-load items from SO when arriving with initialSoId (direct mode)
  useEffect(() => {
    if (isPrMode || !initialSoId || !selectedSo) return;
    setLoadingSoItems(true);
    getSalesOrderItemsForPo(initialSoId).then((soItems) => {
      if (soItems.length > 0) {
        const detected = detectCurrency(soItems);
        setCurrency(detected);
        setItems(soItems.map((si) => ({
          _key: crypto.randomUUID(),
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
    }).catch(() => toast.error("Failed to load SO items")).finally(() => setLoadingSoItems(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Supplier quotation PDF
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfKey, setPdfKey] = useState<string | undefined>();
  const [pdfUploading, setPdfUploading] = useState(false);
  const pdfRef = useRef<HTMLInputElement>(null);

  const [saving, setSaving] = useState(false);

  // SO search filter (direct mode)
  const filteredSos = approvedSos.filter((s) => {
    if (!soSearch) return true;
    const q = soSearch.toLowerCase();
    return s.soNo.toLowerCase().includes(q) || s.customerName?.toLowerCase().includes(q);
  });

  // CPO filter (direct mode)
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
    setItems((prev) => [...prev, newLine(prev.length + 1)]);
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

  async function buildAndCreate() {
    if (!supplierId) { toast.error("Supplier is required"); return null; }
    if (!items.some((i) => i.description || i.productCode)) { toast.error("Add at least one item"); return null; }
    if (items.some((i) => i._imageUploading)) { toast.error("Please wait for image uploads to finish"); return null; }

    const { subtotal, sstAmt, grand } = calcTotals(items, sstPct);
    return createPurchaseOrder({
      purchaseRequisitionId: prData?.id,
      supplierId,
      salesOrderId: isPrMode ? (prData?.salesOrderId ?? undefined) : selectedSo?.id,
      customerPoIds: isPrMode ? [] : selectedCpos.map((c) => c.id),
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
  }

  async function handleCreatePo() {
    setSaving(true);
    try {
      const po = await buildAndCreate();
      if (!po) return;
      toast.success(`Purchase order ${po.poNo ?? ""} created`);
      router.push(`/dashboard/procurement/purchase-order/${po.id}`);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  }

  const { subtotal, sstAmt, grand } = calcTotals(items, sstPct);

  const backHref = isPrMode
    ? `/dashboard/procurement/requisition/${prData!.id}`
    : "/dashboard/procurement/purchase-order";

  return (
    <div className="p-6">
      <PageHeader
        title="Create Purchase Order"
        description={
          isPrMode
            ? `Converting ${prData!.prNo} to a supplier purchase order`
            : "Issue a purchase order directly to a supplier"
        }
        action={
          <Button variant="outline" size="sm" onClick={() => router.push(backHref)} className="gap-2">
            <ArrowLeftIcon className="w-3.5 h-3.5" /> Back
          </Button>
        }
      />

      <div className="space-y-6">
        {/* ── PR source banner (PR mode only) ── */}
        {isPrMode && (
          <section className="border border-blue-200 dark:border-blue-800 rounded-xl bg-blue-50/50 dark:bg-blue-900/10 p-4 space-y-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-blue-800 dark:text-blue-300 uppercase tracking-wide">
              <ClipboardListIcon className="w-3.5 h-3.5" /> Source Requisition
            </div>
            <div className="flex items-center gap-4 flex-wrap">
              <span className="font-mono font-medium text-sm">{prData!.prNo}</span>
              {prData!.salesOrderNo && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <LinkIcon className="w-3 h-3" /> {prData!.salesOrderNo}
                </span>
              )}
            </div>
            <p className="text-xs text-blue-700 dark:text-blue-400">
              Select a supplier below — items will be filtered to show only those assigned to that supplier.
            </p>
          </section>
        )}

        {/* ── Supplier (required) ── */}
        <section className="border border-border rounded-xl p-4">
          <h2 className="text-sm font-semibold mb-1">
            Supplier <span className="text-destructive">*</span>
          </h2>
          <p className="text-xs text-muted-foreground mb-3">
            Select the supplier you are issuing this PO to
          </p>
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
              onChange={(e) => handleSupplierChange(e.target.value)}
            >
              <option value="">— Select supplier —</option>
              {isPrMode && (() => {
                const preferred = [...new Map(
                  prData!.items
                    .filter((i) => i.preferredSupplierId)
                    .map((i) => [i.preferredSupplierId, i.preferredSupplierName])
                ).entries()];
                if (preferred.length === 0) return null;
                return (
                  <optgroup label="Preferred suppliers (from PR)">
                    {preferred.map(([id, name]) => (
                      <option key={id} value={id!}>{name}</option>
                    ))}
                  </optgroup>
                );
              })()}
              <optgroup label={isPrMode ? "All suppliers" : "Suppliers"}>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}{s.registrationNo ? ` (${s.registrationNo})` : ""}
                  </option>
                ))}
              </optgroup>
            </select>
          )}
        </section>

        {/* ── Linked SO (direct mode only) ── */}
        {!isPrMode && (
          <section className="border border-border rounded-xl p-4">
            <h2 className="text-sm font-semibold mb-1">Linked Sales Order</h2>
            <p className="text-xs text-muted-foreground mb-3">Optional — link to a confirmed SO if this order is tied to a customer order.</p>
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
                        const soItems = await getSalesOrderItemsForPo(so.id);
                        if (soItems.length > 0) {
                          const detected = detectCurrency(soItems);
                          setCurrency(detected);
                          setItems(soItems.map((si) => ({
                            _key: crypto.randomUUID(),
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
        )}

        {/* ── Linked Customer POs (direct mode only) ── */}
        {!isPrMode && (
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
        )}

        {/* ── Order details ── */}
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
              placeholder="Delivery instructions or notes to supplier…"
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
              {pdfUploading && <span className="text-xs text-muted-foreground">Uploading…</span>}
              {!pdfUploading && pdfKey && <span className="text-xs text-green-600">Uploaded</span>}
              <button onClick={removePdf} className="text-muted-foreground hover:text-foreground">
                <XIcon className="w-3.5 h-3.5" />
              </button>
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
              {isPrMode && supplierId && <span className="ml-2 text-xs font-normal text-muted-foreground">Filtered from requisition — adjust actual prices</span>}
            </h2>
            <Button variant="outline" size="sm" className="gap-1.5 h-7 text-xs" onClick={addLine} disabled={loadingSoItems}>
              <PlusIcon className="w-3 h-3" /> Add row
            </Button>
          </div>

          {isPrMode && !supplierId ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              Select a supplier above to load items from this requisition.
            </p>
          ) : items.length === 0 && isPrMode ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No items assigned to this supplier in the requisition.
            </p>
          ) : (
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
                        {fmt(parseFloat(item.totalPrice || "0"), item.currency ?? currency)}
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
          )}
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
          <Button onClick={handleCreatePo} disabled={saving || pdfUploading || loadingSoItems} className="gap-2">
            {saving ? "Creating…" : "Create Purchase Order"}
          </Button>
          <Button variant="outline" onClick={() => router.push(backHref)}>Cancel</Button>
        </div>
      </div>
    </div>
  );
}
