"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, DownloadIcon, ExternalLinkIcon, SearchIcon, TruckIcon, XIcon } from "lucide-react";
import { InspectionMediaThumb, DownloadMediaButton } from "@/components/inspection-media";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader } from "@/components/page-header";
import { Input } from "@/components/ui/input";
import { Highlight } from "@/components/highlight";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { PendingLine, PendingPhoto } from "@/server/pending-from-supplier";

// The conditions a line can be pending under — any combination can be ticked.
type Cond = "notShipped" | "short" | "replacement";
const ALL_CONDS: Cond[] = ["notShipped", "short", "replacement"];

const KIND_LABEL: Record<Cond, string> = {
  notShipped: "Not shipped yet",
  short: "Short on packing list",
  replacement: "Awaiting replacement",
};

const fmtQty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));
// A defect photo for the PDF: fetched from this site, shrunk to ≤400px and
// re-encoded as JPEG (pdf-lib embeds only JPEG/PNG; phones may send WebP/HEIC-
// converted files). null when it can't be loaded — the PDF just leaves it out.
async function photoForPdf(id: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(`/api/pending-from-supplier/photo/${id}`);
    if (!res.ok) return null;
    const bmp = await createImageBitmap(await res.blob());
    const sc = Math.min(1, 400 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bmp.width * sc));
    canvas.height = Math.max(1, Math.round(bmp.height * sc));
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.82));
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
  } catch {
    return null;
  }
}

// the line's unit of measure for "Short by 2 pc" — "pc" when it has none
const unitOf = (l: PendingLine) => (l.uom?.trim() || "pc").toLowerCase();
const daysSince = (d: Date) => Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000));
const fmtDate = (d: Date) => new Date(d).toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" });

function AgeBadge({ since }: { since: Date }) {
  const days = daysSince(since);
  return (
    <span
      title={`Pending since ${fmtDate(since)}`}
      className={cn(
        "text-[11px] font-medium tabular-nums rounded px-1.5 py-0.5",
        days > 60 ? "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400"
          : days > 30 ? "bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400"
          : "bg-muted text-muted-foreground",
      )}
    >
      {days}d
    </span>
  );
}

const qtyOf = (l: PendingLine, c: Cond) => (c === "notShipped" ? l.qtyNotShipped : c === "short" ? l.qtyShort : l.qtyAwaitingReplacement);
// What a line owes under the ticked conditions (0 = it doesn't show)
const pendingFor = (l: PendingLine, conds: Set<Cond>) => ALL_CONDS.reduce((s, c) => s + (conds.has(c) ? qtyOf(l, c) : 0), 0);

