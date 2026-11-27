"use client";

// A list's stat cards (each also a filter), date filter and category filter chips: the customer PO,
// sales order, PR and supplier PO lists, the company's own and the centralized ones. Each list
// gives its own cards and which date it goes by (STATS); the date and categories narrow what the
// cards count.
// On a centralized list the companies each have their own categories, so the chips go by name:
// "Laser" picks every company's Laser.

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Highlight } from "@/components/highlight";
import { CategoryChip } from "@/components/document-categories-card";
import type { CategoryOption } from "@/server/document-category-chain";

type Row = { categoryIds: unknown };

/** One stat card: what it counts, and the value it sums (left out: the card shows its hint) */
export type StatCard<T> = { key: string; label: string; hint: string; tone?: string; test: (p: T, monthStart: number) => boolean; noValue?: boolean };
/** money: what a row adds to a card's value (null: not counted, e.g. a price the viewer can't see); left out: the cards show their hints */
/** date: the row's date the date filter goes by, and what to call it ("received", "created"…) */
export type StatConfig<T> = {
  cards: StatCard<T>[];
  money?: (p: T) => { amount: string | number | null; currency: string | null } | null;
  noun: string;
  date: (p: T) => Date | string | null | undefined;
  dateLabel: string;
};

const rm = (v: number) => `RM ${v.toLocaleString("en-MY", { minimumFractionDigits: 2 })}`;
/** The value per currency (RM first), e.g. "RM 12,400.00 + USD 300.00" */
export function valueText<T>(rows: T[], money: NonNullable<StatConfig<T>["money"]>): string {
  const by = new Map<string, number>();
  for (const r of rows) { const m = money(r); if (!m) continue; const c = m.currency || "MYR"; by.set(c, (by.get(c) ?? 0) + Number(m.amount ?? 0)); }
  if (by.size === 0) return rm(0);
  return [...by.entries()].sort(([a], [b]) => (a === "MYR" ? -1 : b === "MYR" ? 1 : a.localeCompare(b)))
    .map(([c, v]) => (c === "MYR" ? rm(v) : `${c} ${v.toLocaleString("en-MY", { minimumFractionDigits: 2 })}`)).join(" + ");
}

const dateOf = (d: Date | string | null | undefined) => (d ? new Date(d).getTime() : 0);

// ── Customer POs ──────────────────────────────────────────────────────────
type CpoLike = Row & { status: string; salesOrderId: string | null; receivedDate: Date | string | null; createdAt: Date | string; amount: string | null; currency: string | null };
const cpoOpen = (p: CpoLike) => p.status !== "cancelled" && p.status !== "fulfilled" && p.status !== "draft";
const cpoRecorded = (p: CpoLike) => p.status !== "cancelled" && p.status !== "draft";
export const CPO_STATS: StatConfig<CpoLike> = {
  noun: "customer PO",
  date: (p) => p.receivedDate ?? p.createdAt,
  dateLabel: "Received",
  money: (p) => ({ amount: p.amount, currency: p.currency }),
  cards: [
    { key: "all", label: "Customer POs", hint: "Recorded, not cancelled", test: cpoRecorded },
    { key: "pendingSo", label: "Pending SO", hint: "No sales order yet", tone: "text-amber-600 dark:text-amber-400", test: (p) => cpoOpen(p) && !p.salesOrderId },
    { key: "inProgress", label: "In progress", hint: "Sales order raised, not fulfilled", tone: "text-blue-600 dark:text-blue-400", test: (p) => cpoOpen(p) && !!p.salesOrderId },
    { key: "fulfilled", label: "Fulfilled", hint: "Delivered in full", tone: "text-green-600 dark:text-green-400", test: (p) => p.status === "fulfilled" },
    { key: "thisMonth", label: "This month", hint: "Received this month", test: (p, m) => cpoRecorded(p) && dateOf(p.receivedDate ?? p.createdAt) >= m },
    { key: "draft", label: "Drafts", hint: "Not recorded yet", tone: "text-muted-foreground", noValue: true, test: (p) => p.status === "draft" },
  ],
};

