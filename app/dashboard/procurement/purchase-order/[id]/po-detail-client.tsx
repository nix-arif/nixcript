"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import {
  recallPurchaseOrder,
  reconfirmPurchaseOrder,
  submitPurchaseOrder,
  fulfillPurchaseOrder,
  cancelPurchaseOrder,
  deletePurchaseOrder,
  type PurchaseOrderWithItems,
} from "@/server/purchase-order";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import {
  ArrowLeftIcon, BuildingIcon, CalendarIcon, PackageIcon,
  CheckIcon, XIcon, ArchiveIcon, PrinterIcon, RotateCcwIcon,
  ClipboardListIcon, TruckIcon, LinkIcon, ImageIcon, PencilIcon, SendIcon,
  DatabaseIcon, FileSpreadsheetIcon, TagIcon, PlusIcon, Trash2Icon, AlertCircleIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

const R2_PRODUCT_IMAGES = process.env.NEXT_PUBLIC_R2_PRODUCT_IMAGES_URL ?? "";

function ItemImageThumb({ imageUrl, productCode }: { imageUrl: string | null; productCode?: string | null }) {
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);

  const catalogSrc = R2_PRODUCT_IMAGES && productCode
    ? `${R2_PRODUCT_IMAGES}/${encodeURIComponent(productCode)}.jpg`
    : "";
  const src = imageUrl || catalogSrc;

  if (!src || failed) return <span className="text-muted-foreground">—</span>;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="block w-9 h-9 rounded border border-border overflow-hidden hover:opacity-80 transition-opacity shrink-0"
        title="View image"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} className="w-full h-full object-cover" alt="" onError={() => setFailed(true)} />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg p-0 overflow-hidden gap-0" showCloseButton={false}>
          <DialogTitle className="sr-only">{productCode ?? "Image"}</DialogTitle>
          <div className="relative bg-muted/30">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              className="w-full object-contain max-h-[65vh]"
              alt={productCode ?? ""}
              onError={() => { setFailed(true); setOpen(false); }}
            />
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="absolute top-2 right-2 w-7 h-7 flex items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
            >
              <XIcon className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="px-4 py-3 border-t">
            <p className="text-xs text-muted-foreground font-mono truncate">{productCode ?? ""}</p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

const fmt = (v: string | number | null | undefined, currency = "MYR") =>
  `${currency} ${Number(v ?? 0).toLocaleString("en-MY", { minimumFractionDigits: 2 })}`;

const fmtDate = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const PO_STATUS: Record<string, { label: string; className: string }> = {
  draft:     { label: "Draft",     className: "bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400" },
  submitted: { label: "Submitted", className: "bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-400" },
  confirmed: { label: "Confirmed", className: "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400" },
  fulfilled: { label: "Fulfilled",  className: "bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400" },
  cancelled: { label: "Cancelled",  className: "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400" },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = PO_STATUS[status] ?? { label: status, className: "bg-muted text-muted-foreground" };
  return <span className={cn("text-[11px] font-medium rounded px-2 py-0.5", cfg.className)}>{cfg.label}</span>;
}

// "Fulfilled" only means everything was physically received (see
// maybeAutoFulfill in server/goods-receipt.ts) — it says nothing about
// whether it was actually accepted. This flags the gap: received quantity
// still sitting unresolved in "return to supplier" or "in-house repair".
function PendingActionBadge({ pendingReturnQty, pendingRepairQty }: { pendingReturnQty: number; pendingRepairQty: number }) {
  if (pendingReturnQty <= 0 && pendingRepairQty <= 0) return null;
  const parts: string[] = [];
  if (pendingReturnQty > 0) parts.push(`${pendingReturnQty} pending return`);
  if (pendingRepairQty > 0) parts.push(`${pendingRepairQty} pending repair`);
  return (
    <span
      className="flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-md bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800"
      title={parts.join(", ")}
    >
      <AlertCircleIcon className="w-3 h-3 shrink-0" />
      {parts.join(" · ")}
    </span>
  );
}

