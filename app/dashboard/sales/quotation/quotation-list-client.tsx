"use client";

import { useState, useEffect, useLayoutEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  getQuotationsList,
  getQuotationsListVersion,
  deleteQuotation,
  type QuotationListGroup,
} from "@/server/quotation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  PlusIcon,
  SearchIcon,
  TrashIcon,
  XIcon,
  LayersIcon,
  FileTextIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CalendarIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { Highlight } from "@/components/highlight";

const PAGE_SIZE = 10;

const FILTERS_STORAGE_KEY = "quotation-list-filters";
const SCROLL_STORAGE_KEY = "quotation-list-scroll";

type SavedFilters = {
  search: string;
  dateFrom: string;
  dateTo: string;
  page: number;
  batchFilter: string | null;
};

// Last browser back/forward *to the list*. Registered at module load so it's
// recorded before the list remounts for the traversal.
//
// The Navigation API's "navigate" event (navigationType "traverse") is the
// Chromium signal: Next 16 begins restoring the cached page from that event,
// so the list can mount *before* popstate fires. popstate is the fallback.
// Only traversals whose destination is the list count, and the list clears
// the flag once it has mounted, so a later fresh visit isn't mistaken for one.
let pendingListTraversalAt = 0;
if (typeof window !== "undefined") {
  const noteTraversal = (url: string) => {
    try {
      if (new URL(url, window.location.href).pathname === "/dashboard/sales/quotation") {
        pendingListTraversalAt = Date.now();
      }
    } catch {}
  };
  const nav = (window as unknown as {
    navigation?: {
      addEventListener: (
        t: "navigate",
        cb: (e: { navigationType: string; destination: { url: string } }) => void,
      ) => void;
    };
  }).navigation;
  nav?.addEventListener("navigate", (e) => {
    if (e.navigationType === "traverse") noteTraversal(e.destination.url);
  });
  window.addEventListener("popstate", () => noteTraversal(window.location.href));
}

const LIST_PATH = "/dashboard/sales/quotation";
// Flag written into this list's own history entry (alongside Next's state).
// Coming back to that entry — by any means, in any browser — finds it there.
const HISTORY_MARK = "__quotationList";
// Whether the list has already been shown in this document. False on a hard
// load/refresh, so hydration always renders the same (empty) filters as SSR.
let listHasMounted = false;

/** True when this mount is a back/forward return to an earlier list visit. */
function detectReturn() {
  if (typeof window === "undefined" || !listHasMounted) return false;
  if (window.location.pathname === LIST_PATH) {
    // The current history entry is the list's, so its mark is authoritative:
    // present = returning to an entry we rendered before (works everywhere,
    // including Safari/iOS without the Navigation API); absent = a brand-new
    // entry (sidebar/link visit), whatever stale traversal flags say.
    const st = window.history.state as Record<string, unknown> | null;
    return st?.[HISTORY_MARK] === true;
  }
  // URL not switched yet: Chromium mounting the restored page early from the
  // Navigation API's traverse event. Only then is the traversal flag used.
  return Date.now() - pendingListTraversalAt < 15_000;
}

function markListHistoryEntry() {
  try {
    if (window.location.pathname !== LIST_PATH) return;
    const st = (window.history.state ?? {}) as Record<string, unknown>;
    if (st[HISTORY_MARK] === true) return;
    // Spreading keeps Next's __NA / internal tree; no URL arg, so the URL and
    // Next's stored tree stay in sync (a URL change here would force a full
    // reload on back — see the note on sessionStorage below).
    window.history.replaceState({ ...st, [HISTORY_MARK]: true }, "");
  } catch {}
}

