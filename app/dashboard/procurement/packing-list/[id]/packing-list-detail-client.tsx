"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { cancelPackingList, deletePackingList, type PackingListWithItems } from "@/server/packing-list";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import {
  ArrowLeftIcon, BuildingIcon, CalendarIcon, ClipboardCheckIcon,
  XIcon, TruckIcon, LinkIcon, DatabaseIcon, PencilIcon, ClipboardListIcon, PlusIcon, TagIcon, Trash2Icon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

const R2_PRODUCT_IMAGES = process.env.NEXT_PUBLIC_R2_PRODUCT_IMAGES_URL ?? "";

const PO_COLORS = [
  { bg: "bg-blue-50/50 dark:bg-blue-950/15", header: "bg-blue-100/70 dark:bg-blue-900/30", border: "border-blue-200 dark:border-blue-800/50", stripe: "bg-blue-100/60 dark:bg-blue-900/25" },
  { bg: "bg-green-50/50 dark:bg-green-950/15", header: "bg-green-100/70 dark:bg-green-900/30", border: "border-green-200 dark:border-green-800/50", stripe: "bg-green-100/60 dark:bg-green-900/25" },
  { bg: "bg-amber-50/50 dark:bg-amber-950/15", header: "bg-amber-100/70 dark:bg-amber-900/30", border: "border-amber-200 dark:border-amber-800/50", stripe: "bg-amber-100/60 dark:bg-amber-900/25" },
  { bg: "bg-purple-50/50 dark:bg-purple-950/15", header: "bg-purple-100/70 dark:bg-purple-900/30", border: "border-purple-200 dark:border-purple-800/50", stripe: "bg-purple-100/60 dark:bg-purple-900/25" },
  { bg: "bg-pink-50/50 dark:bg-pink-950/15", header: "bg-pink-100/70 dark:bg-pink-900/30", border: "border-pink-200 dark:border-pink-800/50", stripe: "bg-pink-100/60 dark:bg-pink-900/25" },
  { bg: "bg-teal-50/50 dark:bg-teal-950/15", header: "bg-teal-100/70 dark:bg-teal-900/30", border: "border-teal-200 dark:border-teal-800/50", stripe: "bg-teal-100/60 dark:bg-teal-900/25" },
] as const;

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

const fmtDate = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const STATUS: Record<string, { label: string; className: string }> = {
  pending:   { label: "Pending Inspection", className: "bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400" },
  completed: { label: "Completed",          className: "bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400" },
  cancelled: { label: "Cancelled",          className: "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400" },
};

interface Props {
  packingList: PackingListWithItems;
  permissions: string[];
  businessType?: string;
  backHref?: string;
  // Shown alongside the packing list when viewed from the centralized
  // (cross-org) list, so it's clear which org this record actually belongs to.
  organizationName?: string;
  // Overrides where "Start Inspection" goes — the centralized detail page
  // points this at its own cross-org inspect route instead of the plain one.
  inspectHref?: string;
}

