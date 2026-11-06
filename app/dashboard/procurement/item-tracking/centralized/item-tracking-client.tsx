"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Input } from "@/components/ui/input";
import { SearchIcon, Loader2Icon } from "lucide-react";
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

const fmtDateTime = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleString("en-MY", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

const TONE_DOT: Record<TraceEvent["tone"], string> = {
  neutral: "bg-muted-foreground/60",
  info: "bg-blue-500",
  good: "bg-green-500",
  bad: "bg-red-500",
  warn: "bg-amber-500",
};

const refHref = (r: NonNullable<TraceEvent["ref"]>) =>
  r.kind === "packing-list"
    ? `/dashboard/procurement/packing-list/centralized/${r.id}`
    : `/dashboard/procurement/goods-receipt/centralized/${r.id}`;

export function ItemTrackingClient() {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<TrackPoHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [po, setPo] = useState<TrackPo | null>(null);
  const [trace, setTrace] = useState<ItemTrace | null>(null);
  const [loadingPo, setLoadingPo] = useState(false);
  const [loadingTrace, setLoadingTrace] = useState(false);

  // Debounced PO number search
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setHits([]); return; }
    setSearching(true);
    const t = setTimeout(() => {
      searchPurchaseOrdersForTracking(q)
        .then(setHits)
        .catch((e) => toast.error(e instanceof Error ? e.message : "Search failed"))
        .finally(() => setSearching(false));
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  async function pickPo(hit: TrackPoHit) {
    setLoadingPo(true);
    setTrace(null);
    try {
      setPo(await getPoForTracking(hit.id));
      setHits([]);
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

  const s = trace?.summary;
  const stat = (label: string, value: React.ReactNode, tone?: string) => (
    <div className="border rounded-md px-3 py-2 min-w-24">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("text-base font-semibold tabular-nums", tone)}>{value}</p>
    </div>
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Item Tracking"
        description="Follow one PO line from the order to its latest packing list — every inspection, return, repair and replacement along the way"
      />

      <div className="relative max-w-md">
        <SearchIcon className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Type a PO number, e.g. PO/066-26" className="pl-8 h-9 text-sm" />
        {searching && <Loader2Icon className="w-3.5 h-3.5 absolute right-2.5 top-1/2 -translate-y-1/2 animate-spin text-muted-foreground" />}
        {hits.length > 0 && (
          <div className="absolute z-10 mt-1 w-full border rounded-md bg-background shadow-md max-h-72 overflow-auto">
            {hits.map((h) => (
              <button key={h.id} type="button" onClick={() => pickPo(h)} className="w-full text-left px-3 py-2 text-sm hover:bg-muted/60 border-b last:border-0">
                <span className="font-mono">{h.poNo ?? h.prNo}</span>
                <span className="text-xs text-muted-foreground ml-2">{h.supplierName ?? "—"} · {h.organizationName ?? "—"} · {h.status}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {loadingPo && <p className="text-sm text-muted-foreground">Loading…</p>}

      {po && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] items-start">
          <section className="border rounded-lg overflow-hidden">
            <div className="px-3 py-2 bg-muted/50 text-sm flex flex-wrap items-center gap-x-3">
              <span className="font-mono font-medium">{po.poNo ?? po.prNo}</span>
              <span className="text-xs text-muted-foreground">{po.supplierName ?? "—"} · {po.organizationName ?? "—"} · {po.status}</span>
            </div>
            <div className="max-h-[70vh] overflow-auto divide-y">
              {po.lines.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => pickLine(l.id)}
                  className={cn("w-full text-left px-3 py-2 text-xs grid grid-cols-[2rem_minmax(0,1fr)_auto] gap-x-3 items-start hover:bg-muted/50", trace?.line.id === l.id && "bg-blue-50 dark:bg-blue-950/30")}
                >
                  <span className="text-muted-foreground">{l.rowNo}</span>
                  <span className="min-w-0">
                    <span className="font-mono text-foreground">{l.productCode ?? "—"}</span>
                    <span className="block text-muted-foreground line-clamp-2">{l.description}</span>
                  </span>
                  <span className="text-right tabular-nums text-muted-foreground">
                    <span className="block">{l.qtyAccepted}/{l.qtyOrdered} {l.uom ?? ""}</span>
                    {l.qtyPendingReturn > 0 && <span className="block text-red-600 dark:text-red-400">{l.qtyPendingReturn} to return</span>}
                    <span className="block">{l.packingListCount} PL</span>
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section className="border rounded-lg p-3 space-y-3 min-h-40">
            {loadingTrace && <p className="text-sm text-muted-foreground">Loading…</p>}
            {!trace && !loadingTrace && <p className="text-sm text-muted-foreground">Pick a line to see its history.</p>}
            {trace && s && !loadingTrace && (
              <>
                <div>
                  <p className="text-sm">
                    <span className="font-mono font-medium">{trace.line.productCode ?? "—"}</span>
                    <span className="text-muted-foreground"> · line {trace.line.rowNo} of {trace.po.poNo ?? trace.po.prNo}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">{trace.line.description}</p>
                </div>

                <div className="flex flex-wrap gap-2">
                  {stat("Ordered", s.ordered)}
                  {stat("Accepted", s.accepted, "text-green-700 dark:text-green-400")}
                  {s.pendingReturn > 0 && stat("To return", s.pendingReturn, "text-red-600 dark:text-red-400")}
                  {s.pendingRepair > 0 && stat("In repair", s.pendingRepair, "text-orange-600 dark:text-orange-400")}
                  {s.reservedOnPendingPls > 0 && stat("On pending PL", s.reservedOnPendingPls)}
                  {stat("Still to pack", s.stillToPack)}
                  {s.surplus > 0 && stat("Surplus", `+${s.surplus}`, "text-sky-700 dark:text-sky-400")}
                </div>

                <p className="text-xs text-muted-foreground">
                  {s.finalPackingList ? (
                    <>
                      Latest packing list:{" "}
                      <Link className="underline" href={`/dashboard/procurement/packing-list/centralized/${s.finalPackingList.id}`}>{s.finalPackingList.no}</Link>
                      {" "}({s.finalPackingList.status})
                    </>
                  ) : "Not on any packing list yet."}
                  {s.shortfallClosed && <> · Shortfall {s.shortfallClosed === "written_off" ? "written off" : "closed"}</>}
                </p>

                <ol className="ml-1 border-l pl-4 space-y-2.5 text-xs">
                  {trace.events.map((e, i) => (
                    <li key={i} className="relative">
                      <span className={cn("absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full", TONE_DOT[e.tone])} />
                      <p className="text-[10px] text-muted-foreground">{fmtDateTime(e.at)}</p>
                      <p>
                        {e.title}
                        {e.ref && (
                          <> · <Link className="underline text-blue-600 dark:text-blue-400" href={refHref(e.ref)}>open {e.ref.no}</Link></>
                        )}
                      </p>
                      {e.detail && <p className="text-muted-foreground">{e.detail}</p>}
                    </li>
                  ))}
                </ol>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
