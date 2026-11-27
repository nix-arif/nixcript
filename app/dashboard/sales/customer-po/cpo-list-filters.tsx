"use client";

// The customer PO lists' stat cards (each also a filter) and category filter chips, shared by the
// company's own list and the centralized lists. On a centralized list the companies each have
// their own categories, so the chips go by name: "Laser" picks every company's Laser.

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Highlight } from "@/components/highlight";
import { CategoryChip } from "@/components/document-categories-card";
import type { CategoryOption } from "@/server/document-category-chain";

type CpoLike = {
  status: string;
  salesOrderId: string | null;
  receivedDate: Date | string | null;
  createdAt: Date | string;
  amount: string | null;
  currency: string | null;
  categoryIds: unknown;
};

export type Bucket = "all" | "pendingSo" | "inProgress" | "fulfilled" | "draft" | "thisMonth";

const isOpen = (p: CpoLike) => p.status !== "cancelled" && p.status !== "fulfilled" && p.status !== "draft";
export function inBucket(p: CpoLike, b: Bucket, monthStart: number): boolean {
  switch (b) {
    case "all": return p.status !== "cancelled" && p.status !== "draft";
    case "pendingSo": return isOpen(p) && !p.salesOrderId;
    case "inProgress": return isOpen(p) && !!p.salesOrderId;
    case "fulfilled": return p.status === "fulfilled";
    case "draft": return p.status === "draft";
    case "thisMonth": return p.status !== "cancelled" && p.status !== "draft" && new Date(p.receivedDate ?? p.createdAt).getTime() >= monthStart;
  }
}

export const BUCKETS: { key: Bucket; label: string; hint: string; tone?: string }[] = [
  { key: "all", label: "Customer POs", hint: "Recorded, not cancelled" },
  { key: "pendingSo", label: "Pending SO", hint: "No sales order yet", tone: "text-amber-600 dark:text-amber-400" },
  { key: "inProgress", label: "In progress", hint: "Sales order raised, not fulfilled", tone: "text-blue-600 dark:text-blue-400" },
  { key: "fulfilled", label: "Fulfilled", hint: "Delivered in full", tone: "text-green-600 dark:text-green-400" },
  { key: "thisMonth", label: "This month", hint: "Received this month" },
  { key: "draft", label: "Drafts", hint: "Not recorded yet", tone: "text-muted-foreground" },
];

const rm = (v: number) => `RM ${v.toLocaleString("en-MY", { minimumFractionDigits: 2 })}`;
/** The value per currency (RM first), e.g. "RM 12,400.00 + USD 300.00" */
export function valueText(rows: CpoLike[]): string {
  const by = new Map<string, number>();
  for (const r of rows) by.set(r.currency || "MYR", (by.get(r.currency || "MYR") ?? 0) + Number(r.amount ?? 0));
  if (by.size === 0) return rm(0);
  return [...by.entries()].sort(([a], [b]) => (a === "MYR" ? -1 : b === "MYR" ? 1 : a.localeCompare(b)))
    .map(([c, v]) => (c === "MYR" ? rm(v) : `${c} ${v.toLocaleString("en-MY", { minimumFractionDigits: 2 })}`)).join(" + ");
}

const NONE = "__none__";
const nameKey = (n: string) => n.trim().toLowerCase();

/**
 * The filters' state. byName: categories of several companies, chips matched by name.
 * Returns what's in the chosen categories (the stat cards count these) and the bucket filter.
 */
export function useCpoFilters<T extends CpoLike>(pos: T[], categories: CategoryOption[], byName = false) {
  const [bucket, setBucket] = useState<Bucket | null>(null);
  const [cats, setCats] = useState<Set<string>>(new Set());
  const [monthStart] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).getTime(); });

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

  const inScope = pos.filter(inCats);
  return {
    bucket, setBucket, monthStart, inScope, categoriesOf, options, cats, toggle,
    clearCats: () => setCats(new Set()),
    /** passes the bucket filter */
    inBucketNow: (p: T) => !bucket || inBucket(p, bucket, monthStart),
    /** search text matches one of its categories */
    searchCats: (p: T, s: string) => categoriesOf(p).some((c) => c.name.toLowerCase().includes(s)),
    /** "· Laser or Others · Pending SO" for the record count line */
    activeText: [
      ...(cats.size > 0 ? [[...cats].map((k) => (k === NONE ? "No category" : options.find((o) => o.id === k)?.name)).filter(Boolean).join(" or ")] : []),
      ...(bucket ? [BUCKETS.find((b) => b.key === bucket)?.label ?? ""] : []),
    ],
    anyActive: cats.size > 0 || !!bucket,
    clearAll: () => { setCats(new Set()); setBucket(null); },
  };
}

type Filters<T extends CpoLike> = ReturnType<typeof useCpoFilters<T>>;

export function CpoStatCards<T extends CpoLike>({ f }: { f: Filters<T> }) {
  return (
    <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {BUCKETS.map((b) => {
        const rows = f.inScope.filter((p) => inBucket(p, b.key, f.monthStart));
        const on = f.bucket === b.key;
        return (
          <button
            key={b.key}
            type="button"
            aria-pressed={on}
            onClick={() => f.setBucket(on ? null : b.key)}
            title={on ? "Show every customer PO" : `Show only: ${b.hint.toLowerCase()}`}
            className={cn("rounded-xl border p-3 text-left transition-colors hover:bg-muted/30", on ? "border-primary bg-primary/5" : "border-border")}
          >
            <div className="text-[11px] font-medium text-muted-foreground">{b.label}</div>
            <div className={cn("text-xl font-semibold tabular-nums", rows.length > 0 && b.tone)}>{rows.length}</div>
            <div className="truncate text-[11px] tabular-nums text-muted-foreground" title={valueText(rows)}>
              {b.key === "draft" ? b.hint : valueText(rows)}
            </div>
          </button>
        );
      })}
    </div>
  );
}

export function CpoCategoryFilter<T extends CpoLike>({ f }: { f: Filters<T> }) {
  if (f.options.length === 0) return null;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <span className="text-[11px] font-medium text-muted-foreground">Categories:</span>
      {f.options.map((c) => <CategoryChip key={c.id} option={c} selected={f.cats.has(c.id)} onClick={() => f.toggle(c.id)} />)}
      <CategoryChip option={{ id: NONE, name: "No category", color: "#94a3b8" }} selected={f.cats.has(NONE)} onClick={() => f.toggle(NONE)} />
      {f.cats.size > 0 && (
        <button type="button" onClick={f.clearCats} className="text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground">clear</button>
      )}
    </div>
  );
}

/** The record count line: "12 records · Laser · Pending SO  show all" */
export function CpoRecordCount<T extends CpoLike>({ f, count }: { f: Filters<T>; count: number }) {
  return (
    <div className="mb-3 text-xs tabular-nums text-muted-foreground">
      {count} record{count !== 1 ? "s" : ""}
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
export function CpoCategoryTags({ list, query }: { list: CategoryOption[]; query: string }) {
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
