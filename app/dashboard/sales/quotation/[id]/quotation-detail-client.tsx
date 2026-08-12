"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  finalizeQuotation,
  deleteQuotation,
  getQuotationGroupAllDetails,
  reviseQuotation,
  updateQuotationSettings,
  updateQuotationDocumentOptions,
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
  LayersIcon,
  DatabaseIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Data = NonNullable<Awaited<ReturnType<typeof getQuotationGroupAllDetails>>>[number];

interface Props {
  group: Data[];
  initialId: string;
}

const fmt = (v: string | number | null | undefined) =>
  `RM ${Number(v ?? 0).toLocaleString("en-MY", { minimumFractionDigits: 2 })}`;

const acct = (v: number) =>
  v < 0
    ? `(${Math.abs(v).toLocaleString("en-MY", { minimumFractionDigits: 2 })})`
    : v.toLocaleString("en-MY", { minimumFractionDigits: 2 });

function SrcTag({ src, userName }: { src: string | null | undefined; userName?: string | null }) {
  if (!src) return null;
  if (src === "db") return (
    <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-blue-50 text-blue-600 border border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800">
      <DatabaseIcon className="w-3 h-3 shrink-0" />from product table
    </span>
  );
  if (src === "sheet") return (
    <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800">
      <PencilIcon className="w-3 h-3 shrink-0" />{(userName || "user").toLowerCase()} edited
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-orange-50 text-orange-700 border border-orange-200 dark:bg-orange-950/40 dark:text-orange-400 dark:border-orange-800">
      <PencilIcon className="w-3 h-3 shrink-0" />{(userName || "user").toLowerCase()} edited
    </span>
  );
}

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