// ── Sales orders ──────────────────────────────────────────────────────────
// not submitted yet: a draft, or created with its stock outlook ("pending-do" / "pending-pr")
type SoLike = Row & { status: string; stockReservationStatus: string | null; createdAt: Date | string; grandTotal: string | null; currency?: string | null };
const soUnsubmitted = (p: SoLike) => p.status === "draft" || p.status === "pending-do" || p.status === "pending-pr";
const soLive = (p: SoLike) => !soUnsubmitted(p) && p.status !== "cancelled";
export const SO_STATS: StatConfig<SoLike> = {
  noun: "sales order",
  date: (p) => p.createdAt,
  dateLabel: "Created",
  money: (p) => ({ amount: p.grandTotal, currency: p.currency ?? "MYR" }),
  cards: [
    { key: "all", label: "Sales orders", hint: "Submitted, not cancelled", test: soLive },
    { key: "submitted", label: "Awaiting approval", hint: "Submitted, not approved yet", tone: "text-purple-600 dark:text-purple-400", test: (p) => p.status === "submitted" },
    { key: "short", label: "Short of stock", hint: "Approved, stock to buy (PR / supplier PO)", tone: "text-orange-600 dark:text-orange-400", test: (p) => p.status === "confirmed" && p.stockReservationStatus === "insufficient" },
    { key: "pendingDo", label: "Pending DO", hint: "Approved, stock reserved: ready to deliver", tone: "text-teal-600 dark:text-teal-400", test: (p) => p.status === "confirmed" && p.stockReservationStatus === "reserved" },
    { key: "fulfilled", label: "Fulfilled", hint: "Delivered in full", tone: "text-green-600 dark:text-green-400", test: (p) => p.status === "fulfilled" },
    { key: "thisMonth", label: "This month", hint: "Created this month", test: (p, m) => soLive(p) && dateOf(p.createdAt) >= m },
    { key: "draft", label: "Drafts", hint: "Not submitted yet", tone: "text-muted-foreground", test: soUnsubmitted },
  ],
};

// ── Purchase requisitions (no amounts: the cards show what each means) ─────
type PrLike = Row & { status: string; createdAt: Date | string };
const prLive = (p: PrLike) => !["draft", "cancelled", "rejected"].includes(p.status);
export const PR_STATS: StatConfig<PrLike> = {
  noun: "requisition",
  date: (p) => p.createdAt,
  dateLabel: "Raised",
  cards: [
    { key: "all", label: "Requisitions", hint: "Submitted, not cancelled", test: prLive },
    { key: "submitted", label: "Awaiting approval", hint: "Submitted, not approved yet", tone: "text-purple-600 dark:text-purple-400", test: (p) => p.status === "submitted" },
    { key: "approved", label: "Ready to order", hint: "Approved: raise the supplier PO", tone: "text-blue-600 dark:text-blue-400", test: (p) => p.status === "approved" },
    { key: "partly", label: "Partly ordered", hint: "Some lines on a supplier PO", tone: "text-cyan-600 dark:text-cyan-400", test: (p) => p.status === "partially_ordered" },
    { key: "ordered", label: "Fully ordered", hint: "Every line on a supplier PO", tone: "text-green-600 dark:text-green-400", test: (p) => p.status === "ordered" },
    { key: "thisMonth", label: "This month", hint: "Raised this month", test: (p, m) => prLive(p) && dateOf(p.createdAt) >= m },
    { key: "draft", label: "Drafts", hint: "Not submitted yet", tone: "text-muted-foreground", test: (p) => p.status === "draft" },
  ],
};

