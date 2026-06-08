"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { type WorkflowRow, type WfPr, type WfPo, type WfDo, type WfInv } from "@/server/workflow";
import { PageHeader } from "@/components/page-header";
import { cn } from "@/lib/utils";
import { SearchIcon, ArrowRightIcon } from "lucide-react";

// ── Status config ─────────────────────────────────────────────────────────────

type StatusCfg = { label: string; dot: string; pill: string };

const CPO_CFG: Record<string, StatusCfg> = {
  received:     { label: "Received",     dot: "bg-amber-400", pill: "bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400" },
  acknowledged: { label: "Acknowledged", dot: "bg-blue-500",  pill: "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400" },
  fulfilled:    { label: "Fulfilled",    dot: "bg-green-500", pill: "bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400" },
  cancelled:    { label: "Cancelled",    dot: "bg-red-400",   pill: "bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400" },
};

const SO_CFG: Record<string, StatusCfg> = {
  confirmed: { label: "Confirmed", dot: "bg-blue-500",  pill: "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400" },
  fulfilled:  { label: "Fulfilled", dot: "bg-green-500", pill: "bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400" },
};

const PR_CFG: Record<string, StatusCfg> = {
  draft:             { label: "Draft",         dot: "bg-muted-foreground/30", pill: "bg-muted text-muted-foreground" },
  submitted:         { label: "Submitted",     dot: "bg-amber-400",           pill: "bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400" },
  approved:          { label: "Approved",      dot: "bg-blue-500",            pill: "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400" },
  partially_ordered: { label: "Part. ordered", dot: "bg-violet-500",          pill: "bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-400" },
  ordered:           { label: "Ordered",       dot: "bg-green-500",           pill: "bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400" },
  cancelled:         { label: "Cancelled",     dot: "bg-red-400",             pill: "bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400" },
};

const PO_CFG: Record<string, StatusCfg> = {
  draft:     { label: "Draft",     dot: "bg-muted-foreground/30", pill: "bg-muted text-muted-foreground" },
  submitted: { label: "Submitted", dot: "bg-amber-400",           pill: "bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400" },
  confirmed: { label: "Confirmed", dot: "bg-blue-500",            pill: "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400" },
  fulfilled: { label: "Fulfilled", dot: "bg-green-500",           pill: "bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400" },
  cancelled: { label: "Cancelled", dot: "bg-red-400",             pill: "bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400" },
};

const DO_CFG: Record<string, StatusCfg> = {
  draft:     { label: "Pending",   dot: "bg-amber-400", pill: "bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400" },
  delivered: { label: "Delivered", dot: "bg-green-500", pill: "bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400" },
  returned:  { label: "Returned",  dot: "bg-red-400",   pill: "bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400" },
};

