"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeftIcon, DownloadIcon, RotateCcwIcon, SaveIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/page-header";
import type { PackingListLabel } from "@/server/packing-list";
import { saveLabelTemplate } from "@/server/label-template";
import {
  DEFAULT_DESIGN, FIELD_LABEL, LABEL_TEMPLATES, code128Modules, elementText, encodedValue, newElement, newId, qrMatrix,
  type LabelDesign, type LabelElement, type LabelElementKind, type LabelFieldKey, type LabelItemData,
} from "@/lib/label-design";
import { generateLabelsPdf } from "./generate-labels-pdf";

const PX_PER_MM = 5; // designer zoom
const PT_TO_PX = PX_PER_MM / 2.8346; // 1pt = 0.3528mm
const FIELD_KEYS = Object.keys(FIELD_LABEL) as LabelFieldKey[];
const MAX_LOGO_BYTES = 400_000;

const KIND_LABEL: Record<LabelElementKind, string> = {
  field: "Data field", text: "Text", logo: "Logo / image", qr: "QR code", barcode: "Barcode", line: "Line", box: "Box",
};
const MIN_SIZE: Record<LabelElementKind, { w: number; h: number }> = {
  field: { w: 5, h: 3 }, text: { w: 5, h: 3 }, logo: { w: 4, h: 4 }, qr: { w: 6, h: 6 },
  barcode: { w: 15, h: 4 }, line: { w: 2, h: 0.2 }, box: { w: 3, h: 3 },
};

// Quick-add text snippets common on medical-device labels. LOT/expiry are
// typed by hand (they aren't stored on the packing list).
const PRESETS: { label: string; text: string }[] = [
  { label: "LOT", text: "LOT: " },
  { label: "Expiry", text: "EXP: " },
  { label: "Non-sterile", text: "NON-STERILE" },
  { label: "Material", text: "Stainless steel" },
  { label: "Manufacturer", text: "Manufacturer: " },
  { label: "Origin", text: "Made in " },
];

const num = (v: string, min: number, max: number) => Math.min(max, Math.max(min, Number(v) || min));
const r1 = (n: number) => Math.round(n * 2) / 2;

function QrSvg({ value }: { value: string }) {
  const m = qrMatrix(value);
  const q = 2;
  return (
    <svg viewBox={`0 0 ${m.length + q * 2} ${m.length + q * 2}`} className="w-full h-full" shapeRendering="crispEdges" preserveAspectRatio="xMidYMid meet">
      {m.map((row, r) => row.map((on, c) => on ? <rect key={`${r}-${c}`} x={c + q} y={r + q} width={1} height={1} /> : null))}
    </svg>
  );
}

function BarcodeSvg({ value }: { value: string }) {
  const mods = code128Modules(value);
  if (!mods) return <span className="text-[10px] text-red-600">Can't encode</span>;
  const bars: { x: number; w: number }[] = [];
  for (let i = 0; i < mods.length;) {
    if (!mods[i]) { i++; continue; }
    let j = i;
    while (j < mods.length && mods[j]) j++;
    bars.push({ x: i, w: j - i });
    i = j;
  }
  return (
    <svg viewBox={`0 0 ${mods.length} 10`} className="w-full h-full" shapeRendering="crispEdges" preserveAspectRatio="none">
      {bars.map((b) => <rect key={b.x} x={b.x} y={0} width={b.w} height={10} />)}
    </svg>
  );
}