export function PackingListDetailClient({
  packingList: pl, permissions, businessType = "trading",
  backHref = "/dashboard/procurement/packing-list",
  organizationName,
  inspectHref,
}: Props) {
  const router = useRouter();
  const [cancelling, setCancelling] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const can = (p: string) => permissions.includes("*") || permissions.includes(p);
  const isOwner = permissions.includes("*");
  const showSourcing = businessType !== "trading";
  const status = STATUS[pl.status] ?? { label: pl.status, className: "bg-muted text-muted-foreground" };
  const snap = pl.supplierSnapshot as { name?: string; address?: string; contactPerson?: string; contactNo?: string; email?: string } | null;
  const isPending = pl.status === "pending";

  const byPo = pl.items.reduce<Record<string, typeof pl.items>>((acc, item) => {
    (acc[item.purchaseOrderId] ??= []).push(item);
    return acc;
  }, {});
  const poLabel = (poId: string) => {
    const po = pl.purchaseOrders.find((p) => p.id === poId);
    return po?.poNo ?? po?.prNo ?? poId;
  };

  async function handleCancel() {
    if (!confirm("Cancel this packing list? This can't be undone.")) return;
    setCancelling(true);
    try {
      await cancelPackingList(pl.id);
      toast.success("Packing list cancelled");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setCancelling(false);
    }
  }

  async function handleDelete() {
    if (!confirm(`Permanently delete ${pl.packingListNo}? This removes the record entirely and can't be undone.`)) return;
    setDeleting(true);
    try {
      await deletePackingList(pl.id);
      toast.success("Packing list deleted");
      router.push(backHref);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
      setDeleting(false);
    }
  }

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title={pl.packingListNo}
        description={`Packing List${organizationName ? ` · ${organizationName}` : ""} · ${fmtDate(pl.createdAt)}`}
        action={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => router.push(backHref)} className="gap-1.5">
              <ArrowLeftIcon className="w-3.5 h-3.5" /> Back
            </Button>
            {isPending && can("packing-list:inspect") && (
              <Button size="sm" className="gap-1.5" onClick={() => router.push(inspectHref ?? `/dashboard/procurement/packing-list/${pl.id}/inspect`)}>
                <ClipboardCheckIcon className="w-3.5 h-3.5" /> Start Inspection
              </Button>
            )}
            {isPending && can("packing-list:create") && (
              <Button size="sm" variant="outline" className="gap-1.5 text-destructive hover:text-destructive" disabled={cancelling} onClick={handleCancel}>
                <XIcon className="w-3.5 h-3.5" /> Cancel
              </Button>
            )}
            {isOwner && pl.status !== "completed" && (
              <Button size="sm" variant="outline" className="gap-1.5 text-destructive hover:text-destructive" disabled={deleting} onClick={handleDelete}>
                <Trash2Icon className="w-3.5 h-3.5" /> Delete
              </Button>
            )}
            <span className={cn("text-[11px] font-medium rounded px-2 py-0.5", status.className)}>{status.label}</span>
          </div>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-5">
          <section className="border border-border rounded-xl p-4">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              Expected Items <span className="font-normal">({pl.items.length})</span>
            </h2>
            {pl.items.length === 0 ? (
              <p className="text-sm text-muted-foreground">No items</p>
            ) : (
              <div className="space-y-4">
                {Object.entries(byPo).map(([poId, items], poIndex) => {
                  const color = PO_COLORS[poIndex % PO_COLORS.length];
                  return (
                  <div key={poId} className={cn("border rounded-lg overflow-hidden", color.border, color.bg)}>
                    <button
                      className={cn("w-full text-left px-3 py-1.5 text-[11px] font-mono font-medium text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1", color.header)}
                      onClick={() => router.push(`/dashboard/procurement/purchase-order/${poId}`)}
                    >
                      {poLabel(poId)} <LinkIcon className="w-2.5 h-2.5 shrink-0" />
                    </button>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-t border-border/40 text-muted-foreground">
                            <th className="text-right py-1.5 pl-3 pr-2 font-medium w-8">#</th>
                            {showSourcing && (
                              <>
                                <th className="text-left py-1.5 pr-3 font-medium w-28">Design Brand</th>
                                <th className="text-left py-1.5 pr-3 font-medium w-24">Design Code</th>
                              </>
                            )}
                            <th className="text-left py-1.5 pr-3 font-medium w-24">Emboss Code</th>
                            <th className="text-left py-1.5 pr-3 font-medium">Description</th>
                            <th className="text-left py-1.5 pr-3 font-medium w-10">Img</th>
                            <th className="text-right py-1.5 pr-3 font-medium w-24">Qty Expected</th>
                            <th className="text-left py-1.5 pr-3 font-medium w-12">UOM</th>
                          </tr>
                        </thead>
                        <tbody>
                          {items.map((item, itemIndex) => (
                            <tr key={item.id} className={cn("border-t border-border/40 align-top", itemIndex % 2 === 1 && color.stripe)}>
                              <td className="py-2 pl-3 pr-2 text-right text-muted-foreground/70 tabular-nums align-top">{itemIndex + 1}</td>
                              {showSourcing && (
                                <>
                                  <td className="py-2 pl-3 pr-3 align-top">
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
                                    ) : "—"}
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
                                  {showSourcing && item.sourcingType === "oem" && (
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
                              <td className="py-2 pr-3 align-top text-right tabular-nums">{item.qtyExpected}</td>
                              <td className="py-2 pr-3 align-top text-muted-foreground">{item.uom || "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  );
                })}
              </div>
            )}
          </section>

          {pl.notes && (
            <section className="border border-border rounded-xl p-4">
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Notes</h2>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{pl.notes}</p>
            </section>
          )}

          {pl.goodsReceipts.length > 0 && (
            <section className="border border-border rounded-xl p-4">
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                Goods Receipts <span className="font-normal">({pl.goodsReceipts.length})</span>
              </h2>
              <div className="space-y-2">
                {pl.goodsReceipts.map((gr) => (
                  <button
                    key={gr.id}
                    className="w-full flex items-center gap-2 border border-border/60 rounded-lg px-3 py-2 text-xs hover:bg-muted/20 transition-colors text-left"
                    onClick={() => router.push(`/dashboard/procurement/purchase-order/${gr.purchaseOrderId}/goods-receipt/${gr.id}`)}
                  >
                    <TruckIcon className="w-3.5 h-3.5 text-green-600 dark:text-green-400 shrink-0" />
                    <span className="font-mono font-medium">{gr.grNo}</span>
                    <span className="text-muted-foreground">against {gr.poNo ?? gr.purchaseOrderId}</span>
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>

        <div className="space-y-5">
          <section className="border border-border rounded-xl p-4 space-y-3">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Details</h2>
            <div className="flex items-start gap-2">
              <BuildingIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
              <div>
                <p className="text-[10px] text-muted-foreground">Supplier</p>
                <p className="text-xs font-medium">{snap?.name ?? "—"}</p>
                {snap?.contactPerson && <p className="text-xs text-muted-foreground">{snap.contactPerson}</p>}
              </div>
            </div>
            {pl.supplierRefNo && (
              <div className="flex items-start gap-2">
                <ClipboardCheckIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                <div>
                  <p className="text-[10px] text-muted-foreground">Supplier&apos;s Ref No.</p>
                  <p className="text-xs font-mono">{pl.supplierRefNo}</p>
                </div>
              </div>
            )}
            {pl.expectedDate && (
              <div className="flex items-start gap-2">
                <CalendarIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                <div>
                  <p className="text-[10px] text-muted-foreground">Expected Date</p>
                  <p className="text-xs">{fmtDate(pl.expectedDate)}</p>
                </div>
              </div>
            )}
            {pl.createdByName && (
              <div className="flex items-start gap-2">
                <BuildingIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                <div>
                  <p className="text-[10px] text-muted-foreground">Created by</p>
                  <p className="text-xs">{pl.createdByName}</p>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
