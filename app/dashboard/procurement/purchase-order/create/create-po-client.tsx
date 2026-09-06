"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import {
  createPurchaseOrder,
  getSalesOrderItemsForPo,
  getPoSupplierQuotationUploadUrl,
  getPoItemImageUploadUrl,
  deleteProcurementImages,
  searchCustomersForPo,
  type PurchaseOrderItemInput,
  type PrForPoConversion,
} from "@/server/purchase-order";
import { getProductByCode, getProductDetailsByCodes, getDesignCodeImageUploadUrl } from "@/server/products";
import { searchProductsByDesignCode } from "@/server/inventory";
import type { Supplier } from "@/server/supplier";
import { cn } from "@/lib/utils";
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
  UploadIcon,
  DatabaseIcon,
  AlertCircleIcon,
  AlertTriangleIcon,
  InfoIcon,
  PencilIcon,
  TagIcon,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Highlight } from "@/components/highlight";
import { uid } from "@/lib/uid";

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

// Nothing in this app tracks which extension a catalogue image actually got
// uploaded with — the URL is always just guessed from the code. The bulk
// uploader (getProductImageUploadUrls) and the design-code uploader
// (getDesignCodeImageUploadUrl) both always write ".jpg" regardless of the
// source file's real format, but anything filed outside those two paths
// (e.g. someone dropping a file into R2 by hand) keeps its original
// extension — ".jpeg" in particular is common from phone exports. Try each
// in turn rather than assuming ".jpg" and silently showing "no image".
const IMAGE_EXT_CANDIDATES = ["jpg", "jpeg", "png", "webp"];

function PoProductThumbnail({ productCode, lookupCode, overrideUrl, onReplace }: { productCode: string; lookupCode?: string; overrideUrl?: string; onReplace: () => void }) {
  const [extIdx, setExtIdx] = useState(0);
  const [open, setOpen]     = useState(false);
  // For an OEM item, our own product code is a private-label code we made
  // up — the catalog photo (if any) lives under the design house's own
  // design code instead, so that's what the lookup key falls back from.
  const catalogCode = lookupCode || productCode;
  const exhausted = extIdx >= IMAGE_EXT_CANDIDATES.length;
  const catalogSrc = R2_PRODUCT_IMAGES && catalogCode && !exhausted
    ? `${R2_PRODUCT_IMAGES}/${encodeURIComponent(catalogCode)}.${IMAGE_EXT_CANDIDATES[extIdx]}`
    : "";
  const src = overrideUrl || catalogSrc;

  useEffect(() => { setExtIdx(0); }, [overrideUrl, catalogCode]);

  if (!src || (!overrideUrl && exhausted)) {
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
        className="block w-9 h-9 rounded border border-border overflow-hidden hover:opacity-80 transition-opacity shrink-0"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} className="w-full h-full object-cover" alt="" onError={() => { if (!overrideUrl) setExtIdx((i) => i + 1); }} />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg p-0 overflow-hidden gap-0" showCloseButton={false}>
          <DialogTitle className="sr-only">{productCode}</DialogTitle>
          <div className="relative bg-muted/30">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} className="w-full object-contain max-h-[65vh]" alt={productCode} onError={() => { if (!overrideUrl) setExtIdx((i) => i + 1); setOpen(false); }} />
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

interface ApprovedSo { id: string; soNo: string; customerName: string | null }
interface CustomerPoOption { id: string; customerPoNo: string; customerName: string | null; amount: string }

interface Props {
  suppliers: Supplier[];
  defaultDeliveryAddress?: string;
  backHref?: string;
  currentUserName?: string;
  businessType?: string;
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
  _imagePreviewUrl?: string;
  _imageInherited?: boolean; // key came from PR — must not be deleted by PO form
  _cpoId?: string | null;
  _codeEditing?: boolean; // Code field stays an input while true — set on focus, cleared on blur
}

const newLine = (rowNo: number, key?: string): LineItem => ({
  _key: key ?? `row-${rowNo}`,
  rowNo,
  productCode: "",
  description: "",
  qty: "1",
  uom: "pc",
  unitPrice: "0",
  currency: "MYR",
  totalPrice: "0",
  imageKey: undefined,
  customerName: "",
  customerOrganization: "",
  customerPoNo: "",
  sourcingType: undefined,
  designBrandName: "",
  designBrandCode: "",
  privateLabelCode: "",
  designBrandSource: undefined,
  privateLabelSource: undefined,
});

// A product fixed at "trading" or "oem" is inherited silently; "both" (or no
// catalog match at all) is ambiguous and needs an explicit pick on the item.
function resolveSourcingType(productSourcingType: string | null | undefined): "trading" | "oem" | null {
  return productSourcingType === "trading" || productSourcingType === "oem" ? productSourcingType : null;
}

