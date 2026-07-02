"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useEffect, useState } from "react";
import {
  deleteSalesOrder,
  submitSalesOrder,
  approveSalesOrder,
  rejectSalesOrder,
  recallSalesOrder,
  toggleSoItemApprovalRejected,
  type SalesOrderWithItems,
} from "@/server/sales-order";
import {
  checkAndReserveStock,
  getStockInsight,
  type StockCheckResult,
} from "@/server/stock-reservation";
import { type QuotationBasic } from "@/server/quotation";
import { type PrListRow } from "@/server/purchase-requisition";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import {
  ArrowLeftIcon, PencilIcon, TrashIcon,
  UserIcon, BuildingIcon, CalendarIcon, MapPinIcon,
  FileTextIcon, PackageIcon, CheckIcon, XIcon, RotateCcwIcon, SendIcon, ClockIcon,
  PrinterIcon, ShoppingCartIcon, WarehouseIcon, AlertTriangleIcon, CheckCircle2Icon,
  Loader2Icon, TruckIcon, LinkIcon, PlusIcon, DatabaseIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

const fmt = (v: string | number | null | undefined) =>
  `RM ${Number(v ?? 0).toLocaleString("en-MY", { minimumFractionDigits: 2 })}`;

const fmtDate = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const SO_STATUS: Record<string, { label: string; className: string }> = {
  draft:     { label: "Draft",      className: "bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400" },
  submitted: { label: "Awaiting Approval",  className: "bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-400" },
  confirmed: { label: "Confirmed",  className: "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400" },
  fulfilled: { label: "Fulfilled",  className: "bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400" },
  cancelled: { label: "Cancelled",  className: "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400" },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = SO_STATUS[status] ?? SO_STATUS.draft;
  return <span className={cn("text-[11px] font-medium rounded px-2 py-0.5", cfg.className)}>{cfg.label}</span>;
}

const QT_STATUS: Record<string, { label: string; className: string }> = {
  draft:     { label: "Draft",     className: "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400" },
  final:     { label: "Final",     className: "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400" },
  approved:  { label: "Approved",  className: "bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400" },
  published: { label: "Published", className: "bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-400" },
};

export function SalesOrderDetailClient({
  order,
  linkedQuotations = [],
  linkedDos,
  linkedPrs,
  permissions,
  currentUserId,
  draftRedirected,
  itemDeliveredQtys = {},
}: {
  order: SalesOrderWithItems;
  linkedQuotations?: QuotationBasic[];
  linkedDos: { id: string; doNo: string; customerPoId: string | null; customerPoNo: string | null; status: string }[];
  linkedPrs: PrListRow[];
  permissions: string[];
  currentUserId: string;
  draftRedirected?: boolean;
  itemDeliveredQtys?: Record<string, number>;
}) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [status, setStatus] = useState(order.status ?? "draft");
  const [actioning, setActioning] = useState<"submit" | "approve" | "reject" | "recall" | null>(null);
  const [rechecking, setRechecking] = useState(false);
  const [insight, setInsight] = useState<StockCheckResult | null>(null);
  const [insightLoading, setInsightLoading] = useState(false);
  const [stockStatus, setStockStatus] = useState<string | null>(order.stockReservationStatus ?? null);
  const [approvalRejectedItems, setApprovalRejectedItems] = useState<Set<string>>(
    () => new Set(order.items.filter((i) => (i as any).approvalRejected).map((i) => i.id)),
  );
  const [approvalRejectionMeta, setApprovalRejectionMeta] = useState<Record<string, { byName: string | null; at: Date | null }>>(
    () => Object.fromEntries(
      order.items
        .filter((i) => (i as any).approvalRejected)
        .map((i) => [
          i.id,
          {
            byName: (i as any).approvalRejectedByName ?? null,
            at: (i as any).approvalRejectedAt ? new Date((i as any).approvalRejectedAt) : null,
          },
        ]),
    ),
  );
  const [togglingApprovalReject, setTogglingApprovalReject] = useState<string | null>(null);

  // Sync with server-refreshed prop
  useEffect(() => {
    setStatus(order.status ?? "draft");
    setStockStatus(order.stockReservationStatus ?? null);
  }, [order.status, order.stockReservationStatus]);

  // Read-only stock insight for confirmed orders
  useEffect(() => {
    if (status !== "confirmed" || !can("delivery-order:create")) return;
    let cancelled = false;
    setInsightLoading(true);
    getStockInsight(order.id)
      .then((r) => { if (!cancelled) setInsight(r); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setInsightLoading(false); });
    return () => { cancelled = true; };
  }, [order.id, status, stockStatus]);

  const can = (p: string) => permissions.includes("*") || permissions.includes(p);
  const isOwner = order.createdBy === currentUserId;

  const snap = order.customerSnapshot as any;
  const custName = snap ? [snap.title, snap.name].filter(Boolean).join(" ") : null;

  // Build deduplicated customer entries from CPO links, fall back to SO snapshot
  const seen = new Set<string>();
  const cpoCustomerEntries = (
    order.cpoCustomers.length > 0
      ? order.cpoCustomers.map((c) => ({
          label: c.customerSnapshot?.organizationName ?? (c.customerSnapshot ? [c.customerSnapshot.title, c.customerSnapshot.name].filter(Boolean).join(" ") : ""),
          person: c.customerSnapshot ? [c.customerSnapshot.title, c.customerSnapshot.name].filter(Boolean).join(" ") : null,
          address: null as string | null,
        }))
      : custName
        ? [{ label: snap?.organizationName ?? custName, person: custName, address: snap?.organizationAddress ?? null }]
        : []
  ).filter((c) => {
    if (!c.label || seen.has(c.label)) return false;
    seen.add(c.label);
    return true;
  });

  async function handleDelete() {
    if (!confirm(`Delete ${order.soNo}? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await deleteSalesOrder(order.id);
      toast.success("Sales order deleted");
      router.push("/dashboard/sales/order");
    } catch (e: any) {
      toast.error(e.message);
      setDeleting(false);
    }
  }

  async function handleSubmit() {
    setActioning("submit");
    try {
      await submitSalesOrder(order.id);
      toast.success("Sales order sent for approval");
      router.refresh();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setActioning(null);
    }
  }

  async function handleApprove() {
    setActioning("approve");
    try {
      await approveSalesOrder(order.id);
      toast.success("Sales order approved");
      router.refresh();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setActioning(null);
    }
  }

  async function handleReject() {
    if (!confirm(`Reject ${order.soNo}? This will return it to draft for revision.`)) return;
    setActioning("reject");
    try {
      await rejectSalesOrder(order.id);
      toast.success("Sales order returned for revision");
      router.refresh();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setActioning(null);
    }
  }

  async function handleRecall() {
    if (!confirm(`Recall ${order.soNo}? This will return it to draft.`)) return;
    setActioning("recall");
    try {
      await recallSalesOrder(order.id);
      toast.success("Sales order recalled");
      router.refresh();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setActioning(null);
    }
  }

  async function handleRecheckStock() {
    setRechecking(true);
    try {
      const result = await checkAndReserveStock(order.id);
      setInsight(result);
      setStockStatus(result.canReserve ? "reserved" : "insufficient");
      if (result.canReserve) {
        toast.success("Stock reserved successfully");
      } else {
        toast.warning("Still insufficient — see shortage details below");
      }
      router.refresh();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setRechecking(false);
    }
  }

  async function handleToggleApprovalReject(itemId: string) {
    const nowRejected = !approvalRejectedItems.has(itemId);
    setTogglingApprovalReject(itemId);
    try {
      const result = await toggleSoItemApprovalRejected(itemId, nowRejected);
      setApprovalRejectedItems((prev) => {
        const next = new Set(prev);
        if (nowRejected) next.add(itemId); else next.delete(itemId);
        return next;
      });
      setApprovalRejectionMeta((prev) => {
        if (!nowRejected) {
          const { [itemId]: _, ...rest } = prev;
          return rest;
        }
        return { ...prev, [itemId]: { byName: result.rejectedByName, at: result.rejectedAt } };
      });
      toast.success(nowRejected ? "Item marked for rejection" : "Item rejection cleared");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setTogglingApprovalReject(null);
    }
  }

  return (
    <div className="p-6 space-y-6">
      {draftRedirected && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-700 px-4 py-3 text-sm text-amber-800 dark:text-amber-300 flex items-center gap-2">
          <span className="font-medium">Draft already exists.</span>
          You can only have one draft SO at a time. Submit or delete this one before creating a new order.
        </div>
      )}
      <PageHeader
        title={order.soNo}
        description={fmtDate(order.createdAt)}
        action={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => router.push("/dashboard/sales/order")} className="gap-1.5">
              <ArrowLeftIcon className="w-3.5 h-3.5" /> Back
            </Button>
            {(status === "confirmed" || status === "fulfilled") && (
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => window.open(`/api/sales-order/${order.id}/pdf`, "_blank")}>
                <PrinterIcon className="w-3.5 h-3.5" /> PDF
              </Button>
            )}
            {status === "confirmed" && can("purchase-requisition:create") && (
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => router.push(`/dashboard/procurement/requisition/create?soId=${order.id}`)}>
                <ShoppingCartIcon className="w-3.5 h-3.5" /> Raise Requisition
              </Button>
            )}
            {status === "confirmed" && can("sales-order:update") && (
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => router.push(`/dashboard/sales/consignment/create?soId=${order.id}&soNo=${encodeURIComponent(order.soNo)}`)}>
                <PackageIcon className="w-3.5 h-3.5" /> Create Consignment
              </Button>
            )}
            {status === "draft" ? (
              <>
                {isOwner && can("sales-order:update") && (
                  <Button variant="outline" size="sm" onClick={() => router.push(`/dashboard/sales/order/${order.id}/edit`)} className="gap-1.5">
                    <PencilIcon className="w-3.5 h-3.5" /> Edit
                  </Button>
                )}
                {isOwner && can("sales-order:delete") && (
                  <Button variant="outline" size="sm" className="gap-1.5 text-destructive hover:text-destructive" onClick={handleDelete} disabled={deleting}>
                    <TrashIcon className="w-3.5 h-3.5" /> Delete
                  </Button>
                )}
              </>
            ) : status === "cancelled" ? (
              <>
                <StatusBadge status={status} />
                {isOwner && can("sales-order:delete") && (
                  <Button variant="outline" size="sm" className="gap-1.5 text-destructive hover:text-destructive" onClick={handleDelete} disabled={deleting}>
                    <TrashIcon className="w-3.5 h-3.5" /> Delete
                  </Button>
                )}
              </>
            ) : (
              <StatusBadge status={status} />
            )}
          </div>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column — main info */}
        <div className="lg:col-span-2 space-y-5">

          {/* Customer */}
          <section className="border border-border rounded-xl p-4">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              Customer{cpoCustomerEntries.length > 1 ? "s" : ""}
            </h2>
            {cpoCustomerEntries.length > 0 ? (
              <div className="space-y-0">
                {cpoCustomerEntries.map((c, i) => {
                  const hasBoth = c.person && c.person !== c.label && c.label;
                  return (
                    <div key={i} className={`grid grid-cols-2 gap-x-6 gap-y-0.5 ${i > 0 ? "border-t border-border/50 pt-3 mt-3" : ""}`}>
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">Organization</p>
                        <p className="text-sm font-medium">{c.label || "—"}</p>
                        {c.address && (
                          <p className="text-[11px] text-muted-foreground mt-1 leading-snug">{c.address}</p>
                        )}
                      </div>
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">Contact</p>
                        <p className="text-sm">{hasBoth ? c.person : "—"}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No customer linked</p>
            )}
          </section>

          {/* Items */}
          <section className="border border-border rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 pt-4 pb-3">
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Items</h2>
              <span className="text-[10px] font-medium tabular-nums px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{order.items.length}</span>
            </div>
            {order.items.length === 0 ? (
              <p className="text-sm text-muted-foreground px-4 pb-4">No items</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-muted/50 border-y border-border/60 text-muted-foreground">
                      <th className="text-left align-middle py-1.5 pl-4 pr-3 w-6 text-[10px] tracking-wider font-medium uppercase">#</th>
                      <th className="text-left align-middle py-1.5 pr-3 w-20 text-[10px] tracking-wider font-medium uppercase">Code</th>
                      <th className="text-left align-middle py-1.5 pr-3 text-[10px] tracking-wider font-medium uppercase">Description</th>
                      <th className="text-right align-middle py-1.5 pr-3 w-12 text-[10px] tracking-wider font-medium uppercase">Qty</th>
                      <th className="text-center align-middle py-1.5 pr-3 w-16 text-[10px] tracking-wider font-medium uppercase">Total qty</th>
                      <th className="text-left align-middle py-1.5 pr-3 w-12 text-[10px] tracking-wider font-medium uppercase">UOM</th>
                      {(status === "confirmed" || status === "fulfilled") && Object.keys(itemDeliveredQtys).length > 0 && (
                        <th className="text-right align-middle py-1.5 pr-3 w-20 text-[10px] tracking-wider font-medium uppercase">Delivered</th>
                      )}
                      <th className="text-right align-middle py-1.5 pr-3 w-24 text-[10px] tracking-wider font-medium uppercase">Unit price</th>
                      <th className="text-right align-middle py-1.5 pr-3 w-14 text-[10px] tracking-wider font-medium uppercase">Disc%</th>
                      <th className="text-right align-middle py-1.5 pr-4 w-24 text-[10px] tracking-wider font-medium uppercase">Total</th>
                      {can("sales-order:update") && status === "confirmed" && (
                        <th className="py-1.5 w-8" />
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const COLOR_PALETTE = [
                        { hdr: "bg-violet-100/70 dark:bg-violet-900/25", row: "bg-violet-50/40 dark:bg-violet-900/10", border: "border-l-4 border-l-violet-400 dark:border-l-violet-500", text: "text-violet-700 dark:text-violet-300" },
                        { hdr: "bg-indigo-100/70 dark:bg-indigo-900/25", row: "bg-indigo-50/40 dark:bg-indigo-900/10", border: "border-l-4 border-l-indigo-400 dark:border-l-indigo-500", text: "text-indigo-700 dark:text-indigo-300" },
                        { hdr: "bg-rose-100/70 dark:bg-rose-900/25", row: "bg-rose-50/40 dark:bg-rose-900/10", border: "border-l-4 border-l-rose-400 dark:border-l-rose-500", text: "text-rose-700 dark:text-rose-300" },
                        { hdr: "bg-fuchsia-100/70 dark:bg-fuchsia-900/25", row: "bg-fuchsia-50/40 dark:bg-fuchsia-900/10", border: "border-l-4 border-l-fuchsia-400 dark:border-l-fuchsia-500", text: "text-fuchsia-700 dark:text-fuchsia-300" },
                        { hdr: "bg-orange-100/70 dark:bg-orange-900/25", row: "bg-orange-50/40 dark:bg-orange-900/10", border: "border-l-4 border-l-orange-400 dark:border-l-orange-500", text: "text-orange-700 dark:text-orange-300" },
                        { hdr: "bg-teal-100/70 dark:bg-teal-900/25", row: "bg-teal-50/40 dark:bg-teal-900/10", border: "border-l-4 border-l-teal-400 dark:border-l-teal-500", text: "text-teal-700 dark:text-teal-300" },
                      ];
                      const stableColorIdx = (key: string) => {
                        let h = 0;
                        for (let i = 0; i < key.length; i++) { h = Math.imul(31, h) + key.charCodeAt(i) | 0; }
                        return Math.abs(h) % COLOR_PALETTE.length;
                      };
                      // For urgent SO: palette by first-appearance order of quotation IDs (avoids hash collisions)
                      const urgentQtOrder = order.soType === "urgent" ? (() => {
                        const seen: string[] = [];
                        const lqs = (order.linkedQuotations as { id: string }[] | null) ?? [];
                        for (const q of lqs) { if (!seen.includes(q.id)) seen.push(q.id); }
                        for (const it of order.items) { const qid = (it as any).sourceQuotationId; if (qid && !seen.includes(qid)) seen.push(qid); }
                        return seen;
                      })() : null;
                      const getColor = (item: typeof order.items[0]) => {
                        if (order.soType === "urgent" && urgentQtOrder) {
                          const qtId = (item as any).sourceQuotationId || null;
                          if (!qtId) return null;
                          const idx = urgentQtOrder.indexOf(qtId);
                          return idx >= 0 ? COLOR_PALETTE[idx % COLOR_PALETTE.length] : null;
                        }
                        const key = (item as any).setGroupId || (item as any).sourceCustomerPoId || (item as any).sourceQuotationId;
                        return key ? COLOR_PALETTE[stableColorIdx(key)] : null;
                      };

                      const distinctCpos = new Set(
                        order.items.map((i) => (i as any).sourceCustomerPoId).filter(Boolean),
                      );
                      const colCount = 9
                        + ((status === "confirmed" || status === "fulfilled") && Object.keys(itemDeliveredQtys).length > 0 ? 1 : 0)
                        + (can("sales-order:approve") && status === "submitted" ? 1 : 0);

                      const isUrgent = order.soType === "urgent";
                      const orderLinkedQuotations = (order.linkedQuotations as { id: string; quotationNo: string; customerId?: string | null; customerSnapshot?: { title?: string; name: string; organizationName?: string } | null; salesPersonName?: string | null }[] | null) ?? [];
                      let lastCpoId: string | undefined = undefined;
                      let lastQtId: string | undefined = undefined;
                      const shownLooseHeaderForCpo = new Set<string>();
                      const renderItems = isUrgent ? (() => {
                        const seenQtIds = new Set<string>();
                        const qtOrder: string[] = [];
                        for (const it of order.items) {
                          const qtId = (it as any).sourceQuotationId || "__none__";
                          if (!seenQtIds.has(qtId)) { seenQtIds.add(qtId); qtOrder.push(qtId); }
                        }
                        return qtOrder.flatMap((qtId) => {
                          const qtItems = order.items.filter((i) => ((i as any).sourceQuotationId || "__none__") === qtId);
                          const seenGids = new Set<string>();
                          const groupOrder: string[] = [];
                          for (const it of qtItems) {
                            if ((it as any).setGroupId && !seenGids.has((it as any).setGroupId)) { seenGids.add((it as any).setGroupId); groupOrder.push((it as any).setGroupId); }
                          }
                          return [
                            ...groupOrder.flatMap((gid) => qtItems.filter((i) => (i as any).setGroupId === gid)),
                            ...qtItems.filter((i) => !(i as any).setGroupId),
                          ];
                        });
                      })() : order.items;
                      return renderItems.flatMap((item, idx) => {
                        const rows: React.JSX.Element[] = [];
                        const color = getColor(item);
                        const isAdditional = (item as any).isAdditional;

                        // Urgent SO: customer/org section header when linked quotation changes
                        if (isUrgent && (item as any).sourceQuotationId !== lastQtId) {
                          lastQtId = (item as any).sourceQuotationId;
                          const qt = orderLinkedQuotations.find((q) => q.id === (item as any).sourceQuotationId);
                          const snap = qt?.customerSnapshot;
                          if (snap) {
                            const custDisplayName = [snap.title, snap.name].filter(Boolean).join(" ");
                            const orgName = (snap as any).organizationName ?? null;
                            const matchingCpo = order.cpoCustomers.find((cpo) =>
                              qt && (
                                (qt.customerId && cpo.customerId === qt.customerId) ||
                                (!qt.customerId && qt.customerSnapshot?.name && cpo.customerSnapshot?.name === qt.customerSnapshot?.name)
                              )
                            );
                            rows.push(
                              <tr key={`qt-section-${(item as any).sourceQuotationId ?? "none"}-${idx}`}>
                                <td colSpan={colCount} className={idx === 0 ? "pb-1" : "pt-4 pb-1"}>
                                  <div className={`flex items-center gap-2 ${idx > 0 ? "border-t border-border/60 pt-2" : ""}`}>
                                    {matchingCpo ? (
                                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-md font-mono ${color?.text ?? "text-muted-foreground"} ${color?.hdr ?? "bg-muted/50"} border border-current/20`}>
                                        {matchingCpo.customerPoNo}
                                      </span>
                                    ) : (
                                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md font-mono text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800">CPO To Follow</span>
                                    )}
                                    <span className="text-[10px] font-semibold text-foreground">{custDisplayName}</span>
                                    {orgName && <span className="text-[10px] text-muted-foreground">{orgName}</span>}
                                  </div>
                                </td>
                              </tr>,
                            );
                          }
                        }

                        // CPO section header (standard SO with multiple CPOs)
                        if (!isUrgent && distinctCpos.size > 1 && (item as any).sourceCustomerPoId !== lastCpoId) {
                          lastCpoId = (item as any).sourceCustomerPoId;
                          const cpoInfo = order.cpoCustomers.find((c) => c.customerPoId === (item as any).sourceCustomerPoId);
                          const cpoCustomer = cpoInfo?.customerSnapshot
                            ? [cpoInfo.customerSnapshot.title, cpoInfo.customerSnapshot.name].filter(Boolean).join(" ")
                            : null;
                          rows.push(
                            <tr key={`cpo-section-${(item as any).sourceCustomerPoId ?? "none"}-${idx}`}>
                              <td colSpan={colCount} className={`pt-4 pb-1 pl-4 ${idx === 0 ? "pt-1" : ""}`}>
                                <div className={`flex items-center gap-2 border-t border-border/60 pt-2 ${idx === 0 ? "border-t-0 pt-0" : ""}`}>
                                  {cpoInfo ? (
                                    <>
                                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-md font-mono ${color?.text ?? "text-muted-foreground"} ${color?.hdr ?? "bg-muted/50"} border border-current/20`}>
                                        {cpoInfo.customerPoNo}
                                      </span>
                                      {cpoCustomer && <span className="text-[10px] text-muted-foreground">{cpoCustomer}</span>}
                                    </>
                                  ) : (
                                    <span className="text-[10px] text-muted-foreground italic">No CPO</span>
                                  )}
                                </div>
                              </td>
                            </tr>,
                          );
                        }

                        // Other items header (ungrouped items when sets also exist)
                        if (!(item as any).setGroupId) {
                          const cpoKey = isUrgent
                            ? ((item as any).sourceQuotationId ?? "__global__")
                            : ((item as any).sourceCustomerPoId ?? "__global__");
                          const sectionHasGroups = isUrgent
                            ? renderItems.some((i) => (i as any).setGroupId && ((i as any).sourceQuotationId ?? "__none__") === ((item as any).sourceQuotationId ?? "__none__"))
                            : renderItems.some((i) => (i as any).setGroupId && (distinctCpos.size > 1 ? (i as any).sourceCustomerPoId === (item as any).sourceCustomerPoId : true));
                          if (sectionHasGroups && !shownLooseHeaderForCpo.has(cpoKey)) {
                            shownLooseHeaderForCpo.add(cpoKey);
                            rows.push(
                              <tr key={`loose-hdr-${cpoKey}`} className="bg-muted/40 border-b border-border/40">
                                <td colSpan={colCount} className="pl-4 pr-4 py-1.5">
                                  <span className="text-[10px] font-semibold tracking-wider uppercase text-muted-foreground">other items</span>
                                </td>
                              </tr>,
                            );
                          }
                        }

                        // Set group header
                        if ((item as any).setGroupId && renderItems.findIndex((i) => (i as any).setGroupId === (item as any).setGroupId) === idx) {
                          const groupItems = order.items.filter((i) => (i as any).setGroupId === (item as any).setGroupId);
                          const groupTotal = groupItems.reduce((s, i) => s + parseFloat(i.totalPrice ?? "0"), 0);
                          const setQtyNum = parseFloat((item as any).setQty || "1") || 1;
                          const perSetPrice = groupTotal / setQtyNum;
                          rows.push(
                            <tr key={`grp-${(item as any).setGroupId}`} className={`${color?.hdr ?? "bg-muted/40"} border-b border-border/40`}>
                              <td colSpan={colCount} className={`pl-4 pr-4 py-1.5 ${color?.border ?? ""}`}>
                                <div className="flex items-center gap-2">
                                  <span className={`text-[11px] font-bold tracking-tight ${color?.text ?? "text-foreground"}`}>{(item as any).setGroupLabel || "Set"}</span>
                                  <span className={`text-[10px] px-1.5 py-0.5 rounded border font-mono ${color?.text ?? "text-muted-foreground"} border-current/30 bg-white/40 dark:bg-black/20`}>
                                    × {(item as any).setQty || "1"} sets
                                  </span>
                                  {groupTotal > 0 && (
                                    <>
                                      <span className={`text-[10px] tabular-nums ${color?.text ?? "text-muted-foreground"}`}>1 set: {fmt(perSetPrice)}</span>
                                      <span className={`ml-auto text-[11px] font-semibold ${color?.text ?? "text-foreground"} tabular-nums`}>{fmt(groupTotal)}</span>
                                    </>
                                  )}
                                </div>
                              </td>
                            </tr>,
                          );
                        }

                        const isApprovalRejected = approvalRejectedItems.has(item.id);
                        const arCls = isApprovalRejected ? "line-through" : "";
                        rows.push(
                          <tr key={item.id} className={cn("border-b border-border/40 last:border-0 transition-colors hover:brightness-[0.97] dark:hover:brightness-110", isApprovalRejected && "opacity-50", color ? color.row : "bg-background", isAdditional ? "text-red-500 dark:text-red-400" : "")}>
                            <td className={`py-2 pl-4 pr-3 align-top ${arCls} ${isAdditional ? "text-red-500 dark:text-red-400" : "text-muted-foreground"}`}>{item.rowNo}</td>
                            <td className={`py-2 pr-3 align-top ${arCls}`}>
                              <div className={`font-mono ${isAdditional ? "text-red-500 dark:text-red-400" : "text-muted-foreground"}`}>{item.productCode || "—"}</div>
                              {((item as any).codeSource ?? []).includes("quotation") && (
                                <span className="inline-flex items-center gap-1 mt-0.5 text-[10px] px-1.5 py-0.5 rounded-md bg-green-50 text-green-700 border border-green-200 dark:bg-green-950/40 dark:text-green-400 dark:border-green-800">
                                  <LinkIcon className="w-3 h-3 shrink-0" />from quotation
                                </span>
                              )}
                              {((item as any).codeSource ?? []).includes("cpo") && (
                                <span className="inline-flex items-center gap-1 mt-0.5 text-[10px] px-1.5 py-0.5 rounded-md bg-green-50 text-green-700 border border-green-200 dark:bg-green-950/40 dark:text-green-400 dark:border-green-800">
                                  <FileTextIcon className="w-3 h-3 shrink-0" />from CPO
                                </span>
                              )}
                              {((item as any).codeSource ?? []).includes("user") && (
                                <span className="inline-flex items-center gap-1 mt-0.5 text-[10px] px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800">
                                  <PencilIcon className="w-3 h-3 shrink-0" />{(item as any).editedBy || "?"} edited CPO
                                </span>
                              )}
                              {((item as any).codeSource ?? []).includes("so") && (
                                <span className="inline-flex items-center gap-1 mt-0.5 text-[10px] px-1.5 py-0.5 rounded-md bg-orange-50 text-orange-700 border border-orange-200 dark:bg-orange-950/40 dark:text-orange-400 dark:border-orange-800">
                                  <PencilIcon className="w-3 h-3 shrink-0" />{(item as any).soEditedBy || "?"} edited SO
                                </span>
                              )}
                            </td>
                            <td className="py-2 pr-3">
                              {/* Rejected tag sits outside the line-through wrapper so it is never struck through */}
                              {isApprovalRejected && (() => {
                                const meta = approvalRejectionMeta[item.id];
                                const byName = meta?.byName ?? null;
                                const at = meta?.at ? new Date(meta.at).toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" }) : null;
                                return (
                                  <div className="mb-1">
                                    <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-red-50 text-red-600 border border-red-200 dark:bg-red-950/40 dark:text-red-400 dark:border-red-800">
                                      <XIcon className="w-3 h-3 shrink-0" />
                                      rejected{byName ? ` by ${byName}` : ""}
                                      {at ? ` · ${at}` : ""}
                                    </span>
                                  </div>
                                );
                              })()}
                              <div className={cn("flex flex-col gap-1", arCls)}>
                                <span>{item.description || "—"}</span>
                                <div className="flex items-center gap-1 flex-wrap">
                                  {isAdditional && (
                                    <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-red-50 text-red-600 border border-red-200 dark:bg-red-950/40 dark:text-red-400 dark:border-red-800">
                                      <PlusIcon className="w-3 h-3 shrink-0" /> additional row
                                    </span>
                                  )}
                                  {((item as any).descriptionSource ?? []).includes("quote") && (
                                    <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-green-50 text-green-700 border border-green-200 dark:bg-green-950/40 dark:text-green-400 dark:border-green-800">
                                      <LinkIcon className="w-3 h-3 shrink-0" /> from quotation
                                    </span>
                                  )}
                                  {((item as any).descriptionSource ?? []).includes("cpo") && (
                                    <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-green-50 text-green-700 border border-green-200 dark:bg-green-950/40 dark:text-green-400 dark:border-green-800">
                                      <FileTextIcon className="w-3 h-3 shrink-0" /> from CPO
                                    </span>
                                  )}
                                  {((item as any).descriptionSource ?? []).includes("catalog") && (
                                    <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-blue-50 text-blue-600 border border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800">
                                      <DatabaseIcon className="w-3 h-3 shrink-0" /> from product table
                                    </span>
                                  )}
                                  {((item as any).descriptionSource ?? []).includes("user") && (
                                    <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800">
                                      <PencilIcon className="w-3 h-3 shrink-0" />
                                      {(item as any).editedBy || "?"} edited CPO
                                    </span>
                                  )}
                                </div>
                              </div>
                            </td>
                            <td className="py-2 pr-3 align-top">
                              <div className="text-right tabular-nums">{item.qty}</div>
                              {((item as any).qtySource ?? []).includes("quotation") && (
                                <span className="inline-flex items-center gap-1 mt-0.5 text-[10px] px-1.5 py-0.5 rounded-md bg-green-50 text-green-700 border border-green-200 dark:bg-green-950/40 dark:text-green-400 dark:border-green-800">
                                  <LinkIcon className="w-3 h-3 shrink-0" />from quotation
                                </span>
                              )}
                              {((item as any).qtySource ?? []).includes("cpo") && (
                                <span className="inline-flex items-center gap-1 mt-0.5 text-[10px] px-1.5 py-0.5 rounded-md bg-green-50 text-green-700 border border-green-200 dark:bg-green-950/40 dark:text-green-400 dark:border-green-800">
                                  <FileTextIcon className="w-3 h-3 shrink-0" />from CPO
                                </span>
                              )}
                              {((item as any).qtySource ?? []).includes("user") && (
                                <span className="inline-flex items-center gap-1 mt-0.5 text-[10px] px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800">
                                  <PencilIcon className="w-3 h-3 shrink-0" />{(item as any).editedBy || "?"} edited CPO
                                </span>
                              )}
                              {((item as any).qtySource ?? []).includes("so") && (
                                <span className="inline-flex items-center gap-1 mt-0.5 text-[10px] px-1.5 py-0.5 rounded-md bg-orange-50 text-orange-700 border border-orange-200 dark:bg-orange-950/40 dark:text-orange-400 dark:border-orange-800">
                                  <PencilIcon className="w-3 h-3 shrink-0" />{(item as any).soEditedBy || "?"} edited SO
                                </span>
                              )}
                            </td>
                            <td className={`py-2 pr-3 align-top text-center tabular-nums font-mono ${arCls} ${isAdditional ? "text-red-500 dark:text-red-400" : "text-muted-foreground"}`}>
                              {(() => { const s = parseFloat((item as any).setQty || "0") || 1; const q = parseFloat(item.qty || "0"); return s > 1 ? (q * s).toLocaleString("en-MY") : q.toLocaleString("en-MY"); })()}
                            </td>
                            <td className={`py-2 pr-3 align-top ${arCls} ${isAdditional ? "text-red-500 dark:text-red-400" : "text-muted-foreground"}`}>{item.uom || "—"}</td>
                            {(status === "confirmed" || status === "fulfilled") && Object.keys(itemDeliveredQtys).length > 0 && (() => {
                              const delivered = itemDeliveredQtys[item.id] ?? 0;
                              const total = parseFloat(item.qty ?? "0");
                              const pct = total > 0 ? Math.min(100, (delivered / total) * 100) : 0;
                              const full = delivered >= total;
                              return (
                                <td className={`py-2 pr-3 align-top text-right tabular-nums ${arCls}`}>
                                  <span className={cn("text-[11px] font-medium", full ? "text-green-600 dark:text-green-400" : delivered > 0 ? "text-blue-600 dark:text-blue-400" : "text-muted-foreground")}>
                                    {delivered > 0 ? `${delivered}/${item.qty}` : "—"}
                                  </span>
                                  {delivered > 0 && !full && (
                                    <div className="mt-0.5 h-1 rounded-full bg-muted overflow-hidden w-12 ml-auto">
                                      <div className="h-full bg-blue-400 rounded-full" style={{ width: `${pct}%` }} />
                                    </div>
                                  )}
                                </td>
                              );
                            })()}
                            <td className={`py-2 pr-3 align-top ${arCls}`}>
                              <div className="text-right tabular-nums">{fmt(item.unitPrice)}</div>
                              {((item as any).unitPriceSource ?? []).includes("quotation") && (
                                <span className="inline-flex items-center gap-1 mt-0.5 text-[10px] px-1.5 py-0.5 rounded-md bg-green-50 text-green-700 border border-green-200 dark:bg-green-950/40 dark:text-green-400 dark:border-green-800">
                                  <LinkIcon className="w-3 h-3 shrink-0" />from quotation
                                </span>
                              )}
                              {((item as any).unitPriceSource ?? []).includes("cpo") && (
                                <span className="inline-flex items-center gap-1 mt-0.5 text-[10px] px-1.5 py-0.5 rounded-md bg-green-50 text-green-700 border border-green-200 dark:bg-green-950/40 dark:text-green-400 dark:border-green-800">
                                  <FileTextIcon className="w-3 h-3 shrink-0" />from CPO
                                </span>
                              )}
                              {((item as any).unitPriceSource ?? []).includes("user") && (
                                <span className="inline-flex items-center gap-1 mt-0.5 text-[10px] px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800">
                                  <PencilIcon className="w-3 h-3 shrink-0" />{(item as any).editedBy || "?"} edited CPO
                                </span>
                              )}
                              {((item as any).unitPriceSource ?? []).includes("so") && (
                                <span className="inline-flex items-center gap-1 mt-0.5 text-[10px] px-1.5 py-0.5 rounded-md bg-orange-50 text-orange-700 border border-orange-200 dark:bg-orange-950/40 dark:text-orange-400 dark:border-orange-800">
                                  <PencilIcon className="w-3 h-3 shrink-0" />{(item as any).soEditedBy || "?"} edited SO
                                </span>
                              )}
                            </td>
                            <td className={`py-2 pr-3 align-top text-right tabular-nums ${arCls} ${isAdditional ? "text-red-500 dark:text-red-400" : "text-muted-foreground"}`}>{item.discountPct || "0"}%</td>
                            <td className={`py-2 pr-4 align-top text-right tabular-nums font-medium ${arCls}`}>{fmt(item.totalPrice)}</td>
                            {can("sales-order:approve") && status === "submitted" && (
                              <td className="py-2 pl-2 align-top">
                                <button
                                  title={isApprovalRejected ? "Clear rejection" : "Reject this item"}
                                  disabled={togglingApprovalReject === item.id}
                                  onClick={() => handleToggleApprovalReject(item.id)}
                                  className={cn(
                                    "flex items-center justify-center w-6 h-6 rounded transition-colors",
                                    isApprovalRejected
                                      ? "text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-900/20 hover:bg-red-100"
                                      : "text-muted-foreground hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20",
                                  )}
                                >
                                  {togglingApprovalReject === item.id
                                    ? <Loader2Icon className="w-3 h-3 animate-spin" />
                                    : <XIcon className="w-3 h-3" />}
                                </button>
                              </td>
                            )}
                          </tr>,
                        );
                        return rows;
                      });
                    })()}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Notes */}
          {order.notes && (
            <section className="border border-border rounded-xl p-4">
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Notes</h2>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{order.notes}</p>
            </section>
          )}
        </div>

        {/* Right column — summary */}
        <div className="space-y-5">

          {/* Status */}
          <section className="border border-border rounded-xl p-4">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Status</h2>
            <div className="mb-3 flex items-center gap-2 flex-wrap">
              <StatusBadge status={status} />
              {order.soType === "proforma" && (
                <span className="text-[11px] font-medium px-2 py-0.5 rounded bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-400 capitalize">
                  Pro-forma · {order.proformaReason ?? ""}
                </span>
              )}
              {order.soType === "urgent" && (
                <span className="text-[11px] font-medium px-2 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400">
                  Urgent · PO pending
                </span>
              )}
            </div>
            <div className="flex flex-col gap-2">
              {/* Creator: submit for approval */}
              {status === "draft" && can("sales-order:create") && (
                <Button
                  size="sm"
                  className="w-full gap-1.5 h-8 text-xs"
                  onClick={handleSubmit}
                  disabled={actioning !== null}
                >
                  <SendIcon className="w-3.5 h-3.5" />
                  {actioning === "submit" ? "Submitting…" : "Submit for approval"}
                </Button>
              )}
              {/* Manager: download PDF preview for submitted SO */}
              {status === "submitted" && can("sales-order:approve") && (
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full gap-1.5 h-8 text-xs"
                  onClick={() => window.open(`/api/sales-order/${order.id}/pdf`, "_blank")}
                >
                  <PrinterIcon className="w-3.5 h-3.5" /> Download PDF
                </Button>
              )}
              {/* Manager: approve submitted */}
              {status === "submitted" && can("sales-order:approve") && (
                <Button
                  size="sm"
                  className="w-full gap-1.5 h-8 text-xs bg-blue-600 hover:bg-blue-700 text-white"
                  onClick={handleApprove}
                  disabled={actioning !== null}
                >
                  <CheckIcon className="w-3.5 h-3.5" />
                  {actioning === "approve" ? "Approving…" : "Approve"}
                </Button>
              )}
              {/* Manager: reject submitted → back to draft */}
              {status === "submitted" && can("sales-order:reject") && (
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full gap-1.5 h-8 text-xs text-destructive hover:text-destructive border-destructive/30 hover:border-destructive/60"
                  onClick={handleReject}
                  disabled={actioning !== null}
                >
                  <XIcon className="w-3.5 h-3.5" />
                  {actioning === "reject" ? "Returning…" : "Return for revision"}
                </Button>
              )}
              {/* Manager: recall confirmed → back to draft */}
              {status === "confirmed" && can("sales-order:recall") && (
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full gap-1.5 h-8 text-xs"
                  onClick={handleRecall}
                  disabled={actioning !== null}
                >
                  <RotateCcwIcon className="w-3.5 h-3.5" />
                  {actioning === "recall" ? "Recalling…" : "Recall"}
                </Button>
              )}
            </div>
          </section>

          {/* Stock Insight — only shown on confirmed SOs */}
          {status === "confirmed" && can("delivery-order:create") && (
            <section className={cn(
              "border rounded-xl p-4 space-y-3",
              stockStatus === "reserved"    && "border-green-300 dark:border-green-700/50 bg-green-50/50 dark:bg-green-900/10",
              stockStatus === "insufficient" && "border-red-300 dark:border-red-700/50 bg-red-50/50 dark:bg-red-900/10",
              !stockStatus                  && "border-border",
            )}>
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                  <WarehouseIcon className="w-3.5 h-3.5" />
                  Stock Insight
                </h2>
                {stockStatus === "reserved" && (
                  <span className="flex items-center gap-1 text-[11px] font-medium text-green-700 dark:text-green-400">
                    <CheckCircle2Icon className="w-3.5 h-3.5" /> Reserved
                  </span>
                )}
                {stockStatus === "insufficient" && (
                  <span className="flex items-center gap-1 text-[11px] font-medium text-red-600 dark:text-red-400">
                    <AlertTriangleIcon className="w-3.5 h-3.5" /> Insufficient
                  </span>
                )}
              </div>

              {/* Read-only per-item stock data */}
              {insightLoading ? (
                <p className="text-xs text-muted-foreground">Loading stock data…</p>
              ) : insight && insight.items.length > 0 ? (
                <div className="rounded-lg border border-border overflow-hidden">
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="border-b border-border text-muted-foreground bg-muted/30">
                        <th className="text-left px-2 py-1.5">Item</th>
                        <th className="text-right px-2 py-1.5">Need</th>
                        <th className="text-right px-2 py-1.5">On hand</th>
                        <th className="text-right px-2 py-1.5">Reserved</th>
                        <th className="text-right px-2 py-1.5">Available</th>
                        <th className="text-right px-2 py-1.5">Short</th>
                      </tr>
                    </thead>
                    <tbody>
                      {insight.items.map((i) => (
                        <tr
                          key={i.productId}
                          className={cn(
                            "border-b border-border/40 last:border-0",
                            i.shortage > 0 && "bg-red-50/50 dark:bg-red-900/10",
                          )}
                        >
                          <td className="px-2 py-1.5">
                            <div className="font-mono">{i.productCode ?? i.productId}</div>
                            {i.description && (
                              <div className="text-muted-foreground truncate max-w-35">{i.description}</div>
                            )}
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{i.required}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{i.onHand}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{i.reserved}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{i.available}</td>
                          <td className={cn(
                            "px-2 py-1.5 text-right tabular-nums font-medium",
                            i.shortage > 0 ? "text-red-600 dark:text-red-400" : "text-muted-foreground",
                          )}>
                            {i.shortage > 0 ? i.shortage : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">No trackable items on this order.</p>
              )}

              {/* Not yet checked (legacy orders confirmed before auto-reservation) */}
              {!stockStatus && (
                <Button
                  size="sm"
                  className="w-full gap-1.5 h-8 text-xs"
                  onClick={handleRecheckStock}
                  disabled={rechecking}
                >
                  {rechecking ? <Loader2Icon className="w-3.5 h-3.5 animate-spin" /> : <WarehouseIcon className="w-3.5 h-3.5" />}
                  {rechecking ? "Checking stock…" : "Check stock"}
                </Button>
              )}

              {/* Reserved — ready for DO */}
              {stockStatus === "reserved" && (
                <div className="space-y-2">
                  {/* Multi-CPO: show per-CPO delivery status */}
                  {order.cpoCustomers.length > 1 ? (
                    <div className="space-y-2">
                      <p className="text-xs text-muted-foreground">
                        This SO has {order.cpoCustomers.length} customer POs. Create a separate delivery order for each.
                      </p>
                      <div className="rounded-lg border border-border overflow-hidden divide-y divide-border/50">
                        {order.cpoCustomers.map((cpo) => {
                          const dos = linkedDos.filter((d) => d.customerPoId === cpo.customerPoId);
                          const delivered = dos.filter((d) => d.status === "delivered");
                          const hasDo = dos.length > 0;
                          const snap = cpo.customerSnapshot;
                          const custName = snap ? [snap.title, snap.name].filter(Boolean).join(" ") : null;
                          return (
                            <div key={cpo.customerPoId} className="px-3 py-2.5 flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="text-xs font-mono font-medium">{cpo.customerPoNo}</span>
                                  {hasDo ? (
                                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">
                                      {delivered.length > 0 ? "Delivered" : "DO created"}
                                    </span>
                                  ) : (
                                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400">
                                      Pending
                                    </span>
                                  )}
                                </div>
                                {custName && <p className="text-[10px] text-muted-foreground mt-0.5">{custName}</p>}
                                {dos.map((d) => (
                                  <button
                                    key={d.id}
                                    onClick={() => router.push(`/dashboard/fulfillment/delivery/${d.id}`)}
                                    className="text-[10px] font-mono text-blue-600 dark:text-blue-400 hover:underline block mt-0.5"
                                  >
                                    {d.doNo}
                                  </button>
                                ))}
                              </div>
                              {!hasDo && can("delivery-order:create") && (
                                <Button
                                  size="sm"
                                  className="gap-1 h-7 text-xs bg-green-600 hover:bg-green-700 text-white shrink-0"
                                  onClick={() => router.push(`/dashboard/fulfillment/delivery/create?soId=${order.id}&soNo=${encodeURIComponent(order.soNo)}&customerPoId=${encodeURIComponent(cpo.customerPoId)}`)}
                                >
                                  <TruckIcon className="w-3 h-3" /> Create DO
                                </Button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    /* Single customer: show existing DO or create button */
                    <>
                      {linkedDos.length > 0 ? (
                        <div className="space-y-1.5">
                          {linkedDos.map((d) => {
                            const isDelivered = d.status === "delivered";
                            return (
                              <div key={d.id} className="flex items-center gap-2">
                                <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${isDelivered ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400" : "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400"}`}>
                                  {isDelivered ? "Delivered" : "DO created"}
                                </span>
                                <button
                                  onClick={() => router.push(`/dashboard/fulfillment/delivery/${d.id}`)}
                                  className="text-xs font-mono text-blue-600 dark:text-blue-400 hover:underline"
                                >
                                  {d.doNo}
                                </button>
                              </div>
                            );
                          })}
                          {can("delivery-order:create") && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="w-full gap-1.5 h-8 text-xs mt-1"
                              onClick={() => router.push(`/dashboard/fulfillment/delivery/create?soId=${order.id}&soNo=${encodeURIComponent(order.soNo)}`)}
                            >
                              <TruckIcon className="w-3.5 h-3.5" />
                              Create Another DO
                            </Button>
                          )}
                        </div>
                      ) : (
                        <>
                          <p className="text-xs text-muted-foreground">
                            Stock has been reserved. You can now create a delivery order.
                          </p>
                          {can("delivery-order:create") && (
                            <Button
                              size="sm"
                              className="w-full gap-1.5 h-8 text-xs bg-green-600 hover:bg-green-700 text-white"
                              onClick={() => router.push(`/dashboard/fulfillment/delivery/create?soId=${order.id}&soNo=${encodeURIComponent(order.soNo)}`)}
                            >
                              <TruckIcon className="w-3.5 h-3.5" />
                              Create Delivery Order
                            </Button>
                          )}
                        </>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* Insufficient stock — narrow recovery actions */}
              {stockStatus === "insufficient" && (
                <div className="flex gap-2">
                  {can("purchase-requisition:create") && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1 gap-1.5 h-8 text-xs"
                      onClick={() => router.push(`/dashboard/procurement/requisition/create?soId=${order.id}`)}
                    >
                      <ShoppingCartIcon className="w-3.5 h-3.5" />
                      Raise Requisition
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 gap-1.5 h-8 text-xs"
                    onClick={handleRecheckStock}
                    disabled={rechecking}
                  >
                    {rechecking ? <Loader2Icon className="w-3 h-3 animate-spin" /> : <RotateCcwIcon className="w-3 h-3" />}
                    Recheck availability
                  </Button>
                </div>
              )}
            </section>
          )}

          {/* Purchase Requisitions */}
          {(linkedPrs.length > 0 || (can("purchase-requisition:read") && (status === "confirmed" || status === "fulfilled"))) && (
            <section className="border border-border rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                  <ShoppingCartIcon className="w-3.5 h-3.5" />
                  Purchase Requisitions
                </h2>
                {can("purchase-requisition:create") && (
                  <button
                    onClick={() => router.push(`/dashboard/procurement/requisition/create?soId=${order.id}`)}
                    className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    + New
                  </button>
                )}
              </div>
              {linkedPrs.length === 0 ? (
                <p className="text-xs text-muted-foreground">No requisitions raised yet.</p>
              ) : (
                <div className="space-y-1.5">
                  {linkedPrs.map((pr) => {
                    const PR_BADGES: Record<string, { label: string; cls: string }> = {
                      draft:             { label: "Draft",     cls: "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400" },
                      submitted:         { label: "Pending",   cls: "bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400" },
                      approved:          { label: "Approved",  cls: "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400" },
                      partially_ordered: { label: "Partial",   cls: "bg-cyan-100 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-400" },
                      ordered:           { label: "Ordered",   cls: "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400" },
                      cancelled:         { label: "Cancelled", cls: "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400" },
                    };
                    const badge = PR_BADGES[pr.status] ?? { label: pr.status, cls: "bg-muted text-muted-foreground" };
                    return (
                      <div key={pr.id} className="flex items-center justify-between gap-2 rounded-lg border border-border/60 px-3 py-2 hover:bg-muted/30 transition-colors">
                        <button
                          onClick={() => router.push(`/dashboard/procurement/requisition/${pr.id}`)}
                          className="text-xs font-mono text-blue-600 dark:text-blue-400 hover:underline"
                        >
                          {pr.prNo}
                        </button>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] text-muted-foreground">{pr.itemCount} item{pr.itemCount !== 1 ? "s" : ""}</span>
                          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${badge.cls}`}>{badge.label}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          {/* Pricing */}
          <section className="border border-border rounded-xl p-4">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Pricing</h2>
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="tabular-nums">{fmt(order.subtotal)}</span>
              </div>
              {parseFloat(order.overallDiscountPct ?? "0") > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Discount ({order.overallDiscountPct}%)</span>
                  <span className="tabular-nums text-muted-foreground">−{fmt(order.overallDiscountAmt)}</span>
                </div>
              )}
              {parseFloat(order.sstPct ?? "0") > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">SST ({order.sstPct}%)</span>
                  <span className="tabular-nums">{fmt(order.sst)}</span>
                </div>
              )}
              <div className="flex justify-between font-semibold border-t border-border pt-2 mt-2">
                <span>Grand total</span>
                <span className="tabular-nums">{fmt(order.grandTotal)}</span>
              </div>
            </div>
          </section>

          {/* Details */}
          <section className="border border-border rounded-xl p-4 space-y-2.5">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Details</h2>

            {/* Urgent authorization details */}
            {order.soType === "urgent" && (
              <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/15 border border-amber-200 dark:border-amber-800 space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400">Urgent authorization</p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                  {(order as any).urgentAuthBy && (
                    <>
                      <span className="text-muted-foreground">Authorized by</span>
                      <span className="font-medium">{(order as any).urgentAuthBy}</span>
                    </>
                  )}
                  {(order as any).urgentAuthType && (
                    <>
                      <span className="text-muted-foreground">Channel</span>
                      <span className="capitalize">{(order as any).urgentAuthType === "loi" ? "LOI" : (order as any).urgentAuthType}</span>
                    </>
                  )}
                  {(order as any).urgentAuthDate && (
                    <>
                      <span className="text-muted-foreground">Auth date</span>
                      <span>{(order as any).urgentAuthDate}</span>
                    </>
                  )}
                  {(order as any).urgentPoExpectedBy && (
                    <>
                      <span className="text-muted-foreground">CPO expected by</span>
                      <span className={new Date((order as any).urgentPoExpectedBy) < new Date() ? "text-destructive font-medium" : ""}>
                        {(order as any).urgentPoExpectedBy}
                      </span>
                    </>
                  )}
                </div>
                {(order as any).urgentAuthNotes && (
                  <p className="text-xs text-muted-foreground italic border-t border-amber-200 dark:border-amber-800 pt-2">
                    {(order as any).urgentAuthNotes}
                  </p>
                )}
              </div>
            )}

            {/* Original SO — shown on warranty/replacement pro-forma SOs */}
            {order.originalSoNo && (
              <div className="flex items-start gap-2">
                <LinkIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                <div>
                  <p className="text-[10px] text-muted-foreground capitalize">
                    Original SO ({order.proformaReason})
                  </p>
                  {order.originalSoId ? (
                    <button
                      onClick={() => router.push(`/dashboard/sales/order/${order.originalSoId}`)}
                      className="text-xs font-mono text-blue-600 dark:text-blue-400 hover:underline text-left"
                    >
                      {order.originalSoNo}
                    </button>
                  ) : (
                    <p className="text-xs font-mono">{order.originalSoNo}</p>
                  )}
                </div>
              </div>
            )}

            {linkedQuotations.length > 0 && (
              <div className="flex items-start gap-2">
                <FileTextIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] text-muted-foreground mb-1">
                    Quotation{linkedQuotations.length > 1 ? "s" : ""}
                  </p>
                  <div className="space-y-1">
                    {linkedQuotations.map((q) => (
                      <button
                        key={q.id}
                        onClick={() => router.push(`/dashboard/sales/quotation/${q.id}`)}
                        className="w-full text-left border border-border rounded-lg px-2.5 py-2 hover:bg-muted/40 transition-colors"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-mono font-medium">{q.quotationNo}</span>
                          {q.status && (
                            <span className={cn("text-[10px] font-medium rounded px-1.5 py-0.5", (QT_STATUS[q.status] ?? QT_STATUS.draft).className)}>
                              {(QT_STATUS[q.status] ?? QT_STATUS.draft).label}
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-muted-foreground tabular-nums mt-0.5">
                          {fmt(q.grandTotal)}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
            {/* Sales person — per-quotation for urgent SO (no CPOs yet), per-CPO when CPOs linked, else SO-level */}
            {(() => {
              const associates = (order.associateSalesPersons as { id: string; name: string }[] | null) ?? [];

              // Urgent SO — always show per-quotation rows (with or without CPOs)
              if (order.soType === "urgent") {
                const orderLqs = (order.linkedQuotations as { id: string; quotationNo: string; customerId?: string | null; customerSnapshot?: { title?: string; name: string; organizationName?: string } | null; salesPersonName?: string | null }[] | null) ?? [];
                if (orderLqs.length > 0) {
                  const rows = orderLqs.map((qt) => {
                    const matchingCpo = order.cpoCustomers.find((c) =>
                      (qt.customerId && c.customerId === qt.customerId) ||
                      (!qt.customerId && qt.customerSnapshot?.name && c.customerSnapshot?.name === qt.customerSnapshot?.name)
                    );
                    const effectiveSp = matchingCpo
                      ? (matchingCpo.soSalesPersonName ?? matchingCpo.salesPersonName ?? null)
                      : (qt.salesPersonName ?? linkedQuotations.find((q) => q.id === qt.id)?.salesPersonName ?? null);
                    const externalPersons = matchingCpo?.externalPersons ?? [];
                    return { qt, effectiveSp, externalPersons };
                  });
                  const anyData = rows.some((r) => r.effectiveSp || r.externalPersons.length > 0);
                  if (!anyData) return null;
                  return (
                    <div className="flex items-start gap-2">
                      <UserIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <p className="text-[10px] text-muted-foreground">Sales person</p>
                        <div className="space-y-1 mt-0.5">
                          {rows.map(({ qt, effectiveSp, externalPersons }) => {
                            if (!effectiveSp && externalPersons.length === 0) return null;
                            return (
                              <div key={qt.id} className="flex flex-wrap items-center gap-1">
                                <span className="text-[10px] font-mono text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 rounded px-1.5 py-0.5 shrink-0">
                                  {qt.quotationNo}
                                </span>
                                {effectiveSp && <span className="text-xs">{effectiveSp}</span>}
                                {externalPersons.map((e) => (
                                  <span key={e.id} className="inline-flex items-center gap-0.5 text-[10px] bg-muted border border-border rounded px-1.5 py-0.5">
                                    {e.name}<span className="text-[9px] opacity-60 font-bold ml-0.5">ext</span>
                                  </span>
                                ))}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  );
                }
              }

              if (order.cpoCustomers.length > 0) {
                // Build effective per-CPO rows:
                // soSalesPersonName (SO-edited) → order.salesPersonName for first CPO (old SOs) → CPO table original
                const rows = order.cpoCustomers.map((c, idx) => ({
                  ...c,
                  effectiveSp: c.soSalesPersonName ?? (idx === 0 ? order.salesPersonName : null) ?? c.salesPersonName ?? null,
                }));
                const anyData = rows.some((r) => r.effectiveSp || r.externalPersons.length > 0);
                if (!anyData) return null;
                return (
                  <div className="flex items-start gap-2">
                    <UserIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] text-muted-foreground">Sales person</p>
                      <div className="space-y-1 mt-0.5">
                        {rows.map((c) => {
                          if (!c.effectiveSp && c.externalPersons.length === 0) return null;
                          return (
                            <div key={c.customerPoId} className="flex flex-wrap items-center gap-1">
                              <span className="text-[10px] font-mono bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-400 rounded px-1.5 py-0.5 shrink-0">
                                {c.customerPoNo}
                              </span>
                              {c.effectiveSp && <span className="text-xs">{c.effectiveSp}</span>}
                              {c.externalPersons.map((e) => (
                                <span key={e.id} className="inline-flex items-center gap-0.5 text-[10px] bg-muted border border-border rounded px-1.5 py-0.5">
                                  {e.name}<span className="text-[9px] opacity-60 font-bold ml-0.5">ext</span>
                                </span>
                              ))}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              }

              // Cash sale or single-quotation urgent SO — SO-level
              const soSp = order.salesPersonName || null;
              if (!soSp && associates.length === 0) return null;
              return (
                <div className="flex items-start gap-2">
                  <UserIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                  <div>
                    <p className="text-[10px] text-muted-foreground">Sales person</p>
                    {soSp && <p className="text-xs">{soSp}</p>}
                    {associates.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {associates.map((a) => (
                          <span key={a.id} className="text-[10px] bg-muted rounded-full px-2 py-0.5">{a.name}</span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* Due delivery date — per-quotation for urgent SO, per-CPO when linked, else order-level */}
            {(() => {
              if (order.soType === "urgent") {
                const orderLqs = (order.linkedQuotations as { id: string; quotationNo: string; customerId?: string | null; customerSnapshot?: { title?: string; name: string; organizationName?: string } | null; deliveryDate?: string | null }[] | null) ?? [];
                if (orderLqs.length > 0) {
                  const rows = orderLqs.map((qt) => {
                    const matchingCpo = order.cpoCustomers.find((c) =>
                      (qt.customerId && c.customerId === qt.customerId) ||
                      (!qt.customerId && qt.customerSnapshot?.name && c.customerSnapshot?.name === qt.customerSnapshot?.name)
                    );
                    return { qt, deliveryDate: matchingCpo?.deliveryDate ?? (qt.deliveryDate ? new Date(qt.deliveryDate) : null) };
                  });
                  const anyDate = rows.some((r) => r.deliveryDate) || !!order.deliveryDate;
                  if (!anyDate) return null;
                  return (
                    <div className="flex items-start gap-2">
                      <CalendarIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <p className="text-[10px] text-muted-foreground mb-1">Due delivery date</p>
                        <div className="space-y-1">
                          {rows.map(({ qt, deliveryDate }) => (
                            <div key={qt.id} className="flex items-center gap-1.5">
                              <span className="text-[10px] font-mono text-blue-700 dark:text-blue-400 shrink-0">{qt.quotationNo}</span>
                              <span className="text-xs">
                                {deliveryDate ? fmtDate(deliveryDate) : order.deliveryDate ? fmtDate(order.deliveryDate) : <span className="text-muted-foreground">—</span>}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                }
              }
              if (order.cpoCustomers.length > 0) return (
                <div className="flex items-start gap-2">
                  <CalendarIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] text-muted-foreground mb-1">Due delivery date</p>
                    <div className="space-y-1">
                      {order.cpoCustomers.map((c) => (
                        <div key={c.customerPoId} className="flex items-center gap-1.5">
                          <span className="text-[10px] font-mono text-blue-600 dark:text-blue-400 shrink-0">{c.customerPoNo}</span>
                          <span className="text-xs">
                            {c.deliveryDate ? fmtDate(c.deliveryDate) : <span className="text-muted-foreground">—</span>}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              );
              if (order.deliveryDate) return (
                <div className="flex items-start gap-2">
                  <CalendarIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                  <div>
                    <p className="text-[10px] text-muted-foreground">Due delivery date</p>
                    <p className="text-xs">{fmtDate(order.deliveryDate)}</p>
                  </div>
                </div>
              );
              return null;
            })()}

            {/* Delivery address — per-quotation for urgent SO, per-CPO when linked, else order-level */}
            {(() => {
              if (order.soType === "urgent") {
                const orderLqs = (order.linkedQuotations as { id: string; quotationNo: string; customerId?: string | null; customerSnapshot?: { title?: string; name: string; organizationName?: string; organizationAddress?: string } | null; deliveryAddress?: string | null }[] | null) ?? [];
                if (orderLqs.length > 0) {
                  const rows = orderLqs.map((qt) => {
                    const matchingCpo = order.cpoCustomers.find((c) =>
                      (qt.customerId && c.customerId === qt.customerId) ||
                      (!qt.customerId && qt.customerSnapshot?.name && c.customerSnapshot?.name === qt.customerSnapshot?.name)
                    );
                    const orgName = matchingCpo?.customerSnapshot?.organizationName ?? qt.customerSnapshot?.organizationName ?? null;
                    const address = matchingCpo?.customerSnapshot?.organizationAddress ?? qt.deliveryAddress ?? qt.customerSnapshot?.organizationAddress ?? null;
                    return { qt, orgName, address };
                  });
                  const anyAddress = rows.some((r) => r.address) || !!order.deliveryAddress;
                  if (!anyAddress) return null;
                  return (
                    <div className="flex items-start gap-2">
                      <MapPinIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <p className="text-[10px] text-muted-foreground mb-1">Delivery address</p>
                        <div className="space-y-1.5">
                          {rows.map(({ qt, orgName, address }) => (
                            <div key={qt.id} className="flex items-start gap-1.5">
                              <span className="text-[10px] font-mono text-blue-700 dark:text-blue-400 shrink-0 pt-0.5">{qt.quotationNo}</span>
                              <span className="text-xs leading-snug">
                                {address ? (
                                  <>
                                    {orgName && <span className="block text-[10px] font-medium text-muted-foreground">{orgName}</span>}
                                    {address}
                                  </>
                                ) : order.deliveryAddress ? order.deliveryAddress : <span className="text-muted-foreground">—</span>}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                }
              }
              if (order.cpoCustomers.length > 0) return (
                <div className="flex items-start gap-2">
                  <MapPinIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] text-muted-foreground mb-1">Delivery address</p>
                    <div className="space-y-1.5">
                      {order.cpoCustomers.map((c) => (
                        <div key={c.customerPoId} className="flex items-start gap-1.5">
                          <span className="text-[10px] font-mono text-blue-600 dark:text-blue-400 shrink-0 pt-0.5">{c.customerPoNo}</span>
                          <span className="text-xs leading-snug">
                            {c.customerSnapshot?.organizationAddress ? (
                              <>
                                {c.customerSnapshot.organizationName && (
                                  <span className="block text-[10px] font-medium text-muted-foreground">{c.customerSnapshot.organizationName}</span>
                                )}
                                {c.customerSnapshot.organizationAddress}
                              </>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              );
              if (order.deliveryAddress) return (
                <div className="flex items-start gap-2">
                  <MapPinIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                  <div>
                    <p className="text-[10px] text-muted-foreground">Delivery address</p>
                    <p className="text-xs">{order.deliveryAddress}</p>
                  </div>
                </div>
              );
              return null;
            })()}
            <div className="flex items-start gap-2">
              <PackageIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
              <div>
                <p className="text-[10px] text-muted-foreground">Items</p>
                <p className="text-xs">{order.items.length} line{order.items.length !== 1 ? "s" : ""}</p>
              </div>
            </div>

            {/* Audit trail */}
            <div className="border-t border-border/50 pt-2.5 space-y-2">
              <div className="flex items-start gap-2">
                <CalendarIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                <div>
                  <p className="text-[10px] text-muted-foreground">Created</p>
                  <p className="text-xs">{fmtDate(order.createdAt)}</p>
                </div>
              </div>
              {order.createdByName && (
                <div className="flex items-start gap-2">
                  <UserIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                  <div>
                    <p className="text-[10px] text-muted-foreground">Prepared by</p>
                    <p className="text-xs">{order.createdByName}</p>
                  </div>
                </div>
              )}
              {order.submittedAt && (
                <div className="flex items-start gap-2">
                  <ClockIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                  <div>
                    <p className="text-[10px] text-muted-foreground">Sent for Approval</p>
                    <p className="text-xs">{fmtDate(order.submittedAt)}{order.submittedByName ? ` · ${order.submittedByName}` : ""}</p>
                  </div>
                </div>
              )}
              {order.approvedAt && (
                <div className="flex items-start gap-2">
                  <CheckIcon className="w-3.5 h-3.5 text-green-500 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-[10px] text-muted-foreground">Approved</p>
                    <p className="text-xs">{fmtDate(order.approvedAt)}{order.approvedByName ? ` · ${order.approvedByName}` : ""}</p>
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
