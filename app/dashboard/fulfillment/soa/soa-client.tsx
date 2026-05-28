"use client";

import { useState, useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { type SoaOrganization } from "@/server/invoice";
import { markSoaVerified } from "@/server/invoice";
import { type FullOrganizationProfile } from "@/server/organization-profile";
import { generateSoaPdf } from "./_pdf-soa";
import { PageHeader } from "@/components/page-header";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  SearchIcon,
  XIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CheckCircle2Icon,
  AlertCircleIcon,
  CircleIcon,
  BuildingIcon,
  ReceiptIcon,
  CheckIcon,
  DownloadIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Highlight } from "@/components/highlight";

// ── Formatters ─────────────────────────────────────────────────────────────

const fmtDate = (d: Date | string | null | undefined) =>
  d
    ? new Date(d).toLocaleDateString("en-MY", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "—";

const fmtMoney = (v: number | string) => {
  const n = typeof v === "string" ? parseFloat(v) : v;
  return (isNaN(n) ? 0 : n).toLocaleString("en-MY", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

// ── Status config ──────────────────────────────────────────────────────────

const INV_STATUS: Record<string, { label: string; cls: string; dot: string }> = {
  draft:     { label: "Draft",     cls: "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400",           dot: "bg-zinc-400" },
  sent:      { label: "Sent",      cls: "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400",         dot: "bg-blue-500" },
  paid:      { label: "Paid",      cls: "bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400",     dot: "bg-green-500" },
  overdue:   { label: "Overdue",   cls: "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400",             dot: "bg-red-500" },
  cancelled: { label: "Cancelled", cls: "bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-500",           dot: "bg-zinc-300" },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = INV_STATUS[status] ?? INV_STATUS.draft;
  return (
    <span className={cn("inline-flex items-center gap-1 text-[11px] font-medium rounded-full px-2 py-0.5", cfg.cls)}>
      <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", cfg.dot)} />
      {cfg.label}
    </span>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────

function Stat({ label, value, color, sub }: { label: string; value: string; color?: string; sub?: string }) {
  return (
    <div className="bg-background border border-border rounded-xl px-4 py-3 min-w-0">
      <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium truncate">{label}</p>
      <p className={cn("text-xl font-semibold tabular-nums truncate mt-0.5", color)}>{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

// ── Props ──────────────────────────────────────────────────────────────────

interface Props {
  soa: SoaOrganization[];
  permissions: string[];
  orgProfile: FullOrganizationProfile;
}

// ── Main component ─────────────────────────────────────────────────────────

export function SoaClient({ soa, permissions, orgProfile }: Props) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();
  const [isDownloading, setIsDownloading] = useState(false);

  const can = (p: string) => permissions.includes("*") || permissions.includes(p);

  // ── PDF download ───────────────────────────────────────────────────────────
  const handleDownloadPdf = async () => {
    if (isDownloading) return;
    setIsDownloading(true);
    try {
      const bytes = await generateSoaPdf(soa, orgProfile);
      const blob = new Blob([bytes.buffer as ArrayBuffer], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const today = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `SOA-${today}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      toast.error(`PDF failed: ${e.message}`);
    } finally {
      setIsDownloading(false);
    }
  };

  // ── Stats ──────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const totalHospitals = soa.length;
    const totalBilled = soa.reduce((s, o) => s + o.totalBilled, 0);
    const totalOutstanding = soa.reduce((s, o) => s + o.outstanding, 0);
    const totalOverdue = soa.reduce((s, o) => s + o.overdueCount, 0);
    const soaPending = soa.reduce((s, o) =>
      s + o.invoices.filter((i) => !i.soaVerified && i.status !== "draft" && i.status !== "cancelled").length, 0
    );
    return { totalHospitals, totalBilled, totalOutstanding, totalOverdue, soaPending };
  }, [soa]);

  // ── Filter ─────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return soa;
    return soa.filter((o) =>
      o.organizationName.toLowerCase().includes(q) ||
      o.invoices.some((i) =>
        i.invoiceNo.toLowerCase().includes(q) ||
        i.customerPoNo?.toLowerCase().includes(q) ||
        i.caseType?.toLowerCase().includes(q)
      )
    );
  }, [soa, search]);

  // ── Expand toggle ──────────────────────────────────────────────────────
  const toggleExpand = (name: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const expandAll = () => setExpanded(new Set(filtered.map((o) => o.organizationName)));
  const collapseAll = () => setExpanded(new Set());

  // ── Mark SOA verified ──────────────────────────────────────────────────
  const handleMarkVerified = (org: SoaOrganization, verified: boolean) => {
    const ids = org.invoices
      .filter((i) => i.status !== "draft" && i.status !== "cancelled")
      .map((i) => i.id);
    if (ids.length === 0) return;

    startTransition(async () => {
      try {
        await markSoaVerified(ids, verified);
        toast.success(verified ? `SOA verified for ${org.organizationName}` : `SOA unverified for ${org.organizationName}`);
        router.refresh();
      } catch (e: any) {
        toast.error(e.message);
      }
    });
  };

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="p-6 space-y-5">
      <PageHeader
        title="Statement of Account"
        description={`${orgProfile.companyName ?? orgProfile.name} — receivables by hospital`}
      />

      {/* Stats strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <Stat label="Hospitals" value={stats.totalHospitals.toString()} />
        <Stat label="Total billed" value={`MYR ${fmtMoney(stats.totalBilled)}`} />
        <Stat
          label="Outstanding"
          value={`MYR ${fmtMoney(stats.totalOutstanding)}`}
          color={stats.totalOutstanding > 0 ? "text-amber-600 dark:text-amber-400" : undefined}
        />
        <Stat
          label="Overdue"
          value={stats.totalOverdue.toString()}
          color={stats.totalOverdue > 0 ? "text-red-600 dark:text-red-400" : undefined}
        />
        <Stat
          label="SOA pending"
          value={stats.soaPending.toString()}
          color={stats.soaPending > 0 ? "text-amber-600 dark:text-amber-400" : undefined}
        />
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2.5">
        <div className="relative flex-1 min-w-0">
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search hospital, invoice no., case type…"
            className="pl-9 h-9 text-sm"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <XIcon className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={expandAll} className="shrink-0 h-9 text-xs">
          Expand all
        </Button>
        <Button variant="outline" size="sm" onClick={collapseAll} className="shrink-0 h-9 text-xs">
          Collapse all
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleDownloadPdf}
          disabled={isDownloading || soa.length === 0}
          className="shrink-0 h-9 text-xs gap-1.5"
        >
          <DownloadIcon className="w-3.5 h-3.5" />
          {isDownloading ? "Generating…" : "Download PDF"}
        </Button>
      </div>

      {/* Count */}
      <p className="text-xs text-muted-foreground -mt-2 tabular-nums">
        {filtered.length} hospital{filtered.length !== 1 ? "s" : ""}
        {search && ` · filtered from ${soa.length}`}
      </p>

      {/* Hospital cards */}
      {filtered.length === 0 ? (
        <div className="border border-border rounded-xl py-16 text-center text-muted-foreground">
          <BuildingIcon className="w-8 h-8 mx-auto mb-3 opacity-20" />
          <p className="text-sm font-medium">No hospitals found</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((org) => {
            const isExpanded = expanded.has(org.organizationName);
            const allVerified = org.invoices
              .filter((i) => i.status !== "draft" && i.status !== "cancelled")
              .every((i) => i.soaVerified);
            const noneVerified = org.invoices
              .filter((i) => i.status !== "draft" && i.status !== "cancelled")
              .every((i) => !i.soaVerified);

            return (
              <div key={org.organizationName} className="border border-border rounded-xl overflow-hidden bg-background">

                {/* Hospital header row */}
                <div
                  className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/20 transition-colors select-none"
                  onClick={() => toggleExpand(org.organizationName)}
                >
                  {/* Expand icon */}
                  <div className="shrink-0 text-muted-foreground">
                    {isExpanded
                      ? <ChevronDownIcon className="w-4 h-4" />
                      : <ChevronRightIcon className="w-4 h-4" />}
                  </div>

                  {/* Hospital name */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold truncate">
                        <Highlight text={org.organizationName} query={search} />
                      </span>
                      {/* SOA status icon */}
                      {allVerified ? (
                        <CheckCircle2Icon className="w-3.5 h-3.5 text-green-600 dark:text-green-400 shrink-0" />
                      ) : org.overdueCount > 0 ? (
                        <AlertCircleIcon className="w-3.5 h-3.5 text-red-500 shrink-0" />
                      ) : org.outstanding > 0 ? (
                        <AlertCircleIcon className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                      ) : (
                        <CircleIcon className="w-3.5 h-3.5 text-muted-foreground/30 shrink-0" />
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                      <span className="text-[11px] text-muted-foreground">
                        {org.invoices.length} invoice{org.invoices.length !== 1 ? "s" : ""}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        {org.soaVerifiedCount}/{org.invoices.filter((i) => i.status !== "draft" && i.status !== "cancelled").length} SOA verified
                      </span>
                    </div>
                  </div>

                  {/* Amounts */}
                  <div className="hidden sm:flex items-center gap-6 shrink-0">
                    <div className="text-right">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Billed</p>
                      <p className="text-sm font-mono tabular-nums font-medium">MYR {fmtMoney(org.totalBilled)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Collected</p>
                      <p className="text-sm font-mono tabular-nums text-green-700 dark:text-green-400">MYR {fmtMoney(org.totalPaid)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Outstanding</p>
                      <p className={cn(
                        "text-sm font-mono tabular-nums font-semibold",
                        org.outstanding > 0
                          ? org.overdueCount > 0
                            ? "text-red-600 dark:text-red-400"
                            : "text-amber-600 dark:text-amber-400"
                          : "text-muted-foreground",
                      )}>
                        MYR {fmtMoney(org.outstanding)}
                      </p>
                    </div>
                  </div>

                  {/* Mark SOA verified action */}
                  {can("invoice:update") && (
                    <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
                      {allVerified ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs gap-1.5 text-green-700 border-green-200 dark:border-green-800 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20"
                          disabled={isPending}
                          onClick={() => handleMarkVerified(org, false)}
                        >
                          <CheckCircle2Icon className="w-3 h-3" />
                          SOA Verified
                        </Button>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs gap-1.5"
                          disabled={isPending || noneVerified && org.invoices.filter(i => i.status !== "draft" && i.status !== "cancelled").length === 0}
                          onClick={() => handleMarkVerified(org, true)}
                        >
                          <CheckIcon className="w-3 h-3" />
                          Mark SOA
                        </Button>
                      )}
                    </div>
                  )}
                </div>

                {/* Invoice detail table */}
                {isExpanded && (
                  <div className="border-t border-border">
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs border-collapse">
                        <thead>
                          <tr className="bg-muted/30 border-b border-border">
                            <th className="px-3 py-2 text-left font-medium text-muted-foreground uppercase tracking-wider w-8">#</th>
                            <th className="px-3 py-2 text-left font-medium text-muted-foreground uppercase tracking-wider">Invoice No.</th>
                            <th className="px-3 py-2 text-left font-medium text-muted-foreground uppercase tracking-wider">Date</th>
                            <th className="px-3 py-2 text-left font-medium text-muted-foreground uppercase tracking-wider hidden md:table-cell">Customer PO</th>
                            <th className="px-3 py-2 text-left font-medium text-muted-foreground uppercase tracking-wider hidden lg:table-cell">Case</th>
                            <th className="px-3 py-2 text-left font-medium text-muted-foreground uppercase tracking-wider hidden lg:table-cell">MRN</th>
                            <th className="px-3 py-2 text-left font-medium text-muted-foreground uppercase tracking-wider">Status</th>
                            <th className="px-3 py-2 text-right font-medium text-muted-foreground uppercase tracking-wider">Amount</th>
                            <th className="px-3 py-2 text-right font-medium text-muted-foreground uppercase tracking-wider hidden sm:table-cell">Outstanding</th>
                            <th className="px-3 py-2 text-center font-medium text-muted-foreground uppercase tracking-wider w-10">SOA</th>
                          </tr>
                        </thead>
                        <tbody>
                          {org.invoices.map((inv, idx) => {
                            const outstanding =
                              inv.status === "paid" || inv.status === "cancelled"
                                ? 0
                                : Math.max(0, parseFloat(inv.grandTotal || "0") - parseFloat(inv.paidAmount || "0"));

                            return (
                              <tr
                                key={inv.id}
                                onClick={() => router.push(`/dashboard/fulfillment/invoice/${inv.id}`)}
                                className="border-b border-border last:border-0 cursor-pointer hover:bg-muted/20 transition-colors"
                              >
                                <td className="px-3 py-2 text-muted-foreground tabular-nums">{idx + 1}</td>
                                <td className="px-3 py-2">
                                  <span className="font-mono font-medium text-foreground">
                                    <Highlight text={inv.invoiceNo} query={search} />
                                  </span>
                                </td>
                                <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{fmtDate(inv.invoiceDate)}</td>
                                <td className="px-3 py-2 font-mono text-muted-foreground hidden md:table-cell">
                                  {inv.customerPoNo
                                    ? <Highlight text={inv.customerPoNo} query={search} />
                                    : <span className="text-muted-foreground/40">—</span>}
                                </td>
                                <td className="px-3 py-2 hidden lg:table-cell">
                                  {inv.caseType ? (
                                    <>
                                      <span className="font-medium"><Highlight text={inv.caseType} query={search} /></span>
                                      {inv.caseDate && <div className="text-[10px] text-muted-foreground">{fmtDate(inv.caseDate)}</div>}
                                    </>
                                  ) : <span className="text-muted-foreground/40">—</span>}
                                </td>
                                <td className="px-3 py-2 font-mono text-muted-foreground hidden lg:table-cell">
                                  {inv.mrnNo || <span className="text-muted-foreground/40">—</span>}
                                </td>
                                <td className="px-3 py-2 whitespace-nowrap">
                                  <StatusBadge status={inv.status} />
                                  {inv.paidAt && (
                                    <div className="text-[10px] text-muted-foreground mt-0.5">{fmtDate(inv.paidAt)}</div>
                                  )}
                                </td>
                                <td className="px-3 py-2 text-right font-mono tabular-nums font-medium whitespace-nowrap">
                                  {fmtMoney(inv.grandTotal)}
                                </td>
                                <td className="px-3 py-2 text-right hidden sm:table-cell whitespace-nowrap">
                                  {outstanding > 0 ? (
                                    <span className={cn(
                                      "font-mono tabular-nums font-medium",
                                      inv.status === "overdue"
                                        ? "text-red-600 dark:text-red-400"
                                        : "text-amber-600 dark:text-amber-400",
                                    )}>
                                      {fmtMoney(outstanding)}
                                    </span>
                                  ) : (
                                    <span className="text-muted-foreground/40">—</span>
                                  )}
                                </td>
                                <td className="px-3 py-2 text-center">
                                  {inv.soaVerified ? (
                                    <CheckCircle2Icon className="w-3.5 h-3.5 text-green-600 dark:text-green-400 mx-auto" />
                                  ) : inv.status !== "draft" && inv.status !== "cancelled" ? (
                                    <AlertCircleIcon className="w-3.5 h-3.5 text-amber-500 mx-auto opacity-70" />
                                  ) : (
                                    <CircleIcon className="w-3.5 h-3.5 text-muted-foreground/20 mx-auto" />
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>

                        {/* Footer totals */}
                        <tfoot>
                          <tr className="bg-muted/20 border-t border-border">
                            <td colSpan={7} className="px-3 py-2 font-medium text-muted-foreground">
                              {org.invoices.length} invoice{org.invoices.length !== 1 ? "s" : ""}
                            </td>
                            <td className="px-3 py-2 text-right font-mono tabular-nums font-semibold whitespace-nowrap">
                              {fmtMoney(org.totalBilled)}
                            </td>
                            <td className="px-3 py-2 text-right hidden sm:table-cell whitespace-nowrap">
                              {org.outstanding > 0 ? (
                                <span className={cn(
                                  "font-mono tabular-nums font-semibold",
                                  org.overdueCount > 0
                                    ? "text-red-600 dark:text-red-400"
                                    : "text-amber-600 dark:text-amber-400",
                                )}>
                                  {fmtMoney(org.outstanding)}
                                </span>
                              ) : (
                                <span className="text-muted-foreground/40">—</span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-center">
                              <span className="text-[10px] text-muted-foreground tabular-nums">
                                {org.soaVerifiedCount}/{org.invoices.filter(i => i.status !== "draft" && i.status !== "cancelled").length}
                              </span>
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
