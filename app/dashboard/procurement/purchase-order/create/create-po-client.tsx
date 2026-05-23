"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  createPurchaseOrder,
  getPoSupplierQuotationUploadUrl,
  getPoItemImageUploadUrl,
  type PurchaseOrderItemInput,
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
  BuildingIcon,
} from "lucide-react";

interface Props {
  suppliers: Supplier[];
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

const fmt = (n: number) => `RM ${n.toLocaleString("en-MY", { minimumFractionDigits: 2 })}`;

export function CreatePurchaseOrderClient({ suppliers }: Props) {
  const router = useRouter();

  // Supplier
  const [supplierId, setSupplierId] = useState("");

  // Header
  const [deliveryDate, setDeliveryDate] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [sstPct, setSstPct] = useState("0");

  // Items
  const [items, setItems] = useState<LineItem[]>([newLine(1)]);

  // Supplier quotation PDF
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfKey, setPdfKey] = useState<string | undefined>();
  const [pdfUploading, setPdfUploading] = useState(false);
  const pdfRef = useRef<HTMLInputElement>(null);

  const [saving, setSaving] = useState(false);

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

  // Item image upload
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

  // PDF upload
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
    const hasItems = items.some((i) => i.description || i.productCode);
    if (!hasItems) { toast.error("Add at least one item"); return; }
    if (items.some((i) => i._imageUploading)) { toast.error("Please wait for image uploads to finish"); return; }

    setSaving(true);
    try {
      const { subtotal, sstAmt, grand } = calcTotals(items, sstPct);
      await createPurchaseOrder({
        supplierId: supplierId || undefined,
        supplierQuotationKey: pdfKey,
        subtotal: subtotal.toFixed(2),
        sstPct,
        sst: sstAmt.toFixed(2),
        grandTotal: grand.toFixed(2),
        notes: notes || undefined,
        expectedDeliveryDate: deliveryDate ? new Date(deliveryDate) : undefined,
        deliveryAddress: deliveryAddress || undefined,
        items: items.map(({ _key, _imageFile, _imageUploading, ...rest }) => rest),
      });
      toast.success("Purchase order created");
      router.push("/dashboard/procurement/purchase-order");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  }

  const { subtotal, sstAmt, grand } = calcTotals(items, sstPct);

  return (
    <div className="p-6">
      <PageHeader
        title="New Purchase Order"
        description="Create a new purchase order to a supplier"
        action={
          <Button variant="outline" size="sm" onClick={() => router.push("/dashboard/procurement/purchase-order")} className="gap-2">
            <ArrowLeftIcon className="w-3.5 h-3.5" /> Back
          </Button>
        }
      />

      <div className="space-y-6">
        {/* ── Supplier ── */}
        <section className="border border-border rounded-xl p-4">
          <h2 className="text-sm font-semibold mb-3">Supplier</h2>
          {suppliers.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No suppliers found.{" "}
              <button
                className="underline"
                onClick={() => router.push("/dashboard/procurement/supplier")}
              >
                Add one first.
              </button>
            </p>
          ) : (
            <select
              className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
            >
              <option value="">— Select supplier (optional) —</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}{s.registrationNo ? ` (${s.registrationNo})` : ""}
                </option>
              ))}
            </select>
          )}
        </section>

        {/* ── Header info ── */}
        <section className="border border-border rounded-xl p-4">
          <h2 className="text-sm font-semibold mb-3">Order details</h2>
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
              placeholder="Internal notes or delivery instructions..."
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
              <input
                ref={pdfRef}
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

          <div className="space-y-2">
            {items.map((item) => (
              <div key={item._key} className="border border-border/50 rounded-lg p-3">
                <div className="grid grid-cols-12 gap-2 items-start">
                  {/* Row no */}
                  <div className="col-span-1 pt-1.5 text-xs text-muted-foreground text-center">{item.rowNo}</div>

                  {/* Code + description */}
                  <div className="col-span-4 space-y-1.5">
                    <Input
                      value={item.productCode ?? ""}
                      onChange={(e) => updateItem(item._key, { productCode: e.target.value })}
                      placeholder="Product code"
                      className="h-7 text-xs"
                    />
                    <Input
                      value={item.description ?? ""}
                      onChange={(e) => updateItem(item._key, { description: e.target.value })}
                      placeholder="Description"
                      className="h-7 text-xs"
                    />
                  </div>

                  {/* Qty + UOM */}
                  <div className="col-span-2 space-y-1.5">
                    <Input
                      value={item.qty}
                      onChange={(e) => updateItem(item._key, { qty: e.target.value })}
                      placeholder="Qty"
                      className="h-7 text-xs text-right"
                    />
                    <Input
                      value={item.uom ?? ""}
                      onChange={(e) => updateItem(item._key, { uom: e.target.value })}
                      placeholder="UOM"
                      className="h-7 text-xs"
                    />
                  </div>

                  {/* Unit price + total */}
                  <div className="col-span-3 space-y-1.5">
                    <Input
                      value={item.unitPrice ?? "0"}
                      onChange={(e) => updateItem(item._key, { unitPrice: e.target.value })}
                      placeholder="Unit price"
                      className="h-7 text-xs text-right"
                    />
                    <div className="h-7 px-3 flex items-center justify-end text-xs text-muted-foreground font-mono bg-muted/30 rounded-md">
                      {fmt(parseFloat(item.totalPrice || "0"))}
                    </div>
                  </div>

                  {/* Image + delete */}
                  <div className="col-span-2 flex items-start gap-1 pt-0.5">
                    <div className="flex-1">
                      {item.imageKey || item._imageFile ? (
                        <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          <ImageIcon className="w-3 h-3" />
                          <span className="truncate flex-1">
                            {item._imageUploading ? "Uploading…" : (item._imageFile?.name ?? "Image attached")}
                          </span>
                          {!item._imageUploading && (
                            <button onClick={() => removeItemImage(item._key)}>
                              <XIcon className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      ) : (
                        <label className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground cursor-pointer transition-colors">
                          <ImageIcon className="w-3 h-3" />
                          <span>Add image</span>
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => handleItemImage(item._key, e)}
                          />
                        </label>
                      )}
                    </div>
                    <button
                      onClick={() => removeLine(item._key)}
                      disabled={items.length === 1}
                      className="text-muted-foreground hover:text-destructive transition-colors disabled:opacity-30 mt-0.5"
                    >
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
                <span className="tabular-nums font-mono">{fmt(subtotal)}</span>
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
          <Button onClick={handleSave} disabled={saving || pdfUploading} className="gap-2">
            {saving ? "Creating…" : "Create purchase order"}
          </Button>
          <Button variant="outline" onClick={() => router.push("/dashboard/procurement/purchase-order")}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
