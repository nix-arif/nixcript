"use client";

// Shared between create-po-client.tsx and edit-po-client.tsx — item-level
// state, the sourcing/design-code/customer-picker cells, the catalogue image
// thumbnail, and the items table itself. Extracted so the two forms can't
// drift apart the way they previously did: edit-po-client.tsx used to be an
// independent, much older copy that only knew about 8 of the ~25 fields a
// line item actually carries, silently dropping the rest (sourcing type,
// design brand/code, emboss code, per-item customer, set group, etc.) on
// every save. See PurchaseOrderItemInput in server/purchase-order.ts and
// applyPurchaseOrderUpdate, which already fully support every field below —
// the gap was purely that the edit form never read or displayed them.

import { useState, useRef, useEffect } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { toast } from "sonner";
import {
  getPoItemImageUploadUrl,
  deleteProcurementImages,
  searchCustomersForPo,
  type PurchaseOrderItemInput,
} from "@/server/purchase-order";
import { getProductByCode, getDesignCodeImageUploadUrl } from "@/server/products";
import { searchProductsByDesignCode } from "@/server/inventory";
import { cn } from "@/lib/utils";
import { uid } from "@/lib/uid";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  XIcon, ImageIcon, UploadIcon, DatabaseIcon, LinkIcon, PencilIcon,
  AlertTriangleIcon, TagIcon, ClipboardListIcon, PlusIcon, TrashIcon,
} from "lucide-react";

const R2_PRODUCT_IMAGES = process.env.NEXT_PUBLIC_R2_PRODUCT_IMAGES_URL ?? "";
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB

export const CURRENCIES = ["MYR", "USD", "EUR", "SGD", "GBP", "AUD", "JPY", "CNY", "IDR", "THB"];

export interface LineItem extends PurchaseOrderItemInput {
  _key: string;
  _imageFile?: File;
  _imageUploading?: boolean;
  _imagePreviewUrl?: string;
  _imageInherited?: boolean; // key came from PR — must not be deleted by PO form
  _cpoId?: string | null;
  _codeEditing?: boolean; // Code field stays an input while true — set on focus, cleared on blur
}

export const newLine = (rowNo: number, key?: string): LineItem => ({
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

export function calcLine(item: LineItem): LineItem {
  const qty = parseFloat(item.qty || "0") || 0;
  const up = parseFloat(item.unitPrice || "0") || 0;
  return { ...item, totalPrice: (qty * up).toFixed(2) };
}

export function calcTotals(items: LineItem[], sstPct: string) {
  const subtotal = items.reduce((s, i) => s + parseFloat(i.totalPrice || "0"), 0);
  const sstAmt = (subtotal * (parseFloat(sstPct) || 0)) / 100;
  return { subtotal, sstAmt, grand: subtotal + sstAmt };
}

export function detectCurrency(items: { currency?: string | null }[]): string {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const c = item.currency;
    if (c) counts[c] = (counts[c] ?? 0) + 1;
  }
  const [top] = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return top?.[0] ?? "MYR";
}

export const fmt = (n: number, currency: string) => `${currency} ${n.toLocaleString("en-MY", { minimumFractionDigits: 2 })}`;

// A product fixed at "trading" or "oem" is inherited silently; "both" (or no
// catalog match at all) is ambiguous and needs an explicit pick on the item.
export function resolveSourcingType(productSourcingType: string | null | undefined): "trading" | "oem" | null {
  return productSourcingType === "trading" || productSourcingType === "oem" ? productSourcingType : null;
}

export function validateImageFile(file: File): string | null {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    return "Unsupported format — please use JPG, PNG, WebP, or GIF.";
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return `File too large — maximum is 5 MB (this file is ${(file.size / 1024 / 1024).toFixed(1)} MB).`;
  }
  return null;
}

