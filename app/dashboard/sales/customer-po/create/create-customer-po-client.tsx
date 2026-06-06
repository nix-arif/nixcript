"use client";

import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createCustomerPo } from "@/server/customer-purchase-order";
import { getCustomers } from "@/server/customer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/page-header";
import { Highlight } from "@/components/highlight";
import { ArrowLeftIcon, SearchIcon, XIcon, PaperclipIcon, BuildingIcon } from "lucide-react";

type Customer = Awaited<ReturnType<typeof getCustomers>>[number];

export function CreateCustomerPoClient() {
  const router = useRouter();

  const [custSearch, setCustSearch] = useState("");
  const [custResults, setCustResults] = useState<Customer[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [custCompanyId, setCustCompanyId] = useState<string | undefined>();
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [customerPoNo, setCustomerPoNo] = useState("");
  const [quotationNo, setQuotationNo] = useState("");
  const [salesOrderNo, setSalesOrderNo] = useState("");
  const [amount, setAmount] = useState("0");
  const [currency, setCurrency] = useState("MYR");
  const [receivedDate, setReceivedDate] = useState("");
  const [status, setStatus] = useState("received");
  const [notes, setNotes] = useState("");

  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfKey, setPdfKey] = useState<string | undefined>();
  const [pdfUploading, setPdfUploading] = useState(false);
  const pdfRef = useRef<HTMLInputElement>(null);

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

  async function handlePdfSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPdfFile(file);
    setPdfUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/customer-po/upload", { method: "POST", body: form });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Upload failed (${res.status})`);
      }
      const { key } = await res.json();
      setPdfKey(key);
      toast.success("Document uploaded");
    } catch (e: any) {
      toast.error(e.message || "Failed to upload document");
      setPdfFile(null);
    } finally {
      setPdfUploading(false);
    }
  }

  async function handleSave() {
    if (!customerPoNo.trim()) { toast.error("Customer PO number is required"); return; }
    setSaving(true);
    try {
      await createCustomerPo({
        customerPoNo: customerPoNo.trim(),
        customerId: selectedCustomer?.id,
        customerCompanyId: custCompanyId,
        quotationNo: quotationNo || undefined,
        salesOrderNo: salesOrderNo || undefined,
        amount: amount || "0",
        currency,
        documentKey: pdfKey,
        notes: notes || undefined,
        receivedDate: receivedDate ? new Date(receivedDate) : undefined,
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

  const allCompanies = selectedCustomer?.companies ?? [];

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

      <div className="space-y-5">
        {/* PO Number */}
        <div className="border border-border rounded-xl p-4 space-y-4">
          <h2 className="text-sm font-semibold">PO details</h2>
          <div className="space-y-1.5">
            <Label>Customer PO number <span className="text-destructive">*</span></Label>
            <Input value={customerPoNo} onChange={(e) => setCustomerPoNo(e.target.value)} placeholder="e.g. HOSPITAL-PO-2025-001" className="h-9" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Amount</Label>
              <Input value={amount} onChange={(e) => setAmount(e.target.value)} className="h-9 text-sm" />
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

        {/* Customer */}
        <div className="border border-border rounded-xl p-4">
          <h2 className="text-sm font-semibold mb-3">Customer</h2>
          {selectedCustomer ? (
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <div className="text-sm font-medium">{[selectedCustomer.title, selectedCustomer.name].filter(Boolean).join(" ")}</div>
                {allCompanies.length > 1 && (
                  <select
                    className="mt-2 w-full h-8 rounded-md border border-border bg-background px-2.5 text-sm"
                    value={custCompanyId ?? ""}
                    onChange={(e) => setCustCompanyId(e.target.value || undefined)}
                  >
                    <option value="">Primary / default</option>
                    {allCompanies.map((c) => (
                      <option key={c.id} value={c.id}>{c.organizationName}{c.isPrimary ? " (primary)" : ""}</option>
                    ))}
                  </select>
                )}
                {allCompanies.length === 1 && (
                  <p className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1">
                    <BuildingIcon className="w-3 h-3" /> {allCompanies[0].organizationName}
                  </p>
                )}
              </div>
              <button onClick={() => { setSelectedCustomer(null); setCustCompanyId(undefined); }} className="text-muted-foreground hover:text-foreground">
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
                      className="w-full text-left px-3 py-2 hover:bg-muted/50 transition-colors border-b border-border/30 last:border-0"
                      onClick={() => { setSelectedCustomer(c); setCustSearch(""); setCustResults([]); }}
                    >
                      <div className="text-sm font-medium"><Highlight text={[c.title, c.name].filter(Boolean).join(" ")} query={custSearch} /></div>
                      {c.companies[0]?.organizationName && (
                        <div className="text-[11px] text-muted-foreground"><Highlight text={c.companies[0].organizationName} query={custSearch} /></div>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Document links */}
        <div className="border border-border rounded-xl p-4 space-y-3">
          <h2 className="text-sm font-semibold">Links to our documents</h2>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Our quotation no.</Label>
              <Input value={quotationNo} onChange={(e) => setQuotationNo(e.target.value)} placeholder="BMS-QT-2025-XXXX" className="h-9 text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Our SO no.</Label>
              <Input value={salesOrderNo} onChange={(e) => setSalesOrderNo(e.target.value)} placeholder="BMS-SO-2025-XXXX" className="h-9 text-sm" />
            </div>
          </div>
        </div>

        {/* Document upload */}
        <div className="border border-border rounded-xl p-4">
          <h2 className="text-sm font-semibold mb-3">Attach document (optional)</h2>
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
              <PaperclipIcon className="w-4 h-4" /><span>Attach customer PO (PDF/image)</span>
              <input ref={pdfRef} type="file" accept="application/pdf,image/*" className="hidden" onChange={handlePdfSelect} />
            </label>
          )}
        </div>

        {/* Notes */}
        <div className="space-y-1.5">
          <Label className="text-xs">Notes</Label>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Internal notes..." rows={2} className="text-sm" />
        </div>

        <div className="flex gap-3 pb-8">
          <Button onClick={handleSave} disabled={saving || pdfUploading}>{saving ? "Saving…" : "Record customer PO"}</Button>
          <Button variant="outline" onClick={() => router.push("/dashboard/sales/customer-po")}>Cancel</Button>
        </div>
      </div>
    </div>
  );
}
