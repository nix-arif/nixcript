"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useOpenedFromList } from "@/lib/use-list-return";
import { toast } from "sonner";
import {
  deleteDeliveryOrder,
  deliverDeliveryOrder,
  returnDeliveryOrder,
  returnCaseMachine,
  sellCaseMachine,
  setDoItemCustomerView,
  saveCaseCustomerItems,
  cancelDeliveryOrder,
  undoCaseActuals,
  updateDeliveryOrderCaseInfo,
  updateDeliveryOrderNumber,
  type CaseMachine,
  type DeliveryOrderWithItems,
} from "@/server/delivery-order";
import { getCustomerPosByCustomer, type CustomerPo } from "@/server/customer-purchase-order";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { PageHeader } from "@/components/page-header";
import {
  ArrowLeftIcon, PencilIcon, TrashIcon,
  UserIcon, BuildingIcon, CalendarIcon, PackageIcon, MapPinIcon,
  TruckIcon, RotateCcwIcon, LinkIcon, ReceiptIcon, CheckCircle2Icon,
  PrinterIcon, DollarSignIcon, Loader2Icon, ChevronDownIcon, StethoscopeIcon, BanIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { isDraftDoNo } from "@/lib/delivery/draft-no";
import { LOAN_PURPOSE_LABELS } from "@/lib/inventory/constants";
import { CustomerViewEditor, customerViewSummary } from "@/components/customer-view-editor";
import { CaseExtraProductCell, type CaseLineItem } from "../create/create-do-client";
import { getProductsMda } from "@/server/case-template";
import { pricedWithoutMdaMessage } from "@/lib/mda/priced-message";
import { ItemizedMdaWarning } from "@/components/itemized-mda-warning";
import type { CustomerView } from "@/lib/delivery/customer-view";

const fmtDate = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const DO_STATUS: Record<string, { label: string; className: string }> = {
  draft:     { label: "Draft",     className: "bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400" },
  delivered: { label: "Delivered", className: "bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400" },
  returned:  { label: "Returned",  className: "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400" },
  cancelled: { label: "Cancelled", className: "bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 line-through" },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = DO_STATUS[status] ?? DO_STATUS.draft;
  return <span className={cn("text-[11px] font-medium rounded px-2 py-0.5", cfg.className)}>{cfg.label}</span>;
}

// Owner-only inline edit — uniqueness (per org) is enforced server-side by
// updateDeliveryOrderNumber, which checks the same constraint the DB itself
// enforces (delivery_order_no_org_uidx) and returns a clean error on a
// collision instead of a raw constraint violation. Anyone else just sees the
// plain DO number, no edit affordance.
function DoNumberField({
  doId,
  doNo,
  isOwner,
  onUpdated,
}: {
  doId: string;
  doNo: string;
  isOwner: boolean;
  onUpdated: (next: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(doNo);
  const [saving, setSaving] = useState(false);

  useEffect(() => { setValue(doNo); }, [doNo]);

  async function commit() {
    const trimmed = value.trim();
    if (!trimmed || trimmed === doNo) {
      setValue(doNo);
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await updateDeliveryOrderNumber(doId, trimmed);
      onUpdated(trimmed);
      toast.success("DO number updated");
      setEditing(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't update DO number");
      setValue(doNo);
    } finally {
      setSaving(false);
    }
  }

  if (!isOwner) return <p className="text-xs font-mono">{doNo}</p>;

  if (editing) {
    return (
      <input
        autoFocus
        value={value}
        disabled={saving}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") { setValue(doNo); setEditing(false); }
        }}
        className="h-6 w-36 text-xs font-mono border border-input rounded px-1.5 bg-background disabled:opacity-50 focus:outline-none focus:ring-1 focus:ring-ring"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      title="Click to edit (owner only)"
      className="flex items-center gap-1 text-xs font-mono hover:text-foreground text-left group"
    >
      {doNo}
      <PencilIcon className="w-2.5 h-2.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
    </button>
  );
}

export function DeliveryOrderDetailClient({
  order,
  machines = [],
  noMda = [],
  permissions,
  currentUserId,
}: {
  order: DeliveryOrderWithItems;
  machines?: CaseMachine[];
  noMda?: { code: string; reason: string }[];
  permissions: string[];
  currentUserId: string;
}) {
  const router = useRouter();
  // Back: straight from the DO list → router.back() restores that list from
  // cache (filters, page, scroll). Otherwise (opened directly, or again after
  // an edit) go to the list URL last used, filters included.
  const listReturn = useOpenedFromList("do-list", `/dashboard/fulfillment/delivery/${order.id}`, "/dashboard/fulfillment/delivery");
  const goBack = () => {
    if (listReturn.fromList) router.back();
    else router.push(listReturn.listUrl);
  };
  const [status, setStatus] = useState(order.status ?? "draft");
  const [doNo, setDoNo] = useState(order.doNo);
  const [actioning, setActioning] = useState<"deliver" | "return" | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [pdfWithPrice, setPdfWithPrice] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  const [caseDialogOpen, setCaseDialogOpen] = useState(false);
  const [cpoOptions, setCpoOptions] = useState<CustomerPo[]>([]);
  const [loadingCpos, setLoadingCpos] = useState(false);
  const [selectedCpoId, setSelectedCpoId] = useState("");
  const [manualCpoNo, setManualCpoNo] = useState(order.customerPoNo ?? "");
  const [mrnNoInput, setMrnNoInput] = useState(order.mrnNo ?? "");
  const [caseDateInput, setCaseDateInput] = useState(() =>
    order.caseDate ? new Date(order.caseDate).toISOString().slice(0, 10) : "",
  );
  const [savingCaseInfo, setSavingCaseInfo] = useState(false);

  useEffect(() => { setStatus(order.status ?? "draft"); }, [order.status]);
  useEffect(() => { setDoNo(order.doNo); }, [order.doNo]);

  async function openCaseDialog() {
    setSelectedCpoId(order.customerPoId ?? "");
    setManualCpoNo(order.customerPoId ? "" : (order.customerPoNo ?? ""));
    setMrnNoInput(order.mrnNo ?? "");
    setCaseDateInput(order.caseDate ? new Date(order.caseDate).toISOString().slice(0, 10) : "");
    setCaseDialogOpen(true);
    if (order.customerId) {
      setLoadingCpos(true);
      try {
        const pos = await getCustomerPosByCustomer(order.customerId);
        setCpoOptions(pos);
      } catch {
        setCpoOptions([]);
      } finally {
        setLoadingCpos(false);
      }
    }
  }

  async function handleSaveCaseInfo() {
    setSavingCaseInfo(true);
    try {
      const selectedCpo = cpoOptions.find((p) => p.id === selectedCpoId) ?? null;
      await updateDeliveryOrderCaseInfo({
        id: order.id,
        customerPoId: selectedCpo?.id ?? null,
        customerPoNo: selectedCpo ? selectedCpo.customerPoNo : (manualCpoNo.trim() || null),
        mrnNo: mrnNoInput.trim() || null,
        caseDate: caseDateInput ? new Date(caseDateInput) : null,
      });
      toast.success("Case details updated");
      setCaseDialogOpen(false);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update case details");
    } finally {
      setSavingCaseInfo(false);
    }
  }

  async function handleDownloadPdf(copy?: "customer" | "internal") {
    setDownloadingPdf(true);
    try {
      const qs = new URLSearchParams();
      if (pdfWithPrice) qs.set("withPrice", "1");
      if (copy) qs.set("copy", copy);
      const res = await fetch(`/api/delivery-order/${order.id}/pdf${qs.size ? `?${qs}` : ""}`);
      if (!res.ok) {
        const text = (await res.text().catch(() => "")).trim();
        throw new Error(text || `Failed to download PDF (HTTP ${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${order.doNo}${copy === "internal" ? "-internal" : ""}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to download PDF");
    } finally {
      setDownloadingPdf(false);
    }
  }

  const can = (p: string) => permissions.includes("*") || permissions.includes(p);
  // Case DO in two steps (customer items now, actual items after the case)
  const twoStep = !!order.isCaseDo && order.actualStatus !== null;
  const [cancelOpen, setCancelOpen] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelling, setCancelling] = useState(false);
  async function doCancel() {
    setCancelling(true);
    try {
      const res = await cancelDeliveryOrder(order.id, cancelReason);
      if (!res.ok) { toast.error(res.title, { duration: 10000 }); return; }
      toast.success(`${order.doNo} cancelled — stock returned`);
      setCancelOpen(false);
      router.refresh();
    } finally { setCancelling(false); }
  }
  async function undoActuals() {
    if (!confirm("Undo the recorded actual items? The stock goes back to the specialist (machines too) and you can record them again.")) return;
    const res = await undoCaseActuals(order.id);
    if (!res.ok) { toast.error(res.title, { duration: 10000 }); return; }
    toast.success("Actual items undone — stock returned");
    router.refresh();
  }
  const isOwner = order.createdBy === currentUserId;
  // Distinct from `isOwner` above (which means "created this record") — this
  // is the org-owner role check, matching updateDeliveryOrderNumber's own
  // gate, for the DO number edit affordance only.
  const isOrgOwner = permissions.includes("*");
  const snap = order.customerSnapshot as any;
  const orgName = snap?.organizationName;
  const personName = snap ? [snap.title, snap.name].filter(Boolean).join(" ") : null;
  const hasBoth = orgName && personName && personName !== orgName;

  async function act(
    key: "deliver" | "return",
    fn: () => Promise<void>,
    next: string,
    successMsg: string,
  ) {
    setActioning(key);
    try {
      await fn();
      setStatus(next);
      toast.success(successMsg);
      router.refresh();
    } catch (e: any) {
      // details: one line per problem (e.g. each short item), shown under the title
      const details: string[] | undefined = e?.details;
      toast.error(e.message, details?.length
        ? { description: <ul className="mt-1 space-y-0.5">{details.map((d) => <li key={d}>• {d}</li>)}</ul>, duration: 10000 }
        : undefined);
    } finally {
      setActioning(null);
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete draft ${order.doNo}? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await deleteDeliveryOrder(order.id);
      toast.success("Delivery order deleted");
      router.push("/dashboard/fulfillment/delivery");
    } catch (e: any) {
      toast.error(e.message);
      setDeleting(false);
    }
  }

  const isDraft = status === "draft";
  const isDelivered = status === "delivered";
  const isCancelled = status === "cancelled";
  // A cancelled invoice no longer holds the DO (it can be returned, cancelled or invoiced again)
  const liveInvoice = !!order.invoiceId && order.invoiceStatus !== "cancelled";
  // Invoiced once delivered — a draft has no DO number yet
  const canInvoice = isDelivered && !liveInvoice;
  // Two-step Case DO: delivered once the case is done and the actual items are recorded
  const deliverBlocked = twoStep && order.actualStatus === "pending";
  const isReturned = status === "returned";
  // Only a draft is deleted (and a Case DO only before it took stock); once a
  // DO has its number or moved stock it is cancelled instead, and stays on record
  const canDelete = isDraft && isOwner && !liveInvoice && can("delivery-order:delete")
    && (!order.isCaseDo || order.actualStatus === "pending");
  const canCancel = (!!order.isCaseDo || isDelivered || isReturned) && !isCancelled && !liveInvoice && can("delivery-order:cancel");
  // Goods sent back after delivery — normal DOs only (a Case DO is cancelled)
  const canReturn = !order.isCaseDo && isDelivered && can("delivery-order:update");

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title={order.doNo}
        description={fmtDate(order.createdAt)}
        action={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={goBack} className="gap-1.5">
              <ArrowLeftIcon className="w-3.5 h-3.5" /> Back
            </Button>
            {isDelivered && order.invoiceId && can("invoice:read") && (
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() => router.push(`/dashboard/fulfillment/invoice/${order.invoiceId}`)}
              >
                <ReceiptIcon className="w-3.5 h-3.5" /> View Invoice
              </Button>
            )}
            {canInvoice && can("invoice:create") && (
              <Button
                size="sm"
                className="gap-1.5"
                onClick={() => {
                  const params = new URLSearchParams({ doId: order.id });
                  if (order.salesOrderId) params.set("soId", order.salesOrderId);
                  if (order.salesOrderNo) params.set("soNo", order.salesOrderNo);
                  router.push(`/dashboard/fulfillment/invoice/create?${params}`);
                }}
              >
                <ReceiptIcon className="w-3.5 h-3.5" /> Create Invoice
              </Button>
            )}
            {isDraft && isOwner && can("delivery-order:update") && (
              <Button variant="outline" size="sm" onClick={() => router.push(`/dashboard/fulfillment/delivery/${order.id}/edit`)} className="gap-1.5">
                <PencilIcon className="w-3.5 h-3.5" /> Edit
              </Button>
            )}
            {canCancel && (
              <Button variant="outline" size="sm" className="gap-1.5 text-destructive hover:text-destructive" onClick={() => setCancelOpen(true)}>
                <BanIcon className="w-3.5 h-3.5" /> Cancel DO
              </Button>
            )}
            {canDelete && (
              <Button variant="outline" size="sm" className="gap-1.5 text-destructive hover:text-destructive" onClick={handleDelete} disabled={deleting}>
                <TrashIcon className="w-3.5 h-3.5" /> Delete
              </Button>
            )}
            <div className="flex items-center rounded-md border border-border overflow-hidden">
              {order.isCaseDo ? (
                <>
                  <button type="button" disabled={downloadingPdf} onClick={() => handleDownloadPdf("customer")}
                    title="For the customer: items with a valid MDA registration, with their MDA certificates"
                    className="flex items-center gap-1.5 px-3 h-8 text-xs font-medium hover:bg-muted transition-colors disabled:opacity-50">
                    {downloadingPdf ? <Loader2Icon className="w-3.5 h-3.5 animate-spin" /> : <PrinterIcon className="w-3.5 h-3.5" />}
                    Customer copy
                  </button>
                  {/* Internal copy: only for users given "Download Case DO Internal Copy" (also checked on download) */}
                  {can("delivery-order:internal-copy") && (
                    <>
                      <div className="w-px h-5 bg-border" />
                      <button type="button" disabled={downloadingPdf || (twoStep && order.actualStatus === "pending")} onClick={() => handleDownloadPdf("internal")}
                        title={twoStep && order.actualStatus === "pending" ? "Record the actual items first (after the case)" : "Internal inventory record: every item actually used, MDA status flagged"}
                        className="flex items-center gap-1.5 px-3 h-8 text-xs font-medium hover:bg-muted transition-colors disabled:opacity-50">
                        Internal copy
                      </button>
                    </>
                  )}
                </>
              ) : (
              <button
                type="button"
                disabled={downloadingPdf}
                onClick={() => handleDownloadPdf()}
                className="flex items-center gap-1.5 px-3 h-8 text-xs font-medium hover:bg-muted transition-colors disabled:opacity-50"
              >
                {downloadingPdf ? <Loader2Icon className="w-3.5 h-3.5 animate-spin" /> : <PrinterIcon className="w-3.5 h-3.5" />}
                {downloadingPdf ? "Generating…" : "PDF"}
              </button>
              )}
              <div className="w-px h-5 bg-border" />
              <button
                type="button"
                onClick={() => setPdfWithPrice((v) => !v)}
                title={pdfWithPrice ? "Price ON — click to exclude" : "Price OFF — click to include"}
                className={cn(
                  "flex items-center gap-1 px-2 h-8 text-xs transition-colors",
                  pdfWithPrice
                    ? "bg-blue-50 text-blue-600 hover:bg-blue-100 dark:bg-blue-950/40 dark:text-blue-400"
                    : "text-muted-foreground hover:bg-muted",
                )}
              >
                <DollarSignIcon className="w-3.5 h-3.5" />
                <span>{pdfWithPrice ? "with price" : "no price"}</span>
              </button>
            </div>
            {!isDraft && <StatusBadge status={status} />}
          </div>
        }
      />

      {isCancelled && (
        <div className="flex items-start gap-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-900 px-4 py-3">
          <BanIcon className="w-4 h-4 mt-0.5 shrink-0 text-zinc-600 dark:text-zinc-400" />
          <div className="text-sm">
            <p className="font-semibold">Cancelled{order.cancelledAt ? ` on ${new Date(order.cancelledAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}` : ""}{order.cancelledByName ? ` by ${order.cancelledByName}` : ""}</p>
            <p className="text-muted-foreground">Reason: {order.cancelReason ?? "—"}</p>
            <p className="text-xs text-muted-foreground mt-1">Kept on record for audit; all stock it took was returned (see Movement History). It can no longer be changed or invoiced.</p>
          </div>
        </div>
      )}

      {canInvoice && can("invoice:create") && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-4 py-3">
          <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
            <ReceiptIcon className="w-4 h-4 shrink-0" />
            <span className="text-sm font-medium">Invoice pending</span>
            <span className="text-sm text-amber-600 dark:text-amber-500">— this delivery has not been invoiced yet.</span>
          </div>
          <Button
            size="sm"
            className="gap-1.5 shrink-0"
            onClick={() => {
              const params = new URLSearchParams({ doId: order.id });
              if (order.salesOrderId) params.set("soId", order.salesOrderId);
              if (order.salesOrderNo) params.set("soNo", order.salesOrderNo);
              router.push(`/dashboard/fulfillment/invoice/create?${params}`);
            }}
          >
            <ReceiptIcon className="w-3.5 h-3.5" /> Create Invoice
          </Button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column — customer + items + notes */}
        <div className="lg:col-span-2 space-y-5">

          {/* Customer */}
          {snap && (
            <section className="border border-border rounded-xl p-4">
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Customer</h2>
              <div className="grid grid-cols-2 gap-x-6">
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">Organization</p>
                  <p className="text-sm font-medium">{orgName || personName || "—"}</p>
                  {snap.organizationAddress && (
                    <p className="text-[11px] text-muted-foreground mt-1 leading-snug">{snap.organizationAddress}</p>
                  )}
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">Contact</p>
                  <p className="text-sm">{hasBoth ? personName : "—"}</p>
                  {snap.email && <p className="text-[11px] text-muted-foreground mt-0.5">{snap.email}</p>}
                  {snap.contactNo && <p className="text-[11px] text-muted-foreground">{snap.contactNo}</p>}
                </div>
              </div>
            </section>
          )}

          {noMda.length > 0 && (
            <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-4 py-3 text-sm">
              <div className="font-medium text-amber-800 dark:text-amber-300">Not on the customer copy ({noMda.length})</div>
              <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">These items have no valid MDA registration, so they can&apos;t be given to the customer — they appear on the internal copy only:</p>
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {noMda.map((m, i) => <span key={i} className="text-[11px] rounded border border-amber-300 dark:border-amber-700 px-1.5 py-0.5"><span className="font-mono">{m.code}</span> · {m.reason}</span>)}
              </div>
            </div>
          )}

          {/* Two-step Case DO: customer items (customer copy + invoice) and the actual items used */}
          {twoStep && (
            <CustomerItemsSection order={order} canEdit={can("delivery-order:update") && !order.invoiceId && !isCancelled} onSaved={() => router.refresh()} />
          )}
          {twoStep && order.actualStatus === "pending" && !isCancelled ? (
            <section className="border border-amber-300 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-900/10 rounded-xl p-4 flex flex-wrap items-center gap-3">
              <div className="flex-1 min-w-56">
                <h2 className="text-sm font-semibold">Actual items used — not recorded yet</h2>
                <p className="text-xs text-muted-foreground mt-0.5">After the case, record what {order.applicationSpecialistName ?? "the specialist"} actually used from field stock (and which machine). Stock is deducted then, and the internal copy becomes available.</p>
              </div>
              {can("delivery-order:update") && (
                <Button size="sm" onClick={() => router.push(`/dashboard/fulfillment/delivery/${order.id}/record`)}>Record actual items</Button>
              )}
            </section>
          ) : (
          <section className="border border-border rounded-xl p-4">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-2">
              {twoStep ? "Actual items used" : "Items"} <span className="font-normal">({order.items.length})</span>
              {twoStep && order.actualRecordedAt && <span className="font-normal normal-case tracking-normal">· recorded {new Date(order.actualRecordedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</span>}
              {twoStep && !isCancelled && order.actualStatus === "recorded" && can("delivery-order:update") && (
                <button type="button" className="ml-auto text-[11px] font-normal normal-case tracking-normal text-muted-foreground hover:text-destructive underline" onClick={undoActuals}>undo recording</button>
              )}
            </h2>
            {!twoStep && order.isCaseDo && order.priceMode && (
              <p className="text-xs text-muted-foreground -mt-1.5 mb-2">
                Selling price: {order.priceMode === "total"
                  ? <><b className="text-foreground">total RM {Number(order.casePrice ?? 0).toFixed(2)}</b> for the case (items included)</>
                  : <>itemized — <b className="text-foreground">RM {order.items.reduce((s, i) => s + (Number(i.unitPrice ?? 0) * Number(i.qty ?? 0)), 0).toFixed(2)}</b></>}
                {order.items.some((i) => i.usageFee) && <> + machine usage fees RM {order.items.reduce((s, i) => s + Number(i.usageFee ?? 0), 0).toFixed(2)}</>}
                {" "}· the invoice made from this DO starts with these prices
              </p>
            )}
            {order.items.length === 0 ? (
              <p className="text-sm text-muted-foreground">No items</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground">
                      <th className="text-left pb-2 pr-3 w-6">#</th>
                      <th className="text-left pb-2 pr-3 w-20">Code</th>
                      <th className="text-left pb-2 pr-3">Description</th>
                      <th className="text-right pb-2 pr-3 w-12">Qty</th>
                      <th className="text-left pb-2 w-12">UOM</th>
                      {!twoStep && order.isCaseDo && order.priceMode === "itemized" && <th className="text-right pb-2 pl-3 w-20">Price</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {order.items.map((item) => (
                      <ItemRow key={item.id} item={item} doId={order.id} isCase={!!order.isCaseDo && !twoStep} canEdit={can("delivery-order:update") && !isCancelled} showPrice={!twoStep && !!order.isCaseDo && order.priceMode === "itemized"}
                        kitNames={[...new Set(order.items.filter((x) => x.custShow === "kit" && x.custDescription).map((x) => x.custDescription!))]}
                        onSaved={() => router.refresh()} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          )}

          {!!order.returns?.length && <ReturnsSection order={order} />}

          {machines.length > 0 && !isCancelled && (
            <CaseMachinesSection doId={order.id} machines={machines} canReturn={can("delivery-order:update")} onDone={() => router.refresh()} />
          )}

          {order.notes && (
            <section className="border border-border rounded-xl p-4">
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Notes</h2>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{order.notes}</p>
            </section>
          )}
        </div>

        {/* Right column — status + details */}
        <div className="space-y-5">

          {/* Status */}
          <section className="border border-border rounded-xl p-4">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Status</h2>
            <div className="mb-3"><StatusBadge status={status} /></div>
            <div className="flex flex-col gap-2">
              {isDraft && can("delivery-order:update") && (
                <Button
                  size="sm"
                  className="w-full gap-1.5 h-8 text-xs bg-green-600 hover:bg-green-700 text-white"
                  disabled={!!actioning || deliverBlocked}
                  title={deliverBlocked ? "Record the actual items used first (after the case)" : isDraftDoNo(doNo) ? "Gives this DO its number" : undefined}
                  onClick={() => act("deliver", async () => {
                    const res = await deliverDeliveryOrder(order.id);
                    if (!res.ok) throw Object.assign(new Error(res.title), { details: res.details });
                  }, "delivered", "Marked as delivered")}
                >
                  <TruckIcon className="w-3.5 h-3.5" />
                  {actioning === "deliver" ? "Updating…" : "Mark as Delivered"}
                </Button>
              )}
              {canReturn && (
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full gap-1.5 h-8 text-xs text-destructive hover:text-destructive border-destructive/30"
                  disabled={!!actioning || liveInvoice}
                  title={liveInvoice ? `Invoice ${order.invoiceNo} is linked — cancel it first, then invoice what the customer kept` : "Record goods the customer sent back — all or part"}
                  onClick={() => setReturnOpen(true)}
                >
                  <RotateCcwIcon className="w-3.5 h-3.5" />
                  Record Return
                </Button>
              )}
              {canInvoice && can("invoice:create") && (
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full gap-1.5 h-8 text-xs"
                  onClick={() => {
                    const params = new URLSearchParams({ doId: order.id });
                    if (order.salesOrderId) params.set("soId", order.salesOrderId);
                    if (order.salesOrderNo) params.set("soNo", order.salesOrderNo);
                    router.push(`/dashboard/fulfillment/invoice/create?${params}`);
                  }}
                >
                  <ReceiptIcon className="w-3.5 h-3.5" />
                  Create Invoice
                </Button>
              )}
              {status === "returned" && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground px-1">
                  <CheckCircle2Icon className="w-3.5 h-3.5 text-muted-foreground" />
                  Stock has been returned to inventory.
                </div>
              )}
            </div>
          </section>

          {/* Details */}
          <section className="border border-border rounded-xl p-4 space-y-2.5">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Details</h2>

            <div className="flex items-start gap-2">
              <TruckIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
              <div>
                <p className="text-[10px] text-muted-foreground">DO Number</p>
                <DoNumberField doId={order.id} doNo={doNo} isOwner={isOrgOwner && !isDraftDoNo(doNo)} onUpdated={(next) => { setDoNo(next); router.refresh(); }} />
                {isDraftDoNo(doNo) && <p className="text-[10px] text-muted-foreground mt-0.5">Temporary reference — the DO number is given when it is marked as delivered</p>}
              </div>
            </div>

            {/* Linked SO — clickable */}
            {order.salesOrderNo && (
              <div className="flex items-start gap-2">
                <LinkIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                <div>
                  <p className="text-[10px] text-muted-foreground">Linked SO</p>
                  {order.salesOrderId ? (
                    <button
                      onClick={() => router.push(`/dashboard/sales/order/${order.salesOrderId}`)}
                      className="text-xs font-mono text-blue-600 dark:text-blue-400 hover:underline text-left"
                    >
                      {order.salesOrderNo}
                    </button>
                  ) : (
                    <p className="text-xs font-mono">{order.salesOrderNo}</p>
                  )}
                </div>
              </div>
            )}

            <div className="flex items-start gap-2">
              <PackageIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
              <div>
                <p className="text-[10px] text-muted-foreground">Items</p>
                <p className="text-xs">{order.items.length} line{order.items.length !== 1 ? "s" : ""}</p>
              </div>
            </div>

            {order.deliveryDate && (
              <div className="flex items-start gap-2">
                <CalendarIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                <div>
                  <p className="text-[10px] text-muted-foreground">Delivery date</p>
                  <p className="text-xs">{fmtDate(order.deliveryDate)}</p>
                </div>
              </div>
            )}

            {order.deliveredTo && (
              <div className="flex items-start gap-2">
                <UserIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                <div>
                  <p className="text-[10px] text-muted-foreground">Delivered to</p>
                  <p className="text-xs">{order.deliveredTo}</p>
                </div>
              </div>
            )}

            {order.deliveryAddress && (
              <div className="flex items-start gap-2">
                <MapPinIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                <div>
                  <p className="text-[10px] text-muted-foreground">Delivery address</p>
                  <p className="text-xs">{order.deliveryAddress}</p>
                </div>
              </div>
            )}

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
            </div>
          </section>

          {/* Case details — CPO link + MRN, re-entered once the hospital issues its CPO */}
          {order.isCaseDo && (
            <section className="border border-border rounded-xl p-4 space-y-2.5">
              <div className="flex items-center justify-between mb-1">
                <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Case Details</h2>
                {can("delivery-order:update") && !isCancelled && (
                  <button
                    type="button"
                    onClick={openCaseDialog}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                    title="Update case details"
                  >
                    <PencilIcon className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {order.caseType && (
                <div className="flex items-start gap-2">
                  <StethoscopeIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                  <div>
                    <p className="text-[10px] text-muted-foreground">Case type</p>
                    <p className="text-xs">{order.caseType}</p>
                  </div>
                </div>
              )}
              <div className="flex items-start gap-2">
                <CalendarIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                <div>
                  <p className="text-[10px] text-muted-foreground">Case date</p>
                  <p className="text-xs">{order.caseDate ? fmtDate(order.caseDate) : "—"}</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <ReceiptIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                <div>
                  <p className="text-[10px] text-muted-foreground">MRN No</p>
                  <p className="text-xs font-mono">{order.mrnNo || "—"}</p>
                </div>
              </div>
              {order.caseDescription && (
                <div className="flex items-start gap-2">
                  <ReceiptIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                  <div>
                    <p className="text-[10px] text-muted-foreground">Case description</p>
                    <p className="text-xs whitespace-pre-wrap">{order.caseDescription}</p>
                  </div>
                </div>
              )}
              <div className="flex items-start gap-2">
                <LinkIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                <div>
                  <p className="text-[10px] text-muted-foreground">Customer PO</p>
                  <p className="text-xs font-mono">{order.customerPoNo || "—"}</p>
                </div>
              </div>
            </section>
          )}
        </div>
      </div>

      {returnOpen && <ReturnDialog order={order} onClose={() => setReturnOpen(false)} onDone={(full) => { setReturnOpen(false); if (full) setStatus("returned"); router.refresh(); }} />}

      <Dialog open={cancelOpen} onOpenChange={(o) => { if (!cancelling) setCancelOpen(o); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel {order.doNo}?</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              The DO stays on record marked <b>Cancelled</b> (its number is kept) with your name, the date and the reason.{" "}
              {order.isCaseDo
                ? <>All stock it took{order.actualStatus === "pending" ? " (none yet)" : " — items, consigned stock and machines —"} goes back to {order.applicationSpecialistName ?? "the specialist"} through reversing entries in Movement History.</>
                : <>Everything still out goes back into the warehouse it left through reversing entries in Movement History{order.salesOrderNo ? <>, and {order.salesOrderNo} is awaiting delivery again</> : null}. Use <b>Record Return</b> instead if the customer simply sent goods back.</>}
              {" "}It can&apos;t be undone.
            </p>
            <div className="space-y-1.5">
              <Label className="text-xs">Reason *</Label>
              <Input value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder={order.isCaseDo ? "e.g. Case postponed by the doctor" : "e.g. Delivered to the wrong customer"} autoFocus />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelOpen(false)} disabled={cancelling}>Keep the DO</Button>
            <Button variant="destructive" onClick={doCancel} disabled={cancelling || cancelReason.trim().length < 3}>
              {cancelling ? "Cancelling…" : "Cancel DO"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={caseDialogOpen} onOpenChange={setCaseDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Update Case Details — {order.doNo}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Customer Purchase Order</Label>
              {loadingCpos ? (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground h-9">
                  <Loader2Icon className="w-3.5 h-3.5 animate-spin" /> Loading customer POs…
                </div>
              ) : cpoOptions.length > 0 ? (
                <div className="space-y-2">
                  <div className="relative">
                    <select
                      className="w-full h-9 rounded-md border border-border bg-background px-3 pr-8 text-sm appearance-none"
                      value={selectedCpoId}
                      onChange={(e) => { setSelectedCpoId(e.target.value); if (e.target.value) setManualCpoNo(""); }}
                    >
                      <option value="">— Select customer PO (optional) —</option>
                      {cpoOptions.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.customerPoNo}{p.customerSnapshot?.organizationName ? ` · ${p.customerSnapshot.organizationName}` : ""}
                        </option>
                      ))}
                    </select>
                    <ChevronDownIcon className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                  </div>
                  {!selectedCpoId && (
                    <Input value={manualCpoNo} onChange={(e) => setManualCpoNo(e.target.value)} placeholder="Or enter PO number manually" className="h-8 text-xs" />
                  )}
                </div>
              ) : (
                <Input value={manualCpoNo} onChange={(e) => setManualCpoNo(e.target.value)} placeholder="Customer PO no. (manual entry)" className="h-9 text-sm" />
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">MRN No</Label>
              <Input value={mrnNoInput} onChange={(e) => setMrnNoInput(e.target.value)} placeholder="Medical record no." className="h-9 text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Case Date</Label>
              <Input type="date" value={caseDateInput} onChange={(e) => setCaseDateInput(e.target.value)} className="h-9 text-sm" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setCaseDialogOpen(false)} disabled={savingCaseInfo}>Cancel</Button>
            <Button size="sm" onClick={handleSaveCaseInfo} disabled={savingCaseInfo} className="gap-1.5">
              {savingCaseInfo && <Loader2Icon className="w-3.5 h-3.5 animate-spin" />}
              {savingCaseInfo ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CaseMachinesSection({ doId, machines, canReturn, onDone }: { doId: string; machines: CaseMachine[]; canReturn: boolean; onDone: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [selling, setSelling] = useState<{ id: string; price: string } | null>(null);
  const out = machines.filter((m) => m.returnMode !== "sold" && m.returnedQty < m.qty - 1e-9).length;
  async function sell(m: CaseMachine) {
    if (!selling || !(parseFloat(selling.price) > 0)) { toast.error("Enter the selling price"); return; }
    if (!confirm(`Sell ${m.productCode}${m.serialNo ? ` (SN ${m.serialNo})` : ""} to the hospital for RM ${parseFloat(selling.price).toFixed(2)}? It will no longer come back.`)) return;
    setBusy(m.movementId);
    try {
      const res = await sellCaseMachine(doId, m.movementId, selling.price);
      if (!res.ok) { toast.error(res.title); return; }
      toast.success("Machine sold to the hospital", res.invoiced ? { description: `${res.invoiced} was already created — invoice the sale separately.` } : { description: "It is added when you create the invoice from this DO." });
      setSelling(null);
      onDone();
    } finally { setBusy(null); }
  }
  async function giveBack(m: CaseMachine) {
    if (!confirm(`Return ${m.productCode}${m.serialNo ? ` (SN ${m.serialNo})` : ""} to the application specialist?`)) return;
    setBusy(m.movementId);
    try {
      const res = await returnCaseMachine(doId, m.movementId);
      if (!res.ok) { toast.error(res.title); return; }
      toast.success("Machine returned to the specialist");
      onDone();
    } finally { setBusy(null); }
  }
  const fmt = (d: Date | string) => new Date(d).toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" });
  return (
    <section className="border border-border rounded-xl p-4">
      <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
        Machines <span className="font-normal">({machines.length}{out ? ` · ${out} at hospital` : ""})</span>
      </h2>
      <div className="flex flex-col divide-y divide-border/60">
        {machines.map((m) => {
          const sold = m.returnMode === "sold";
          const back = !sold && m.returnedQty >= m.qty - 1e-9;
          return (
            <div key={m.movementId} className="py-2.5 first:pt-0 last:pb-0 flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-xs"><span className="font-mono font-semibold">{m.productCode}</span>{m.serialNo && <span className="font-mono text-muted-foreground"> · SN {m.serialNo}</span>}{m.qty !== 1 && <span className="text-muted-foreground"> · × {m.qty}</span>}</div>
                {m.description && <div className="text-[11px] text-muted-foreground break-words">{m.description}</div>}
                <div className="flex flex-wrap gap-1.5 mt-1">
                  <span className={cn("text-[10px] font-medium rounded px-1.5 py-0.5",
                    back ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" : "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400")}>
                    {sold ? `Sold to the hospital · RM ${Number(m.salePrice ?? 0).toFixed(2)}` : back ? (m.returnMode === "same_day" ? "Returned same day" : `Returned${m.returnedAt ? ` ${fmt(m.returnedAt)}` : ""}`) : "At the hospital"}
                  </span>
                  {m.purpose && <span className="text-[10px] font-medium rounded px-1.5 py-0.5 bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">{LOAN_PURPOSE_LABELS[m.purpose] ?? m.purpose}</span>}
                  <span className="text-[10px] rounded px-1.5 py-0.5 bg-muted text-muted-foreground">{m.usageFee ? `Usage fee RM ${Number(m.usageFee).toFixed(2)}` : "No usage fee"}</span>
                  {m.consigned && <span className="text-[10px] rounded px-1.5 py-0.5 bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400">Consigned</span>}
                </div>
              </div>
              {!back && !sold && canReturn && (
                selling?.id === m.movementId ? (
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs">RM</span>
                    <Input type="number" min="0" step="0.01" autoFocus value={selling.price} onChange={(e) => setSelling({ id: m.movementId, price: e.target.value })} className="h-7 w-28 text-xs text-right" placeholder="Selling price" />
                    <Button size="sm" className="h-7 text-xs" disabled={busy === m.movementId} onClick={() => sell(m)}>{busy === m.movementId ? "Saving…" : "Confirm sale"}</Button>
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setSelling(null)}>Cancel</Button>
                  </div>
                ) : (
                  <div className="flex gap-1.5">
                    <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy === m.movementId} onClick={() => giveBack(m)}>
                      {busy === m.movementId ? "Returning…" : "Return to specialist"}
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setSelling({ id: m.movementId, price: "" })}>Sell to hospital</Button>
                  </div>
                )
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

type DoItem = DeliveryOrderWithItems["items"][number];

// A DO line; on a Case DO also how the customer copy prints it (the stock
// deducted is always the line's own item), editable
function ItemRow({ item, doId, isCase, canEdit, kitNames, onSaved, showPrice }: { item: DoItem; doId: string; isCase: boolean; canEdit: boolean; kitNames: string[]; onSaved: () => void; showPrice?: boolean }) {
  const [editing, setEditing] = useState<CustomerView | null>(null);
  const [saving, setSaving] = useState(false);
  const summary = isCase ? customerViewSummary(item) : null;
  async function save() {
    if (!editing) return;
    setSaving(true);
    try {
      const res = await setDoItemCustomerView(doId, item.id, editing);
      if (!res.ok) { toast.error(res.title); return; }
      toast.success(editing.custShow ? "Customer copy updated" : "Printed as is on the customer copy");
      setEditing(null);
      onSaved();
    } finally { setSaving(false); }
  }
  return (
    <>
      <tr className={cn("border-b border-border/40 last:border-0", editing && "border-b-0")}>
        <td className="py-2 pr-3 text-muted-foreground align-top">{item.rowNo}</td>
        <td className="py-2 pr-3 font-mono text-muted-foreground align-top">{item.productCode || "—"}</td>
        <td className="py-2 pr-3 align-top">
          {item.description || "—"}
          {isCase && (summary || canEdit) && (
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px]">
              {summary && <span className="rounded px-1.5 py-0.5 bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300">Customer copy: {summary}</span>}
              {item.custReason && <span className="text-muted-foreground">({item.custReason})</span>}
              {canEdit && !editing && (
                <button type="button" onClick={() => setEditing({ custShow: item.custShow as CustomerView["custShow"], custProductId: item.custProductId, custCode: item.custCode, custDescription: item.custDescription, custQty: item.custQty, custUom: item.custUom, custReason: item.custReason })}
                  className="text-muted-foreground hover:text-foreground underline">{summary ? "change" : "customer copy…"}</button>
              )}
            </div>
          )}
        </td>
        <td className="py-2 pr-3 text-right tabular-nums align-top">{item.qty}</td>
        <td className="py-2 text-muted-foreground align-top">{item.uom || "—"}</td>
        {showPrice && (
          <td className="py-2 pl-3 text-right tabular-nums align-top">
            {item.usageFee ? <span title="Machine usage fee (per case)">{Number(item.usageFee).toFixed(2)}<span className="block text-[10px] text-muted-foreground">usage fee</span></span>
              : item.unitPrice ? Number(item.unitPrice).toFixed(2) : <span className="text-muted-foreground">—</span>}
          </td>
        )}
      </tr>
      {editing && (
        <tr className="border-b border-border/40">
          <td />
          <td colSpan={showPrice ? 5 : 4} className="pb-2 pr-3">
            <CustomerViewEditor value={editing} onChange={setEditing} needReason kitNames={kitNames} />
            <div className="mt-1.5 flex gap-1.5">
              <Button size="sm" className="h-7 text-xs" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setEditing(null)} disabled={saving}>Cancel</Button>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// Two-step Case DO: what the customer copy shows and the invoice bills — from
// the doctor's template, editable until the DO is invoiced
function CustomerItemsSection({ order, canEdit, onSaved }: { order: DeliveryOrderWithItems; canEdit: boolean; onSaved: () => void }) {
  const [editing, setEditing] = useState<null | { rows: CaseLineItem[]; priceMode: "itemized" | "total"; casePrice: string }>(null);
  const [saving, setSaving] = useState(false);
  const total = order.priceMode === "total";
  const itemsTotal = order.customerItems.reduce((s, i) => s + Number(i.unitPrice ?? 0) * Number(i.qty ?? 0), 0);
  // usage fees of machines used that aren't on the customer copy (those are priced there)
  const fees = order.items.filter((i) => !order.customerItems.some((c) => c.productId && c.productId === i.productId)).reduce((s, i) => s + Number(i.usageFee ?? 0), 0);
  const startEdit = () => setEditing({
    rows: order.customerItems.map((c, k) => ({ _key: `c${k}`, productId: c.productId ?? undefined, productCode: c.productCode ?? "", description: c.description ?? "", qty: c.qty, uom: c.uom ?? "", unitPrice: c.unitPrice ? String(Number(c.unitPrice)) : "" })),
    priceMode: total ? "total" : "itemized", casePrice: order.casePrice ? String(Number(order.casePrice)) : "",
  });
  const upd = (key: string, patch: Partial<CaseLineItem>) => setEditing((e) => e && { ...e, rows: e.rows.map((r) => (r._key === key ? { ...r, ...patch } : r)) });
  // MDA of the products listed: one without a valid registration won't print on the customer copy
  const [mdaOf, setMdaOf] = useState<Record<string, { regNo: string | null; valid: boolean }>>({});
  const productKey = [...new Set((editing ? editing.rows : order.customerItems).map((r) => r.productId).filter(Boolean) as string[])].sort().join(",");
  useEffect(() => {
    if (!productKey) return;
    let cancelled = false;
    getProductsMda(productKey.split(",")).then((m) => { if (!cancelled) setMdaOf((prev) => ({ ...prev, ...m })); }).catch(() => {});
    return () => { cancelled = true; };
  }, [productKey]);
  const noMda = (productId?: string | null) => !!productId && mdaOf[productId]?.valid === false;
  const badCodes = (editing ? editing.rows : order.customerItems).filter((r) => noMda(r.productId)).map((r) => r.productCode ?? "");
  async function save() {
    if (!editing) return;
    if (editing.priceMode === "itemized" && badCodes.length) { toast.error(pricedWithoutMdaMessage(badCodes), { duration: 12000 }); return; }
    setSaving(true);
    try {
      const res = await saveCaseCustomerItems(order.id, {
        priceMode: editing.priceMode, casePrice: editing.casePrice,
        items: editing.rows.map((r) => ({ productId: r.productId ?? null, productCode: r.productCode, description: r.description, qty: r.qty || "1", uom: r.uom, unitPrice: r.unitPrice ?? null })),
      });
      if (!res.ok) { toast.error(res.title); return; }
      toast.success("Customer items saved");
      setEditing(null);
      onSaved();
    } finally { setSaving(false); }
  }
  return (
    <section className="border border-border rounded-xl p-4">
      <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 flex items-center gap-2">
        Customer copy items <span className="font-normal">({order.customerItems.length})</span>
        {canEdit && !editing && <button type="button" onClick={startEdit} className="ml-auto text-[11px] font-normal normal-case tracking-normal text-primary hover:underline">edit</button>}
        {!canEdit && order.invoiceId && <span className="ml-auto text-[11px] font-normal normal-case tracking-normal">invoiced {order.invoiceNo} — fixed</span>}
      </h2>
      <p className="text-xs text-muted-foreground mb-2">
        What the hospital sees and is billed for. Selling price: {total
          ? <b className="text-foreground">total RM {Number(order.casePrice ?? 0).toFixed(2)}</b>
          : <>itemized — <b className="text-foreground">RM {itemsTotal.toFixed(2)}</b></>}
        {fees > 0 && <> + usage fees of machines not listed RM {fees.toFixed(2)}</>}
      </p>
      {editing ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            {([["itemized", "Itemized"], ["total", "Total for the case"]] as const).map(([m, label]) => (
              <button key={m} type="button" onClick={() => setEditing({ ...editing, priceMode: m })}
                className={cn("rounded-full border px-2.5 py-0.5", editing.priceMode === m ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background")}>{label}</button>
            ))}
            {editing.priceMode === "total" && (
              <span className="flex items-center gap-1 ml-2">RM <Input type="number" min="0" step="0.01" value={editing.casePrice} onChange={(e) => setEditing({ ...editing, casePrice: e.target.value })} className="h-7 w-28 text-xs text-right" /></span>
            )}
          </div>
          {editing.priceMode === "itemized" && <ItemizedMdaWarning codes={badCodes} />}
          <table className="w-full text-xs">
            <tbody>
              {editing.rows.map((r) => (
                <tr key={r._key} className={cn("border-b border-border/40", noMda(r.productId) && "bg-red-50 dark:bg-red-950/30 outline outline-1 outline-red-400")}
                  title={noMda(r.productId) ? "No valid MDA registration — won't print on the customer copy" : undefined}>
                  <td className="py-1 pr-1 w-32"><CaseExtraProductCell item={r} onUpdate={upd} /></td>
                  <td className="py-1 pr-1"><Input value={r.description} onChange={(e) => upd(r._key, { description: e.target.value })} className="h-7 text-xs" placeholder="Description" /></td>
                  <td className="py-1 pr-1 w-16"><Input type="number" min="0" step="any" value={r.qty} onChange={(e) => upd(r._key, { qty: e.target.value })} className="h-7 text-xs text-right" /></td>
                  <td className="py-1 pr-1 w-16"><Input value={r.uom} onChange={(e) => upd(r._key, { uom: e.target.value })} className="h-7 text-xs" placeholder="UOM" /></td>
                  {editing.priceMode === "itemized" && <td className="py-1 pr-1 w-24"><Input type="number" min="0" step="0.01" value={r.unitPrice ?? ""} onChange={(e) => upd(r._key, { unitPrice: e.target.value })} className="h-7 text-xs text-right" placeholder="price" /></td>}
                  <td className="py-1 w-6"><button type="button" onClick={() => setEditing({ ...editing, rows: editing.rows.filter((x) => x._key !== r._key) })} className="text-muted-foreground hover:text-destructive">✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex gap-1.5">
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setEditing({ ...editing, rows: [...editing.rows, { _key: `n${Date.now()}`, productCode: "", description: "", qty: "1", uom: "" }] })}>Add row</Button>
            <Button size="sm" className="h-7 text-xs" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setEditing(null)} disabled={saving}>Cancel</Button>
          </div>
        </div>
      ) : order.customerItems.length === 0 ? <p className="text-sm text-muted-foreground">No customer items.</p> : (
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <th className="text-left pb-2 pr-3 w-6">#</th><th className="text-left pb-2 pr-3 w-24">Code</th><th className="text-left pb-2 pr-3">Description</th>
              <th className="text-right pb-2 pr-3 w-12">Qty</th><th className="text-left pb-2 w-12">UOM</th>{!total && <th className="text-right pb-2 pl-3 w-20">Price</th>}
            </tr>
          </thead>
          <tbody>
            {order.customerItems.map((c) => (
              <tr key={c.id} className={cn("border-b border-border/40 last:border-0", noMda(c.productId) && "bg-red-50 text-red-800 dark:bg-red-950/30 dark:text-red-300")}
                title={noMda(c.productId) ? "No valid MDA registration — won't print on the customer copy" : undefined}>
                <td className="py-2 pr-3 text-muted-foreground">{c.rowNo}</td>
                <td className="py-2 pr-3 font-mono text-muted-foreground">{c.productCode || "—"}</td>
                <td className="py-2 pr-3">{c.description || "—"}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{Number(c.qty)}</td>
                <td className="py-2 text-muted-foreground">{c.uom || "—"}</td>
                {!total && <td className="py-2 pl-3 text-right tabular-nums">{c.unitPrice ? Number(c.unitPrice).toFixed(2) : "—"}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

// Normal DO: goods the customer sent back — each return with who, when and why
function ReturnsSection({ order }: { order: DeliveryOrderWithItems }) {
  return (
    <section className="border border-border rounded-xl p-4">
      <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Returns ({order.returns!.length})</h2>
      <ul className="space-y-2.5">
        {order.returns!.map((r) => (
          <li key={r.id} className="text-xs">
            <p><b>{new Date(r.createdAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</b>{r.createdByName ? ` · ${r.createdByName}` : ""} — {r.reason}</p>
            <p className="text-muted-foreground">{r.items.map((i) => `${i.productCode ?? i.description ?? "Item"} × ${i.qty}${i.uom ? ` ${i.uom}` : ""}`).join(" · ")}</p>
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-muted-foreground mt-2">Returned stock went back into the warehouse it left. The invoice made from this DO bills only what the customer kept.</p>
    </section>
  );
}

function ReturnDialog({ order, onClose, onDone }: { order: DeliveryOrderWithItems; onClose: () => void; onDone: (full: boolean) => void }) {
  const rows = order.items.map((i) => ({ item: i, left: Number(i.qty ?? 1) - Number(i.returnedQty ?? 0) })).filter((r) => r.left > 1e-9);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const picked = rows.map((r) => ({ itemId: r.item.id, qty: Number(qty[r.item.id] || 0) })).filter((r) => r.qty > 0);
  const over = rows.some((r) => Number(qty[r.item.id] || 0) > r.left);
  async function save() {
    setSaving(true);
    try {
      const res = await returnDeliveryOrder(order.id, { reason, items: picked });
      if (!res.ok) { toast.error(res.title, { duration: 10000 }); return; }
      toast.success(res.full ? `${order.doNo} fully returned — stock back in the warehouse` : "Return recorded — stock back in the warehouse");
      onDone(res.full);
    } finally { setSaving(false); }
  }
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !saving) onClose(); }}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader><DialogTitle>Record return — {order.doNo}</DialogTitle></DialogHeader>
        <div className="space-y-3 text-sm">
          <p className="text-muted-foreground text-xs">Enter what the customer sent back. It goes back into the warehouse it left; the rest stays delivered. Once everything is back the DO is <b>Returned</b>.</p>
          <div className="flex justify-end">
            <button type="button" className="text-xs text-primary hover:underline" onClick={() => setQty(Object.fromEntries(rows.map((r) => [r.item.id, String(r.left)])))}>Everything came back</button>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="text-left pb-1.5 pr-2">Item</th>
                <th className="text-right pb-1.5 pr-2 w-20">Delivered</th>
                <th className="text-right pb-1.5 pr-2 w-24">Returned before</th>
                <th className="text-right pb-1.5 w-24">Returning now</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ item, left }) => {
                const v = qty[item.id] ?? "";
                const bad = Number(v || 0) > left;
                return (
                  <tr key={item.id} className="border-b border-border/40">
                    <td className="py-1.5 pr-2"><span className="font-mono">{item.productCode}</span> <span className="text-muted-foreground">{item.description}</span></td>
                    <td className="py-1.5 pr-2 text-right">{Number(item.qty ?? 1)}</td>
                    <td className="py-1.5 pr-2 text-right">{Number(item.returnedQty ?? 0) || "—"}</td>
                    <td className="py-1.5 text-right">
                      <Input type="number" min={0} max={left} step="any" value={v} placeholder="0"
                        onChange={(e) => setQty((q) => ({ ...q, [item.id]: e.target.value }))}
                        className={cn("h-7 w-20 ml-auto text-right text-xs", bad && "border-destructive")} />
                      {bad && <p className="text-[10px] text-destructive">max {left}</p>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="space-y-1.5">
            <Label className="text-xs">Reason *</Label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Wrong size — customer sent back 2 boxes" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Close</Button>
          <Button onClick={save} disabled={saving || !picked.length || over || reason.trim().length < 3}>{saving ? "Saving…" : "Record return"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
