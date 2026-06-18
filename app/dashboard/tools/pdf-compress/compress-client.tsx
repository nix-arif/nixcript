"use client";

import { useState, useRef } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  UploadIcon, FileIcon, DownloadIcon, XIcon, ZapIcon, ArrowRightIcon, AlertTriangleIcon,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────

type CompressMode = "smart" | "rasterize";

interface Result {
  blob:              Blob;
  originalSize:      number;
  compressedSize:    number;
  mode:              CompressMode;
  imagesCompressed?: number;
  imagesFound?:      number;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtSize(bytes: number): string {
  if (bytes < 1024)           return `${bytes} B`;
  if (bytes < 1024 * 1024)    return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function rasterizeLabel(ratio: number): string {
  if (ratio < 0.06) return "Extreme — text will not be readable";
  if (ratio < 0.15) return "High — text heavily degraded";
  if (ratio < 0.30) return "Medium — small text may be hard to read";
  if (ratio < 0.50) return "Readable — all text legible, some quality loss";
  if (ratio < 0.70) return "Good — clear text, minor compression visible";
  return "Light — near-original quality";
}

function smartLabel(q: number): string {
  if (q <= 50) return "Aggressive — visible JPEG artifacts";
  if (q <= 65) return "Balanced — good quality (recommended)";
  if (q <= 75) return "Light — minimal quality loss";
  return "Very light — near-original image quality";
}

function compressionParams(ratio: number): { quality: number; scale: number } {
  if (ratio < 0.03) return { quality: 5,  scale: 0.50 };
  if (ratio < 0.06) return { quality: 8,  scale: 0.60 };
  if (ratio < 0.10) return { quality: 12, scale: 0.70 };
  if (ratio < 0.15) return { quality: 18, scale: 0.85 };
  if (ratio < 0.20) return { quality: 28, scale: 1.00 };
  if (ratio < 0.30) return { quality: 38, scale: 1.10 };
  if (ratio < 0.50) return { quality: 60, scale: 1.50 };
  if (ratio < 0.70) return { quality: 72, scale: 1.75 };
  return { quality: 82, scale: 2.00 };
}

// ── PNG-wrapper helper ──────────────────────────────────────────────────────
// A PDF FlateDecode stream with PNG predictor (Predictor 10-15) is identical
// to the raw IDAT data of a PNG file — zlib(filter_byte + pixel_bytes per row).
// Wrapping it in a PNG file header lets the browser decode it natively without
// any manual zlib or predictor implementation.

function crc32(data: Uint8Array): number {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    c ^= data[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (c & 1 ? 0xEDB88320 : 0);
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const v   = new DataView(out.buffer);
  v.setUint32(0, data.length, false);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  v.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)), false);
  return out;
}

function buildPNGBlob(idat: Uint8Array, w: number, h: number, colorType: number): Blob {
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const hdr = new Uint8Array(13);
  new DataView(hdr.buffer).setUint32(0, w, false);
  new DataView(hdr.buffer).setUint32(4, h, false);
  hdr[8] = 8; hdr[9] = colorType; // bit-depth=8, colorType: 0=gray 2=rgb
  const parts = [sig, pngChunk("IHDR", hdr), pngChunk("IDAT", idat), pngChunk("IEND", new Uint8Array(0))];
  const buf = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) { buf.set(p, off); off += p.length; }
  return new Blob([buf], { type: "image/png" });
}

// ── Smart compress core ──────────────────────────────────────────────────────