// Autocomplete on the OEM "Design Code" column — searches the catalogue by
// product.designBrandCode (min 3 chars) and, on a match, fills Design Brand
// Name and (if still empty) Description, tagging both with their source.
function DesignCodeCell({
  item,
  onUpdate,
  disabled,
  currentUserName,
}: {
  item: LineItem;
  onUpdate: (key: string, patch: Partial<LineItem>) => void;
  disabled?: boolean;
  currentUserName?: string;
}) {
  const [q, setQ] = useState(item.designBrandCode ?? "");
  const [results, setResults] = useState<{ id: string; productCode: string; description: string | null; brand: string | null }[]>([]);
  const [open, setOpen] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentVal = useRef(item.designBrandCode ?? "");
  // Clicking a suggestion blurs the input a beat before its own onClick
  // applies the match — this flag lets the blur handler recognise "a match
  // was just applied" and skip its own redundant fetch instead of racing it.
  const justApplied = useRef(false);

  // Re-sync only when this cell starts representing a different row (e.g.
  // initial mount, or an imported/PR-derived row) — not on every keystroke.
  // handleInput already writes each keystroke straight back to the parent,
  // so re-syncing off item.designBrandCode on every render would race
  // against that same round-trip and corrupt what's mid-typing.
  useEffect(() => {
    setQ(item.designBrandCode ?? "");
    currentVal.current = item.designBrandCode ?? "";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item._key]);

  function applyMatch(p: { brand: string | null; description: string | null }, typedCode: string) {
    justApplied.current = true;
    const patch: Partial<LineItem> = {
      designBrandCode: typedCode,
      designBrandName: p.brand || item.designBrandName || "",
      designBrandSource: "catalog",
      oemEditedBy: currentUserName || "user",
    };
    // Changing the design code changes which product this line refers to,
    // so the description must always follow the newly matched product —
    // even over a prior hand-typed description, whose "edited SPO" tag is
    // now stale and gets cleared along with it.
    if (p.description) {
      patch.description = p.description;
      patch.descriptionSource = "product";
      patch.editedBy = undefined;
    }
    onUpdate(item._key, patch);
  }

  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);

  function handleInput(val: string) {
    setQ(val);
    currentVal.current = val;
    onUpdate(item._key, { designBrandCode: val, designBrandSource: "user", oemEditedBy: currentUserName || "user" });
    if (debounce.current) clearTimeout(debounce.current);
    if (val.trim().length < 3) { setResults([]); setOpen(false); setSearched(false); return; }
    setSearching(true);
    debounce.current = setTimeout(async () => {
      const r = await searchProductsByDesignCode(val).finally(() => setSearching(false));
      if (val !== currentVal.current) return;
      setResults(r);
      setSearched(true);
      setOpen(true);
      const exact = r.find((p) => p.productCode.toLowerCase() === val.trim().toLowerCase());
      if (exact) {
        applyMatch(exact, val.trim());
        setOpen(false);
      }
    }, 300);
  }

  // Guarantees the match resolves once the user leaves the field, even if
  // they type-and-tab-away faster than the 300ms live-search debounce —
  // that race is exactly what let the field go unresolved before. Waits a
  // beat first since clicking a suggestion blurs the input just ahead of
  // that click's own onClick — justApplied lets this bail out once that
  // click's own match has landed, instead of racing a redundant fetch
  // against it (or against the debounce already having found one).
  function handleBlur() {
    setTimeout(async () => {
      setOpen(false);
      if (justApplied.current) { justApplied.current = false; return; }
      const val = currentVal.current.trim();
      if (val.length < 3) return;
      if (item.designBrandCode === val && item.designBrandSource) return;
      if (debounce.current) clearTimeout(debounce.current);
      const r = await searchProductsByDesignCode(val).catch(() => []);
      const exact = r.find((p) => p.productCode.toLowerCase() === val.toLowerCase());
      if (exact) applyMatch(exact, val);
    }, 150);
  }

  return (
    <div className="relative">
      <input
        value={q}
        onChange={(e) => handleInput(e.target.value)}
        onFocus={() => { if (results.length > 0 || searched) setOpen(true); }}
        onBlur={handleBlur}
        disabled={disabled}
        placeholder={disabled ? "—" : "search by product code…"}
        className={cn(
          "h-7 w-full text-xs border rounded px-1.5 bg-background disabled:opacity-40 disabled:cursor-not-allowed",
          !disabled && !item.designBrandCode?.trim() ? "border-destructive" : "border-input",
        )}
      />
      {open && (
        <div className="absolute z-50 top-full left-0 mt-0.5 w-64 rounded-md border border-border bg-background shadow-md max-h-40 overflow-y-auto text-xs">
          {searching && (
            <div className="px-2 py-2 text-muted-foreground">Searching…</div>
          )}
          {!searching && results.length === 0 && searched && (
            <div className="px-2 py-2 text-muted-foreground">No matching product found</div>
          )}
          {results.map((p) => (
            <button
              key={p.id}
              type="button"
              className="w-full text-left px-2 py-1.5 hover:bg-accent flex flex-col gap-0.5"
              onClick={() => { applyMatch(p, p.productCode); setQ(p.productCode); setOpen(false); }}
            >
              <span className="font-mono font-medium">{p.productCode}</span>
              <span className="text-muted-foreground truncate">
                {p.brand ? `${p.brand} · ${p.description ?? ""}` : (p.description ?? "")}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Picks the real end-customer this line is destined for (e.g. a drop-ship
// OEM order allocated per hospital/doctor) from the shared customer
// directory — their primary organisation snapshots onto the line
// automatically via the existing customer ↔ customerOrganization link, so
// there's nothing to separately type or keep in sync.
function CustomerPickerCell({
  item,
  onUpdate,
}: {
  item: LineItem;
  onUpdate: (key: string, patch: Partial<LineItem>) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Awaited<ReturnType<typeof searchCustomersForPo>>>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleInput(val: string) {
    setQuery(val);
    if (timer.current) clearTimeout(timer.current);
    if (val.trim().length < 2) { setResults([]); setOpen(false); setSearched(false); return; }
    setSearching(true);
    timer.current = setTimeout(async () => {
      const rows = await searchCustomersForPo(val).finally(() => setSearching(false));
      setResults(rows);
      setSearched(true);
      setOpen(true);
    }, 300);
  }

  function pick(customerId: string, name: string, orgId: string | null, orgName: string | null) {
    onUpdate(item._key, {
      customerId,
      customerOrganizationId: orgId ?? undefined,
      customerName: name,
      customerOrganization: orgName ?? "",
    });
    setQuery("");
    setResults([]);
    setOpen(false);
  }

  if (item.customerId) {
    return (
      <div className="flex flex-wrap items-center gap-1">
        {item.customerOrganization && (
          <span className="inline-flex items-center text-[10px] px-1.5 py-0.5 rounded-md bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-300 border border-violet-200 dark:border-violet-800">
            {item.customerOrganization}
          </span>
        )}
        <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground border border-border/60">
          {item.customerName}
          <button
            type="button"
            onClick={() => onUpdate(item._key, { customerId: undefined, customerOrganizationId: undefined, customerName: "", customerOrganization: "" })}
            className="hover:text-foreground"
          >
            <XIcon className="w-2.5 h-2.5" />
          </button>
        </span>
      </div>
    );
  }

  return (
    <div className="relative w-full max-w-xs">
      <Input
        value={query}
        onChange={(e) => handleInput(e.target.value)}
        onFocus={() => { if (results.length > 0 || searched) setOpen(true); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Customer (optional)"
        className="h-7 text-xs"
      />
      {open && (
        <div className="absolute z-50 top-full left-0 mt-0.5 w-60 rounded-md border border-border bg-background shadow-md max-h-52 overflow-y-auto text-xs">
          {searching ? (
            <div className="px-2 py-2 text-muted-foreground">Searching…</div>
          ) : results.length > 0 ? (
            results.map((r) => (
              <div key={r.id} className="border-b border-border/50 last:border-0">
                <div className="px-2 pt-1.5 pb-0.5 font-medium truncate">{r.name}</div>
                {r.memberships.length > 0 ? (
                  r.memberships.map((m) => (
                    <button
                      key={m.customerOrganizationId}
                      type="button"
                      className="w-full text-left pl-4 pr-2 py-1 hover:bg-accent text-muted-foreground truncate flex items-center gap-1"
                      onClick={() => pick(r.id, r.name, m.customerOrganizationId, m.orgName)}
                    >
                      {m.orgName}
                      {m.isPrimary && <span className="text-[9px] text-muted-foreground/70">(primary)</span>}
                    </button>
                  ))
                ) : (
                  <button
                    type="button"
                    className="w-full text-left pl-4 pr-2 py-1 hover:bg-accent text-muted-foreground italic"
                    onClick={() => pick(r.id, r.name, null, null)}
                  >
                    no organisation on file
                  </button>
                )}
              </div>
            ))
          ) : (
            <div className="px-2 py-2 text-muted-foreground">No matches</div>
          )}
        </div>
      )}
    </div>
  );
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

function prItemToLine(pi: PrForPoConversion["items"][number]): LineItem {
  return {
    _key: pi.id, // stable DB id — safe for SSR
    rowNo: pi.rowNo,
    productId: pi.productId ?? undefined,
    productCode: pi.productCode ?? "",
    description: pi.description ?? "",
    qty: pi.qty,
    uom: pi.uom ?? "",
    unitPrice: pi.estimatedUnitCost,
    currency: pi.currency,
    totalPrice: (parseFloat(pi.qty) * parseFloat(pi.estimatedUnitCost)).toFixed(2),
    imageKey: pi.imageKey ?? undefined,
    _imageInherited: !!pi.imageKey,
    _imagePreviewUrl: pi.imageUrl ?? undefined,
    descriptionSource: pi.description ? "pr" : undefined,
    customerName: pi.customerName ?? "",
    customerOrganization: pi.customerOrganization ?? "",
    customerPoNo: pi.cpoNo ?? "",
    _cpoId: pi.cpoId ?? null,
    isAdditional: pi.isAdditional,
    editedBy: pi.editedBy ?? undefined,
  };
}

export function CreatePurchaseOrderClient({ suppliers, approvedSos = [], customerPos = [], initialSoId, prData, defaultDeliveryAddress = "", backHref: backHrefProp, currentUserName = "", businessType = "trading" }: Props) {
  const showSourcing = businessType !== "trading";
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
  // Tracks what's already ordered for the selected SO
  const [orderedSupplierIds, setOrderedSupplierIds] = useState<string[]>([]);
  const [orderedProductCodes, setOrderedProductCodes] = useState<string[]>([]);

  // Linked Customer POs (direct mode only)
  const [selectedCpos, setSelectedCpos] = useState<CustomerPoOption[]>([]);
  const [cpoSearch, setCpoSearch] = useState("");

  // Header fields
  const [deliveryDate, setDeliveryDate] = useState(() => {
    if (prData?.soDeliveryDate) return new Date(prData.soDeliveryDate).toISOString().split("T")[0];
    return "";
  });
  const [deliveryAddress, setDeliveryAddress] = useState(
    prData?.soDeliveryAddress ?? defaultDeliveryAddress,
  );
  const deliveryDateInherited = prData?.soDeliveryDate
    ? new Date(prData.soDeliveryDate).toISOString().split("T")[0]
    : "";
  const deliveryAddressInherited = prData?.soDeliveryAddress ?? "";
  const [notes, setNotes] = useState(prData?.notes ?? "");
  const [useManualPoNo, setUseManualPoNo] = useState(false);
  const [manualPoNo, setManualPoNo] = useState("");
  const [importingSheet, setImportingSheet] = useState(false);
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
        .map((pi) => prItemToLine(pi));
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
        .map((pi) => prItemToLine(pi)),
    );
  }

  // Auto-load items from SO when arriving with initialSoId (direct mode)
  useEffect(() => {
    if (isPrMode || !initialSoId || !selectedSo) return;
    setLoadingSoItems(true);
    getSalesOrderItemsForPo(initialSoId).then(({ items: soItems, orderedSupplierIds: oids, orderedProductCodes: opcodes }) => {
      setOrderedSupplierIds(oids);
      setOrderedProductCodes(opcodes);
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
    }).catch(() => toast.error("Failed to load SO items")).finally(() => setLoadingSoItems(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Supplier quotation PDF
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfKey, setPdfKey] = useState<string | undefined>();
  const [pdfUploading, setPdfUploading] = useState(false);
  const pdfRef = useRef<HTMLInputElement>(null);

  const [saving, setSaving] = useState(false);

  const committedRef = useRef(false);
  const itemsRef     = useRef(items);
  useEffect(() => { itemsRef.current = items; }, [items]);
  useEffect(() => {
    return () => {
      if (committedRef.current) return;
      const keys = itemsRef.current.flatMap((i) =>
        i.imageKey && !i._imageInherited ? [i.imageKey] : [],
      );
      if (keys.length) deleteProcurementImages(keys).catch(() => {});
    };
  }, []);

  // On mount, fill descriptions from product DB for items that have a productCode but no description
  useEffect(() => {
    const needsLookup = items.filter((i) => i.productCode && !i.description);
    if (!needsLookup.length) return;
    const codes = [...new Set(needsLookup.map((i) => i.productCode!))];
    getProductDetailsByCodes(codes).then((rows) => {
      const descMap = Object.fromEntries(rows.map((r) => [r.productCode, r.description ?? ""]));
      setItems((prev) => prev.map((i) =>
        i.productCode && !i.description && descMap[i.productCode]
          ? { ...i, description: descMap[i.productCode], descriptionSource: "product" }
          : i
      ));
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    setItems((prev) => [...prev, newLine(prev.length + 1, uid())]);
  }

  function removeLine(key: string) {
    const removed = itemsRef.current.find((i) => i._key === key);
    if (removed?.imageKey && !removed._imageInherited) deleteProcurementImages([removed.imageKey]).catch(() => {});
    setItems((prev) => {
      const next = prev.filter((i) => i._key !== key);
      return next.map((i, idx) => ({ ...i, rowNo: idx + 1 }));
    });
  }

  // One-off attachment scoped to just this PO line, stored in the isolated
  // procurement-docs bucket (see getPoItemImageUploadUrl) — the fallback for
  // any line that isn't an OEM item with a design code (see
  // handleDesignCodeImageUpload below, which handles that case instead by
  // filing into the shared catalogue bucket so it's reusable on future POs).
  async function handleItemImageFile(key: string, file: File) {
    const err = validateImageFile(file);
    if (err) { toast.error(err); return; }

    const oldItem = itemsRef.current.find((i) => i._key === key);
    updateItem(key, { _imageFile: file, _imageUploading: true });
    try {
      const { key: r2Key, uploadUrl } = await getPoItemImageUploadUrl(file.name);
      const res = await fetch(uploadUrl, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (oldItem?.imageKey && !oldItem._imageInherited) deleteProcurementImages([oldItem.imageKey]).catch(() => {});
      updateItem(key, { imageKey: r2Key, _imageUploading: false, _imagePreviewUrl: URL.createObjectURL(file), _imageInherited: false });
    } catch (err) {
      toast.error(uploadErrorMessage(err));
      updateItem(key, { _imageFile: undefined, _imageUploading: false });
    }
  }

  // Files into the shared product-image catalogue bucket, keyed by this
  // line's design code — the same bucket/key convention PoProductThumbnail
  // already guesses at when it builds the image URL to display, so once
  // this finishes, that same design code shows the image on every future PO
  // line too, not just this one. Doesn't touch imageKey (that's the one-off
  // per-line attachment field, untouched here) — just a fresh local preview
  // until the page reloads and the guessed catalogue URL takes over for real.
  async function handleDesignCodeImageUpload(key: string, designCode: string, file: File) {
    const err = validateImageFile(file);
    if (err) { toast.error(err); return; }

    updateItem(key, { _imageUploading: true });
    try {
      const { uploadUrl } = await getDesignCodeImageUploadUrl(designCode, file.type);
      const res = await fetch(uploadUrl, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      updateItem(key, { _imageUploading: false, _imagePreviewUrl: URL.createObjectURL(file) });
      toast.success(`Image saved to the catalogue under design code "${designCode}"`);
    } catch (err) {
      toast.error(uploadErrorMessage(err));
      updateItem(key, { _imageUploading: false });
    }
  }

  function handleItemImage(key: string, e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    const item = itemsRef.current.find((i) => i._key === key);
    const designCode = item?.sourcingType === "oem" ? item.designBrandCode?.trim() : "";
    if (designCode) {
      handleDesignCodeImageUpload(key, designCode, file);
    } else {
      handleItemImageFile(key, file);
    }
  }

  async function handleProductCodeBlur(key: string, code: string) {
    if (!code.trim()) return;
    const item = itemsRef.current.find((i) => i._key === key);
    if (!item) return;
    const prod = await getProductByCode(code).catch(() => null);
    if (!prod) return;
    setItems((prev) => prev.map((i) => {
      if (i._key !== key) return i;
      const patch: Partial<LineItem> = {};
      // Changing the code changes which product this line refers to, so the
      // description always follows the newly matched product — even over a
      // prior hand-typed description, whose "edited SPO" tag is now stale.
      patch.description = prod.description ?? "";
      patch.descriptionSource = "product";
      patch.editedBy = undefined;
      // Silently inherit sourcing only when the product is fixed one way —
      // leave it unresolved (shows the explicit picker) for "both"/unmatched
      if (!i.sourcingType) {
        const resolved = resolveSourcingType(prod.sourcingType);
        if (resolved) {
          patch.sourcingType = resolved;
          patch.designBrandName = prod.designBrandName ?? "";
          patch.designBrandCode = prod.designBrandCode ?? "";
          patch.privateLabelCode = prod.privateLabelCode ?? "";
          patch.designBrandSource = "catalog";
          patch.privateLabelSource = "catalog";
        }
      }
      return { ...i, ...patch };
    }));
  }

  // Best-effort import of a manually-issued supplier PO spreadsheet (.xlsx/.xls/.ods/.csv).
  // Supplier PO layouts vary a lot — this locates the item table by scanning
  // for a row containing both a "No" and a "Description"-like header, then
  // matches columns by alias rather than fixed position. Always review the
  // result before saving; this is not guaranteed to read every format.
  function processPoSpreadsheet(file: File) {
    setImportingSheet(true);
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = new Uint8Array(ev.target?.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const grid: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
        const cell = (row: unknown[] | undefined, i: number): string =>
          row && row[i] !== undefined && row[i] !== null ? String(row[i]).trim() : "";

        // 1. Find the item-table header row — the first row with both a
        // "No"-like cell and a "Description"-like cell.
        let headerRowIdx = -1;
        for (let i = 0; i < grid.length; i++) {
          const row = grid[i];
          const hasNo = row.some((c) => /^(no\.?|#)$/i.test(String(c).trim()));
          const hasDesc = row.some((c) => /desc/i.test(String(c).trim()));
          if (hasNo && hasDesc) { headerRowIdx = i; break; }
        }
        if (headerRowIdx === -1) {
          toast.error("Couldn't find an item table in this file — the format may not be recognized");
          return;
        }

        const header = grid[headerRowIdx].map((c) => String(c).toLowerCase().replace(/\s+/g, " ").trim());
        const colIdx = (...aliases: string[]): number => {
          for (const a of aliases) {
            const idx = header.indexOf(a);
            if (idx !== -1) return idx;
          }
          return -1;
        };

        const idxProductCode = colIdx("product code", "item code", "code");
        const idxDesignBrandName = colIdx("design brand name to refer", "design brand name", "brand");
        const idxDesignBrandCode = colIdx("design brand code to refer", "design brand code", "design code");
        const idxEmboss = colIdx("best medical code to emboss", "emboss code", "private label code");
        const rawIdxDescription = colIdx("description", "item description");
        const rawIdxQty = colIdx("qty", "quantity");
        const rawIdxUom = colIdx("oum", "uom", "unit");
        const rawIdxUnitPrice = colIdx("price/pc", "price / pc", "unit price");
        const rawIdxTotalPrice = colIdx("total", "amount", "price");

        // Some sheets have a merged header cell (e.g. "Product Code" spanning
        // 3 columns) that the data rows don't mirror — every field after it
        // then reads one column left of where the header puts it, landing a
        // number (qty) where a description should be. Detect this by
        // checking whether the description column looks numeric on the
        // first data row while the column just before it looks like text,
        // and shift the rest of the field indices left to compensate.
        const looksNumeric = (s: string) => /^-?\d+(\.\d+)?$/.test(s.trim());
        const looksLikeText = (s: string) => /[a-zA-Z]{3,}/.test(s);
        const firstDataRow = grid.slice(headerRowIdx + 1).find((r) => cell(r, 0) !== "");
        const misaligned = !!(
          firstDataRow && rawIdxDescription > 0 &&
          looksNumeric(cell(firstDataRow, rawIdxDescription)) &&
          looksLikeText(cell(firstDataRow, rawIdxDescription - 1))
        );
        const shift = misaligned ? 1 : 0;
        const shiftIdx = (i: number) => (i === -1 ? -1 : i - shift);
        const idxDescription = shiftIdx(rawIdxDescription);
        const idxQty = shiftIdx(rawIdxQty);
        const idxUom = shiftIdx(rawIdxUom);
        const idxUnitPrice = shiftIdx(rawIdxUnitPrice);
        const idxTotalPriceShifted = shiftIdx(rawIdxTotalPrice);
        const idxTotalPrice = idxTotalPriceShifted !== idxUnitPrice ? idxTotalPriceShifted : -1;

        // 1b. Group/set title — many supplier sheets carry a single-cell
        // label directly above the item table naming what the whole sheet
        // is ("LOOSE ITEM", "AMPUTATION SET", "MEDIUM SET"). Only the row
        // immediately touching the header counts, so it isn't confused with
        // the ref/date/supplier block further up.
        let groupTitleGuess = "";
        if (headerRowIdx > 0) {
          const titleRow = grid[headerRowIdx - 1];
          const titleCells = titleRow.map((_, j) => cell(titleRow, j)).filter(Boolean);
          if (titleCells.length === 1 && !/^(purchase order|ref\.?|date|quotation ref)/i.test(titleCells[0])) {
            groupTitleGuess = titleCells[0];
          }
        }
        const groupId = groupTitleGuess ? uid() : undefined;

        // 2. Item rows — stop at the first summary/footer line
        const STOP = /subtotal|^total\b|discount|remark|authoris/i;
        const rawItems: LineItem[] = [];
        let currencyGuess = "";
        for (let i = headerRowIdx + 1; i < grid.length; i++) {
          const row = grid[i];
          const firstCell = cell(row, 0);
          if (STOP.test(firstCell)) {
            // Totals/subtotal rows often carry the currency, e.g. "SUBTOTAL (USD)"
            const m = firstCell.match(/\(([A-Za-z]{3})\)/);
            if (m && !currencyGuess) currencyGuess = m[1].toUpperCase();
            break;
          }
          const description = cell(row, idxDescription);
          const embossCode = cell(row, idxEmboss);
          const productCode = cell(row, idxProductCode) || embossCode;
          if (!description && !productCode) continue;

          const qty = cell(row, idxQty) || "1";
          const unitPrice = cell(row, idxUnitPrice) || "0";
          const totalPrice = cell(row, idxTotalPrice) || (parseFloat(qty) * parseFloat(unitPrice)).toFixed(2);
          const designBrandName = cell(row, idxDesignBrandName);
          const designBrandCode = cell(row, idxDesignBrandCode);
          const hasOem = !!(designBrandName || designBrandCode || embossCode);

          const line = newLine(rawItems.length + 1, uid());
          line.productCode = productCode;
          line.description = description.toUpperCase();
          line.qty = qty;
          line.uom = cell(row, idxUom);
          line.unitPrice = unitPrice;
          line.totalPrice = totalPrice;
          if (groupTitleGuess) {
            line.setGroupId = groupId;
            line.setGroupLabel = groupTitleGuess;
          }
          if (hasOem) {
            line.sourcingType = "oem";
            line.designBrandName = designBrandName;
            line.designBrandCode = designBrandCode;
            line.privateLabelCode = embossCode || productCode;
            line.designBrandSource = "user";
            line.privateLabelSource = "user";
            line.oemEditedBy = currentUserName || "user";
          }
          rawItems.push(line);
        }

        if (rawItems.length === 0) {
          toast.error("No item rows found in this file");
          return;
        }

        // 3. Header block, above the item table: PO ref, issue date, supplier name
        let refGuess = "";
        let dateGuess = "";
        let supplierGuess = "";
        for (let i = 0; i < headerRowIdx; i++) {
          const row = grid[i];
          for (let j = 0; j < row.length; j++) {
            const c = cell(row, j);
            if (!refGuess && /^ref/i.test(c)) {
              // Value may be inline after a colon ("Ref: PO/041-26") or in the
              // next cell ("Ref" | "PO/041-26") — never the label's own colon.
              const afterColon = c.includes(":") ? c.split(":").slice(1).join(":").trim() : "";
              refGuess = afterColon || cell(row, j + 1);
            }
            if (!dateGuess && /^date/i.test(c)) {
              const next = row[j + 1];
              if (typeof next === "number") {
                const d = XLSX.SSF.parse_date_code(next);
                if (d) dateGuess = `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
              } else {
                dateGuess = cell(row, j + 1);
              }
            }
          }
          const firstCell = cell(row, 0);
          if (
            !supplierGuess && firstCell && firstCell !== groupTitleGuess &&
            !/purchase order|^ref|^date|quotation ref|^no\.?$/i.test(firstCell)
          ) {
            supplierGuess = firstCell;
          }
        }

        if (currencyGuess && CURRENCIES.includes(currencyGuess)) {
          rawItems.forEach((li) => { li.currency = currencyGuess; });
          setCurrency(currencyGuess);
        }
        setItems(rawItems);
        if (refGuess) { setUseManualPoNo(true); setManualPoNo(refGuess); }
        const noteParts = [refGuess && `Original ref: ${refGuess}`, dateGuess && `Originally issued: ${dateGuess}`, `Imported from ${file.name}`].filter(Boolean);
        setNotes((prev) => prev ? prev : noteParts.join(" — "));

        if (supplierGuess) {
          const match = suppliers.find((s) =>
            s.name.toLowerCase().includes(supplierGuess.toLowerCase()) ||
            supplierGuess.toLowerCase().includes(s.name.toLowerCase()),
          );
          if (match) setSupplierId(match.id);
          else toast.error(`Detected supplier "${supplierGuess}" isn't in your supplier list yet — pick or create it manually`);
        }

        // Resolve description/sourcing against the catalog for rows with a
        // code — guarded fields (already filled from the sheet) are left alone.
        rawItems.forEach((li) => { if (li.productCode) handleProductCodeBlur(li._key, li.productCode); });

        toast.success(`Imported ${rawItems.length} item(s) — review everything before saving`);
      } catch (err) {
        console.error(err);
        toast.error("Failed to parse this spreadsheet — the format may not be recognized");
      } finally {
        setImportingSheet(false);
      }
    };
    reader.readAsArrayBuffer(file);
  }

  function removeItemImage(key: string) {
    const item = itemsRef.current.find((i) => i._key === key);
    if (item?.imageKey && !item._imageInherited) deleteProcurementImages([item.imageKey]).catch(() => {});
    updateItem(key, { imageKey: undefined, _imageFile: undefined, _imagePreviewUrl: undefined, _imageInherited: false });
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
    if (useManualPoNo && !manualPoNo.trim()) { toast.error("Enter the existing PO number, or turn that off to auto-generate one"); return null; }
    if (showSourcing) {
      const realItems = items.filter((i) => i.description || i.productCode);
      if (realItems.some((i) => !i.sourcingType)) {
        toast.error("Pick Trading or OEM for every item");
        return null;
      }
      if (realItems.some((i) => i.sourcingType === "oem" && (!i.designBrandName?.trim() || !i.designBrandCode?.trim() || !i.privateLabelCode?.trim()))) {
        toast.error("Fill in Design Brand, Design Code and Emboss Code for every OEM item");
        return null;
      }
    }

    const { subtotal, sstAmt, grand } = calcTotals(items, sstPct);

    // In PR mode: collect unique CPO IDs from item-level cpoId fields
    const prModeCpoIds = isPrMode
      ? [...new Set(items.map((i) => i._cpoId).filter(Boolean) as string[])]
      : [];

    return createPurchaseOrder({
      purchaseRequisitionId: prData?.id,
      supplierId,
      salesOrderId: isPrMode ? (prData?.salesOrderId ?? undefined) : selectedSo?.id,
      customerPoIds: isPrMode ? prModeCpoIds : selectedCpos.map((c) => c.id),
      supplierQuotationKey: pdfKey,
      currency,
      subtotal: subtotal.toFixed(2),
      sstPct,
      sst: sstAmt.toFixed(2),
      grandTotal: grand.toFixed(2),
      notes: notes || undefined,
      expectedDeliveryDate: deliveryDate ? new Date(deliveryDate) : undefined,
      deliveryAddress: deliveryAddress || undefined,
      manualPoNo: !isPrMode && useManualPoNo ? manualPoNo.trim() : undefined,
      items: items.map(({ _key, _imageFile, _imageUploading, _imagePreviewUrl, _imageInherited, _cpoId, _codeEditing, ...rest }) => rest),
    });
  }

  async function handleCreatePo() {
    setSaving(true);
    try {
      const po = await buildAndCreate();
      if (!po) return;
      committedRef.current = true;
      toast.success(`Purchase order ${po.poNo ?? ""} created`);
      router.push(`/dashboard/procurement/purchase-order/${po.id}`);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  }

  const { subtotal, sstAmt, grand } = calcTotals(items, sstPct);

  const backHref = backHrefProp
    ?? (isPrMode
      ? `/dashboard/procurement/requisition/${prData!.id}`
      : "/dashboard/procurement/purchase-order");

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
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono font-medium text-sm">{prData!.prNo}</span>
              {prData!.salesOrderNo && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <LinkIcon className="w-3 h-3" /> {prData!.salesOrderNo}
                </span>
              )}
              {prData!.cpoNos.map((cpo) => (
                <span key={cpo} className="inline-flex items-center text-[10px] font-mono font-medium px-1.5 py-0.5 rounded-md border bg-blue-100 dark:bg-blue-800/40 text-blue-700 dark:text-blue-300 border-blue-300 dark:border-blue-700">
                  {cpo}
                </span>
              ))}
            </div>
            <p className="text-xs text-blue-700 dark:text-blue-400">
              Select a supplier below — items will be filtered to show only those assigned to that supplier.
            </p>
          </section>
        )}

        {/* ── Import from spreadsheet (direct mode only) ── */}
        {!isPrMode && (
          <section className="border border-border rounded-xl p-4">
            <h2 className="text-sm font-semibold mb-1">Import from spreadsheet</h2>
            <p className="text-xs text-muted-foreground mb-3">
              For backfilling a PO that was already issued manually — reads a supplier PO spreadsheet
              (.xlsx, .xls, .ods, .csv) and fills in the fields below. Best-effort: supplier PO layouts
              vary, so always review everything before saving.
            </p>
            <label className="inline-flex items-center gap-2 cursor-pointer text-sm text-muted-foreground hover:text-foreground transition-colors">
              <UploadIcon className="w-4 h-4" />
              <span>{importingSheet ? "Reading file…" : "Choose spreadsheet…"}</span>
              <input
                type="file"
                accept=".xlsx,.xls,.ods,.csv"
                className="hidden"
                disabled={importingSheet}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) processPoSpreadsheet(f); e.target.value = ""; }}
              />
            </label>
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
              {!isPrMode && orderedSupplierIds.length > 0 && (
                <optgroup label="Already have PO for this SO">
                  {suppliers.filter((s) => orderedSupplierIds.includes(s.id)).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}{s.registrationNo ? ` (${s.registrationNo})` : ""}
                    </option>
                  ))}
                </optgroup>
              )}
              <optgroup label={isPrMode ? "All suppliers" : (orderedSupplierIds.length > 0 ? "Other suppliers" : "Suppliers")}>
                {suppliers.filter((s) => isPrMode || !orderedSupplierIds.includes(s.id)).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}{s.registrationNo ? ` (${s.registrationNo})` : ""}
                  </option>
                ))}
              </optgroup>
            </select>
          )}
          {!isPrMode && supplierId && orderedSupplierIds.includes(supplierId) && (
            <div className="mt-2 flex items-center gap-2 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
              <AlertCircleIcon className="w-3.5 h-3.5 shrink-0" />
              This supplier already has an active PO for the selected sales order.
            </div>
          )}
        </section>

        {/* ── Linked SO (direct mode only) ── */}
        {!isPrMode && (
          <section className="border border-border rounded-xl p-4">
            <h2 className="text-sm font-semibold mb-1">Linked Sales Order</h2>
            <p className="text-xs text-muted-foreground mb-3">Optional — link to a confirmed SO if this order is tied to a customer order.</p>
            {selectedSo ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2 bg-muted/30 rounded-lg px-3 py-2">
                  <div className="flex-1">
                    <span className="text-sm font-mono font-medium">{selectedSo.soNo}</span>
                    {selectedSo.customerName && (
                      <span className="text-xs text-muted-foreground ml-2">— {selectedSo.customerName}</span>
                    )}
                  </div>
                  <button onClick={() => { setSelectedSo(null); setItems([newLine(1)]); setOrderedSupplierIds([]); setOrderedProductCodes([]); }} className="text-muted-foreground hover:text-foreground shrink-0">
                    <XIcon className="w-3.5 h-3.5" />
                  </button>
                </div>
                {orderedProductCodes.length > 0 && (
                  <div className="flex items-start gap-2 text-xs text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg px-3 py-2">
                    <InfoIcon className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>
                      {orderedProductCodes.length} item{orderedProductCodes.length !== 1 ? "s" : ""} already covered by existing POs
                      ({orderedProductCodes.join(", ")}) — showing remaining items only.
                    </span>
                  </div>
                )}
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
                        const { items: soItems, orderedSupplierIds: oids, orderedProductCodes: opcodes } = await getSalesOrderItemsForPo(so.id);
                        setOrderedSupplierIds(oids);
                        setOrderedProductCodes(opcodes);
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
                        } else {
                          setItems([newLine(1)]);
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
          {!isPrMode && (
            <div className="mb-3">
              <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer w-fit">
                <input
                  type="checkbox"
                  checked={useManualPoNo}
                  onChange={(e) => setUseManualPoNo(e.target.checked)}
                  className="rounded border-input"
                />
                This PO was already issued to the supplier — enter its existing number
              </label>
              {useManualPoNo && (
                <Input
                  value={manualPoNo}
                  onChange={(e) => setManualPoNo(e.target.value)}
                  placeholder="e.g. SUP-PO-2026-0042"
                  className="h-9 text-sm mt-1.5 max-w-xs"
                />
              )}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <Label className="text-xs">Expected delivery date</Label>
                {deliveryDateInherited && (
                  deliveryDate === deliveryDateInherited
                    ? <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-green-50 text-green-700 border border-green-200 dark:bg-green-950/40 dark:text-green-400 dark:border-green-800"><LinkIcon className="w-3 h-3 shrink-0" />from SO</span>
                    : <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800"><PencilIcon className="w-3 h-3 shrink-0" />{currentUserName ? `${currentUserName} edited SPO` : "edited SPO"}</span>
                )}
              </div>
              <input
                type="date"
                value={deliveryDate}
                onChange={(e) => setDeliveryDate(e.target.value)}
                className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <Label className="text-xs">Delivery address</Label>
                {deliveryAddressInherited && (
                  deliveryAddress === deliveryAddressInherited
                    ? <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-green-50 text-green-700 border border-green-200 dark:bg-green-950/40 dark:text-green-400 dark:border-green-800"><LinkIcon className="w-3 h-3 shrink-0" />from SO</span>
                    : <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800"><PencilIcon className="w-3 h-3 shrink-0" />{currentUserName ? `${currentUserName} edited SPO` : "edited SPO"}</span>
                )}
              </div>
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
        <div className="rounded-xl border border-border bg-background overflow-hidden">
          <div className="px-5 py-3 border-b border-border bg-muted/20 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold">
                Items
              </h2>
              {isPrMode && supplierId && (
                <p className="text-[11px] text-muted-foreground mt-0.5">Filtered from requisition — adjust actual prices.</p>
              )}
            </div>
            {loadingSoItems && <span className="text-xs text-muted-foreground animate-pulse">Loading…</span>}
          </div>

          {isPrMode && !supplierId ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              Select a supplier above to load items from this requisition.
            </p>
          ) : items.length === 0 && isPrMode ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No items assigned to this supplier in the requisition.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/30 text-muted-foreground">
                    <th className="text-left px-3 py-2 font-medium w-8">#</th>
                    <th className="text-left px-3 py-2 font-medium w-28">Code</th>
                    {showSourcing && (
                      <>
                        <th className="text-left px-3 py-2 font-medium w-32">Design Brand</th>
                        <th className="text-left px-3 py-2 font-medium w-32">Design Code</th>
                        <th className="text-left px-3 py-2 font-medium w-32">Emboss Code</th>
                      </>
                    )}
                    <th className="text-left px-3 py-2 font-medium">Description</th>
                    <th className="text-left px-3 py-2 font-medium w-12">Image</th>
                    <th className="text-left px-3 py-2 font-medium w-20">Qty</th>
                    <th className="text-left px-3 py-2 font-medium w-14">OUM</th>
                    <th className="text-left px-3 py-2 font-medium w-28">Unit Price</th>
                    <th className="text-left px-3 py-2 font-medium w-24">Total</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {items.map((item) => (
                    <tr key={item._key} className="group align-top">
                      <td className="px-3 py-2.5 text-muted-foreground">{item.rowNo}</td>

                      {/* Code — editable until a value is set, then locked; further
                          per-item adjustments happen through Design Brand/Design
                          Code/Emboss Code instead of retyping the primary code. */}
                      <td className="px-2 py-1.5">
                        {item.productCode?.trim() && !item._codeEditing ? (
                          <div className="h-7 flex items-center gap-1.5">
                            <span className="text-xs font-mono truncate">{item.productCode}</span>
                            <button
                              type="button"
                              onClick={() => updateItem(item._key, { productCode: "" })}
                              title="Clear to re-enter"
                              className="text-muted-foreground hover:text-foreground shrink-0"
                            >
                              <XIcon className="w-3 h-3" />
                            </button>
                          </div>
                        ) : (
                          <Input
                            value={item.productCode ?? ""}
                            onChange={(e) => updateItem(item._key, { productCode: e.target.value })}
                            onFocus={() => updateItem(item._key, { _codeEditing: true })}
                            onBlur={(e) => { handleProductCodeBlur(item._key, e.target.value); updateItem(item._key, { _codeEditing: false }); }}
                            className="h-7 text-xs"
                            placeholder="Code"
                          />
                        )}
                        {showSourcing && item.productCode?.trim() && (
                          item.sourcingType ? (
                            <button
                              type="button"
                              onClick={() => {
                                if (item.sourcingType === "trading") {
                                  updateItem(item._key, {
                                    sourcingType: "oem",
                                    privateLabelCode: item.privateLabelCode?.trim() ? item.privateLabelCode : (item.productCode ?? ""),
                                    privateLabelSource: item.privateLabelCode?.trim() ? item.privateLabelSource : "auto",
                                  });
                                } else {
                                  // Emboss Code is OEM-only — clear it going back to Trading so a
                                  // re-toggle to OEM later re-triggers the auto-fill from Code
                                  // instead of resurrecting a stale value.
                                  updateItem(item._key, { sourcingType: "trading", privateLabelCode: "", privateLabelSource: undefined });
                                }
                              }}
                              className={cn(
                                "mt-0.5 block text-[10px] px-1.5 py-0.5 rounded-md border font-medium",
                                item.sourcingType === "oem"
                                  ? "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/40 dark:text-purple-400 dark:border-purple-800"
                                  : "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800",
                              )}
                              title="Click to switch"
                            >
                              {item.sourcingType === "oem" ? "OEM" : "Trading"}
                            </button>
                          ) : (
                            <div className="mt-0.5 flex items-center gap-1">
                              <span className="text-[9px] text-destructive">sourcing?</span>
                              <button
                                type="button"
                                onClick={() => updateItem(item._key, { sourcingType: "trading" })}
                                className="text-[10px] px-1.5 py-0.5 rounded-md border border-border bg-muted/40 text-muted-foreground hover:bg-muted"
                              >
                                Trading
                              </button>
                              <button
                                type="button"
                                onClick={() => updateItem(item._key, {
                                  sourcingType: "oem",
                                  privateLabelCode: item.privateLabelCode?.trim() ? item.privateLabelCode : (item.productCode ?? ""),
                                  privateLabelSource: item.privateLabelCode?.trim() ? item.privateLabelSource : "auto",
                                })}
                                className="text-[10px] px-1.5 py-0.5 rounded-md border border-border bg-muted/40 text-muted-foreground hover:bg-muted"
                              >
                                OEM
                              </button>
                            </div>
                          )
                        )}
                      </td>

                      {showSourcing && (
                        <>
                          <td className="px-2 py-1.5">
                            <Input
                              value={item.designBrandName ?? ""}
                              onChange={(e) => updateItem(item._key, { designBrandName: e.target.value, designBrandSource: "user", oemEditedBy: currentUserName || "user" })}
                              disabled={item.sourcingType !== "oem"}
                              placeholder={item.sourcingType === "oem" ? "e.g. geister" : "—"}
                              className={cn(
                                "h-7 text-xs disabled:opacity-40 disabled:cursor-not-allowed",
                                item.sourcingType === "oem" && !item.designBrandName?.trim() ? "border-destructive" : "",
                              )}
                            />
                            {item.sourcingType === "oem" && item.designBrandSource && (
                              <span
                                className={cn(
                                  "inline-flex items-center gap-1 mt-0.5 text-[9px] px-1.5 py-0.5 rounded-md border",
                                  item.designBrandSource === "catalog"
                                    ? "bg-blue-50 text-blue-600 border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800"
                                    : "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800",
                                )}
                              >
                                {item.designBrandSource === "catalog" ? (
                                  <><DatabaseIcon className="w-2.5 h-2.5 shrink-0" />from catalogue</>
                                ) : (
                                  <><PencilIcon className="w-2.5 h-2.5 shrink-0" />{item.oemEditedBy ? `${item.oemEditedBy} edited SPO` : "edited SPO"}</>
                                )}
                              </span>
                            )}
                          </td>
                          <td className="px-2 py-1.5">
                            <DesignCodeCell
                              item={item}
                              onUpdate={updateItem}
                              disabled={item.sourcingType !== "oem"}
                              currentUserName={currentUserName}
                            />
                            {/* Design Code is always a direct entry into this field
                                (typed or picked from its own search dropdown) — unlike
                                Design Brand Name, it's never silently filled as a side
                                effect, so it's always attributed to the current user
                                rather than tagged "from catalogue". */}
                            {item.sourcingType === "oem" && item.designBrandCode?.trim() && (
                              <span className="inline-flex items-center gap-1 mt-0.5 text-[9px] px-1.5 py-0.5 rounded-md border bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800">
                                <PencilIcon className="w-2.5 h-2.5 shrink-0" />{item.oemEditedBy ? `${item.oemEditedBy} edited SPO` : "edited SPO"}
                              </span>
                            )}
                          </td>
                        </>
                      )}

                      {showSourcing && (
                        <td className="px-2 py-1.5">
                          <Input
                            value={item.privateLabelCode ?? ""}
                            onChange={(e) => updateItem(item._key, { privateLabelCode: e.target.value, privateLabelSource: "user", oemEditedBy: currentUserName || "user" })}
                            disabled={item.sourcingType !== "oem"}
                            placeholder={item.sourcingType === "oem" ? "e.g. F680-18DP" : "—"}
                            className={cn(
                              "h-7 text-xs disabled:opacity-40 disabled:cursor-not-allowed",
                              item.sourcingType === "oem" && !item.privateLabelCode?.trim() ? "border-destructive" : "",
                            )}
                          />
                          {item.sourcingType === "oem" && (
                            !item.privateLabelCode?.trim() ? (
                              <span className="inline-flex items-center gap-1 mt-0.5 text-[9px] px-1.5 py-0.5 rounded-md border bg-red-50 text-red-600 border-red-200 dark:bg-red-950/40 dark:text-red-400 dark:border-red-800">
                                <AlertTriangleIcon className="w-2.5 h-2.5 shrink-0" />missing
                              </span>
                            ) : item.privateLabelSource ? (
                              <span
                                className={cn(
                                  "inline-flex items-center gap-1 mt-0.5 text-[9px] px-1.5 py-0.5 rounded-md border",
                                  item.privateLabelSource === "auto" || item.privateLabelSource === "catalog"
                                    ? "bg-blue-50 text-blue-600 border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800"
                                    : "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800",
                                )}
                              >
                                {item.privateLabelSource === "catalog" ? (
                                  <><DatabaseIcon className="w-2.5 h-2.5 shrink-0" />from catalogue</>
                                ) : item.privateLabelSource === "auto" ? (
                                  <><LinkIcon className="w-2.5 h-2.5 shrink-0" />from Code</>
                                ) : (
                                  <><PencilIcon className="w-2.5 h-2.5 shrink-0" />{item.oemEditedBy ? `${item.oemEditedBy} edited SPO` : "edited SPO"}</>
                                )}
                              </span>
                            ) : null
                          )}
                        </td>
                      )}

                      {/* Description + badges */}
                      <td className="px-2 py-1.5">
                        {isPrMode ? (
                          (item.setGroupLabel || item.customerPoNo || item.customerOrganization || item.customerName) && (
                            <div className="flex flex-wrap gap-1 mb-1">
                              {item.setGroupLabel && (
                                <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-teal-50 dark:bg-teal-900/20 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-800">
                                  <TagIcon className="w-2.5 h-2.5 shrink-0" />
                                  {item.setGroupLabel}
                                </span>
                              )}
                              {item.customerPoNo && (
                                <span className="inline-flex items-center text-[10px] font-mono font-medium px-1.5 py-0.5 rounded-md border bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800">
                                  {item.customerPoNo}
                                </span>
                              )}
                              {item.customerOrganization && (
                                <span className="inline-flex items-center text-[10px] px-1.5 py-0.5 rounded-md bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-300 border border-violet-200 dark:border-violet-800">
                                  {item.customerOrganization}
                                </span>
                              )}
                              {item.customerName && (
                                <span className="inline-flex items-center text-[10px] px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground border border-border/60">
                                  {item.customerName}
                                </span>
                              )}
                            </div>
                          )
                        ) : (
                          <div className="mb-1 flex flex-wrap items-center gap-1">
                            {item.setGroupLabel && (
                              <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-teal-50 dark:bg-teal-900/20 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-800">
                                <TagIcon className="w-2.5 h-2.5 shrink-0" />
                                {item.setGroupLabel}
                              </span>
                            )}
                            <CustomerPickerCell item={item} onUpdate={updateItem} />
                          </div>
                        )}
                        <Input
                          value={item.description ?? ""}
                          onChange={(e) => updateItem(item._key, { description: e.target.value, descriptionSource: undefined, editedBy: currentUserName || "user" })}
                          className="h-7 text-xs"
                          placeholder="Description"
                        />
                        {item.descriptionSource === "product" && (
                          <span className="inline-flex items-center gap-1 mt-0.5 text-[10px] px-1.5 py-0.5 rounded-md bg-blue-50 text-blue-600 border border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800">
                            <DatabaseIcon className="w-3 h-3 shrink-0" />
                            from catalogue
                          </span>
                        )}
                        {item.descriptionSource === "pr" && (
                          <span className="inline-flex items-center gap-1 mt-0.5 text-[10px] px-1.5 py-0.5 rounded-md bg-green-50 text-green-700 border border-green-200 dark:bg-green-950/40 dark:text-green-400 dark:border-green-800">
                            <ClipboardListIcon className="w-3 h-3 shrink-0" />
                            from purchase requisition
                          </span>
                        )}
                        {item.isAdditional && (
                          <span className="inline-flex items-center gap-1 mt-0.5 text-[10px] px-1.5 py-0.5 rounded-md bg-purple-50 text-purple-700 border border-purple-200 dark:bg-purple-950/40 dark:text-purple-400 dark:border-purple-800">
                            <PlusIcon className="w-3 h-3 shrink-0" />
                            additional row
                          </span>
                        )}
                        {item.editedBy && (
                          <span className="inline-flex items-center gap-1 mt-0.5 text-[10px] px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800">
                            <PencilIcon className="w-3 h-3 shrink-0" />
                            {item.editedBy} edited SPO
                          </span>
                        )}
                        {item._imageFile && (
                          <div className="flex items-center gap-1 mt-1 text-[10px] text-muted-foreground">
                            <ImageIcon className="w-3 h-3 shrink-0" />
                            <span className="truncate flex-1">{item._imageUploading ? "Uploading…" : item._imageFile.name}</span>
                            {!item._imageUploading && (
                              <button onClick={() => removeItemImage(item._key)}><XIcon className="w-3 h-3" /></button>
                            )}
                          </div>
                        )}
                      </td>

                      {/* Image */}
                      <td className="px-2 py-1.5">
                        <input
                          id={`po-img-${item._key}`}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => handleItemImage(item._key, e)}
                        />
                        {item._imageUploading ? (
                          <div className="w-9 h-9 flex items-center justify-center rounded border border-border">
                            <span className="text-[10px] text-muted-foreground animate-pulse">…</span>
                          </div>
                        ) : (
                          <PoProductThumbnail
                            productCode={item.productCode ?? ""}
                            lookupCode={item.sourcingType === "oem" ? (item.designBrandCode?.trim() || undefined) : undefined}
                            overrideUrl={item._imagePreviewUrl}
                            onReplace={() => document.getElementById(`po-img-${item._key}`)?.click()}
                          />
                        )}
                      </td>

                      {/* Qty */}
                      <td className="px-2 py-1.5">
                        <Input
                          type="number"
                          value={item.qty}
                          onChange={(e) => updateItem(item._key, { qty: e.target.value })}
                          className="h-7 text-xs text-center"
                        />
                      </td>

                      {/* UOM */}
                      <td className="px-2 py-1.5">
                        <Input
                          value={item.uom ?? ""}
                          onChange={(e) => updateItem(item._key, { uom: e.target.value })}
                          className="h-7 text-xs"
                          placeholder="oum"
                        />
                      </td>

                      {/* Unit Price */}
                      <td className="px-2 py-1.5">
                        <Input
                          type="number"
                          value={item.unitPrice ?? "0"}
                          onChange={(e) => updateItem(item._key, { unitPrice: e.target.value })}
                          className="h-7 text-xs text-right"
                          placeholder="0.00"
                        />
                      </td>

                      {/* Total */}
                      <td className="px-3 py-2.5 tabular-nums font-medium text-right">
                        <span className="text-[10px] text-muted-foreground mr-0.5">{item.currency ?? currency}</span>
                        {parseFloat(item.totalPrice || "0").toLocaleString("en-MY", { minimumFractionDigits: 2 })}
                      </td>

                      {/* Delete */}
                      <td className="px-2 py-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
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
          )}

          <div className="px-4 py-3 border-t border-border flex items-center justify-between">
            <Button variant="ghost" size="sm" className="gap-1.5 text-xs" onClick={addLine} disabled={loadingSoItems}>
              <PlusIcon className="w-3 h-3" /> Add Item
            </Button>
            <div className="flex items-center gap-3 text-xs text-muted-foreground tabular-nums">
              <span>
                <span className="font-medium text-foreground">{currency}</span>{" "}
                <span className="font-semibold text-foreground">
                  {subtotal.toLocaleString("en-MY", { minimumFractionDigits: 2 })}
                </span>
              </span>
            </div>
          </div>
        </div>

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
