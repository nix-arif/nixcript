"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { getPackingListsCentralized, type CentralizedPackingList, type PackingListAcceptance } from "@/server/packing-list";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/page-header";
import { Highlight } from "@/components/highlight";
import {
  SearchIcon, XIcon, ClipboardCheckIcon, BuildingIcon, CalendarIcon,
  PackageIcon, RefreshCwIcon, LayersIcon, EyeIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { LotNumbersExcelButton } from "@/components/lot-numbers-excel-button";

const fmtDate = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const STATUS: Record<string, { label: string; className: string }> = {
  pending:   { label: "Pending Inspection", className: "bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400" },
  completed: { label: "Completed",          className: "bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400" },
  cancelled: { label: "Cancelled",          className: "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400" },
};

const q = (v: number) => String(Math.round(v * 1000) / 1000);
const pctOf = (a: PackingListAcceptance) => (a.received > 0 ? (a.accepted / a.received) * 100 : null);
// 100% shows as 100 only when nothing at all was rejected
const fmtPct = (p: number) => (p >= 100 ? "100" : p >= 99.95 ? "99.9" : p.toFixed(p < 10 ? 1 : 0));
const tone = (p: number) =>
  p >= 100 ? { text: "text-green-700 dark:text-green-400", bar: "bg-green-500" }
  : p >= 90 ? { text: "text-amber-700 dark:text-amber-400", bar: "bg-amber-500" }
  : { text: "text-red-600 dark:text-red-400", bar: "bg-red-500" };

// Share of received units accepted on one packing list
function AcceptanceGauge({ a, status }: { a: PackingListAcceptance | null; status: string }) {
  if (!a) return <div className="w-28 shrink-0 text-right text-[10px] text-muted-foreground">{status === "cancelled" ? "—" : "Not inspected yet"}</div>;
  const p = pctOf(a);
  if (p === null) return <div className="w-28 shrink-0 text-right text-[10px] text-muted-foreground">Nothing received</div>;
  const t = tone(p);
  const title = [
    `Accepted ${q(a.accepted)} of ${q(a.received)} received`,
    a.returned > 0 ? `${q(a.returned)} rejected` : null,
    a.received < a.expected ? `${q(a.expected - a.received)} short of ${q(a.expected)} expected` : null,
    a.partial ? `inspection in progress — ${a.linesCounted} of ${a.linesTotal} lines inspected so far` : null,
  ].filter(Boolean).join(" · ");
  return (
    <div className="w-28 shrink-0 text-right" title={title}>
      <div className="flex items-baseline justify-end gap-1">
        <span className={cn("text-base font-semibold tabular-nums leading-none", t.text)}>{fmtPct(p)}%</span>
        <span className="text-[10px] text-muted-foreground">{a.partial ? "so far" : "accepted"}</span>
      </div>
      <div className="mt-1 h-1 rounded-full bg-muted overflow-hidden">
        <div className={cn("h-full rounded-full", t.bar, a.partial && "opacity-60")} style={{ width: `${Math.min(100, p)}%` }} />
      </div>
      <div className="mt-0.5 text-[10px] text-muted-foreground tabular-nums">
        {a.partial ? `${a.linesCounted}/${a.linesTotal} lines` : `${q(a.accepted)}/${q(a.received)}`}
        {a.returned > 0 && <span className="text-red-600 dark:text-red-400"> · {q(a.returned)} rej.</span>}
      </div>
    </div>
  );
}

interface Props {
  initialLists: CentralizedPackingList[];
}

export function CentralizedPackingListClient({ initialLists }: Props) {
  const router = useRouter();
  const [lists, setLists] = useState(initialLists);
  // Server data re-sent (live refresh / router.refresh): show it
  const [seenInitialLists, setSeenInitialLists] = useState(initialLists);
  if (initialLists !== seenInitialLists) { setSeenInitialLists(initialLists); setLists(initialLists); }
  const [search, setSearch] = useState("");
  const [orgFilter, setOrgFilter] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const orgs = [...new Set(lists.map((p) => p.organizationName))].sort();

  const filtered = lists.filter((p) => {
    if (orgFilter && p.organizationName !== orgFilter) return false;
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      p.packingListNo.toLowerCase().includes(s) ||
      (p.supplierRefNo ?? "").toLowerCase().includes(s) ||
      (p.supplierName ?? "").toLowerCase().includes(s) ||
      p.organizationName.toLowerCase().includes(s)
    );
  });

  // Overall acceptance across the completed packing lists in view
  const overall = filtered.reduce(
    (t, p) => (p.acceptance && !p.acceptance.partial ? { received: t.received + p.acceptance.received, accepted: t.accepted + p.acceptance.accepted, count: t.count + 1 } : t),
    { received: 0, accepted: 0, count: 0 },
  );
  const overallPct = overall.received > 0 ? (overall.accepted / overall.received) * 100 : null;

  async function handleRefresh() {
    setRefreshing(true);
    try {
      setLists(await getPackingListsCentralized());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to refresh");
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="p-6">
      <PageHeader
        title="Centralized Packing Lists"
        description="Every packing list recorded across all organizations under the same owner"
        action={
          <div className="flex items-center gap-2">
            <LotNumbersExcelButton centralized fileName="Lot numbers (all companies)" label="Lot Numbers (Excel)" />
            <Button variant="outline" size="sm" className="gap-1.5" onClick={handleRefresh} disabled={refreshing}>
              <RefreshCwIcon className={cn("w-3.5 h-3.5", refreshing && "animate-spin")} />
              Refresh
            </Button>
          </div>
        }
      />

      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by packing list no., supplier ref, supplier, organization…"
            className="pl-9 h-9 text-sm"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
              <XIcon className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {orgs.length > 1 && (
          <div className="flex items-center gap-1 flex-wrap">
            <button
              onClick={() => setOrgFilter(null)}
              className={cn(
                "text-[11px] font-medium rounded-full px-2.5 py-1 border transition-colors",
                orgFilter === null ? "bg-foreground text-background border-foreground" : "border-border text-muted-foreground hover:bg-muted/50",
              )}
            >
              All orgs
            </button>
            {orgs.map((org) => (
              <button
                key={org}
                onClick={() => setOrgFilter(org)}
                className={cn(
                  "text-[11px] font-medium rounded-full px-2.5 py-1 border transition-colors",
                  orgFilter === org ? "bg-foreground text-background border-foreground" : "border-border text-muted-foreground hover:bg-muted/50",
                )}
              >
                {org}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="text-xs text-muted-foreground mb-3 tabular-nums flex flex-wrap items-center gap-x-3 gap-y-1">
        <span>{filtered.length} record{filtered.length !== 1 ? "s" : ""}</span>
        {overallPct !== null && (
          <span title={`Accepted ${q(overall.accepted)} of ${q(overall.received)} units received on ${overall.count} completed packing list${overall.count !== 1 ? "s" : ""}`}>
            Overall acceptance{" "}
            <span className={cn("font-semibold", tone(overallPct).text)}>{fmtPct(overallPct)}%</span>
            <span> across {overall.count} completed</span>
          </span>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="border border-border rounded-xl py-16 text-center text-muted-foreground">
          <LayersIcon className="w-8 h-8 mx-auto mb-3 opacity-30" />
          <div className="text-sm font-medium mb-1">No packing lists found</div>
          <div className="text-xs">
            {lists.length === 0 ? "No packing lists recorded across any of your organizations yet." : "No records match your filters."}
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((p) => {
            const status = STATUS[p.status] ?? { label: p.status, className: "bg-muted text-muted-foreground" };
            return (
              <div
                key={p.id}
                className="border border-border rounded-xl bg-background hover:bg-muted/20 transition-colors cursor-pointer"
                onClick={() => router.push(`/dashboard/procurement/packing-list/centralized/${p.id}`)}
              >
                <div className="flex items-center gap-3 px-4 py-3">
                  <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-teal-50 dark:bg-teal-900/20 shrink-0">
                    <ClipboardCheckIcon className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-sm font-medium">
                        <Highlight text={p.packingListNo} query={search} />
                      </span>
                      <span className={cn("text-[10px] font-medium rounded px-2 py-0.5", status.className)}>{status.label}</span>
                      <span className="text-[10px] font-medium text-indigo-700 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/20 rounded px-1.5 py-0.5">
                        <Highlight text={p.organizationName} query={search} />
                      </span>
                      {p.supplierRefNo && (
                        <span className="text-[10px] text-muted-foreground bg-muted/50 rounded px-1.5 py-0.5 font-mono">
                          <Highlight text={p.supplierRefNo} query={search} />
                        </span>
                      )}
                      {!p.canInspect && (
                        <span className="flex items-center gap-1 text-[10px] text-muted-foreground bg-muted/40 rounded px-1.5 py-0.5">
                          <EyeIcon className="w-2.5 h-2.5 shrink-0" /> View only
                        </span>
                      )}
                      <span className="text-[10px] text-muted-foreground bg-muted/50 rounded px-1.5 py-0.5 ml-auto tabular-nums">
                        {fmtDate(p.expectedDate ?? p.createdAt)}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                      {p.supplierName && (
                        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          <BuildingIcon className="w-3 h-3" />
                          <Highlight text={p.supplierName} query={search} />
                        </span>
                      )}
                      {p.itemCount > 0 && (
                        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          <PackageIcon className="w-3 h-3" />
                          {p.itemCount} item{p.itemCount !== 1 ? "s" : ""}
                        </span>
                      )}
                      {p.pendingChanges > 0 && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-amber-500 text-white" title="Changes to completed lines waiting for an approver">
                          {p.pendingChanges} change{p.pendingChanges !== 1 ? "s" : ""} awaiting approval
                        </span>
                      )}
                      {p.createdByName && (
                        <span className="flex items-center gap-1 text-[11px] text-muted-foreground ml-auto">
                          <CalendarIcon className="w-3 h-3" />
                          {p.createdByName}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="pl-3 border-l border-border/60 self-stretch flex items-center">
                    <AcceptanceGauge a={p.acceptance} status={p.status} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