async function runSmartCompress(
  file: File,
  quality: number,
  onProgress: (label: string, pct: number) => void,
): Promise<{ bytes: Uint8Array; imagesCompressed: number; imagesFound: number }> {
  const {
    PDFDocument, PDFName, PDFRawStream, PDFDict, PDFNumber, PDFArray,
  } = await import("pdf-lib");

  onProgress("Loading PDF…", 2);
  const originalBuf = await file.arrayBuffer();
  const pdfDoc = await PDFDocument.load(originalBuf, {
    ignoreEncryption: true, updateMetadata: false,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ctx             = (pdfDoc as any).context as any;
  const indirectObjects = ctx.indirectObjects as Map<unknown, unknown>;

  // ── Collect compressible image XObjects ──────────────────────────────────
  type Entry = {
    ref:       unknown;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    obj:       any;
    w:         number;
    h:         number;
    filter:    "DCT" | "JPX" | "Flate";
    channels:  number; // 1=gray, 3=RGB
    predictor: number; // 1=none, 2=TIFF-horiz, 10-15=PNG adaptive
  };
  const images: Entry[] = [];

  for (const [ref, obj] of indirectObjects) {
    if (!(obj instanceof PDFRawStream)) continue;
    try {
      const dict = obj.dict;
      // Use ctx.lookup() to dereference indirect refs — dict.get() returns a
      // PDFRef as-is when the value is stored as an indirect object, and
      // PDFRef.toString() gives "15 0 R" not "/Image", breaking every check.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const lu = (v: unknown) => ctx.lookup(v) as any;
      if (lu(dict.get(PDFName.of("Subtype")))?.toString() !== "/Image") continue;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const w   = (lu(dict.get(PDFName.of("Width")))            as any)?.value ?? 0;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const h   = (lu(dict.get(PDFName.of("Height")))           as any)?.value ?? 0;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bpc = (lu(dict.get(PDFName.of("BitsPerComponent"))) as any)?.value ?? 8;
      if (w * h < 5000 || bpc !== 8) continue;

      const csStr     = lu(dict.get(PDFName.of("ColorSpace")))?.toString() ?? "";
      const filterStr = lu(dict.get(PDFName.of("Filter")))?.toString()     ?? "";

      // Skip CMYK in all cases — color conversion would visibly shift colors
      if (csStr.includes("CMYK")) continue;

      const isDCT   = filterStr.includes("DCTDecode");
      const isJPX   = filterStr.includes("JPXDecode");
      const isFlate = filterStr.includes("FlateDecode") && !isDCT && !isJPX;
      if (!isDCT && !isJPX && !isFlate) continue;

      // ── Determine channel count ──────────────────────────────────────────
      // For FlateDecode with PNG predictor, DecodeParms.Colors is the most
      // reliable source — it works even when ColorSpace is ICCBased, a named
      // resource (/CS0), or an array ([/ICCBased ref]).  Checking only the
      // ColorSpace name string silently skips the majority of real-world PDFs
      // from Word, Pages, LibreOffice, and Illustrator.
      let channels = 0;
      let predictor = 1;

      if (isFlate) {
        const dp = dict.get(PDFName.of("DecodeParms"));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const dpDict: any = dp instanceof PDFArray ? (dp as any).get(0) : dp;
        if (dpDict instanceof PDFDict) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          predictor = (dpDict.get(PDFName.of("Predictor")) as any)?.value ?? 1;
          // Colors is mandatory in DecodeParms when Predictor >= 10
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          channels  = (dpDict.get(PDFName.of("Colors"))    as any)?.value ?? 0;
        }
      }

      // Fall back to ColorSpace string when DecodeParms.Colors is absent
      if (channels === 0) {
        if (csStr.includes("Gray") || csStr === "/DeviceGray") channels = 1;
        else if (csStr.includes("RGB") || csStr === "/DeviceRGB") channels = 3;
        // ICCBased: peek at the N entry — [ /ICCBased <streamRef> ]
        else if (csStr.includes("ICCBased")) {
          // N=1→gray, N=3→RGB; treat N=3 as RGB and N=1 as gray, skip others
          channels = csStr.includes("3") ? 3 : csStr.includes("1") ? 1 : 0;
        }
        // For DCT/JPX the browser Image element handles multi-channel natively
        if (channels === 0 && (isDCT || isJPX)) channels = 3; // assume RGB
      }

      if (channels !== 1 && channels !== 3) continue;

      const filter: "DCT" | "JPX" | "Flate" = isDCT ? "DCT" : isJPX ? "JPX" : "Flate";
      images.push({ ref, obj, w, h, filter, channels, predictor });
    } catch { /* skip malformed entries */ }
  }

  onProgress(`Found ${images.length} image${images.length !== 1 ? "s" : ""}…`, 8);

  let compressedCount = 0, processed = 0;

  for (const { ref, obj, w, h, filter, channels, predictor } of images) {
    try {
      const canvas  = document.createElement("canvas");
      canvas.width  = w;
      canvas.height = h;
      const ctx2d   = canvas.getContext("2d")!;
      let   painted = false;

      if (filter === "DCT") {
        // ── JPEG: browser handles DeviceRGB, DeviceGray, YCbCr, ICCBased ──────
        const blob = new Blob([new Uint8Array(obj.contents)], { type: "image/jpeg" });
        const url  = URL.createObjectURL(blob);
        await new Promise<void>(resolve => {
          const img   = new Image();
          img.onload  = () => { ctx2d.drawImage(img, 0, 0); URL.revokeObjectURL(url); painted = true; resolve(); };
          img.onerror = () => { URL.revokeObjectURL(url); resolve(); };
          img.src = url;
        });

      } else if (filter === "JPX") {
        // ── JPEG 2000: native on Safari; silently skipped on Chrome/Firefox ───
        const blob = new Blob([new Uint8Array(obj.contents)], { type: "image/jp2" });
        const url  = URL.createObjectURL(blob);
        await new Promise<void>(resolve => {
          const img   = new Image();
          img.onload  = () => { ctx2d.drawImage(img, 0, 0); URL.revokeObjectURL(url); painted = true; resolve(); };
          img.onerror = () => { URL.revokeObjectURL(url); resolve(); };
          img.src = url;
        });

      } else if (predictor >= 10) {
        // ── FlateDecode + PNG predictor: stream IS valid PNG IDAT content ─────
        // FlateDecode payload = zlib(filter_byte + pixel_bytes per row) which is
        // exactly what a PNG IDAT chunk contains.  Wrap in PNG file structure and
        // let the browser decode it — no manual zlib or predictor code needed.
        const blob = buildPNGBlob(new Uint8Array(obj.contents), w, h, channels === 1 ? 0 : 2);
        const url  = URL.createObjectURL(blob);
        await new Promise<void>(resolve => {
          const img   = new Image();
          img.onload  = () => { ctx2d.drawImage(img, 0, 0); URL.revokeObjectURL(url); painted = true; resolve(); };
          img.onerror = () => { URL.revokeObjectURL(url); resolve(); };
          img.src = url;
        });

      } else {
        // ── FlateDecode, Predictor 1 (none) or 2 (TIFF horiz-diff) ───────────
        try {
          const ds     = new DecompressionStream("deflate");
          const writer = ds.writable.getWriter();
          const reader = ds.readable.getReader();
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (writer.write as any)(new Uint8Array(obj.contents));
          await writer.close();
          const chunks: Uint8Array[] = [];
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value as Uint8Array);
          }
          const total = chunks.reduce((n, c) => n + c.length, 0);
          const raw   = new Uint8Array(total);
          let   off   = 0;
          for (const c of chunks) { raw.set(c, off); off += c.length; }

          // Undo TIFF horizontal differencing: each sample = cumulative sum across row
          if (predictor === 2) {
            const stride = w * channels;
            for (let row = 0; row < h; row++) {
              const base = row * stride;
              for (let col = channels; col < stride; col++) {
                raw[base + col] = (raw[base + col] + raw[base + col - channels]) & 0xFF;
              }
            }
          }

          const rgba = new Uint8ClampedArray(w * h * 4);
          if (channels === 1) {
            for (let i = 0, j = 0; i < raw.length && j < rgba.length; i++, j += 4) {
              rgba[j] = rgba[j + 1] = rgba[j + 2] = raw[i]; rgba[j + 3] = 255;
            }
          } else {
            for (let i = 0, j = 0; i < raw.length && j < rgba.length; i += 3, j += 4) {
              rgba[j] = raw[i]; rgba[j + 1] = raw[i + 1]; rgba[j + 2] = raw[i + 2]; rgba[j + 3] = 255;
            }
          }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ctx2d.putImageData(new (ImageData as any)(rgba, w, h) as ImageData, 0, 0);
          painted = true;
        } catch { /* decompress failed — skip */ }
      }

      if (!painted) { processed++; continue; }

      const dataUrl  = canvas.toDataURL("image/jpeg", quality / 100);
      const newBytes = Uint8Array.from(atob(dataUrl.split(",")[1]), c => c.charCodeAt(0));

      // Only replace if the JPEG is actually smaller than the current encoded stream
      if (newBytes.length >= obj.contents.length) { processed++; continue; }

      // Preserve ALL original dict entries (keeps SMask, Mask, Interpolate…),
      // then override only encoding-specific keys
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const m: Map<any, any> = new Map(obj.dict.entries());
      m.set(PDFName.of("Filter"),           PDFName.of("DCTDecode"));
      m.set(PDFName.of("ColorSpace"),       PDFName.of("DeviceRGB")); // canvas always outputs RGB
      m.set(PDFName.of("BitsPerComponent"), PDFNumber.of(8));
      m.set(PDFName.of("Length"),           PDFNumber.of(newBytes.length));
      m.delete(PDFName.of("DecodeParms"));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ctx.assign(ref, PDFRawStream.of(PDFDict.fromMapWithContext(m as any, ctx), newBytes));
      compressedCount++;
    } catch { /* skip */ }

    processed++;
    onProgress(
      `Compressing image ${processed} of ${images.length}…`,
      10 + Math.round((processed / images.length) * 80),
    );
  }

  if (images.length === 0) onProgress("Applying structure compression…", 80);
  onProgress("Rebuilding PDF…", 93);

  const outBytes = await pdfDoc.save({ useObjectStreams: true });
  const bytes = outBytes.length < originalBuf.byteLength
    ? outBytes
    : new Uint8Array(originalBuf);
  return { bytes, imagesCompressed: compressedCount, imagesFound: images.length };
}

