"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Input } from "@/components/ui/input";
import {
  SearchIcon,
  Loader2Icon,
  XIcon,
  ClipboardListIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  PackageIcon,
  BuildingIcon,
  CheckCircle2Icon,
  AlertCircleIcon,
  CircleIcon,
  InfoIcon,
  AlertTriangleIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  searchPurchaseOrdersForTracking,
  getPoForTracking,
  getItemTrace,
  type TrackPoHit,
  type TrackPo,
  type ItemTrace,
  type TraceEvent,
} from "@/server/item-tracking";

const fmtDate = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const fmtTime = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleTimeString("en-MY", { hour: "2-digit", minute: "2-digit" }) : "";

const TONE: Record<TraceEvent["tone"], { dot: string; card: string; Icon: typeof CircleIcon }> = {
  neutral: { dot: "bg-muted text-muted-foreground border-border", card: "", Icon: CircleIcon },
  info: { dot: "bg-blue-50 text-blue-600 border-blue-200 dark:bg-blue-950/50 dark:text-blue-400 dark:border-blue-800", card: "", Icon: InfoIcon },
  good: { dot: "bg-green-50 text-green-600 border-green-200 dark:bg-green-950/50 dark:text-green-400 dark:border-green-800", card: "", Icon: CheckCircle2Icon },
  bad: { dot: "bg-red-50 text-red-600 border-red-200 dark:bg-red-950/50 dark:text-red-400 dark:border-red-800", card: "border-red-200/70 dark:border-red-900/60", Icon: AlertCircleIcon },
  warn: { dot: "bg-amber-50 text-amber-600 border-amber-200 dark:bg-amber-950/50 dark:text-amber-400 dark:border-amber-800", card: "border-amber-200/70 dark:border-amber-900/60", Icon: AlertTriangleIcon },
};

const refHref = (r: NonNullable<TraceEvent["ref"]>) =>
  r.kind === "packing-list"
    ? `/dashboard/procurement/packing-list/centralized/${r.id}`
    : `/dashboard/procurement/goods-receipt/centralized/${r.id}`;

const STATUS_CHIP: Record<string, string> = {
  confirmed: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800",
  fulfilled: "bg-green-50 text-green-700 border-green-200 dark:bg-green-950/40 dark:text-green-400 dark:border-green-800",
  cancelled: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-400 dark:border-red-800",
};
const statusChip = (s: string) =>
  STATUS_CHIP[s] ?? "bg-muted text-muted-foreground border-border";

function Chip({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center text-[10px] px-1.5 py-0.5 rounded-md border font-medium capitalize", className)}>
      {children}
    </span>
  );
}

function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div className="rounded-lg border bg-muted/20 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("text-lg font-semibold tabular-nums leading-tight", tone)}>{value}</p>
    </div>
  );
}

