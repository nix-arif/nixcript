"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  createPackingList,
  getPackableItemsForSupplier,
  getSupplierOutstandingIssues,
  type PackableSupplier,
  type PackableItem,
  type PackingListItemInput,
  type SupplierOutstandingIssue,
} from "@/server/packing-list";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/page-header";
import {
  ArrowLeftIcon, ClipboardCheckIcon, DatabaseIcon, PencilIcon,
  ClipboardListIcon, PlusIcon, TagIcon, LinkIcon, XIcon, AlertTriangleIcon,
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

interface Props {
  suppliers: PackableSupplier[];
  initialSupplierId?: string;
  initialPurchaseOrderIds?: string[];
  businessType?: string;
}

export function CreatePackingListClient({ suppliers, initialSupplierId, initialPurchaseOrderIds, businessType = "trading" }: Props) {
  const router = useRouter();
  const showSourcing = businessType !== "trading";
  const [supplierId, setSupplierId] = useState(initialSupplierId ?? "");
  const [allItems, setAllItems] = useState<PackableItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [outstandingIssues, setOutstandingIssues] = useState<SupplierOutstandingIssue[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [qtys, setQtys] = useState<Record<string, string>>({});
  const [supplierRefNo, setSupplierRefNo] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [poFilterActive, setPoFilterActive] = useState(!!initialPurchaseOrderIds?.length);

  const hasPoScope = !!(initialPurchaseOrderIds?.length && supplierId === initialSupplierId);

  useEffect(() => {
    if (!supplierId) { setAllItems([]); setSelected({}); setQtys({}); setOutstandingIssues([]); return; }
    setLoadingItems(true);
    const scopedPoIds = supplierId === initialSupplierId ? initialPurchaseOrderIds : undefined;
    getPackableItemsForSupplier(supplierId)
      .then((rows) => {
        setAllItems(rows);
        const preChecked = scopedPoIds?.length ? rows.filter((r) => scopedPoIds.includes(r.purchaseOrderId)) : [];
        setSelected(Object.fromEntries(preChecked.map((r) => [r.purchaseOrderItemId, true])));
        setQtys(Object.fromEntries(rows.map((r) => [r.purchaseOrderItemId, String(r.qtyRemaining)])));
      })
      .finally(() => setLoadingItems(false));
    getSupplierOutstandingIssues(supplierId).then(setOutstandingIssues);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplierId]);

  const items = poFilterActive && hasPoScope
    ? allItems.filter((i) => initialPurchaseOrderIds!.includes(i.purchaseOrderId))
    : allItems;

  const byPo = items.reduce<Record<string, PackableItem[]>>((acc, item) => {
    (acc[item.purchaseOrderId] ??= []).push(item);
    return acc;
  }, {});

  function toggle(itemId: string) {
    setSelected((prev) => ({ ...prev, [itemId]: !prev[itemId] }));
  }

  function toggleAllInPo(poItems: PackableItem[]) {
    const allSelected = poItems.every((i) => selected[i.purchaseOrderItemId]);
    setSelected((prev) => {
      const next = { ...prev };
      poItems.forEach((i) => { next[i.purchaseOrderItemId] = !allSelected; });
      return next;
    });
  }

  const selectedCount = Object.values(selected).filter(Boolean).length;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!supplierId) { toast.error("Select a supplier"); return; }

    const chosen = items.filter((i) => selected[i.purchaseOrderItemId]);
    if (chosen.length === 0) { toast.error("Select at least one item"); return; }

    for (const item of chosen) {
      const qty = parseFloat(qtys[item.purchaseOrderItemId] ?? "0");
      if (!(qty > 0) || qty > item.qtyRemaining + 1e-9) {
        toast.error(`Quantity for ${item.productCode ?? "an item"} must be between 0 and ${item.qtyRemaining}`);
        return;
      }
    }

    const payloadItems: PackingListItemInput[] = chosen.map((item) => ({
      purchaseOrderId: item.purchaseOrderId,
      purchaseOrderItemId: item.purchaseOrderItemId,
      productId: item.productId ?? undefined,
      productCode: item.productCode ?? undefined,
      description: item.description ?? undefined,
      qtyExpected: qtys[item.purchaseOrderItemId],
      uom: item.uom ?? undefined,
      unitPrice: item.unitPrice ?? undefined,
      currency: item.currency ?? undefined,
      sourcingType: item.sourcingType ?? undefined,
      designBrandName: item.designBrandName ?? undefined,
      designBrandCode: item.designBrandCode ?? undefined,
      privateLabelCode: item.privateLabelCode ?? undefined,
      imageKey: item.imageKey ?? undefined,
      designBrandSource: item.designBrandSource ?? undefined,
      privateLabelSource: item.privateLabelSource ?? undefined,
      oemEditedBy: item.oemEditedBy ?? undefined,
      descriptionSource: item.descriptionSource ?? undefined,
      isAdditional: item.isAdditional,
      editedBy: item.editedBy ?? undefined,
      setGroupId: item.setGroupId ?? undefined,
      setGroupLabel: item.setGroupLabel ?? undefined,
      customerId: item.customerId ?? undefined,
      customerOrganizationId: item.customerOrganizationId ?? undefined,
      customerName: item.customerName ?? undefined,
      customerOrganization: item.customerOrganization ?? undefined,
      customerPoNo: item.customerPoNo ?? undefined,
    }));

    setSaving(true);
    try {
      const pl = await createPackingList({
        supplierId,
        supplierRefNo: supplierRefNo || undefined,
        expectedDate: expectedDate ? new Date(expectedDate) : undefined,
        notes: notes || undefined,
        items: payloadItems,
      });
      toast.success(`Packing list ${pl.packingListNo} created`);
      router.push(`/dashboard/procurement/packing-list/${pl.id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
      setSaving(false);
    }
  }

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="New Packing List"
        description="What a supplier says they're shipping, before it physically arrives"
        action={
          <Button variant="outline" size="sm" onClick={() => router.push("/dashboard/procurement/packing-list")} className="gap-1.5">
            <ArrowLeftIcon className="w-3.5 h-3.5" /> Back
          </Button>
        }
      />

      <form onSubmit={handleSubmit} className="space-y-5">
        <section className="border border-border rounded-xl p-4 space-y-4 max-w-3xl">
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Details</h2>
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Supplier <span className="text-destructive">*</span></label>
            {suppliers.length === 0 ? (
              <p className="text-sm text-muted-foreground">No suppliers with confirmed purchase orders.</p>
            ) : (
              <select
                className={cn(
                  "w-full h-9 rounded-md border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring",
                  !supplierId ? "border-destructive/50" : "border-border",
                )}
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
              >
                <option value="">— Select supplier —</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>{s.name} ({s.poCount} confirmed PO{s.poCount !== 1 ? "s" : ""})</option>
                ))}
              </select>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Supplier&apos;s Packing List No.</label>
              <Input value={supplierRefNo} onChange={(e) => setSupplierRefNo(e.target.value)} placeholder="Their own reference, if any" className="h-9 text-sm" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Expected Date</label>
              <Input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} className="h-9 text-sm" />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Notes</label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Shipping details, courier tracking no…" className="text-sm resize-none" rows={2} />
          </div>
        </section>

        {supplierId && outstandingIssues.length > 0 && (
          <div className="border border-amber-200 dark:border-amber-800/50 bg-amber-50/50 dark:bg-amber-950/15 rounded-xl p-4">
            <div className="flex items-center gap-1.5 mb-2">
              <AlertTriangleIcon className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
              <h2 className="text-xs font-semibold text-amber-800 dark:text-amber-300 uppercase tracking-wide">
                Outstanding issues from this supplier
              </h2>
            </div>
            <p className="text-xs text-amber-700 dark:text-amber-400 mb-2">
              These packing lists had short-received or returned items — if this new shipment resolves them, the missing quantity already shows up as remaining to pack below.
            </p>
            <div className="flex flex-wrap gap-2">
              {outstandingIssues.map((issue) => (
                <button
                  key={issue.packingListId}
                  type="button"
                  onClick={() => window.open(`/dashboard/procurement/packing-list/${issue.packingListId}`, "_blank")}
                  className="inline-flex items-center gap-1.5 text-[11px] font-mono font-medium px-2 py-1 rounded-md bg-background border border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-300 hover:bg-amber-100/50 dark:hover:bg-amber-900/30 transition-colors"
                >
                  {issue.packingListNo}
                  <span className="font-sans font-normal text-amber-600 dark:text-amber-500">
                    {issue.itemCount} item{issue.itemCount !== 1 ? "s" : ""}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {supplierId && (
          <section className="border border-border rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Items to Include {selectedCount > 0 && <span className="font-normal">({selectedCount} selected)</span>}
              </h2>
            </div>
            {poFilterActive && hasPoScope && (
              <div className="flex items-center justify-between gap-2 mb-3 text-[11px] text-muted-foreground bg-muted/40 rounded-md px-3 py-1.5">
                <span>
                  Showing items from {initialPurchaseOrderIds!.length} selected PO{initialPurchaseOrderIds!.length !== 1 ? "s" : ""} only.
                </span>
                <button
                  type="button"
                  className="underline hover:text-foreground shrink-0"
                  onClick={() => setPoFilterActive(false)}
                >
                  Show all confirmed POs for this supplier
                </button>
              </div>
            )}
            {loadingItems ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : items.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing left to pack for this supplier — every confirmed PO item is already fully packed or received.</p>
            ) : (
              <div className="space-y-4">
                {Object.entries(byPo).map(([poId, poItems], poIndex) => {
                  const first = poItems[0];
                  const color = PO_COLORS[poIndex % PO_COLORS.length];
                  const allChecked = poItems.every((i) => selected[i.purchaseOrderItemId]);
                  const someChecked = !allChecked && poItems.some((i) => selected[i.purchaseOrderItemId]);
                  return (
                    <div key={poId} className={cn("border rounded-lg overflow-hidden", color.border, color.bg)}>
                      <label className={cn("px-3 py-1.5 text-[11px] font-mono font-medium text-muted-foreground flex items-center gap-2 cursor-pointer select-none", color.header)}>
                        <input
                          type="checkbox"
                          checked={allChecked}
                          ref={(el) => { if (el) el.indeterminate = someChecked; }}
                          onChange={() => toggleAllInPo(poItems)}
                        />
                        {first.poNo ?? first.prNo ?? poId}
                        <span className="font-sans font-normal normal-case text-muted-foreground/70">
                          {poItems.filter((i) => selected[i.purchaseOrderItemId]).length}/{poItems.length} selected
                        </span>
                      </label>
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-muted-foreground">
                            <th className="w-6" />
                            {showSourcing && (
                              <>
                                <th className="text-left py-1 pr-3 font-medium w-24">Design Brand</th>
                                <th className="text-left py-1 pr-3 font-medium w-24">Design Code</th>
                              </>
                            )}
                            <th className="text-left py-1 pr-3 font-medium w-20">Emboss Code</th>
                            <th className="text-left py-1 pr-3 font-medium">Description</th>
                            <th className="text-left py-1 pr-3 font-medium w-10">Img</th>
                            <th className="text-right py-1 pr-3 font-medium w-28">Remaining</th>
                            <th className="text-left py-1 pr-3 font-medium w-24">Qty to Pack</th>
                          </tr>
                        </thead>
                        <tbody>
                          {poItems.map((item, itemIndex) => {
                            const checked = !!selected[item.purchaseOrderItemId];
                            return (
                              <tr key={item.purchaseOrderItemId} className={cn("border-t border-border/40 first:border-t-0 align-top", itemIndex % 2 === 1 && color.stripe)}>
                                <td className="py-2 pl-3 pr-2 w-6">
                                  <input type="checkbox" checked={checked} onChange={() => toggle(item.purchaseOrderItemId)} />
                                </td>
                                {showSourcing && (
                                  <>
                                    <td className="py-2 pr-3 align-top">
                                      {item.designBrandName?.trim() ? (
                                        <div className="flex flex-col gap-0.5">
                                          <span className="text-muted-foreground">{item.designBrandName}</span>
                                          {item.designBrandSource === "catalog" ? (
                                            <span className="inline-flex items-center gap-1 w-fit text-[9px] px-1.5 py-0.5 rounded-md bg-blue-50 text-blue-600 border border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800">
                                              <DatabaseIcon className="w-2.5 h-2.5 shrink-0" />from catalogue
                                            </span>
                                          ) : item.designBrandSource === "user" && (
                                            <span className="inline-flex items-center gap-1 w-fit text-[9px] px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800">
                                              <PencilIcon className="w-2.5 h-2.5 shrink-0" />{item.oemEditedBy ? `${item.oemEditedBy} edited SPO` : "edited SPO"}
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
                                          <span className="inline-flex items-center gap-1 w-fit text-[9px] px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800">
                                            <PencilIcon className="w-2.5 h-2.5 shrink-0" />{item.oemEditedBy ? `${item.oemEditedBy} edited SPO` : "edited SPO"}
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
                                        "inline-block w-fit text-[9px] px-1.5 py-0.5 rounded-md border font-medium",
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
                                          <span className="font-mono text-[9px] text-muted-foreground">Emboss: {item.privateLabelCode}</span>
                                          {item.privateLabelSource === "catalog" ? (
                                            <span className="inline-flex items-center gap-1 w-fit text-[9px] px-1.5 py-0.5 rounded-md bg-blue-50 text-blue-600 border border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800">
                                              <DatabaseIcon className="w-2.5 h-2.5 shrink-0" />from catalogue
                                            </span>
                                          ) : item.privateLabelSource === "auto" ? (
                                            <span className="inline-flex items-center gap-1 w-fit text-[9px] px-1.5 py-0.5 rounded-md bg-blue-50 text-blue-600 border border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800">
                                              <LinkIcon className="w-2.5 h-2.5 shrink-0" />from Code
                                            </span>
                                          ) : item.privateLabelSource === "user" && (
                                            <span className="inline-flex items-center gap-1 w-fit text-[9px] px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800">
                                              <PencilIcon className="w-2.5 h-2.5 shrink-0" />{item.oemEditedBy ? `${item.oemEditedBy} edited SPO` : "edited SPO"}
                                            </span>
                                          )}
                                        </div>
                                      ) : !item.privateLabelCode?.trim() ? (
                                        <span className="text-[9px] text-destructive">emboss code missing</span>
                                      ) : null
                                    )}
                                  </div>
                                </td>
                                <td className="py-2 pr-3">
                                  {(item.setGroupLabel || item.customerPoNo || item.customerOrganization || item.customerName) && (
                                    <div className="flex flex-wrap gap-1 mb-1">
                                      {item.setGroupLabel && (
                                        <span className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-md bg-teal-50 dark:bg-teal-900/20 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-800">
                                          <TagIcon className="w-2.5 h-2.5 shrink-0" />{item.setGroupLabel}
                                        </span>
                                      )}
                                      {item.customerPoNo && (
                                        <span className="inline-flex items-center text-[9px] font-mono font-medium px-1.5 py-0.5 rounded-md border bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800">
                                          {item.customerPoNo}
                                        </span>
                                      )}
                                      {item.customerOrganization && (
                                        <span className="inline-flex items-center text-[9px] px-1.5 py-0.5 rounded-md bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-300 border border-violet-200 dark:border-violet-800">
                                          {item.customerOrganization}
                                        </span>
                                      )}
                                      {item.customerName && (
                                        <span className="inline-flex items-center text-[9px] px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground border border-border/60">
                                          {item.customerName}
                                        </span>
                                      )}
                                    </div>
                                  )}
                                  {item.description || "—"}
                                  {item.descriptionSource === "product" && (
                                    <span className="flex items-center gap-1 w-fit mt-0.5 text-[9px] px-1.5 py-0.5 rounded-md bg-blue-50 text-blue-600 border border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800">
                                      <DatabaseIcon className="w-2.5 h-2.5 shrink-0" />from catalogue
                                    </span>
                                  )}
                                  {item.descriptionSource === "pr" && (
                                    <span className="flex items-center gap-1 w-fit mt-0.5 text-[9px] px-1.5 py-0.5 rounded-md bg-green-50 text-green-700 border border-green-200 dark:bg-green-950/40 dark:text-green-400 dark:border-green-800">
                                      <ClipboardListIcon className="w-2.5 h-2.5 shrink-0" />from purchase requisition
                                    </span>
                                  )}
                                  {item.isAdditional && (
                                    <span className="flex items-center gap-1 w-fit mt-0.5 text-[9px] px-1.5 py-0.5 rounded-md bg-purple-50 text-purple-700 border border-purple-200 dark:bg-purple-950/40 dark:text-purple-400 dark:border-purple-800">
                                      <PlusIcon className="w-2.5 h-2.5 shrink-0" />additional row
                                    </span>
                                  )}
                                  {item.editedBy && (
                                    <span className="flex items-center gap-1 w-fit mt-0.5 text-[9px] px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800">
                                      <PencilIcon className="w-2.5 h-2.5 shrink-0" />{item.editedBy} edited SPO
                                    </span>
                                  )}
                                </td>
                                <td className="py-2 pr-3 align-top">
                                  <ItemImageThumb imageUrl={item.imageUrl} productCode={item.productCode} />
                                </td>
                                <td className="py-2 pr-3 text-right text-muted-foreground w-28 whitespace-nowrap align-top">
                                  {item.qtyRemaining} {item.uom || ""} remaining
                                </td>
                                <td className="py-2 pr-3 w-24 align-top">
                                  <Input
                                    type="number"
                                    min="0"
                                    max={item.qtyRemaining}
                                    step="any"
                                    disabled={!checked}
                                    value={qtys[item.purchaseOrderItemId] ?? ""}
                                    onChange={(e) => setQtys((prev) => ({ ...prev, [item.purchaseOrderItemId]: e.target.value }))}
                                    className="h-7 text-xs text-right tabular-nums disabled:opacity-40"
                                  />
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}

        <div className="flex gap-3">
          <Button type="submit" disabled={saving || !supplierId} className="gap-1.5">
            <ClipboardCheckIcon className="w-3.5 h-3.5" />
            {saving ? "Saving…" : "Create Packing List"}
          </Button>
          <Button type="button" variant="outline" onClick={() => router.push("/dashboard/procurement/packing-list")}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
