"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/page-header";
import {
  UploadIcon, ImageIcon, XIcon, InfoIcon, CheckCircleIcon,
  AlertCircleIcon, RefreshCwIcon, CheckIcon, Loader2Icon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getProductImageUploadUrls, checkProductCodesExist, markProductImagesUploaded } from "@/server/products";

const MAX_FILES = 50;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const REQUIRED_WIDTH  = 726;
const REQUIRED_HEIGHT = 451;
const MAX_SIZE_BYTES  = 100 * 1024; // 100 KB

function checkImageDimensions(file: File): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload  = () => { URL.revokeObjectURL(url); resolve({ w: img.naturalWidth, h: img.naturalHeight }); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not read image")); };
    img.src = url;
  });
}

type UploadState = "idle" | "uploading" | "done" | "error";

type ImageEntry = {
  id: string;
  file: File;
  previewUrl: string;
  productCode: string;
  uploadState: UploadState;
  errorMsg?: string;
};

function codeFromFilename(name: string) {
  return name.replace(/\.[^/.]+$/, "").trim();
}

function UploadStateIcon({ state }: { state: UploadState }) {
  if (state === "uploading") return <Loader2Icon className="w-3.5 h-3.5 animate-spin text-blue-500" />;
  if (state === "done")      return <CheckIcon className="w-3.5 h-3.5 text-green-500" />;
  if (state === "error")     return <AlertCircleIcon className="w-3.5 h-3.5 text-red-500" />;
  return null;
}

