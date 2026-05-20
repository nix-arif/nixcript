"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  getQuotationsList,
  deleteQuotation,
  type QuotationListGroup,
} from "@/server/quotation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  PlusIcon,
  SearchIcon,
  EyeIcon,
  TrashIcon,
  XIcon,
  LayersIcon,
  FileTextIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CalendarIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 10;

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
}

export function QuotationListClient({ initialGroups }: Props) {
  const router = useRouter();
  const [groups, setGroups] = useState(initialGroups);
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const hasDateFilter = dateFrom || dateTo;

  // Reset to page 1 when filters change
  useEffect(() => { setPage(1); }, [search, dateFrom, dateTo]);

  const filtered = groups.filter((g) => {
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
      (g.title?.toLowerCase().includes(s) ?? false)
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
      setGroups(await getQuotationsList());
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
    <div className="p-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Quotations</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage and generate customer quotations
          </p>
        </div>
        <Button
          onClick={() => router.push("/dashboard/sales/quotation/new")}
          className="gap-2"
        >
          <PlusIcon className="w-4 h-4" /> New quotation
        </Button>
      </div>

      {/* Search */}
      <div className="flex items-center gap-3 mb-3">
        <div className="relative flex-1">
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by quotation no., customer, org, sales person..."
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
        <div className="ml-auto text-xs text-muted-foreground whitespace-nowrap tabular-nums">
          {filtered.length} group{filtered.length !== 1 ? "s" : ""} ·{" "}
          {totalMembers} quotation{totalMembers !== 1 ? "s" : ""}
          {totalPages > 1 && ` · page ${safePage}/${totalPages}`}
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
            const isDraft = group.status === "draft";
            const isDeleting = deleting === group.primaryId;

            /* ── Single quotation ──────────────────────────────────────── */
            if (group.mode === "single") {
              const m = group.members[0];
              return (
                <div
                  key={group.primaryId}
                  className="border border-border rounded-xl bg-background hover:bg-muted/20 transition-colors"
                >
                  <div className="flex items-center gap-3 px-4 py-3">
                    <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-muted/40 shrink-0">
                      <FileTextIcon className="w-3.5 h-3.5 text-muted-foreground" />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-sm font-medium">
                          {m.quotationNo}
                        </span>
                        {group.title && group.title !== "Loose Items" && (
                          <span className="text-[10px] border border-border rounded px-1.5 py-0.5 text-muted-foreground">
                            {group.title}
                          </span>
                        )}
                        <span className="text-[10px] font-medium bg-muted/60 rounded px-1.5 py-0.5 text-muted-foreground tabular-nums">
                          {fmtDate(group.createdAt)}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-muted-foreground flex-wrap">
                        {custName && <span>{custName}</span>}
                        {group.salesPersonName && (
                          <>
                            {custName && <span>·</span>}
                            <span>{group.salesPersonName}</span>
                          </>
                        )}
                        {m.orgName && (
                          <>
                            {(custName || group.salesPersonName) && <span>·</span>}
                            <span>{m.orgName}</span>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-sm font-semibold tabular-nums">
                        {fmt(m.grandTotal)}
                      </span>
                      <StatusBadge status={group.status} />
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-muted-foreground"
                          onClick={() =>
                            router.push(
                              `/dashboard/sales/quotation/${m.id}`,
                            )
                          }
                        >
                          <EyeIcon className="w-3.5 h-3.5" />
                        </Button>
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
                  </div>
                </div>
              );
            }

            /* ── Comparison group ──────────────────────────────────────── */
            return (
              <div
                key={group.groupId ?? group.primaryId}
                className="border border-border rounded-xl bg-background overflow-hidden"
              >
                {/* Group header */}
                <div className="flex items-center gap-3 px-4 py-3 bg-muted/30 border-b border-border">
                  <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-900/30 shrink-0">
                    <LayersIcon className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[11px] font-semibold text-blue-600 dark:text-blue-400 tabular-nums">
                        Compare · {group.members.length}
                      </span>
                      {custName && (
                        <span className="text-sm font-medium">{custName}</span>
                      )}
                      {group.title && group.title !== "Loose Items" && (
                        <span className="text-[10px] border border-border rounded px-1.5 py-0.5 text-muted-foreground">
                          {group.title}
                        </span>
                      )}
                      <span className="text-[10px] font-medium bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 rounded px-1.5 py-0.5 tabular-nums">
                        {fmtDate(group.createdAt)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-muted-foreground flex-wrap">
                      {group.salesPersonName && (
                        <span>{group.salesPersonName}</span>
                      )}
                    </div>
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

                {/* Member rows */}
                {group.members.map((m, mi) => (
                  <div
                    key={m.id}
                    className={cn(
                      "flex items-center gap-3 px-4 py-2.5",
                      mi < group.members.length - 1
                        ? "border-b border-border/50"
                        : "",
                    )}
                  >
                    {/* Original vs alternative indicator */}
                    <div className="w-8 flex justify-center shrink-0">
                      <div
                        className={cn(
                          "w-2 h-2 rounded-full",
                          m.isDummy === 0
                            ? "bg-primary"
                            : "border border-muted-foreground/40 bg-transparent",
                        )}
                      />
                    </div>

                    <div className="flex-1 min-w-0 flex items-center gap-2">
                      <span className="font-mono text-xs font-medium shrink-0">
                        {m.quotationNo}
                      </span>
                      {m.isDummy === 0 ? (
                        <span className="text-[9px] font-medium border border-primary/30 text-primary rounded px-1.5 py-0.5 shrink-0">
                          Original
                        </span>
                      ) : (
                        <span className="text-[9px] font-medium border border-border text-muted-foreground rounded px-1.5 py-0.5 shrink-0">
                          Alternative
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground truncate">
                        {m.orgName}
                      </span>
                    </div>

                    <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
                      {fmtDate(m.createdAt)}
                    </span>

                    <span className="text-xs font-semibold tabular-nums shrink-0">
                      {fmt(m.grandTotal)}
                    </span>

                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-muted-foreground shrink-0"
                      onClick={() =>
                        router.push(`/dashboard/sales/quotation/${m.id}`)
                      }
                    >
                      <EyeIcon className="w-3.5 h-3.5" />
                    </Button>
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