// Cost (only sent for a user with purchase-order:view-cost): the supplier PO's unit price × what's pending
const valueOf = (l: PendingLine, conds: Set<Cond>) => (l.unitCost ?? 0) * pendingFor(l, conds);
const fmtMoney = (n: number, currency: string | null) =>
  `${!currency || currency === "MYR" ? "RM" : currency} ${n.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
// a sum per currency, e.g. "RM 12,000.00 · USD 300.00"
function sumByCurrency(ls: PendingLine[], conds: Set<Cond>): string {
  const by = new Map<string, number>();
  for (const l of ls) if (l.unitCost !== null) by.set(l.currency ?? "MYR", (by.get(l.currency ?? "MYR") ?? 0) + valueOf(l, conds));
  if (by.size === 0) return fmtMoney(0, "MYR");
  return [...by].map(([c, v]) => fmtMoney(v, c)).join(" · ");
}

export function PendingFromSupplierClient({ lines, centralized = false }: { lines: PendingLine[]; centralized?: boolean }) {
  // the server sends cost prices only to someone allowed to see them
  const showCost = lines.some((l) => l.unitCost !== null);
  const [search, setSearch] = useState("");
  const [conds, setConds] = useState<Set<Cond>>(() => new Set(ALL_CONDS));
  const allConds = conds.size === ALL_CONDS.length;
  // Tick / untick one condition; unticking the last one goes back to all.
  const toggleCond = (c: Cond) => setConds((prev) => {
    const next = new Set(prev);
    if (next.has(c)) next.delete(c); else next.add(c);
    return next.size === 0 ? new Set(ALL_CONDS) : next;
  });
  const dim = (c: Cond) => (conds.has(c) ? "" : "opacity-40");
  const [orgFilter, setOrgFilter] = useState<string | null>(null);
  // One supplier (by name, so the same supplier is one choice across companies), or all
  const [supplierFilter, setSupplierFilter] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // The defect-photo viewer: the photos of one rejection, which one is showing, and a caption
  const [viewer, setViewer] = useState<{ photos: PendingPhoto[]; index: number; caption: string } | null>(null);
  const step = (d: number) => setViewer((v) => (v ? { ...v, index: (v.index + d + v.photos.length) % v.photos.length } : v));

  const base = centralized ? "/centralized" : "";
  const poHref = (id: string) => `/dashboard/procurement/purchase-order${base}/${id}`;
  const plHref = (id: string) => `/dashboard/procurement/packing-list${base}/${id}`;
  const grHref = (id: string) => `/dashboard/procurement/goods-receipt${base}/${id}`;

  const orgs = useMemo(() => [...new Set(lines.map((l) => l.organizationName ?? ""))].filter(Boolean).sort(), [lines]);

  // The suppliers to pick from, with what they owe under the chosen condition
  // (and company) — the selected one stays listed even if that drops to 0.
  const supplierOptions = useMemo(() => {
    const m = new Map<string, { lines: number; units: number }>();
    for (const l of lines) {
      if (pendingFor(l, conds) <= 0) continue;
      if (orgFilter && l.organizationName !== orgFilter) continue;
      const cur = m.get(l.supplierName) ?? { lines: 0, units: 0 };
      m.set(l.supplierName, { lines: cur.lines + 1, units: cur.units + pendingFor(l, conds) });
    }
    if (supplierFilter && !m.has(supplierFilter)) m.set(supplierFilter, { lines: 0, units: 0 });
    return [...m.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => a.name.localeCompare(b.name));
  }, [lines, conds, orgFilter, supplierFilter]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return lines.filter((l) => {
      if (pendingFor(l, conds) <= 0) return false;
      if (orgFilter && l.organizationName !== orgFilter) return false;
      if (supplierFilter && l.supplierName !== supplierFilter) return false;
      if (!q) return true;
      return [
        l.supplierName, l.poNo, l.productCode, l.description, l.customerPoNo, l.customerName, l.organizationName,
        ...l.shortPls.map((p) => p.packingListNo), ...l.returns.map((r) => r.grNo),
      ].some((v) => v?.toLowerCase().includes(q));
    });
  }, [lines, search, conds, orgFilter, supplierFilter]);

  const groups = useMemo(() => {
    const m = new Map<string, PendingLine[]>();
    for (const l of filtered) {
      const key = `${l.organizationId}|${l.supplierId ?? l.supplierName}`;
      m.set(key, [...(m.get(key) ?? []), l]);
    }
    return [...m.entries()]
      .map(([key, ls]) => ({ key, supplierName: ls[0].supplierName, organizationName: ls[0].organizationName, lines: ls, oldest: new Date(Math.min(...ls.map((l) => new Date(l.since).getTime()))) }))
      .sort((a, b) => a.oldest.getTime() - b.oldest.getTime());
  }, [filtered]);

  // The Supplier POs behind the lines shown (distinct, by number)
  const spos = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of filtered) m.set(l.purchaseOrderId, l.poNo ?? "(unnumbered)");
    return [...m.entries()].map(([id, no]) => ({ id, no })).sort((a, b) => a.no.localeCompare(b.no));
  }, [filtered]);
  const [showAllSpos, setShowAllSpos] = useState(false);
  const SPO_PREVIEW = 20;

  const totals = useMemo(() => ({
    notShipped: filtered.reduce((s, l) => s + l.qtyNotShipped, 0),
    short: filtered.reduce((s, l) => s + l.qtyShort, 0),
    replacement: filtered.reduce((s, l) => s + l.qtyAwaitingReplacement, 0),
  }), [filtered]);

  // The page as it's filtered now, as a PDF (built in the browser; loaded on first use)
  const [downloading, setDownloading] = useState(false);
  // What to print — asked in a dialog before each download
  type PdfShow = { customer: boolean; short: boolean; replacement: boolean; cost: boolean };
  const [pdfDialogOpen, setPdfDialogOpen] = useState(false);
  const [pdfShow, setPdfShow] = useState<PdfShow>({ customer: true, short: true, replacement: true, cost: false });
  function openPdfDialog() {
    // cost prices start off: the PDF is often sent outside the team
    setPdfShow({ customer: true, short: conds.has("short"), replacement: conds.has("replacement"), cost: false });
    setPdfDialogOpen(true);
  }
  async function downloadPdf(show: PdfShow) {
    setPdfDialogOpen(false);
    setDownloading(true);
    try {
      const { generatePendingFromSupplierPdf } = await import("./generate-pdf");
      // defect photos for the Awaiting replacement column (first 4 images per rejection), 4 at a time
      const photos = new Map<string, Uint8Array>();
      if (show.replacement) {
        const ids = [...new Set(filtered.flatMap((l) => l.returns.flatMap((r) => r.photos.filter((ph) => ph.kind === "image").slice(0, 4).map((ph) => ph.id))))];
        for (let i = 0; i < ids.length; i += 4) {
          const batch = ids.slice(i, i + 4);
          const got = await Promise.all(batch.map(photoForPdf));
          batch.forEach((id, j) => { if (got[j]) photos.set(id, got[j]!); });
        }
      }
      const ticked = ALL_CONDS.filter((c) => conds.has(c));
      const filters = [
        `Conditions: ${allConds ? "all" : ticked.map((c) => KIND_LABEL[c]).join(", ")}`,
        `Supplier: ${supplierFilter ?? "all"}`,
        ...(centralized ? [`Company: ${orgFilter ?? "all"}`] : []),
        ...(search.trim() ? [`Search: "${search.trim()}"`] : []),
      ].join("  ·  ");
      const bytes = await generatePendingFromSupplierPdf({
        title: "Pending from Supplier",
        companyLabel: centralized ? (orgFilter ?? "All companies") : (lines[0]?.organizationName ?? ""),
        filtersLabel: filters,
        conds: ticked,
        condLabel: KIND_LABEL,
        groups,
        showOrg: centralized,
        show,
        photos,
      });
      const slug = (supplierFilter ?? "all-suppliers").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `pending-from-supplier-${slug}-${new Date().toISOString().slice(0, 10)}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't make the PDF");
    } finally {
      setDownloading(false);
    }
  }

  const toggle = (key: string) => setCollapsed((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  return (
    <div className="p-6 space-y-5">
      <PageHeader
        title={centralized ? "Centralized Pending from Supplier" : "Pending from Supplier"}
        description="What suppliers still owe: items not shipped yet, short on a packing list, or rejected and awaiting replacement"
        action={
          <Button variant="outline" size="sm" className="gap-1.5" onClick={openPdfDialog} disabled={downloading || filtered.length === 0}>
            <DownloadIcon className="w-3.5 h-3.5" />
            {downloading ? "Preparing…" : "Download PDF"}
          </Button>
        }
      />

      {/* Totals — each tile also filters */}
      <div className={cn("grid grid-cols-2 gap-3", showCost ? "lg:grid-cols-5" : "lg:grid-cols-4")}>
        <button
          type="button"
          onClick={() => setConds(new Set(ALL_CONDS))}
          className={cn(
            "text-left rounded-xl border p-3 transition-colors",
            allConds ? "border-primary bg-primary/5" : "border-border hover:bg-muted/30",
          )}
          title="Show every condition"
        >
          <div className="text-[11px] font-medium text-muted-foreground">All conditions · suppliers</div>
          <div className="text-xl font-semibold tabular-nums">{groups.length}</div>
          <div className="text-[11px] text-muted-foreground">{filtered.length} line{filtered.length === 1 ? "" : "s"}</div>
        </button>
        {ALL_CONDS.map((c) => {
          const on = conds.has(c);
          return (
            <button
              key={c}
              type="button"
              role="checkbox"
              aria-checked={on}
              onClick={() => toggleCond(c)}
              className={cn(
                "text-left rounded-xl border p-3 transition-colors",
                on && !allConds ? "border-primary bg-primary/5" : on ? "border-border" : "border-dashed border-border opacity-60 hover:opacity-100",
              )}
              title={on ? "Click to leave this condition out" : "Click to include this condition"}
            >
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                <span className={cn("inline-flex h-3.5 w-3.5 items-center justify-center rounded-sm border text-[9px]", on ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/50")}>
                  {on ? "✓" : ""}
                </span>
                {KIND_LABEL[c]}
              </div>
              <div className="text-xl font-semibold tabular-nums">{fmtQty(totals[c])}</div>
              <div className="text-[11px] text-muted-foreground">units</div>
            </button>
          );
        })}
        {showCost && (
          <div className="rounded-xl border border-border p-3" title="What is pending, at the supplier PO's unit price (the conditions and filters chosen)">
            <div className="text-[11px] font-medium text-muted-foreground">Pending value</div>
            <div className="text-xl font-semibold tabular-nums">{sumByCurrency(filtered, conds)}</div>
            <div className="text-[11px] text-muted-foreground">at supplier PO cost</div>
          </div>
        )}
      </div>

      {/* Supplier POs involved in what's shown */}
      {spos.length > 0 && (
        <div className="rounded-xl border border-border p-3">
          <div className="mb-2 text-[11px] font-medium text-muted-foreground">
            Supplier POs involved: <span className="text-foreground font-semibold tabular-nums">{spos.length}</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(showAllSpos ? spos : spos.slice(0, SPO_PREVIEW)).map((p) => (
              <Link key={p.id} href={poHref(p.id)} className="rounded border border-border bg-muted/40 px-1.5 py-0.5 font-mono text-[11px] hover:bg-muted">
                {p.no}
              </Link>
            ))}
            {spos.length > SPO_PREVIEW && (
              <button type="button" onClick={() => setShowAllSpos((v) => !v)} className="px-1 text-[11px] text-primary hover:underline">
                {showAllSpos ? "Show fewer" : `Show all ${spos.length}`}
              </button>
            )}
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-56">
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search supplier, PO, packing list, GR, item, customer PO…"
            className="pl-9 h-9 text-sm"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-label="Clear search">
              <XIcon className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <Select value={supplierFilter ?? "__all__"} onValueChange={(v) => setSupplierFilter(v === "__all__" ? null : v)}>
          <SelectTrigger className="h-9 w-64 text-sm" aria-label="Supplier">
            <SelectValue placeholder="All suppliers" />
          </SelectTrigger>
          <SelectContent className="max-h-80">
            <SelectItem value="__all__" className="text-sm">All suppliers</SelectItem>
            {supplierOptions.map((o) => (
              <SelectItem key={o.name} value={o.name} className="text-sm">
                <span className="truncate">{o.name}</span>
                <span className="ml-2 text-[11px] text-muted-foreground tabular-nums">
                  {o.lines} line{o.lines === 1 ? "" : "s"} · {fmtQty(o.units)}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {supplierFilter && (
          <button
            type="button"
            onClick={() => setSupplierFilter(null)}
            className="text-[11px] text-muted-foreground hover:text-foreground underline underline-offset-2"
          >
            Clear supplier
          </button>
        )}
        {centralized && orgs.length > 1 && (
          <div className="flex items-center gap-1 flex-wrap">
            {[null, ...orgs].map((o) => (
              <button
                key={o ?? "all"}
                onClick={() => setOrgFilter(o)}
                className={cn(
                  "text-[11px] font-medium rounded-full px-2.5 py-1 border transition-colors",
                  orgFilter === o ? "bg-foreground text-background border-foreground" : "border-border text-muted-foreground hover:bg-muted/50",
                )}
              >
                {o ?? "All orgs"}
              </button>
            ))}
          </div>
        )}
      </div>

      {groups.length === 0 ? (
        <div className="border border-border rounded-xl py-16 text-center text-muted-foreground">
          <TruckIcon className="w-8 h-8 mx-auto mb-3 opacity-30" />
          <div className="text-sm font-medium mb-1">Nothing pending</div>
          <div className="text-xs">{lines.length === 0 ? "Suppliers have delivered everything ordered." : "No lines match your filters."}</div>
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map((g) => {
            const open = !collapsed.has(g.key);
            const units = g.lines.reduce((s, l) => s + pendingFor(l, conds), 0);
            return (
              <section key={g.key} className="border border-border rounded-xl overflow-hidden bg-background">
                <button
                  type="button"
                  onClick={() => toggle(g.key)}
                  className="w-full flex items-center gap-2 px-4 py-2.5 bg-muted/30 border-b border-border text-left"
                >
                  {open ? <ChevronDownIcon className="w-4 h-4 text-muted-foreground" /> : <ChevronRightIcon className="w-4 h-4 text-muted-foreground" />}
                  <span className="font-semibold text-sm"><Highlight text={g.supplierName} query={search} /></span>
                  {centralized && g.organizationName && (
                    <span className="text-[10px] font-medium text-indigo-700 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/20 rounded px-1.5 py-0.5">{g.organizationName}</span>
                  )}
                  <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                    {g.lines.length} line{g.lines.length === 1 ? "" : "s"} · {(() => { const n = new Set(g.lines.map((l) => l.purchaseOrderId)).size; return `${n} PO${n === 1 ? "" : "s"}`; })()} · {fmtQty(units)} units
                    {showCost && <> · <span className="font-medium text-foreground">{sumByCurrency(g.lines, conds)}</span></>}
                  </span>
                  <AgeBadge since={g.oldest} />
                </button>

                {open && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-border text-muted-foreground">
                          <th className="px-3 py-2 text-left font-medium">PO</th>
                          <th className="px-3 py-2 text-left font-medium min-w-56">Item</th>
                          <th className="px-3 py-2 text-right font-medium">Ordered</th>
                          {showCost && <th className="px-3 py-2 text-right font-medium">Unit cost</th>}
                          <th className={cn("px-3 py-2 text-right font-medium", dim("notShipped"))}>Not shipped</th>
                          <th className={cn("px-3 py-2 text-left font-medium", dim("short"))}>Short on packing list</th>
                          <th className={cn("px-3 py-2 text-left font-medium", dim("replacement"))}>Awaiting replacement</th>
                          <th className="px-3 py-2 text-right font-medium">Pending</th>
                          {showCost && <th className="px-3 py-2 text-right font-medium">Pending value</th>}
                          <th className="px-3 py-2 text-right font-medium">Age</th>
                        </tr>
                      </thead>
                      <tbody>
                        {g.lines.map((l) => (
                          <tr key={l.poItemId} className="border-b border-border/60 last:border-0 align-top">
                            <td className="px-3 py-2 font-mono whitespace-nowrap">
                              <Link href={poHref(l.purchaseOrderId)} className="text-primary hover:underline">
                                <Highlight text={l.poNo ?? "(unnumbered)"} query={search} />
                              </Link>
                              <div className="mt-0.5">
                                <span className="inline-block rounded bg-muted px-1.5 py-0.5 font-sans text-[10px] font-medium text-muted-foreground" title={`Line ${l.rowNo} of this PO`}>
                                  Line {l.rowNo}
                                </span>
                              </div>
                              <div className="text-[10px] text-muted-foreground font-sans">{fmtDate(l.poDate)}</div>
                            </td>
                            <td className="px-3 py-2">
                              {l.productCode && <div className="font-mono text-[11px]"><Highlight text={l.productCode} query={search} /></div>}
                              <div className="text-muted-foreground whitespace-normal">{l.description ? <Highlight text={l.description} query={search} /> : "—"}</div>
                              {(l.customerPoNo || l.customerName) && (
                                <div className="text-[10px] text-muted-foreground mt-0.5">
                                  for {l.customerName ?? ""}{l.customerPoNo ? <> · CPO <span className="font-mono">{l.customerPoNo}</span></> : null}
                                </div>
                              )}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">{fmtQty(l.qtyOrdered)} {l.uom ?? ""}</td>
                            {showCost && <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{l.unitCost !== null ? fmtMoney(l.unitCost, l.currency) : "—"}</td>}
                            <td className={cn("px-3 py-2 text-right tabular-nums", dim("notShipped"))}>{l.qtyNotShipped > 0 ? fmtQty(l.qtyNotShipped) : "—"}</td>
                            <td className={cn("px-3 py-2", dim("short"))}>
                              {l.shortPls.length === 0 ? "—" : (
                                <div className="space-y-1">
                                  {l.shortPls.map((p) => (
                                    <div key={p.packingListId}>
                                      <div className="font-medium text-amber-700 dark:text-amber-400 whitespace-nowrap">
                                        Short by {fmtQty(p.pending)} {unitOf(l)}
                                      </div>
                                      <div className="flex items-center gap-1.5 whitespace-nowrap text-[10px] text-muted-foreground">
                                        <span>on</span>
                                        <Link href={plHref(p.packingListId)} className="font-mono text-primary hover:underline">
                                          <Highlight text={p.packingListNo} query={search} />
                                        </Link>
                                        <span>· {p.received === 0 && p.plStatus === "pending" ? "awaiting receipt" : `${fmtQty(p.received)}/${fmtQty(p.expected)} received`}</span>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </td>
                            <td className={cn("px-3 py-2", dim("replacement"))}>
                              {l.returns.length === 0 ? "—" : (
                                <div className="space-y-2">
                                  {l.returns.map((r) => (
                                    <div key={r.goodsReceiptId + r.grNo}>
                                      <div className="font-medium text-red-700 dark:text-red-400 whitespace-nowrap">
                                        Awaiting replacement: {fmtQty(r.outstanding)} {unitOf(l)}
                                      </div>
                                      <div className="flex items-center gap-1.5 whitespace-nowrap text-[10px] text-muted-foreground">
                                        <span>rejected on</span>
                                        <Link href={grHref(r.goodsReceiptId)} className="font-mono text-primary hover:underline">
                                          <Highlight text={r.grNo} query={search} />
                                        </Link>
                                        {r.packingListNo && <span>({r.packingListNo})</span>}
                                        <span>· {r.shippedAt ? `sent back ${fmtDate(r.shippedAt)}` : "not sent back yet"}</span>
                                      </div>
                                      {r.photos.length > 0 && (
                                        <div className="mt-1 flex flex-wrap gap-1">
                                          {r.photos.slice(0, 6).map((ph, pi) => (
                                            <button
                                              key={ph.id}
                                              type="button"
                                              onClick={() => setViewer({ photos: r.photos, index: pi, caption: `${r.grNo}${r.packingListNo ? ` · ${r.packingListNo}` : ""} · ${l.productCode ?? ""} ${l.description ?? ""}`.trim() })}
                                              title={ph.kind === "video" ? "Play video" : "View photo"}
                                              className="block h-12 w-12 overflow-hidden rounded border border-border hover:opacity-80 transition-opacity"
                                            >
                                              <InspectionMediaThumb media={ph} />
                                            </button>
                                          ))}
                                          {r.photos.length > 6 && (
                                            <button
                                              type="button"
                                              onClick={() => setViewer({ photos: r.photos, index: 6, caption: `${r.grNo}${r.packingListNo ? ` · ${r.packingListNo}` : ""} · ${l.productCode ?? ""} ${l.description ?? ""}`.trim() })}
                                              className="flex h-12 w-12 items-center justify-center rounded border border-border bg-muted text-[11px] text-muted-foreground hover:bg-muted/70"
                                              title="View all"
                                            >
                                              +{r.photos.length - 6}
                                            </button>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums font-semibold">{fmtQty(pendingFor(l, conds))}</td>
                            {showCost && <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{fmtMoney(valueOf(l, conds), l.currency)}</td>}
                            <td className="px-3 py-2 text-right"><AgeBadge since={l.since} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      <Dialog open={pdfDialogOpen} onOpenChange={setPdfDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Download PDF</DialogTitle>
            <DialogDescription>
              {filtered.length} line{filtered.length === 1 ? "" : "s"} from {groups.length} supplier{groups.length === 1 ? "" : "s"}, as filtered on the page (the lines and totals follow the cards you selected). Untick what you don&apos;t want shown:
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            {([
              ["customer", "Customer name & customer organization name", "Under each item, with its customer PO no."],
              ["short", "Short on packing list", "Which packing lists are short, and by how much"],
              ["replacement", "Awaiting replacement", "Which goods receipts' rejected units are still not replaced, with their defect photos"],
              // only for someone allowed to see costs (the server sends them only then)
              ...(showCost ? [["cost", "Cost prices", "Each line's unit cost from its supplier PO, its pending value, and the totals. Leave off if the PDF goes to anyone who shouldn't see what you pay."]] : []),
            ] as [keyof PdfShow, string, string][]).map(([key, label, hint]) => (
              <label key={key} className="flex items-start gap-3 cursor-pointer">
                <Checkbox
                  checked={pdfShow[key]}
                  onCheckedChange={(v) => setPdfShow((prev) => ({ ...prev, [key]: v === true }))}
                  className="mt-0.5"
                />
                <span>
                  <span className="block text-sm font-medium">{label}</span>
                  <span className="block text-xs text-muted-foreground">{hint}</span>
                </span>
              </label>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPdfDialogOpen(false)}>Cancel</Button>
            <Button className="gap-1.5" onClick={() => downloadPdf(pdfShow)}>
              <DownloadIcon className="w-3.5 h-3.5" /> Download
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Defect photo / video viewer */}
      <Dialog open={!!viewer} onOpenChange={(o) => !o && setViewer(null)}>
        <DialogContent
          className="sm:max-w-5xl p-0 overflow-hidden gap-0"
          showCloseButton={false}
          onKeyDown={(e) => {
            if (!viewer || viewer.photos.length < 2) return;
            if (e.key === "ArrowLeft") { e.preventDefault(); step(-1); }
            if (e.key === "ArrowRight") { e.preventDefault(); step(1); }
          }}
        >
          <DialogTitle className="sr-only">Defect {viewer?.photos[viewer.index]?.kind === "video" ? "video" : "photo"}</DialogTitle>
          {viewer && (() => {
            const cur = viewer.photos[viewer.index];
            return (
              <>
                <div className="relative flex items-center justify-center bg-black">
                  {cur.kind === "video" ? (
                    <video key={cur.url} src={cur.url} controls autoPlay playsInline className="max-h-[75vh] w-full bg-black">
                      Your browser can&apos;t play this video. <a href={cur.url} target="_blank" rel="noopener noreferrer">Open it</a> instead.
                    </video>
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element -- signed storage link
                    <img key={cur.url} src={cur.url} alt="Defect photo" className="max-h-[75vh] w-full object-contain" />
                  )}
                  <button
                    type="button"
                    onClick={() => setViewer(null)}
                    aria-label="Close"
                    className="absolute top-2 right-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
                  >
                    <XIcon className="h-4 w-4" />
                  </button>
                  {viewer.photos.length > 1 && (
                    <>
                      <button type="button" onClick={() => step(-1)} aria-label="Previous"
                        className="absolute left-2 top-1/2 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80">
                        <ChevronLeftIcon className="h-5 w-5" />
                      </button>
                      <button type="button" onClick={() => step(1)} aria-label="Next"
                        className="absolute right-2 top-1/2 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80">
                        <ChevronRightIcon className="h-5 w-5" />
                      </button>
                    </>
                  )}
                </div>
                <div className="flex items-center gap-3 border-t px-4 py-2.5">
                  <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                    {viewer.photos.length > 1 && <span className="mr-2 font-medium text-foreground tabular-nums">{viewer.index + 1} of {viewer.photos.length}</span>}
                    {viewer.caption}
                  </p>
                  <a href={cur.url} target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center gap-1 text-xs text-blue-600 hover:underline dark:text-blue-400">
                    <ExternalLinkIcon className="h-3 w-3" /> Open original
                  </a>
                  <DownloadMediaButton photoId={cur.id} />
                </div>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