export function PurchaseOrderDetailClient({
  order,
  permissions,
  currentUserId,
  businessType = "trading",
  backHref = "/dashboard/procurement/purchase-order",
  organizationName,
  editHref,
  hidePricing = false,
}: {
  order: PurchaseOrderWithItems;
  permissions: string[];
  currentUserId: string;
  businessType?: string;
  backHref?: string;
  // Shown alongside the supplier when viewing this PO from the centralized
  // (cross-org) list, so it's clear which org this record actually belongs to.
  organizationName?: string;
  // When provided, overrides both the Edit destination and whether the Edit
  // button shows at all — used by the centralized view, whose edit rights
  // are resolved server-side (creator, org-scoped update, or the centralized
  // update permission) rather than the plain `permissions` array here.
  editHref?: string;
  // Centralized viewers who can't edit this PO see everything except money.
  hidePricing?: boolean;
}) {
  const showSourcing = businessType !== "trading";
  const router = useRouter();
  const [status, setStatus] = useState(order.status ?? "confirmed");
  const [actioning, setActioning] = useState<string | null>(null);
  const [pdfWithImages, setPdfWithImages] = useState(true);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => { setStatus(order.status ?? "confirmed"); }, [order.status]);

  const can = (p: string) => permissions.includes("*") || permissions.includes(p);
  const isOwner = permissions.includes("*");
  const snap = order.supplierSnapshot as any;

  async function handleDelete() {
    if (!confirm(`Permanently delete ${order.poNo ?? order.prNo ?? "this purchase order"}? This removes the record entirely and can't be undone.`)) return;
    setDeleting(true);
    try {
      await deletePurchaseOrder(order.id);
      toast.success("Purchase order deleted");
      router.push(backHref);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
      setDeleting(false);
    }
  }

  async function act(key: string, fn: () => Promise<void>, next: string, successMsg: string) {
    setActioning(key);
    try {
      await fn();
      setStatus(next);
      toast.success(successMsg);
      router.refresh();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setActioning(null);
    }
  }

  const isDraft = status === "draft";
  const isConfirmed = status === "confirmed";
  const isFulfilled = status === "fulfilled";

  // Packing list: a logistics document for the supplier's warehouse to pack
  // against and countersign — deliberately excludes pricing (unlike the PO
  // PDF/Excel itself) and adds a blank "Qty Packed" column for them to fill
  // in by hand, since that reconciliation is the whole point of the document.
  function handleDownloadPackingList() {
    const hasGroups = order.items.some((i) => i.setGroupLabel);
    const rows: (string | number)[][] = [];

    rows.push(["PACKING LIST"]);
    rows.push([]);
    rows.push(["PO No", order.poNo ?? "—", "Date", fmtDate(order.createdAt)]);
    rows.push(["Supplier", snap?.name ?? "—"]);
    if (snap?.address) rows.push(["Supplier Address", snap.address]);
    if (order.deliveryAddress) rows.push(["Ship To", order.deliveryAddress]);
    if (order.expectedDeliveryDate) rows.push(["Expected Delivery", fmtDate(order.expectedDeliveryDate)]);
    rows.push([]);

    const header = ["#"];
    if (hasGroups) header.push("Set");
    if (showSourcing) header.push("Design Brand", "Design Code", "Emboss Code");
    header.push("Code", "Description", "Ordered Qty", "UOM", "Qty Packed", "Remarks");
    rows.push(header);

    let totalQty = 0;
    for (const item of order.items) {
      const qty = Number(item.qty ?? 0);
      totalQty += qty;
      const row: (string | number)[] = [item.rowNo];
      if (hasGroups) row.push(item.setGroupLabel ?? "");
      if (showSourcing) row.push(item.designBrandName ?? "", item.designBrandCode ?? "", item.privateLabelCode ?? "");
      row.push(item.productCode ?? "", item.description ?? "", qty, item.uom ?? "", "", "");
      rows.push(row);
    }

    rows.push([]);
    const qtyColIdx = header.indexOf("Ordered Qty");
    const totalRow = new Array(header.length).fill("");
    totalRow[qtyColIdx - 1] = "Total";
    totalRow[qtyColIdx] = totalQty;
    rows.push(totalRow);
    rows.push([]);
    rows.push(["Packed By:", "", "", "Date:"]);
    rows.push(["Checked By:", "", "", "Date:"]);

    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = header.map((h) => ({ wch: h === "Description" ? 40 : 16 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Packing List");
    XLSX.writeFile(wb, `Packing List - ${order.poNo ?? order.prNo ?? order.id}.xlsx`);
  }

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title={order.poNo ?? order.prNo ?? order.id}
        description={`Supplier Purchase Order${organizationName ? ` · ${organizationName}` : ""} · ${fmtDate(order.createdAt)}`}
        action={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => router.push(backHref)} className="gap-1.5">
              <ArrowLeftIcon className="w-3.5 h-3.5" /> Back
            </Button>
            {isDraft && (editHref ? true : can("purchase-order:update")) && (
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => router.push(editHref ?? `/dashboard/procurement/purchase-order/${order.id}/edit`)}>
                <PencilIcon className="w-3.5 h-3.5" /> Edit
              </Button>
            )}
            {isOwner && !order.approvedAt && (status === "draft" || status === "cancelled") && (
              <Button size="sm" variant="outline" className="gap-1.5 text-destructive hover:text-destructive" disabled={deleting} onClick={handleDelete}>
                <Trash2Icon className="w-3.5 h-3.5" /> Delete
              </Button>
            )}
            {isConfirmed && !hidePricing && (
              <div className="flex items-center rounded-md border border-border overflow-hidden">
                <button
                  type="button"
                  onClick={() => window.open(`/api/purchase-order/${order.id}/pdf${pdfWithImages ? "?withImages=1" : ""}`, "_blank")}
                  className="flex items-center gap-1.5 px-3 h-8 text-xs font-medium hover:bg-muted transition-colors"
                >
                  <PrinterIcon className="w-3.5 h-3.5" /> PDF
                </button>
                <div className="w-px h-5 bg-border" />
                <button
                  type="button"
                  onClick={() => setPdfWithImages((v) => !v)}
                  title={pdfWithImages ? "Images ON — click to exclude" : "Images OFF — click to include"}
                  className={cn(
                    "flex items-center gap-1 px-2 h-8 text-xs transition-colors",
                    pdfWithImages
                      ? "bg-blue-50 text-blue-600 hover:bg-blue-100 dark:bg-blue-950/40 dark:text-blue-400"
                      : "text-muted-foreground hover:bg-muted",
                  )}
                >
                  <ImageIcon className="w-3.5 h-3.5" />
                  <span>{pdfWithImages ? "with images" : "no images"}</span>
                </button>
              </div>
            )}
            {(isConfirmed || isFulfilled) && (
              <Button variant="outline" size="sm" className="gap-1.5" onClick={handleDownloadPackingList}>
                <FileSpreadsheetIcon className="w-3.5 h-3.5" /> Packing List
              </Button>
            )}
            <StatusBadge status={status} />
            <PendingActionBadge pendingReturnQty={order.pendingReturnQty} pendingRepairQty={order.pendingRepairQty} />
          </div>
        }
      />

      {/* PR → PO trail */}
      {order.prNo && order.poNo && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground border border-border rounded-lg px-4 py-2.5 bg-muted/20">
          <ClipboardListIcon className="w-3.5 h-3.5 shrink-0" />
          <span className="text-[10px] text-muted-foreground">Source Requisition</span>
          {order.purchaseRequisitionId ? (
            <button
              className="font-mono font-medium text-blue-600 dark:text-blue-400 hover:underline"
              onClick={() => router.push(`/dashboard/procurement/requisition/${order.purchaseRequisitionId}`)}
            >
              {order.prNo}
            </button>
          ) : (
            <span className="font-mono font-medium text-foreground">{order.prNo}</span>
          )}
          <span className="text-muted-foreground/40 mx-1">→</span>
          <TruckIcon className="w-3.5 h-3.5 shrink-0" />
          <span className="font-mono font-medium text-foreground">{order.poNo}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left — supplier + items + GR */}
        <div className="lg:col-span-2 space-y-5">
          {snap && (
            <section className="border border-border rounded-xl p-4">
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Supplier</h2>
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <BuildingIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <span className="text-sm font-medium">{snap.name}</span>
                </div>
                {snap.registrationNo && <p className="text-xs text-muted-foreground pl-5">Reg: {snap.registrationNo}</p>}
                {snap.contactPerson && <p className="text-xs text-muted-foreground pl-5">{snap.contactPerson}</p>}
                {snap.email && <p className="text-xs text-muted-foreground pl-5">{snap.email}</p>}
                {snap.contactNo && <p className="text-xs text-muted-foreground pl-5">{snap.contactNo}</p>}
                {snap.address && <p className="text-xs text-muted-foreground pl-5 whitespace-pre-wrap">{snap.address}</p>}
              </div>
            </section>
          )}

          <section className="border border-border rounded-xl p-4">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              Items <span className="font-normal">({order.items.length})</span>
            </h2>
            {order.items.length === 0 ? (
              <p className="text-sm text-muted-foreground">No items</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground">
                      <th className="text-left pb-2 pr-3 w-6">#</th>
                      {showSourcing && (
                        <>
                          <th className="text-left pb-2 pr-3 w-28">Design Brand</th>
                          <th className="text-left pb-2 pr-3 w-24">Design Code</th>
                        </>
                      )}
                      <th className="text-left pb-2 pr-3 w-24">Code</th>
                      <th className="text-left pb-2 pr-3">Description</th>
                      <th className="text-left pb-2 pr-3 w-10">Img</th>
                      <th className="text-right pb-2 pr-3 w-12">Qty</th>
                      <th className="text-left pb-2 pr-3 w-12">UOM</th>
                      {!hidePricing && (
                        <>
                          <th className="text-left pb-2 pr-3 w-12">Ccy</th>
                          <th className="text-right pb-2 pr-3 w-24">Unit Price</th>
                          <th className="text-right pb-2 w-24">Total</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {order.items.map((item) => (
                      <tr key={item.id} className="border-b border-border/40 last:border-0">
                        <td className="py-2 pr-3 align-top text-muted-foreground">{item.rowNo}</td>
                        {showSourcing && (
                          <>
                            <td className="py-2 pr-3 align-top">
                              {item.designBrandName?.trim() ? (
                                <div className="flex flex-col gap-0.5">
                                  <span className="text-muted-foreground">{item.designBrandName}</span>
                                  {item.designBrandSource === "catalog" ? (
                                    <span className="inline-flex items-center gap-1 w-fit text-[10px] px-1.5 py-0.5 rounded-md bg-blue-50 text-blue-600 border border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800">
                                      <DatabaseIcon className="w-3 h-3 shrink-0" />from catalogue
                                    </span>
                                  ) : item.designBrandSource === "user" && (
                                    <span className="inline-flex items-center gap-1 w-fit text-[10px] px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800">
                                      <PencilIcon className="w-3 h-3 shrink-0" />{item.oemEditedBy ? `${item.oemEditedBy} edited SPO` : "edited SPO"}
                                    </span>
                                  )}
                                </div>
                              ) : item.sourcingType === "oem" ? (
                                <span className="text-destructive">missing</span>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </td>
                            <td className="py-2 pr-3 align-top">
                              {item.designBrandCode?.trim() ? (
                                <div className="flex flex-col gap-0.5">
                                  <span className="font-mono text-muted-foreground">{item.designBrandCode}</span>
                                  <span className="inline-flex items-center gap-1 w-fit text-[10px] px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800">
                                    <PencilIcon className="w-3 h-3 shrink-0" />{item.oemEditedBy ? `${item.oemEditedBy} edited SPO` : "edited SPO"}
                                  </span>
                                </div>
                              ) : item.sourcingType === "oem" ? (
                                <span className="font-sans text-destructive">missing</span>
                              ) : "—"}
                            </td>
                          </>
                        )}
                        <td className="py-2 pr-3 align-top">
                          <div className="flex flex-col gap-0.5">
                            <span className="font-mono text-muted-foreground">{item.productCode || "—"}</span>
                            {showSourcing && item.sourcingType && (
                              <span className={cn(
                                "inline-block w-fit text-[10px] px-1.5 py-0.5 rounded-md border font-medium",
                                item.sourcingType === "oem"
                                  ? "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/40 dark:text-purple-400 dark:border-purple-800"
                                  : "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800",
                              )}>
                                {item.sourcingType === "oem" ? "OEM" : "Trading"}
                              </span>
                            )}
                            {item.sourcingType === "oem" && (
                              item.privateLabelCode?.trim() && item.privateLabelCode !== item.productCode ? (
                                <div className="flex flex-col gap-0.5">
                                  <span className="font-mono text-[10px] text-muted-foreground">Emboss: {item.privateLabelCode}</span>
                                  {item.privateLabelSource === "catalog" ? (
                                    <span className="inline-flex items-center gap-1 w-fit text-[10px] px-1.5 py-0.5 rounded-md bg-blue-50 text-blue-600 border border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800">
                                      <DatabaseIcon className="w-3 h-3 shrink-0" />from catalogue
                                    </span>
                                  ) : item.privateLabelSource === "auto" ? (
                                    <span className="inline-flex items-center gap-1 w-fit text-[10px] px-1.5 py-0.5 rounded-md bg-blue-50 text-blue-600 border border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800">
                                      <LinkIcon className="w-3 h-3 shrink-0" />from Code
                                    </span>
                                  ) : item.privateLabelSource === "user" && (
                                    <span className="inline-flex items-center gap-1 w-fit text-[10px] px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800">
                                      <PencilIcon className="w-3 h-3 shrink-0" />{item.oemEditedBy ? `${item.oemEditedBy} edited SPO` : "edited SPO"}
                                    </span>
                                  )}
                                </div>
                              ) : !item.privateLabelCode?.trim() ? (
                                <span className="text-[10px] text-destructive">emboss code missing</span>
                              ) : null
                            )}
                          </div>
                        </td>
                        <td className="py-2 pr-3 align-top">
                          {(item.setGroupLabel || item.customerPoNo || item.customerOrganization || item.customerName) && (
                            <div className="flex flex-wrap gap-1 mb-1">
                              {item.setGroupLabel && (
                                <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-teal-50 dark:bg-teal-900/20 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-800">
                                  <TagIcon className="w-2.5 h-2.5 shrink-0" />{item.setGroupLabel}
                                </span>
                              )}
                              {item.customerPoNo && (
                                <span className="inline-flex items-center text-[10px] font-mono font-medium px-1.5 py-0.5 rounded-md border bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800">
                                  {item.customerPoNo}
                                </span>
                              )}
                              {item.customerOrganization && (
                                <span className="inline-flex items-center text-[10px] px-1.5 py-0.5 rounded-md bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-300 border border-violet-200 dark:border-violet-800">
                                  {item.customerOrganization}
                                </span>
                              )}
                              {item.customerName && (
                                <span className="inline-flex items-center text-[10px] px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground border border-border/60">
                                  {item.customerName}
                                </span>
                              )}
                            </div>
                          )}
                          {item.description || "—"}
                          {item.descriptionSource === "product" && (
                            <span className="flex items-center gap-1 w-fit mt-0.5 text-[10px] px-1.5 py-0.5 rounded-md bg-blue-50 text-blue-600 border border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800">
                              <DatabaseIcon className="w-3 h-3 shrink-0" />from catalogue
                            </span>
                          )}
                          {item.descriptionSource === "pr" && (
                            <span className="flex items-center gap-1 w-fit mt-0.5 text-[10px] px-1.5 py-0.5 rounded-md bg-green-50 text-green-700 border border-green-200 dark:bg-green-950/40 dark:text-green-400 dark:border-green-800">
                              <ClipboardListIcon className="w-3 h-3 shrink-0" />from purchase requisition
                            </span>
                          )}
                          {item.isAdditional && (
                            <span className="flex items-center gap-1 w-fit mt-0.5 text-[10px] px-1.5 py-0.5 rounded-md bg-purple-50 text-purple-700 border border-purple-200 dark:bg-purple-950/40 dark:text-purple-400 dark:border-purple-800">
                              <PlusIcon className="w-3 h-3 shrink-0" />additional row
                            </span>
                          )}
                          {item.editedBy && (
                            <span className="flex items-center gap-1 w-fit mt-0.5 text-[10px] px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800">
                              <PencilIcon className="w-3 h-3 shrink-0" />{item.editedBy} edited SPO
                            </span>
                          )}
                        </td>
                        <td className="py-2 pr-3 align-top">
                          <ItemImageThumb imageUrl={item.imageUrl} productCode={item.productCode} />
                        </td>
                        <td className="py-2 pr-3 align-top text-right tabular-nums">{item.qty}</td>
                        <td className="py-2 pr-3 align-top text-muted-foreground">{item.uom || "—"}</td>
                        {!hidePricing && (
                          <>
                            <td className="py-2 pr-3 align-top font-mono text-muted-foreground">{item.currency || "MYR"}</td>
                            <td className="py-2 pr-3 align-top text-right tabular-nums">{Number(item.unitPrice ?? 0).toLocaleString("en-MY", { minimumFractionDigits: 2 })}</td>
                            <td className="py-2 align-top text-right tabular-nums font-medium">{Number(item.totalPrice ?? 0).toLocaleString("en-MY", { minimumFractionDigits: 2 })}</td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {order.notes && (
            <section className="border border-border rounded-xl p-4">
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Notes</h2>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{order.notes}</p>
            </section>
          )}

          <section className="border border-border rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Goods Receipts</h2>
              <div className="flex items-center gap-2">
                {isConfirmed && can("packing-list:create") && order.supplierId && (
                  <Button
                    size="sm" variant="outline" className="h-7 text-xs gap-1.5"
                    onClick={() => router.push(`/dashboard/procurement/packing-list/create?supplierId=${order.supplierId}`)}
                  >
                    <ClipboardListIcon className="w-3 h-3" /> Create Packing List
                  </Button>
                )}
                {isConfirmed && can("goods-receipt:create") && (
                  <Button
                    size="sm" variant="outline" className="h-7 text-xs gap-1.5"
                    onClick={() => router.push(`/dashboard/procurement/purchase-order/${order.id}/goods-receipt/create`)}
                  >
                    <TruckIcon className="w-3 h-3" /> Record Receipt
                  </Button>
                )}
              </div>
            </div>
            {order.goodsReceipts.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {isFulfilled ? "No formal goods receipts recorded." : "No goods receipts yet."}
              </p>
            ) : (
              <div className="space-y-1.5">
                {order.goodsReceipts.map((gr) => (
                  <button
                    key={gr.id}
                    onClick={() => router.push(`/dashboard/procurement/goods-receipt/${gr.id}`)}
                    className="w-full flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted/30 transition-colors text-left"
                  >
                    <div className="flex items-center gap-2">
                      <TruckIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      <span className="font-mono text-xs font-medium">{gr.grNo}</span>
                      {gr.status === "recalled" && (
                        <span className="text-[10px] font-medium rounded px-1.5 py-0.5 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400">
                          Recalled
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground">{fmtDate(gr.receivedDate)}</span>
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* Right — actions + pricing + details */}
        <div className="space-y-5">
          {isDraft && (
            <section className="border border-amber-200 dark:border-amber-800/50 rounded-xl p-4 bg-amber-50/30 dark:bg-amber-950/10">
              <h2 className="text-xs font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wide mb-3">Draft — Recalled PO</h2>
              <div className="flex flex-col gap-2">
                {(editHref ? true : can("purchase-order:update")) && (
                  <Button
                    size="sm" variant="outline" className="w-full gap-1.5 h-8 text-xs" disabled={!!actioning}
                    onClick={() => router.push(editHref ?? `/dashboard/procurement/purchase-order/${order.id}/edit`)}
                  >
                    <PencilIcon className="w-3.5 h-3.5" /> Edit PO
                  </Button>
                )}
                {can("purchase-order:update") && (
                  <Button
                    size="sm" variant="outline" className="w-full gap-1.5 h-8 text-xs" disabled={!!actioning}
                    onClick={() => act("submit", () => submitPurchaseOrder(order.id), "submitted", "PO submitted for approval")}
                  >
                    <SendIcon className="w-3.5 h-3.5" />
                    {actioning === "submit" ? "Submitting…" : "Submit for Approval"}
                  </Button>
                )}
                {can("purchase-order:approve") && (
                  <Button
                    size="sm" className="w-full gap-1.5 h-8 text-xs" disabled={!!actioning}
                    onClick={() => act("reconfirm", () => reconfirmPurchaseOrder(order.id), "confirmed", "Purchase order re-confirmed")}
                  >
                    <CheckIcon className="w-3.5 h-3.5" />
                    {actioning === "reconfirm" ? "Re-confirming…" : "Re-confirm PO"}
                  </Button>
                )}
              </div>
            </section>
          )}

          {isConfirmed && (
            <section className="border border-border rounded-xl p-4">
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Actions</h2>
              <div className="flex flex-col gap-2">
                {can("goods-receipt:create") && (
                  <Button
                    size="sm" className="w-full gap-1.5 h-8 text-xs" disabled={!!actioning}
                    onClick={() => router.push(`/dashboard/procurement/purchase-order/${order.id}/goods-receipt/create`)}
                  >
                    <TruckIcon className="w-3.5 h-3.5" /> Record Goods Receipt
                  </Button>
                )}
                {can("purchase-order:update") && (
                  <Button
                    size="sm" variant="outline" className="w-full gap-1.5 h-8 text-xs" disabled={!!actioning}
                    onClick={() => act("fulfill", () => fulfillPurchaseOrder(order.id), "fulfilled", "Purchase order closed")}
                  >
                    <ArchiveIcon className="w-3.5 h-3.5" />
                    {actioning === "fulfill" ? "Closing…" : "Close PO (no GR)"}
                  </Button>
                )}
                {can("purchase-order:approve") && (
                  <Button
                    size="sm" variant="outline" className="w-full gap-1.5 h-8 text-xs" disabled={!!actioning}
                    onClick={() => act("recall", () => recallPurchaseOrder(order.id), "draft", "Purchase order recalled")}
                  >
                    <RotateCcwIcon className="w-3.5 h-3.5" />
                    {actioning === "recall" ? "Recalling…" : "Recall PO"}
                  </Button>
                )}
                {can("purchase-order:approve") && (
                  <Button
                    size="sm" variant="outline"
                    className="w-full gap-1.5 h-8 text-xs text-destructive hover:text-destructive border-destructive/30"
                    disabled={!!actioning}
                    onClick={() => act("cancel", () => cancelPurchaseOrder(order.id), "cancelled", "Purchase order cancelled")}
                  >
                    <XIcon className="w-3.5 h-3.5" />
                    {actioning === "cancel" ? "Cancelling…" : "Cancel PO"}
                  </Button>
                )}
              </div>
            </section>
          )}

          {!hidePricing && (
            <section className="border border-border rounded-xl p-4">
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Pricing</h2>
              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span className="tabular-nums">{fmt(order.subtotal, order.currency)}</span>
                </div>
                {parseFloat(order.sstPct ?? "0") > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">SST ({order.sstPct}%)</span>
                    <span className="tabular-nums">{fmt(order.sst, order.currency)}</span>
                  </div>
                )}
                <div className="flex justify-between font-semibold border-t border-border pt-2 mt-2">
                  <span>Grand Total</span>
                  <span className="tabular-nums">{fmt(order.grandTotal, order.currency)}</span>
                </div>
              </div>
            </section>
          )}

          <section className="border border-border rounded-xl p-4 space-y-2.5">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Details</h2>

            {order.poNo && (
              <div className="flex items-start gap-2">
                <TruckIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                <div>
                  <p className="text-[10px] text-muted-foreground">PO Number</p>
                  <p className="text-xs font-mono">{order.poNo}</p>
                </div>
              </div>
            )}
            {order.prNo && (
              <div className="flex items-start gap-2">
                <ClipboardListIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                <div>
                  <p className="text-[10px] text-muted-foreground">Source Requisition</p>
                  {order.purchaseRequisitionId ? (
                    <button
                      className="text-xs font-mono text-blue-600 dark:text-blue-400 hover:underline"
                      onClick={() => router.push(`/dashboard/procurement/requisition/${order.purchaseRequisitionId}`)}
                    >
                      {order.prNo}
                    </button>
                  ) : (
                    <p className="text-xs font-mono">{order.prNo}</p>
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
            {order.salesOrderNo && (
              <div className="flex items-start gap-2">
                <LinkIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                <div>
                  <p className="text-[10px] text-muted-foreground">Linked SO</p>
                  <button
                    className="text-xs font-mono text-blue-600 dark:text-blue-400 hover:underline"
                    onClick={() => router.push(`/dashboard/sales/order/${order.salesOrderId}`)}
                  >
                    {order.salesOrderNo}
                  </button>
                </div>
              </div>
            )}
            {order.customerPos.length > 0 && (
              <div className="flex items-start gap-2">
                <PackageIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                <div>
                  <p className="text-[10px] text-muted-foreground">Customer POs</p>
                  <div className="flex flex-wrap gap-1 mt-0.5">
                    {order.customerPos.map((cpo) => (
                      <span key={cpo.id} className="text-xs font-mono bg-muted/50 rounded px-1.5 py-0.5">{cpo.customerPoNo}</span>
                    ))}
                  </div>
                </div>
              </div>
            )}
            {order.expectedDeliveryDate && (
              <div className="flex items-start gap-2">
                <CalendarIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                <div>
                  <p className="text-[10px] text-muted-foreground">Expected Delivery</p>
                  <p className="text-xs">{fmtDate(order.expectedDeliveryDate)}</p>
                </div>
              </div>
            )}

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
                  <BuildingIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                  <div>
                    <p className="text-[10px] text-muted-foreground">Prepared by</p>
                    <p className="text-xs">{order.createdByName}</p>
                  </div>
                </div>
              )}
              {order.approvedAt && (
                <div className="flex items-start gap-2">
                  <CheckIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                  <div>
                    <p className="text-[10px] text-muted-foreground">Approved</p>
                    <p className="text-xs">{fmtDate(order.approvedAt)}</p>
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