// ── Supplier POs ──────────────────────────────────────────────────────────
type PoLike = Row & { status: string; createdAt: Date | string; poDate: string | null; grandTotal: string | null; currency: string | null; receivedPct: number; pendingReturnQty: number; pendingRepairQty: number };
const poIssued = (p: PoLike) => p.status === "confirmed" || p.status === "fulfilled";
function poStats<T extends PoLike>(money: (p: T) => { amount: string | null; currency: string | null } | null): StatConfig<T> {
  return {
    noun: "supplier PO",
    date: (p) => p.poDate ?? p.createdAt,
    dateLabel: "PO date",
    money,
    cards: [
      { key: "all", label: "Supplier POs", hint: "Issued, not cancelled", test: poIssued },
      { key: "waiting", label: "Awaiting supplier", hint: "Issued, nothing received yet", tone: "text-blue-600 dark:text-blue-400", test: (p) => p.status === "confirmed" && p.receivedPct <= 0 },
      { key: "partly", label: "Partly received", hint: "Some goods in, the rest to come", tone: "text-amber-600 dark:text-amber-400", test: (p) => p.status === "confirmed" && p.receivedPct > 0 },
      { key: "fulfilled", label: "Fulfilled", hint: "Everything received", tone: "text-green-600 dark:text-green-400", test: (p) => p.status === "fulfilled" },
      { key: "action", label: "Return / repair", hint: "Received goods still to return or repair", tone: "text-red-600 dark:text-red-400", test: (p) => p.pendingReturnQty > 0 || p.pendingRepairQty > 0 },
      { key: "thisMonth", label: "This month", hint: "Made out this month", test: (p, m) => poIssued(p) && dateOf(p.poDate ?? p.createdAt) >= m },
      { key: "draft", label: "Drafts", hint: "Not issued yet", tone: "text-muted-foreground", noValue: true, test: (p) => p.status === "draft" || p.status === "submitted" },
    ],
  };
}
export const PO_STATS = poStats<PoLike>((p) => ({ amount: p.grandTotal, currency: p.currency }));
/** Centralized: a sibling company's PO the viewer can't edit doesn't show its amount, so it isn't added either */
export const PO_STATS_CENTRAL = poStats<PoLike & { canEdit: boolean }>((p) => (p.canEdit ? { amount: p.grandTotal, currency: p.currency } : null));

// ── Date filter ────────────────────────────────────────────────────────────
export type DatePreset = "all" | "today" | "7d" | "30d" | "thisMonth" | "lastMonth" | "thisQuarter" | "thisYear" | "lastYear" | "custom";
const DATE_PRESETS: { key: DatePreset; label: string }[] = [
  { key: "all", label: "Any date" },
  { key: "today", label: "Today" },
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "thisMonth", label: "This month" },
  { key: "lastMonth", label: "Last month" },
  { key: "thisQuarter", label: "This quarter" },
  { key: "thisYear", label: "This year" },
  { key: "lastYear", label: "Last year" },
  { key: "custom", label: "Custom range…" },
];
const fmtDay = (v: string) => new Date(`${v}T00:00:00`).toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" });
/** [from, to) in ms for a preset (local days); null ends are open */
function presetRange(p: DatePreset, from: string, to: string): [number | null, number | null] {
  const now = new Date();
  const day = (y: number, m: number, d: number) => new Date(y, m, d).getTime();
  const y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
  switch (p) {
    case "all": return [null, null];
    case "today": return [day(y, m, d), day(y, m, d + 1)];
    case "7d": return [day(y, m, d - 6), day(y, m, d + 1)];
    case "30d": return [day(y, m, d - 29), day(y, m, d + 1)];
    case "thisMonth": return [day(y, m, 1), day(y, m + 1, 1)];
    case "lastMonth": return [day(y, m - 1, 1), day(y, m, 1)];
    case "thisQuarter": { const q = Math.floor(m / 3) * 3; return [day(y, q, 1), day(y, q + 3, 1)]; }
    case "thisYear": return [day(y, 0, 1), day(y + 1, 0, 1)];
    case "lastYear": return [day(y - 1, 0, 1), day(y, 0, 1)];
    case "custom": {
      const f = from ? new Date(`${from}T00:00:00`).getTime() : null;
      const t = to ? new Date(`${to}T00:00:00`).getTime() + 86_400_000 : null; // "to" is inclusive
      return [f, t];
    }
  }
}

const NONE = "__none__";
const nameKey = (n: string) => n.trim().toLowerCase();