function ElementView({ el, data }: { el: LabelElement; data: LabelItemData }) {
  if (el.kind === "line") return <div className="w-full h-full bg-black" />;
  if (el.kind === "box") return <div className="w-full h-full border border-black" />;
  if (el.kind === "logo") {
    // eslint-disable-next-line @next/next/no-img-element
    return el.src ? <img src={el.src} alt="" className="w-full h-full object-contain" draggable={false} /> : <span className="text-[10px] text-gray-400">Upload logo</span>;
  }
  if (el.kind === "qr") { const v = encodedValue(el, data); return v ? <QrSvg value={v} /> : <span className="text-[10px] text-gray-400">QR</span>; }
  if (el.kind === "barcode") { const v = encodedValue(el, data); return v ? <BarcodeSvg value={v} /> : <span className="text-[10px] text-gray-400">Barcode</span>; }
  const text = elementText(el, data);
  return (
    <div
      className="overflow-hidden w-full h-full"
      style={{ fontSize: `${el.fontSize * PT_TO_PX}px`, fontWeight: el.bold ? 700 : 400, textAlign: el.align, lineHeight: 1.15, wordBreak: "break-word" }}
    >
      {text || <span className="text-gray-400">{el.kind === "field" && el.field ? FIELD_LABEL[el.field] : "Text"}</span>}
    </div>
  );
}

