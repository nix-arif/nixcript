"use client";

import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createCustomerPo, type CpoItemInput } from "@/server/customer-purchase-order";
import { getCustomer } from "@/server/customer";
import { searchQuotationsByNo, getQuotationForSO } from "@/server/quotation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/page-header";
import { cn } from "@/lib/utils";
import {
  ArrowLeftIcon, SearchIcon, XIcon, PaperclipIcon,
  BuildingIcon, UserIcon, FileTextIcon, PlusIcon,
} from "lucide-react";

type LinkedQuotation = {
  id: string;
  quotationNo: string;
  grandTotal: string;
  customerId?: string | null;
  customerName?: string | null;
  customerOrg?: string | null;
  customerCompanyId?: string | null;
};

type EditableItem = CpoItemInput & {
  _key: string;
  included: boolean;
  _quotationId: string;
  _quotationNo: string;
};

function calcItemTotal(item: EditableItem): EditableItem {
  const qty  = parseFloat(item.qty        || "0") || 0;
  const up   = parseFloat(item.unitPrice  || "0") || 0;
  const dPct = parseFloat(item.discountPct || "0") || 0;
  const gross = qty * up;
  return { ...item, totalPrice: (gross - (gross * dPct) / 100).toFixed(2) };
}

function sumItems(items: EditableItem[]): string {
  return items
    .filter((i) => i.included)
    .reduce((s, i) => s + (parseFloat(i.totalPrice) || 0), 0)
    .toFixed(2);
}

