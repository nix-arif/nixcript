"use client";

// The Customer PO's fulfilment trail — CPO → SO → PR → Supplier PO → DO →
// Invoice → Payment — on its own page (/dashboard/sales/customer-po/<id>/trail
// and the centralized twin). The detail page keeps only the compact Progress
// summary, built from the same trailStates() so the two never disagree.

import { SoStockChip } from "@/components/so-stock-chip";
import { navigateBack } from "@/hooks/use-back";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeftIcon, CheckIcon, AlertCircleIcon,
  FileTextIcon, PackageIcon, TruckIcon, ReceiptIcon,
  BanknoteIcon, ExternalLinkIcon, PlusIcon, Link2Icon,
  MoreHorizontalIcon, RotateCcwIcon, XIcon, TrashIcon, Loader2Icon,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { recallSalesOrder, cancelSalesOrder, deleteSalesOrder } from "@/server/sales-order";
import { recallPurchaseOrder, cancelPurchaseOrder, deletePurchaseOrder } from "@/server/purchase-order";
import { recallPurchaseRequisition, cancelPurchaseRequisition, deletePurchaseRequisition } from "@/server/purchase-requisition";
import type { TrailAction, TrailActionKind, TrailActionMap } from "@/server/trail-actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CustomerPoTrackingData, IntercompanyLeg } from "@/server/customer-purchase-order";

type Data = CustomerPoTrackingData;

const fmt = (v: string | number | null | undefined) =>
  `RM ${Number(v ?? 0).toLocaleString("en-MY", { minimumFractionDigits: 2 })}`;

const fmtDate = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" }) : "—";