/**
 * The filters' state. byName: categories of several companies, chips matched by name.
 * Returns what's in the chosen categories (the stat cards count these) and the bucket filter.
 */
export function useListFilters<T extends Row>(pos: T[], categories: CategoryOption[], stats: StatConfig<T>, byName = false) {
  const [bucket, setBucket] = useState<string | null>(null);
  const [cats, setCats] = useState<Set<string>>(new Set());
  const [monthStart] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).getTime(); });
  const [datePreset, setDatePreset] = useState<DatePreset>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [rangeFrom, rangeTo] = presetRange(datePreset, dateFrom, dateTo);
  const inDate = (p: T) => {
    if (rangeFrom === null && rangeTo === null) return true;
    const v = stats.date(p);
    if (!v) return false;
    const t = new Date(v).getTime();
    return (rangeFrom === null || t >= rangeFrom) && (rangeTo === null || t < rangeTo);
  };
  const dateActive = rangeFrom !== null || rangeTo !== null;
  const dateText = !dateActive ? null
    : datePreset === "custom"
      ? `${stats.dateLabel} ${dateFrom && dateTo ? `${fmtDay(dateFrom)} – ${fmtDay(dateTo)}` : dateFrom ? `from ${fmtDay(dateFrom)}` : `until ${fmtDay(dateTo)}`}`
      : `${stats.dateLabel} ${DATE_PRESETS.find((x) => x.key === datePreset)?.label.toLowerCase()}`;
  const clearDate = () => { setDatePreset("all"); setDateFrom(""); setDateTo(""); };

  const byId = new Map(categories.map((c) => [c.id, c]));
  const keyOf = (c: CategoryOption) => (byName ? nameKey(c.name) : c.id);
  // the chips: one per category (per name when byName, the first company's colour)
  const options: CategoryOption[] = [];
  const seen = new Set<string>();
  for (const c of categories) {
    const k = keyOf(c);
    if (seen.has(k)) continue;
    seen.add(k);
    options.push({ ...c, id: k });
  }

  const categoriesOf = (p: T): CategoryOption[] =>
    (Array.isArray(p.categoryIds) ? (p.categoryIds as string[]) : []).map((id) => byId.get(id)).filter((c): c is CategoryOption => !!c);
  const inCats = (p: T) => {
    if (cats.size === 0) return true;
    const keys = categoriesOf(p).map(keyOf);
    return keys.length === 0 ? cats.has(NONE) : keys.some((k) => cats.has(k));
  };
  const toggle = (k: string) => setCats((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  const inScope = pos.filter((p) => inCats(p) && inDate(p));
  const card = stats.cards.find((c) => c.key === bucket);
  return {
    stats, bucket, setBucket, monthStart, inScope, categoriesOf, options, cats, toggle,
    datePreset, setDatePreset, dateFrom, setDateFrom, dateTo, setDateTo, dateActive, clearDate,
    clearCats: () => setCats(new Set()),
    /** passes the bucket filter */
    inBucketNow: (p: T) => !card || card.test(p, monthStart),
    /** search text matches one of its categories */
    searchCats: (p: T, s: string) => categoriesOf(p).some((c) => c.name.toLowerCase().includes(s)),
    /** "· Laser or Others · Pending SO" for the record count line */
    activeText: [
      ...(dateText ? [dateText] : []),
      ...(cats.size > 0 ? [[...cats].map((k) => (k === NONE ? "No category" : options.find((o) => o.id === k)?.name)).filter(Boolean).join(" or ")] : []),
      ...(card ? [card.label] : []),
    ],
    anyActive: cats.size > 0 || !!bucket || dateActive,
    clearAll: () => { setCats(new Set()); setBucket(null); clearDate(); },
  };
}

type Filters<T extends Row> = ReturnType<typeof useListFilters<T>>;

export function StatCards<T extends Row>({ f }: { f: Filters<T> }) {
  const n = f.stats.cards.length;
  return (
    <div className={cn("mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3", n >= 7 ? "lg:grid-cols-7" : "lg:grid-cols-6")}>
      {f.stats.cards.map((b) => {
        const rows = f.inScope.filter((p) => b.test(p, f.monthStart));
        const on = f.bucket === b.key;
        return (
          <button
            key={b.key}
            type="button"
            aria-pressed={on}
            onClick={() => f.setBucket(on ? null : b.key)}
            title={on ? `Show every ${f.stats.noun}` : `Show only: ${b.hint.toLowerCase()}`}
            className={cn("rounded-xl border p-3 text-left transition-colors hover:bg-muted/30", on ? "border-primary bg-primary/5" : "border-border")}
          >
            <div className="text-[11px] font-medium text-muted-foreground">{b.label}</div>
            <div className={cn("text-xl font-semibold tabular-nums", rows.length > 0 && b.tone)}>{rows.length}</div>
            {(() => {
              const money = f.stats.money;
              const text = b.noValue || !money || (rows.length > 0 && rows.every((r) => !money(r))) ? b.hint : valueText(rows, money);
              return <div className="truncate text-[11px] tabular-nums text-muted-foreground" title={text === b.hint ? b.hint : `${text} · ${b.hint}`}>{text}</div>;
            })()}
          </button>
        );
      })}
    </div>
  );
}

/** The filter bar under the stat cards: the date (by the list's own date) and the category chips. */
export function CategoryFilter<T extends Row>({ f }: { f: Filters<T> }) {
  const sel = "h-7 rounded-md border border-border bg-background px-2 text-xs";
  return (
    <div className="mb-4 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-medium text-muted-foreground">{f.stats.dateLabel}:</span>
        <select value={f.datePreset} onChange={(e) => f.setDatePreset(e.target.value as DatePreset)}
          className={cn(sel, f.dateActive && "border-primary text-foreground")} aria-label={`${f.stats.dateLabel} date`}>
          {DATE_PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
        {f.datePreset === "custom" && (
          <>
            <input type="date" value={f.dateFrom} max={f.dateTo || undefined} onChange={(e) => f.setDateFrom(e.target.value)} className={sel} aria-label="From" />
            <span className="text-[11px] text-muted-foreground">to</span>
            <input type="date" value={f.dateTo} min={f.dateFrom || undefined} onChange={(e) => f.setDateTo(e.target.value)} className={sel} aria-label="To" />
          </>
        )}
        {f.dateActive && (
          <button type="button" onClick={f.clearDate} className="text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground">clear</button>
        )}
      </div>
      {f.options.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-medium text-muted-foreground">Categories:</span>
          {f.options.map((c) => <CategoryChip key={c.id} option={c} selected={f.cats.has(c.id)} onClick={() => f.toggle(c.id)} />)}
          <CategoryChip option={{ id: NONE, name: "No category", color: "#94a3b8" }} selected={f.cats.has(NONE)} onClick={() => f.toggle(NONE)} />
          {f.cats.size > 0 && (
            <button type="button" onClick={f.clearCats} className="text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground">clear</button>
          )}
        </div>
      )}
    </div>
  );
}

/** The record count line: "12 records · Laser · Pending SO  show all" */
export function RecordCount<T extends Row>({ f, count, noun = "record" }: { f: Filters<T>; count: number; noun?: string }) {
  return (
    <div className="mb-3 text-xs tabular-nums text-muted-foreground">
      {count} {noun}{count !== 1 ? "s" : ""}
      {f.activeText.map((t) => <span key={t}> · {t}</span>)}
      {f.anyActive && (
        <>
          {" "}
          <button type="button" onClick={f.clearAll} className="underline underline-offset-2 hover:text-foreground">show all</button>
        </>
      )}
    </div>
  );
}

/** A row's categories, as small coloured tags. */
export function CategoryTags({ list, query }: { list: CategoryOption[]; query: string }) {
  return (
    <>
      {list.map((c) => (
        <span key={c.id} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium"
          style={{ backgroundColor: (c.color ?? "#6366f1") + "1f", color: c.color ?? "#6366f1" }}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: c.color ?? "#6366f1" }} />
          <Highlight text={c.name} query={query} />
        </span>
      ))}
    </>
  );
}