export function ItemTrackingClient() {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<TrackPoHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const [po, setPo] = useState<TrackPo | null>(null);
  const [trace, setTrace] = useState<ItemTrace | null>(null);
  const [loadingPo, setLoadingPo] = useState(false);
  const [loadingTrace, setLoadingTrace] = useState(false);
  const [lineFilter, setLineFilter] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);

  // Debounced PO number search
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setHits([]); return; }
    setSearching(true);
    const t = setTimeout(() => {
      searchPurchaseOrdersForTracking(q)
        .then((r) => { setHits(r); setOpen(true); })
        .catch((e) => toast.error(e instanceof Error ? e.message : "Search failed"))
        .finally(() => setSearching(false));
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  async function pickPo(hit: TrackPoHit) {
    setLoadingPo(true);
    setTrace(null);
    setLineFilter("");
    try {
      setPo(await getPoForTracking(hit.id));
      setHits([]);
      setOpen(false);
      setQuery(hit.poNo ?? hit.prNo ?? "");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't load this PO");
    } finally {
      setLoadingPo(false);
    }
  }

  async function pickLine(lineId: string) {
    setLoadingTrace(true);
    try {
      setTrace(await getItemTrace(lineId));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't load this line");
    } finally {
      setLoadingTrace(false);
    }
  }

  function clearAll() {
    setQuery(""); setHits([]); setPo(null); setTrace(null); setLineFilter("");
  }

  const lines = useMemo(() => {
    if (!po) return [];
    const f = lineFilter.trim().toLowerCase();
    if (!f) return po.lines;
    return po.lines.filter((l) =>
      `${l.rowNo} ${l.productCode ?? ""} ${l.description ?? ""}`.toLowerCase().includes(f),
    );
  }, [po, lineFilter]);

  const s = trace?.summary;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Item Tracking"
        description="Follow one PO line from the order to its latest packing list — every inspection, return, repair and replacement along the way"
      />

      {/* Search */}
      <div ref={boxRef} className="relative max-w-xl">
        <SearchIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => hits.length > 0 && setOpen(true)}
          placeholder="Search by PO number, e.g. PO/066-26"
          className="pl-9 pr-9 h-10 text-sm"
        />
        {searching ? (
          <Loader2Icon className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-muted-foreground" />
        ) : query ? (
          <button type="button" onClick={clearAll} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" title="Clear">
            <XIcon className="w-4 h-4" />
          </button>
        ) : null}
        {open && query.trim().length >= 2 && !searching && (
          <div className="absolute z-20 mt-1.5 w-full border rounded-lg bg-background shadow-lg max-h-80 overflow-auto">
            {hits.length === 0 ? (
              <p className="px-3 py-3 text-sm text-muted-foreground">No purchase order matches “{query.trim()}”.</p>
            ) : hits.map((h) => (
              <button key={h.id} type="button" onClick={() => pickPo(h)} className="w-full text-left px-3 py-2.5 hover:bg-muted/60 border-b last:border-0 flex items-center gap-3">
                <span className="min-w-0 flex-1">
                  <span className="block font-mono text-sm font-medium">{h.poNo ?? h.prNo}</span>
                  <span className="block text-xs text-muted-foreground truncate">{h.supplierName ?? "—"} · {h.organizationName ?? "—"}</span>
                </span>
                <Chip className={statusChip(h.status)}>{h.status}</Chip>
              </button>
            ))}
          </div>
        )}
      </div>

      {loadingPo && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2Icon className="w-4 h-4 animate-spin" /> Loading purchase order…
        </div>
      )}

      {/* Empty state */}
      {!po && !loadingPo && (
        <div className="rounded-xl border border-dashed py-16 px-6 text-center">
          <div className="mx-auto w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
            <ClipboardListIcon className="w-6 h-6 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium">Find a purchase order to start</p>
          <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
            Type a PO number above, pick a line, and you’ll see its full journey — packing lists, inspections, returns and replacements.
          </p>
        </div>
      )}

      {po && (
        <div className="space-y-4">
          {/* PO header */}
          <div className="rounded-xl border bg-muted/20 px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
            <span className="font-mono text-base font-semibold">{po.poNo ?? po.prNo}</span>
            <Chip className={statusChip(po.status)}>{po.status}</Chip>
            <span className="text-xs text-muted-foreground flex items-center gap-1.5">
              <PackageIcon className="w-3.5 h-3.5" />{po.supplierName ?? "—"}
            </span>
            <span className="text-xs text-muted-foreground flex items-center gap-1.5">
              <BuildingIcon className="w-3.5 h-3.5" />{po.organizationName ?? "—"}
            </span>
            <span className="text-xs text-muted-foreground ml-auto">{po.lines.length} line{po.lines.length === 1 ? "" : "s"}</span>
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] items-start">
            {/* Lines */}
            <section className="rounded-xl border overflow-hidden">
              <div className="px-3 py-2 border-b bg-muted/30 flex items-center gap-2">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Lines</h2>
                <div className="relative ml-auto w-44">
                  <SearchIcon className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input value={lineFilter} onChange={(e) => setLineFilter(e.target.value)} placeholder="Filter lines" className="h-7 pl-7 text-xs" />
                </div>
              </div>
              <div className="max-h-[70vh] overflow-auto divide-y">
                {lines.length === 0 && <p className="px-3 py-6 text-center text-xs text-muted-foreground">No lines match.</p>}
                {lines.map((l) => {
                  const selected = trace?.line.id === l.id;
                  const pct = l.qtyOrdered > 0 ? Math.min(100, Math.round((l.qtyAccepted / l.qtyOrdered) * 100)) : 0;
                  const complete = l.qtyOrdered > 0 && l.qtyAccepted >= l.qtyOrdered;
                  return (
                    <button
                      key={l.id}
                      type="button"
                      onClick={() => pickLine(l.id)}
                      className={cn(
                        "w-full text-left px-3 py-2.5 text-xs flex items-start gap-3 hover:bg-muted/50 border-l-2 transition-colors",
                        selected ? "bg-blue-50/70 dark:bg-blue-950/30 border-l-blue-500" : "border-l-transparent",
                      )}
                    >
                      <span className="w-6 h-6 shrink-0 rounded-md bg-muted text-[10px] font-medium text-muted-foreground flex items-center justify-center">{l.rowNo}</span>
                      <span className="min-w-0 flex-1 space-y-1.5">
                        <span className="block">
                          <span className="font-mono text-[13px] font-medium text-foreground">{l.productCode ?? "—"}</span>
                          <span className="block text-muted-foreground line-clamp-2 leading-snug">{l.description}</span>
                        </span>
                        <span className="flex items-center gap-2">
                          <span className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
                            <span className={cn("block h-full rounded-full", complete ? "bg-green-500" : "bg-blue-500")} style={{ width: `${pct}%` }} />
                          </span>
                          <span className="tabular-nums text-muted-foreground whitespace-nowrap">
                            {l.qtyAccepted}/{l.qtyOrdered} {l.uom ?? ""}
                          </span>
                        </span>
                        <span className="flex flex-wrap gap-1">
                          {l.qtyPendingReturn > 0 && (
                            <Chip className="bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-400 dark:border-red-800">{l.qtyPendingReturn} to return</Chip>
                          )}
                          <Chip className="bg-muted text-muted-foreground border-border normal-case">{l.packingListCount} PL</Chip>
                        </span>
                      </span>
                      <ChevronRightIcon className={cn("w-4 h-4 mt-1 shrink-0", selected ? "text-blue-500" : "text-muted-foreground/40")} />
                    </button>
                  );
                })}
              </div>
            </section>

            {/* Trace */}
            <section className="rounded-xl border min-h-48 lg:sticky lg:top-4">
              {loadingTrace && (
                <div className="p-6 flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2Icon className="w-4 h-4 animate-spin" /> Loading history…
                </div>
              )}
              {!trace && !loadingTrace && (
                <div className="p-10 text-center">
                  <p className="text-sm font-medium">Pick a line</p>
                  <p className="text-xs text-muted-foreground mt-1">Its history will appear here.</p>
                </div>
              )}
              {trace && s && !loadingTrace && (
                <div className="max-h-[78vh] overflow-auto">
                  <div className="p-4 border-b space-y-4">
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Line {trace.line.rowNo} of {trace.po.poNo ?? trace.po.prNo}</p>
                      <p className="font-mono text-base font-semibold">{trace.line.productCode ?? "—"}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{trace.line.description}</p>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <Stat label="Ordered" value={s.ordered} />
                      <Stat label="Accepted" value={s.accepted} tone="text-green-700 dark:text-green-400" />
                      <Stat label="Still to pack" value={s.stillToPack} />
                      {s.pendingReturn > 0 && <Stat label="To return" value={s.pendingReturn} tone="text-red-600 dark:text-red-400" />}
                      {s.pendingRepair > 0 && <Stat label="In repair" value={s.pendingRepair} tone="text-orange-600 dark:text-orange-400" />}
                      {s.reservedOnPendingPls > 0 && <Stat label="On pending PL" value={s.reservedOnPendingPls} />}
                      {s.surplus > 0 && <Stat label="Surplus" value={`+${s.surplus}`} tone="text-sky-700 dark:text-sky-400" />}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      {s.finalPackingList ? (
                        <Link
                          href={`/dashboard/procurement/packing-list/centralized/${s.finalPackingList.id}`}
                          className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 hover:bg-muted/60"
                        >
                          <span className="text-muted-foreground">Latest packing list</span>
                          <span className="font-mono font-medium">{s.finalPackingList.no}</span>
                          <Chip className={statusChip(s.finalPackingList.status)}>{s.finalPackingList.status}</Chip>
                          <ExternalLinkIcon className="w-3 h-3 text-muted-foreground" />
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">Not on any packing list yet.</span>
                      )}
                      {s.shortfallClosed && (
                        <Chip className="bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800 normal-case">
                          Shortfall {s.shortfallClosed === "written_off" ? "written off" : "closed"}
                        </Chip>
                      )}
                    </div>
                  </div>

                  {/* Timeline */}
                  <ol className="p-4">
                    {trace.events.map((e, i) => {
                      const t = TONE[e.tone];
                      const last = i === trace.events.length - 1;
                      return (
                        <li key={i} className="relative flex gap-3 pb-4 last:pb-0">
                          {!last && <span className="absolute left-[13px] top-7 bottom-0 w-px bg-border" />}
                          <span className={cn("relative z-[1] w-7 h-7 shrink-0 rounded-full border flex items-center justify-center", t.dot)}>
                            <t.Icon className="w-3.5 h-3.5" />
                          </span>
                          <div className={cn("min-w-0 flex-1 rounded-lg border px-3 py-2 text-xs", t.card)}>
                            <div className="flex items-start justify-between gap-3">
                              <p className="font-medium text-[13px] leading-snug">{e.title}</p>
                              <span className="text-[10px] text-muted-foreground whitespace-nowrap text-right leading-tight">
                                {fmtDate(e.at)}
                                <span className="block">{fmtTime(e.at)}</span>
                              </span>
                            </div>
                            {e.detail && <p className="text-muted-foreground mt-1 leading-snug">{e.detail}</p>}
                            {e.ref && (
                              <Link
                                href={refHref(e.ref)}
                                className="mt-1.5 inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline"
                              >
                                Open {e.ref.no} <ExternalLinkIcon className="w-3 h-3" />
                              </Link>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                </div>
              )}
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
