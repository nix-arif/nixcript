"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { CheckIcon, DownloadIcon, FileSpreadsheetIcon, PencilIcon, PlusIcon, SaveIcon, SearchIcon, Trash2Icon, UploadIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { PageHeader } from "@/components/page-header";
import { cn } from "@/lib/utils";
import {
  cleanText, findHeaderRow, type ColumnMap, type ConversionResult, type ConversionStatus,
} from "@/lib/brand-conversion";
import {
  convertBrandCodes, deleteBrandConversion, describeCodes, importBrandConversions, listBrandConversions, saveBrandConversion,
  type BrandConversionRow,
} from "@/server/brand-conversion";

// ── Reading a spreadsheet ───────────────────────────────────────────────────

type Cell = string | number | null;
type Parsed = { fileName: string; headers: string[]; columns: ColumnMap; rows: Cell[][] };

/** First sheet that has a recognisable code column; the rows under its header. */
async function readSheet(file: File): Promise<Parsed | null> {
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  for (const name of wb.SheetNames) {
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, raw: true, defval: "" });
    const h = findHeaderRow(aoa);
    if (!h) continue;
    const width = Math.max(...aoa.slice(h.index, h.index + 50).map((r) => r.length), 1);
    const norm = (r: unknown[]): Cell[] => Array.from({ length: width }, (_, i) => (r[i] === "" || r[i] === undefined ? null : (r[i] as Cell)));
    const rows = aoa.slice(h.index + 1).map(norm).filter((r) => r.some((v) => v !== null));
    return { fileName: file.name, headers: norm(aoa[h.index]).map((v) => (v === null ? "" : String(v))), columns: h.columns, rows };
  }
  return null;
}

const asText = (v: Cell | undefined) => (v === null || v === undefined ? "" : cleanText(v));

// ── Convert tab ─────────────────────────────────────────────────────────────

type Row = {
  cells: Cell[];
  brand: string;
  code: string;
  res: ConversionResult;
  bm: string; // the Best Medical code currently chosen
  description: string;
  catalogueName: string;
  uom: string;
  manual: boolean; // chosen or typed by the user, not the system's suggestion
};