const INV_CFG: Record<string, StatusCfg> = {
  draft:     { label: "Draft",   dot: "bg-muted-foreground/30", pill: "bg-muted text-muted-foreground" },
  sent:      { label: "Sent",    dot: "bg-blue-500",            pill: "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400" },
  paid:      { label: "Paid",    dot: "bg-green-500",           pill: "bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400" },
  overdue:   { label: "Overdue", dot: "bg-red-500",             pill: "bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400" },
  cancelled: { label: "Void",    dot: "bg-muted-foreground/30", pill: "bg-muted text-muted-foreground" },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt = (v: string | number, ccy = "MYR") =>
  `${ccy} ${Number(v).toLocaleString("en-MY", { minimumFractionDigits: 2 })}`;

const fmtDate = (d: Date | string) =>
  new Date(d).toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" });

// ── Micro components ──────────────────────────────────────────────────────────

function Dot({ color }: { color: string }) {
  return <span className={cn("inline-block w-2 h-2 rounded-full shrink-0", color)} />;
}

function Pill({ label, className }: { label: string; className: string }) {
  return (
    <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded whitespace-nowrap", className)}>
      {label}
    </span>
  );
}

function Dash() {
  return <span className="text-muted-foreground/30 text-xs">—</span>;
}

// ── Cell renderers ────────────────────────────────────────────────────────────

function CpoCell({ row, nav }: { row: WorkflowRow; nav: (p: string) => void }) {
  if (!row.cpoId) return <Dash />;
  const cfg = CPO_CFG[row.cpoStatus ?? ""] ?? CPO_CFG.received;
  return (
    <div className="flex flex-col gap-1">
      <button
        onClick={() => nav(`/dashboard/sales/customer-po/${row.cpoId}`)}
        className="font-mono text-xs font-medium hover:underline text-left"
      >
        {row.cpoNo}
      </button>
      <div className="flex items-center gap-1.5">
        <Dot color={cfg.dot} />
        <Pill label={cfg.label} className={cfg.pill} />
      </div>
      {row.cpoAmount && (
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {fmt(row.cpoAmount, row.cpoCurrency ?? "MYR")}
        </span>
      )}
    </div>
  );
}

function SoCell({ row, nav }: { row: WorkflowRow; nav: (p: string) => void }) {
  const cfg = SO_CFG[row.soStatus] ?? { label: row.soStatus, dot: "bg-muted-foreground/40", pill: "bg-muted text-muted-foreground" };
  return (
    <div className="flex flex-col gap-1">
      <button
        onClick={() => nav(`/dashboard/sales/order/${row.soId}`)}
        className="font-mono text-xs font-medium hover:underline text-left"
      >
        {row.soNo}
      </button>
      <div className="flex items-center gap-1.5">
        <Dot color={cfg.dot} />
        <Pill label={cfg.label} className={cfg.pill} />
      </div>
      <span className="text-[10px] text-muted-foreground truncate max-w-35">
        {row.customerOrgName ?? row.customerName ?? "—"}
      </span>
      <span className="text-[10px] text-muted-foreground">{fmtDate(row.soCreatedAt)}</span>
    </div>
  );
}

function PrCell({ prs, nav }: { prs: WfPr[]; nav: (p: string) => void }) {
  if (!prs.length) return <Dash />;
  return (
    <div className="flex flex-col gap-2">
      {prs.map((pr) => {
        const cfg = PR_CFG[pr.status] ?? PR_CFG.draft;
        return (
          <div key={pr.id} className="flex flex-col gap-0.5">
            <button onClick={() => nav(`/dashboard/procurement/requisition/${pr.id}`)} className="font-mono text-xs hover:underline text-left">
              {pr.prNo}
            </button>
            <div className="flex items-center gap-1.5">
              <Dot color={cfg.dot} />
              <Pill label={cfg.label} className={cfg.pill} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function PoCell({ pos, nav }: { pos: WfPo[]; nav: (p: string) => void }) {
  if (!pos.length) return <Dash />;
  return (
    <div className="flex flex-col gap-2">
      {pos.map((po) => {
        const cfg = PO_CFG[po.status] ?? PO_CFG.draft;
        return (
          <div key={po.id} className="flex flex-col gap-0.5">
            <button onClick={() => nav(`/dashboard/procurement/purchase-order/${po.id}`)} className="font-mono text-xs hover:underline text-left">
              {po.poNo ?? "—"}
            </button>
            <div className="flex items-center gap-1.5">
              <Dot color={cfg.dot} />
              <Pill label={cfg.label} className={cfg.pill} />
            </div>
            {po.supplierName && (
              <span className="text-[10px] text-muted-foreground truncate max-w-32.5">{po.supplierName}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function DoCell({ dos, nav }: { dos: WfDo[]; nav: (p: string) => void }) {
  if (!dos.length) return <Dash />;
  return (
    <div className="flex flex-col gap-2">
      {dos.map((d) => {
        const cfg = DO_CFG[d.status] ?? DO_CFG.draft;
        return (
          <div key={d.id} className="flex flex-col gap-0.5">
            <button onClick={() => nav(`/dashboard/fulfillment/delivery/${d.id}`)} className="font-mono text-xs hover:underline text-left">
              {d.doNo}
            </button>
            <div className="flex items-center gap-1.5">
              <Dot color={cfg.dot} />
              <Pill label={cfg.label} className={cfg.pill} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function InvCell({ invs, nav }: { invs: WfInv[]; nav: (p: string) => void }) {
  const visible = invs.filter((i) => i.status !== "cancelled");
  const voided  = invs.length - visible.length;
  if (!invs.length) return <Dash />;
  return (
    <div className="flex flex-col gap-2">
      {visible.map((i) => {
        const cfg = INV_CFG[i.status] ?? INV_CFG.draft;
        return (
          <div key={i.id} className="flex flex-col gap-0.5">
            <button onClick={() => nav(`/dashboard/fulfillment/invoice/${i.id}`)} className="font-mono text-xs hover:underline text-left">
              {i.invoiceNo}
            </button>
            <div className="flex items-center gap-1.5">
              <Dot color={cfg.dot} />
              <Pill label={cfg.label} className={cfg.pill} />
            </div>
            <span className="text-[10px] text-muted-foreground tabular-nums">{fmt(i.grandTotal)}</span>
          </div>
        );
      })}
      {voided > 0 && (
        <span className="text-[10px] text-muted-foreground/40">+{voided} void</span>
      )}
    </div>
  );
}

function GrCell({ count, pending }: { count: number; pending: number }) {
  if (!count && !pending) return <Dash />;
  return (
    <div className="flex flex-col items-center gap-1">
      {count > 0 && (
        <div className="flex items-center gap-1" title={`${count} receipt${count !== 1 ? "s" : ""} recorded`}>
          <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300 text-[11px] font-semibold">
            {count}
          </span>
        </div>
      )}
      {pending > 0 && (
        <div className="flex items-center gap-1" title={`${pending} PO${pending !== 1 ? "s" : ""} awaiting receipt`}>
          <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 text-[11px] font-semibold">
            {pending}
          </span>
          <span className="text-[9px] text-amber-600 dark:text-amber-400 font-medium leading-tight">pending</span>
        </div>
      )}
    </div>
  );
}

// ── Stats card ────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, color }: { label: string; value: number; sub?: string; color: string }) {
  return (
    <div className="border border-border rounded-xl p-4">
      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">{label}</p>
      <p className={cn("text-2xl font-semibold tabular-nums", color)}>{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function WorkflowClient({ rows, permissions }: { rows: WorkflowRow[]; permissions: string[] }) {
  const router  = useRouter();
  const nav     = (path: string) => router.push(path);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.toLowerCase();
    // Collect SO ids that match, then keep all rows for those SOs
    // (dropping a mid-group row would corrupt rowSpan)
    const matchedSoIds = new Set(
      rows
        .filter((r) =>
          r.soNo.toLowerCase().includes(q) ||
          r.cpoNo?.toLowerCase().includes(q) ||
          r.customerName?.toLowerCase().includes(q) ||
          r.customerOrgName?.toLowerCase().includes(q) ||
          r.prs.some((p)  => p.prNo.toLowerCase().includes(q)) ||
          r.pos.some((p)  => p.poNo?.toLowerCase().includes(q)) ||
          r.dos.some((d)  => d.doNo.toLowerCase().includes(q)) ||
          r.invoices.some((i) => i.invoiceNo.toLowerCase().includes(q))
        )
        .map((r) => r.soId)
    );
    return rows.filter((r) => matchedSoIds.has(r.soId));
  }, [rows, search]);

  const stats = useMemo(() => ({
    pendingPr:  rows.reduce((n, r) => n + r.prs.filter((p) => ["draft", "submitted"].includes(p.status)).length, 0),
    pendingPo:  rows.reduce((n, r) => n + r.pos.filter((p) => ["draft", "submitted"].includes(p.status)).length, 0),
    pendingDo:  rows.reduce((n, r) => n + r.dos.filter((d) => d.status === "draft").length, 0),
    pendingInv: rows.reduce((n, r) => n + r.invoices.filter((i) => ["draft", "sent", "overdue"].includes(i.status)).length, 0),
  }), [rows]);

  const pipeline = useMemo(() => ({
    cpos:     rows.filter((r) => r.cpoId).length,
    sos:      new Set(rows.map((r) => r.soId)).size,
    withPr:   new Set(rows.filter((r) => r.prs.length).map((r) => r.soId)).size,
    withPo:   new Set(rows.filter((r) => r.pos.length).map((r) => r.soId)).size,
    withGr:   new Set(rows.filter((r) => r.grCount > 0).map((r) => r.soId)).size,
    withDo:   rows.filter((r) => r.dos.length > 0).length,
    invoiced: rows.filter((r) => r.invoices.length > 0).length,
    paid:     rows.filter((r) => r.invoices.some((i) => i.status === "paid")).length,
  }), [rows]);

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Workflow Summary"
        description="Full pipeline · Customer PO → Sales Order → Procurement → Delivery → Invoice"
      />

      {/* Pipeline funnel */}
      <div className="border border-border rounded-xl p-4 bg-muted/10">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-3">
          Pipeline overview
        </p>
        <div className="flex items-center gap-1 flex-wrap">
          {[
            { label: `${pipeline.cpos} CPO`,      color: "bg-slate-100 dark:bg-slate-800 text-foreground" },
            { label: `${pipeline.sos} SO`,         color: "bg-blue-500/15 text-blue-700 dark:text-blue-300" },
            { label: `${pipeline.withPr} w/ PR`,  color: "bg-violet-500/10 text-violet-700 dark:text-violet-300" },
            { label: `${pipeline.withPo} w/ PO`,  color: "bg-blue-500/10 text-blue-700 dark:text-blue-300" },
            { label: `${pipeline.withGr} GR done`,color: "bg-teal-500/10 text-teal-700 dark:text-teal-300" },
            { label: `${pipeline.withDo} DO`,     color: "bg-orange-500/10 text-orange-700 dark:text-orange-300" },
            { label: `${pipeline.invoiced} Inv`,  color: "bg-amber-500/10 text-amber-700 dark:text-amber-300" },
            { label: `${pipeline.paid} Paid`,     color: "bg-green-500/15 text-green-700 dark:text-green-300" },
          ].map((s, i, arr) => (
            <div key={i} className="flex items-center gap-1">
              <span className={cn("text-xs font-semibold px-2.5 py-1 rounded-full", s.color)}>{s.label}</span>
              {i < arr.length - 1 && <ArrowRightIcon className="w-3 h-3 text-muted-foreground/40 shrink-0" />}
            </div>
          ))}
        </div>
      </div>

      {/* Alert stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Pending PRs"     value={stats.pendingPr}  sub="awaiting approval"  color="text-amber-600 dark:text-amber-400" />
        <StatCard label="Pending POs"     value={stats.pendingPo}  sub="not yet confirmed"  color="text-blue-600 dark:text-blue-400"   />
        <StatCard label="Pending Delivery"value={stats.pendingDo}  sub="delivery orders"    color="text-orange-600 dark:text-orange-400" />
        <StatCard label="Open Invoices"   value={stats.pendingInv} sub="unpaid / draft"     color="text-violet-600 dark:text-violet-400" />
      </div>

      {/* Search */}
      <div className="relative">
        <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search CPO, SO, PR, PO, DO, invoice, or customer…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-9 pr-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-ring/30"
        />
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 text-sm text-muted-foreground">
          {search ? "No records match your search." : "No active orders found."}
        </div>
      ) : (
        <div className="border border-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-250">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  {[
                    { label: "Customer PO",  w: "w-[160px]" },
                    { label: "Sales Order",  w: "w-[160px]" },
                    { label: "Requisition",  w: "w-[150px]" },
                    { label: "Purchase Order", w: "w-[160px]" },
                    { label: "GR",           w: "w-[56px]", center: true },
                    { label: "Delivery",     w: "w-[150px]" },
                    { label: "Invoice",      w: "w-[170px]" },
                  ].map((col) => (
                    <th
                      key={col.label}
                      className={cn(
                        "px-4 py-2.5 font-semibold text-muted-foreground text-left",
                        col.w,
                        col.center && "text-center"
                      )}
                    >
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((row, i) => (
                  <tr
                    key={`${row.soId}-${row.cpoId ?? "nocpo"}-${i}`}
                    className="border-b border-border/50 last:border-0 align-top"
                  >
                    {/* CPO — always rendered, one cell per row */}
                    <td className="px-4 py-3 border-r border-border/40"><CpoCell row={row} nav={nav} /></td>

                    {/* SO — rendered once per SO, spanning all its CPO rows */}
                    {row.isFirstInSo && (
                      <td rowSpan={row.soRowSpan} className="px-4 py-3 border-r border-border/40 align-top bg-muted/10">
                        <SoCell row={row} nav={nav} />
                      </td>
                    )}

                    {/* PR — per CPO row; server already scopes prs[] to this CPO */}
                    <td className="px-4 py-3 border-r border-border/40">
                      <PrCell prs={row.prs} nav={nav} />
                    </td>

                    {/* PO / GR — rendered once per SO, spanning all its CPO rows */}
                    {row.isFirstInSo && (
                      <>
                        <td rowSpan={row.soRowSpan} className="px-4 py-3 border-r border-border/40 align-top bg-muted/10">
                          <PoCell pos={row.pos} nav={nav} />
                        </td>
                        <td rowSpan={row.soRowSpan} className="px-4 py-3 border-r border-border/40 text-center align-top bg-muted/10">
                          <GrCell count={row.grCount} pending={row.grPending} />
                        </td>
                      </>
                    )}

                    {/* Delivery / Invoice — always per CPO row */}
                    <td className="px-4 py-3 border-r border-border/40"><DoCell  dos={row.dos}  nav={nav} /></td>
                    <td className="px-4 py-3"><InvCell invs={row.invoices} nav={nav} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
