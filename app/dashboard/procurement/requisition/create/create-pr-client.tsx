"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  createPurchaseRequisition,
  searchSuppliersForPr,
  getSoItemsForPr,
  searchConfirmedSosForPr,
  getPrItemImageUploadUrl,
  deleteProcurementImages,
  type PrItemInput,
} from "@/server/purchase-requisition";
import { toggleSoItemPrExcluded } from "@/server/sales-order";
import { getProductByCode } from "@/server/products";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/page-header";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { ArrowLeftIcon, PlusIcon, TrashIcon, SearchIcon, XIcon, ChevronDownIcon, ImageIcon, UploadIcon, DatabaseIcon, ShoppingCartIcon, PencilIcon, BanIcon, Loader2Icon, FlaskConicalIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { uid } from "@/lib/uid";

const CURRENCIES = ["MYR", "USD", "EUR", "SGD", "GBP", "AUD", "JPY", "CNY", "IDR", "THB"];
const R2_PRODUCT_IMAGES = process.env.NEXT_PUBLIC_R2_PRODUCT_IMAGES_URL ?? "";

const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB

function validateImageFile(file: File): string | null {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    return "Unsupported format — please use JPG, PNG, WebP, or GIF.";
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return `File too large — maximum is 5 MB (this file is ${(file.size / 1024 / 1024).toFixed(1)} MB).`;
  }
  return null;
}

function uploadErrorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(msg)) {
    return "Could not reach the upload server — check your internet connection, or the upload link may have expired. Try again.";
  }
  if (/HTTP 403/i.test(msg)) return "Upload rejected — the upload link has expired. Refresh the page and try again.";
  if (/HTTP 413/i.test(msg)) return "File too large for the server — please use an image under 5 MB.";
  if (/HTTP 4/.test(msg))    return `Upload rejected by server (${msg}) — try a different file.`;
  if (/HTTP 5/.test(msg))    return `Server error (${msg}) — please try again in a moment.`;
  return "Upload failed — please try again.";
}

