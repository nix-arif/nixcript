"use client";

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import { toast } from "sonner";
import { deleteInvoice, type InvoiceListRow, type InvoiceStatsRow } from "@/server/invoice";
import { type DocumentCategoryRow } from "@/server/document-category";
import { useAppStore } from "@/lib/store/use-app-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/page-header";
import { Highlight } from "@/components/highlight";
import {
  PlusIcon,
  SearchIcon,
  XIcon,
  ReceiptIcon,
  PencilIcon,
  TrashIcon,
  ChevronUpIcon,
  ChevronDownIcon,
  ChevronsUpDownIcon,
  CheckCircle2Icon,
  CircleIcon,
  AlertCircleIcon,
  TruckIcon,
  BuildingIcon,
  UserIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CalendarIcon,
  FilterIcon,
} from "lucide-react";
import { describeRange, hasRange, matchPreset, parseDay, presetRange, PRESETS, type DayRange, type PresetKey } from "@/lib/invoice/date-filter";
import type { PendingDoForInvoiceRow } from "@/server/delivery-order";
import { cn } from "@/lib/utils";

// ── Formatters ─────────────────────────────────────────────────────────────

const fmtDate = (d: Date | string | null | undefined) =>
  d
    ? new Date(d).toLocaleDateString("en-MY", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "—";

const fmtMoney = (v: string | null | undefined) =>
  v
    ? parseFloat(v).toLocaleString("en-MY", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    : "0.00";

const parseMoney = (v: string | null | undefined) => parseFloat(v ?? "0") || 0;

// ── Status config ──────────────────────────────────────────────────────────

const INV_STATUS: Record<string, { label: string; cls: string; dot: string }> = {
  draft:     { label: "Draft",     cls: "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400", dot: "bg-zinc-400" },
  sent:      { label: "Sent",      cls: "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400", dot: "bg-blue-500" },
  paid:      { label: "Paid",      cls: "bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400", dot: "bg-green-500" },
  overdue:   { label: "Overdue",   cls: "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400", dot: "bg-red-500" },
  cancelled: { label: "Cancelled", cls: "bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-500", dot: "bg-zinc-300" },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = INV_STATUS[status] ?? INV_STATUS.draft;
  return (
    <span className={cn("inline-flex items-center gap-1 text-[11px] font-medium rounded-full px-2 py-0.5", cfg.cls)}>
      <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", cfg.dot)} />
      {cfg.label}
    </span>
  );
}

// ── Sort ──────────────────────────────────────────────────────────────────

type SortKey = "invoiceNo" | "customerPoNo" | "customer" | "hospital" | "status" | "grandTotal" | "dueDate" | "caseDate";

function SortIcon({ col, active, dir }: { col: SortKey; active: SortKey; dir: "asc" | "desc" }) {
  if (col !== active) return <ChevronsUpDownIcon className="w-3 h-3 text-muted-foreground/40" />;
  return dir === "asc" ? <ChevronUpIcon className="w-3 h-3 text-foreground" /> : <ChevronDownIcon className="w-3 h-3 text-foreground" />;
}

// ── Stat card ─────────────────────────────────────────────────────────────

// One figure of the stats strip. Nothing is cut off at any screen size: the figure's size follows the card's own
// width (a container query, so it works whatever the grid does), the currency is a small prefix that may sit on its
// own line, and only a figure too long for the card even then wraps instead of overflowing.
function Stat({ label, value, prefix, sub, color, className }: { label: string; value: string; prefix?: string; sub?: string; color?: string; className?: string }) {
  return (
    <div className={cn("@container bg-background border border-border rounded-xl px-3 py-2.5 @[9rem]:px-4 @[9rem]:py-3 flex flex-col gap-0.5 min-w-0", className)}>
      <span className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium leading-snug">{label}</span>
      <span className={cn("flex flex-wrap items-baseline gap-x-1 font-semibold tabular-nums leading-tight text-sm @[9.5rem]:text-base @[11rem]:text-lg @[13rem]:text-xl", color)}>
        {prefix && <span className="text-[11px] @[10rem]:text-xs font-medium text-muted-foreground">{prefix}</span>}
        <span className="min-w-0 [overflow-wrap:anywhere]">{value}</span>
      </span>
      {sub && <span className="text-[11px] text-muted-foreground tabular-nums leading-snug">{sub}</span>}
    </div>
  );
}

// ── Skeleton ──────────────────────────────────────────────────────────────

function TableSkeleton() {
  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <tbody>
          {Array.from({ length: 5 }).map((_, i) => (
            <tr key={i} className="border-b border-border last:border-0">
              {Array.from({ length: 10 }).map((_, j) => (
                <td key={j} className="px-3 py-3">
                  <div className="h-3 bg-muted rounded animate-pulse" />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Status filter pills ────────────────────────────────────────────────────

const STATUS_FILTERS = [
  { value: "", label: "All" },
  { value: "unpaid", label: "Unpaid" }, // sent + overdue: issued, still waiting for payment
  { value: "draft", label: "Draft" },
  { value: "sent", label: "Sent" },
  { value: "overdue", label: "Overdue" },
  { value: "paid", label: "Paid" },
  { value: "cancelled", label: "Cancelled" },
];

// ── Pagination ─────────────────────────────────────────────────────────────

function Pagination({ page, totalPages, onPage }: { page: number; totalPages: number; onPage: (p: number) => void }) {
  if (totalPages <= 1) return null;

  const pages: (number | "…")[] = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    if (page > 3) pages.push("…");
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) pages.push(i);
    if (page < totalPages - 2) pages.push("…");
    pages.push(totalPages);
  }

  return (
    <div className="flex items-center justify-center gap-1 py-2">
      <Button variant="outline" size="icon" className="w-7 h-7" disabled={page === 1} onClick={() => onPage(page - 1)}>
        <ChevronLeftIcon className="w-3.5 h-3.5" />
      </Button>
      {pages.map((p, i) =>
        p === "…" ? (
          <span key={`ellipsis-${i}`} className="w-7 h-7 flex items-center justify-center text-xs text-muted-foreground">…</span>
        ) : (
          <Button
            key={p}
            variant={p === page ? "default" : "outline"}
            size="icon"
            className="w-7 h-7 text-xs"
            onClick={() => onPage(p as number)}
          >
            {p}
          </Button>
        )
      )}
      <Button variant="outline" size="icon" className="w-7 h-7" disabled={page === totalPages} onClick={() => onPage(page + 1)}>
        <ChevronRightIcon className="w-3.5 h-3.5" />
      </Button>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

// Fields the search looks in (server/invoice.ts getInvoices) that the row doesn't show
function hiddenMatches(inv: { mrnNo?: string | null; caseType?: string | null }, search: string): { label: string; text: string }[] {
  const q = search.trim().toLowerCase();
  if (!q) return [];
  return ([["MRN", inv.mrnNo], ["case type", inv.caseType]] as const)
    .filter(([, v]) => !!v && v.toLowerCase().includes(q))
    .map(([label, v]) => ({ label, text: v as string }));
}

const EDITABLE_STATUSES  = new Set(["draft"]);
const DELETABLE_STATUSES = new Set(["draft", "cancelled"]);

interface Props {
  initialInvoices: InvoiceListRow[];
  total: number;
  page: number;
  pageSize: number;
  overallStats: InvoiceStatsRow | null;
  statsScope: "all" | "filtered";
  range: DayRange;
  initialSearch: string;
  initialStatus: string;
  pendingDos: PendingDoForInvoiceRow[];
  permissions: string[];
  currentUserId: string;
  categories?: DocumentCategoryRow[];
}

export function InvoiceListClient({
  initialInvoices,
  total,
  page,
  pageSize,
  overallStats,
  statsScope,
  range,
  initialSearch,
  initialStatus,
  pendingDos,
  permissions,
  currentUserId,
  categories = [],
}: Props) {
  const router   = useRouter();
  const pathname = usePathname();

  const catMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  const [searchInput, setSearchInput]   = useState(initialSearch);
  const [statusFilter, setStatusFilter] = useState(initialStatus);
  const [dateFrom, setDateFrom]         = useState(range.from ?? "");
  const [dateTo, setDateTo]             = useState(range.to ?? "");
  const [sortKey, setSortKey]           = useState<SortKey>("invoiceNo");
  const [sortDir, setSortDir]           = useState<"asc" | "desc">("desc");
  const [deleting, setDeleting]         = useState<string | null>(null);
  const { isSwitchingOrg, setOrgSwitching } = useAppStore();

  const can = (p: string) => permissions.includes("*") || permissions.includes(p);

  useEffect(() => { setOrgSwitching(false); }, [initialInvoices]);

  // The search box follows the URL only when the URL changed by itself (back/forward, org switch), not when
  // the server answers a search sent from the box: by then more may have been typed, and it must stay.
  // sentSearch: what the URL has, or was last sent. Adjusted while rendering, as React recommends.
  const [sentSearch, setSentSearch]   = useState(initialSearch);
  const [shownSearch, setShownSearch] = useState(initialSearch);
  if (shownSearch !== initialSearch) {
    setShownSearch(initialSearch);
    // (trimmed: "john " typed on the way to "john doe" is the search "john" the server answers)
    if (initialSearch.trim() !== sentSearch.trim()) { setSearchInput(initialSearch); setSentSearch(initialSearch); }
  }
  useEffect(() => { setStatusFilter(initialStatus); }, [initialStatus]);
  // the inputs follow the range as the server applied it (back/forward, a reversed range comes back swapped, a bad
  // date dropped). Adjusted while rendering, as React recommends, rather than in an effect.
  const rangeKey = `${range.from ?? ""}|${range.to ?? ""}`;
  const [shownRangeKey, setShownRangeKey] = useState(rangeKey);
  if (shownRangeKey !== rangeKey) {
    setShownRangeKey(rangeKey);
    setDateFrom(range.from ?? ""); setDateTo(range.to ?? "");
  }

  // ── URL navigation ────────────────────────────────────────────────────

  const pushParams = useCallback(
    (updates: Record<string, string>, opts: { replace?: boolean } = {}) => {
      const params = new URLSearchParams(window.location.search);
      Object.entries(updates).forEach(([k, v]) => {
        if (v) params.set(k, v);
        else params.delete(k);
      });
      const url = `${pathname}?${params.toString()}`;
      if (opts.replace) router.replace(url); else router.push(url);
    },
    [pathname, router],
  );

  // Debounce search → URL. Only a changed search is sent (opening the list must not send it again: that
  // dropped the page number), and it replaces the history entry instead of adding one per pause in typing.
  useEffect(() => {
    const q = searchInput.trim();
    if (q === sentSearch.trim()) return;
    const t = setTimeout(() => {
      setSentSearch(searchInput);
      pushParams({ search: q, page: "" }, { replace: true });
    }, 350);
    return () => clearTimeout(t);
  }, [searchInput, sentSearch, pushParams]);

  const handleStatusFilter = (v: string) => {
    setStatusFilter(v);
    pushParams({ status: v, page: "" });
  };

  // Date range → URL. Typed dates wait a moment (typing a year goes 0002, 0020, 0202, 2026 ...); presets go at once.
  const lastRange = useRef(`${range.from ?? ""}|${range.to ?? ""}`); // what the URL has, or was last sent
  useEffect(() => { lastRange.current = `${range.from ?? ""}|${range.to ?? ""}`; }, [range.from, range.to]);
  const applyRange = useCallback((from: string, to: string) => {
    const f = parseDay(from) ?? "", t = parseDay(to) ?? "";
    if (`${f}|${t}` === lastRange.current) return; // nothing new (also stops a preset being sent twice)
    lastRange.current = `${f}|${t}`;
    pushParams({ from: f, to: t, page: "" });
  }, [pushParams]);
  useEffect(() => {
    const t = setTimeout(() => applyRange(dateFrom, dateTo), 500);
    return () => clearTimeout(t);
  }, [dateFrom, dateTo]); // eslint-disable-line react-hooks/exhaustive-deps
  const handlePreset = (key: PresetKey) => {
    const r = presetRange(key);
    setDateFrom(r.from ?? ""); setDateTo(r.to ?? "");
    applyRange(r.from ?? "", r.to ?? "");
  };
  const clearRange = () => { setDateFrom(""); setDateTo(""); applyRange("", ""); };
  const activePreset = matchPreset(range);
  const rangeLabel = describeRange(range);

  const handlePage = (p: number) => {
    pushParams({ page: p === 1 ? "" : String(p) });
  };

  // ── Sort (within current page) ────────────────────────────────────────

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    return [...initialInvoices].sort((a, b) => {
      const snapA = a.customerSnapshot as any;
      const snapB = b.customerSnapshot as any;
      switch (sortKey) {
        case "invoiceNo":    return dir * a.invoiceNo.localeCompare(b.invoiceNo);
        case "customer":     return dir * (snapA?.name ?? "").localeCompare(snapB?.name ?? "");
        case "hospital":     return dir * (snapA?.organizationName ?? "").localeCompare(snapB?.organizationName ?? "");
        case "customerPoNo": return dir * (a.customerPoNo ?? "").localeCompare(b.customerPoNo ?? "");
        case "status":       return dir * a.status.localeCompare(b.status);
        case "grandTotal":   return dir * (parseMoney(a.grandTotal) - parseMoney(b.grandTotal));
        case "dueDate": {
          const da = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
          const db_ = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
          return dir * (da - db_);
        }
        case "caseDate": {
          const ca = a.caseDate ? new Date(a.caseDate).getTime() : 0;
          const cb = b.caseDate ? new Date(b.caseDate).getTime() : 0;
          return dir * (ca - cb);
        }
        default: return 0;
      }
    });
  }, [initialInvoices, sortKey, sortDir]);

  // ── Stats (overall — from invoice_stats table) ────────────────────────

  const footerTotals = useMemo(() => {
    const billed = sorted.reduce((s, i) => s + parseMoney(i.grandTotal), 0);
    const out = sorted.reduce((s, i) => {
      if (i.status === "paid" || i.status === "cancelled") return s;
      return s + Math.max(0, parseMoney(i.grandTotal) - parseMoney(i.paidAmount));
    }, 0);
    return { billed, out };
  }, [sorted]);

  // ── Sort handler ──────────────────────────────────────────────────────

  const handleSort = (key: SortKey) => {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("desc"); }
  };

  const Th = ({ k, children, className }: { k: SortKey; children: React.ReactNode; className?: string }) => (
    <th
      className={cn("px-3 py-2.5 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wider whitespace-nowrap cursor-pointer select-none hover:text-foreground transition-colors", className)}
      onClick={() => handleSort(k)}
    >
      <span className="inline-flex items-center gap-1">
        {children}
        <SortIcon col={k} active={sortKey} dir={sortDir} />
      </span>
    </th>
  );

  // ── Delete ────────────────────────────────────────────────────────────

  async function handleDelete(id: string, invoiceNo: string) {
    if (!confirm(`Delete ${invoiceNo}? This cannot be undone.`)) return;
    setDeleting(id);
    try {
      await deleteInvoice(id);
      toast.success("Invoice deleted");
      router.refresh();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setDeleting(null);
    }
  }

  const totalPages = Math.ceil(total / pageSize);
  const isFiltered = !!searchInput || !!statusFilter || hasRange(range);

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <PageHeader
        title="Invoices"
        description="Tax invoices and billing records"
        action={
          can("invoice:create") && (
            <Button onClick={() => router.push("/dashboard/fulfillment/invoice/create")} className="gap-2">
              <PlusIcon className="w-4 h-4" /> New Invoice
            </Button>
          )
        }
      />

      {/* Pending invoice creation */}
      {pendingDos.length > 0 && can("invoice:create") && (
        <div className="border border-amber-200 dark:border-amber-800/50 rounded-xl overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-2.5 bg-amber-50 dark:bg-amber-950/20 border-b border-amber-200 dark:border-amber-800/50">
            <ReceiptIcon className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
            <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">Pending Invoice Creation</span>
            <span className="ml-auto text-[10px] text-amber-600 dark:text-amber-500 tabular-nums">
              {pendingDos.length} deliver{pendingDos.length !== 1 ? "ies" : "y"} awaiting invoice
            </span>
          </div>
          <div className="divide-y divide-border/60">
            {pendingDos.map((d) => (
              <div
                key={d.id}
                className="flex items-center gap-3 px-4 py-3 bg-background hover:bg-muted/20 transition-colors cursor-pointer"
                onClick={() => router.push(`/dashboard/fulfillment/invoice/create?doId=${d.id}`)}
              >
                <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-amber-50 dark:bg-amber-900/20 shrink-0">
                  <TruckIcon className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-sm font-medium">{d.doNo}</span>
                    {d.salesOrderNo && (
                      <span className="text-[10px] font-mono font-medium px-1.5 py-0.5 rounded-md bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                        {d.salesOrderNo}
                      </span>
                    )}
                    {d.customerPoNo && (
                      <span className="text-[10px] font-mono font-medium px-1.5 py-0.5 rounded-md bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
                        {d.customerPoNo}
                      </span>
                    )}
                  </div>
                  {(d.customerOrg || d.customerName) && (
                    <div className="flex items-center gap-1 mt-0.5">
                      <BuildingIcon className="w-3 h-3 text-muted-foreground shrink-0" />
                      <span className="text-[11px] text-muted-foreground">
                        {d.customerOrg || d.customerName}
                        {d.customerOrg && d.customerName && d.customerName !== d.customerOrg && (
                          <span className="text-muted-foreground/60"> · {d.customerName}</span>
                        )}
                      </span>
                    </div>
                  )}
                </div>
                <span className="text-[10px] text-amber-600 dark:text-amber-400 font-medium whitespace-nowrap shrink-0">
                  Create invoice →
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Stats strip: all-time (invoice_stats cache), or the invoices the filters select (status, search, dates).
          The label says which, from the filters the server applied (initialStatus / initialSearch / range).
          The label and the cards share one wrapper with a normal gap: no negative margin, so they cannot overlap. */}
      <div className="space-y-2">
      <div className="text-[11px] text-muted-foreground">
        {statsScope === "filtered" ? (
          <span className="inline-flex max-w-full items-start gap-1.5 rounded-xl border border-sky-200 bg-sky-50 px-2 py-0.5 font-medium leading-snug text-sky-800 dark:border-sky-800 dark:bg-sky-900/20 dark:text-sky-300">
            <FilterIcon className="mt-px w-3 h-3 shrink-0" />
            <span className="min-w-0">
              Figures for {initialStatus ? `${STATUS_FILTERS.find((f) => f.value === initialStatus)?.label ?? initialStatus} invoices` : "invoices"}
              {hasRange(range) && ` · dated ${rangeLabel.replace(/^From /, "from ").replace(/^Up to /, "up to ")}`}
              {initialSearch.trim() && <> · matching &ldquo;{initialSearch.trim()}&rdquo;</>}
            </span>
          </span>
        ) : (
          <span>All-time figures</span>
        )}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-2 sm:gap-3">
        <Stat
          label="Total invoices"
          value={(overallStats?.totalCount ?? total).toString()}
          sub={`${overallStats?.paidCount ?? 0} paid · ${overallStats?.overdueCount ?? 0} overdue`}
        />
        <Stat
          label="Total billed"
          prefix="MYR"
          value={fmtMoney(overallStats?.totalBilled ?? "0")}
          color="text-foreground"
        />
        <Stat
          label="Collected"
          prefix="MYR"
          value={fmtMoney(overallStats?.totalCollected ?? "0")}
          color="text-green-600 dark:text-green-400"
        />
        <Stat
          label="Outstanding"
          prefix="MYR"
          value={fmtMoney(overallStats?.totalOutstanding ?? "0")}
          color={parseFloat(overallStats?.totalOutstanding ?? "0") > 0 ? "text-amber-600 dark:text-amber-400" : "text-foreground"}
        />
        <Stat
          label="Overdue"
          value={(overallStats?.overdueCount ?? 0).toString()}
          sub={`${overallStats?.soaPendingCount ?? 0} SOA pending`}
          className="col-span-2 md:col-span-1"
          color={(overallStats?.overdueCount ?? 0) > 0 ? "text-red-600 dark:text-red-400" : "text-foreground"}
        />
      </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-2.5 items-start sm:items-center">
        <div className="relative flex-1 min-w-0">
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search invoice no., customer, hospital, case type…"
            className="pl-9 h-9 text-sm"
          />
          {searchInput && (
            <button
              onClick={() => setSearchInput("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <XIcon className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-1 flex-wrap">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => handleStatusFilter(f.value)}
              className={cn(
                "text-xs px-2.5 py-1 rounded-full border transition-colors tabular-nums",
                statusFilter === f.value
                  ? "bg-foreground text-background border-foreground"
                  : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/30",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Date range (invoice date, Malaysia time). On a phone the two dates share the full width, the presets wrap
          below; from sm up everything sits on one line as far as it fits. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0">
          <CalendarIcon className="w-3.5 h-3.5 shrink-0" />Invoice date
        </span>
        <div className="flex w-full min-w-0 items-center gap-1.5 sm:w-auto">
          <input
            type="date"
            aria-label="Invoice date from"
            value={dateFrom}
            max={dateTo || undefined}
            onChange={(e) => setDateFrom(e.target.value)}
            className="h-8 min-w-0 flex-1 sm:flex-none sm:w-36 rounded-md border border-border bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring tabular-nums"
          />
          <span className="text-xs text-muted-foreground shrink-0">to</span>
          <input
            type="date"
            aria-label="Invoice date to"
            value={dateTo}
            min={dateFrom || undefined}
            onChange={(e) => setDateTo(e.target.value)}
            className="h-8 min-w-0 flex-1 sm:flex-none sm:w-36 rounded-md border border-border bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring tabular-nums"
          />
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              onClick={() => handlePreset(p.key)}
              className={cn(
                "text-xs px-2.5 py-1 rounded-full border transition-colors",
                activePreset === p.key
                  ? "bg-foreground text-background border-foreground"
                  : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/30",
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
        {(dateFrom || dateTo) && (
          <button onClick={clearRange} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
            <XIcon className="w-3 h-3" /> Clear dates
          </button>
        )}
      </div>

      {/* Count */}
      <div className="text-xs text-muted-foreground tabular-nums -mt-2">
        {total} invoice{total !== 1 ? "s" : ""} {hasRange(range) ? `dated ${rangeLabel.replace(/^From /, "from ").replace(/^Up to /, "up to ")}` : "total"}
        {isFiltered && ` · ${sorted.length} on this page`}
        {totalPages > 1 && ` · page ${page} / ${totalPages}`}
      </div>

      {isSwitchingOrg ? (
        <TableSkeleton />
      ) : sorted.length === 0 ? (
        <div className="border border-border rounded-xl py-16 text-center text-muted-foreground">
          <ReceiptIcon className="w-8 h-8 mx-auto mb-3 opacity-30" />
          <div className="text-sm font-medium mb-1">
            {isFiltered ? "No invoices match your filter" : "No invoices yet"}
          </div>
          {!isFiltered && (
            <>
              <div className="text-xs mb-4">Create your first invoice to get started</div>
              {can("invoice:create") && (
                <Button variant="outline" size="sm" className="gap-2" onClick={() => router.push("/dashboard/fulfillment/invoice/create")}>
                  <PlusIcon className="w-3.5 h-3.5" /> New Invoice
                </Button>
              )}
            </>
          )}
        </div>
      ) : (
        <>
          <div className="border border-border rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-muted/30 border-b border-border">
                    <th className="px-3 py-2.5 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wider w-8">#</th>
                    <Th k="invoiceNo">Invoice No.</Th>
                    <Th k="customerPoNo">Customer PO</Th>
                    <Th k="customer">Customer</Th>
                    <Th k="hospital">Hospital</Th>
                    <th className="px-3 py-2.5 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wider whitespace-nowrap hidden xl:table-cell">
                      Categories
                    </th>
                    <Th k="status">Status</Th>
                    <Th k="grandTotal" className="text-right">Billed</Th>
                    <Th k="dueDate" className="hidden lg:table-cell">Due</Th>
                    <th className="px-3 py-2.5 text-center text-[11px] font-medium text-muted-foreground uppercase tracking-wider w-10 hidden lg:table-cell">SOA</th>
                    <th className="px-3 py-2.5 w-16" />
                  </tr>
                </thead>

                <tbody>
                  {sorted.map((inv, idx) => {
                    const snap        = inv.customerSnapshot as any;
                    const outstanding = inv.status === "paid" ? 0 : Math.max(0, parseMoney(inv.grandTotal) - parseMoney(inv.paidAmount));
                    const isOverdue   = inv.status === "overdue";
                    const isDueSoon   = inv.dueDate && inv.status !== "paid" && inv.status !== "cancelled" && new Date(inv.dueDate).getTime() - Date.now() < 7 * 24 * 60 * 60 * 1000;

                    return (
                      <tr
                        key={inv.id}
                        onClick={() => router.push(`/dashboard/fulfillment/invoice/${inv.id}`)}
                        className={cn(
                          "border-b border-border last:border-0 cursor-pointer transition-colors",
                          isOverdue ? "hover:bg-red-50/40 dark:hover:bg-red-900/10" : "hover:bg-muted/20",
                        )}
                      >
                        <td className="px-3 py-2.5 text-xs text-muted-foreground tabular-nums">
                          {(page - 1) * pageSize + idx + 1}
                        </td>

                        <td className="px-3 py-2.5">
                          <span className="font-mono text-xs font-medium text-foreground">
                            <Highlight text={inv.invoiceNo} query={searchInput} />
                          </span>
                          {inv.salesOrderNo && (
                            <div className="text-[10px] text-muted-foreground font-mono mt-0.5">
                              SO: <Highlight text={inv.salesOrderNo} query={searchInput} />
                            </div>
                          )}
                          {/* searched but not shown in the row: say where the search matched */}
                          {hiddenMatches(inv, searchInput).map((m) => (
                            <div key={m.label} className="mt-0.5 text-[10px] text-muted-foreground" title="Where your search matched">
                              matched {m.label}: <Highlight text={m.text} query={searchInput} />
                            </div>
                          ))}
                        </td>

                        <td className="px-3 py-2.5">
                          {inv.customerPoNo ? (
                            <span className="font-mono text-xs font-medium text-foreground">
                              <Highlight text={inv.customerPoNo} query={searchInput} />
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground/40">—</span>
                          )}
                          <div className="text-[10px] text-muted-foreground whitespace-nowrap mt-0.5">
                            {fmtDate(inv.invoiceDate)}
                          </div>
                        </td>

                        <td className="px-3 py-2.5 max-w-35">
                          {snap?.name ? (
                            <span className="text-xs wrap-break-word leading-snug">
                              {snap.title ? `${snap.title} ` : ""}<Highlight text={snap.name} query={searchInput} />
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground/50 italic">—</span>
                          )}
                          {(inv.salesPersonName || inv.applicationSpecialistName) && (
                            <div className="flex flex-wrap gap-1 mt-0.5">
                              {inv.salesPersonName && (
                                <span
                                  className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-md bg-muted/50 text-muted-foreground border border-border/60"
                                  title="Sales person"
                                >
                                  <UserIcon className="w-2.5 h-2.5 shrink-0" />
                                  <Highlight text={inv.salesPersonName} query={searchInput} />
                                </span>
                              )}
                              {inv.applicationSpecialistName && inv.applicationSpecialistName !== inv.salesPersonName && (
                                <span
                                  className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-md bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-800"
                                  title="Application specialist"
                                >
                                  <UserIcon className="w-2.5 h-2.5 shrink-0" />
                                  <Highlight text={inv.applicationSpecialistName} query={searchInput} />
                                </span>
                              )}
                            </div>
                          )}
                        </td>

                        <td className="px-3 py-2.5 max-w-40">
                          {snap?.organizationName ? (
                            <span className="text-xs wrap-break-word leading-snug">
                              <Highlight text={snap.organizationName} query={searchInput} />
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground/50">—</span>
                          )}
                          {snap?.organizationAddress && (
                            <div className="mt-0.5 text-[10px] leading-snug text-muted-foreground wrap-break-word">
                              <Highlight text={snap.organizationAddress} query={searchInput} />
                            </div>
                          )}
                        </td>

                        <td className="px-3 py-2.5 hidden xl:table-cell">
                          {inv.categoryIds?.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {[...inv.categoryIds]
                                .sort((a, b) => (catMap.get(a)?.position ?? 0) - (catMap.get(b)?.position ?? 0))
                                .map((id) => {
                                  const cat = catMap.get(id);
                                  if (!cat) return null;
                                  return (
                                    <span
                                      key={id}
                                      className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold text-white whitespace-nowrap"
                                      style={{ backgroundColor: cat.color ?? "#6366f1" }}
                                    >
                                      {cat.name}
                                    </span>
                                  );
                                })}
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground/50">—</span>
                          )}
                        </td>

                        <td className="px-3 py-2.5 whitespace-nowrap">
                          <StatusBadge status={inv.status} />
                          {inv.paidAt && <div className="text-[10px] text-muted-foreground mt-0.5">{fmtDate(inv.paidAt)}</div>}
                        </td>

                        <td className="px-3 py-2.5 text-right">
                          <span
                            className={cn(
                              "text-xs font-mono tabular-nums font-medium",
                              outstanding > 0
                                ? isOverdue ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400"
                                : inv.status === "paid" ? "text-emerald-600 dark:text-emerald-400" : "",
                            )}
                            title={outstanding > 0 ? `${fmtMoney(outstanding.toFixed(2))} outstanding` : undefined}
                          >
                            {fmtMoney(inv.grandTotal)}
                          </span>
                        </td>

                        <td className="px-3 py-2.5 whitespace-nowrap hidden lg:table-cell">
                          {inv.dueDate ? (
                            <span className={cn("text-xs", isOverdue ? "text-red-600 dark:text-red-400 font-medium" : isDueSoon ? "text-amber-600 dark:text-amber-400 font-medium" : "text-muted-foreground")}>
                              {fmtDate(inv.dueDate)}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground/50">—</span>
                          )}
                        </td>

                        <td className="px-3 py-2.5 text-center hidden lg:table-cell">
                          {inv.soaVerified ? (
                            <CheckCircle2Icon className="w-3.5 h-3.5 text-green-600 dark:text-green-400 mx-auto" />
                          ) : inv.status !== "draft" && inv.status !== "cancelled" ? (
                            <AlertCircleIcon className="w-3.5 h-3.5 text-amber-500 mx-auto opacity-70" />
                          ) : (
                            <CircleIcon className="w-3.5 h-3.5 text-muted-foreground/20 mx-auto" />
                          )}
                        </td>

                        <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center gap-0.5 justify-end">
                            {can("invoice:update") && EDITABLE_STATUSES.has(inv.status) && inv.createdBy === currentUserId && (
                              <Button variant="ghost" size="icon" className="w-6 h-6"
                                onClick={() => router.push(`/dashboard/fulfillment/invoice/${inv.id}/edit`)}>
                                <PencilIcon className="w-3 h-3" />
                              </Button>
                            )}
                            {can("invoice:delete") && DELETABLE_STATUSES.has(inv.status) && inv.createdBy === currentUserId && (
                              <Button variant="ghost" size="icon" className="w-6 h-6 text-destructive hover:text-destructive"
                                disabled={deleting === inv.id} onClick={() => handleDelete(inv.id, inv.invoiceNo)}>
                                <TrashIcon className="w-3 h-3" />
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>

                <tfoot>
                  <tr className="bg-muted/20 border-t border-border">
                    <td colSpan={7} className="px-3 py-2.5 text-xs font-medium text-muted-foreground">
                      {sorted.length} invoice{sorted.length !== 1 ? "s" : ""} on page
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <span
                        className={cn("text-xs font-mono tabular-nums font-semibold", footerTotals.out > 0 ? "text-amber-600 dark:text-amber-400" : "text-foreground")}
                        title={footerTotals.out > 0 ? `${fmtMoney(footerTotals.out.toFixed(2))} outstanding` : undefined}
                      >
                        {fmtMoney(footerTotals.billed.toFixed(2))}
                      </span>
                    </td>
                    <td colSpan={3} className="hidden lg:table-cell" />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          <Pagination page={page} totalPages={totalPages} onPage={handlePage} />
        </>
      )}
    </div>
  );
}
