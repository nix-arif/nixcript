"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/page-header";
import { Highlight } from "@/components/highlight";
import {
  ArrowLeftIcon, SearchIcon, XIcon, ChevronUpIcon, ChevronDownIcon,
  ChevronsUpDownIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { CustomerPoSummaryRow, PaymentStatus } from "@/server/customer-purchase-order";

// ── Formatters ─────────────────────────────────────────────────────────────
const fmtAmt = (v: number) =>
  `RM ${v.toLocaleString("en-MY", { minimumFractionDigits: 2 })}`;

const fmtDate = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" }) : "—";

// ── Badge helpers ──────────────────────────────────────────────────────────
const CPO_STATUS: Record<string, { label: string; cls: string }> = {
  received:     { label: "Received",     cls: "bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400" },
  acknowledged: { label: "Acknowledged", cls: "bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400" },
  fulfilled:    { label: "Fulfilled",    cls: "bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400" },
  cancelled:    { label: "Cancelled",    cls: "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400" },
};
const SO_STATUS: Record<string, { label: string; cls: string }> = {
  draft:     { label: "Draft",     cls: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400" },
  submitted: { label: "Submitted", cls: "bg-purple-50 text-purple-700 dark:bg-purple-900/20 dark:text-purple-400" },
  confirmed: { label: "Confirmed", cls: "bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400" },
  fulfilled: { label: "Fulfilled", cls: "bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400" },
  cancelled: { label: "Cancelled", cls: "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400" },
};
const INV_STATUS: Record<string, { label: string; cls: string }> = {
  draft:     { label: "Draft",     cls: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400" },
  sent:      { label: "Sent",      cls: "bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400" },
  paid:      { label: "Paid",      cls: "bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400" },
  overdue:   { label: "Overdue",   cls: "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400" },
  cancelled: { label: "Cancelled", cls: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400" },
};
const PAY_STATUS: Record<PaymentStatus, { label: string; cls: string }> = {
  none:    { label: "—",        cls: "text-muted-foreground" },
  unpaid:  { label: "Unpaid",   cls: "text-muted-foreground" },
  partial: { label: "Partial",  cls: "text-amber-600 dark:text-amber-400 font-medium" },
  paid:    { label: "Paid",     cls: "text-green-600 dark:text-green-400 font-medium" },
  overdue: { label: "Overdue",  cls: "text-red-600 dark:text-red-400 font-semibold" },
};

function Badge({ label, cls }: { label: string; cls: string }) {
  return <span className={cn("text-[10px] font-medium rounded px-1.5 py-0.5 whitespace-nowrap", cls)}>{label}</span>;
}

// ── Sort ───────────────────────────────────────────────────────────────────
type SortKey = "date" | "customer" | "amount" | "so" | "do" | "invoice" | "payment";
type SortDir = "asc" | "desc";

function SortBtn({ col, active, dir, onClick }: { col: SortKey; active: SortKey; dir: SortDir; onClick: () => void }) {
  const isActive = col === active;
  return (
    <button onClick={onClick} className="inline-flex items-center gap-0.5 group">
      {isActive ? (
        dir === "asc" ? <ChevronUpIcon className="w-3 h-3" /> : <ChevronDownIcon className="w-3 h-3" />
      ) : (
        <ChevronsUpDownIcon className="w-3 h-3 opacity-30 group-hover:opacity-70" />
      )}
    </button>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────
export function CustomerPoSummaryClient({ rows }: { rows: CustomerPoSummaryRow[] }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey]  = useState<SortKey>("date");
  const [sortDir, setSortDir]  = useState<SortDir>("desc");

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  }

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return rows.filter((r) => {
      if (!q) return true;
      const snap = r.cpo.customerSnapshot as any;
      return (
        r.cpo.customerPoNo.toLowerCase().includes(q) ||
        snap?.name?.toLowerCase().includes(q) ||
        snap?.organizationName?.toLowerCase().includes(q) ||
        r.soNo?.toLowerCase().includes(q) ||
        r.invoices.some((inv) => inv.invoiceNo.toLowerCase().includes(q)) ||
        r.cpo.quotationNo?.toLowerCase().includes(q)
      );
    });
  }, [rows, search]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      if (sortKey === "date") {
        cmp = new Date(a.cpo.createdAt).getTime() - new Date(b.cpo.createdAt).getTime();
      } else if (sortKey === "customer") {
        const sa = (a.cpo.customerSnapshot as any)?.name ?? "";
        const sb = (b.cpo.customerSnapshot as any)?.name ?? "";
        cmp = sa.localeCompare(sb);
      } else if (sortKey === "amount") {
        cmp = Number(a.cpo.amount) - Number(b.cpo.amount);
      } else if (sortKey === "so") {
        cmp = (a.soNo ?? "").localeCompare(b.soNo ?? "");
      } else if (sortKey === "do") {
        cmp = a.doDelivered - b.doDelivered || a.doTotal - b.doTotal;
      } else if (sortKey === "invoice") {
        cmp = a.invoiceTotal - b.invoiceTotal;
      } else if (sortKey === "payment") {
        const order: Record<PaymentStatus, number> = { none: 0, unpaid: 1, partial: 2, overdue: 3, paid: 4 };
        cmp = order[a.paymentStatus] - order[b.paymentStatus];
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [filtered, sortKey, sortDir]);

  // ── Stats ──────────────────────────────────────────────────────────────
  const totalAmt      = rows.reduce((s, r) => s + Number(r.cpo.amount), 0);
  const totalInv      = rows.reduce((s, r) => s + r.invoiceTotal, 0);
  const totalPaid     = rows.reduce((s, r) => s + r.paidAmount, 0);
  const overdueCount  = rows.filter((r) => r.paymentStatus === "overdue").length;

  return (
    <div className="p-6 space-y-5">
      <PageHeader
        title="Customer PO Summary"
        description="Full-process status for all customer purchase orders"
        action={
          <Button variant="outline" size="sm" className="gap-1.5"
            onClick={() => router.push("/dashboard/sales/customer-po")}>
            <ArrowLeftIcon className="w-3.5 h-3.5" /> Back to list
          </Button>
        }
      />

      {/* ── Stats strip ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Total CPOs",   value: rows.length.toString() },
          { label: "CPO Value",    value: fmtAmt(totalAmt) },
          { label: "Outstanding",  value: fmtAmt(totalInv - totalPaid), highlight: totalInv - totalPaid > 0 },
          { label: "Overdue",      value: overdueCount.toString(), warn: overdueCount > 0 },
        ].map(({ label, value, highlight, warn }) => (
          <div key={label} className="border border-border rounded-xl px-4 py-3">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">{label}</p>
            <p className={cn("text-sm font-semibold tabular-nums",
              warn && overdueCount > 0 ? "text-red-600 dark:text-red-400" : "text-foreground",
            )}>{value}</p>
          </div>
        ))}
      </div>

      {/* ── Search ── */}
      <div className="relative">
        <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search PO no., customer, SO no., invoice no.…"
          className="pl-9 h-9 text-sm"
        />
        {search && (
          <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
            <XIcon className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <div className="text-xs text-muted-foreground tabular-nums">
        {sorted.length} of {rows.length} record{rows.length !== 1 ? "s" : ""}
      </div>

      {/* ── Table ── */}
      <div className="border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <Th>#</Th>
                <Th sort={{ col: "date", active: sortKey, dir: sortDir, toggle: toggleSort }}>Date</Th>
                <Th>Customer PO</Th>
                <Th sort={{ col: "customer", active: sortKey, dir: sortDir, toggle: toggleSort }}>Customer</Th>
                <Th>CPO Status</Th>
                <Th sort={{ col: "amount", active: sortKey, dir: sortDir, toggle: toggleSort }} right>CPO Amount</Th>
                <Th sort={{ col: "so", active: sortKey, dir: sortDir, toggle: toggleSort }}>Sales Order</Th>
                <Th>Int. PO</Th>
                <Th sort={{ col: "do", active: sortKey, dir: sortDir, toggle: toggleSort }}>Delivery</Th>
                <Th sort={{ col: "invoice", active: sortKey, dir: sortDir, toggle: toggleSort }}>Invoices</Th>
                <Th sort={{ col: "payment", active: sortKey, dir: sortDir, toggle: toggleSort }} right>Payment</Th>
                <Th right>Outstanding</Th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 ? (
                <tr>
                  <td colSpan={12} className="py-12 text-center text-muted-foreground">
                    No records match your search
                  </td>
                </tr>
              ) : (
                sorted.map((r, i) => {
                  const snap      = r.cpo.customerSnapshot as any;
                  const cpoStatus = CPO_STATUS[r.cpo.status] ?? CPO_STATUS.received;
                  const soStatus  = r.soStatus ? (SO_STATUS[r.soStatus] ?? SO_STATUS.draft) : null;
                  const payStatus = PAY_STATUS[r.paymentStatus];
                  const outstanding = r.invoiceTotal - r.paidAmount;

                  return (
                    <tr
                      key={r.cpo.id}
                      className="border-b border-border/50 last:border-0 hover:bg-muted/20 cursor-pointer transition-colors"
                      onClick={() => router.push(`/dashboard/sales/customer-po/${r.cpo.id}`)}
                    >
                      {/* # */}
                      <Td muted>{i + 1}</Td>

                      {/* Date */}
                      <Td muted nowrap>{fmtDate(r.cpo.receivedDate ?? r.cpo.createdAt)}</Td>

                      {/* Customer PO No */}
                      <Td nowrap>
                        <span className="font-mono font-medium text-foreground">
                          <Highlight text={r.cpo.customerPoNo} query={search} />
                        </span>
                      </Td>

                      {/* Customer */}
                      <Td>
                        <div className="min-w-0">
                          {snap?.name && (
                            <p className="truncate max-w-[140px]">
                              <Highlight text={snap.name} query={search} />
                            </p>
                          )}
                          {snap?.organizationName && (
                            <p className="text-muted-foreground truncate max-w-[140px]">
                              <Highlight text={snap.organizationName} query={search} />
                            </p>
                          )}
                        </div>
                      </Td>

                      {/* CPO Status */}
                      <Td><Badge label={cpoStatus.label} cls={cpoStatus.cls} /></Td>

                      {/* CPO Amount */}
                      <Td right nowrap>
                        <span className="font-mono font-medium">
                          {fmtAmt(Number(r.cpo.amount))}
                        </span>
                      </Td>

                      {/* Sales Order */}
                      <Td>
                        {r.soNo && soStatus ? (
                          <div
                            className="flex items-center gap-1.5 group"
                            onClick={(e) => { e.stopPropagation(); router.push(`/dashboard/sales/order/${r.soId}`); }}
                          >
                            <span className="font-mono group-hover:underline cursor-pointer">
                              <Highlight text={r.soNo} query={search} />
                            </span>
                            <Badge label={soStatus.label} cls={soStatus.cls} />
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </Td>

                      {/* Internal PO count */}
                      <Td>
                        {r.internalPoCount > 0 ? (
                          <span className="bg-muted/60 rounded px-1.5 py-0.5 font-mono text-foreground">
                            {r.internalPoCount}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </Td>

                      {/* Delivery */}
                      <Td>
                        {r.doTotal > 0 ? (
                          <span className={cn(
                            "font-mono",
                            r.doDelivered === r.doTotal ? "text-green-600 dark:text-green-400" :
                            r.doDelivered > 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground",
                          )}>
                            {r.doDelivered}/{r.doTotal}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </Td>

                      {/* Invoices — full list, each clickable */}
                      <Td>
                        {r.invoices.length === 0 ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <div className="space-y-1">
                            {r.invoices.map((inv) => {
                              const invStatus = INV_STATUS[inv.status] ?? INV_STATUS.draft;
                              return (
                                <div
                                  key={inv.id}
                                  className="flex items-center gap-1.5 group"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    router.push(`/dashboard/fulfillment/invoice/${inv.id}`);
                                  }}
                                >
                                  <span className="font-mono group-hover:underline cursor-pointer">
                                    <Highlight text={inv.invoiceNo} query={search} />
                                  </span>
                                  <Badge label={invStatus.label} cls={invStatus.cls} />
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </Td>

                      {/* Payment status */}
                      <Td right>
                        <span className={cn("text-xs", payStatus.cls)}>{payStatus.label}</span>
                        {r.dueDate && r.paymentStatus !== "paid" && r.paymentStatus !== "none" && (
                          <p className={cn(
                            "text-[10px] mt-0.5",
                            r.paymentStatus === "overdue" ? "text-red-500" : "text-muted-foreground",
                          )}>
                            Due {fmtDate(r.dueDate)}
                          </p>
                        )}
                      </Td>

                      {/* Outstanding */}
                      <Td right nowrap>
                        {r.invoiceTotal > 0 ? (
                          <span className={cn("font-mono",
                            outstanding <= 0 ? "text-green-600 dark:text-green-400" :
                            r.paymentStatus === "overdue" ? "text-red-600 dark:text-red-400 font-semibold" :
                            "text-foreground",
                          )}>
                            {outstanding <= 0 ? "—" : fmtAmt(outstanding)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </Td>
                    </tr>
                  );
                })
              )}
            </tbody>

            {/* ── Footer totals ── */}
            {sorted.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-border bg-muted/30">
                  <td colSpan={5} className="px-3 py-2.5 text-xs text-muted-foreground font-medium">
                    {sorted.length} record{sorted.length !== 1 ? "s" : ""}
                  </td>
                  <td className="px-3 py-2.5 text-xs font-semibold text-right tabular-nums font-mono">
                    {fmtAmt(sorted.reduce((s, r) => s + Number(r.cpo.amount), 0))}
                  </td>
                  <td colSpan={4} />
                  <td className="px-3 py-2.5 text-xs font-semibold text-right tabular-nums font-mono text-muted-foreground" />
                  <td className="px-3 py-2.5 text-xs font-semibold text-right tabular-nums font-mono">
                    {(() => {
                      const out = sorted.reduce((s, r) => s + Math.max(0, r.invoiceTotal - r.paidAmount), 0);
                      return out > 0 ? fmtAmt(out) : "—";
                    })()}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Table cell helpers ─────────────────────────────────────────────────────
function Th({
  children, right, sort,
}: {
  children?: React.ReactNode;
  right?: boolean;
  sort?: { col: SortKey; active: SortKey; dir: SortDir; toggle: (k: SortKey) => void };
}) {
  return (
    <th className={cn(
      "px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap select-none",
      right && "text-right",
    )}>
      <span className="inline-flex items-center gap-1">
        {children}
        {sort && <SortBtn col={sort.col} active={sort.active} dir={sort.dir} onClick={() => sort.toggle(sort.col)} />}
      </span>
    </th>
  );
}

function Td({
  children, right, muted, nowrap,
}: {
  children: React.ReactNode;
  right?: boolean;
  muted?: boolean;
  nowrap?: boolean;
}) {
  return (
    <td className={cn(
      "px-3 py-2.5 align-top",
      right && "text-right",
      muted && "text-muted-foreground",
      nowrap && "whitespace-nowrap",
    )}>
      {children}
    </td>
  );
}