function ProductImageCell({
  productCode,
  overrideUrl,
  onReplace,
}: {
  productCode: string;
  overrideUrl?: string;
  onReplace: () => void;
}) {
  const [failed, setFailed] = useState(false);
  const [open, setOpen]     = useState(false);
  const src = overrideUrl || (R2_PRODUCT_IMAGES && productCode ? `${R2_PRODUCT_IMAGES}/${encodeURIComponent(productCode)}.jpg` : "");

  // Reset failed when a fresh override URL arrives (e.g. after user uploads a replacement)
  useEffect(() => { if (overrideUrl) setFailed(false); }, [overrideUrl]);

  if (!src || failed) {
    return (
      <button
        type="button"
        onClick={onReplace}
        title="Add image"
        className="w-9 h-9 flex items-center justify-center rounded border border-dashed border-border text-muted-foreground hover:border-foreground hover:text-foreground transition-colors"
      >
        <ImageIcon className="w-3.5 h-3.5" />
      </button>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="View image"
        className="block w-9 h-9 rounded border border-border overflow-hidden hover:opacity-80 transition-opacity"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} className="w-full h-full object-cover" alt="" onError={() => setFailed(true)} />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg p-0 overflow-hidden gap-0" showCloseButton={false}>
          <DialogTitle className="sr-only">{productCode}</DialogTitle>
          <div className="relative bg-muted/30">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} className="w-full object-contain max-h-[65vh]" alt={productCode} onError={() => { setFailed(true); setOpen(false); }} />
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="absolute top-2 right-2 w-7 h-7 flex items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
            >
              <XIcon className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-t">
            <p className="text-xs text-muted-foreground font-mono truncate min-w-0">{productCode}</p>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 shrink-0"
              onClick={() => { setOpen(false); onReplace(); }}
            >
              <UploadIcon className="w-3.5 h-3.5" /> Replace Image
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

type SoOption = { id: string; soNo: string };

// ── Supplier autocomplete ─────────────────────────────────────────────────────

function SupplierCell({
  value,
  onSelect,
  onClear,
}: {
  value: string;
  onSelect: (id: string, name: string) => void;
  onClear: () => void;
}) {
  const [query, setQuery]   = useState(value);
  const [results, setResults] = useState<{ id: string; name: string }[]>([]);
  const [open, setOpen]     = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => { setQuery(value); }, [value]);

  useEffect(() => {
    if (!query.trim() || query === value) { setResults([]); return; }
    const t = setTimeout(async () => {
      const r = await searchSuppliersForPr(query);
      setResults(r);
      setOpen(r.length > 0);
    }, 250);
    return () => clearTimeout(t);
  }, [query, value]);

  useEffect(() => {
    function close(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  return (
    <div ref={ref} className="relative">
      <div className="flex items-center gap-1">
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search supplier…" className="h-7 text-xs" />
        {value && (
          <button onClick={onClear} className="text-muted-foreground hover:text-foreground">
            <XIcon className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {open && (
        <div className="absolute z-50 left-0 top-full mt-1 bg-popover border border-border rounded-lg shadow-lg text-xs w-56 max-h-48 overflow-y-auto">
          {results.map((r) => (
            <button
              key={r.id}
              className="w-full text-left px-3 py-2 hover:bg-muted/50 transition-colors"
              onClick={() => { onSelect(r.id, r.name); setQuery(r.name); setOpen(false); }}
            >
              {r.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Line item ─────────────────────────────────────────────────────────────────

interface LineItem extends PrItemInput {
  _key: string;
  _supplierId?: string;
  _supplierName?: string;
  _cpoId?:                string | null;
  _cpoNo?:                string | null;
  _customerName?:         string | null;
  _customerOrganization?: string | null;
  _imageKey?:        string | null;
  _imagePresignedUrl?: string | null;
  _imageUploading?:  boolean;
  _descriptionSource?: "so" | "catalog" | "user";
  _isAdditional?: boolean;
  _editedBy?: string | null;
  _soItemId?: string | null;
}

const newLine = (rowNo: number): LineItem => ({
  _key: uid(),
  rowNo,
  productCode: "",
  description: "",
  qty: "1",
  uom: "",
  estimatedUnitCost: "0",
  currency: "MYR",
  _imageKey: null,
  _imagePresignedUrl: null,
  _imageUploading: false,
});

function calcTotal(item: LineItem) {
  return ((parseFloat(item.qty || "1") || 1) * (parseFloat(item.estimatedUnitCost || "0") || 0)).toFixed(2);
}

// ── Main form ─────────────────────────────────────────────────────────────────

interface Props {
  initialSoId?: string;
  openSos: SoOption[];
  currentUserName: string;
}

export function CreatePrClient({ initialSoId, openSos, currentUserName }: Props) {
  const router = useRouter();
  const [lines, setLines]         = useState<LineItem[]>([newLine(1)]);
  const [notes, setNotes]         = useState("");
  const [linkedSoId, setLinkedSoId] = useState<string | undefined>(initialSoId);
  const [linkedSoNo, setLinkedSoNo] = useState<string | undefined>();
  const [saving, setSaving]       = useState(false);
  const [loadingSo, setLoadingSo] = useState(false);
  const [togglingExclude, setTogglingExclude] = useState<string | null>(null);
  const [prType, setPrType]       = useState<"customer_order" | "sample_demo">("customer_order");
  const [samplePurpose, setSamplePurpose] = useState("");

  const fileInputRef      = useRef<HTMLInputElement>(null);
  const uploadTargetKey   = useRef<string | null>(null);
  const committedRef      = useRef(false);
  const linesRef          = useRef(lines);
  useEffect(() => { linesRef.current = lines; }, [lines]);
  useEffect(() => {
    return () => {
      if (committedRef.current) return;
      const keys = linesRef.current.flatMap((l) => l._imageKey ? [l._imageKey] : []);
      if (keys.length) deleteProcurementImages(keys).catch(() => {});
    };
  }, []);

  function triggerImageUpload(lineKey: string) {
    uploadTargetKey.current = lineKey;
    fileInputRef.current?.click();
  }

  async function handleImageFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !uploadTargetKey.current) return;
    const key = uploadTargetKey.current;
    e.target.value = "";

    const err = validateImageFile(file);
    if (err) { toast.error(err); return; }

    setLine(key, { _imageUploading: true });
    try {
      const oldKey = linesRef.current.find((l) => l._key === key)?._imageKey;
      const { uploadUrl, key: r2Key } = await getPrItemImageUploadUrl(file.name);
      const res = await fetch(uploadUrl, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (oldKey) deleteProcurementImages([oldKey]).catch(() => {});
      const previewUrl = URL.createObjectURL(file);
      setLine(key, { _imageKey: r2Key, _imagePresignedUrl: previewUrl, _imageUploading: false });
    } catch (err) {
      toast.error(uploadErrorMessage(err));
      setLine(key, { _imageUploading: false });
    }
  }

  const [soDropdownOpen, setSoDropdownOpen] = useState(false);
  const [soSearch, setSoSearch]             = useState("");
  const [soResults, setSoResults]           = useState<SoOption[]>([]);
  const [soHighlight, setSoHighlight]       = useState(-1);
  const [soSearching, setSoSearching]       = useState(false);
  const soTimer       = useRef<ReturnType<typeof setTimeout> | null>(null);
  const soDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function close(e: MouseEvent) {
      if (soDropdownRef.current && !soDropdownRef.current.contains(e.target as Node))
        setSoDropdownOpen(false);
    }
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  useEffect(() => {
    if (!initialSoId) return;
    const existing = openSos.find((s) => s.id === initialSoId);
    importSo(existing?.id ?? initialSoId, existing?.soNo ?? "");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSoSearch = useCallback((val: string) => {
    setSoSearch(val);
    setSoHighlight(-1);
    if (val.length < 2) { setSoResults([]); return; }
    if (soTimer.current) clearTimeout(soTimer.current);
    soTimer.current = setTimeout(async () => {
      setSoSearching(true);
      try { const r = await searchConfirmedSosForPr(val); setSoResults(r); setSoHighlight(-1); }
      finally { setSoSearching(false); }
    }, 300);
  }, []);

  function handleSoKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    const rows = soSearch.length >= 2 ? soResults : openSos.filter((s) => s.id !== linkedSoId);
    if (!rows.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setSoHighlight((i) => Math.min(i + 1, rows.length - 1)); return; }
    if (e.key === "ArrowUp")   { e.preventDefault(); setSoHighlight((i) => Math.max(i - 1, 0)); return; }
    if (e.key === "Enter")     { e.preventDefault(); const r = rows[soHighlight] ?? rows[0]; if (r) selectSo(r); return; }
    if (e.key === "Escape")    { setSoDropdownOpen(false); setSoSearch(""); setSoResults([]); }
  }

  async function importSo(soId: string, soNo: string) {
    setLoadingSo(true);
    try {
      const result = await getSoItemsForPr(soId);
      if (!result) { toast.error("SO not found"); return; }
      setLinkedSoId(soId);
      setLinkedSoNo(result.soNo);
      setLines(result.items.map((i) => ({
        _key: uid(),
        rowNo: i.rowNo,
        productId: i.productId,
        productCode: i.productCode,
        description: i.description,
        qty: i.qty,
        uom: i.uom,
        estimatedUnitCost: String(i.estimatedUnitCost ?? "0"),
        currency: "MYR",
        _supplierId: undefined,
        _supplierName: undefined,
        _cpoId:                i.cpoId,
        _cpoNo:                i.cpoNo,
        _customerName:         i.customerName,
        _customerOrganization: i.customerOrganization,
        _imageKey:          null,
        _imagePresignedUrl: null,
        _imageUploading:    false,
        _descriptionSource: i.description ? "so" : undefined,
        _isAdditional:      i.isAdditional ?? false,
        _editedBy:          i.editedBy ?? null,
        _soItemId:          i.soItemId ?? null,
      })));
      if (result.items.length > 0) toast.success(`Imported ${result.items.length} items from ${result.soNo}`);
    } catch {
      toast.error("Failed to load SO items");
    } finally {
      setLoadingSo(false);
    }
  }

  async function handleExcludeFromPr(key: string, soItemId: string) {
    setTogglingExclude(key);
    try {
      await toggleSoItemPrExcluded(soItemId, true);
      setLines((prev) => prev.filter((l) => l._key !== key));
      toast.success("Item excluded from PR");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setTogglingExclude(null);
    }
  }

  function selectSo(so: SoOption) {
    setSoDropdownOpen(false); setSoSearch(""); setSoResults([]); setSoHighlight(-1);
    if (so.id === linkedSoId) return;
    if (linkedSoId) {
      toast.error("SO is already linked. Remove all items first to change it.");
      return;
    }
    importSo(so.id, so.soNo);
  }

  function unlinkSo() {
    if (lines.length > 0) {
      toast.error("Remove all items before unlinking the SO.");
      return;
    }
    setLinkedSoId(undefined);
    setLinkedSoNo(undefined);
  }

  async function handleProductCodeBlur(key: string, code: string) {
    if (!code.trim()) return;
    const line = linesRef.current.find((l) => l._key === key);
    if (!line || line.description) return;
    const prod = await getProductByCode(code).catch(() => null);
    if (!prod) return;
    setLines((prev) => prev.map((l) =>
      l._key === key && !l.description
        ? { ...l, description: prod.description ?? "", _descriptionSource: "catalog" }
        : l,
    ));
  }

  function setLine(key: string, patch: Partial<LineItem>) {
    setLines((prev) => prev.map((l) => l._key === key ? { ...l, ...patch } : l));
  }

  function addLine() {
    setLines((prev) => [...prev, newLine(prev.length + 1)]);
  }

  function removeLine(key: string) {
    const removedKey = linesRef.current.find((l) => l._key === key)?._imageKey;
    if (removedKey) deleteProcurementImages([removedKey]).catch(() => {});
    setLines((prev) => prev.filter((l) => l._key !== key).map((l, i) => ({ ...l, rowNo: i + 1 })));
  }

  const totalsByCurrency = lines
    .filter((l) => l.description || l.productCode)
    .reduce<Record<string, number>>((acc, l) => {
      const ccy = l.currency ?? "MYR";
      acc[ccy] = (acc[ccy] ?? 0) + parseFloat(calcTotal(l));
      return acc;
    }, {});

  const totalBySupplier = lines
    .filter((l) => l._supplierName)
    .reduce<Record<string, { name: string; currency: string; total: number }>>((acc, l) => {
      const ccy = l.currency ?? "MYR";
      const key = `${l._supplierId ?? l._supplierName}::${ccy}`;
      if (!acc[key]) acc[key] = { name: l._supplierName!, currency: ccy, total: 0 };
      acc[key].total += parseFloat(calcTotal(l));
      return acc;
    }, {});

  async function handleSave() {
    const validLines = lines.filter((l) => l.description || l.productCode);
    if (!validLines.length) { toast.error("Add at least one item"); return; }

    // Auto-derive PR-level CPO: use it only if every filled item shares the same CPO
    const cpoIds = [...new Set(validLines.map((l) => l._cpoId).filter(Boolean))];
    const cpoId  = cpoIds.length === 1 ? cpoIds[0]! : undefined;
    const cpoNo  = cpoId ? validLines.find((l) => l._cpoId === cpoId)?._cpoNo ?? undefined : undefined;

    setSaving(true);
    try {
      const pr = await createPurchaseRequisition({
        salesOrderId: prType === "customer_order" ? linkedSoId : undefined,
        salesOrderNo: prType === "customer_order" ? linkedSoNo : undefined,
        customerPoId: prType === "customer_order" ? cpoId : undefined,
        customerPoNo: prType === "customer_order" ? cpoNo : undefined,
        notes: notes.trim() || undefined,
        prType,
        samplePurpose: prType === "sample_demo" ? (samplePurpose.trim() || undefined) : undefined,
        items: validLines.map((l) => ({
          rowNo: l.rowNo,
          productId: l.productId,
          productCode: l.productCode,
          description: l.description,
          qty: l.qty,
          uom: l.uom,
          estimatedUnitCost: l.estimatedUnitCost,
          currency: l.currency,
          preferredSupplierId: l._supplierId,
          preferredSupplierName: l._supplierName,
          imageKey: l._imageKey ?? undefined,
          descriptionSource: l._descriptionSource ?? null,
          isAdditional: l._isAdditional ?? false,
          editedBy: l._editedBy ?? null,
          cpoNo: l._cpoNo ?? null,
          customerName: l._customerName ?? null,
          customerOrganization: l._customerOrganization ?? null,
        })),
      });
      committedRef.current = true;
      toast.success("Purchase requisition created");
      router.push(`/dashboard/procurement/requisition/${pr.id}`);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  }

  const defaultSoRows = openSos.filter((s) => s.id !== linkedSoId);
  const dropdownRows  = soSearch.length >= 2 ? soResults : defaultSoRows;

  return (
    <div className="p-6 space-y-6">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleImageFileChange}
      />
      <PageHeader
        title="New Purchase Requisition"
        action={
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => router.back()}>
              <ArrowLeftIcon className="w-3.5 h-3.5" /> Back
            </Button>
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : "Create Requisition"}
            </Button>
          </div>
        }
      />

      {/* ── PR Type ── */}
      <section className="border border-border rounded-xl p-5 space-y-3">
        <Label className="text-sm font-semibold">Requisition Type</Label>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => setPrType("customer_order")}
            className={`flex-1 flex flex-col gap-0.5 rounded-lg border px-4 py-3 text-left transition-colors ${prType === "customer_order" ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border hover:border-border/80"}`}
          >
            <span className="text-sm font-semibold">Customer Order</span>
            <span className="text-[11px] text-muted-foreground">Items ordered to fulfil a sales order. Linked to an SO.</span>
          </button>
          <button
            type="button"
            onClick={() => setPrType("sample_demo")}
            className={`flex-1 flex flex-col gap-0.5 rounded-lg border px-4 py-3 text-left transition-colors ${prType === "sample_demo" ? "border-teal-500 bg-teal-50/50 dark:bg-teal-900/10 ring-1 ring-teal-500" : "border-border hover:border-border/80"}`}
          >
            <span className="flex items-center gap-1.5 text-sm font-semibold">
              <FlaskConicalIcon className="w-3.5 h-3.5 text-teal-600" /> Sample / Demo
            </span>
            <span className="text-[11px] text-muted-foreground">Demo units, loaners, or supplier samples. Tracked in separate Demo stock.</span>
          </button>
        </div>
        {prType === "sample_demo" && (
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Purpose (optional)</Label>
            <Input
              value={samplePurpose}
              onChange={(e) => setSamplePurpose(e.target.value)}
              placeholder="e.g. Customer demo for Acme Corp, Trade show loaner stock…"
              className="h-8 text-sm"
            />
          </div>
        )}
      </section>

      {/* ── Sales Order ── */}
      {prType === "customer_order" && (
      <section className="border border-border rounded-xl p-5 space-y-1.5">
        <Label className="text-sm font-semibold">Sales Order</Label>
        <p className="text-[11px] text-muted-foreground pb-1">
          Linking an SO imports all items with their Customer PO tags. Delete any lines you don&apos;t want in this PR.
        </p>

        <div className="relative" ref={soDropdownRef}>
          <div
            className={`min-h-9 flex flex-wrap gap-1.5 items-center px-3 py-2 rounded-md border cursor-pointer transition-colors ${soDropdownOpen ? "border-ring ring-1 ring-ring" : "border-border hover:border-ring/50"}`}
            onClick={() => { if (!linkedSoId && !loadingSo) setSoDropdownOpen((o) => !o); }}
          >
            {linkedSoId ? (
              <span className="flex items-center gap-1.5 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-md px-2 py-0.5 text-xs font-mono text-blue-700 dark:text-blue-300 leading-5">
                {loadingSo ? "Loading…" : linkedSoNo}
                <button className="text-blue-400 hover:text-blue-700 dark:hover:text-blue-200 -mr-0.5" onClick={(e) => { e.stopPropagation(); unlinkSo(); }}>
                  <XIcon className="w-3 h-3" />
                </button>
              </span>
            ) : (
              <span className="text-sm text-muted-foreground flex-1 select-none">Select sales order…</span>
            )}
            <ChevronDownIcon className={`w-3.5 h-3.5 text-muted-foreground ml-auto shrink-0 transition-transform duration-150 ${soDropdownOpen ? "rotate-180" : ""}`} />
          </div>

          {soDropdownOpen && (
            <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-background border border-border rounded-lg shadow-lg overflow-hidden">
              <div className="p-2 border-b border-border/60">
                <div className="relative">
                  <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                  <Input value={soSearch} onChange={(e) => handleSoSearch(e.target.value)} onKeyDown={handleSoKeyDown} placeholder="Search SO number…" className="pl-8 h-8 text-sm" autoFocus />
                  {soSearching && <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">Searching…</span>}
                </div>
              </div>
              <div className="max-h-64 overflow-y-auto">
                {dropdownRows.length === 0 ? (
                  <p className="px-3 py-5 text-sm text-muted-foreground text-center">
                    {soSearch.length >= 2 ? "No results" : openSos.length > 0 ? "All confirmed SOs selected" : "No confirmed SOs — search above"}
                  </p>
                ) : (
                  dropdownRows.map((s, idx) => {
                    const isSelected = s.id === linkedSoId;
                    return (
                      <button
                        key={s.id}
                        disabled={isSelected}
                        className={`w-full text-left px-3 py-2.5 transition-colors border-b border-border/30 last:border-0 disabled:opacity-40 ${idx === soHighlight ? "bg-muted" : "hover:bg-muted/50"}`}
                        onClick={() => { if (!isSelected) selectSo(s); }}
                      >
                        <span className="text-sm font-mono font-medium">{s.soNo}</span>
                        {isSelected && <span className="text-[10px] text-muted-foreground ml-2">selected</span>}
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>
      </section>
      )}

      {/* ── Supplier summary ── */}
      {Object.keys(totalBySupplier).length > 0 && (
        <div className="rounded-xl border border-border bg-background p-5 space-y-3">
          <h2 className="text-sm font-semibold">Supplier Summary</h2>
          <div className="space-y-1.5">
            {Object.values(totalBySupplier).map((s, i) => (
              <div key={i} className="flex justify-between text-sm">
                <span className="text-muted-foreground">{s.name}</span>
                <span className="font-medium tabular-nums">
                  <span className="text-xs text-muted-foreground mr-1">{s.currency}</span>
                  {s.total.toLocaleString("en-MY", { minimumFractionDigits: 2 })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── PR line items ── */}
      <div className="rounded-xl border border-border bg-background overflow-hidden">
        <div className="px-5 py-3 border-b border-border bg-muted/20 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold">Items</h2>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Delete rows you don&apos;t need for this PR. CPO and customer tags are for reference only.
            </p>
          </div>
          {loadingSo && <span className="text-xs text-muted-foreground animate-pulse">Loading…</span>}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/30 text-muted-foreground">
                <th className="text-left px-3 py-2 font-medium w-8">#</th>
                <th className="text-left px-3 py-2 font-medium w-12">Image</th>
                <th className="text-left px-3 py-2 font-medium w-28">Code</th>
                <th className="text-left px-3 py-2 font-medium">Description</th>
                <th className="text-left px-3 py-2 font-medium w-28">Qty</th>
                <th className="text-left px-3 py-2 font-medium w-16">UOM</th>
                <th className="text-left px-3 py-2 font-medium w-20">Currency</th>
                <th className="text-left px-3 py-2 font-medium w-28">Est. Unit Cost</th>
                <th className="text-left px-3 py-2 font-medium w-24">Total</th>
                <th className="text-left px-3 py-2 font-medium w-40">Preferred Supplier</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {lines.map((line) => (
                <tr key={line._key} className="group align-top">
                  <td className="px-3 py-2.5 text-muted-foreground">{line.rowNo}</td>
                  <td className="px-2 py-1.5">
                    <div className="flex flex-col gap-0.5 items-start">
                      {line._imageUploading ? (
                        <div className="w-9 h-9 flex items-center justify-center rounded border border-border">
                          <span className="text-[10px] text-muted-foreground animate-pulse">…</span>
                        </div>
                      ) : (
                        <ProductImageCell
                          productCode={line.productCode ?? ""}
                          overrideUrl={line._imagePresignedUrl ?? undefined}
                          onReplace={() => triggerImageUpload(line._key)}
                        />
                      )}
                      {!line._imageUploading && (
                        line._imagePresignedUrl ? (
                          <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800">
                            <UploadIcon className="w-3 h-3 shrink-0" />
                            uploaded
                          </span>
                        ) : line.productCode ? (
                          <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground border border-border/60">
                            <DatabaseIcon className="w-3 h-3 shrink-0" />
                            from catalog
                          </span>
                        ) : null
                      )}
                    </div>
                  </td>
                  <td className="px-2 py-1.5">
                    <Input
                      value={line.productCode ?? ""}
                      onChange={(e) => setLine(line._key, { productCode: e.target.value })}
                      onBlur={(e) => handleProductCodeBlur(line._key, e.target.value)}
                      className="h-7 text-xs"
                      placeholder="Code"
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    {/* CPO + Customer badges */}
                    {(line._cpoNo || line._customerName || line._customerOrganization) && (
                      <div className="flex flex-wrap gap-1 mb-1">
                        {line._cpoNo && (
                          <span className={cn(
                            "inline-flex items-center text-[10px] font-mono font-medium px-1.5 py-0.5 rounded-md border",
                            "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800"
                          )}>
                            {line._cpoNo}
                          </span>
                        )}
                        {line._customerOrganization && (
                          <span className="inline-flex items-center text-[10px] px-1.5 py-0.5 rounded-md bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-300 border border-violet-200 dark:border-violet-800">
                            {line._customerOrganization}
                          </span>
                        )}
                        {line._customerName && (
                          <span className="inline-flex items-center text-[10px] px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground border border-border/60">
                            {line._customerName}
                          </span>
                        )}
                      </div>
                    )}
                    <Input
                      value={line.description ?? ""}
                      onChange={(e) => setLine(line._key, { description: e.target.value, _descriptionSource: "user" })}
                      className="h-7 text-xs"
                      placeholder="Description"
                    />
                    {line._descriptionSource === "catalog" && (
                      <span className="inline-flex items-center gap-1 mt-0.5 text-[10px] px-1.5 py-0.5 rounded-md bg-blue-50 text-blue-600 border border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800">
                        <DatabaseIcon className="w-3 h-3 shrink-0" />
                        auto-filled from catalog
                      </span>
                    )}
                    {line._descriptionSource === "so" && (
                      <span className="inline-flex items-center gap-1 mt-0.5 text-[10px] px-1.5 py-0.5 rounded-md bg-green-50 text-green-700 border border-green-200 dark:bg-green-950/40 dark:text-green-400 dark:border-green-800">
                        <ShoppingCartIcon className="w-3 h-3 shrink-0" />
                        from sales order
                      </span>
                    )}
                    {line._descriptionSource === "user" && (
                      <span className="inline-flex items-center gap-1 mt-0.5 text-[10px] px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800">
                        <PencilIcon className="w-3 h-3 shrink-0" />
                        {currentUserName} edited
                      </span>
                    )}
                    {line._isAdditional && (
                      <span className="inline-flex items-center gap-1 mt-0.5 text-[10px] px-1.5 py-0.5 rounded-md bg-purple-50 text-purple-700 border border-purple-200 dark:bg-purple-950/40 dark:text-purple-400 dark:border-purple-800">
                        <PlusIcon className="w-3 h-3 shrink-0" />
                        additional row
                      </span>
                    )}
                    {line._editedBy && line._descriptionSource === "so" && (
                      <span className="inline-flex items-center gap-1 mt-0.5 text-[10px] px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800">
                        <PencilIcon className="w-3 h-3 shrink-0" />
                        {line._editedBy} edited
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    <Input type="number" value={line.qty ?? "1"} onChange={(e) => setLine(line._key, { qty: e.target.value })} className="h-7 text-xs text-center" />
                  </td>
                  <td className="px-2 py-1.5">
                    <Input value={line.uom ?? ""} onChange={(e) => setLine(line._key, { uom: e.target.value })} className="h-7 text-xs" placeholder="UOM" />
                  </td>
                  <td className="px-2 py-1.5">
                    <select
                      value={line.currency ?? "MYR"}
                      onChange={(e) => setLine(line._key, { currency: e.target.value })}
                      className="h-7 w-full rounded-md border border-border bg-background px-1.5 text-xs"
                    >
                      {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </td>
                  <td className="px-2 py-1.5">
                    <Input type="number" value={line.estimatedUnitCost ?? "0"} onChange={(e) => setLine(line._key, { estimatedUnitCost: e.target.value })} className="h-7 text-xs" />
                  </td>
                  <td className="px-3 py-2.5 tabular-nums font-medium">
                    <span className="text-[10px] text-muted-foreground mr-0.5">{line.currency ?? "MYR"}</span>
                    {parseFloat(calcTotal(line)).toLocaleString("en-MY", { minimumFractionDigits: 2 })}
                  </td>
                  <td className="px-2 py-1.5">
                    <SupplierCell
                      value={line._supplierName ?? ""}
                      onSelect={(id, name) => setLine(line._key, { _supplierId: id, _supplierName: name })}
                      onClear={() => setLine(line._key, { _supplierId: undefined, _supplierName: undefined })}
                    />
                  </td>
                  <td className="px-2 py-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <div className="flex items-center gap-1">
                      {line._soItemId && (
                        <button
                          title="Exclude from all future PRs"
                          disabled={togglingExclude === line._key}
                          onClick={() => handleExcludeFromPr(line._key, line._soItemId!)}
                          className="text-muted-foreground hover:text-red-500 dark:hover:text-red-400 transition-colors"
                        >
                          {togglingExclude === line._key
                            ? <Loader2Icon className="w-3.5 h-3.5 animate-spin" />
                            : <BanIcon className="w-3.5 h-3.5" />}
                        </button>
                      )}
                      <button onClick={() => removeLine(line._key)} className="text-muted-foreground hover:text-destructive">
                        <TrashIcon className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 border-t border-border flex items-center justify-between">
          <Button variant="ghost" size="sm" className="gap-1.5 text-xs" onClick={addLine}>
            <PlusIcon className="w-3 h-3" /> Add Item
          </Button>
          {Object.entries(totalsByCurrency).length > 0 && (
            <div className="flex items-center gap-3 text-xs text-muted-foreground tabular-nums">
              {Object.entries(totalsByCurrency).map(([ccy, amt]) => (
                <span key={ccy}>
                  <span className="font-medium text-foreground">{ccy}</span>{" "}
                  <span className="font-semibold text-foreground">{amt.toLocaleString("en-MY", { minimumFractionDigits: 2 })}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Notes ── */}
      <div className="rounded-xl border border-border bg-background p-5 space-y-2">
        <Label className="text-sm font-semibold">Notes / Justification</Label>
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Reason for purchase, urgency, special requirements…"
          rows={3}
          className="text-sm resize-none"
        />
      </div>

      <div className="flex justify-end gap-2 pb-6">
        <Button variant="ghost" size="sm" onClick={() => router.back()}>Cancel</Button>
        <Button size="sm" onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Create Requisition"}
        </Button>
      </div>
    </div>
  );
}
