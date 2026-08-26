"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  completePackingListInspection,
  saveInspectionLineDraft,
  getInspectionLineStates,
  getInspectionPhotoUploadUrl,
  addInspectionPhoto,
  deleteInspectionPhoto,
  type PackingListWithItems,
  type InspectionPhoto,
  type InspectionPhotoCategory,
} from "@/server/packing-list";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/page-header";
import {
  ArrowLeftIcon, ClipboardCheckIcon, AlertTriangleIcon, XIcon, CheckIcon, LoaderIcon,
  DatabaseIcon, PencilIcon, ClipboardListIcon, PlusIcon, TagIcon, LinkIcon, UserIcon, CameraIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

const R2_PRODUCT_IMAGES = process.env.NEXT_PUBLIC_R2_PRODUCT_IMAGES_URL ?? "";
const AUTOSAVE_DEBOUNCE_MS = 800;
const POLL_INTERVAL_MS = 5000;

const PO_COLORS = [
  { bg: "bg-blue-50/50 dark:bg-blue-950/15", header: "bg-blue-100/70 dark:bg-blue-900/30", border: "border-blue-200 dark:border-blue-800/50", stripe: "bg-blue-100/60 dark:bg-blue-900/25" },
  { bg: "bg-green-50/50 dark:bg-green-950/15", header: "bg-green-100/70 dark:bg-green-900/30", border: "border-green-200 dark:border-green-800/50", stripe: "bg-green-100/60 dark:bg-green-900/25" },
  { bg: "bg-amber-50/50 dark:bg-amber-950/15", header: "bg-amber-100/70 dark:bg-amber-900/30", border: "border-amber-200 dark:border-amber-800/50", stripe: "bg-amber-100/60 dark:bg-amber-900/25" },
  { bg: "bg-purple-50/50 dark:bg-purple-950/15", header: "bg-purple-100/70 dark:bg-purple-900/30", border: "border-purple-200 dark:border-purple-800/50", stripe: "bg-purple-100/60 dark:bg-purple-900/25" },
  { bg: "bg-pink-50/50 dark:bg-pink-950/15", header: "bg-pink-100/70 dark:bg-pink-900/30", border: "border-pink-200 dark:border-pink-800/50", stripe: "bg-pink-100/60 dark:bg-pink-900/25" },
  { bg: "bg-teal-50/50 dark:bg-teal-950/15", header: "bg-teal-100/70 dark:bg-teal-900/30", border: "border-teal-200 dark:border-teal-800/50", stripe: "bg-teal-100/60 dark:bg-teal-900/25" },
] as const;

function ItemImageThumb({ imageUrl, productCode }: { imageUrl: string | null; productCode?: string | null }) {
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);

  const catalogSrc = R2_PRODUCT_IMAGES && productCode
    ? `${R2_PRODUCT_IMAGES}/${encodeURIComponent(productCode)}.jpg`
    : "";
  const src = imageUrl || catalogSrc;

  if (!src || failed) return <span className="text-muted-foreground">—</span>;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="block w-9 h-9 rounded border border-border overflow-hidden hover:opacity-80 transition-opacity shrink-0"
        title="View image"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} className="w-full h-full object-cover" alt="" onError={() => setFailed(true)} />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg p-0 overflow-hidden gap-0" showCloseButton={false}>
          <DialogTitle className="sr-only">{productCode ?? "Image"}</DialogTitle>
          <div className="relative bg-muted/30">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              className="w-full object-contain max-h-[65vh]"
              alt={productCode ?? ""}
              onError={() => { setFailed(true); setOpen(false); }}
            />
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="absolute top-2 right-2 w-7 h-7 flex items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
            >
              <XIcon className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="px-4 py-3 border-t">
            <p className="text-xs text-muted-foreground font-mono truncate">{productCode ?? ""}</p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

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
  return msg;
}