export function LabelsClient({
  packingListId, packingListNo, labels, savedDesign, canSaveTemplate,
}: {
  packingListId: string;
  packingListNo: string;
  labels: PackingListLabel[];
  savedDesign: LabelDesign | null;
  canSaveTemplate: boolean;
}) {
  const router = useRouter();
  const [design, setDesign] = useState<LabelDesign>(savedDesign ?? DEFAULT_DESIGN);
  const [selectedId, setSelectedId] = useState<string | null>(design.elements[0]?.id ?? null);
  const [copies, setCopies] = useState<Record<string, number>>(Object.fromEntries(labels.map((l) => [l.itemId, 1])));
  const [previewIdx, setPreviewIdx] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [addField, setAddField] = useState<LabelFieldKey>("qty");

  const sample: LabelItemData = labels[Math.min(previewIdx, labels.length - 1)]?.data ?? {
    code: "CODE-123", description: "Sample description", mda: "GB1234567-123456", qty: "1", uom: "pcs", brand: "Brand",
    supplier: "Supplier", plNo: packingListNo, company: "Company", address: "Address", establishment: "", date: "00.00.0000",
  };
  const sel = design.elements.find((e) => e.id === selectedId) ?? null;

  const patch = (id: string, p: Partial<LabelElement>) =>
    setDesign((d) => ({ ...d, elements: d.elements.map((e) => (e.id === id ? { ...e, ...p } : e)) }));
  const add = (kind: LabelElementKind, extra: Partial<LabelElement> = {}) => {
    const el = newElement(kind, extra);
    setDesign((d) => ({ ...d, elements: [...d.elements, el] }));
    setSelectedId(el.id);
  };
  const remove = (id: string) => {
    setDesign((d) => ({ ...d, elements: d.elements.filter((e) => e.id !== id) }));
    setSelectedId(null);
  };

  const startDrag = (e: React.PointerEvent, el: LabelElement, mode: "move" | "resize") => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedId(el.id);
    const start = { px: e.clientX, py: e.clientY, x: el.x, y: el.y, w: el.w, h: el.h };
    const min = MIN_SIZE[el.kind];
    const grid = el.kind === "line" ? (n: number) => Math.round(n * 10) / 10 : r1;
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - start.px) / PX_PER_MM;
      const dy = (ev.clientY - start.py) / PX_PER_MM;
      if (mode === "move") {
        patch(el.id, {
          x: r1(Math.min(Math.max(0, start.x + dx), Math.max(0, design.width - start.w))),
          y: r1(Math.min(Math.max(0, start.y + dy), Math.max(0, design.height - start.h))),
        });
      } else {
        patch(el.id, {
          w: grid(Math.min(Math.max(min.w, start.w + dx), design.width - start.x)),
          h: grid(Math.min(Math.max(min.h, start.h + dy), design.height - start.y)),
        });
      }
    };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const sheet = labels.flatMap((l) => Array.from({ length: copies[l.itemId] ?? 0 }, () => l.data));

  async function handleDownload() {
    setGenerating(true);
    try {
      const bytes = await generateLabelsPdf(design, sheet);
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `${packingListNo}-labels.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't generate the labels PDF");
    } finally {
      setGenerating(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      await saveLabelTemplate(design);
      toast.success("Label layout saved for your organization");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save the layout");
    } finally {
      setSaving(false);
    }
  }

  function handleLogoUpload(file: File | undefined, id: string) {
    if (!file) return;
    if (!/^image\/(png|jpe?g)$/.test(file.type)) { toast.error("Use a PNG or JPEG image"); return; }
    if (file.size > MAX_LOGO_BYTES) { toast.error("Logo is too large — keep it under 400 KB"); return; }
    const reader = new FileReader();
    reader.onload = () => patch(id, { src: String(reader.result) });
    reader.readAsDataURL(file);
  }

  const isText = sel && (sel.kind === "field" || sel.kind === "text");

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <PageHeader
        title="Label Stickers"
        description={`${packingListNo} · ${sheet.length} sticker${sheet.length === 1 ? "" : "s"}`}
        action={
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => router.push(`/dashboard/procurement/packing-list/${packingListId}`)}>
              <ArrowLeftIcon className="w-3.5 h-3.5" /> Back
            </Button>
            {canSaveTemplate && (
              <Button variant="outline" size="sm" className="gap-1.5" disabled={saving} onClick={handleSave}>
                <SaveIcon className="w-3.5 h-3.5" /> {saving ? "Saving…" : "Save layout"}
              </Button>
            )}
            <Button size="sm" className="gap-1.5" disabled={sheet.length === 0 || generating} onClick={handleDownload}>
              <DownloadIcon className="w-3.5 h-3.5" /> {generating ? "Generating…" : "Download PDF"}
            </Button>
          </div>
        }
      />

      <div className="rounded-md border p-4 space-y-4">
        <div className="flex flex-wrap items-end gap-4 text-sm">
          <label className="space-y-1">
            <span className="block text-xs text-muted-foreground">Width (mm)</span>
            <Input type="number" className="w-24 h-8" value={design.width} onChange={(e) => setDesign((d) => ({ ...d, width: num(e.target.value, 20, 300) }))} />
          </label>
          <label className="space-y-1">
            <span className="block text-xs text-muted-foreground">Height (mm)</span>
            <Input type="number" className="w-24 h-8" value={design.height} onChange={(e) => setDesign((d) => ({ ...d, height: num(e.target.value, 15, 300) }))} />
          </label>
          {labels.length > 1 && (
            <label className="space-y-1">
              <span className="block text-xs text-muted-foreground">Preview with item</span>
              <select className="h-8 rounded-md border bg-background px-2 max-w-56" value={previewIdx} onChange={(e) => setPreviewIdx(Number(e.target.value))}>
                {labels.map((l, i) => <option key={l.itemId} value={i}>{l.data.code || `Item ${i + 1}`}</option>)}
              </select>
            </label>
          )}
          <label className="space-y-1">
            <span className="block text-xs text-muted-foreground">Start from template</span>
            <select
              className="h-8 rounded-md border bg-background px-2"
              value=""
              onChange={(e) => {
                const tpl = LABEL_TEMPLATES.find((x) => x.key === e.target.value);
                if (!tpl) return;
                // fresh element ids so edits never alias the shared template
                setDesign({ ...tpl.design, elements: tpl.design.elements.map((el) => ({ ...el, id: newId() })) });
                setSelectedId(null);
              }}
            >
              <option value="">Choose…</option>
              {LABEL_TEMPLATES.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
            </select>
          </label>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => { setDesign(DEFAULT_DESIGN); setSelectedId("code"); }}>
            <RotateCcwIcon className="w-3.5 h-3.5" /> Reset layout
          </Button>
        </div>

        {/* Add elements */}
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-xs text-muted-foreground">Add:</span>
          <div className="flex items-center gap-1">
            <select className="h-8 rounded-md border bg-background px-2" value={addField} onChange={(e) => setAddField(e.target.value as LabelFieldKey)}>
              {FIELD_KEYS.map((k) => <option key={k} value={k}>{FIELD_LABEL[k]}</option>)}
            </select>
            <Button variant="outline" size="sm" onClick={() => add("field", { field: addField, prefix: "" })}>Field</Button>
          </div>
          <Button variant="outline" size="sm" onClick={() => add("text", { text: "Text" })}>Text</Button>
          <Button variant="outline" size="sm" onClick={() => add("logo")}>Logo / image</Button>
          <Button variant="outline" size="sm" onClick={() => add("qr", { field: "code" })}>QR code</Button>
          <Button variant="outline" size="sm" onClick={() => add("barcode", { field: "code" })}>Barcode</Button>
          <Button variant="outline" size="sm" onClick={() => add("line")}>Line</Button>
          <Button variant="outline" size="sm" onClick={() => add("box")}>Box</Button>
          <span className="text-xs text-muted-foreground ml-2">Quick text:</span>
          {PRESETS.map((p) => <Button key={p.label} variant="ghost" size="sm" onClick={() => add("text", { text: p.text, w: 30 })}>{p.label}</Button>)}
        </div>

        <div className="overflow-auto rounded bg-muted/40 p-4">
          <div
            className="relative bg-white text-black shadow ring-1 ring-gray-300 select-none"
            style={{ width: design.width * PX_PER_MM, height: design.height * PX_PER_MM }}
            onPointerDown={() => setSelectedId(null)}
          >
            {design.elements.map((el) => (
              <div
                key={el.id}
                onPointerDown={(e) => startDrag(e, el, "move")}
                className={`absolute cursor-move ${el.kind === "line" ? "" : "border border-dashed"} ${selectedId === el.id ? "border-blue-500 bg-blue-500/10 outline outline-1 outline-blue-500" : "border-gray-300"}`}
                style={{ left: el.x * PX_PER_MM, top: el.y * PX_PER_MM, width: el.w * PX_PER_MM, height: Math.max(el.h * PX_PER_MM, 2) }}
              >
                <div className="w-full h-full pointer-events-none flex items-center justify-center"><ElementView el={el} data={sample} /></div>
                {selectedId === el.id && (
                  <span onPointerDown={(e) => startDrag(e, el, "resize")} className="absolute -right-1 -bottom-1 size-2.5 cursor-se-resize rounded-sm bg-blue-500" />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Properties of the selected element */}
        {sel ? (
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap items-end gap-3">
              <span className="font-medium pb-1.5">{KIND_LABEL[sel.kind]}</span>
              {(["x", "y", "w", "h"] as const).map((p) => (
                <label key={p} className="space-y-1">
                  <span className="block text-xs text-muted-foreground">{{ x: "Left", y: "Top", w: "Width", h: "Height" }[p]} (mm)</span>
                  <Input type="number" step={0.5} className="w-20 h-8" value={sel[p]} onChange={(e) => patch(sel.id, { [p]: num(e.target.value, 0, 300) })} />
                </label>
              ))}
              {(sel.kind === "field" || sel.kind === "qr" || sel.kind === "barcode") && (
                <label className="space-y-1">
                  <span className="block text-xs text-muted-foreground">{sel.kind === "field" ? "Value" : "Encodes"}</span>
                  <select className="h-8 rounded-md border bg-background px-2" value={sel.field} onChange={(e) => patch(sel.id, { field: e.target.value as LabelFieldKey })}>
                    {FIELD_KEYS.map((k) => <option key={k} value={k}>{FIELD_LABEL[k]}</option>)}
                  </select>
                </label>
              )}
              {sel.kind === "field" && (
                <label className="space-y-1">
                  <span className="block text-xs text-muted-foreground">Prefix</span>
                  <Input className="w-40 h-8" value={sel.prefix ?? ""} onChange={(e) => patch(sel.id, { prefix: e.target.value })} />
                </label>
              )}
              {sel.kind === "text" && (
                <label className="space-y-1">
                  <span className="block text-xs text-muted-foreground">Content</span>
                  <Input className="w-64 h-8" value={sel.text ?? ""} onChange={(e) => patch(sel.id, { text: e.target.value })} />
                </label>
              )}
              {isText && (
                <>
                  <label className="space-y-1">
                    <span className="block text-xs text-muted-foreground">Font (pt)</span>
                    <Input type="number" step={0.5} className="w-20 h-8" value={sel.fontSize} onChange={(e) => patch(sel.id, { fontSize: num(e.target.value, 4, 72) })} />
                  </label>
                  <label className="space-y-1">
                    <span className="block text-xs text-muted-foreground">Align</span>
                    <select className="h-8 rounded-md border bg-background px-2" value={sel.align} onChange={(e) => patch(sel.id, { align: e.target.value as LabelElement["align"] })}>
                      <option value="left">Left</option><option value="center">Center</option><option value="right">Right</option>
                    </select>
                  </label>
                  <label className="flex items-center gap-2 pb-1.5">
                    <input type="checkbox" checked={sel.bold} onChange={(e) => patch(sel.id, { bold: e.target.checked })} /> Bold
                  </label>
                </>
              )}
              {sel.kind === "logo" && (
                <label className="space-y-1">
                  <span className="block text-xs text-muted-foreground">Logo image (PNG or JPEG, max 400 KB)</span>
                  <input type="file" accept="image/png,image/jpeg" className="text-xs block" onChange={(e) => { handleLogoUpload(e.target.files?.[0], sel.id); e.target.value = ""; }} />
                </label>
              )}
              <Button variant="outline" size="sm" className="gap-1.5 text-destructive hover:text-destructive" onClick={() => remove(sel.id)}>
                <Trash2Icon className="w-3.5 h-3.5" /> Remove
              </Button>
            </div>
            {sel.kind === "logo" && !sel.src && (
              <p className="text-xs text-destructive">No image uploaded yet, so nothing will print here.</p>
            )}
            {(sel.kind === "qr" || sel.kind === "barcode") && !encodedValue(sel, sample) && (
              <p className="text-xs text-destructive">This value is empty for the previewed item, so no code will print for it.</p>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Click an element to edit it.</p>
        )}
        <p className="text-xs text-muted-foreground">
          Drag an element to move it, drag its blue corner to resize. Text too long for its box is shrunk to fit. Download the PDF and print it at 100% / actual size.
          {canSaveTemplate ? " “Save layout” shares this design with everyone in your organization." : ""}
        </p>
      </div>

      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => setCopies(Object.fromEntries(labels.map((l) => [l.itemId, 1])))}>1 each</Button>
        <Button variant="outline" size="sm" onClick={() => setCopies(Object.fromEntries(labels.map((l) => [l.itemId, l.qty])))}>Match packed qty</Button>
      </div>
      <div className="rounded-md border divide-y">
        {labels.map((l) => (
          <div key={l.itemId} className="flex items-center gap-3 p-3 text-sm">
            <div className="flex-1 min-w-0">
              <div className="font-medium truncate">{l.data.code || "—"}</div>
              <div className="text-muted-foreground truncate">{l.data.description || "No description"}</div>
              <div className={l.data.mda ? "text-xs" : "text-xs text-destructive"}>
                {l.data.mda ? `MDA: ${l.data.mda}` : "No MDA registration no. on product"}
              </div>
            </div>
            <label className="flex items-center gap-2 shrink-0">
              Copies
              <Input
                type="number" min={0} className="w-20 h-8"
                value={copies[l.itemId] ?? 0}
                onChange={(e) => setCopies((c) => ({ ...c, [l.itemId]: Math.max(0, Math.floor(Number(e.target.value) || 0)) }))}
              />
            </label>
          </div>
        ))}
      </div>
    </div>
  );
}
