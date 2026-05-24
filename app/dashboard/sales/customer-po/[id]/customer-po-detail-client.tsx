"use client";

import { useRouter } from "next/navigation";
import {
  ArrowLeftIcon, CheckIcon, ClockIcon, AlertCircleIcon,
  FileTextIcon, PackageIcon, TruckIcon, ReceiptIcon,
  BanknoteIcon, CircleIcon, PencilIcon, ExternalLinkIcon,
  BuildingIcon, UserIcon, CalendarIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CustomerPoTrackingData } from "@/server/customer-purchase-order";

type Data = CustomerPoTrackingData;

// ── Formatters ─────────────────────────────────────────────────────────────
const fmt = (v: string | number | null | undefined) =>
  `RM ${Number(v ?? 0).toLocaleString("en-MY", { minimumFractionDigits: 2 })}`;

const fmtDate = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" }) : "—";

// ── Status configs ─────────────────────────────────────────────────────────
const CPO_STATUS: Record<string, { label: string; color: string }> = {
  received:     { label: "Received",     color: "bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400" },
  acknowledged: { label: "Acknowledged", color: "bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400" },
  fulfilled:    { label: "Fulfilled",    color: "bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400" },
  cancelled:    { label: "Cancelled",    color: "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400" },
};
const SO_STATUS: Record<string, { label: string; color: string }> = {
  draft:     { label: "Draft",      color: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400" },
  submitted: { label: "Submitted",  color: "bg-purple-50 text-purple-700 dark:bg-purple-900/20 dark:text-purple-400" },
  confirmed: { label: "Confirmed",  color: "bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400" },
  fulfilled: { label: "Fulfilled",  color: "bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400" },
  cancelled: { label: "Cancelled",  color: "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400" },
};
const PO_STATUS: Record<string, { label: string; color: string }> = {
  draft:        { label: "Draft",        color: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400" },
  sent:         { label: "Sent",         color: "bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400" },
  acknowledged: { label: "Acknowledged", color: "bg-purple-50 text-purple-700 dark:bg-purple-900/20 dark:text-purple-400" },
  received:     { label: "Received",     color: "bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400" },
  cancelled:    { label: "Cancelled",    color: "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400" },
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

function StatusBadge({ label, color }: { label: string; color: string }) {
  return (
    <span className={cn("text-[10px] font-medium rounded px-1.5 py-0.5 shrink-0", color)}>
      {label}
    </span>
  );
}

// ── Step indicator ─────────────────────────────────────────────────────────
type StepState = "done" | "active" | "pending" | "warn";

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
function DocCard({
  docNo, statusLabel, statusColor, meta, href, onClick,
}: {
  docNo: string;
  statusLabel: string;
  statusColor: string;
  meta?: React.ReactNode;
  href?: string;
  onClick?: () => void;
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

// ── Main component ─────────────────────────────────────────────────────────
export function CustomerPoDetailClient({
  data,
  permissions,
}: {
  data: Data;
  permissions: string[];
}) {
  const router = useRouter();
  const { cpo, createdByName, so, internalPos, dos, invoices } = data;
  const snap = cpo.customerSnapshot as any;
  const can  = (p: string) => permissions.includes("*") || permissions.includes(p);

  // Step states
  const cpoState: StepState = cpo.status === "fulfilled" ? "done" : cpo.status === "acknowledged" ? "active" : "active";
  const soState:  StepState = !so ? "pending" : so.status === "fulfilled" ? "done" : so.status === "confirmed" ? "active" : "active";
  const poState:  StepState = internalPos.length === 0 ? "pending"
    : internalPos.every((p) => p.status === "received") ? "done"
    : "active";
  const doState:  StepState = dos.length === 0 ? "pending"
    : dos.every((d) => d.status === "delivered") ? "done"
    : dos.some((d) => d.status === "delivered")  ? "active"
    : "active";
  const pmt = paymentState(invoices);
  const invState: StepState = invoices.length === 0 ? "pending"
    : invoices.every((i) => i.status === "paid") ? "done"
    : invoices.some((i) => i.status === "overdue") ? "warn"
    : "active";

  const cpoStatusCfg = CPO_STATUS[cpo.status] ?? CPO_STATUS.received;

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Button variant="ghost" size="icon" className="w-7 h-7 -ml-1.5" onClick={() => router.push("/dashboard/sales/customer-po")}>
              <ArrowLeftIcon className="w-3.5 h-3.5" />
            </Button>
            <h1 className="text-lg font-bold font-mono">{cpo.customerPoNo}</h1>
            <StatusBadge label={cpoStatusCfg.label} color={cpoStatusCfg.color} />
          </div>
          <p className="text-sm text-muted-foreground pl-9">
            {snap?.organizationName ?? snap?.name ?? "Unknown customer"}
            {" · "}Received {fmtDate(cpo.receivedDate ?? cpo.createdAt)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {can("customer-po:update") && (
            <Button variant="outline" size="sm" className="gap-1.5"
              onClick={() => router.push(`/dashboard/sales/customer-po/${cpo.id}/edit`)}>
              <PencilIcon className="w-3.5 h-3.5" /> Edit
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ── Left: Fulfilment trail ── */}
        <div className="lg:col-span-2">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-5">
            Fulfilment Trail
          </h2>

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
                  statusLabel={(SO_STATUS[so.status] ?? SO_STATUS.draft).label}
                  statusColor={(SO_STATUS[so.status] ?? SO_STATUS.draft).color}
                  meta={fmtDate(so.createdAt)}
                  onClick={() => router.push(`/dashboard/sales/order/${so.id}`)}
                />
                <div className="flex gap-4 mt-1.5 pl-1 text-xs text-muted-foreground">
                  <span>Value: {fmt(so.grandTotal)}</span>
                  {so.deliveryDate && <span>Delivery: {fmtDate(so.deliveryDate)}</span>}
                </div>
              </>
            ) : (
              <PendingCard label="No sales order linked yet" />
            )}
          </TrailStep>

          {/* Step 3 — Internal PO */}
          <TrailStep state={poState} icon={FileTextIcon} label="Internal Purchase Order">
            {internalPos.length === 0 ? (
              <PendingCard label="No internal PO raised yet" />
            ) : (
              <div className="space-y-1.5">
                {internalPos.map((po) => {
                  const cfg = PO_STATUS[po.status] ?? PO_STATUS.draft;
                  return (
                    <DocCard
                      key={po.id}
                      docNo={po.poNo}
                      statusLabel={cfg.label}
                      statusColor={cfg.color}
                      meta={fmtDate(po.createdAt)}
                      onClick={() => router.push(`/dashboard/procurement/purchase-order/${po.id}`)}
                    />
                  );
                })}
              </div>
            )}
          </TrailStep>

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

        {/* ── Right: Info sidebar ── */}
        <div className="space-y-4">
          {/* Customer details */}
          <section className="border border-border rounded-xl p-4 space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Customer</h2>
            {snap ? (
              <div className="space-y-1.5">
                {snap.name && (
                  <div className="flex items-center gap-2">
                    <UserIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <span className="text-sm font-medium">{[snap.title, snap.name].filter(Boolean).join(" ")}</span>
                  </div>
                )}
                {snap.organizationName && (
                  <div className="flex items-center gap-2">
                    <BuildingIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <span className="text-sm text-muted-foreground">{snap.organizationName}</span>
                  </div>
                )}
                {snap.email && <p className="text-xs text-muted-foreground pl-5">{snap.email}</p>}
                {snap.contactNo && <p className="text-xs text-muted-foreground pl-5">{snap.contactNo}</p>}
                {snap.organizationAddress && (
                  <p className="text-xs text-muted-foreground pl-5 leading-relaxed">{snap.organizationAddress}</p>
                )}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No customer info</p>
            )}
          </section>

          {/* PO details */}
          <section className="border border-border rounded-xl p-4 space-y-2.5">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">PO Details</h2>
            <Row label="PO No" value={cpo.customerPoNo} mono />
            <Row label="Amount" value={`${fmt(cpo.amount)}${cpo.currency !== "MYR" ? ` ${cpo.currency}` : ""}`} />
            <Row label="Received" value={fmtDate(cpo.receivedDate ?? cpo.createdAt)} />
            <Row label="Status" value={cpoStatusCfg.label} />
            {cpo.quotationNo && <Row label="Quotation" value={cpo.quotationNo} mono />}
            {cpo.salesOrderNo && <Row label="Sales Order" value={cpo.salesOrderNo} mono />}
            {createdByName && <Row label="Recorded by" value={createdByName} />}
          </section>

          {/* Progress summary */}
          <section className="border border-border rounded-xl p-4 space-y-2.5">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Progress</h2>
            <ProgressRow icon={PackageIcon} label="Sales Order" state={soState} note={so?.soNo} />
            <ProgressRow icon={FileTextIcon} label="Internal PO" state={poState}
              note={internalPos.length > 0 ? `${internalPos.length} PO${internalPos.length > 1 ? "s" : ""}` : undefined} />
            <ProgressRow icon={TruckIcon} label="Delivery" state={doState}
              note={dos.length > 0 ? `${dos.filter((d) => d.status === "delivered").length}/${dos.length} delivered` : undefined} />
            <ProgressRow icon={ReceiptIcon} label="Invoice" state={invState}
              note={invoices.length > 0 ? `${invoices.length} invoice${invoices.length > 1 ? "s" : ""}` : undefined} />
            <ProgressRow icon={BanknoteIcon} label="Payment" state={pmt.state} note={pmt.label} />
          </section>

          {/* Notes */}
          {cpo.notes && (
            <section className="border border-border rounded-xl p-4">
              <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">Notes</h2>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">{cpo.notes}</p>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Small helper components ────────────────────────────────────────────────
function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <span className="text-xs text-muted-foreground shrink-0">{label}</span>
      <span className={cn("text-xs text-right", mono && "font-mono")}>{value}</span>
    </div>
  );
}

function ProgressRow({
  icon: Icon, label, state, note,
}: {
  icon: React.ElementType;
  label: string;
  state: StepState;
  note?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className={cn(
        "w-5 h-5 rounded-full flex items-center justify-center shrink-0",
        state === "done"    && "bg-green-500 text-white",
        state === "active"  && "bg-primary text-primary-foreground",
        state === "warn"    && "bg-red-500 text-white",
        state === "pending" && "bg-muted border border-border text-muted-foreground",
      )}>
        {state === "done" ? <CheckIcon className="w-2.5 h-2.5" />
          : state === "warn" ? <AlertCircleIcon className="w-2.5 h-2.5" />
          : <Icon className="w-2.5 h-2.5" />}
      </div>
      <span className={cn("text-xs flex-1", state === "pending" ? "text-muted-foreground" : "text-foreground")}>{label}</span>
      {note && <span className="text-[10px] text-muted-foreground">{note}</span>}
    </div>
  );
}