// ── Status configs ─────────────────────────────────────────────────────────
export const CPO_STATUS: Record<string, { label: string; color: string }> = {
  draft:        { label: "Draft",        color: "bg-slate-100 text-slate-700 dark:bg-slate-800/50 dark:text-slate-300" },
  received:     { label: "Received",     color: "bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400" },
  acknowledged: { label: "Acknowledged", color: "bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400" },
  fulfilled:    { label: "Fulfilled",    color: "bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400" },
  cancelled:    { label: "Cancelled",    color: "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400" },
};
const SO_STATUS: Record<string, { label: string; color: string }> = {
  draft:     { label: "Draft",      color: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400" },
  // same wording and colours as the SO page
  "pending-do": { label: "Pending DO", color: "bg-teal-50 text-teal-700 dark:bg-teal-900/20 dark:text-teal-400" },
  "pending-pr": { label: "Pending PR", color: "bg-orange-50 text-orange-700 dark:bg-orange-900/20 dark:text-orange-400" },
  submitted: { label: "Submitted",  color: "bg-purple-50 text-purple-700 dark:bg-purple-900/20 dark:text-purple-400" },
  confirmed: { label: "Confirmed",  color: "bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400" },
  fulfilled: { label: "Fulfilled",  color: "bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400" },
  cancelled: { label: "Cancelled",  color: "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400" },
};
const soStatusCfg = (status: string) =>
  SO_STATUS[status] ?? { label: status.replace(/[-_]/g, " ").replace(/^\w/, (c) => c.toUpperCase()), color: SO_STATUS.draft.color };

const PO_STATUS: Record<string, { label: string; color: string }> = {
  draft:        { label: "Draft",      color: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400" },
  submitted:    { label: "Submitted",  color: "bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400" },
  confirmed:    { label: "Confirmed",  color: "bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400" },
  fulfilled:    { label: "Fulfilled",  color: "bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400" },
  cancelled:    { label: "Cancelled",  color: "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400" },
  // legacy labels
  sent:         { label: "Sent",         color: "bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400" },
  acknowledged: { label: "Acknowledged", color: "bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400" },
  received:     { label: "Received",     color: "bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400" },
};

const PR_STATUS: Record<string, { label: string; color: string }> = {
  draft:     { label: "Draft",     color: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400" },
  submitted: { label: "Submitted", color: "bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400" },
  approved:  { label: "Approved",  color: "bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400" },
  ordered:   { label: "Ordered",   color: "bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400" },
  partially_ordered: { label: "Partly ordered", color: "bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400" },
  cancelled: { label: "Cancelled", color: "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400" },
};

const DO_STATUS: Record<string, { label: string; color: string }> = {
  draft:     { label: "Draft",     color: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400" },
  delivered: { label: "Delivered", color: "bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400" },
  returned:  { label: "Returned",  color: "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400" },
};
const INV_STATUS: Record<string, { label: string; color: string }> = {
  draft:     { label: "Draft",     color: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400" },
  sent:      { label: "Sent",      color: "bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400" },
  paid:      { label: "Paid",      color: "bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400" },
  overdue:   { label: "Overdue",   color: "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400" },
  cancelled: { label: "Cancelled", color: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400" },
};

export function StatusBadge({ label, color }: { label: string; color: string }) {
  return (
    <span className={cn("text-[10px] font-medium rounded px-1.5 py-0.5 shrink-0", color)}>
      {label}
    </span>
  );
}

// ── Step indicator ─────────────────────────────────────────────────────────
export type StepState = "done" | "active" | "pending" | "warn";

function StepIndicator({ state, icon: Icon }: { state: StepState; icon: React.ElementType }) {
  return (
    <div className={cn(
      "w-9 h-9 rounded-full flex items-center justify-center shrink-0 ring-2 ring-background z-10",
      state === "done"    && "bg-green-500 text-white",
      state === "active"  && "bg-primary text-primary-foreground",
      state === "warn"    && "bg-red-500 text-white",
      state === "pending" && "bg-muted border border-border text-muted-foreground",
    )}>
      {state === "done" ? (
        <CheckIcon className="w-4 h-4" />
      ) : state === "warn" ? (
        <AlertCircleIcon className="w-4 h-4" />
      ) : (
        <Icon className="w-4 h-4" />
      )}
    </div>
  );
}

// ── Trail step wrapper ─────────────────────────────────────────────────────
function TrailStep({
  state, icon, label, isLast = false, children,
}: {
  state: StepState;
  icon: React.ElementType;
  label: string;
  isLast?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-4">
      <div className="flex flex-col items-center">
        <StepIndicator state={state} icon={icon} />
        {!isLast && <div className="w-px flex-1 bg-border mt-1 mb-0" style={{ minHeight: 24 }} />}
      </div>
      <div className={cn("flex-1 min-w-0", isLast ? "pb-2" : "pb-6")}>
        <p className={cn(
          "text-[10px] font-bold uppercase tracking-widest mb-2",
          state === "pending" ? "text-muted-foreground" : "text-foreground",
        )}>
          {label}
        </p>
        {children}
      </div>
    </div>
  );
}

// ── Document card inside a step ────────────────────────────────────────────
const ACTION_META: Record<TrailActionKind, { label: string; icon: React.ElementType; destructive?: boolean }> = {
  recall: { label: "Recall to draft", icon: RotateCcwIcon },
  cancel: { label: "Cancel", icon: XIcon, destructive: true },
  delete: { label: "Delete", icon: TrashIcon, destructive: true },
};

// The "⋯" menu on a trail card: available actions run; blocked ones stay
// visible but disabled with the reason, so nobody wonders why it's missing.
function DocActionsMenu({ actions, busy, onAction }: { actions: TrailAction[]; busy: boolean; onAction: (kind: TrailActionKind) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          disabled={busy}
          className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
          aria-label="Document actions"
        >
          {busy ? <Loader2Icon className="w-3.5 h-3.5 animate-spin" /> : <MoreHorizontalIcon className="w-3.5 h-3.5" />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72" onClick={(e) => e.stopPropagation()}>
        {actions.map((a) => {
          const meta = ACTION_META[a.kind];
          const Icon = meta.icon;
          return (
            <DropdownMenuItem
              key={a.kind}
              disabled={!a.allowed}
              variant={meta.destructive && a.allowed ? "destructive" : "default"}
              onClick={() => a.allowed && onAction(a.kind)}
              className="items-start"
            >
              <Icon className="w-3.5 h-3.5 mt-0.5" />
              <div className="min-w-0">
                <div className="text-xs font-medium">{meta.label}</div>
                {!a.allowed && a.reason && <div className="text-[10px] leading-snug text-muted-foreground whitespace-normal">{a.reason}</div>}
              </div>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DocCard({
  docNo, statusLabel, statusColor, meta, onClick, actions, busy = false, onAction,
}: {
  docNo: string;
  statusLabel: string;
  statusColor: string;
  meta?: React.ReactNode;
  onClick?: () => void;
  actions?: TrailAction[];
  busy?: boolean;
  onAction?: (kind: TrailActionKind) => void;
}) {
  return (
    <div
      onClick={onClick}
      className={cn(
        "border border-border rounded-lg px-3 py-2.5 bg-background flex items-center gap-2",
        onClick && "cursor-pointer hover:bg-muted/30 transition-colors",
      )}
    >
      <span className="font-mono text-sm font-medium flex-1 min-w-0 truncate">{docNo}</span>
      <StatusBadge label={statusLabel} color={statusColor} />
      {meta && <div className="text-[11px] text-muted-foreground shrink-0">{meta}</div>}
      {onClick && <ExternalLinkIcon className="w-3 h-3 text-muted-foreground shrink-0" />}
      {actions && actions.length > 0 && onAction && <DocActionsMenu actions={actions} busy={busy} onAction={onAction} />}
    </div>
  );
}

function PendingCard({ label }: { label: string }) {
  return (
    <div className="border border-dashed border-border rounded-lg px-3 py-2.5 text-sm text-muted-foreground">
      {label}
    </div>
  );
}

// ── Payment summary ────────────────────────────────────────────────────────
function paymentState(invoices: Data["invoices"]): {
  state: StepState; label: string; color: string;
  paid: number; total: number; due: Date | null;
} {
  if (invoices.length === 0) return { state: "pending", label: "No invoice", color: "", paid: 0, total: 0, due: null };
  const total = invoices.reduce((s, i) => s + Number(i.grandTotal ?? 0), 0);
  const paid  = invoices.reduce((s, i) => s + Number(i.paidAmount ?? 0), 0);
  const isOverdue = invoices.some((i) => i.status === "overdue");
  const allPaid   = invoices.every((i) => i.status === "paid");
  const latestDue = invoices.reduce<Date | null>((latest, i) => {
    if (!i.dueDate) return latest;
    const d = new Date(i.dueDate);
    return !latest || d > latest ? d : latest;
  }, null);
  if (allPaid)   return { state: "done",   label: "Fully paid",   color: "text-green-600 dark:text-green-400", paid, total, due: latestDue };
  if (isOverdue) return { state: "warn",   label: "Overdue",      color: "text-red-600 dark:text-red-400",     paid, total, due: latestDue };
  if (paid > 0)  return { state: "active", label: "Partial paid", color: "text-amber-600 dark:text-amber-400", paid, total, due: latestDue };
  return           { state: "active", label: "Unpaid",       color: "text-muted-foreground",                paid, total, due: latestDue };
}

// ── Step states (shared with the detail page's Progress summary) ───────────
export function trailStates(data: Data) {
  const { cpo, so, internalPos, requisitions, dos, invoices } = data;

  // Requisitions: the purchase_requisition table (PRs raised from the SO),
  // plus legacy ones kept as draft/submitted rows of purchase_order.
  const prList: { id: string; kind: "pr" | "po"; no: string; status: string; createdAt: Date; href: string; cfg: { label: string; color: string } }[] = [
    ...requisitions.map((r) => ({
      id: r.id, kind: "pr" as const, no: r.prNo, status: r.status, createdAt: r.createdAt,
      href: `/dashboard/procurement/requisition/${r.id}`,
      cfg: PR_STATUS[r.status] ?? PR_STATUS.draft,
    })),
    ...internalPos
      .filter((p) => p.status === "draft" || p.status === "submitted")
      .map((p) => ({
        id: p.id, kind: "po" as const, no: p.prNo ?? p.poNo ?? p.id, status: p.status, createdAt: p.createdAt,
        href: `/dashboard/procurement/purchase-order/${p.id}`,
        cfg: PO_STATUS[p.status] ?? PO_STATUS.draft,
      })),
  ];
  const prOpenCount = prList.filter((r) => ["draft", "submitted", "approved", "partially_ordered"].includes(r.status)).length;

  // Supplier POs that were issued — cancelled ones included, shown as such.
  const spoList = internalPos.filter((p) => p.status !== "draft" && p.status !== "submitted");
  const activeSpoList = spoList.filter((p) => p.status !== "cancelled");

  const cpoState: StepState = cpo.status === "fulfilled" ? "done" : "active";
  const soState:  StepState = !so ? "pending" : so.status === "fulfilled" ? "done" : "active";
  const prState:  StepState = prList.length === 0 && spoList.length === 0 ? "pending"
    : activeSpoList.length > 0 || prList.some((r) => r.status === "ordered") ? "done"
    : prList.length > 0 && prList.every((r) => r.status === "cancelled") ? "warn"
    : "active";
  const spoState: StepState = spoList.length === 0 ? "pending"
    : activeSpoList.length === 0 ? "warn"
    : activeSpoList.every((p) => p.status === "fulfilled") ? "done"
    : "active";
  const doState:  StepState = dos.length === 0 ? "pending"
    : dos.every((d) => d.status === "delivered") ? "done"
    : "active";
  const pmt = paymentState(invoices);
  const invState: StepState = invoices.length === 0 ? "pending"
    : invoices.every((i) => i.status === "paid") ? "done"
    : invoices.some((i) => i.status === "overdue") ? "warn"
    : "active";

  return { prList, prOpenCount, spoList, activeSpoList, cpoState, soState, prState, spoState, doState, invState, pmt };
}

// ── Intercompany legs ──────────────────────────────────────────────────────
// Our PO cancelled while their SO is still open: the cancel never reached them.
const legOrphaned = (leg: IntercompanyLeg) =>
  leg.viaPoStatus === "cancelled" && !!leg.so && leg.so.status !== "cancelled" && leg.so.status !== "fulfilled";

function legState(leg: IntercompanyLeg): StepState {
  if (legOrphaned(leg)) return "warn";
  if (leg.viaPoStatus === "cancelled") return "pending";
  if (!leg.so) return "pending";
  if (leg.so.status === "cancelled") return "warn";
  return leg.so.status === "fulfilled" ? "done" : "active";
}

// The sibling org's side of the chain: the SO it got from our PO and the POs
// it raised from that SO. Numbers and statuses only; links open the
// centralized pages and only appear when the viewer may use them.
function IntercompanyLegBody({ leg }: { leg: IntercompanyLeg }) {
  const router = useRouter();
  const soCfg = leg.so ? soStatusCfg(leg.so.status) : null;
  return (
    <div className="border border-purple-200 dark:border-purple-800 bg-purple-50/40 dark:bg-purple-900/10 rounded-lg p-3 space-y-3">
      <p className="text-[11px] text-muted-foreground">
        Our PO <span className="font-mono text-foreground">{leg.viaPoNo}</span> was issued to{" "}
        <span className="font-medium text-foreground">{leg.organizationName}</span>
        {leg.viaPoStatus === "cancelled" && " (since cancelled)"}
      </p>
      {legOrphaned(leg) && (
        <p className="text-[11px] font-medium text-red-600 dark:text-red-400">
          Our PO is cancelled, but {leg.organizationName}&apos;s sales order is still open — ask them to cancel it.
        </p>
      )}

      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Their Sales Order</p>
        {leg.so && soCfg ? (
          <DocCard
            docNo={leg.so.soNo}
            statusLabel={soCfg.label}
            statusColor={soCfg.color}
            meta={fmtDate(leg.so.createdAt)}
            onClick={leg.so.href ? () => router.push(leg.so!.href!) : undefined}
          />
        ) : (
          <PendingCard label={`Waiting for ${leg.organizationName} to raise a sales order`} />
        )}
      </div>

      {leg.so && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Their Supplier PO</p>
          {leg.pos.length === 0 ? (
            <PendingCard label={`No supplier PO raised yet in ${leg.organizationName}`} />
          ) : (
            <div className="space-y-1.5">
              {leg.pos.map((po) => {
                const cfg = PO_STATUS[po.status] ?? PO_STATUS.draft;
                return (
                  <DocCard
                    key={po.id}
                    docNo={po.poNo ?? po.prNo ?? po.id}
                    statusLabel={cfg.label}
                    statusColor={cfg.color}
                    meta={fmtDate(po.createdAt)}
                    onClick={po.href ? () => router.push(po.href!) : undefined}
                  />
                );
              })}
            </div>
          )}
        </div>
      )}

      {leg.next.map((n, i) => (
        <div key={`${n.viaPoNo}-${i}`} className="pl-3 border-l-2 border-purple-200 dark:border-purple-800">
          <p className="text-[10px] font-bold uppercase tracking-widest mb-2">Intercompany · {n.organizationName}</p>
          <IntercompanyLegBody leg={n} />
        </div>
      ))}
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────
export function FulfilmentTrailClient({
  data,
  permissions,
  backHref,
  organizationName,
  actions = null,
}: {
  data: Data;
  permissions: string[];
  // The CPO's own detail page (plain or centralized).
  backHref: string;
  organizationName?: string;
  // Recall / Cancel / Delete per document (server/trail-actions.ts). Null on
  // the centralized view: the actions work on the active org's documents only.
  actions?: TrailActionMap | null;
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);

  // Runs one trail action: confirm, call the same server action the document
  // page uses (it re-checks every rule), then reload the trail.
  async function runAction(doc: "so" | "pr" | "po", id: string, docNo: string, kind: TrailActionKind) {
    const prompts: Record<TrailActionKind, string> = {
      recall: `Recall ${docNo} back to draft?`,
      cancel: doc === "po"
        ? `Cancel ${docNo}? If it was issued to one of your other companies, the sales order they got from it is cancelled too.`
        : `Cancel ${docNo}? It stays on record as cancelled.`,
      delete: `Delete ${docNo}? This removes it permanently and can't be undone.`,
    };
    if (!confirm(prompts[kind])) return;
    const run = {
      so: { recall: recallSalesOrder, cancel: cancelSalesOrder, delete: deleteSalesOrder },
      pr: { recall: recallPurchaseRequisition, cancel: cancelPurchaseRequisition, delete: deletePurchaseRequisition },
      po: { recall: recallPurchaseOrder, cancel: cancelPurchaseOrder, delete: deletePurchaseOrder },
    }[doc][kind];
    setBusyId(id);
    try {
      const res = await run(id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`${docNo} ${kind === "recall" ? "recalled to draft" : kind === "cancel" ? "cancelled" : "deleted"}`);
      router.refresh();
    } catch {
      toast.error("Something went wrong — please try again");
    } finally {
      setBusyId(null);
    }
  }
  const { cpo, so, dos, invoices } = data;
  const snap = cpo.customerSnapshot as { name?: string; organizationName?: string } | null;
  const can = (p: string) => permissions.includes("*") || permissions.includes(p);
  const { prList, spoList, activeSpoList, cpoState, soState, prState, spoState, doState, invState, pmt } = trailStates(data);
  const cpoStatusCfg = CPO_STATUS[cpo.status] ?? CPO_STATUS.received;

  return (
    <div className="p-6 space-y-6">
      {/* ── Header ── */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Button variant="ghost" size="icon" className="w-7 h-7 -ml-1.5" onClick={() => navigateBack(router, backHref)}>
            <ArrowLeftIcon className="w-3.5 h-3.5" />
          </Button>
          <h1 className="text-lg font-bold">
            Fulfilment Trail · <span className="font-mono">{cpo.customerPoNo}</span>
          </h1>
          <StatusBadge label={cpoStatusCfg.label} color={cpoStatusCfg.color} />
          {organizationName && (
            <span className="text-[10px] font-medium text-indigo-700 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/20 rounded px-1.5 py-0.5">
              {organizationName}
            </span>
          )}
        </div>
        <p className="text-sm text-muted-foreground pl-9">
          {snap?.organizationName ?? snap?.name ?? "Unknown customer"}
          {" · "}Received {fmtDate(cpo.receivedDate ?? cpo.createdAt)}
        </p>
      </div>

      <div className="max-w-3xl">
          {/* Step 1 — Customer PO */}
          <TrailStep state={cpoState} icon={FileTextIcon} label="Customer PO">
            <DocCard
              docNo={cpo.customerPoNo}
              statusLabel={cpoStatusCfg.label}
              statusColor={cpoStatusCfg.color}
              meta={fmtDate(cpo.receivedDate ?? cpo.createdAt)}
            />
            <p className="text-xs text-muted-foreground mt-1.5 pl-1">
              {fmt(cpo.amount)} {cpo.currency !== "MYR" ? cpo.currency : ""}
            </p>
          </TrailStep>

          {/* Step 2 — Sales Order */}
          <TrailStep state={soState} icon={PackageIcon} label="Sales Order">
            {so ? (
              <>
                <DocCard
                  docNo={so.soNo}
                  statusLabel={soStatusCfg(so.status).label}
                  statusColor={soStatusCfg(so.status).color}
                  meta={<span className="flex items-center gap-2"><SoStockChip status={so.status} stockReservationStatus={so.stockReservationStatus} />{fmtDate(so.createdAt)}</span>}
                  onClick={() => router.push(`/dashboard/sales/order/${so.id}`)}
                  actions={actions?.so}
                  busy={busyId === so.id}
                  onAction={(k) => runAction("so", so.id, so.soNo, k)}
                />
                <div className="flex gap-4 mt-1.5 pl-1 text-xs text-muted-foreground">
                  <span>Value: {fmt(so.grandTotal)}</span>
                  {so.deliveryDate && <span>Delivery: {fmtDate(so.deliveryDate)}</span>}
                </div>
              </>
            ) : (
              <>
                <PendingCard label="No sales order linked yet" />
                {can("sales-order:create") && cpo.status !== "cancelled" && cpo.status !== "draft" && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-2 gap-1.5 h-7 text-xs"
                    onClick={() => router.push(`/dashboard/sales/order/create?cpoId=${cpo.id}`)}
                  >
                    <PlusIcon className="w-3 h-3" /> Create Sales Order
                  </Button>
                )}
              </>
            )}
          </TrailStep>

          {/* Step 3 — Purchase Requisition */}
          <TrailStep state={prState} icon={FileTextIcon} label="Purchase Requisition">
            {prList.length === 0 ? (
              <PendingCard label={spoList.length > 0 ? "Supplier PO raised without a requisition" : "No purchase requisition raised yet"} />
            ) : (
              <div className="space-y-1.5">
                {prList.map((r) => (
                  <DocCard
                    key={r.id}
                    docNo={r.no}
                    statusLabel={r.cfg.label}
                    statusColor={r.cfg.color}
                    meta={fmtDate(r.createdAt)}
                    onClick={() => router.push(r.href)}
                    actions={r.kind === "pr" ? actions?.prs[r.id] : actions?.pos[r.id]}
                    busy={busyId === r.id}
                    onAction={(k) => runAction(r.kind, r.id, r.no, k)}
                  />
                ))}
              </div>
            )}
          </TrailStep>

          {/* Step 4 — Supplier PO */}
          <TrailStep state={spoState} icon={PackageIcon} label="Supplier PO">
            {spoList.length === 0 ? (
              <PendingCard label="No supplier PO issued yet" />
            ) : (
              <>
              {activeSpoList.length === 0 && (
                <p className="text-[11px] text-red-600 dark:text-red-400 mb-1.5">Every supplier PO for this order is cancelled — none is live.</p>
              )}
              <div className="space-y-1.5">
                {spoList.map((po) => {
                  const cfg = PO_STATUS[po.status] ?? PO_STATUS.confirmed;
                  return (
                    <DocCard
                      key={po.id}
                      docNo={po.poNo ?? po.prNo ?? po.id}
                      statusLabel={cfg.label}
                      statusColor={cfg.color}
                      meta={fmtDate(po.createdAt)}
                      onClick={() => router.push(`/dashboard/procurement/purchase-order/${po.id}`)}
                      actions={actions?.pos[po.id]}
                      busy={busyId === po.id}
                      onAction={(k) => runAction("po", po.id, po.poNo ?? po.prNo ?? po.id, k)}
                    />
                  );
                })}
              </div>
              </>
            )}
          </TrailStep>

          {/* Step 4b — where a Supplier PO went to a sibling org */}
          {data.intercompany.map((leg, i) => (
            <TrailStep key={`${leg.viaPoNo}-${i}`} state={legState(leg)} icon={Link2Icon} label={`Intercompany · ${leg.organizationName}`}>
              <IntercompanyLegBody leg={leg} />
            </TrailStep>
          ))}

          {/* Step 4 — Delivery Orders */}
          <TrailStep state={doState} icon={TruckIcon} label="Delivery Orders">
            {dos.length === 0 ? (
              <PendingCard label="No delivery orders yet" />
            ) : (
              <div className="space-y-1.5">
                {dos.map((d) => {
                  const cfg = DO_STATUS[d.status] ?? DO_STATUS.draft;
                  return (
                    <DocCard
                      key={d.id}
                      docNo={d.doNo}
                      statusLabel={cfg.label}
                      statusColor={cfg.color}
                      meta={d.deliveryDate ? fmtDate(d.deliveryDate) : fmtDate(d.createdAt)}
                      onClick={() => router.push(`/dashboard/sales/delivery-order/${d.id}`)}
                    />
                  );
                })}
              </div>
            )}
          </TrailStep>

          {/* Step 5 — Invoices */}
          <TrailStep state={invState} icon={ReceiptIcon} label="Invoices">
            {invoices.length === 0 ? (
              <PendingCard label="No invoice issued yet" />
            ) : (
              <div className="space-y-1.5">
                {invoices.map((inv) => {
                  const cfg = INV_STATUS[inv.status] ?? INV_STATUS.draft;
                  return (
                    <DocCard
                      key={inv.id}
                      docNo={inv.invoiceNo}
                      statusLabel={cfg.label}
                      statusColor={cfg.color}
                      meta={inv.dueDate ? `Due ${fmtDate(inv.dueDate)}` : fmtDate(inv.createdAt)}
                      onClick={() => router.push(`/dashboard/sales/invoice/${inv.id}`)}
                    />
                  );
                })}
              </div>
            )}
          </TrailStep>

          {/* Step 6 — Payment */}
          <TrailStep state={pmt.state} icon={BanknoteIcon} label="Payment" isLast>
            {invoices.length === 0 ? (
              <PendingCard label="Awaiting invoice" />
            ) : (
              <div className="border border-border rounded-lg px-3 py-3 bg-background space-y-2">
                <div className="flex items-center justify-between">
                  <span className={cn("text-sm font-semibold", pmt.color)}>{pmt.label}</span>
                  {pmt.due && (
                    <span className={cn(
                      "text-xs",
                      pmt.state === "warn" ? "text-red-600 dark:text-red-400 font-medium" : "text-muted-foreground",
                    )}>
                      Due {fmtDate(pmt.due)}
                    </span>
                  )}
                </div>
                <div className="space-y-1 text-xs text-muted-foreground">
                  <div className="flex justify-between">
                    <span>Invoice total</span>
                    <span className="tabular-nums font-mono text-foreground">{fmt(pmt.total)}</span>
                  </div>
                  {pmt.paid > 0 && (
                    <div className="flex justify-between">
                      <span>Paid</span>
                      <span className="tabular-nums font-mono text-green-600 dark:text-green-400">{fmt(pmt.paid)}</span>
                    </div>
                  )}
                  {pmt.total - pmt.paid > 0 && (
                    <div className="flex justify-between border-t border-border/50 pt-1 mt-1 font-medium">
                      <span>Outstanding</span>
                      <span className={cn("tabular-nums font-mono",
                        pmt.state === "warn" ? "text-red-600 dark:text-red-400" : "text-foreground",
                      )}>
                        {fmt(pmt.total - pmt.paid)}
                      </span>
                    </div>
                  )}
                  {invoices.some((i) => i.paidAt) && (
                    <div className="flex justify-between">
                      <span>Paid on</span>
                      <span>{fmtDate(invoices.find((i) => i.paidAt)?.paidAt)}</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </TrailStep>
      </div>
    </div>
  );
}