// ── Component ──────────────────────────────────────────────────────────────

export function PdfCompressClient() {
  const [file, setFile]                   = useState<File | null>(null);
  const [mode, setMode]                   = useState<CompressMode>("smart");
  const [imageQuality, setImageQuality]   = useState(65);
  const [targetKb, setTargetKb]           = useState(200);
  const [compressing, setCompressing]     = useState(false);
  const [progress, setProgress]           = useState(0);
  const [progressLabel, setProgressLabel] = useState("");
  const [result, setResult]               = useState<Result | null>(null);
  const [dragging, setDragging]           = useState(false);

  const inputRef      = useRef<HTMLInputElement>(null);
  const busyRef       = useRef(false); // prevent concurrent runs
  // Latest slider values — read in onPointerUp to bypass React batching
  const qualityRef    = useRef(65);
  const targetKbRef   = useRef(200);

  // ── Derived rasterize values ─────────────────────────────────────────────
  const originalKb      = file ? Math.ceil(file.size / 1024) : 0;
  const minKb           = file ? Math.max(30, Math.ceil(file.size * 0.01 / 1024)) : 30;
  const maxKb           = originalKb || 5000;
  const sliderStep      = Math.max(1, Math.ceil(maxKb / 300));
  const ratio           = file ? (targetKb * 1024) / file.size : 0.2;
  const recommendedKb   = file ? Math.max(300, Math.ceil(file.size * 0.45 / 1024)) : 300;
  const recPct          = file
    ? Math.min(100, Math.max(0, ((recommendedKb - minKb) / (maxKb - minKb)) * 100))
    : 0;
  const isAtRecommended = Math.abs(targetKb - recommendedKb) <= sliderStep;

  // ── Core compress dispatcher ─────────────────────────────────────────────
  async function doCompress(
    f:            File,
    currentMode:  CompressMode,
    currentQuality: number,
    currentRatio: number,
  ) {
    if (busyRef.current) return;
    busyRef.current = true;
    setCompressing(true);
    setResult(null);
    setProgress(0);

    try {
      if (currentMode === "smart") {
        const { bytes, imagesCompressed, imagesFound } = await runSmartCompress(
          f,
          currentQuality,
          (label, pct) => { setProgressLabel(label); setProgress(pct); },
        );
        const blob = new Blob([bytes.buffer as ArrayBuffer], { type: "application/pdf" });
        setProgress(100);
        setProgressLabel("Done");
        setResult({ blob, originalSize: f.size, compressedSize: bytes.length, mode: "smart", imagesCompressed, imagesFound });
      } else {
        // ── Rasterize ──────────────────────────────────────────────────────
        const [{ PDFDocument }, pdfjsLib] = await Promise.all([
          import("pdf-lib"),
          import("pdfjs-dist"),
        ]);
        pdfjsLib.GlobalWorkerOptions.workerSrc =
          `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

        const { quality, scale } = compressionParams(Math.min(currentRatio, 1));

        setProgressLabel("Loading PDF…");
        setProgress(2);

        const srcPdf   = await pdfjsLib.getDocument({ data: await f.arrayBuffer() }).promise;
        const numPages = srcPdf.numPages;
        const outDoc   = await PDFDocument.create();

        for (let i = 1; i <= numPages; i++) {
          setProgressLabel(`Rendering page ${i} of ${numPages}…`);
          setProgress(Math.round(5 + ((i - 1) / numPages) * 85));

          const page     = await srcPdf.getPage(i);
          const viewport = page.getViewport({ scale });
          const canvas   = document.createElement("canvas");
          canvas.width   = Math.round(viewport.width);
          canvas.height  = Math.round(viewport.height);

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (page.render as any)({ canvasContext: canvas.getContext("2d")!, viewport }).promise;

          const dataUrl   = canvas.toDataURL("image/jpeg", quality / 100);
          const jpegBytes = Uint8Array.from(atob(dataUrl.split(",")[1]), c => c.charCodeAt(0));
          const img       = await outDoc.embedJpg(jpegBytes);
          const pOut      = outDoc.addPage([viewport.width, viewport.height]);
          pOut.drawImage(img, { x: 0, y: 0, width: viewport.width, height: viewport.height });
        }

        setProgressLabel("Building output PDF…");
        setProgress(93);

        const outBytes = await outDoc.save({ useObjectStreams: true });
        const blob     = new Blob([outBytes.buffer as ArrayBuffer], { type: "application/pdf" });
        setProgress(100);
        setProgressLabel("Done");
        setResult({ blob, originalSize: f.size, compressedSize: outBytes.length, mode: "rasterize" });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Compression failed");
    } finally {
      busyRef.current = false;
      setCompressing(false);
    }
  }

  // ── File handling ────────────────────────────────────────────────────────
  function acceptFile(f: File) {
    if (f.type !== "application/pdf") { toast.error("Please select a PDF file"); return; }
    const defaultKb = Math.max(50, Math.ceil(f.size * 0.20 / 1024));
    const initKb    = Math.min(defaultKb, Math.ceil(f.size / 1024));
    const initRatio = (initKb * 1024) / f.size;

    setFile(f);
    setResult(null);
    setProgress(0);
    setProgressLabel("");
    setTargetKb(initKb);
    targetKbRef.current = initKb;

    // Auto-compress immediately on upload
    void doCompress(f, mode, qualityRef.current, initRatio);
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) acceptFile(f);
    e.target.value = "";
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) acceptFile(f);
  }

  function clearFile(ev: React.MouseEvent) {
    ev.stopPropagation();
    setFile(null);
    setResult(null);
    setProgress(0);
    setProgressLabel("");
  }

  // ── Slider handlers ──────────────────────────────────────────────────────
  // onChange: update label immediately while dragging
  // onPointerUp: fire compress only when user releases the thumb
  function onQualityChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = Number(e.target.value);
    setImageQuality(v);
    qualityRef.current = v;
  }
  function onQualityRelease(e: React.PointerEvent<HTMLInputElement>) {
    const v = Number((e.target as HTMLInputElement).value);
    qualityRef.current = v;
    if (file && !busyRef.current) void doCompress(file, mode, v, ratio);
  }

  function onTargetKbChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = Number(e.target.value);
    setTargetKb(v);
    targetKbRef.current = v;
  }
  function onTargetKbRelease(e: React.PointerEvent<HTMLInputElement>) {
    const v    = Number((e.target as HTMLInputElement).value);
    const r    = file ? (v * 1024) / file.size : 0.2;
    targetKbRef.current = v;
    if (file && !busyRef.current) void doCompress(file, mode, qualityRef.current, r);
  }

  // ── Mode switch: re-compress immediately ─────────────────────────────────
  function switchMode(m: CompressMode) {
    setMode(m);
    setResult(null);
    if (file && !busyRef.current) {
      void doCompress(file, m, qualityRef.current, (targetKbRef.current * 1024) / file.size);
    }
  }

  // ── Download ─────────────────────────────────────────────────────────────
  function handleDownload() {
    if (!result || !file) return;
    const url = URL.createObjectURL(result.blob);
    const a   = document.createElement("a");
    a.href     = url;
    a.download = `compressed_${file.name}`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const savedPct   = result ? Math.round((1 - result.compressedSize / result.originalSize) * 100) : null;
  const targetLabel = targetKb < 1024 ? `${targetKb} KB` : `${(targetKb / 1024).toFixed(1)} MB`;

  return (
    <div className="p-6 flex flex-col gap-6 max-w-2xl">

      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <ZapIcon className="h-5 w-5 text-muted-foreground" />
          PDF Compressor
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Smart mode re-compresses embedded images, text stays selectable.
          Rasterize converts every page to JPEG for maximum compression, text becomes non-selectable.
        </p>
      </div>

      {/* Drop zone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => !file && inputRef.current?.click()}
        className={[
          "rounded-xl border-2 border-dashed flex flex-col items-center justify-center gap-3 py-10 transition-colors",
          file ? "cursor-default" : "cursor-pointer",
          dragging
            ? "border-primary bg-primary/5"
            : file
            ? "border-green-500/50 bg-green-50/40 dark:bg-green-900/10"
            : "border-border hover:border-primary/40 hover:bg-muted/30",
        ].join(" ")}
      >
        <input ref={inputRef} type="file" accept="application/pdf" className="hidden" onChange={handleInputChange} />
        {file ? (
          <>
            <FileIcon className="h-8 w-8 text-green-600 dark:text-green-400" />
            <div className="text-center">
              <p className="text-sm font-medium">{file.name}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{fmtSize(file.size)}</p>
            </div>
            <button
              type="button"
              onClick={clearFile}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive transition-colors"
            >
              <XIcon className="h-3 w-3" />Remove
            </button>
          </>
        ) : (
          <>
            <UploadIcon className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Drop a PDF here or click to browse</p>
          </>
        )}
      </div>

      {/* Controls — only shown once a file is loaded */}
      {file && (
        <div className="rounded-lg border border-border p-5 flex flex-col gap-5">

          {/* Mode tabs */}
          <div className="flex gap-1 p-1 rounded-lg bg-muted/50 border border-border">
            {(["smart", "rasterize"] as CompressMode[]).map(m => (
              <button
                key={m}
                type="button"
                disabled={compressing}
                onClick={() => switchMode(m)}
                className={[
                  "flex-1 text-xs font-medium py-1.5 rounded-md transition-colors disabled:opacity-50",
                  mode === m ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                ].join(" ")}
              >
                {m === "smart" ? "Smart Compress" : "Rasterize"}
              </button>
            ))}
          </div>

          {mode === "smart" ? (
            /* ── Smart slider ──────────────────────────────────────────── */
            <div className="flex flex-col gap-4">
              <p className="text-xs text-muted-foreground">
                Re-compresses embedded images. Text stays as vector — selectable and sharp.
                Result updates on slider release.
              </p>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Image Quality</span>
                <span className="text-lg font-bold tabular-nums">{imageQuality}%</span>
              </div>
              <input
                type="range"
                min={40} max={90} step={5}
                value={imageQuality}
                disabled={compressing}
                onChange={onQualityChange}
                onPointerUp={onQualityRelease}
                className="w-full accent-primary h-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              />
              <div className="flex justify-between text-xs text-muted-foreground select-none">
                <span>Smallest (40%)</span>
                <span>Near-original (90%)</span>
              </div>
              <div className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground text-center">
                {smartLabel(imageQuality)}
              </div>
              {imageQuality < 55 && (
                <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 dark:bg-amber-900/20 dark:border-amber-700">
                  <AlertTriangleIcon className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-700 dark:text-amber-300">
                    Low quality may cause visible artifacts. Text is unaffected.
                  </p>
                </div>
              )}
            </div>
          ) : (
            /* ── Rasterize slider ──────────────────────────────────────── */
            <div className="flex flex-col gap-4">
              <p className="text-xs text-muted-foreground">
                Renders each page to JPEG. Maximum compression, but text becomes non-selectable.
                Slide to set target size, result updates on release.
              </p>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Target File Size</span>
                <span className="text-lg font-bold tabular-nums">{targetLabel}</span>
              </div>
              <div className="relative pt-6">
                <div
                  className="absolute top-0 flex flex-col items-center pointer-events-none"
                  style={{ left: `${recPct}%`, transform: "translateX(-50%)" }}
                >
                  <span className={[
                    "text-[10px] font-semibold whitespace-nowrap px-1.5 py-0.5 rounded-full leading-none",
                    isAtRecommended ? "bg-primary text-primary-foreground" : "bg-primary/15 text-primary",
                  ].join(" ")}>Recommended</span>
                  <div className="w-px h-2 bg-primary/60 mt-0.5" />
                </div>
                <input
                  type="range"
                  min={minKb} max={maxKb} step={sliderStep}
                  value={targetKb}
                  disabled={compressing}
                  onChange={onTargetKbChange}
                  onPointerUp={onTargetKbRelease}
                  className="w-full accent-primary h-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                />
              </div>
              <div className="flex justify-between text-xs text-muted-foreground select-none">
                <span>Smallest<br />{fmtSize(minKb * 1024)}</span>
                <span className="text-center">Original<br />{fmtSize(file.size)}</span>
                <span className="text-right">Unchanged<br />{fmtSize(maxKb * 1024)}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <div className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground flex-1 text-center">
                  {rasterizeLabel(ratio)}
                </div>
                {!isAtRecommended && (
                  <button
                    type="button"
                    disabled={compressing}
                    onClick={() => {
                      setTargetKb(recommendedKb);
                      targetKbRef.current = recommendedKb;
                      if (file && !busyRef.current) {
                        void doCompress(file, mode, qualityRef.current, (recommendedKb * 1024) / file.size);
                      }
                    }}
                    className="shrink-0 text-xs font-medium text-primary hover:underline disabled:opacity-50 whitespace-nowrap"
                  >
                    Use readable minimum ({fmtSize(recommendedKb * 1024)})
                  </button>
                )}
              </div>
              {ratio < 0.50 && (
                <div className={[
                  "flex items-start gap-2 rounded-md border px-3 py-2",
                  ratio < 0.15
                    ? "border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-700"
                    : "border-amber-200 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-700",
                ].join(" ")}>
                  <AlertTriangleIcon className={[
                    "h-3.5 w-3.5 shrink-0 mt-0.5",
                    ratio < 0.15 ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400",
                  ].join(" ")} />
                  <p className={[
                    "text-xs",
                    ratio < 0.15 ? "text-red-700 dark:text-red-300" : "text-amber-700 dark:text-amber-300",
                  ].join(" ")}>
                    {ratio < 0.15
                      ? "Text will be unreadable at this size."
                      : "Text may be hard to read. Use recommended setting for readable output."}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Progress */}
      {compressing && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{progressLabel}</span>
            <span className="font-mono font-medium">{progress}%</span>
          </div>
          <Progress value={progress} />
        </div>
      )}

      {/* Result — updates every time a compression finishes */}
      {result && !compressing && (
        <div className="rounded-lg border border-green-500/40 bg-green-50/50 dark:bg-green-900/10 p-5 flex flex-col gap-4">
          <div className="grid grid-cols-3 gap-4 text-center divide-x divide-border">
            <div>
              <p className="text-xs text-muted-foreground mb-1">Original</p>
              <p className="text-sm font-semibold">{fmtSize(result.originalSize)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Compressed</p>
              <p className="text-sm font-semibold text-green-700 dark:text-green-400">{fmtSize(result.compressedSize)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Saved</p>
              <p className="text-sm font-semibold text-green-700 dark:text-green-400">{savedPct}%</p>
            </div>
          </div>

          {result.mode === "smart" && result.imagesFound !== undefined && (
            <p className="text-xs text-muted-foreground text-center">
              {result.imagesFound === 0
                ? "No compressible images found — switch to Rasterize for size reduction."
                : `${result.imagesCompressed} of ${result.imagesFound} image${result.imagesFound !== 1 ? "s" : ""} re-compressed. Text remains selectable.`}
            </p>
          )}

          {result.compressedSize >= result.originalSize && (
            <p className="text-xs text-amber-600 dark:text-amber-400 text-center">
              Output is the same size or larger.
              {result.mode === "smart"
                ? " Images may already be below this quality. Try a lower setting or switch to Rasterize."
                : " Try a lower target size."}
            </p>
          )}

          <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{fmtSize(result.originalSize)}</span>
            <ArrowRightIcon className="h-3.5 w-3.5" />
            <span className="font-medium text-green-700 dark:text-green-400">{fmtSize(result.compressedSize)}</span>
          </div>

          <Button onClick={handleDownload} className="gap-2">
            <DownloadIcon className="h-4 w-4" />
            Download Compressed PDF
          </Button>
        </div>
      )}

    </div>
  );
}