export function UploadImagesClient() {
  const [entries, setEntries]   = useState<ImageEntry[]>([]);
  const [uploading, setUploading] = useState(false);
  const [drag, setDrag]         = useState(false);
  const [existMap, setExistMap] = useState<Record<string, boolean>>({});
  const inputRef                = useRef<HTMLInputElement>(null);
  const checkTimerRef           = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup blob URLs when entries change
  useEffect(() => {
    return () => entries.forEach((e) => URL.revokeObjectURL(e.previewUrl));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced DB check whenever entries change
  useEffect(() => {
    if (!entries.length) { setExistMap({}); return; }
    if (checkTimerRef.current) clearTimeout(checkTimerRef.current);
    checkTimerRef.current = setTimeout(async () => {
      const codes = [...new Set(entries.map((e) => e.productCode).filter(Boolean))];
      if (!codes.length) return;
      try {
        const map = await checkProductCodesExist(codes);
        setExistMap(map);
      } catch { /* silent */ }
    }, 600);
  }, [entries]);

  async function addFiles(files: File[]) {
    const allowed = files.filter((f) => ALLOWED_TYPES.includes(f.type));
    if (allowed.length < files.length)
      toast.warning(`${files.length - allowed.length} non-image file${files.length - allowed.length !== 1 ? "s" : ""} skipped`);

    const remaining = MAX_FILES - entries.length;
    if (remaining <= 0) { toast.error(`Maximum ${MAX_FILES} images per upload`); return; }
    const candidates = allowed.slice(0, remaining);
    if (candidates.length < allowed.length)
      toast.warning(`Only ${remaining} slot${remaining !== 1 ? "s" : ""} remaining — ${allowed.length - candidates.length} file${allowed.length - candidates.length !== 1 ? "s" : ""} not added`);

    const valid: File[] = [];
    for (const file of candidates) {
      if (file.size > MAX_SIZE_BYTES) {
        toast.error(`${file.name}: ${(file.size / 1024).toFixed(0)} KB — must be under 100 KB`);
        continue;
      }
      try {
        const { w, h } = await checkImageDimensions(file);
        if (w !== REQUIRED_WIDTH || h !== REQUIRED_HEIGHT) {
          toast.error(`${file.name}: ${w}×${h}px — must be exactly ${REQUIRED_WIDTH}×${REQUIRED_HEIGHT}px`);
          continue;
        }
      } catch {
        toast.error(`${file.name}: could not read image dimensions`);
        continue;
      }
      valid.push(file);
    }

    if (!valid.length) return;
    const newEntries: ImageEntry[] = valid.map((file) => ({
      id: `${Date.now()}-${Math.random()}`,
      file,
      previewUrl: URL.createObjectURL(file),
      productCode: codeFromFilename(file.name),
      uploadState: "idle",
    }));
    setEntries((prev) => [...prev, ...newEntries]);
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length) addFiles(files);
    e.target.value = "";
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDrag(false);
    addFiles(Array.from(e.dataTransfer.files));
  }

  function removeEntry(id: string) {
    setEntries((prev) => {
      const entry = prev.find((e) => e.id === id);
      if (entry) URL.revokeObjectURL(entry.previewUrl);
      return prev.filter((e) => e.id !== id);
    });
  }

  function updateCode(id: string, code: string) {
    setEntries((prev) => prev.map((e) => e.id === id ? { ...e, productCode: code.trim() } : e));
  }

  const handleUpload = useCallback(async () => {
    const toUpload = entries.filter((e) => e.uploadState === "idle" && e.productCode);
    if (!toUpload.length) { toast.error("No images ready to upload"); return; }

    setUploading(true);
    // Mark all as uploading
    setEntries((prev) => prev.map((e) => toUpload.some((t) => t.id === e.id) ? { ...e, uploadState: "uploading" } : e));

    try {
      const urlMap = await getProductImageUploadUrls(
        toUpload.map((e) => ({ productCode: e.productCode, contentType: e.file.type || "image/jpeg" })),
      );
      const urlByCode = Object.fromEntries(urlMap.map((u) => [u.productCode, u.uploadUrl]));

      const uploadedCodes: string[] = [];

      await Promise.allSettled(
        toUpload.map(async (entry) => {
          const uploadUrl = urlByCode[entry.productCode];
          if (!uploadUrl) {
            setEntries((prev) => prev.map((e) => e.id === entry.id ? { ...e, uploadState: "error", errorMsg: "No upload URL" } : e));
            return;
          }
          try {
            const res = await fetch(uploadUrl, {
              method: "PUT",
              body: entry.file,
              headers: { "Content-Type": entry.file.type || "image/jpeg" },
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            setEntries((prev) => prev.map((e) => e.id === entry.id ? { ...e, uploadState: "done" } : e));
            uploadedCodes.push(entry.productCode);
          } catch (err: any) {
            setEntries((prev) => prev.map((e) => e.id === entry.id ? { ...e, uploadState: "error", errorMsg: err.message } : e));
          }
        }),
      );

      // Stamp imageUploadedAt on successfully uploaded products so URLs get cache-busted
      if (uploadedCodes.length) markProductImagesUploaded(uploadedCodes).catch(() => {});
      toast.success(`Upload complete`);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setUploading(false);
    }
  }, [entries]);

  const idleCount    = entries.filter((e) => e.uploadState === "idle").length;
  const doneCount    = entries.filter((e) => e.uploadState === "done").length;
  const errorCount   = entries.filter((e) => e.uploadState === "error").length;
  const missingCode  = entries.filter((e) => !e.productCode).length;

  return (
    <div className="p-6">
      <PageHeader
        title="Upload Product Images"
        description={`Upload up to ${MAX_FILES} product images at once. Images are named by product code (e.g. ABC123.jpg).`}
      />

      {/* Drop zone */}
      <div
        onClick={() => !uploading && inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={handleDrop}
        className={cn(
          "border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center gap-3 mb-5 transition-all text-center",
          uploading ? "cursor-default opacity-60" : "cursor-pointer",
          drag ? "border-primary bg-primary/5" : "border-border hover:border-primary/40 hover:bg-muted/20",
        )}
      >
        <input ref={inputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleInputChange} />
        <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
          <ImageIcon className="w-5 h-5 text-muted-foreground" />
        </div>
        <div>
          <div className="text-sm font-medium">Click or drag & drop images</div>
          <div className="text-xs text-muted-foreground mt-1">JPEG · PNG · WebP · GIF · up to {MAX_FILES} files</div>
        </div>
        <div className="text-xs text-muted-foreground/70 space-y-0.5">
          <div>{REQUIRED_WIDTH}×{REQUIRED_HEIGHT}px · max 100 KB per image</div>
          <div>Filename becomes the product code — e.g. <span className="font-mono">BMS-001.jpg</span> → code <span className="font-mono">BMS-001</span></div>
        </div>
        {entries.length > 0 && (
          <div className="text-xs text-muted-foreground">{entries.length} / {MAX_FILES} images added</div>
        )}
      </div>

      {/* Stats bar */}
      {entries.length > 0 && (
        <div className="flex items-center gap-3 flex-wrap mb-4 text-xs">
          <span className="text-muted-foreground">{entries.length} image{entries.length !== 1 ? "s" : ""}</span>
          {doneCount > 0  && <span className="text-green-600 dark:text-green-400 font-medium">{doneCount} uploaded</span>}
          {errorCount > 0 && <span className="text-red-600 dark:text-red-400 font-medium">{errorCount} failed</span>}
          {missingCode > 0 && <span className="text-amber-600 dark:text-amber-400 font-medium">{missingCode} missing product code</span>}
          <div className="ml-auto flex gap-2">
            {entries.some((e) => e.uploadState === "error") && (
              <Button variant="outline" size="sm" className="gap-1.5 h-7 text-xs"
                onClick={() => setEntries((prev) => prev.map((e) => e.uploadState === "error" ? { ...e, uploadState: "idle", errorMsg: undefined } : e))}>
                <RefreshCwIcon className="w-3 h-3" /> Retry failed
              </Button>
            )}
            <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground"
              onClick={() => { entries.forEach((e) => URL.revokeObjectURL(e.previewUrl)); setEntries([]); setExistMap({}); }}>
              Clear all
            </Button>
          </div>
        </div>
      )}

      {/* Image grid */}
      {entries.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-3 mb-5">
          {entries.map((entry) => {
            const exists = entry.productCode ? existMap[entry.productCode] : undefined;
            return (
              <div key={entry.id} className={cn(
                "relative group rounded-xl border bg-background overflow-hidden flex flex-col",
                entry.uploadState === "done"  && "border-green-300 dark:border-green-700",
                entry.uploadState === "error" && "border-red-300 dark:border-red-700",
                entry.uploadState === "idle"  && "border-border",
              )}>
                {/* Thumbnail */}
                <div className="relative aspect-square bg-muted/30 overflow-hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={entry.previewUrl} alt={entry.productCode} className="w-full h-full object-cover" />

                  {/* Upload state overlay */}
                  {entry.uploadState !== "idle" && (
                    <div className={cn(
                      "absolute inset-0 flex items-center justify-center",
                      entry.uploadState === "uploading" && "bg-black/20",
                      entry.uploadState === "done"      && "bg-green-500/20",
                      entry.uploadState === "error"     && "bg-red-500/20",
                    )}>
                      <UploadStateIcon state={entry.uploadState} />
                    </div>
                  )}

                  {/* Remove button */}
                  {entry.uploadState !== "uploading" && (
                    <button
                      onClick={() => removeEntry(entry.id)}
                      className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/50 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <XIcon className="w-2.5 h-2.5" />
                    </button>
                  )}
                </div>

                {/* Product code input */}
                <div className="p-1.5 space-y-1">
                  <Input
                    value={entry.productCode}
                    onChange={(e) => updateCode(entry.id, e.target.value)}
                    placeholder="Product code"
                    disabled={entry.uploadState === "uploading" || entry.uploadState === "done"}
                    className="h-6 text-[10px] font-mono px-1.5 py-0"
                  />
                  <div className="flex items-center gap-1">
                    {!entry.productCode ? (
                      <span className="text-[9px] text-amber-500">Missing code</span>
                    ) : exists === true ? (
                      <span className="text-[9px] text-green-600 dark:text-green-400 flex items-center gap-0.5">
                        <CheckCircleIcon className="w-2.5 h-2.5" /> Found
                      </span>
                    ) : exists === false ? (
                      <span className="text-[9px] text-amber-500 flex items-center gap-0.5">
                        <AlertCircleIcon className="w-2.5 h-2.5" /> New product
                      </span>
                    ) : null}
                    {entry.uploadState === "error" && (
                      <span className="text-[9px] text-red-500 ml-auto truncate">{entry.errorMsg}</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Action bar */}
      {entries.length > 0 && (
        <div className="flex items-center justify-between p-4 bg-background border border-border rounded-xl sticky bottom-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <InfoIcon className="w-3.5 h-3.5 shrink-0" />
            {idleCount > 0
              ? `${idleCount} image${idleCount !== 1 ? "s" : ""} ready to upload${missingCode > 0 ? ` (${missingCode} missing product code — will be skipped)` : ""}`
              : doneCount > 0 ? `All images uploaded successfully` : "No images pending upload"}
          </div>
          <Button
            size="sm"
            onClick={handleUpload}
            disabled={uploading || idleCount === 0}
            className="gap-2 min-w-44"
          >
            {uploading ? (
              <><Loader2Icon className="w-3.5 h-3.5 animate-spin" /> Uploading…</>
            ) : (
              <><UploadIcon className="w-3.5 h-3.5" /> Upload {idleCount} Image{idleCount !== 1 ? "s" : ""}</>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