function InspectionPhotoStrip({
  photos, uploading, onUpload, onDelete,
}: {
  photos: InspectionPhoto[];
  uploading: boolean;
  onUpload: (files: FileList) => void;
  onDelete: (photoId: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [lightbox, setLightbox] = useState<InspectionPhoto | null>(null);

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1">
      {photos.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => setLightbox(p)}
          className="block w-9 h-9 rounded border border-border overflow-hidden hover:opacity-80 transition-opacity shrink-0"
          title="View photo"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={p.url} className="w-full h-full object-cover" alt="" />
        </button>
      ))}
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="flex items-center justify-center w-9 h-9 rounded border border-dashed border-border text-muted-foreground hover:border-foreground/50 hover:text-foreground transition-colors disabled:opacity-40 shrink-0"
        title="Add photo"
      >
        {uploading ? <LoaderIcon className="w-3.5 h-3.5 animate-spin" /> : <CameraIcon className="w-3.5 h-3.5" />}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = e.target.files;
          if (files && files.length > 0) onUpload(files);
          e.target.value = "";
        }}
      />
      <Dialog open={!!lightbox} onOpenChange={(o) => !o && setLightbox(null)}>
        <DialogContent className="sm:max-w-lg p-0 overflow-hidden gap-0" showCloseButton={false}>
          <DialogTitle className="sr-only">Inspection photo</DialogTitle>
          {lightbox && (
            <>
              <div className="relative bg-muted/30">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={lightbox.url} className="w-full object-contain max-h-[65vh]" alt="" />
                <button
                  type="button"
                  onClick={() => setLightbox(null)}
                  className="absolute top-2 right-2 w-7 h-7 flex items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
                >
                  <XIcon className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="px-4 py-3 border-t flex items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground truncate">
                  {lightbox.uploadedByName ? `Added by ${lightbox.uploadedByName}` : ""}
                </p>
                <button
                  type="button"
                  onClick={() => { onDelete(lightbox.id); setLightbox(null); }}
                  className="text-xs text-destructive hover:underline shrink-0"
                >
                  Delete
                </button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface Props {
  packingList: PackingListWithItems;
  businessType?: string;
  submitFn?: typeof completePackingListInspection;
  backHref?: string;
  // Shown when this is the centralized (cross-org) inspect flow, so it's
  // clear which org this packing list actually belongs to.
  organizationName?: string;
}

type Row = {
  qtyReceived: string;
  qtyReturn: string;
  qtyRepair: string;
  returnNotes: string;
  repairNotes: string;
  inspectedByName: string | null;
  inspectedAt: string | null; // ISO — compared against poll results to avoid clobbering newer local saves
  saving: boolean;
  dirty: boolean; // has local edits not yet persisted
  photos: InspectionPhoto[];
  uploadingReturnPhotos: boolean;
  uploadingRepairPhotos: boolean;
};

function initialRow(item: PackingListWithItems["items"][number]): Row {
  return {
    qtyReceived: item.draftQtyReceived ?? item.qtyExpected,
    qtyReturn: item.draftQtyReturn ?? "0",
    qtyRepair: item.draftQtyRepair ?? "0",
    returnNotes: item.draftReturnNotes ?? "",
    repairNotes: item.draftRepairNotes ?? "",
    inspectedByName: item.draftInspectedByName,
    inspectedAt: item.draftInspectedAt ? new Date(item.draftInspectedAt).toISOString() : null,
    saving: false,
    dirty: false,
    photos: item.photos,
    uploadingReturnPhotos: false,
    uploadingRepairPhotos: false,
  };
}

export function InspectPackingListClient({
  packingList: pl, businessType = "trading",
  submitFn = completePackingListInspection,
  backHref, organizationName,
}: Props) {
  const router = useRouter();
  const backUrl = backHref ?? `/dashboard/procurement/packing-list/${pl.id}`;
  const showSourcing = businessType !== "trading";
  const [receivedDate, setReceivedDate] = useState<string>(new Date().toISOString().split("T")[0]);
  const [notes, setNotes] = useState("");
  const [completing, setCompleting] = useState(false);
  const [rows, setRows] = useState<Record<string, Row>>(
    Object.fromEntries(pl.items.map((item) => [item.id, initialRow(item)])),
  );

  const rowsRef = useRef(rows);
  useEffect(() => { rowsRef.current = rows; }, [rows]);
  const focusedItemIdRef = useRef<string | null>(null);
  const debounceTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const poLabel = (poId: string) => {
    const po = pl.purchaseOrders.find((p) => p.id === poId);
    return po?.poNo ?? po?.prNo ?? poId;
  };

  function updateRow(itemId: string, patch: Partial<Row>) {
    setRows((prev) => ({ ...prev, [itemId]: { ...prev[itemId], ...patch, dirty: true } }));
    if (debounceTimers.current[itemId]) clearTimeout(debounceTimers.current[itemId]);
    debounceTimers.current[itemId] = setTimeout(() => saveRow(itemId), AUTOSAVE_DEBOUNCE_MS);
  }

  const saveRow = useCallback(async (itemId: string) => {
    const row = rowsRef.current[itemId];
    if (!row || !row.dirty || row.saving) return;
    if (debounceTimers.current[itemId]) { clearTimeout(debounceTimers.current[itemId]); delete debounceTimers.current[itemId]; }

    const received = parseFloat(row.qtyReceived) || 0;
    const ret = parseFloat(row.qtyReturn) || 0;
    const repair = parseFloat(row.qtyRepair) || 0;
    if (ret + repair > received + 1e-9) {
      toast.error("Return + repair quantity can't exceed received quantity");
      return;
    }

    setRows((prev) => ({ ...prev, [itemId]: { ...prev[itemId], saving: true } }));
    try {
      const result = await saveInspectionLineDraft(itemId, {
        qtyReceived: row.qtyReceived || "0",
        qtyReturn: row.qtyReturn || "0",
        qtyRepair: row.qtyRepair || "0",
        returnNotes: row.returnNotes || undefined,
        repairNotes: row.repairNotes || undefined,
      });
      setRows((prev) => ({
        ...prev,
        [itemId]: {
          ...prev[itemId],
          saving: false,
          dirty: false,
          inspectedByName: result.inspectedByName,
          inspectedAt: new Date(result.inspectedAt).toISOString(),
        },
      }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save this line");
      setRows((prev) => ({ ...prev, [itemId]: { ...prev[itemId], saving: false } }));
    }
  }, []);

  function handleFocusRow(itemId: string) {
    focusedItemIdRef.current = itemId;
  }
  function handleBlurRow(itemId: string) {
    if (focusedItemIdRef.current === itemId) focusedItemIdRef.current = null;
    saveRow(itemId);
  }

  // Poll every few seconds so everyone currently inspecting this packing
  // list sees each other's line-by-line progress. Qty/notes and photos sync
  // independently: qty/notes only apply once strictly newer than what's
  // local and never while the local user is focused in or mid-save on that
  // row; photos are purely additive from other users so they always adopt
  // the server's list except mid-upload, where local optimistic state is
  // briefly ahead of what the poll can see (adding a photo doesn't bump
  // draftInspectedAt, so it can't ride the same newer-than-local timestamp gate).
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const states = await getInspectionLineStates(pl.id);
        setRows((prev) => {
          const next = { ...prev };
          for (const s of states) {
            const local = next[s.packingListItemId];
            if (!local) continue;
            let updated = local;

            if (!local.uploadingReturnPhotos && !local.uploadingRepairPhotos) {
              updated = { ...updated, photos: s.photos };
            }

            if (focusedItemIdRef.current !== s.packingListItemId && !local.dirty && !local.saving) {
              const serverAt = s.inspectedAt ? new Date(s.inspectedAt).getTime() : 0;
              const localAt = local.inspectedAt ? new Date(local.inspectedAt).getTime() : 0;
              if (serverAt > localAt) {
                updated = {
                  ...updated,
                  qtyReceived: s.draftQtyReceived ?? updated.qtyReceived,
                  qtyReturn: s.draftQtyReturn ?? "0",
                  qtyRepair: s.draftQtyRepair ?? "0",
                  returnNotes: s.draftReturnNotes ?? "",
                  repairNotes: s.draftRepairNotes ?? "",
                  inspectedByName: s.inspectedByName,
                  inspectedAt: s.inspectedAt ? new Date(s.inspectedAt).toISOString() : updated.inspectedAt,
                };
              }
            }

            if (updated !== local) next[s.packingListItemId] = updated;
          }
          return next;
        });
      } catch {
        // Silent — a missed poll just means we retry in another interval tick.
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [pl.id]);

  async function handlePhotoUpload(itemId: string, category: InspectionPhotoCategory, fileList: FileList) {
    const files = Array.from(fileList);
    const validFiles: File[] = [];
    for (const file of files) {
      const err = validateImageFile(file);
      if (err) toast.error(`${file.name}: ${err}`);
      else validFiles.push(file);
    }
    if (validFiles.length === 0) return;

    const uploadingKey = category === "return" ? "uploadingReturnPhotos" : "uploadingRepairPhotos";
    setRows((prev) => ({ ...prev, [itemId]: { ...prev[itemId], [uploadingKey]: true } }));
    let failCount = 0;
    for (const file of validFiles) {
      try {
        const { key, uploadUrl } = await getInspectionPhotoUploadUrl(itemId, file.name, category);
        const res = await fetch(uploadUrl, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const photo = await addInspectionPhoto(itemId, key, category);
        setRows((prev) => ({ ...prev, [itemId]: { ...prev[itemId], photos: [...prev[itemId].photos, photo] } }));
      } catch (e) {
        failCount++;
        toast.error(`${file.name}: ${uploadErrorMessage(e)}`);
      }
    }
    setRows((prev) => ({ ...prev, [itemId]: { ...prev[itemId], [uploadingKey]: false } }));
    if (failCount === 0) toast.success(`${validFiles.length} photo${validFiles.length > 1 ? "s" : ""} added`);
  }

  async function handlePhotoDelete(itemId: string, photoId: string) {
    setRows((prev) => ({ ...prev, [itemId]: { ...prev[itemId], photos: prev[itemId].photos.filter((p) => p.id !== photoId) } }));
    try {
      await deleteInspectionPhoto(photoId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't delete photo");
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!receivedDate) { toast.error("Received date is required"); return; }

    setCompleting(true);
    try {
      // Flush any edits still pending debounce so completion reflects the
      // very latest keystrokes, not a stale autosave from a few hundred ms ago.
      const dirtyIds = Object.entries(rowsRef.current).filter(([, r]) => r.dirty).map(([id]) => id);
      await Promise.all(dirtyIds.map((id) => saveRow(id)));

      await submitFn(pl.id, {
        receivedDate: new Date(receivedDate),
        notes: notes || undefined,
      });
      toast.success("Inspection recorded");
      router.push(backUrl);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
      setCompleting(false);
    }
  }

  const byPo = pl.items.reduce<Record<string, typeof pl.items>>((acc, item) => {
    (acc[item.purchaseOrderId] ??= []).push(item);
    return acc;
  }, {});

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title={`Inspect ${pl.packingListNo}`}
        description={`Mark what actually arrived, in what condition, and where any damaged units go next${organizationName ? ` · ${organizationName}` : ""}`}
        action={
          <Button variant="outline" size="sm" onClick={() => router.push(backUrl)} className="gap-1.5">
            <ArrowLeftIcon className="w-3.5 h-3.5" /> Back
          </Button>
        }
      />

      <form onSubmit={handleSubmit} className="space-y-5">
        <section className="border border-border rounded-xl p-4 space-y-4 max-w-3xl">
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Receipt Details</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Received Date <span className="text-destructive">*</span></label>
              <Input type="date" value={receivedDate} onChange={(e) => setReceivedDate(e.target.value)} className="h-9 text-sm" required />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Notes</label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Inspection remarks…" className="text-sm resize-none" rows={2} />
          </div>
          <p className="text-[11px] text-muted-foreground">
            Each line below saves automatically as you edit it — several people can inspect different lines of this packing list at the same time.
          </p>
        </section>

        {Object.entries(byPo).map(([poId, items], poIndex) => {
          const color = PO_COLORS[poIndex % PO_COLORS.length];
          return (
          <section key={poId} className={cn("border rounded-xl overflow-hidden", color.border, color.bg)}>
            <div className={cn("px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide font-mono", color.header)}>
              {poLabel(poId)}
            </div>
            <div className="overflow-x-auto p-4 pt-3">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="text-right pb-2 pr-2 w-8">#</th>
                    {showSourcing && (
                      <>
                        <th className="text-left pb-2 pr-3 w-24">Design Brand</th>
                        <th className="text-left pb-2 pr-3 w-20">Design Code</th>
                      </>
                    )}
                    <th className="text-left pb-2 pr-3 w-20">Emboss Code</th>
                    <th className="text-left pb-2 pr-3">Description</th>
                    <th className="text-left pb-2 pr-3 w-10">Img</th>
                    <th className="text-right pb-2 pr-3 w-16">Expected</th>
                    <th className="text-right pb-2 pr-3 w-24">Received</th>
                    <th className="text-right pb-2 pr-3 w-24">Return</th>
                    <th className="text-right pb-2 pr-3 w-24">Inhouse Repair</th>
                    <th className="text-right pb-2 pr-3 w-16">Accepted</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, itemIndex) => {
                    const row = rows[item.id];
                    const received = parseFloat(row.qtyReceived) || 0;
                    const ret = parseFloat(row.qtyReturn) || 0;
                    const repair = parseFloat(row.qtyRepair) || 0;
                    // In-house repair still counts as accepted stock — only a
                    // return to the supplier actually reduces what's accepted.
                    const accepted = Math.max(0, received - ret);
                    const overCommitted = ret + repair > received + 1e-9;
                    return (
                      <tr
                        key={item.id}
                        className={cn("border-b border-border/40 last:border-0 align-top", itemIndex % 2 === 1 && color.stripe)}
                      >
                        <td className="py-2.5 pr-2 text-right text-muted-foreground/70 tabular-nums align-top">{itemIndex + 1}</td>
                        {showSourcing && (
                          <>
                            <td className="py-2.5 pr-3 align-top">
                              {item.designBrandName?.trim() ? (
                                <div className="flex flex-col gap-0.5">
                                  <span className="text-muted-foreground">{item.designBrandName}</span>
                                  {item.designBrandSource === "catalog" ? (
                                    <span className="inline-flex items-center gap-1 w-fit text-[9px] px-1.5 py-0.5 rounded-md bg-blue-50 text-blue-600 border border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800">
                                      <DatabaseIcon className="w-2.5 h-2.5 shrink-0" />from catalogue
                                    </span>
                                  ) : item.designBrandSource === "user" && (
                                    <span className="inline-flex items-center gap-1 w-fit text-[9px] px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800">
                                      <PencilIcon className="w-2.5 h-2.5 shrink-0" />{item.oemEditedBy ? `${item.oemEditedBy} edited SPO` : "edited SPO"}
                                    </span>
                                  )}
                                </div>
                              ) : item.sourcingType === "oem" ? (
                                <span className="text-destructive">missing</span>
                              ) : "—"}
                            </td>
                            <td className="py-2.5 pr-3 align-top">
                              {item.designBrandCode?.trim() ? (
                                <div className="flex flex-col gap-0.5">
                                  <span className="font-mono text-muted-foreground">{item.designBrandCode}</span>
                                  <span className="inline-flex items-center gap-1 w-fit text-[9px] px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800">
                                    <PencilIcon className="w-2.5 h-2.5 shrink-0" />{item.oemEditedBy ? `${item.oemEditedBy} edited SPO` : "edited SPO"}
                                  </span>
                                </div>
                              ) : item.sourcingType === "oem" ? (
                                <span className="font-sans text-destructive">missing</span>
                              ) : "—"}
                            </td>
                          </>
                        )}
                        <td className="py-2.5 pr-3 align-top">
                          <div className="flex flex-col gap-0.5">
                            <span className="font-mono text-muted-foreground">{item.productCode || "—"}</span>
                            {showSourcing && item.sourcingType && (
                              <span className={cn(
                                "inline-block w-fit text-[9px] px-1.5 py-0.5 rounded-md border font-medium",
                                item.sourcingType === "oem"
                                  ? "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/40 dark:text-purple-400 dark:border-purple-800"
                                  : "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800",
                              )}>
                                {item.sourcingType === "oem" ? "OEM" : "Trading"}
                              </span>
                            )}
                            {showSourcing && item.sourcingType === "oem" && (
                              item.privateLabelCode?.trim() && item.privateLabelCode !== item.productCode ? (
                                <div className="flex flex-col gap-0.5">
                                  <span className="font-mono text-[9px] text-muted-foreground">Emboss: {item.privateLabelCode}</span>
                                  {item.privateLabelSource === "catalog" ? (
                                    <span className="inline-flex items-center gap-1 w-fit text-[9px] px-1.5 py-0.5 rounded-md bg-blue-50 text-blue-600 border border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800">
                                      <DatabaseIcon className="w-2.5 h-2.5 shrink-0" />from catalogue
                                    </span>
                                  ) : item.privateLabelSource === "auto" ? (
                                    <span className="inline-flex items-center gap-1 w-fit text-[9px] px-1.5 py-0.5 rounded-md bg-blue-50 text-blue-600 border border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800">
                                      <LinkIcon className="w-2.5 h-2.5 shrink-0" />from Code
                                    </span>
                                  ) : item.privateLabelSource === "user" && (
                                    <span className="inline-flex items-center gap-1 w-fit text-[9px] px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800">
                                      <PencilIcon className="w-2.5 h-2.5 shrink-0" />{item.oemEditedBy ? `${item.oemEditedBy} edited SPO` : "edited SPO"}
                                    </span>
                                  )}
                                </div>
                              ) : !item.privateLabelCode?.trim() ? (
                                <span className="text-[9px] text-destructive">emboss code missing</span>
                              ) : null
                            )}
                          </div>
                        </td>
                        <td className="py-2.5 pr-3">
                          {(item.setGroupLabel || item.customerPoNo || item.customerOrganization || item.customerName) && (
                            <div className="flex flex-wrap gap-1 mb-1">
                              {item.setGroupLabel && (
                                <span className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-md bg-teal-50 dark:bg-teal-900/20 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-800">
                                  <TagIcon className="w-2.5 h-2.5 shrink-0" />{item.setGroupLabel}
                                </span>
                              )}
                              {item.customerPoNo && (
                                <span className="inline-flex items-center text-[9px] font-mono font-medium px-1.5 py-0.5 rounded-md border bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800">
                                  {item.customerPoNo}
                                </span>
                              )}
                              {item.customerOrganization && (
                                <span className="inline-flex items-center text-[9px] px-1.5 py-0.5 rounded-md bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-300 border border-violet-200 dark:border-violet-800">
                                  {item.customerOrganization}
                                </span>
                              )}
                              {item.customerName && (
                                <span className="inline-flex items-center text-[9px] px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground border border-border/60">
                                  {item.customerName}
                                </span>
                              )}
                            </div>
                          )}
                          <div>{item.description || "—"}</div>
                          {item.descriptionSource === "product" && (
                            <span className="flex items-center gap-1 w-fit mt-0.5 text-[9px] px-1.5 py-0.5 rounded-md bg-blue-50 text-blue-600 border border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800">
                              <DatabaseIcon className="w-2.5 h-2.5 shrink-0" />from catalogue
                            </span>
                          )}
                          {item.descriptionSource === "pr" && (
                            <span className="flex items-center gap-1 w-fit mt-0.5 text-[9px] px-1.5 py-0.5 rounded-md bg-green-50 text-green-700 border border-green-200 dark:bg-green-950/40 dark:text-green-400 dark:border-green-800">
                              <ClipboardListIcon className="w-2.5 h-2.5 shrink-0" />from purchase requisition
                            </span>
                          )}
                          {item.isAdditional && (
                            <span className="flex items-center gap-1 w-fit mt-0.5 text-[9px] px-1.5 py-0.5 rounded-md bg-purple-50 text-purple-700 border border-purple-200 dark:bg-purple-950/40 dark:text-purple-400 dark:border-purple-800">
                              <PlusIcon className="w-2.5 h-2.5 shrink-0" />additional row
                            </span>
                          )}
                          {item.editedBy && (
                            <span className="flex items-center gap-1 w-fit mt-0.5 text-[9px] px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800">
                              <PencilIcon className="w-2.5 h-2.5 shrink-0" />{item.editedBy} edited SPO
                            </span>
                          )}

                          <div className="mt-1.5 flex items-center gap-1.5 text-[9px] text-muted-foreground min-h-3.5">
                            {row.saving ? (
                              <span className="flex items-center gap-1 text-blue-600 dark:text-blue-400">
                                <LoaderIcon className="w-2.5 h-2.5 shrink-0 animate-spin" />saving…
                              </span>
                            ) : row.dirty ? (
                              <span className="text-amber-600 dark:text-amber-400">unsaved…</span>
                            ) : row.inspectedByName ? (
                              <span className="flex items-center gap-1">
                                <UserIcon className="w-2.5 h-2.5 shrink-0" />
                                {row.inspectedByName}
                                {row.inspectedAt && ` · ${new Date(row.inspectedAt).toLocaleTimeString("en-MY", { hour: "2-digit", minute: "2-digit" })}`}
                              </span>
                            ) : null}
                          </div>

                          {ret > 0 && (
                            <div className="mt-1.5 flex flex-col gap-1.5 border border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-950/20 rounded-md p-2">
                              <div className="flex items-center gap-1 text-[10px] text-red-700 dark:text-red-400 font-medium">
                                <AlertTriangleIcon className="w-3 h-3 shrink-0" /> {ret} {item.uom || ""} return to supplier
                              </div>
                              <Input
                                value={row.returnNotes}
                                onFocus={() => handleFocusRow(item.id)}
                                onChange={(e) => updateRow(item.id, { returnNotes: e.target.value })}
                                onBlur={() => handleBlurRow(item.id)}
                                placeholder="Notes (optional)"
                                className="h-7 text-[11px]"
                              />
                              <InspectionPhotoStrip
                                photos={row.photos.filter((p) => p.category === "return")}
                                uploading={row.uploadingReturnPhotos}
                                onUpload={(files) => handlePhotoUpload(item.id, "return", files)}
                                onDelete={(photoId) => handlePhotoDelete(item.id, photoId)}
                              />
                            </div>
                          )}
                          {repair > 0 && (
                            <div className="mt-1.5 flex flex-col gap-1.5 border border-orange-200 dark:border-orange-800 bg-orange-50/50 dark:bg-orange-950/20 rounded-md p-2">
                              <div className="flex items-center gap-1 text-[10px] text-orange-700 dark:text-orange-400 font-medium">
                                <AlertTriangleIcon className="w-3 h-3 shrink-0" /> {repair} {item.uom || ""} in-house repair
                              </div>
                              <Input
                                value={row.repairNotes}
                                onFocus={() => handleFocusRow(item.id)}
                                onChange={(e) => updateRow(item.id, { repairNotes: e.target.value })}
                                onBlur={() => handleBlurRow(item.id)}
                                placeholder="Notes (optional)"
                                className="h-7 text-[11px]"
                              />
                              <InspectionPhotoStrip
                                photos={row.photos.filter((p) => p.category === "repair")}
                                uploading={row.uploadingRepairPhotos}
                                onUpload={(files) => handlePhotoUpload(item.id, "repair", files)}
                                onDelete={(photoId) => handlePhotoDelete(item.id, photoId)}
                              />
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 pr-3">
                          <ItemImageThumb imageUrl={item.imageUrl} productCode={item.productCode} />
                        </td>
                        <td className="py-2.5 pr-3 text-right tabular-nums text-muted-foreground">{item.qtyExpected}</td>
                        <td className="py-2.5 pr-3">
                          <Input
                            type="number" min="0" step="any"
                            value={row.qtyReceived}
                            onFocus={() => handleFocusRow(item.id)}
                            onChange={(e) => updateRow(item.id, { qtyReceived: e.target.value })}
                            onBlur={() => handleBlurRow(item.id)}
                            className="h-7 text-xs text-right tabular-nums w-24 ml-auto"
                          />
                        </td>
                        <td className="py-2.5 pr-3">
                          <Input
                            type="number" min="0" step="any"
                            value={row.qtyReturn}
                            onFocus={() => handleFocusRow(item.id)}
                            onChange={(e) => updateRow(item.id, { qtyReturn: e.target.value })}
                            onBlur={() => handleBlurRow(item.id)}
                            className={cn("h-7 text-xs text-right tabular-nums w-24 ml-auto", overCommitted && "border-destructive focus-visible:ring-destructive")}
                          />
                        </td>
                        <td className="py-2.5 pr-3">
                          <Input
                            type="number" min="0" step="any"
                            value={row.qtyRepair}
                            onFocus={() => handleFocusRow(item.id)}
                            onChange={(e) => updateRow(item.id, { qtyRepair: e.target.value })}
                            onBlur={() => handleBlurRow(item.id)}
                            className={cn("h-7 text-xs text-right tabular-nums w-24 ml-auto", overCommitted && "border-destructive focus-visible:ring-destructive")}
                          />
                        </td>
                        <td className="py-2.5 pr-3 text-right tabular-nums font-medium text-green-600 dark:text-green-400">
                          <span className="inline-flex items-center gap-1">
                            {accepted > 0 && <CheckIcon className="w-3 h-3 shrink-0" />}
                            {accepted}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
          );
        })}

        <div className="flex gap-3">
          <Button type="submit" disabled={completing} className="gap-1.5">
            <ClipboardCheckIcon className="w-3.5 h-3.5" />
            {completing ? "Saving…" : "Complete Inspection"}
          </Button>
          <Button type="button" variant="outline" onClick={() => router.push(backUrl)}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