function readSavedFilters(isReturn: boolean, batchFilter: string | undefined): SavedFilters | null {
  if (!isReturn) return null;
  try {
    const raw = sessionStorage.getItem(FILTERS_STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as SavedFilters;
    if ((saved.batchFilter ?? null) !== (batchFilter ?? null)) return null;
    return saved;
  } catch {
    return null;
  }
}

const fmt = (v: string | number) =>
  `RM ${Number(v).toLocaleString("en-MY", { minimumFractionDigits: 2 })}`;

function toDateStr(d: Date | string): string {
  return new Date(d).toISOString().slice(0, 10);
}

const fmtDate = (d: Date | string | null | undefined) =>
  d
    ? new Date(d).toLocaleDateString("en-MY", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "";

const STATUS: Record<string, { label: string; className: string }> = {
  draft: {
    label: "Draft",
    className:
      "bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400",
  },
  final: {
    label: "Final",
    className:
      "bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400",
  },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS[status] ?? STATUS.draft;
  return (
    <span
      className={cn("text-[11px] font-medium rounded px-2 py-0.5", cfg.className)}
    >
      {cfg.label}
    </span>
  );
}

interface Props {
  initialGroups: QuotationListGroup[];
  /** getQuotationsListVersion() at render time — see the freshness check below */
  listVersion: string;
  batchFilter?: string;
}

export function QuotationListClient({
  initialGroups,
  listVersion,
  batchFilter,
}: Props) {
  const router = useRouter();
  // Restore the previous filters only when arriving via back/forward (e.g.
  // router.back() from a quotation) — a fresh visit from the sidebar starts
  // clean. Read once per mount; SSR/hard loads never restore, so hydration
  // always matches the server render.
  // Decided once per mount; everything below keys off the same answer.
  const [isReturn] = useState(detectReturn);
  const [restored] = useState(() => readSavedFilters(isReturn, batchFilter));
  const [groups, setGroups] = useState(initialGroups);
  const [search, setSearch] = useState(restored?.search ?? "");
  const [dateFrom, setDateFrom] = useState(restored?.dateFrom ?? "");
  const [dateTo, setDateTo] = useState(restored?.dateTo ?? "");
  const [deleting, setDeleting] = useState<string | null>(null);
  const [page, setPage] = useState(restored?.page ?? 1);
  const [updating, setUpdating] = useState(false);

  // Scroll position — saved when the list unmounts, restored on back/forward.
  // The browser's own restoration can't do it: it fires while the (shorter)
  // detail page is still rendered, so the target offset gets clamped to ~0.
  //
  // Saved from a *layout* effect cleanup on purpose: React runs it before the
  // list's DOM is removed and before the next page's layout effects, where
  // Next scrolls the new page to the top — so window.scrollY is still the
  // user's real position here (a passive-effect cleanup or a scroll listener
  // would record the reset 0 instead).
  useLayoutEffect(() => {
    listHasMounted = true;
    pendingListTraversalAt = 0; // consumed by this mount
    markListHistoryEntry();
    if (isReturn) {
      let y = 0;
      try { y = Number(sessionStorage.getItem(SCROLL_STORAGE_KEY)) || 0; } catch {}
      if (y > 0) {
        window.scrollTo(0, y);
        // Re-apply after paint in case anything (router, late layout) moved it.
        requestAnimationFrame(() => {
          if (Math.abs(window.scrollY - y) > 2) window.scrollTo(0, y);
        });
      }
    }
    return () => {
      try { sessionStorage.setItem(SCROLL_STORAGE_KEY, String(Math.round(window.scrollY))); } catch {}
      // Re-mark in case a router update since mount rewrote the entry's state.
      markListHistoryEntry();
    };
  }, [isReturn]);

  // Back/forward restores this page from Next's client cache instantly — no
  // server round-trip — so its data is as old as when it was first rendered.
  // Instead of refetching the whole list on every return, ask the server for
  // a tiny fingerprint (count + latest updatedAt) and only pull the full list
  // when it differs. Runs in the background; the cached list stays visible.
  const versionRef = useRef(listVersion);
  useEffect(() => {
    if (!isReturn) return;
    let cancelled = false;
    (async () => {
      try {
        const latest = await getQuotationsListVersion();
        if (cancelled || latest === versionRef.current) return;
        setUpdating(true);
        const fresh = await getQuotationsList();
        if (cancelled) return;
        versionRef.current = latest;
        setGroups(fresh);
      } catch {
        // keep showing the cached list
      } finally {
        if (!cancelled) setUpdating(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isReturn]);

  const hasDateFilter = dateFrom || dateTo;

  // Reset to page 1 when filters change. Compared against the previous
  // filter values (not "skip first render") so a restored page survives
  // mount, including StrictMode's double-run of effects.
  const filterKey = JSON.stringify([search, dateFrom, dateTo, batchFilter]);
  const prevFilterKey = useRef(filterKey);
  useEffect(() => {
    if (prevFilterKey.current === filterKey) return;
    prevFilterKey.current = filterKey;
    setPage(1);
  }, [filterKey]);

  // Filters live in sessionStorage, not the URL: rewriting the URL with
  // history.replaceState leaves Next's stored router tree pointing at the old
  // search string, and on back-navigation Next treats that mismatch as
  // unrecoverable and does a full page reload.
  useEffect(() => {
    try {
      const saved: SavedFilters = { search, dateFrom, dateTo, page, batchFilter: batchFilter ?? null };
      sessionStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify(saved));
    } catch {
      // storage unavailable (private mode etc.) — filters just won't persist
    }
  }, [search, dateFrom, dateTo, page, batchFilter]);

  const filtered = groups.filter((g) => {
    if (batchFilter && g.govBatchId !== batchFilter) return false;
    if (dateFrom || dateTo) {
      const d = toDateStr(g.createdAt);
      if (dateFrom && d < dateFrom) return false;
      if (dateTo && d > dateTo) return false;
    }
    if (!search) return true;
    const s = search.toLowerCase();
    const cust = g.customerSnapshot as any;
    return (
      g.members.some(
        (m) =>
          m.quotationNo.toLowerCase().includes(s) ||
          m.orgName.toLowerCase().includes(s),
      ) ||
      cust?.name?.toLowerCase().includes(s) ||
      cust?.organizationName?.toLowerCase().includes(s) ||
      (g.salesPersonName?.toLowerCase().includes(s) ?? false) ||
      (g.title?.toLowerCase().includes(s) ?? false) ||
      (g.govBatchId?.toLowerCase().includes(s) ?? false)
    );
  });

  const handleDelete = async (primaryId: string, mode: string) => {
    const msg =
      mode === "comparison"
        ? "Delete this entire comparison group? All linked quotations will be removed."
        : "Delete this quotation?";
    if (!confirm(msg)) return;
    setDeleting(primaryId);
    try {
      await deleteQuotation(primaryId);
      const [fresh, latest] = await Promise.all([getQuotationsList(), getQuotationsListVersion()]);
      versionRef.current = latest;
      setGroups(fresh);
      toast.success("Quotation deleted");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setDeleting(null);
    }
  };

  const totalMembers = groups.reduce((s, g) => s + g.members.length, 0);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginated = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return (
    <div className="p-6">
      <PageHeader
        title="Quotations"
        description="Manage and generate customer quotations"
        action={
          <Button onClick={() => router.push("/dashboard/sales/quotation/new")} className="gap-2">
            <PlusIcon className="w-4 h-4" /> New quotation
          </Button>
        }
      />

      {/* Batch filter banner */}
      {batchFilter && (
        <div className="flex items-center justify-between px-3 py-2 mb-3 rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 text-xs">
          <span className="text-blue-700 dark:text-blue-300 font-medium">
            Filtering by government batch · {filtered.length} group{filtered.length !== 1 ? "s" : ""}
          </span>
          <Link
            href="/dashboard/sales/quotation"
            className="text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
          >
            <XIcon className="w-3 h-3" /> Clear
          </Link>
        </div>
      )}

      {/* Search */}
      <div className="flex items-center gap-3 mb-3">
        <div className="relative flex-1">
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by quotation no., customer, org, sales person, batch ID..."
            className="pl-9 h-9 text-sm"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            >
              <XIcon className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Date filter */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <CalendarIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        <div className="flex items-center gap-1.5">
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="h-8 rounded-md border border-border bg-background px-2.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring tabular-nums"
          />
          <span className="text-xs text-muted-foreground">–</span>
          <input
            type="date"
            value={dateTo}
            min={dateFrom || undefined}
            onChange={(e) => setDateTo(e.target.value)}
            className="h-8 rounded-md border border-border bg-background px-2.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring tabular-nums"
          />
        </div>
        {hasDateFilter && (
          <button
            onClick={() => { setDateFrom(""); setDateTo(""); }}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <XIcon className="w-3 h-3" /> Clear
          </button>
        )}
        <div className="w-full sm:w-auto sm:ml-auto flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground whitespace-nowrap tabular-nums">
          {updating && (
            <span className="flex items-center gap-1 text-[11px]">
              <span className="w-2.5 h-2.5 border-[1.5px] border-current border-t-transparent rounded-full animate-spin" />
              Updating…
            </span>
          )}
          {/* Legend for the dot on each comparison row */}
          <span className="flex items-center gap-3 sm:pr-3 sm:mr-1 sm:border-r sm:border-border">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-primary" /> Original
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full border border-muted-foreground/40" /> Alternative
            </span>
          </span>
          <span>
          {filtered.length} group{filtered.length !== 1 ? "s" : ""} ·{" "}
          {totalMembers} quotation{totalMembers !== 1 ? "s" : ""}
          {totalPages > 1 && ` · page ${safePage}/${totalPages}`}
          </span>
        </div>
      </div>

      {/* Empty state */}
      {filtered.length === 0 ? (
        <div className="border border-border rounded-xl py-16 text-center text-muted-foreground">
          <div className="text-sm font-medium mb-1">No quotations yet</div>
          <div className="text-xs mb-4">
            Create your first quotation to get started
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => router.push("/dashboard/sales/quotation/new")}
          >
            <PlusIcon className="w-3.5 h-3.5" /> New quotation
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {paginated.map((group) => {
            const cust = group.customerSnapshot as any;
            const custName = cust
              ? [cust.title, cust.name].filter(Boolean).join(" ")
              : null;
            const custOrg: string | null = cust?.organizationName || null;
            const isDraft = group.status === "draft";
            const isDeleting = deleting === group.primaryId;

            /* ── Group card (comparison group, or a single quotation shown
                  with the same header + one member row for a consistent list) ── */
            const isSingle = group.mode === "single";
            return (
              <div
                key={group.groupId ?? group.primaryId}
                className="border border-border rounded-xl bg-background overflow-hidden"
              >
                {/* Group header */}
                <div className="flex items-center gap-3 px-4 py-3 bg-muted/30 border-b border-border">
                  {isSingle ? (
                    <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-muted shrink-0">
                      <FileTextIcon className="w-3.5 h-3.5 text-muted-foreground" />
                    </div>
                  ) : (
                    <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-900/30 shrink-0">
                      <LayersIcon className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                    </div>
                  )}

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {isSingle ? (
                        <span className="text-[11px] font-semibold text-muted-foreground">
                          Single
                        </span>
                      ) : (
                        <span className="text-[11px] font-semibold text-blue-600 dark:text-blue-400 tabular-nums">
                          Compare · {group.members.length}
                        </span>
                      )}
                      {custName && (
                        <span className="text-sm font-medium">
                          <Highlight text={custName} query={search} />
                        </span>
                      )}
                      {custOrg && (
                        <span className="text-xs text-muted-foreground">
                          <Highlight text={custOrg} query={search} />
                        </span>
                      )}
                      <span className="text-[10px] font-medium bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 rounded px-1.5 py-0.5 tabular-nums">
                        {fmtDate(group.createdAt)}
                      </span>
                      {group.govBatchId && (
                        <Link
                          href={`/dashboard/sales/quotation?batch=${group.govBatchId}`}
                          className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-400 hover:bg-violet-200 dark:hover:bg-violet-900/50 transition-colors"
                          title={`Filter by batch: ${group.govBatchId}`}
                        >
                          Gov batch
                        </Link>
                      )}
                    </div>
                    {(group.title || group.salesPersonName || group.preparedByName) && (
                      <div className="flex items-center gap-3 mt-0.5 text-[11px] text-muted-foreground flex-wrap">
                        {group.title && group.title !== "Loose Items" && (
                          <span>
                            <span className="text-muted-foreground/50">Title:</span>{" "}
                            <Highlight text={group.title} query={search} />
                          </span>
                        )}
                        {group.salesPersonName && (
                          <span>
                            <span className="text-muted-foreground/50">Sales:</span>{" "}
                            <Highlight text={group.salesPersonName} query={search} />
                          </span>
                        )}
                        {group.preparedByName && (
                          <span>
                            <span className="text-muted-foreground/50">By:</span>{" "}
                            <Highlight text={group.preparedByName} query={search} />
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <StatusBadge status={group.status} />
                    {isDraft && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                        disabled={isDeleting}
                        onClick={() =>
                          handleDelete(group.primaryId, group.mode)
                        }
                      >
                        {isDeleting ? (
                          <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                        ) : (
                          <TrashIcon className="w-3.5 h-3.5" />
                        )}
                      </Button>
                    )}
                  </div>
                </div>

                {/* Member rows — two lines on mobile (ref no. + total, then org +
                    date) so a long quotation no. never pushes the org name out;
                    a single line from sm up. */}
                {group.members.map((m, mi) => (
                  <div
                    key={m.id}
                    className={cn(
                      "flex items-start sm:items-center gap-3 px-4 py-2.5",
                      mi < group.members.length - 1
                        ? "border-b border-border/50"
                        : "",
                    )}
                  >
                    {/* Original vs alternative indicator — see legend above the list */}
                    <div className="w-8 h-4 sm:h-auto flex items-center justify-center shrink-0">
                      <div
                        title={isSingle ? undefined : m.isDummy === 0 ? "Original" : "Alternative"}
                        aria-label={isSingle ? undefined : m.isDummy === 0 ? "Original" : "Alternative"}
                        className={cn(
                          "w-2 h-2 rounded-full",
                          m.isDummy === 0
                            ? "bg-primary"
                            : "border border-muted-foreground/40 bg-transparent",
                        )}
                      />
                    </div>

                    <div className="flex-1 min-w-0 flex flex-col sm:flex-row sm:items-center gap-x-2 gap-y-0.5">
                      <div className="flex items-center gap-2 shrink-0">
                        <Link
                          href={`/dashboard/sales/quotation/${m.id}`}
                          className="font-mono text-xs font-medium whitespace-nowrap hover:underline hover:text-primary underline-offset-2 transition-colors"
                        >
                          {m.quotationNo.startsWith("PENDING-")
                            ? <span className="text-muted-foreground italic">Draft</span>
                            : <Highlight text={m.quotationNo} query={search} />}
                        </Link>
                        {(m.revisionNo ?? 0) > 0 && (
                          <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 shrink-0">
                            R{m.revisionNo}
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground leading-snug break-words sm:truncate min-w-0">
                        <Highlight text={m.orgName} query={search} />
                      </span>
                    </div>

                    <div className="flex flex-col sm:flex-row items-end sm:items-center gap-x-3 gap-y-0.5 shrink-0">
                      <span className="order-2 sm:order-1 text-[10px] text-muted-foreground tabular-nums whitespace-nowrap">
                        {fmtDate(m.createdAt)}
                      </span>
                      <span className="order-1 sm:order-2 text-xs font-semibold tabular-nums whitespace-nowrap">
                        {fmt(m.grandTotal)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 pt-4 border-t border-border">
          <p className="text-xs text-muted-foreground tabular-nums">
            Showing {(safePage - 1) * PAGE_SIZE + 1}–
            {Math.min(safePage * PAGE_SIZE, filtered.length)} of {filtered.length} group
            {filtered.length !== 1 ? "s" : ""}
          </p>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              className="h-7 w-7 p-0"
              disabled={safePage <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeftIcon className="w-3.5 h-3.5" />
            </Button>
            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter(
                (p) =>
                  p === 1 || p === totalPages || Math.abs(p - safePage) <= 1,
              )
              .reduce<(number | "…")[]>((acc, p, idx, arr) => {
                if (idx > 0 && (p as number) - (arr[idx - 1] as number) > 1)
                  acc.push("…");
                acc.push(p);
                return acc;
              }, [])
              .map((p, i) =>
                p === "…" ? (
                  <span
                    key={`ellipsis-${i}`}
                    className="text-xs text-muted-foreground px-1"
                  >
                    …
                  </span>
                ) : (
                  <Button
                    key={p}
                    variant={p === safePage ? "default" : "outline"}
                    size="sm"
                    className="h-7 w-7 p-0 text-xs"
                    onClick={() => setPage(p as number)}
                  >
                    {p}
                  </Button>
                ),
              )}
            <Button
              variant="outline"
              size="sm"
              className="h-7 w-7 p-0"
              disabled={safePage >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              <ChevronRightIcon className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
