"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { PoBadge } from "@/components/po-badge";
import { Input } from "@/components/ui/input";
import { SearchIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { comparePoNo } from "@/lib/po-sort";
import { markReturnShipped, unmarkReturnShipped, resolveReceiptItemAction, type ReturnResolutionInput } from "@/server/packing-list";
import type { ReturnToSupplierRow, SurplusRow } from "@/server/receiving-issues";
import { ResolveReturnDialog } from "../goods-receipt/resolve-return-dialog";

const PO_COLORS = [
  { header: "bg-blue-100/70 dark:bg-blue-900/30", border: "border-blue-200 dark:border-blue-800/50" },
  { header: "bg-green-100/70 dark:bg-green-900/30", border: "border-green-200 dark:border-green-800/50" },
  { header: "bg-amber-100/70 dark:bg-amber-900/30", border: "border-amber-200 dark:border-amber-800/50" },
  { header: "bg-purple-100/70 dark:bg-purple-900/30", border: "border-purple-200 dark:border-purple-800/50" },
  { header: "bg-pink-100/70 dark:bg-pink-900/30", border: "border-pink-200 dark:border-pink-800/50" },
  { header: "bg-teal-100/70 dark:bg-teal-900/30", border: "border-teal-200 dark:border-teal-800/50" },
] as const;

const RESOLUTION_LABEL: Record<string, string> = {
  replacement: "Replacement received",
  credited: "Credited by supplier",
  written_off: "Written off",
  other: "Settled another way",
};

const fmtDateTime = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleString("en-MY", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

// One item's life from rejection to settlement, oldest first.
function ReturnTimeline({ r, grHref, plHref }: { r: ReturnToSupplierRow; grHref: (id: string) => string; plHref: (id: string) => string }) {
  const events: { at: Date | string | null; tone: "red" | "blue" | "green" | "muted"; node: React.ReactNode }[] = [];
  events.push({
    at: r.inspectedAt, tone: "red",
    node: <>Rejected {r.qtyRejected} {r.uom || ""} on <Link className="underline" href={grHref(r.goodsReceiptId)}>{r.grNo}</Link>
      {r.packingListId && r.packingListNo && <> (<Link className="underline" href={plHref(r.packingListId)}>{r.packingListNo}</Link>)</>}
      {r.inspectedByName && <> · {r.inspectedByName}</>}{r.reason && <> — &ldquo;{r.reason}&rdquo;</>}</>,
  });
  if (r.shippedAt) events.push({ at: r.shippedAt, tone: "blue", node: <>Sent back to supplier{r.shipRef && <> · {r.shipRef}</>}</> });
  for (const a of r.attempts) {
    events.push({
      at: a.linkedAt, tone: "muted",
      node: <>Attempt {a.attemptNo}: {a.qtyAllocated} placed on <Link className="underline" href={plHref(a.packingListId)}>{a.packingListNo}</Link></>,
    });
    if (a.status === "inspected") {
      events.push({
        at: a.inspectedAt, tone: (a.qtyFailed ?? 0) > 0 ? "red" : "green",
        node: <>Attempt {a.attemptNo} inspected: {a.qtyGood} good{(a.qtyFailed ?? 0) > 0 && <> · {a.qtyFailed} failed</>}</>,
      });
    }
  }
  if (r.status === "resolved") {
    events.push({
      at: r.resolvedAt, tone: "green",
      node: <>Closed — {RESOLUTION_LABEL[r.resolutionType ?? ""] ?? r.resolutionType ?? "resolved"}{r.resolvedByName && <> · {r.resolvedByName}</>}{r.resolutionNotes && <> — &ldquo;{r.resolutionNotes}&rdquo;</>}</>,
    });
  } else {
    events.push({ at: null, tone: "muted", node: <>Open — {r.qtyOutstanding} {r.uom || ""} still to settle</> });
  }
  const dot = { red: "bg-red-500", blue: "bg-blue-500", green: "bg-green-500", muted: "bg-muted-foreground/50" } as const;
  return (
    <ol className="mt-2 ml-1 border-l pl-3 space-y-1.5 text-[11px]">
      {events.map((e, i) => (
        <li key={i} className="relative">
          <span className={cn("absolute -left-[17px] top-1 w-2 h-2 rounded-full", dot[e.tone])} />
          <span className="text-muted-foreground mr-2">{e.at ? fmtDateTime(e.at) : "now"}</span>
          {e.node}
        </li>
      ))}
    </ol>
  );
}

const fmtDate = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const poLabelOf = (r: { poNo: string | null; prNo: string | null; purchaseOrderId: string }) => r.poNo ?? r.prNo ?? r.purchaseOrderId;

// Same PO always gets the same tint across both tabs.
function useColorOf(all: { poNo: string | null; prNo: string | null; purchaseOrderId: string }[]) {
  return useMemo(() => {
    const ids = [...new Set(all.map((r) => r.purchaseOrderId))].sort((a, b) => {
      const ra = all.find((r) => r.purchaseOrderId === a)!;
      const rb = all.find((r) => r.purchaseOrderId === b)!;
      return comparePoNo(poLabelOf(ra), poLabelOf(rb));
    });
    const map = new Map(ids.map((id, i) => [id, PO_COLORS[i % PO_COLORS.length]]));
    return (id: string) => map.get(id) ?? PO_COLORS[0];
  }, [all]);
}

function groupBySupplier<T extends { supplierId: string | null; supplierName: string | null; poNo: string | null; prNo: string | null; purchaseOrderId: string }>(rows: T[]) {
  const groups = new Map<string, { name: string; rows: T[] }>();
  for (const r of rows) {
    const key = r.supplierId ?? "none";
    const g = groups.get(key) ?? { name: r.supplierName ?? "Unknown supplier", rows: [] };
    g.rows.push(r);
    groups.set(key, g);
  }
  return [...groups.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((g) => ({ ...g, rows: g.rows.sort((a, b) => comparePoNo(poLabelOf(a), poLabelOf(b))) }));
}

interface Props {
  initialReturns: ReturnToSupplierRow[];
  surplus: SurplusRow[];
  closedReturns: ReturnToSupplierRow[];
  permissions: string[];
  // Cross-org view: rows carry their org, links go to the centralized pages
  centralized?: boolean;
}

export function ReceivingIssuesClient({ initialReturns, surplus, closedReturns, permissions, centralized = false }: Props) {
  const [openHistory, setOpenHistory] = useState<Set<string>>(new Set());
  const toggleHistory = (id: string) => setOpenHistory((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const grHref = (id: string) => centralized ? `/dashboard/procurement/goods-receipt/centralized/${id}` : `/dashboard/procurement/goods-receipt/${id}`;
  const plHref = (id: string) => centralized ? `/dashboard/procurement/packing-list/centralized/${id}` : `/dashboard/procurement/packing-list/${id}`;
  const [tab, setTab] = useState<"returns" | "surplus" | "closed">("returns");
  const [returns, setReturns] = useState(initialReturns);
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [resolving, setResolving] = useState<ReturnToSupplierRow | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const can = (p: string) => permissions.includes("*") || permissions.includes(p);
  const canAct = centralized || can("packing-list:inspect");

  const colorOf = useColorOf(useMemo(() => [...returns, ...surplus, ...closedReturns], [returns, surplus, closedReturns]));

  const q = search.trim().toLowerCase();
  const matches = (r: { poNo: string | null; prNo: string | null; supplierName: string | null; productCode: string | null; description: string | null }) =>
    !q || [r.poNo, r.prNo, r.supplierName, r.productCode, r.description].some((v) => v?.toLowerCase().includes(q));
  const shownReturns = returns.filter(matches);
  const shownSurplus = surplus.filter(matches);
  const shownClosed = closedReturns.filter(matches);

  async function toggleShipped(r: ReturnToSupplierRow) {
    setBusyId(r.goodsReceiptItemId);
    try {
      if (r.shippedAt) {
        await unmarkReturnShipped(r.goodsReceiptItemId);
        setReturns((prev) => prev.map((x) => x.goodsReceiptItemId === r.goodsReceiptItemId ? { ...x, shippedAt: null, shipRef: null } : x));
      } else {
        const ref = window.prompt("Reference for this hand-back (DO / courier / credit note) — optional", "");
        if (ref === null) return;
        const res = await markReturnShipped(r.goodsReceiptItemId, { ref });
        if (res.closed) {
          setReturns((prev) => prev.filter((x) => x.goodsReceiptItemId !== r.goodsReceiptItemId));
          toast.success("Marked sent back — the replacement was already received, so this return is closed");
        } else {
          setReturns((prev) => prev.map((x) => x.goodsReceiptItemId === r.goodsReceiptItemId ? { ...x, shippedAt: res.shippedAt, shipRef: res.shipRef } : x));
          toast.success("Marked sent back");
        }
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusyId(null);
    }
  }

  async function confirmResolution(resolution: ReturnResolutionInput) {
    if (!resolving) return;
    const id = resolving.goodsReceiptItemId;
    setSubmitting(true);
    try {
      await resolveReceiptItemAction(id, "return", resolution);
      setReturns((prev) => prev.filter((x) => x.goodsReceiptItemId !== id));
      toast.success("Marked resolved");
      setResolving(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  const tabBtn = (key: "returns" | "surplus" | "closed", label: string, count: number) => (
    <button
      type="button"
      onClick={() => setTab(key)}
      className={cn(
        "px-3 py-1.5 text-sm rounded-md border transition-colors",
        tab === key ? "bg-foreground text-background border-foreground" : "bg-background text-muted-foreground hover:text-foreground border-border",
      )}
    >
      {label} <span className="opacity-70">({count})</span>
    </button>
  );

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <PageHeader
        title="Returns & Surplus"
        description={centralized ? "Across all your organizations — rejected items waiting to go back to suppliers, and extra items received beyond what was ordered" : "Rejected items waiting to go back to suppliers, and extra items received beyond what was ordered"}
      />

      <div className="flex flex-wrap items-center gap-2">
        {tabBtn("returns", "To return to supplier", returns.length)}
        {tabBtn("surplus", "Surplus items", surplus.length)}
        {tabBtn("closed", "Closed history", closedReturns.length)}
        <div className="relative ml-auto w-full sm:w-64">
          <SearchIcon className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search PO, supplier, item…" className="pl-8 h-8 text-sm" />
        </div>
      </div>

      {tab === "returns" ? (
        shownReturns.length === 0 ? (
          <p className="text-sm text-muted-foreground py-10 text-center">Nothing waiting to be returned.</p>
        ) : (
          groupBySupplier(shownReturns).map((g) => (
            <section key={g.name} className="border rounded-lg overflow-hidden">
              <div className="px-3 py-2 bg-muted/50 text-sm font-medium flex items-center justify-between">
                <span>{g.name}</span>
                <span className="text-xs text-muted-foreground font-normal">
                  {g.rows.length} line{g.rows.length !== 1 ? "s" : ""} · {g.rows.reduce((s, r) => s + r.qtyOutstanding, 0)} unit(s) to settle
                </span>
              </div>
              <div className="divide-y">
                {g.rows.map((r) => {
                  const color = colorOf(r.purchaseOrderId);
                  const failed = r.attempts.filter((a) => a.status === "inspected").reduce((s, a) => s + (a.qtyFailed ?? 0), 0);
                  return (
                    <div key={r.goodsReceiptItemId} className="px-3 py-2.5 grid gap-x-4 gap-y-1.5 text-xs md:grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_minmax(0,1.6fr)_auto] items-start">
                      <div className="space-y-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <PoBadge label={poLabelOf(r)} color={color} />
                          {centralized && r.organizationName && <span className="text-[10px] text-muted-foreground">{r.organizationName}</span>}
                          <span className="font-mono text-foreground">{r.productCode || "—"}</span>
                        </div>
                        {r.description && <p className="text-muted-foreground line-clamp-2">{r.description}</p>}
                        {r.reason && <p className="italic text-muted-foreground">&ldquo;{r.reason}&rdquo;</p>}
                        <button type="button" onClick={() => toggleHistory(r.goodsReceiptItemId)} className="text-muted-foreground hover:text-foreground underline">
                          {openHistory.has(r.goodsReceiptItemId) ? "Hide history" : "History"}
                        </button>
                        {openHistory.has(r.goodsReceiptItemId) && <ReturnTimeline r={r} grHref={grHref} plHref={plHref} />}
                      </div>

                      <div className="space-y-0.5">
                        <p>
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded-md border bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-400 dark:border-red-800 text-[10px]">
                            {r.qtyRejected} {r.uom || ""} rejected
                          </span>
                        </p>
                        {r.qtyOutstanding < r.qtyRejected && <p className="text-muted-foreground">{r.qtyOutstanding} not yet replaced</p>}
                        <p className="text-muted-foreground">
                          from <Link className="underline hover:no-underline" href={grHref(r.goodsReceiptId)}>{r.grNo}</Link>
                          {r.packingListId && r.packingListNo && (
                            <> · <Link className="underline hover:no-underline" href={plHref(r.packingListId)}>{r.packingListNo}</Link></>
                          )}
                        </p>
                        <p className="text-muted-foreground">inspected {fmtDate(r.inspectedAt)}{r.inspectedByName && ` by ${r.inspectedByName}`}</p>
                      </div>

                      <div className="space-y-0.5">
                        <p>
                          {r.shippedAt ? (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded-md border bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800 text-[10px]">
                              Sent back {fmtDate(r.shippedAt)}{r.shipRef && ` · ${r.shipRef}`}
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded-md border bg-muted text-muted-foreground border-border/60 text-[10px]">
                              Still with us — to return
                            </span>
                          )}
                        </p>
                        {r.attempts.length === 0 ? (
                          <p className="text-muted-foreground">No replacement linked</p>
                        ) : (
                          r.attempts.map((a) => (
                            <p key={a.id} className="text-muted-foreground">
                              Attempt {a.attemptNo} ·{" "}
                              <Link className="underline hover:no-underline" href={plHref(a.packingListId)}>{a.packingListNo}</Link>
                              {a.status === "inspected"
                                ? <>: {a.qtyGood} good{(a.qtyFailed ?? 0) > 0 && <span className="text-red-600 dark:text-red-400"> · {a.qtyFailed} failed</span>}</>
                                : <>: {a.qtyAllocated} awaiting inspection</>}
                            </p>
                          ))
                        )}
                        {failed > 0 && r.attempts.length >= 3 && <p className="text-red-600 dark:text-red-400 font-medium">Needs decision</p>}
                      </div>

                      {canAct && (
                        <div className="flex md:flex-col gap-2 md:items-end">
                          <button
                            type="button"
                            disabled={busyId === r.goodsReceiptItemId}
                            onClick={() => toggleShipped(r)}
                            className="text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap"
                          >
                            {r.shippedAt ? "Undo sent back" : "Mark sent back"}
                          </button>
                          <button type="button" onClick={() => setResolving(r)} className="text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap">
                            Mark resolved
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          ))
        )
      ) : tab === "closed" ? (
        shownClosed.length === 0 ? (
          <p className="text-sm text-muted-foreground py-10 text-center">No closed returns yet.</p>
        ) : (
          groupBySupplier(shownClosed).map((g) => (
            <section key={g.name} className="border rounded-lg overflow-hidden">
              <div className="px-3 py-2 bg-muted/50 text-sm font-medium flex items-center justify-between">
                <span>{g.name}</span>
                <span className="text-xs text-muted-foreground font-normal">{g.rows.length} closed</span>
              </div>
              <div className="divide-y">
                {g.rows.map((r) => (
                  <div key={r.goodsReceiptItemId} className="px-3 py-2.5 text-xs">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <PoBadge label={poLabelOf(r)} color={colorOf(r.purchaseOrderId)} />
                      {centralized && r.organizationName && <span className="text-[10px] text-muted-foreground">{r.organizationName}</span>}
                      <span className="font-mono text-foreground">{r.productCode || "—"}</span>
                      <span className="text-muted-foreground">{r.qtyRejected} {r.uom || ""} rejected</span>
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded-md border bg-green-50 text-green-700 border-green-200 dark:bg-green-950/40 dark:text-green-400 dark:border-green-800 text-[10px]">
                        {RESOLUTION_LABEL[r.resolutionType ?? ""] ?? "Resolved"} · {fmtDate(r.resolvedAt)}
                      </span>
                      <button type="button" onClick={() => toggleHistory(r.goodsReceiptItemId)} className="ml-auto text-muted-foreground hover:text-foreground underline">
                        {openHistory.has(r.goodsReceiptItemId) ? "Hide history" : "History"}
                      </button>
                    </div>
                    {openHistory.has(r.goodsReceiptItemId) && <ReturnTimeline r={r} grHref={grHref} plHref={plHref} />}
                  </div>
                ))}
              </div>
            </section>
          ))
        )
      ) : shownSurplus.length === 0 ? (
        <p className="text-sm text-muted-foreground py-10 text-center">No surplus items.</p>
      ) : (
        groupBySupplier(shownSurplus).map((g) => (
          <section key={g.name} className="border rounded-lg overflow-hidden">
            <div className="px-3 py-2 bg-muted/50 text-sm font-medium flex items-center justify-between">
              <span>{g.name}</span>
              <span className="text-xs text-muted-foreground font-normal">
                {g.rows.length} line{g.rows.length !== 1 ? "s" : ""} · {g.rows.reduce((s, r) => s + r.qtySurplus, 0)} extra unit(s)
              </span>
            </div>
            <div className="divide-y">
              {g.rows.map((r) => (
                <div key={r.purchaseOrderItemId} className="px-3 py-2.5 grid gap-x-4 gap-y-1.5 text-xs md:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,2fr)] items-start">
                  <div className="space-y-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <PoBadge label={poLabelOf(r)} color={colorOf(r.purchaseOrderId)} />
                      {centralized && r.organizationName && <span className="text-[10px] text-muted-foreground">{r.organizationName}</span>}
                      <span className="font-mono text-foreground">{r.productCode || "—"}</span>
                      <span className="text-[10px] text-muted-foreground">PO {r.poStatus}</span>
                    </div>
                    {r.description && <p className="text-muted-foreground line-clamp-2">{r.description}</p>}
                  </div>

                  <div className="space-y-0.5">
                    <p>
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded-md border bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-400 dark:border-sky-800 text-[10px]">
                        +{r.qtySurplus} {r.uom || ""} extra
                      </span>
                    </p>
                    <p className="text-muted-foreground">ordered {r.qtyOrdered} · accepted {r.qtyAccepted}</p>
                    {r.qtyPendingReturn > 0 && <p className="text-muted-foreground">{r.qtyPendingReturn} more rejected, waiting to go back</p>}
                  </div>

                  <div className="space-y-0.5">
                    {r.receipts.map((x) => (
                      <p key={x.goodsReceiptId} className="text-muted-foreground">
                        <Link className="underline hover:no-underline" href={grHref(x.goodsReceiptId)}>{x.grNo}</Link>
                        {x.packingListId && x.packingListNo && (
                          <> · <Link className="underline hover:no-underline" href={plHref(x.packingListId)}>{x.packingListNo}</Link></>
                        )}
                        {" · "}{fmtDate(x.receivedDate)}: received {x.qtyReceived}, accepted {x.qtyAccepted}
                        {x.qtyReturned > 0 && `, rejected ${x.qtyReturned}`}
                      </p>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))
      )}

      {resolving && (
        <ResolveReturnDialog
          key={resolving.goodsReceiptItemId}
          supplierId={resolving.supplierId}
          targetOrgId={centralized ? resolving.organizationId : undefined}
          itemLabel={resolving.productCode || resolving.description || "this item"}
          qty={resolving.qtyOutstanding}
          uom={resolving.uom}
          submitting={submitting}
          onConfirm={confirmResolution}
          onClose={() => setResolving(null)}
        />
      )}
    </div>
  );
}
