"use client";

import { OrderProgressBadge } from "@/components/so-stock-chip";
import { RevBadge, useRevisions } from "@/components/amendment-history";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  getCustomerPos,
  deleteCustomerPo,
  type CustomerPoListRow,
} from "@/server/customer-purchase-order";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/page-header";
import { Highlight } from "@/components/highlight";
import {
  PlusIcon,
  SearchIcon,
  XIcon,
  FileTextIcon,
  PencilIcon,
  TrashIcon,
  UserIcon,
  BuildingIcon,
  LayoutListIcon,
  PackageIcon,
  Link2Icon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { CpoTrailHover } from "./cpo-trail-hover";
import { CategoryChip } from "@/components/document-categories-card";
import type { CategoryOption } from "@/server/document-category-chain";

const fmt = (v: string | number | null | undefined) =>
  `RM ${Number(v ?? 0).toLocaleString("en-MY", { minimumFractionDigits: 2 })}`;

const fmtDate = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const STATUS: Record<string, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-slate-100 dark:bg-slate-800/50 text-slate-700 dark:text-slate-300" },
  received: { label: "Received", className: "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400" },
  acknowledged: { label: "Acknowledged", className: "bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400" },
  fulfilled: { label: "Fulfilled", className: "bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400" },
  cancelled: { label: "Cancelled", className: "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400" },
};

// The stat cards above the list, each also a filter
type Bucket = "all" | "pendingSo" | "inProgress" | "fulfilled" | "draft" | "thisMonth";
const isOpen = (p: CustomerPoListRow) => p.status !== "cancelled" && p.status !== "fulfilled" && p.status !== "draft";
const inBucket = (p: CustomerPoListRow, b: Bucket, monthStart: number) => {
  switch (b) {
    case "all": return p.status !== "cancelled" && p.status !== "draft";
    case "pendingSo": return isOpen(p) && !p.salesOrderId;
    case "inProgress": return isOpen(p) && !!p.salesOrderId;
    case "fulfilled": return p.status === "fulfilled";
    case "draft": return p.status === "draft";
    case "thisMonth": return p.status !== "cancelled" && p.status !== "draft" && new Date(p.receivedDate ?? p.createdAt).getTime() >= monthStart;
  }
};
const BUCKETS: { key: Bucket; label: string; hint: string; tone?: string }[] = [
  { key: "all", label: "Customer POs", hint: "Recorded, not cancelled" },
  { key: "pendingSo", label: "Pending SO", hint: "No sales order yet", tone: "text-amber-600 dark:text-amber-400" },
  { key: "inProgress", label: "In progress", hint: "Sales order raised, not fulfilled", tone: "text-blue-600 dark:text-blue-400" },
  { key: "fulfilled", label: "Fulfilled", hint: "Delivered in full", tone: "text-green-600 dark:text-green-400" },
  { key: "thisMonth", label: "This month", hint: "Received this month" },
  { key: "draft", label: "Drafts", hint: "Not recorded yet", tone: "text-muted-foreground" },
];
// the value per currency (RM first), e.g. "RM 12,400.00 + USD 300.00"
function valueText(rows: CustomerPoListRow[]): string {
  const by = new Map<string, number>();
  for (const r of rows) by.set(r.currency || "MYR", (by.get(r.currency || "MYR") ?? 0) + Number(r.amount ?? 0));
  if (by.size === 0) return fmt(0);
  return [...by.entries()].sort(([a], [b]) => (a === "MYR" ? -1 : b === "MYR" ? 1 : a.localeCompare(b)))
    .map(([c, v]) => (c === "MYR" ? fmt(v) : `${c} ${v.toLocaleString("en-MY", { minimumFractionDigits: 2 })}`)).join(" + ");
}

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS[status] ?? STATUS.received;
  return <span className={cn("text-[11px] font-medium rounded px-2 py-0.5", cfg.className)}>{cfg.label}</span>;
}

const catIds = (p: CustomerPoListRow) => (Array.isArray(p.categoryIds) ? (p.categoryIds as string[]) : []);

