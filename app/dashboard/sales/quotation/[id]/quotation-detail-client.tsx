"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  finalizeQuotation,
  deleteQuotation,
  getQuotationDetail,
} from "@/server/quotation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ArrowLeftIcon,
  AlertCircleIcon,
  CheckIcon,
  TrashIcon,
  BuildingIcon,
  UserIcon,
  CalendarIcon,
  FileTextIcon,
  ShieldCheckIcon,
  ImageIcon,
  PrinterIcon,
  PencilIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Data = NonNullable<Awaited<ReturnType<typeof getQuotationDetail>>>;

interface Props {
  data: Data;
}

const fmt = (v: string | number | null | undefined) =>
  `RM ${Number(v ?? 0).toLocaleString("en-MY", { minimumFractionDigits: 2 })}`;

const fmtDate = (d: Date | string | null | undefined) => {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-MY", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

const STATUS = {
  draft: {
    label: "Draft",
    className:
      "bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800",
  },
  final: {
    label: "Final",
    className:
      "bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800",
  },
};

type MarkupRow = {
  id: string;
  quotationNo: string;
  orgName: string;
  isDummy: number;
  grandTotal: string;
  markupPct: string;
};

function generateRandomMarkups(siblings: Data["siblings"]): MarkupRow[] {
  let min = 5;
  return siblings.map((s) => {
    if (s.isDummy === 0) {
      return { ...s, markupPct: "0" };
    }
    const max = Math.min(min + 15, 50);
    const markup = Math.floor(Math.random() * (max - min + 1)) + min;
    min = markup + 3;
    return { ...s, markupPct: String(markup) };
  });
}

export function QuotationDetailClient({ data }: Props) {
  const router = useRouter();
  const { quotation: q, orgName, items, siblings } = data;
  const cust = q.customerSnapshot as any;

  const [finalizing, setFinalizing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfGroupLoading, setPdfGroupLoading] = useState(false);
  const [pdfGroupProgress, setPdfGroupProgress] = useState("");
  const [showFinalizeDialog, setShowFinalizeDialog] = useState(false);
  const [markupRows, setMarkupRows] = useState<MarkupRow[]>([]);

  // Pre-fetch all sibling pages so tab switches feel instant
  useEffect(() => {
    siblings.forEach((s) => {
      if (s.id !== q.id) router.prefetch(`/dashboard/sales/quotation/${s.id}`);
    });
  }, [siblings, q.id, router]);

  const isDraft = q.status === "draft";
  const isComparison = q.mode === "comparison";
  const statusCfg = STATUS[q.status as keyof typeof STATUS] ?? STATUS.draft;

  const handleFinalizeClick = () => {
    if (!isComparison || siblings.length === 0) {
      if (!confirm("Finalize this quotation? This cannot be undone.")) return;
      doFinalize({});
      return;
    }
    setMarkupRows(generateRandomMarkups(siblings));
    setShowFinalizeDialog(true);
  };

  const doFinalize = async (markups: Record<string, number>) => {
    setFinalizing(true);
    try {
      await finalizeQuotation(q.id, markups);
      toast.success("Quotation finalized");
      setShowFinalizeDialog(false);
      router.refresh();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setFinalizing(false);
    }
  };

  const downloadPdf = async (url: string, filename: string, setLoading: (v: boolean) => void) => {
    setLoading(true);
    try {
      const res = await fetch(url);
      if (!res.ok) { toast.error("Failed to generate PDF"); return; }
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
    } catch {
      toast.error("Failed to generate PDF");
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadAll = async () => {
    setPdfGroupLoading(true);
    try {
      for (let i = 0; i < siblings.length; i++) {
        const s = siblings[i];
        setPdfGroupProgress(`${i + 1}/${siblings.length}`);
        const res = await fetch(`/api/quotation/${s.id}/pdf`);
        if (!res.ok) { toast.error(`Failed: ${s.quotationNo}`); continue; }
        const blob = await res.blob();
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `${s.quotationNo}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href);
      }
    } catch {
      toast.error("Failed to generate PDFs");
    } finally {
      setPdfGroupLoading(false);
      setPdfGroupProgress("");
    }
  };

  const handleConfirmFinalize = () => {
    const markups: Record<string, number> = {};
    const dummies = markupRows.filter((r) => r.isDummy > 0);
    const pcts = dummies.map((r) => parseFloat(r.markupPct) || 0);

    if (pcts.some((p) => p <= 0)) {
      toast.error("All dummy markups must be greater than 0%");
      return;
    }
    const unique = new Set(pcts);
    if (unique.size < pcts.length) {
      toast.error("Each dummy quotation must have a unique markup %");
      return;
    }
    for (const row of dummies) {
      markups[row.id] = parseFloat(row.markupPct) || 0;
    }
    doFinalize(markups);
  };

  const handleDelete = async () => {
    const msg = isComparison
      ? "Delete this entire comparison group? All linked quotations will be removed."
      : "Delete this quotation?";
    if (!confirm(msg)) return;
    setDeleting(true);
    try {
      await deleteQuotation(q.id);
      toast.success("Quotation deleted");
      router.push("/dashboard/sales/quotation");
    } catch (e: any) {
      toast.error(e.message);
      setDeleting(false);
    }
  };

  // Pricing
  const subtotal = Number(q.subtotal ?? 0);
  const overallDiscAmt = Number(q.overallDiscountAmt ?? 0);
  const sstAmt = Number(q.sst ?? 0);
  const grandTotal = Number(q.grandTotal ?? 0);
  const afterDiscount = subtotal - overallDiscAmt;

  return (
    <div className="p-6 max-w-6xl space-y-4">
      {/* ── Finalize Dialog ────────────────────────────────────────────────── */}
      {showFinalizeDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
            <div className="px-5 py-4 border-b border-border">
              <h2 className="text-base font-semibold">
                Finalize comparison group
              </h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                Dummy quotation prices will be inflated by the percentages
                below. Original quotation prices are unchanged.
              </p>
            </div>
            <div className="p-5 space-y-3">
              {markupRows.map((row) => {
                const projected =
                  Number(row.grandTotal) *
                  (1 + (parseFloat(row.markupPct) || 0) / 100);
                return (
                  <div key={row.id} className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">
                        {row.orgName}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {row.quotationNo}
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground shrink-0 tabular-nums">
                      {fmt(row.grandTotal)}
                    </div>
                    {row.isDummy === 0 ? (
                      <div className="w-24 text-[11px] text-center text-muted-foreground bg-muted/30 border border-border rounded-lg px-3 py-2">
                        Original
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center gap-1 shrink-0">
                          <Input
                            type="number"
                            min="0.1"
                            max="100"
                            step="0.1"
                            value={row.markupPct}
                            onChange={(e) =>
                              setMarkupRows((prev) =>
                                prev.map((r) =>
                                  r.id === row.id
                                    ? { ...r, markupPct: e.target.value }
                                    : r,
                                ),
                              )
                            }
                            className="w-20 h-8 text-sm text-right"
                          />
                          <span className="text-sm text-muted-foreground">
                            %
                          </span>
                        </div>
                        <div className="text-xs text-green-600 dark:text-green-400 shrink-0 tabular-nums">
                          → {fmt(projected)}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="px-5 py-4 border-t border-border flex items-center justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowFinalizeDialog(false)}
                disabled={finalizing}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleConfirmFinalize}
                disabled={finalizing}
                className="gap-1.5"
              >
                {finalizing ? (
                  <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                ) : (
                  <CheckIcon className="w-3.5 h-3.5" />
                )}
                Confirm &amp; finalize
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={() => router.push("/dashboard/sales/quotation")}
          >
            <ArrowLeftIcon className="w-4 h-4" />
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight font-mono">
                {q.quotationNo}
              </h1>
              <span
                className={cn(
                  "text-[11px] font-medium border rounded px-2 py-0.5",
                  statusCfg.className,
                )}
              >
                {statusCfg.label}
              </span>
              {isComparison && (
                <span className="text-[11px] font-medium border border-blue-200 dark:border-blue-800 rounded px-2 py-0.5 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400">
                  Comparison
                </span>
              )}
              {q.isDummy === 1 && (
                <span className="text-[11px] font-medium border border-muted rounded px-2 py-0.5 bg-muted/40 text-muted-foreground">
                  Dummy
                </span>
              )}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {orgName} · Created {fmtDate(q.createdAt)}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 shrink-0">
          {isDraft && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 h-8"
              onClick={() =>
                router.push(`/dashboard/sales/quotation/${q.id}/edit`)
              }
            >
              <PencilIcon className="w-3.5 h-3.5" />
              Edit
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 h-8"
            disabled={pdfLoading || pdfGroupLoading}
            onClick={() =>
              downloadPdf(
                `/api/quotation/${q.id}/pdf`,
                `${q.quotationNo}.pdf`,
                setPdfLoading,
              )
            }
          >
            {pdfLoading ? (
              <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
            ) : (
              <PrinterIcon className="w-3.5 h-3.5" />
            )}
            {pdfLoading ? "Generating…" : "Download PDF"}
          </Button>
          {siblings.length > 1 && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 h-8"
              disabled={pdfLoading || pdfGroupLoading}
              onClick={handleDownloadAll}
            >
              {pdfGroupLoading ? (
                <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
              ) : (
                <PrinterIcon className="w-3.5 h-3.5" />
              )}
              {pdfGroupLoading
                ? `Generating ${pdfGroupProgress}…`
                : `Download All (${siblings.length})`}
            </Button>
          )}
          {isDraft && (
            <Button
              size="sm"
              className="gap-1.5 h-8"
              onClick={handleFinalizeClick}
              disabled={finalizing}
            >
              {finalizing ? (
                <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
              ) : (
                <CheckIcon className="w-3.5 h-3.5" />
              )}
              Finalize
            </Button>
          )}
          {isDraft && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 h-8 text-destructive hover:text-destructive border-destructive/30 hover:bg-destructive/5"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? (
                <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
              ) : (
                <TrashIcon className="w-3.5 h-3.5" />
              )}
              Delete
            </Button>
          )}
        </div>
      </div>

      {/* ── Comparison group tab bar ────────────────────────────────────────── */}
      {isComparison && siblings.length > 0 && (
        <div className="bg-background border border-border rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 bg-muted/20 border-b border-border">
            <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Comparison group
            </div>
          </div>
          <div className="flex items-center gap-1 p-2 flex-wrap">
            {siblings.map((s) => {
              const isCurrent = s.id === q.id;
              const sibStatus =
                STATUS[s.status as keyof typeof STATUS] ?? STATUS.draft;
              return (
                <button
                  key={s.id}
                  onClick={() =>
                    !isCurrent &&
                    router.push(`/dashboard/sales/quotation/${s.id}`)
                  }
                  className={cn(
                    "flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-colors",
                    isCurrent
                      ? "bg-primary/10 text-primary border border-primary/20"
                      : "hover:bg-muted/50 border border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  <BuildingIcon className="w-3 h-3 shrink-0" />
                  <span className="font-medium">{s.orgName}</span>
                  <span className="font-mono text-[10px] opacity-70">
                    {s.quotationNo}
                  </span>
                  <span
                    className={cn(
                      "rounded px-1.5 py-0.5 text-[9px] font-medium border",
                      s.isDummy === 0
                        ? "bg-primary/10 text-primary border-primary/20"
                        : "bg-muted text-muted-foreground border-border",
                    )}
                  >
                    {s.isDummy === 0 ? "original" : "dummy"}
                  </span>
                  <span
                    className={cn(
                      "rounded px-1.5 py-0.5 text-[9px] font-medium border",
                      sibStatus.className,
                    )}
                  >
                    {sibStatus.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Main layout ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-[1fr_300px] gap-4 items-start">
        {/* ── Left: Items table ─────────────────────────────────────────────── */}
        <div className="bg-background border border-border rounded-xl overflow-hidden">
          <div className="px-4 py-3 bg-muted/20 border-b border-border flex items-center justify-between">
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Items
            </div>
            <div className="text-xs text-muted-foreground">
              {items.length} items
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-muted/10">
                  {[
                    "#",
                    "Code",
                    "Description",
                    "Qty",
                    "UOM",
                    "Unit Price",
                    "Disc%",
                    "Total",
                    "",
                  ].map((h) => (
                    <th
                      key={h}
                      className={cn(
                        "px-3 py-2 text-[10px] font-medium text-muted-foreground border-b border-border whitespace-nowrap",
                        ["Unit Price", "Total"].includes(h)
                          ? "text-right"
                          : "text-left",
                      )}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((item, i) => (
                  <tr
                    key={item.id}
                    className={cn(
                      i < items.length - 1 ? "border-b border-border" : "",
                      i % 2 === 1 ? "bg-muted/5" : "",
                    )}
                  >
                    <td className="px-3 py-2.5 text-muted-foreground w-8">
                      {item.rowNo}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-[11px]">
                      {item.productCode ?? "—"}
                    </td>
                    <td className="px-3 py-2.5 max-w-50">
                      <div className="truncate">{item.description ?? "—"}</div>
                      {item.descriptionSource === "sheet" && (
                        <span className="text-[9px] text-blue-500">sheet</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 tabular-nums">{item.qty}</td>
                    <td className="px-3 py-2.5 text-muted-foreground">
                      {item.uom || "—"}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {`RM ${Number(item.unitPrice ?? 0).toFixed(2)}`}
                      {item.priceSource === "sheet" && (
                        <span className="ml-1 text-[9px] text-blue-500">
                          sheet
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-center tabular-nums">
                      {Number(item.discountPct ?? 0) > 0
                        ? `${item.discountPct}%`
                        : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-medium">
                      {Number(q.showTotalPrice)
                        ? `RM ${Number(item.totalPrice ?? 0).toFixed(2)}`
                        : "—"}
                    </td>
                    <td className="px-3 py-2.5 w-6">
                      <div className="flex items-center gap-1">
                        {item.hasCert ? (
                          <ShieldCheckIcon className="w-3.5 h-3.5 text-green-500" />
                        ) : (
                          <AlertCircleIcon className="w-3.5 h-3.5 text-orange-400" />
                        )}
                        {item.imageKey && (
                          <ImageIcon className="w-3.5 h-3.5 text-blue-400" />
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Right sidebar ──────────────────────────────────────────────────── */}
        <div className="space-y-3">
          {/* Customer */}
          <div className="bg-background border border-border rounded-xl overflow-hidden">
            <div className="px-3 py-2.5 bg-muted/20 border-b border-border flex items-center gap-2">
              <UserIcon className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Customer
              </span>
            </div>
            <div className="p-3 space-y-1 text-xs">
              {cust ? (
                <>
                  <div className="font-medium text-sm">
                    {[cust.title, cust.name].filter(Boolean).join(" ")}
                  </div>
                  {cust.position && (
                    <div className="text-muted-foreground">
                      {cust.position}
                      {cust.department ? ` · ${cust.department}` : ""}
                    </div>
                  )}
                  {cust.organizationName && (
                    <div className="text-muted-foreground">
                      {cust.organizationName}
                    </div>
                  )}
                  {cust.organizationAddress && (
                    <div className="text-muted-foreground leading-relaxed">
                      {cust.organizationAddress}
                    </div>
                  )}
                  {(cust.email || cust.contactNo) && (
                    <div className="text-muted-foreground pt-0.5">
                      {[cust.email, cust.contactNo].filter(Boolean).join(" · ")}
                    </div>
                  )}
                </>
              ) : (
                <span className="text-muted-foreground">No customer</span>
              )}
            </div>
          </div>

          {/* Sales info */}
          <div className="bg-background border border-border rounded-xl overflow-hidden">
            <div className="px-3 py-2.5 bg-muted/20 border-b border-border flex items-center gap-2">
              <CalendarIcon className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Details
              </span>
            </div>
            <div className="p-3 space-y-2 text-xs">
              <Row label="Title" value={q.title ?? "Loose Items"} />
              <Row label="Sales person" value={q.salesPersonName ?? "—"} />
              <Row label="Prepared by" value={q.preparedByName ?? "—"} />
              <Row label="Valid until" value={fmtDate(q.validUntil)} />
              <Row label="Created" value={fmtDate(q.createdAt)} />
            </div>
          </div>

          {/* Pricing summary */}
          <div className="bg-background border border-border rounded-xl overflow-hidden">
            <div className="px-3 py-2.5 bg-muted/20 border-b border-border">
              <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Pricing
              </span>
            </div>
            <div className="p-3 space-y-2 text-xs">
              <Row label="Subtotal" value={fmt(subtotal)} mono />
              {overallDiscAmt > 0 && (
                <Row
                  label={`Discount (${q.overallDiscountPct}%)`}
                  value={`- ${fmt(overallDiscAmt)}`}
                  className="text-red-600 dark:text-red-400"
                  mono
                />
              )}
              {overallDiscAmt > 0 && (
                <Row label="After discount" value={fmt(afterDiscount)} mono />
              )}
              {sstAmt > 0 && (
                <Row label={`SST (${q.sstPct}%)`} value={fmt(sstAmt)} mono />
              )}
              <div className="pt-2 border-t border-border flex justify-between items-center">
                <span className="font-medium">Grand total</span>
                <span className="font-semibold text-base text-green-600 dark:text-green-400 tabular-nums">
                  {fmt(grandTotal)}
                </span>
              </div>
            </div>
          </div>

          {/* Options */}
          <div className="bg-background border border-border rounded-xl overflow-hidden">
            <div className="px-3 py-2.5 bg-muted/20 border-b border-border flex items-center gap-2">
              <FileTextIcon className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Document options
              </span>
            </div>
            <div className="p-3 space-y-3 text-xs">
              <div className="space-y-1.5">
                <p className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground">Display</p>
                <OptionRow label="Product catalogue" enabled={!!Number(q.includeCatalogue)} />
                <OptionRow label="MDA certificates"  enabled={!!Number(q.includeMdaCerts)} />
                <OptionRow label="Show total prices" enabled={!!Number(q.showTotalPrice)} />
                <OptionRow label="Itemize discount"  enabled={!!Number(q.showItemizeDiscount)} />
              </div>
              <div className="space-y-1.5">
                <p className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground">Attached Documents</p>
                <OptionRow label="MOF Certificate"                  enabled={!!Number(q.inclMof)} />
                <OptionRow label="SSM"                              enabled={!!Number(q.inclSsm)} />
                <OptionRow label="TCC (Tax Compliance Certificate)" enabled={!!Number(q.inclTcc)} />
                <OptionRow label="Bank Statement"                   enabled={!!Number(q.inclBankStatement)} />
                <OptionRow label="MDA Establishment"                enabled={!!Number(q.inclMdaEstablishment)} />
                <OptionRow label="Lampiran 12"                      enabled={!!Number(q.inclLampiran12)} />
                <OptionRow label="Lampiran 13"                      enabled={!!Number(q.inclLampiran13)} />
              </div>
            </div>
          </div>

          {/* Notes */}
          {q.notes && (
            <div className="bg-background border border-border rounded-xl overflow-hidden">
              <div className="px-3 py-2.5 bg-muted/20 border-b border-border">
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Notes
                </span>
              </div>
              <div className="p-3 text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap">
                {q.notes}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  className,
  mono,
}: {
  label: string;
  value: string;
  className?: string;
  mono?: boolean;
}) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span
        className={cn(
          mono ? "tabular-nums font-mono" : "font-medium text-right",
          className,
        )}
      >
        {value}
      </span>
    </div>
  );
}

function OptionRow({ label, enabled }: { label: string; enabled: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <div
        className={cn(
          "w-4 h-4 rounded border flex items-center justify-center shrink-0",
          enabled ? "bg-primary border-primary" : "border-border bg-muted/30",
        )}
      >
        {enabled && (
          <CheckIcon className="w-2.5 h-2.5 text-primary-foreground" />
        )}
      </div>
      <span className={enabled ? "text-foreground" : "text-muted-foreground"}>
        {label}
      </span>
    </div>
  );
}