export function QuotationDetailClient({ group, initialId }: Props) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState(initialId);

  // All data is already loaded — switch is instant, no navigation
  const data = group.find((d) => d.quotation.id === selectedId) ?? group[0];
  const { quotation: q, orgName, items, siblings, createdByName } = data;
  const cust = q.customerSnapshot as any;

  const [finalizing, setFinalizing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [revising, setRevising] = useState(false);

  // Editable settings (drafts only)
  const [applyTotalDiscount, setApplyTotalDiscount] = useState(
    Number(q.overallDiscountPct ?? 0) > 0 || Number(q.overallDiscountAmt ?? 0) > 0,
  );
  const [discountType, setDiscountType] = useState<"pct" | "fixed">(
    Number(q.overallDiscountPct ?? 0) > 0 ? "pct" : "fixed",
  );
  const [overallDiscount, setOverallDiscount] = useState(q.overallDiscountPct ?? "0");
  const [specialDiscAmt, setSpecialDiscAmt] = useState(q.overallDiscountAmt ?? "0");
  const [applySST, setApplySST] = useState(Number(q.sstPct ?? 0) > 0);
  const [sstPct, setSstPct] = useState(q.sstPct ?? "8");
  const [showProductCode, setShowProductCode] = useState(!!Number(q.showProductCode));
  const [includeMdaCerts, setIncludeMdaCerts] = useState(!!Number(q.includeMdaCerts));
  const [includeCatalogue, setIncludeCatalogue] = useState(!!Number(q.includeCatalogue));
  const [inclMof, setInclMof] = useState(!!Number(q.inclMof));
  const [inclSsm, setInclSsm] = useState(!!Number(q.inclSsm));
  const [inclTcc, setInclTcc] = useState(!!Number(q.inclTcc));
  const [inclBankStatement, setInclBankStatement] = useState(!!Number(q.inclBankStatement));
  const [inclMdaEstablishment, setInclMdaEstablishment] = useState(!!Number(q.inclMdaEstablishment));
  const [inclLampiran12, setInclLampiran12] = useState(!!Number(q.inclLampiran12));
  const [inclLampiran13, setInclLampiran13] = useState(!!Number(q.inclLampiran13));
  const [showItemizeDiscount, setShowItemizeDiscount] = useState(!!Number(q.showItemizeDiscount));
  const [showItemizedPricing, setShowItemizedPricing] = useState(!!Number(q.showItemizedPricing ?? 1));
  const [showTotalPrice, setShowTotalPrice] = useState(!!Number(q.showTotalPrice ?? 1));

  // Re-sync when switching between comparison tabs
  useEffect(() => {
    setApplyTotalDiscount(Number(q.overallDiscountPct ?? 0) > 0 || Number(q.overallDiscountAmt ?? 0) > 0);
    setDiscountType(Number(q.overallDiscountPct ?? 0) > 0 ? "pct" : "fixed");
    setOverallDiscount(q.overallDiscountPct ?? "0");
    setSpecialDiscAmt(q.overallDiscountAmt ?? "0");
    setApplySST(Number(q.sstPct ?? 0) > 0);
    setSstPct(q.sstPct ?? "8");
    setShowProductCode(!!Number(q.showProductCode));
    setIncludeMdaCerts(!!Number(q.includeMdaCerts));
    setIncludeCatalogue(!!Number(q.includeCatalogue));
    setInclMof(!!Number(q.inclMof));
    setInclSsm(!!Number(q.inclSsm));
    setInclTcc(!!Number(q.inclTcc));
    setInclBankStatement(!!Number(q.inclBankStatement));
    setInclMdaEstablishment(!!Number(q.inclMdaEstablishment));
    setInclLampiran12(!!Number(q.inclLampiran12));
    setInclLampiran13(!!Number(q.inclLampiran13));
    setShowItemizeDiscount(!!Number(q.showItemizeDiscount));
    setShowItemizedPricing(!!Number(q.showItemizedPricing ?? 1));
    setShowTotalPrice(!!Number(q.showTotalPrice ?? 1));
  }, [q.id]);

  const saveSettings = async (patch: Partial<{
    applyTotalDiscount: boolean; discountType: "pct" | "fixed";
    overallDiscount: string; specialDiscAmt: string;
    applySST: boolean; sstPct: string;
    showProductCode: boolean; includeMdaCerts: boolean; includeCatalogue: boolean;
    inclMof: boolean; inclSsm: boolean; inclTcc: boolean; inclBankStatement: boolean;
    inclMdaEstablishment: boolean; inclLampiran12: boolean; inclLampiran13: boolean;
    showItemizeDiscount: boolean;
  }> = {}) => {
    const s = {
      applyTotalDiscount, discountType, overallDiscount, specialDiscAmt,
      applySST, sstPct, showProductCode, includeMdaCerts, includeCatalogue,
      inclMof, inclSsm, inclTcc, inclBankStatement, inclMdaEstablishment,
      inclLampiran12, inclLampiran13, showItemizeDiscount, ...patch,
    };
    const useDisc = s.applyTotalDiscount;
    try {
      await updateQuotationSettings(q.id, {
        overallDiscountPct: useDisc && s.discountType === "pct" ? s.overallDiscount : "0",
        overallDiscountAmt: useDisc && s.discountType === "fixed" ? s.specialDiscAmt : "0",
        sstPct: s.applySST ? s.sstPct : "0",
        showProductCode: s.showProductCode,
        includeMdaCerts: s.includeMdaCerts,
        includeCatalogue: s.includeCatalogue,
        inclMof: s.inclMof,
        inclSsm: s.inclSsm,
        inclTcc: s.inclTcc,
        inclBankStatement: s.inclBankStatement,
        inclMdaEstablishment: s.inclMdaEstablishment,
        inclLampiran12: s.inclLampiran12,
        inclLampiran13: s.inclLampiran13,
        showItemizeDiscount: s.showItemizeDiscount,
      });
      router.refresh();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  // Keep URL in sync without triggering a page reload
  useEffect(() => {
    window.history.replaceState(null, "", `/dashboard/sales/quotation/${selectedId}`);
  }, [selectedId]);

  const isDraft = q.status === "draft";
  const isComparison = q.mode === "comparison";
  const statusCfg = STATUS[q.status as keyof typeof STATUS] ?? STATUS.draft;

  const handleFinalizeClick = () => {
    if (!confirm("Finalize this quotation? This cannot be undone.")) return;
    doFinalize();
  };

  const doFinalize = async () => {
    setFinalizing(true);
    try {
      await finalizeQuotation(q.id);
      toast.success("Quotation finalized");
      router.refresh();
      // Keep finalizing=true — spinner stays until refresh re-renders the page
      // with status "final", at which point the button is no longer shown.
    } catch (e: any) {
      toast.error(e.message);
      setFinalizing(false);
    }
  };

  const saveDocumentOptions = async (patch: Partial<{
    showItemizedPricing: boolean; showProductCode: boolean; showItemizeDiscount: boolean;
    showTotalPrice: boolean; includeCatalogue: boolean; includeMdaCerts: boolean;
    inclMof: boolean; inclSsm: boolean; inclTcc: boolean; inclBankStatement: boolean;
    inclMdaEstablishment: boolean; inclLampiran12: boolean; inclLampiran13: boolean;
  }>) => {
    try {
      await updateQuotationDocumentOptions(q.id, {
        showItemizedPricing, showProductCode, showItemizeDiscount, showTotalPrice,
        includeCatalogue, includeMdaCerts, inclMof, inclSsm, inclTcc, inclBankStatement,
        inclMdaEstablishment, inclLampiran12, inclLampiran13,
        ...patch,
      });
      router.refresh();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const [downloadingKey, setDownloadingKey] = useState<string | null>(null);

  // Fetches the PDF and triggers a same-tab download via a temporary <a>,
  // instead of window.open (which opens a new tab and leaves it dangling).
  // Surfaces the server's actual error text on failure.
  const downloadPdf = async (url: string, filename: string) => {
    const res = await fetch(url);
    if (!res.ok) {
      const text = (await res.text().catch(() => "")).trim();
      throw new Error(text || `Failed to download (HTTP ${res.status})`);
    }
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(objectUrl);
  };

  const handleDownloadPdfClick = async () => {
    setDownloadingKey("pdf");
    try {
      await downloadPdf(`/api/quotation/${q.id}/pdf`, `${q.quotationNo}.pdf`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to download PDF");
    } finally {
      setDownloadingKey(null);
    }
  };

  const handleDownloadMdaClick = async () => {
    setDownloadingKey("mda");
    try {
      await downloadPdf(`/api/quotation/${q.id}/mda-certs`, `${q.quotationNo}-mda-certs.pdf`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to download MDA certs");
    } finally {
      setDownloadingKey(null);
    }
  };

  const handleDownloadAll = async () => {
    setDownloadingKey("all");
    try {
      for (const s of siblings) {
        await downloadPdf(`/api/quotation/${s.id}/pdf`, `${s.quotationNo}.pdf`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to download all PDFs");
    } finally {
      setDownloadingKey(null);
    }
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
  const sets = Number(q.sets ?? 1);
  const subtotal = Number(q.subtotal ?? 0);
  const subtotalPerSet = sets > 1 ? subtotal / sets : null;
  const overallDiscAmt = Number(q.overallDiscountAmt ?? 0);
  const sstAmt = Number(q.sst ?? 0);
  const grandTotal = Number(q.grandTotal ?? 0);
  const afterDiscount = subtotal - overallDiscAmt;

  return (
    <div className="p-6 space-y-4">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 shrink-0"
            onClick={() => router.push("/dashboard/sales/quotation")}
          >
            <ArrowLeftIcon className="w-4 h-4" />
          </Button>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-semibold tracking-tight font-mono">
                {q.quotationNo.startsWith("PENDING-") ? <span className="text-muted-foreground italic text-base">No. pending</span> : q.quotationNo}
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
              {(q.revisionNo ?? 0) > 0 && (
                <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400">
                  Rev.{q.revisionNo}
                </span>
              )}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {orgName} · Created {fmtDate(q.createdAt)}
            </div>
            {(q.revisionNo ?? 0) > 0 && (
              <p className="text-xs text-muted-foreground">
                Revision {q.revisionNo} of <span className="font-mono">{q.quotationNo.replace(/-R\d+$/, "")}</span>
              </p>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 flex-wrap md:shrink-0">
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
          {!isDraft && (
            <>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 h-8"
                disabled={downloadingKey === "pdf"}
                onClick={handleDownloadPdfClick}
              >
                {downloadingKey === "pdf" ? (
                  <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin"/>
                ) : (
                  <PrinterIcon className="w-3.5 h-3.5" />
                )}
                Download PDF
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 h-8"
                disabled={downloadingKey === "mda"}
                onClick={handleDownloadMdaClick}
              >
                {downloadingKey === "mda" ? (
                  <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin"/>
                ) : (
                  <ShieldCheckIcon className="w-3.5 h-3.5" />
                )}
                MDA Certs
              </Button>
              {siblings.length > 1 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 h-8"
                  disabled={downloadingKey === "all"}
                  onClick={handleDownloadAll}
                >
                  {downloadingKey === "all" ? (
                    <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin"/>
                  ) : (
                    <PrinterIcon className="w-3.5 h-3.5" />
                  )}
                  Download All ({siblings.length})
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                disabled={revising}
                onClick={async () => {
                  setRevising(true);
                  try {
                    const newId = await reviseQuotation(q.id);
                    toast.success("Revision created — now in draft");
                    router.push(`/dashboard/sales/quotation/${newId}/edit`);
                  } catch (e: any) {
                    toast.error(e.message);
                  } finally {
                    setRevising(false);
                  }
                }}
              >
                {revising ? "Creating…" : "Revise"}
              </Button>
            </>
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
              const isCurrent = s.id === selectedId;
              const sibStatus =
                STATUS[s.status as keyof typeof STATUS] ?? STATUS.draft;
              return (
                <button
                  key={s.id}
                  onClick={() => !isCurrent && setSelectedId(s.id)}
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
                    {s.quotationNo.startsWith("PENDING-") ? "—" : s.quotationNo}
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
      <div className="grid grid-cols-1 md:grid-cols-[1fr_300px] gap-4 items-start">
        {/* ── Left: Items table ─────────────────────────────────────────────── */}
        <div className="bg-background border border-border rounded-xl overflow-hidden">
          <div className="px-4 py-3 bg-muted/20 border-b border-border flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground shrink-0">Items</span>
              {q.title && (
                <span className="text-xs font-semibold text-foreground truncate">{q.title}</span>
              )}
              <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-blue-50 text-blue-600 border border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800 shrink-0">
                {sets} {sets === 1 ? "set" : "sets"}
              </span>
            </div>
            <div className="text-xs text-muted-foreground shrink-0">
              {items.length} items
            </div>
          </div>
          <div className="px-4 py-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-border/40 bg-muted/5">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wide shrink-0">Legend</span>
            <span className="inline-flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <span className="text-[8px] font-bold px-1 py-0.5 rounded border bg-green-50 border-green-300 text-green-700 dark:bg-green-900/20 dark:border-green-700 dark:text-green-400">SELL</span>
              sell item
            </span>
            <span className="inline-flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <span className="text-[8px] font-bold px-1 py-0.5 rounded border bg-amber-50 border-amber-300 text-amber-700 dark:bg-amber-900/20 dark:border-amber-700 dark:text-amber-400">RENT</span>
              rental item
            </span>
            <span className="inline-flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <ShieldCheckIcon className="w-3.5 h-3.5 text-green-500" />
              cert available
            </span>
            <span className="inline-flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <AlertCircleIcon className="w-3.5 h-3.5 text-orange-400" />
              no cert
            </span>
            <span className="inline-flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <ImageIcon className="w-3.5 h-3.5 text-blue-400" />
              has image
            </span>
            <span className="inline-flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <LayersIcon className="w-3.5 h-3.5 text-blue-500" />
              set group
            </span>
          </div>
          {(() => {
            type ItemEntry =
              | { kind: "group"; gid: string; first: typeof items[number]; groupTotal: number }
              | { kind: "item"; item: typeof items[number]; inSet: boolean };

            const seenGroupIds = new Set<string>();
            const groupOrder: string[] = [];
            for (const it of items) {
              if (it.setGroupId && !seenGroupIds.has(it.setGroupId)) {
                seenGroupIds.add(it.setGroupId);
                groupOrder.push(it.setGroupId);
              }
            }

            const entries: ItemEntry[] = [];
            for (const gid of groupOrder) {
              const gItems = items.filter((it) => it.setGroupId === gid);
              const first = gItems[0];
              const groupTotal = gItems.reduce((s, it) => s + Number(it.totalPrice ?? 0), 0);
              entries.push({ kind: "group", gid, first, groupTotal });
              gItems.forEach((it) => entries.push({ kind: "item", item: it, inSet: true }));
            }
            items
              .filter((it) => !it.setGroupId)
              .forEach((it) => entries.push({ kind: "item", item: it, inSet: false }));

            const renderItemRow = (item: typeof items[number], inSet: boolean) => {
                    const isRent = item.lineType === "rent";
                    return (
                      <tr
                        key={item.id}
                        className={cn(
                          "border-b border-border/60 last:border-0",
                          inSet && "bg-blue-50/20 dark:bg-blue-900/5",
                        )}
                      >
                        {/* # + type badge */}
                        <td className="px-3 py-2 w-12 align-top">
                          <div className="flex flex-col items-center gap-0.5">
                            <span className="text-muted-foreground text-[10px]">{item.rowNo}</span>
                            <span className={cn(
                              "text-[8px] font-bold px-1 py-0.5 rounded border",
                              isRent
                                ? "bg-amber-50 border-amber-300 text-amber-700 dark:bg-amber-900/20 dark:border-amber-700 dark:text-amber-400"
                                : "bg-green-50 border-green-300 text-green-700 dark:bg-green-900/20 dark:border-green-700 dark:text-green-400",
                            )}>
                              {isRent ? "RENT" : "SELL"}
                            </span>
                          </div>
                        </td>

                        <td className="px-3 py-2 font-mono text-[11px] align-top">
                          <div>{item.productCode ?? "—"}</div>
                          <SrcTag src={item.productCode ? "sheet" : undefined} userName={createdByName} />
                        </td>

                        <td className="px-3 py-2 min-w-48 align-top">
                          <div className="whitespace-normal">{item.description ?? "—"}</div>
                          <SrcTag src={item.descriptionSource} userName={createdByName} />
                          {isRent && item.rentalDuration && (
                            <div className="text-[10px] text-amber-600 dark:text-amber-400 mt-0.5">
                              rental for {item.rentalDuration} {item.rentalUnit ?? "case"}
                            </div>
                          )}
                        </td>

                        <td className="px-3 py-2 tabular-nums align-top text-center">
                          <div>{item.qty}</div>
                          {inSet && (
                            <div className="text-[9px] text-muted-foreground">/set</div>
                          )}
                        </td>

                        <td className="px-3 py-2 tabular-nums align-top text-center">
                          {(Number(item.qty ?? 1) * Number(item.setQty || 1) * sets).toLocaleString("en-MY")}
                        </td>

                        <td className="px-3 py-2 text-muted-foreground align-top text-center">
                          {item.uom || "—"}
                        </td>

                        <td className="px-3 py-2 text-right tabular-nums align-top">
                          <div>{acct(Number(item.unitPrice ?? 0))}</div>
                          <SrcTag src={item.priceSource} userName={createdByName} />
                        </td>

                        <td className="px-3 py-2 text-center tabular-nums align-top">
                          {Number(item.discountPct ?? 0) > 0 ? `${item.discountPct}%` : "—"}
                        </td>

                        <td className="px-3 py-2 text-right tabular-nums font-medium align-top">
                          {Number(q.showTotalPrice) ? acct(Number(item.totalPrice ?? 0)) : "—"}
                        </td>

                        <td className="px-3 py-2 w-6 align-top">
                          <div className="flex items-center gap-1">
                            {item.hasCert ? (
                              <ShieldCheckIcon className="w-3.5 h-3.5 text-green-500" />
                            ) : (
                              <AlertCircleIcon className="w-3.5 h-3.5 text-orange-400" />
                            )}
                            {item.imageKey && <ImageIcon className="w-3.5 h-3.5 text-blue-400" />}
                          </div>
                        </td>
                      </tr>
                    );
                  };

                  const renderGroupHeaderRow = (e: Extract<ItemEntry, { kind: "group" }>) => (
                    <tr key={`hdr-${e.gid}`} className="bg-blue-50/60 dark:bg-blue-900/10 border-b border-blue-200/60 dark:border-blue-800/40">
                      <td colSpan={3} className="px-3 py-1.5 align-top">
                        <div className="flex items-center gap-2 flex-wrap">
                          <LayersIcon className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                          <span className="text-xs font-semibold text-blue-700 dark:text-blue-300">
                            {e.first.setGroupLabel || "Set"}
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            × {Number(e.first.setQty || 1) * sets} {Number(e.first.setQty || 1) * sets === 1 ? "set" : "sets"}
                          </span>
                          {Number(q.showTotalPrice) && Number(e.first.setQty || 1) > 1 && (
                            <>
                              <span className="text-[10px] text-muted-foreground">·</span>
                              <span className="text-[10px] text-blue-600 dark:text-blue-400 tabular-nums">
                                {acct(e.groupTotal / Number(e.first.setQty || 1))} / set
                              </span>
                            </>
                          )}
                        </div>
                        {e.first.setQtySource === "user" && (
                          <div className="mt-0.5"><SrcTag src="user" userName={createdByName} /></div>
                        )}
                      </td>
                      <td colSpan={5} />
                      <td className="px-3 py-1.5 text-right text-xs font-semibold text-blue-700 dark:text-blue-300 tabular-nums">
                        {Number(q.showTotalPrice) ? acct(e.groupTotal) : "—"}
                      </td>
                      <td />
                    </tr>
                  );

                  const renderGroupHeaderCard = (e: Extract<ItemEntry, { kind: "group" }>) => (
                    <div key={`hdr-${e.gid}`} className="px-3 py-2 bg-blue-50/60 dark:bg-blue-900/10 border-b border-blue-200/60 dark:border-blue-800/40">
                      <div className="flex items-center gap-2 flex-wrap">
                        <LayersIcon className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                        <span className="text-xs font-semibold text-blue-700 dark:text-blue-300">
                          {e.first.setGroupLabel || "Set"}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          × {Number(e.first.setQty || 1) * sets} {Number(e.first.setQty || 1) * sets === 1 ? "set" : "sets"}
                        </span>
                        <span className="ml-auto text-xs font-semibold text-blue-700 dark:text-blue-300 tabular-nums">
                          {Number(q.showTotalPrice) ? acct(e.groupTotal) : "—"}
                        </span>
                      </div>
                      {e.first.setQtySource === "user" && (
                        <div className="mt-1"><SrcTag src="user" userName={createdByName} /></div>
                      )}
                    </div>
                  );

                  const renderItemCard = (item: typeof items[number], inSet: boolean) => {
                    const isRent = item.lineType === "rent";
                    return (
                      <div
                        key={item.id}
                        className={cn(
                          "px-3 py-2.5 border-b border-border/60 last:border-0 space-y-1.5 text-xs",
                          inSet && "bg-blue-50/20 dark:bg-blue-900/5",
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-1.5">
                            <span className="text-muted-foreground text-[10px]">#{item.rowNo}</span>
                            <span className={cn(
                              "text-[8px] font-bold px-1 py-0.5 rounded border",
                              isRent
                                ? "bg-amber-50 border-amber-300 text-amber-700 dark:bg-amber-900/20 dark:border-amber-700 dark:text-amber-400"
                                : "bg-green-50 border-green-300 text-green-700 dark:bg-green-900/20 dark:border-green-700 dark:text-green-400",
                            )}>
                              {isRent ? "RENT" : "SELL"}
                            </span>
                          </div>
                          <span className="text-right font-semibold tabular-nums shrink-0">
                            {Number(q.showTotalPrice) ? acct(Number(item.totalPrice ?? 0)) : "—"}
                          </span>
                        </div>

                        <div>
                          <div className="font-mono text-[11px]">{item.productCode ?? "—"}</div>
                          <SrcTag src={item.productCode ? "sheet" : undefined} userName={createdByName} />
                        </div>

                        <div>
                          <div className="whitespace-normal">{item.description ?? "—"}</div>
                          <SrcTag src={item.descriptionSource} userName={createdByName} />
                          {isRent && item.rentalDuration && (
                            <div className="text-[10px] text-amber-600 dark:text-amber-400 mt-0.5">
                              rental for {item.rentalDuration} {item.rentalUnit ?? "case"}
                            </div>
                          )}
                        </div>

                        <div className="flex items-center justify-between text-muted-foreground">
                          <span>
                            Qty: {item.qty}{inSet && "/set"} · {(Number(item.qty ?? 1) * Number(item.setQty || 1) * sets).toLocaleString("en-MY")} total · {item.uom || "—"}
                          </span>
                        </div>

                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <span>Unit: {acct(Number(item.unitPrice ?? 0))}</span>
                            <SrcTag src={item.priceSource} userName={createdByName} />
                          </div>
                          <span className="text-muted-foreground shrink-0">
                            Disc: {Number(item.discountPct ?? 0) > 0 ? `${item.discountPct}%` : "—"}
                          </span>
                        </div>

                        <div className="flex items-center gap-1.5">
                          {item.hasCert ? (
                            <ShieldCheckIcon className="w-3.5 h-3.5 text-green-500" />
                          ) : (
                            <AlertCircleIcon className="w-3.5 h-3.5 text-orange-400" />
                          )}
                          {item.imageKey && <ImageIcon className="w-3.5 h-3.5 text-blue-400" />}
                        </div>
                      </div>
                    );
                  };

                  const mobileTotals = !!Number(q.showTotalPrice) && (
                    <div className="p-3 space-y-1.5 text-xs border-t border-border">
                      {subtotalPerSet !== null && (
                        <Row label="Subtotal (1 set)" value={acct(subtotalPerSet)} mono />
                      )}
                      <Row
                        label={subtotalPerSet !== null ? `× ${sets} sets` : "Subtotal"}
                        value={acct(subtotal)}
                        mono
                      />
                      {overallDiscAmt > 0 && (
                        <Row
                          label={Number(q.overallDiscountPct ?? 0) > 0 ? `Discount (${q.overallDiscountPct}%)` : "Special Discount"}
                          value={`(${acct(overallDiscAmt)})`}
                          className="text-red-600 dark:text-red-400"
                          mono
                        />
                      )}
                      {sstAmt > 0 && (
                        <Row label={`SST (${q.sstPct}%)`} value={acct(sstAmt)} mono />
                      )}
                      <div className="pt-1.5 border-t border-border flex justify-between items-center">
                        <span className="font-semibold">Grand Total</span>
                        <span className="font-bold text-sm tabular-nums">{acct(grandTotal)}</span>
                      </div>
                    </div>
                  );

                  return (
                    <>
                      {/* Desktop: table */}
                      <div className="hidden md:block overflow-x-auto">
                        <table className="w-full text-xs border-collapse">
                          <thead>
                            <tr className="bg-muted/10">
                              {[
                                "#",
                                "Code",
                                "Description",
                                "Qty/set",
                                "Total qty",
                                "UOM",
                                "Unit Price (RM)",
                                "Disc%",
                                "Total (RM)",
                                "",
                              ].map((h) => (
                                <th
                                  key={h}
                                  className={cn(
                                    "px-3 py-2 text-[10px] font-medium text-muted-foreground border-b border-border whitespace-nowrap uppercase tracking-wide",
                                    ["Unit Price (RM)", "Total (RM)"].includes(h)
                                      ? "text-right"
                                      : ["Qty/set", "Total qty", "UOM"].includes(h)
                                      ? "text-center"
                                      : "text-left",
                                  )}
                                >
                                  {h}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {entries.map((e) =>
                              e.kind === "group" ? renderGroupHeaderRow(e) : renderItemRow(e.item, e.inSet),
                            )}
                          </tbody>
                          {!!Number(q.showTotalPrice) && (
                            <tfoot>
                              {subtotalPerSet !== null && (
                                <tr className="border-t border-border">
                                  <td colSpan={8} className="px-3 py-1.5 text-right text-xs text-muted-foreground">Subtotal (1 set)</td>
                                  <td className="px-3 py-1.5 text-right text-xs tabular-nums">{acct(subtotalPerSet)}</td>
                                  <td />
                                </tr>
                              )}
                              <tr className={subtotalPerSet === null ? "border-t border-border" : ""}>
                                <td colSpan={8} className="px-3 py-1.5 text-right text-xs text-muted-foreground">
                                  {subtotalPerSet !== null ? `× ${sets} sets` : "Subtotal"}
                                </td>
                                <td className="px-3 py-1.5 text-right text-xs tabular-nums">{acct(subtotal)}</td>
                                <td />
                              </tr>
                              {overallDiscAmt > 0 && (
                                <tr>
                                  <td colSpan={8} className="px-3 py-1 text-right text-xs text-muted-foreground">
                                    {Number(q.overallDiscountPct ?? 0) > 0 ? `Discount (${q.overallDiscountPct}%)` : "Special Discount"}
                                  </td>
                                  <td className="px-3 py-1 text-right text-xs tabular-nums text-red-600 dark:text-red-400">({acct(overallDiscAmt)})</td>
                                  <td />
                                </tr>
                              )}
                              {sstAmt > 0 && (
                                <tr>
                                  <td colSpan={8} className="px-3 py-1 text-right text-xs text-muted-foreground">SST ({q.sstPct}%)</td>
                                  <td className="px-3 py-1 text-right text-xs tabular-nums">{acct(sstAmt)}</td>
                                  <td />
                                </tr>
                              )}
                              <tr className="border-t border-border">
                                <td colSpan={8} className="px-3 py-2 text-right text-xs font-semibold">Grand Total</td>
                                <td className="px-3 py-2 text-right text-sm font-bold tabular-nums">{acct(grandTotal)}</td>
                                <td />
                              </tr>
                            </tfoot>
                          )}
                        </table>
                      </div>

                      {/* Mobile: stacked cards */}
                      <div className="md:hidden">
                        {entries.map((e) =>
                          e.kind === "group" ? renderGroupHeaderCard(e) : renderItemCard(e.item, e.inSet),
                        )}
                        {mobileTotals}
                      </div>
                    </>
                  );
                })()}
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
              <Row label="Sales person" value={q.salesPersonName?.toLowerCase() ?? "—"} />
              <Row label="Prepared by" value={q.preparedByName ?? "—"} />
              <Row label="Valid until" value={fmtDate(q.validUntil)} />
              <Row label="Created" value={fmtDate(q.createdAt)} />
            </div>
          </div>

          {/* Pricing */}
          <div className="bg-background border border-border rounded-xl overflow-hidden">
            <div className="px-3 py-2.5 bg-muted/20 border-b border-border">
              <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Pricing
              </span>
            </div>
            <div className="p-3 space-y-2 text-xs">
              {subtotalPerSet !== null ? (
                <>
                  <Row label="Subtotal (1 set)" value={fmt(subtotalPerSet)} mono />
                  <Row label={`× ${sets} sets`} value={fmt(subtotal)} mono />
                </>
              ) : (
                <Row label="Subtotal" value={fmt(subtotal)} mono />
              )}

              {isDraft ? (
                <div className="rounded-lg border border-border divide-y divide-border mt-1">
                  {/* Total discount toggle */}
                  <div className="flex items-start gap-2.5 px-3 py-2.5">
                    <input
                      type="checkbox"
                      id="det-totalDisc"
                      checked={applyTotalDiscount}
                      onChange={(e) => {
                        const v = e.target.checked;
                        setApplyTotalDiscount(v);
                        saveSettings({ applyTotalDiscount: v });
                      }}
                      className="w-3.5 h-3.5 mt-0.5"
                    />
                    <div className="flex-1 space-y-2">
                      <label htmlFor="det-totalDisc" className="font-medium cursor-pointer">Apply discount</label>
                      {applyTotalDiscount && (
                        <div className="space-y-1.5">
                          <div className="flex gap-1">
                            {(["pct", "fixed"] as const).map((t) => (
                              <button
                                key={t}
                                type="button"
                                onClick={() => { setDiscountType(t); saveSettings({ discountType: t }); }}
                                className={`px-2 py-0.5 text-[10px] rounded border transition-colors ${discountType === t ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground"}`}
                              >
                                {t === "pct" ? "%" : "RM"}
                              </button>
                            ))}
                          </div>
                          <div className="flex items-center gap-1.5">
                            {discountType === "pct" ? (
                              <>
                                <Input
                                  type="number" value={overallDiscount}
                                  onChange={(e) => setOverallDiscount(e.target.value)}
                                  onBlur={() => saveSettings({ overallDiscount })}
                                  className="h-6 w-16 text-xs text-right" min="0" max="100"
                                />
                                <span className="text-muted-foreground">%</span>
                              </>
                            ) : (
                              <>
                                <span className="text-muted-foreground">RM</span>
                                <Input
                                  type="number" value={specialDiscAmt}
                                  onChange={(e) => setSpecialDiscAmt(e.target.value)}
                                  onBlur={() => saveSettings({ specialDiscAmt })}
                                  className="h-6 w-20 text-xs text-right" min="0"
                                />
                              </>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* SST toggle */}
                  <div className="flex items-center gap-2.5 px-3 py-2.5">
                    <input
                      type="checkbox"
                      id="det-sst"
                      checked={applySST}
                      onChange={(e) => {
                        const v = e.target.checked;
                        setApplySST(v);
                        saveSettings({ applySST: v });
                      }}
                      className="w-3.5 h-3.5"
                    />
                    <label htmlFor="det-sst" className="font-medium cursor-pointer flex-1">Apply SST</label>
                    {applySST && (
                      <div className="flex items-center gap-1.5">
                        <Input
                          type="number" value={sstPct}
                          onChange={(e) => setSstPct(e.target.value)}
                          onBlur={() => saveSettings({ sstPct })}
                          className="h-6 w-12 text-xs text-right" min="0"
                        />
                        <span className="text-muted-foreground">%</span>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <>
                  {overallDiscAmt > 0 && (
                    <Row
                      label={Number(q.overallDiscountPct ?? 0) > 0 ? `Discount (${q.overallDiscountPct}%)` : "Special Discount"}
                      value={`- ${fmt(overallDiscAmt)}`}
                      className="text-red-600 dark:text-red-400"
                      mono
                    />
                  )}
                  {overallDiscAmt > 0 && <Row label="After discount" value={fmt(afterDiscount)} mono />}
                  {sstAmt > 0 && <Row label={`SST (${q.sstPct}%)`} value={fmt(sstAmt)} mono />}
                </>
              )}

              <div className="pt-2 border-t border-border flex justify-between items-center">
                <span className="font-medium">Grand total</span>
                <span className="font-semibold text-base text-green-600 dark:text-green-400 tabular-nums">
                  {fmt(grandTotal)}
                </span>
              </div>
            </div>
          </div>

          {/* Document options */}
          <div className="bg-background border border-border rounded-xl overflow-hidden">
            <div className="px-3 py-2.5 bg-muted/20 border-b border-border flex items-center gap-2">
              <FileTextIcon className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Document options
              </span>
            </div>
            <div className="p-3 space-y-3 text-xs">
              <div className="space-y-1">
                <p className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground">Display</p>
                {([
                  { id: "det-ip",   label: "Itemized pricing",  val: showItemizedPricing,  set: setShowItemizedPricing,  key: "showItemizedPricing" as const },
                  { id: "det-pc",   label: "Product code",      val: showProductCode,       set: setShowProductCode,       key: "showProductCode" as const },
                  { id: "det-disc", label: "Itemized discount",  val: showItemizeDiscount,  set: setShowItemizeDiscount,  key: "showItemizeDiscount" as const },
                  { id: "det-tp",   label: "Total price",        val: showTotalPrice,        set: setShowTotalPrice,        key: "showTotalPrice" as const },
                  { id: "det-mda",  label: "MDA certificates",   val: includeMdaCerts,       set: setIncludeMdaCerts,       key: "includeMdaCerts" as const },
                ]).map(({ id, label, val, set, key }) => (
                  <label key={id} className="flex items-center gap-2 py-1 cursor-pointer">
                    <input type="checkbox" id={id} checked={val} onChange={(e) => { set(e.target.checked); saveDocumentOptions({ [key]: e.target.checked }); }} className="w-3.5 h-3.5" />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
              <div className="space-y-1">
                <p className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground">Attached Documents</p>
                {([
                  { id: "det-cat",  label: "Product catalogue",                val: includeCatalogue,     set: setIncludeCatalogue,     key: "includeCatalogue" as const },
                  { id: "det-mof",  label: "MOF Certificate",                  val: inclMof,              set: setInclMof,              key: "inclMof" as const },
                  { id: "det-ssm",  label: "SSM",                              val: inclSsm,              set: setInclSsm,              key: "inclSsm" as const },
                  { id: "det-tcc",  label: "TCC (Tax Compliance Certificate)", val: inclTcc,              set: setInclTcc,              key: "inclTcc" as const },
                  { id: "det-bank", label: "Bank Statement",                   val: inclBankStatement,    set: setInclBankStatement,    key: "inclBankStatement" as const },
                  { id: "det-mda2", label: "MDA Establishment",                val: inclMdaEstablishment, set: setInclMdaEstablishment, key: "inclMdaEstablishment" as const },
                  { id: "det-l12",  label: "Lampiran 12",                      val: inclLampiran12,       set: setInclLampiran12,       key: "inclLampiran12" as const },
                  { id: "det-l13",  label: "Lampiran 13",                      val: inclLampiran13,       set: setInclLampiran13,       key: "inclLampiran13" as const },
                ]).map(({ id, label, val, set, key }) => (
                  <label key={id} className="flex items-center gap-2 py-1 cursor-pointer">
                    <input type="checkbox" id={id} checked={val} onChange={(e) => { set(e.target.checked); saveDocumentOptions({ [key]: e.target.checked }); }} className="w-3.5 h-3.5" />
                    <span>{label}</span>
                  </label>
                ))}
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