const STATUS_STYLE: Record<ConversionStatus | "manual", { label: string; cls: string }> = {
  matched: { label: "Matched", cls: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400" },
  check: { label: "Check", cls: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400" },
  own: { label: "Best Medical code", cls: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400" },
  notfound: { label: "Not found", cls: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400" },
  blank: { label: "No code", cls: "bg-muted text-muted-foreground" },
  manual: { label: "Set by you", cls: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400" },
};

function ConvertTab({ canManage }: { canManage: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [columns, setColumns] = useState<ColumnMap>({});
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState<"convert" | "download" | "save" | null>(null);
  const [onlyAttention, setOnlyAttention] = useState(false);

  async function handleFile(f: File) {
    setRows(null);
    try {
      const p = await readSheet(f);
      if (!p) { toast.error("Couldn't find a code column. The sheet needs a header such as “Design Brand Code to Refer”."); setParsed(null); return; }
      if (p.rows.length === 0) { toast.error("The sheet has a header but no rows under it."); setParsed(null); return; }
      setParsed(p); setColumns(p.columns);
    } catch {
      toast.error("Couldn't read that file. Use an .xlsx or .ods spreadsheet.");
    }
  }

  async function convert() {
    if (!parsed || columns.code === undefined) return;
    setBusy("convert");
    try {
      const items = parsed.rows.map((r) => ({ brand: columns.brand !== undefined ? asText(r[columns.brand]) : "", code: asText(r[columns.code!]) }));
      const results = await convertBrandCodes(items);
      setRows(parsed.rows.map((cells, i) => ({
        cells, brand: items[i].brand, code: items[i].code, res: results[i],
        bm: results[i].bestMedicalCode, description: results[i].description, catalogueName: results[i].catalogueName, uom: results[i].uom, manual: false,
      })));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't convert the codes");
    } finally {
      setBusy(null);
    }
  }

  const patchRow = (i: number, p: Partial<Row>) => setRows((rs) => rs && rs.map((r, k) => (k === i ? { ...r, ...p } : r)));

  /** The user picked another code seen before, or typed one in. */
  async function chooseCode(i: number, bm: string) {
    const code = cleanText(bm).toUpperCase();
    const r = rows![i];
    if (code === r.bm) return;
    const alt = r.res.alternatives.find((a) => a.bestMedicalCode === code);
    patchRow(i, { bm: code, manual: code !== r.res.bestMedicalCode });
    if (!code) { patchRow(i, { description: "", catalogueName: "", uom: "" }); return; }
    try {
      const d = (await describeCodes([code]))[code.replace(/\s+/g, "")];
      patchRow(i, { description: alt?.description || d?.description || "", catalogueName: d?.description ?? "", uom: d?.uom || r.uom });
    } catch { /* description just stays as it was */ }
  }

  const statusOf = (r: Row): ConversionStatus | "manual" => (r.manual && r.bm ? "manual" : r.res.status === "notfound" && r.bm ? "manual" : r.res.status);
  const counts = (rows ?? []).reduce<Record<string, number>>((a, r) => { const s = statusOf(r); a[s] = (a[s] ?? 0) + 1; return a; }, {});
  const attention = (rows ?? []).filter((r) => { const s = statusOf(r); return s === "check" || s === "notfound"; }).length;

  async function download() {
    if (!parsed || !rows) return;
    setBusy("download");
    try {
      const res = await fetch("/api/products/brand-conversion/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: parsed.fileName, headers: parsed.headers, columns,
          rows: rows.map((r) => {
            const s = statusOf(r);
            return {
              cells: r.cells, brand: r.brand, code: r.code, status: s === "manual" ? "matched" : s,
              bestMedicalCode: r.bm, description: r.description, catalogueName: r.catalogueName, uom: r.uom,
              note: s === "manual" ? "Set manually" : r.res.note,
              alternatives: r.res.alternatives.map((a) => `${a.bestMedicalCode} (${a.useCount}×)`).join(", "),
            };
          }),
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `Server error ${res.status}`);
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url; a.download = `${parsed.fileName.replace(/\.[^.]+$/, "")} - converted.xlsx`; a.click();
      URL.revokeObjectURL(url);
      toast.success("Converted Excel downloaded");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't build the Excel file");
    } finally {
      setBusy(null);
    }
  }

  const manualRows = (rows ?? []).filter((r) => r.manual && r.bm && r.code);
  async function saveCorrections() {
    setBusy("save");
    try {
      const res = await importBrandConversions(
        manualRows.map((r) => ({ brandName: r.brand, brandCode: r.code, bestMedicalCode: r.bm, description: r.description, uom: r.uom })),
        "manual — " + (parsed?.fileName ?? "conversion page"),
      );
      toast.success(`${res.saved} conversion${res.saved === 1 ? "" : "s"} saved to the list`);
      setRows((rs) => rs && rs.map((r) => ({ ...r, manual: false, res: r.manual && r.bm ? { ...r.res, status: "matched", bestMedicalCode: r.bm } : r.res })));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setBusy(null);
    }
  }

  function downloadTemplate() {
    const ws = XLSX.utils.aoa_to_sheet([
      ["Hospital", "Set Name", "No", "Design Brand Name to Refer", "Design Brand Code to Refer", "Qty", "OUM"],
      ["Mersing", "Loose Items", 1, "medicon", "01.27.03", 10, "pc"],
      ["Mersing", "Loose Items", 2, "geister", "25-0101", 2, "pc"],
    ]);
    ws["!cols"] = [{ wch: 18 }, { wch: 16 }, { wch: 6 }, { wch: 26 }, { wch: 26 }, { wch: 8 }, { wch: 8 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    XLSX.writeFile(wb, "brand-conversion-template.xlsx");
  }

  const colSelect = (role: "code" | "brand", label: string, required: boolean) => (
    <label className="space-y-1 text-xs text-muted-foreground">
      {label}
      <select
        value={columns[role] ?? ""}
        onChange={(e) => { setColumns((c) => ({ ...c, [role]: e.target.value === "" ? undefined : Number(e.target.value) })); setRows(null); }}
        className="block h-8 rounded-md border bg-background px-2 text-sm text-foreground min-w-48"
      >
        {!required && <option value="">(none)</option>}
        {required && columns.code === undefined && <option value="">Choose…</option>}
        {parsed!.headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
      </select>
    </label>
  );

  const shown = (rows ?? []).map((r, i) => ({ r, i })).filter(({ r }) => !onlyAttention || ["check", "notfound"].includes(statusOf(r)));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" size="sm" onClick={downloadTemplate} className="gap-1.5"><DownloadIcon className="h-4 w-4" /> Download template</Button>
        <span className="text-xs text-muted-foreground">Any sheet with a brand-code column works — a header like <span className="font-mono">Design Brand Code to Refer</span> is detected automatically.</span>
      </div>

      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
        onClick={() => inputRef.current?.click()}
        className={cn("flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-8 cursor-pointer select-none transition-colors",
          dragging ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-muted-foreground/50 hover:bg-muted/30")}
      >
        <input ref={inputRef} type="file" accept=".xlsx,.xls,.ods" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }} />
        <UploadIcon className="h-7 w-7 text-muted-foreground" />
        <p className="text-sm font-medium">Drop the hospital&apos;s product list here, or click to browse</p>
        <p className="text-xs text-muted-foreground">.xlsx or .ods — your own columns (hospital, set, qty…) are kept in the result</p>
      </div>

      {parsed && (
        <div className="rounded-xl border p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm">
            <FileSpreadsheetIcon className="h-4 w-4 text-emerald-500" />
            <span className="font-medium truncate">{parsed.fileName}</span>
            <span className="text-muted-foreground">· {parsed.rows.length} rows</span>
            <button className="ml-auto text-muted-foreground hover:text-foreground" onClick={() => { setParsed(null); setRows(null); }}><XIcon className="h-4 w-4" /></button>
          </div>
          <div className="flex flex-wrap items-end gap-4">
            {colSelect("code", "Brand code column", true)}
            {colSelect("brand", "Brand name column", false)}
            <Button size="sm" disabled={columns.code === undefined || busy !== null} onClick={convert} className="gap-1.5">
              {busy === "convert" ? <Spinner className="size-4" /> : <CheckIcon className="h-4 w-4" />} Convert
            </Button>
          </div>
        </div>
      )}

      {rows && parsed && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {(["matched", "check", "own", "notfound", "manual"] as const).filter((s) => counts[s]).map((s) => (
              <span key={s} className={cn("rounded-full px-2.5 py-1 font-medium", STATUS_STYLE[s].cls)}>{counts[s]} {STATUS_STYLE[s].label.toLowerCase()}</span>
            ))}
            {attention > 0 && (
              <label className="ml-2 flex items-center gap-1.5 text-muted-foreground">
                <input type="checkbox" checked={onlyAttention} onChange={(e) => setOnlyAttention(e.target.checked)} /> Show only the {attention} that need a look
              </label>
            )}
            <div className="ml-auto flex items-center gap-2">
              {canManage && manualRows.length > 0 && (
                <Button variant="outline" size="sm" disabled={busy !== null} onClick={saveCorrections} className="gap-1.5">
                  {busy === "save" ? <Spinner className="size-4" /> : <SaveIcon className="h-4 w-4" />} Remember my {manualRows.length} choice{manualRows.length === 1 ? "" : "s"}
                </Button>
              )}
              <Button size="sm" disabled={busy !== null} onClick={download} className="gap-1.5">
                {busy === "download" ? <Spinner className="size-4" /> : <DownloadIcon className="h-4 w-4" />} Download Excel
              </Button>
            </div>
          </div>

          <div className="rounded-xl border overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b bg-muted/30 text-muted-foreground text-left">
                  <th className="px-3 py-2 w-10 font-medium">#</th>
                  <th className="px-3 py-2 font-medium">Brand</th>
                  <th className="px-3 py-2 font-medium">Brand code</th>
                  <th className="px-3 py-2 font-medium min-w-44">Best Medical code</th>
                  <th className="px-3 py-2 font-medium min-w-64">Description</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {shown.map(({ r, i }) => {
                  const s = statusOf(r);
                  const choices = r.res.alternatives;
                  return (
                    <tr key={i} className={cn("border-b border-border/60 align-top", s === "check" && "bg-amber-50/60 dark:bg-amber-900/10", s === "notfound" && "bg-red-50/60 dark:bg-red-900/10")}>
                      <td className="px-3 py-2 text-muted-foreground tabular-nums">{i + 1}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{r.brand || <span className="text-muted-foreground">—</span>}</td>
                      <td className="px-3 py-2 font-mono whitespace-nowrap">{r.code || <span className="text-muted-foreground">—</span>}</td>
                      <td className="px-3 py-2">
                        {r.res.status === "blank" ? <span className="text-muted-foreground">—</span> : (
                          <>
                            <Input
                              defaultValue={r.bm} key={r.bm}
                              onBlur={(e) => chooseCode(i, e.target.value)}
                              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                              placeholder="Type a code"
                              className="h-7 font-mono text-xs w-40"
                            />
                            {choices.length > 1 && (
                              <div className="mt-1 flex flex-wrap gap-1">
                                {choices.map((a) => (
                                  <button key={a.bestMedicalCode} type="button" onClick={() => chooseCode(i, a.bestMedicalCode)}
                                    className={cn("rounded border px-1.5 py-0.5 font-mono text-[10px]", a.bestMedicalCode === r.bm ? "border-primary bg-primary/10" : "hover:bg-muted")}
                                    title={`Used ${a.useCount} time${a.useCount === 1 ? "" : "s"} before`}>
                                    {a.bestMedicalCode} · {a.useCount}×
                                  </button>
                                ))}
                              </div>
                            )}
                          </>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div className="whitespace-pre-line">{r.description || <span className="text-muted-foreground">—</span>}</div>
                        {r.catalogueName && r.catalogueName.toLowerCase() !== r.description.toLowerCase() && (
                          <div className="text-[10px] text-muted-foreground mt-0.5">Catalogue: {r.catalogueName}</div>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium whitespace-nowrap", STATUS_STYLE[s].cls)}>{STATUS_STYLE[s].label}</span>
                        {r.res.note && s !== "manual" && <div className="text-[10px] text-muted-foreground mt-1 max-w-48">{r.res.note}</div>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">
            <b className="text-foreground">Check</b> means this brand code was converted to different Best Medical codes in past orders — the most-used one is suggested; click another to switch.
            <b className="text-foreground"> Not found</b> has no conversion on record — type the code in the box.
            {canManage ? " “Remember my choices” saves what you set so next time it converts by itself." : ""}
          </p>
        </div>
      )}
    </div>
  );
}

// ── Conversion list tab ─────────────────────────────────────────────────────

function ListTab({ canManage }: { canManage: boolean }) {
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<{ rows: BrandConversionRow[]; total: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [form, setForm] = useState({ brandName: "", brandCode: "", bestMedicalCode: "", description: "" });
  const [saving, setSaving] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await listBrandConversions({ search, offset })); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't load the list"); }
    finally { setLoading(false); }
  }, [search, offset]);
  useEffect(() => { const t = setTimeout(load, search ? 250 : 0); return () => clearTimeout(t); }, [load, search]);

  function startEdit(r: BrandConversionRow | null) {
    setConfirmId(null);
    setEditing(r ? r.id : "new");
    setForm(r ? { brandName: r.brandName, brandCode: r.brandCode, bestMedicalCode: r.bestMedicalCode, description: r.description ?? "" } : { brandName: "", brandCode: "", bestMedicalCode: "", description: "" });
  }
  async function save() {
    setSaving(true);
    try {
      await saveBrandConversion({ id: editing === "new" ? undefined : editing!, ...form });
      toast.success("Saved");
      setEditing(null);
      await load();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't save"); }
    finally { setSaving(false); }
  }
  async function remove(id: string) {
    setSaving(true);
    try { await deleteBrandConversion(id); setConfirmId(null); toast.success("Deleted"); await load(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't delete"); }
    finally { setSaving(false); }
  }

  async function importSheets(files: FileList) {
    setImporting(true);
    let saved = 0; let used = 0;
    try {
      for (const f of Array.from(files)) {
        const wb = XLSX.read(await f.arrayBuffer(), { type: "array" });
        const rows: { brandName: string; brandCode: string; bestMedicalCode: string; description: string; uom: string }[] = [];
        for (const name of wb.SheetNames) {
          const aoa = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, raw: false, defval: "" });
          const h = findHeaderRow(aoa);
          if (!h || h.columns.bm === undefined) continue;
          const c = h.columns;
          for (const r of aoa.slice(h.index + 1)) {
            const code = cleanText(r[c.code!]); const bm = cleanText(r[c.bm!]);
            if (code && bm) rows.push({ brandName: c.brand !== undefined ? cleanText(r[c.brand]) : "", brandCode: code, bestMedicalCode: bm, description: c.description !== undefined ? cleanText(r[c.description]) : "", uom: c.uom !== undefined ? cleanText(r[c.uom]) : "" });
          }
        }
        if (rows.length === 0) { toast.warning(`${f.name}: no rows with both a brand code and a Best Medical code`); continue; }
        const res = await importBrandConversions(rows, f.name);
        saved += res.saved; used++;
      }
      if (used > 0) toast.success(`Added ${saved} conversion${saved === 1 ? "" : "s"} from ${used} sheet${used === 1 ? "" : "s"}`);
      await load();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Import failed"); }
    finally { setImporting(false); }
  }

  const inp = "h-8 text-xs";
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input value={search} onChange={(e) => { setSearch(e.target.value); setOffset(0); }} placeholder="Search brand, code or description…" className="pl-8 h-8 w-72 text-sm" />
        </div>
        <span className="text-xs text-muted-foreground">{data ? `${data.total} conversion${data.total === 1 ? "" : "s"}` : ""}</span>
        {canManage && (
          <div className="ml-auto flex items-center gap-2">
            <input ref={importRef} type="file" multiple accept=".xlsx,.xls,.ods" className="hidden" onChange={(e) => { if (e.target.files?.length) importSheets(e.target.files); e.target.value = ""; }} />
            <Button variant="outline" size="sm" className="gap-1.5" disabled={importing} onClick={() => importRef.current?.click()}
              title="Add the conversions from finished order sheets (they need both a brand code and a Best Medical code column). Importing the same sheet twice counts it twice.">
              {importing ? <Spinner className="size-4" /> : <UploadIcon className="h-4 w-4" />} Import order sheets
            </Button>
            <Button size="sm" className="gap-1.5" onClick={() => startEdit(null)}><PlusIcon className="h-4 w-4" /> Add</Button>
          </div>
        )}
      </div>

      {editing && canManage && (
        <div className="rounded-xl border p-3 flex flex-wrap items-end gap-2">
          <label className="text-xs text-muted-foreground space-y-1">Brand<Input className={cn(inp, "w-36")} value={form.brandName} placeholder="medicon" onChange={(e) => setForm({ ...form, brandName: e.target.value })} /></label>
          <label className="text-xs text-muted-foreground space-y-1">Brand code<Input className={cn(inp, "w-36 font-mono")} value={form.brandCode} onChange={(e) => setForm({ ...form, brandCode: e.target.value })} /></label>
          <label className="text-xs text-muted-foreground space-y-1">Best Medical code<Input className={cn(inp, "w-36 font-mono")} value={form.bestMedicalCode} onChange={(e) => setForm({ ...form, bestMedicalCode: e.target.value })} /></label>
          <label className="text-xs text-muted-foreground space-y-1 flex-1 min-w-48">Description<Input className={inp} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
          <Button size="sm" className="h-8 gap-1.5" disabled={saving || !form.brandCode.trim() || !form.bestMedicalCode.trim()} onClick={save}>{saving ? <Spinner className="size-4" /> : <CheckIcon className="h-4 w-4" />} Save</Button>
          <Button size="sm" variant="ghost" className="h-8" disabled={saving} onClick={() => setEditing(null)}>Cancel</Button>
        </div>
      )}

      <div className="rounded-xl border overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b bg-muted/30 text-muted-foreground text-left">
              <th className="px-3 py-2 font-medium">Brand</th><th className="px-3 py-2 font-medium">Brand code</th>
              <th className="px-3 py-2 font-medium">Best Medical code</th><th className="px-3 py-2 font-medium min-w-64">Description</th>
              <th className="px-3 py-2 font-medium text-right">Used</th><th className="px-3 py-2 font-medium">Last seen</th>{canManage && <th className="px-3 py-2 w-24" />}
            </tr>
          </thead>
          <tbody>
            {loading && !data && <tr><td colSpan={7} className="px-3 py-8 text-center text-muted-foreground"><Spinner className="inline size-4" /></td></tr>}
            {data?.rows.map((r) => (
              <tr key={r.id} className="border-b border-border/60 align-top">
                <td className="px-3 py-2 whitespace-nowrap">{r.brandName || <span className="text-muted-foreground">—</span>}</td>
                <td className="px-3 py-2 font-mono whitespace-nowrap">{r.brandCode}</td>
                <td className="px-3 py-2 font-mono whitespace-nowrap font-medium">{r.bestMedicalCode}</td>
                <td className="px-3 py-2 whitespace-pre-line">{r.description || <span className="text-muted-foreground">—</span>}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.useCount}</td>
                <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{r.lastSeen ?? "—"}</td>
                {canManage && (
                  <td className="px-3 py-2">
                    {confirmId === r.id ? (
                      <span className="flex items-center gap-1">
                        <Button size="sm" variant="destructive" className="h-6 px-2 text-[10px]" disabled={saving} onClick={() => remove(r.id)}>Delete</Button>
                        <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={() => setConfirmId(null)}>Keep</Button>
                      </span>
                    ) : (
                      <span className="flex items-center gap-0.5">
                        <Button size="sm" variant="ghost" className="h-6 w-6 p-0" title="Edit" onClick={() => startEdit(r)}><PencilIcon className="h-3.5 w-3.5" /></Button>
                        <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive" title="Delete" onClick={() => setConfirmId(r.id)}><Trash2Icon className="h-3.5 w-3.5" /></Button>
                      </span>
                    )}
                  </td>
                )}
              </tr>
            ))}
            {data && data.rows.length === 0 && <tr><td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">{search ? "Nothing matches." : "No conversions yet."}</td></tr>}
          </tbody>
        </table>
      </div>
      {data && data.total > 100 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{offset + 1}–{Math.min(offset + 100, data.total)} of {data.total}</span>
          <span className="flex gap-2">
            <Button size="sm" variant="outline" disabled={offset === 0 || loading} onClick={() => setOffset(Math.max(0, offset - 100))}>Previous</Button>
            <Button size="sm" variant="outline" disabled={offset + 100 >= data.total || loading} onClick={() => setOffset(offset + 100)}>Next</Button>
          </span>
        </div>
      )}
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

export function BrandConversionClient({ canManage }: { canManage: boolean }) {
  const [tab, setTab] = useState<"convert" | "list">("convert");
  return (
    <div className="p-6 space-y-5">
      <PageHeader
        title="Brand Conversion"
        description="Upload a hospital's product list with brand codes (medicon, geister, bolton surgical…) and get back the Best Medical codes to emboss, with descriptions."
      />
      <div className="flex gap-1 border-b">
        {([["convert", "Convert"], ["list", "Conversion list"]] as const).map(([k, label]) => (
          <button key={k} type="button" onClick={() => setTab(k)}
            className={cn("px-4 py-2 text-sm -mb-px border-b-2 transition-colors", tab === k ? "border-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground")}>
            {label}
          </button>
        ))}
      </div>
      {tab === "convert" ? <ConvertTab canManage={canManage} /> : <ListTab canManage={canManage} />}
    </div>
  );
}