export function uploadErrorMessage(err: unknown): string {
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
export const IMAGE_EXT_CANDIDATES = ["jpg", "jpeg", "png", "webp"];

// Resolves the image src for a catalogue-image lookup code (a product code,
// or — for an OEM item — its design code, since our own product code there
// is a private-label code we made up and the actual photo, if any, lives
// under the design house's own code instead), trying each extension in
// IMAGE_EXT_CANDIDATES in turn on 404. Shared by every place in the app that
// shows this thumbnail (Create, Edit, the read-only Detail page) so a fix to
// how the src is guessed can't land in one and silently miss the others —
// that's exactly what happened before this was extracted: the Detail page's
// own copy kept the old ".jpg", product-code-only guess after Create/Edit
// gained the design-code fallback and the extension chain, so the same item
// showed correctly in Edit and incorrectly on Detail.
export function useCatalogImageSrc(catalogCode: string, overrideUrl?: string) {
  const [extIdx, setExtIdx] = useState(0);
  const exhausted = extIdx >= IMAGE_EXT_CANDIDATES.length;
  const catalogSrc = R2_PRODUCT_IMAGES && catalogCode && !exhausted
    ? `${R2_PRODUCT_IMAGES}/${encodeURIComponent(catalogCode)}.${IMAGE_EXT_CANDIDATES[extIdx]}`
    : "";
  const src = overrideUrl || catalogSrc;

  useEffect(() => { setExtIdx(0); }, [overrideUrl, catalogCode]);

  function onImgError() {
    if (!overrideUrl) setExtIdx((i) => i + 1);
  }

  return { src, onImgError, noImage: !src || (!overrideUrl && exhausted) };
}

export function PoProductThumbnail({ productCode, lookupCode, overrideUrl, onReplace }: { productCode: string; lookupCode?: string; overrideUrl?: string; onReplace: () => void }) {
  const [open, setOpen] = useState(false);
  const catalogCode = lookupCode || productCode;
  const { src, onImgError, noImage } = useCatalogImageSrc(catalogCode, overrideUrl);

  if (noImage) {
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
        <img src={src} className="w-full h-full object-cover" alt="" onError={onImgError} />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg p-0 overflow-hidden gap-0" showCloseButton={false}>
          <DialogTitle className="sr-only">{productCode}</DialogTitle>
          <div className="relative bg-muted/30">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} className="w-full object-contain max-h-[65vh]" alt={productCode} onError={() => { onImgError(); setOpen(false); }} />
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

// Autocomplete on the OEM "Design Code" column — searches the catalogue by
// product.designBrandCode (min 3 chars) and, on a match, fills Design Brand
// Name and (if still empty) Description, tagging both with their source.
export function DesignCodeCell({
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
// The "LOOSE ITEMS"-style tag grouping several rows into one set — normally
// only ever arrives via spreadsheet import (guessed from a title row above
// the item table) or inherited from a PR, with no way to add or fix one by
// hand afterward. Click the tag (or the dashed placeholder when there isn't
// one yet) to edit it inline; blurring with it empty clears the tag. A new
// tag gets a fresh setGroupId so it reads as its own group rather than
// silently joining whatever group last held this id.
function SetGroupLabelCell({
  item,
  onUpdate,
}: {
  item: LineItem;
  onUpdate: (key: string, patch: Partial<LineItem>) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(item.setGroupLabel ?? "");

  useEffect(() => {
    setValue(item.setGroupLabel ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item._key]);

  function commit() {
    const trimmed = value.trim();
    onUpdate(item._key, {
      setGroupLabel: trimmed || undefined,
      setGroupId: trimmed ? (item.setGroupId ?? uid()) : undefined,
    });
    setEditing(false);
  }

  if (editing) {
    return (
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") { setValue(item.setGroupLabel ?? ""); setEditing(false); }
        }}
        placeholder="Set/group name…"
        className="h-5 w-28 text-[10px] border border-input rounded px-1 bg-background focus:outline-none focus:ring-1 focus:ring-ring"
      />
    );
  }

  if (item.setGroupLabel) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        title="Click to edit"
        className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-teal-50 dark:bg-teal-900/20 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-800 hover:bg-teal-100 dark:hover:bg-teal-900/40 transition-colors"
      >
        <TagIcon className="w-2.5 h-2.5 shrink-0" />
        {item.setGroupLabel}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      title="Add a set/group tag"
      className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md border border-dashed border-border text-muted-foreground hover:border-foreground hover:text-foreground transition-colors"
    >
      <TagIcon className="w-2.5 h-2.5 shrink-0" />
      Add tag
    </button>
  );
}

export function CustomerPickerCell({
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

  // customerName has no separate title field of its own — the title (Dr,
  // Mr, Ms, Mdm, Prof) is prefixed straight into it at pick time so every
  // display of this field (this chip, the PO PDF, etc.) always carries it
  // without each of those needing to know about titles separately.
  function pick(customerId: string, name: string, title: string | null, orgId: string | null, orgName: string | null) {
    onUpdate(item._key, {
      customerId,
      customerOrganizationId: orgId ?? undefined,
      customerName: title?.trim() ? `${title.trim()} ${name}` : name,
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
                <div className="px-2 pt-1.5 pb-0.5 font-medium truncate">{r.title?.trim() ? `${r.title.trim()} ${r.name}` : r.name}</div>
                {r.memberships.length > 0 ? (
                  r.memberships.map((m) => (
                    <button
                      key={m.customerOrganizationId}
                      type="button"
                      className="w-full text-left pl-4 pr-2 py-1 hover:bg-accent text-muted-foreground truncate flex items-center gap-1"
                      onClick={() => pick(r.id, r.name, r.title, m.customerOrganizationId, m.orgName)}
                    >
                      {m.orgName}
                      {m.isPrimary && <span className="text-[9px] text-muted-foreground/70">(primary)</span>}
                    </button>
                  ))
                ) : (
                  <button
                    type="button"
                    className="w-full text-left pl-4 pr-2 py-1 hover:bg-accent text-muted-foreground italic"
                    onClick={() => pick(r.id, r.name, r.title, null, null)}
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

// ── State-transition factories ──────────────────────────────────────────
// Each takes the calling page's own items state (setItems/itemsRef) and
// returns handlers with identical behavior wherever they're used — the
// actual fix for edit/create silently drifting apart.

export function useUpdateItem(setItems: Dispatch<SetStateAction<LineItem[]>>) {
  return function updateItem(key: string, patch: Partial<LineItem>) {
    setItems((prev) =>
      prev.map((i) => {
        if (i._key !== key) return i;
        const updated = { ...i, ...patch };
        return ["qty", "unitPrice"].some((k) => k in patch) ? calcLine(updated) : updated;
      }),
    );
  };
}

export function useAddLine(setItems: Dispatch<SetStateAction<LineItem[]>>) {
  return function addLine() {
    setItems((prev) => [...prev, newLine(prev.length + 1, uid())]);
  };
}

export function useRemoveLine({
  itemsRef,
  setItems,
}: {
  itemsRef: MutableRefObject<LineItem[]>;
  setItems: Dispatch<SetStateAction<LineItem[]>>;
}) {
  return function removeLine(key: string) {
    const removed = itemsRef.current.find((i) => i._key === key);
    if (removed?.imageKey && !removed._imageInherited) deleteProcurementImages([removed.imageKey]).catch(() => {});
    setItems((prev) => {
      const next = prev.filter((i) => i._key !== key);
      return next.map((i, idx) => ({ ...i, rowNo: idx + 1 }));
    });
  };
}

// Cleans up any one-off attachment uploaded during this session but never
// actually saved (navigated away, closed the tab) — without this, those
// files sit orphaned in the procurement-docs bucket forever. Skips cleanup
// once committedRef is set (right before a successful save), since at that
// point the images are referenced by the saved order and must not be deleted.
export function useCleanupOrphanedImages(
  itemsRef: MutableRefObject<LineItem[]>,
  committedRef: MutableRefObject<boolean>,
) {
  useEffect(() => {
    return () => {
      if (committedRef.current) return;
      const keys = itemsRef.current.flatMap((i) =>
        i.imageKey && !i._imageInherited ? [i.imageKey] : [],
      );
      if (keys.length) deleteProcurementImages(keys).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

export function useHandleProductCodeBlur({
  itemsRef,
  setItems,
}: {
  itemsRef: MutableRefObject<LineItem[]>;
  setItems: Dispatch<SetStateAction<LineItem[]>>;
}) {
  return async function handleProductCodeBlur(key: string, code: string) {
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
  };
}

export function useItemImageHandlers({
  itemsRef,
  updateItem,
}: {
  itemsRef: MutableRefObject<LineItem[]>;
  updateItem: (key: string, patch: Partial<LineItem>) => void;
}) {
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

  function removeItemImage(key: string) {
    const item = itemsRef.current.find((i) => i._key === key);
    if (item?.imageKey && !item._imageInherited) deleteProcurementImages([item.imageKey]).catch(() => {});
    updateItem(key, { imageKey: undefined, _imageFile: undefined, _imagePreviewUrl: undefined, _imageInherited: false });
  }

  return { handleItemImage, removeItemImage };
}

// ── The items table itself ──────────────────────────────────────────────

export function PoItemsTable({
  items,
  showSourcing,
  currency,
  currentUserName,
  loadingSoItems = false,
  isPrMode = false,
  supplierId,
  updateItem,
  addLine,
  removeLine,
  handleProductCodeBlur,
  handleItemImage,
  removeItemImage,
}: {
  items: LineItem[];
  showSourcing: boolean;
  currency: string;
  currentUserName?: string;
  loadingSoItems?: boolean;
  isPrMode?: boolean;
  supplierId?: string;
  updateItem: (key: string, patch: Partial<LineItem>) => void;
  addLine: () => void;
  removeLine: (key: string) => void;
  handleProductCodeBlur: (key: string, code: string) => void;
  handleItemImage: (key: string, e: React.ChangeEvent<HTMLInputElement>) => void;
  removeItemImage: (key: string) => void;
}) {
  const subtotal = items.reduce((s, i) => s + parseFloat(i.totalPrice || "0"), 0);

  return (
    <div className="rounded-xl border border-border bg-background overflow-hidden">
      <div className="px-5 py-3 border-b border-border bg-muted/20 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold">Items</h2>
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
                        <SetGroupLabelCell item={item} onUpdate={updateItem} />
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
  );
}