export function CustomerPoClient({ initialPos, canCreateSo = false, categories = [] }: { initialPos: CustomerPoListRow[]; canCreateSo?: boolean; categories?: CategoryOption[] }) {
  const router = useRouter();
  const [pos, setPos] = useState(initialPos);
  // Server data re-sent (live refresh / router.refresh): show it
  const [seenInitialPos, setSeenInitialPos] = useState(initialPos);
  if (initialPos !== seenInitialPos) { setSeenInitialPos(initialPos); setPos(initialPos); }
  const [search, setSearch] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);

  const [bucket, setBucket] = useState<Bucket | null>(null);
  // category filter: a CPO with any of the chosen categories ("none": no category at all)
  const [cats, setCats] = useState<Set<string>>(new Set());
  const catById = new Map(categories.map((c) => [c.id, c]));
  const inCats = (p: CustomerPoListRow) => {
    if (cats.size === 0) return true;
    const ids = catIds(p).filter((id) => catById.has(id));
    return ids.length === 0 ? cats.has("none") : ids.some((id) => cats.has(id));
  };
  const toggleCat = (id: string) => setCats((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const inScope = pos.filter(inCats); // what the stat cards count
  const [monthStart] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).getTime(); });

  const revs = useRevisions("cpo", pos.map((x) => x.id)); // amended: Rev N by the number
  const filtered = inScope.filter((p) => {
    if (bucket && !inBucket(p, bucket, monthStart)) return false;
    if (!search) return true;
    const s = search.toLowerCase();
    const snap = p.customerSnapshot as any;
    return (
      catIds(p).some((id) => catById.get(id)?.name.toLowerCase().includes(s)) ||
      p.customerPoNo.toLowerCase().includes(s) ||
      [snap?.title, snap?.name].filter(Boolean).join(" ").toLowerCase().includes(s) ||
      snap?.organizationName?.toLowerCase().includes(s) ||
      p.quotationNo?.toLowerCase().includes(s) ||
      p.salesOrderNo?.toLowerCase().includes(s)
    );
  });

  async function handleDelete(id: string, poNo: string) {
    if (!confirm(`Delete Customer PO "${poNo}"?`)) return;
    setDeleting(id);
    try {
      await deleteCustomerPo(id);
      setPos(await getCustomerPos());
      toast.success("Customer PO deleted");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="p-6">
      <PageHeader
        title="Customer Purchase Orders"
        description="Track PO documents received from customers"
        action={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="gap-1.5"
              onClick={() => router.push("/dashboard/sales/customer-po/summary")}>
              <LayoutListIcon className="w-3.5 h-3.5" /> Summary table
            </Button>
            <Button onClick={() => router.push("/dashboard/sales/customer-po/create")} className="gap-2">
              <PlusIcon className="w-4 h-4" /> Record customer PO
            </Button>
          </div>
        }
      />

      {/* Stat cards: each one filters the list (click again to show everything) */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {BUCKETS.map((b) => {
          const rows = inScope.filter((p) => inBucket(p, b.key, monthStart));
          const on = bucket === b.key;
          return (
            <button
              key={b.key}
              type="button"
              aria-pressed={on}
              onClick={() => setBucket(on ? null : b.key)}
              title={on ? "Show every customer PO" : `Show only: ${b.hint.toLowerCase()}`}
              className={cn(
                "rounded-xl border p-3 text-left transition-colors hover:bg-muted/30",
                on ? "border-primary bg-primary/5" : "border-border",
              )}
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

      {categories.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-medium text-muted-foreground">Categories:</span>
          {categories.map((c) => (
            <CategoryChip key={c.id} option={c} selected={cats.has(c.id)} onClick={() => toggleCat(c.id)} />
          ))}
          <CategoryChip option={{ id: "none", name: "No category", color: "#94a3b8" }} selected={cats.has("none")} onClick={() => toggleCat("none")} />
          {cats.size > 0 && (
            <button type="button" onClick={() => setCats(new Set())} className="text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground">
              clear
            </button>
          )}
        </div>
      )}

      <div className="relative mb-4">
        <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by PO no., customer, QT no., SO no., category..."
          className="pl-9 h-9 text-sm"
        />
        {search && (
          <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
            <XIcon className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <div className="text-xs text-muted-foreground mb-3 tabular-nums">
        {filtered.length} record{filtered.length !== 1 ? "s" : ""}
        {cats.size > 0 && <> · {[...cats].map((id) => (id === "none" ? "No category" : catById.get(id)?.name)).filter(Boolean).join(" or ")}</>}
        {bucket && (
          <>
            {" "}· {BUCKETS.find((b) => b.key === bucket)?.label}{" "}
            <button type="button" onClick={() => setBucket(null)} className="underline underline-offset-2 hover:text-foreground">show all</button>
          </>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="border border-border rounded-xl py-16 text-center text-muted-foreground">
          <FileTextIcon className="w-8 h-8 mx-auto mb-3 opacity-30" />
          <div className="text-sm font-medium mb-1">{bucket || search || cats.size > 0 ? "No customer POs match" : "No customer POs recorded"}</div>
          <div className="text-xs mb-4">Record the first customer purchase order</div>
          <Button variant="outline" size="sm" className="gap-2" onClick={() => router.push("/dashboard/sales/customer-po/create")}>
            <PlusIcon className="w-3.5 h-3.5" /> Record customer PO
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((p) => {
            const snap = p.customerSnapshot as any;
            return (
              <CpoTrailHover key={p.id} id={p.id} poNo={p.customerPoNo}>
              <div
                className="border border-border rounded-xl bg-background hover:bg-muted/20 transition-colors cursor-pointer"
                onClick={() => router.push(p.status === "draft" ? `/dashboard/sales/customer-po/${p.id}/edit` : `/dashboard/sales/customer-po/${p.id}`)}
              >
                <div className="flex items-center gap-3 px-4 py-3">
                  <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-muted/40 shrink-0">
                    <FileTextIcon className="w-3.5 h-3.5 text-muted-foreground" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {/* the number, and its revision below it */}
                      <span className="inline-flex flex-col items-start gap-0.5 leading-tight">
                        <span className="font-mono text-sm font-medium">
                        <Highlight text={p.customerPoNo} query={search} />
                        </span>
                        <RevBadge revision={revs[p.id]} />
                      </span>
                      <StatusBadge status={p.status} />
                      <OrderProgressBadge soId={p.salesOrderId} />
                      {p.isIntercompany && (
                        <span
                          className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800"
                          title="Auto-created from a sibling organization's purchase order"
                        >
                          <Link2Icon className="w-3 h-3 shrink-0" />
                          Intercompany
                        </span>
                      )}
                      {p.quotationNo && (
                        <span className="text-[10px] bg-muted/50 text-muted-foreground rounded px-1.5 py-0.5 font-mono">
                          QT: <Highlight text={p.quotationNo} query={search} />
                        </span>
                      )}
                      {p.salesOrderNo ? (
                        <span className="text-[10px] bg-muted/50 text-muted-foreground rounded px-1.5 py-0.5 font-mono">
                          SO: <Highlight text={p.salesOrderNo} query={search} />
                        </span>
                      ) : p.status !== "cancelled" && p.status !== "fulfilled" ? (
                        <span className="text-[10px] bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 rounded px-1.5 py-0.5 font-medium">
                          Pending SO
                        </span>
                      ) : null}
                      <span className="text-[10px] text-muted-foreground bg-muted/50 rounded px-1.5 py-0.5 ml-auto tabular-nums">
                        {fmtDate(p.receivedDate ?? p.createdAt)}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                      {snap?.name && (
                        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          <UserIcon className="w-3 h-3" />
                          <Highlight text={[snap.title, snap.name].filter(Boolean).join(" ")} query={search} />
                        </span>
                      )}
                      {snap?.organizationName && (
                        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          <BuildingIcon className="w-3 h-3" />
                          <Highlight text={snap.organizationName} query={search} />
                        </span>
                      )}
                      {catIds(p).map((id) => catById.get(id)).filter((c): c is CategoryOption => !!c).map((c) => (
                        <span key={c.id} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium"
                          style={{ backgroundColor: (c.color ?? "#6366f1") + "1f", color: c.color ?? "#6366f1" }}>
                          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: c.color ?? "#6366f1" }} />
                          <Highlight text={c.name} query={search} />
                        </span>
                      ))}
                      <span className="text-[11px] font-semibold text-foreground ml-auto tabular-nums">
                        {fmt(p.amount)} {p.currency !== "MYR" ? p.currency : ""}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                    {canCreateSo && !p.salesOrderId && p.status !== "cancelled" && p.status !== "fulfilled" && p.status !== "draft" && (
                      <Button
                        variant="ghost" size="icon" className="w-7 h-7 text-amber-600 dark:text-amber-400 hover:text-amber-700"
                        title="Create Sales Order"
                        onClick={() => router.push(`/dashboard/sales/order/create?cpoId=${p.id}`)}
                      >
                        <PackageIcon className="w-3.5 h-3.5" />
                      </Button>
                    )}
                    <Button
                      variant="ghost" size="icon" className="w-7 h-7"
                      onClick={() => router.push(`/dashboard/sales/customer-po/${p.id}/edit`)}
                    >
                      <PencilIcon className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      variant="ghost" size="icon" className="w-7 h-7 text-destructive hover:text-destructive"
                      disabled={deleting === p.id}
                      onClick={() => handleDelete(p.id, p.customerPoNo)}
                    >
                      <TrashIcon className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
              </CpoTrailHover>
            );
          })}
        </div>
      )}
    </div>
  );
}