export function CreateCustomerPoClient() {
  const router = useRouter();

  // ── Quotations (multiple) ──────────────────────────────────────────────────
  const [linkedQuotations, setLinkedQuotations] = useState<LinkedQuotation[]>([]);
  const [showAddSearch,    setShowAddSearch]    = useState(false);
  const [qtSearch,         setQtSearch]         = useState("");
  const [qtResults,        setQtResults]        = useState<Awaited<ReturnType<typeof searchQuotationsByNo>>>([]);
  const [qtHighlight,      setQtHighlight]      = useState(-1);
  const [qtLoading,        setQtLoading]        = useState(false);
  const qtTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Items ──────────────────────────────────────────────────────────────────
  const [items, setItems] = useState<EditableItem[]>([]);

  // ── PO details ─────────────────────────────────────────────────────────────
  const [customerPoNo,   setCustomerPoNo]   = useState("");
  const [amount,         setAmount]         = useState("0");
  const [amountOverride, setAmountOverride] = useState(false);
  const [currency,       setCurrency]       = useState("MYR");
  const [receivedDate,   setReceivedDate]   = useState(new Date().toISOString().split("T")[0]);
  const [deliveryDate,   setDeliveryDate]   = useState("");
  const [status,         setStatus]         = useState("received");
  const [notes,          setNotes]          = useState("");

  // ── PDF ────────────────────────────────────────────────────────────────────
  const [pdfFile,      setPdfFile]      = useState<File | null>(null);
  const [pdfKey,       setPdfKey]       = useState<string | undefined>();
  const [pdfUploading, setPdfUploading] = useState(false);
  const pdfRef = useRef<HTMLInputElement>(null);

  const [saving, setSaving] = useState(false);

  const primaryCustomer = linkedQuotations[0] ?? null;
  const isFirstQuotation = linkedQuotations.length === 0;

  // ── Quotation search ───────────────────────────────────────────────────────

  const handleQtSearch = useCallback((val: string) => {
    setQtSearch(val);
    setQtHighlight(-1);
    if (val.length < 2) { setQtResults([]); return; }
    if (qtTimer.current) clearTimeout(qtTimer.current);
    qtTimer.current = setTimeout(async () => {
      setQtResults(await searchQuotationsByNo(val));
      setQtHighlight(-1);
    }, 300);
  }, []);

  function handleQtKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!qtResults.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setQtHighlight((i) => Math.min(i + 1, qtResults.length - 1)); return; }
    if (e.key === "ArrowUp")   { e.preventDefault(); setQtHighlight((i) => Math.max(i - 1, 0)); return; }
    if (e.key === "Enter")     { e.preventDefault(); const r = qtResults[qtHighlight] ?? qtResults[0]; if (r) selectQuotation(r.id, r.quotationNo); return; }
    if (e.key === "Escape")    { setQtResults([]); setQtHighlight(-1); setShowAddSearch(false); }
  }

  async function selectQuotation(qtId: string, qtNo: string) {
    // Prevent duplicates
    if (linkedQuotations.some((q) => q.id === qtId)) {
      toast.error("This quotation is already linked");
      setQtSearch(""); setQtResults([]);
      return;
    }

    setQtSearch(""); setQtResults([]); setQtLoading(true);
    try {
      const qt = await getQuotationForSO(qtId);
      if (!qt) return;

      let customerName: string | null = null;
      let customerOrg:  string | null = null;
      let customerCompanyId: string | null = null;

      if (qt.customerId) {
        try {
          const cust = await getCustomer(qt.customerId);
          if (cust) {
            customerName = [cust.title, cust.name].filter(Boolean).join(" ");
            const primary = cust.companies.find((c) => c.isPrimary) ?? cust.companies[0];
            customerOrg  = primary?.organizationName ?? null;
            customerCompanyId = primary?.id ?? null;
          }
        } catch {
          const snap = qt.customerSnapshot as any;
          customerName = snap ? [snap.title, snap.name].filter(Boolean).join(" ") : null;
          customerOrg  = snap?.organizationName ?? null;
        }
      } else {
        const snap = qt.customerSnapshot as any;
        customerName = snap ? [snap.title, snap.name].filter(Boolean).join(" ") : null;
        customerOrg  = snap?.organizationName ?? null;
      }

      // Block if customer does not exactly match the primary quotation's customer
      if (primaryCustomer) {
        if (primaryCustomer.customerId !== qt.customerId) {
          toast.error("Cannot link — this quotation belongs to a different customer.");
          return;
        }
      }

      const linked: LinkedQuotation = {
        id: qt.id,
        quotationNo: qt.quotationNo,
        grandTotal: qt.grandTotal,
        customerId: qt.customerId,
        customerName,
        customerOrg,
        customerCompanyId,
      };

      setLinkedQuotations((prev) => [...prev, linked]);

      // Append items from this quotation, tagged with source
      const startRow = items.length;
      const imported: EditableItem[] = qt.items.map((item, idx) => ({
        _key:        crypto.randomUUID(),
        _quotationId: qt.id,
        _quotationNo: qt.quotationNo,
        included:    true,
        rowNo:       startRow + idx + 1,
        productCode: item.productCode  ?? "",
        description: item.description  ?? "",
        qty:         String(item.qty   ?? "1"),
        uom:         item.uom          ?? "",
        unitPrice:   String(item.unitPrice  ?? "0"),
        discountPct: String(item.discountPct ?? "0"),
        totalPrice:  String(item.totalPrice  ?? "0"),
        lineType:    item.lineType ?? "sell",
      }));

      setItems((prev) => {
        const next = [...prev, ...imported];
        if (!amountOverride) setAmount(sumItems(next));
        return next;
      });

      setShowAddSearch(false);
      if (isFirstQuotation && !amountOverride) setAmount(qt.grandTotal);
    } catch (e: any) {
      toast.error(e.message || "Failed to load quotation");
    } finally {
      setQtLoading(false);
    }
  }

  function removeQuotation(qtId: string) {
    setLinkedQuotations((prev) => prev.filter((q) => q.id !== qtId));
    setItems((prev) => {
      const next = prev.filter((i) => i._quotationId !== qtId);
      if (!amountOverride) setAmount(sumItems(next));
      return next;
    });
    if (linkedQuotations.length <= 1) setShowAddSearch(false);
  }

  // ── Item editing ──────────────────────────────────────────────────────────

  function updateItem(key: string, patch: Partial<EditableItem>) {
    setItems((prev) => {
      const next = prev.map((i) => {
        if (i._key !== key) return i;
        const updated = { ...i, ...patch };
        return ["qty", "unitPrice", "discountPct"].some((k) => k in patch) ? calcItemTotal(updated) : updated;
      });
      if (!amountOverride) setAmount(sumItems(next));
      return next;
    });
  }

  function toggleAll(included: boolean) {
    setItems((prev) => {
      const next = prev.map((i) => ({ ...i, included }));
      if (!amountOverride) setAmount(sumItems(next));
      return next;
    });
  }

  // ── PDF upload ─────────────────────────────────────────────────────────────

  async function handlePdfSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPdfFile(file);
    setPdfUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/customer-po/upload", { method: "POST", body: form });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Upload failed (${res.status})`);
      setPdfKey((await res.json()).key);
      toast.success("Document uploaded");
    } catch (e: any) {
      toast.error(e.message || "Failed to upload document");
      setPdfFile(null);
    } finally {
      setPdfUploading(false);
    }
  }

  // ── Save ───────────────────────────────────────────────────────────────────

  async function handleSave() {
    if (linkedQuotations.length === 0) { toast.error("Please link at least one quotation"); return; }
    if (!customerPoNo.trim()) { toast.error("Customer PO number is required"); return; }
    setSaving(true);
    try {
      const primary = linkedQuotations[0];
      await createCustomerPo({
        customerPoNo:    customerPoNo.trim(),
        customerId:      primary.customerId ?? undefined,
        customerCompanyId: primary.customerCompanyId ?? undefined,
        quotationLinks:  linkedQuotations.map((q) => ({ quotationId: q.id, quotationNo: q.quotationNo })),
        items:           items.length > 0
          ? items.filter((i) => i.included).map(({ _key, included, _quotationId, _quotationNo, ...rest }) => rest)
          : undefined,
        amount,
        currency,
        documentKey:     pdfKey,
        notes:           notes || undefined,
        receivedDate:    receivedDate ? new Date(receivedDate) : undefined,
        deliveryDate:    deliveryDate ? new Date(deliveryDate) : undefined,
        status,
      });
      toast.success("Customer PO recorded");
      router.push("/dashboard/sales/customer-po");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  }

  const computedTotal = sumItems(items);
  const showSearch = isFirstQuotation || showAddSearch;

  // Group items by source quotation for display
  const quotationGroups = linkedQuotations.map((q) => ({
    quotation: q,
    items: items.filter((i) => i._quotationId === q.id),
  }));

  return (
    <div className="p-6">
      <PageHeader
        title="Record Customer PO"
        description="Record a purchase order received from a customer"
        action={
          <Button variant="outline" size="sm" onClick={() => router.push("/dashboard/sales/customer-po")} className="gap-2">
            <ArrowLeftIcon className="w-3.5 h-3.5" /> Back
          </Button>
        }
      />

      <div className="space-y-5 max-w-3xl">

        {/* ── 1. Quotations (required, multiple) ── */}
        <div className="border border-border rounded-xl p-4">
          <h2 className="text-sm font-semibold mb-3">
            Our quotation(s) <span className="text-destructive">*</span>
          </h2>

          <div className="space-y-2">

            {/* Linked quotation chips */}
            {linkedQuotations.map((q, idx) => (
              <div key={q.id} className="flex items-center gap-3 px-3 py-2.5 bg-muted/40 rounded-lg border border-border">
                <FileTextIcon className="w-4 h-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="font-mono text-sm font-medium">{q.quotationNo}</span>
                  <span className="text-xs text-muted-foreground ml-2">
                    {parseFloat(q.grandTotal).toLocaleString("en-MY", {
                      style: "currency", currency, minimumFractionDigits: 2,
                    })}
                  </span>
                  {idx === 0 && (
                    <span className="ml-2 text-[10px] text-muted-foreground">(primary)</span>
                  )}
                </div>
                <button onClick={() => removeQuotation(q.id)} className="text-muted-foreground hover:text-foreground shrink-0">
                  <XIcon className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}

            {/* Customer — auto from first quotation (read-only) */}
            {primaryCustomer && (primaryCustomer.customerName || primaryCustomer.customerOrg) && (
              <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-blue-50/50 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-900/30">
                <UserIcon className="w-3.5 h-3.5 text-blue-500 mt-0.5 shrink-0" />
                <div className="min-w-0">
                  {primaryCustomer.customerName && (
                    <p className="text-sm font-medium leading-none">{primaryCustomer.customerName}</p>
                  )}
                  {primaryCustomer.customerOrg && (
                    <p className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1">
                      <BuildingIcon className="w-3 h-3" /> {primaryCustomer.customerOrg}
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Search input — shown for first, or when adding more */}
            {showSearch ? (
              <div className="space-y-1.5">
                <div className="relative">
                <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none z-10" />
                <Input
                  value={qtSearch}
                  onChange={(e) => handleQtSearch(e.target.value)}
                  onKeyDown={handleQtKeyDown}
                  placeholder={isFirstQuotation ? "Search by quotation number…" : "Search another quotation…"}
                  className="pl-9 h-9 text-sm"
                  disabled={qtLoading}
                  autoFocus={isFirstQuotation}
                />
                {qtLoading && (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">Loading…</span>
                )}
                {!isFirstQuotation && (
                  <button
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() => { setShowAddSearch(false); setQtSearch(""); setQtResults([]); }}
                  >
                    <XIcon className="w-3.5 h-3.5" />
                  </button>
                )}
                {qtResults.length > 0 && (
                  <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-background border border-border rounded-lg shadow-lg overflow-hidden">
                    {qtResults.map((qt, idx) => {
                      const snap = qt.customerSnapshot as any;
                      const custName = snap ? [snap.title, snap.name].filter(Boolean).join(" ") : null;
                      const alreadyLinked = linkedQuotations.some((q) => q.id === qt.id);
                      const diffCustomer = !!(
                        primaryCustomer &&
                        primaryCustomer.customerId !== qt.customerId
                      );
                      const disabled = alreadyLinked || diffCustomer;
                      return (
                        <button
                          key={qt.id}
                          disabled={disabled}
                          className={cn(
                            "w-full text-left px-3 py-2 transition-colors border-b border-border/30 last:border-0",
                            disabled ? "opacity-40 cursor-not-allowed" : idx === qtHighlight ? "bg-muted" : "hover:bg-muted/50",
                          )}
                          onClick={() => !disabled && selectQuotation(qt.id, qt.quotationNo)}
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-mono font-medium">{qt.quotationNo}</span>
                            <span className="text-[10px] font-medium text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 rounded px-1.5 py-0.5">
                              Final
                            </span>
                            {alreadyLinked && (
                              <span className="text-[10px] text-muted-foreground">already linked</span>
                            )}
                            {diffCustomer && (
                              <span className="text-[10px] text-destructive">different customer</span>
                            )}
                            {qt.cpoCount > 0 && (
                              <span className="text-[10px] font-medium text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded px-1.5 py-0.5">
                                {qt.cpoCount} CPO{qt.cpoCount !== 1 ? "s" : ""}
                              </span>
                            )}
                            {qt.grandTotal && (
                              <span className="text-[11px] text-muted-foreground ml-auto tabular-nums">
                                {parseFloat(qt.grandTotal).toLocaleString("en-MY", { minimumFractionDigits: 2 })}
                              </span>
                            )}
                          </div>
                          {custName && <div className="text-[11px] text-muted-foreground mt-0.5">{custName}</div>}
                        </button>
                      );
                    })}
                  </div>
                )}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Only finalized quotations appear. Customer and items auto-fill on selection.
                </p>
              </div>
            ) : (
              /* Add another quotation button */
              linkedQuotations.length > 0 && (
                <button
                  className="flex items-center gap-1.5 text-xs text-primary hover:underline mt-1"
                  onClick={() => setShowAddSearch(true)}
                >
                  <PlusIcon className="w-3 h-3" /> Add another quotation
                </button>
              )
            )}
          </div>
        </div>

        {/* ── 2. Items (from quotations, editable) ── */}
        {items.length > 0 && (
          <div className="border border-border rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold">Items</h2>
              <span className="text-[11px] text-muted-foreground">
                {items.filter((i) => i.included).length} of {items.length} selected · edit qty/price to match customer PO
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="pb-2 pr-2 w-6">
                      <input
                        type="checkbox"
                        className="rounded"
                        checked={items.every((i) => i.included)}
                        ref={(el) => { if (el) el.indeterminate = items.some((i) => i.included) && !items.every((i) => i.included); }}
                        onChange={(e) => toggleAll(e.target.checked)}
                        title="Select all / none"
                      />
                    </th>
                    <th className="text-left pb-2 pr-2 w-6">#</th>
                    <th className="text-left pb-2 pr-2 w-20">Code</th>
                    <th className="text-left pb-2 pr-2">Description</th>
                    <th className="text-right pb-2 pr-2 w-20">Qty</th>
                    <th className="text-left pb-2 pr-2 w-12">OUM</th>
                    <th className="text-right pb-2 pr-2 w-24">Unit Price</th>
                    <th className="text-right pb-2 w-24">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {linkedQuotations.length > 1
                    ? quotationGroups.map((group) => (
                        group.items.length === 0 ? null : (
                          <>
                            <tr key={`grp-${group.quotation.id}`}>
                              <td colSpan={8} className="pt-3 pb-1 text-[10px] font-medium text-muted-foreground">
                                from {group.quotation.quotationNo}
                              </td>
                            </tr>
                            {group.items.map((item) => (
                              <ItemRow key={item._key} item={item} updateItem={updateItem} />
                            ))}
                          </>
                        )
                      ))
                    : items.map((item) => (
                        <ItemRow key={item._key} item={item} updateItem={updateItem} />
                      ))
                  }
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={7} className="pt-3 pr-2 text-right text-[11px] text-muted-foreground font-medium">
                      Total ({items.filter((i) => i.included).length} items)
                    </td>
                    <td className="pt-3 text-right tabular-nums font-bold">
                      {parseFloat(computedTotal).toLocaleString("en-MY", { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}

        {/* ── 3. PO details ── */}
        <div className="border border-border rounded-xl p-4 space-y-4">
          <h2 className="text-sm font-semibold">PO details</h2>
          <div className="space-y-1.5">
            <Label>Customer PO number <span className="text-destructive">*</span></Label>
            <Input
              value={customerPoNo}
              onChange={(e) => setCustomerPoNo(e.target.value)}
              placeholder="e.g. HOSPITAL-PO-2025-001"
              className="h-9"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Amount</Label>
              <Input
                type="number" min="0" step="0.01"
                value={amount}
                onChange={(e) => { setAmount(e.target.value); setAmountOverride(true); }}
                className="h-9 text-sm tabular-nums"
              />
              {items.length > 0 && amountOverride && (
                <button
                  className="text-[10px] text-primary"
                  onClick={() => { setAmount(computedTotal); setAmountOverride(false); }}
                >
                  Reset to item total ({computedTotal})
                </button>
              )}
              {items.length > 0 && !amountOverride && (
                <p className="text-[10px] text-muted-foreground">Auto-calculated from items</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Currency</Label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm"
              >
                <option>MYR</option><option>USD</option><option>EUR</option><option>SGD</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Date received</Label>
              <input
                type="date"
                value={receivedDate}
                onChange={(e) => setReceivedDate(e.target.value)}
                className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Due delivery date <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <input
                type="date"
                value={deliveryDate}
                onChange={(e) => setDeliveryDate(e.target.value)}
                className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Status</Label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm"
              >
                <option value="received">Received</option>
                <option value="acknowledged">Acknowledged</option>
                <option value="fulfilled">Fulfilled</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
          </div>
        </div>

        {/* ── 4. Attach document ── */}
        <div className="border border-border rounded-xl p-4">
          <h2 className="text-sm font-semibold mb-3">
            Attach document <span className="text-muted-foreground font-normal text-xs">(optional)</span>
          </h2>
          {pdfFile ? (
            <div className="flex items-center gap-2 text-sm">
              <PaperclipIcon className="w-4 h-4 text-muted-foreground" />
              <span className="flex-1 truncate text-[13px]">{pdfFile.name}</span>
              {pdfUploading && <span className="text-xs text-muted-foreground">Uploading…</span>}
              {!pdfUploading && pdfKey && <span className="text-xs text-green-600">Uploaded</span>}
              <button onClick={() => { setPdfFile(null); setPdfKey(undefined); if (pdfRef.current) pdfRef.current.value = ""; }}>
                <XIcon className="w-3.5 h-3.5 text-muted-foreground" />
              </button>
            </div>
          ) : (
            <label className="flex items-center gap-2 cursor-pointer text-sm text-muted-foreground hover:text-foreground transition-colors">
              <PaperclipIcon className="w-4 h-4" />
              <span>Attach customer PO (PDF / image)</span>
              <input ref={pdfRef} type="file" accept="application/pdf,image/*" className="hidden" onChange={handlePdfSelect} />
            </label>
          )}
        </div>

        {/* ── 5. Notes ── */}
        <div className="space-y-1.5">
          <Label className="text-xs">Notes</Label>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Internal notes…"
            rows={2}
            className="text-sm"
          />
        </div>

        <div className="flex gap-3 pb-8">
          <Button onClick={handleSave} disabled={saving || pdfUploading}>
            {saving ? "Saving…" : "Record customer PO"}
          </Button>
          <Button variant="outline" onClick={() => router.push("/dashboard/sales/customer-po")}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Shared item row ────────────────────────────────────────────────────────

function ItemRow({
  item,
  updateItem,
}: {
  item: EditableItem;
  updateItem: (key: string, patch: Partial<EditableItem>) => void;
}) {
  return (
    <tr className={cn("border-b border-border/40 last:border-0 transition-opacity", !item.included && "opacity-40")}>
      <td className="py-1.5 pr-2">
        <input
          type="checkbox"
          className="rounded"
          checked={item.included}
          onChange={(e) => updateItem(item._key, { included: e.target.checked })}
        />
      </td>
      <td className="py-1.5 pr-2 text-muted-foreground">{item.rowNo}</td>
      <td className="py-1.5 pr-2 font-mono text-muted-foreground truncate max-w-20">{item.productCode || "—"}</td>
      <td className="py-1.5 pr-2 text-[11px]">{item.description || "—"}</td>
      <td className="py-1.5 pr-2">
        <Input
          type="number" min="0" step="any"
          value={item.qty}
          disabled={!item.included}
          onChange={(e) => updateItem(item._key, { qty: e.target.value })}
          className="h-7 text-xs text-right tabular-nums w-20 ml-auto"
        />
      </td>
      <td className="py-1.5 pr-2 text-muted-foreground">{item.uom || "—"}</td>
      <td className="py-1.5 pr-2">
        <Input
          type="number" min="0" step="any"
          value={item.unitPrice}
          disabled={!item.included}
          onChange={(e) => updateItem(item._key, { unitPrice: e.target.value })}
          className="h-7 text-xs text-right tabular-nums w-24 ml-auto"
        />
      </td>
      <td className="py-1.5 text-right tabular-nums font-medium">
        {item.included
          ? parseFloat(item.totalPrice).toLocaleString("en-MY", { minimumFractionDigits: 2 })
          : "—"}
      </td>
    </tr>
  );
}
