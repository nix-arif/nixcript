"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import type { ClaimApplicationWithDetails } from "@/server/claim";
import { CLAIM_FORM } from "@/lib/claim/constants";
import { ClipboardListIcon, PrinterIcon, SearchIcon, ArrowUpIcon, ArrowDownIcon, ArrowUpDownIcon } from "lucide-react";

const FORM_LABELS: Record<string, string> = {
  LOCAL: "Local Reimbursement",
  OVERSEAS: "Overseas Expenses",
  ENTERTAINMENT_FORM: "Entertainment",
};

function fmtAmount(v: string | number): string {
  return `RM ${parseFloat(String(v)).toFixed(2)}`;
}

function fmtClaimDate(claimDate: string, formType: string | null): string {
  if ((formType === CLAIM_FORM.LOCAL || formType === CLAIM_FORM.OVERSEAS) && /^\d{4}-\d{2}-01$/.test(claimDate)) {
    const [year, month] = claimDate.split("-");
    return new Date(parseInt(year), parseInt(month) - 1, 1).toLocaleDateString("en-MY", { month: "long", year: "numeric" });
  }
  return claimDate;
}

function fmtSubmittedDate(createdAt: string | Date): string {
  return new Date(createdAt).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" });
}

type SortKey = "applicant" | "period" | "submitted";

function sortApplications(apps: ClaimApplicationWithDetails[], sortKey: SortKey | null, sortDir: "asc" | "desc"): ClaimApplicationWithDetails[] {
  if (!sortKey) return apps;
  const sorted = [...apps].sort((a, b) => {
    if (sortKey === "applicant") return (a.applicantName ?? "").localeCompare(b.applicantName ?? "");
    if (sortKey === "period") return a.claimDate.localeCompare(b.claimDate);
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });
  return sortDir === "asc" ? sorted : sorted.reverse();
}

function SortableHeader({ label, sortKey, activeKey, dir, onSort, className }: {
  label: string; sortKey: SortKey; activeKey: SortKey | null; dir: "asc" | "desc";
  onSort: (key: SortKey) => void; className?: string;
}) {
  const active = activeKey === sortKey;
  return (
    <TableHead className={className}>
      <button type="button" onClick={() => onSort(sortKey)} className="flex items-center gap-1 hover:text-foreground">
        {label}
        {active ? (dir === "asc" ? <ArrowUpIcon className="h-3 w-3"/> : <ArrowDownIcon className="h-3 w-3"/>) : <ArrowUpDownIcon className="h-3 w-3 opacity-40"/>}
      </button>
    </TableHead>
  );
}

function getFormType(app: ClaimApplicationWithDetails): string | null {
  if (app.entertainmentDetails.length > 0) return CLAIM_FORM.ENTERTAINMENT_FORM;
  if (app.lineItems.length === 0) return null;
  const cat = app.lineItems[0].category;
  if (cat.startsWith("OVERSEAS")) return CLAIM_FORM.OVERSEAS;
  return CLAIM_FORM.LOCAL;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    DRAFT:     "bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-100 dark:bg-slate-800/50 dark:text-slate-400 dark:border-slate-600",
    PENDING:   "bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-100 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-700",
    CHECKED:   "bg-blue-100 text-blue-800 border-blue-200 hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-700",
    APPROVED:  "bg-green-100 text-green-800 border-green-200 hover:bg-green-100 dark:bg-green-900/30 dark:text-green-400 dark:border-green-700",
    REJECTED:  "bg-red-100 text-red-800 border-red-200 hover:bg-red-100 dark:bg-red-900/30 dark:text-red-400 dark:border-red-700",
    CANCELLED: "bg-muted text-muted-foreground border-border hover:bg-muted",
  };
  const labels: Record<string, string> = { DRAFT: "Draft", PENDING: "Pending", CHECKED: "Checked", APPROVED: "Approved", REJECTED: "Rejected", CANCELLED: "Cancelled" };
  return <Badge className={`border text-xs ${map[status] ?? "border-border"}`}>{labels[status] ?? status}</Badge>;
}

interface Props {
  applications: ClaimApplicationWithDetails[];
}

export function AllClaimsClient({ applications }: Props) {
  const [search, setSearch] = useState("");
  const [downloadingPdfId, setDownloadingPdfId] = useState<string | null>(null);

  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  function handleSort(key: SortKey) {
    if (sortKey === key) { setSortDir(d => d === "asc" ? "desc" : "asc"); }
    else { setSortKey(key); setSortDir("asc"); }
  }

  // Downloads a claim's PDF, surfacing the server's actual error text on failure
  // instead of leaving the user with a blank tab or a silent failed download.
  async function handleDownloadPdf(appId: string, applicationNo: string) {
    setDownloadingPdfId(appId);
    try {
      const res = await fetch(`/api/claim/${appId}/pdf`);
      if (!res.ok) {
        const text = (await res.text().catch(() => "")).trim();
        throw new Error(text || `Failed to download PDF (HTTP ${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Claim-${applicationNo}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to download PDF");
    } finally {
      setDownloadingPdfId(null);
    }
  }

  const filtered = applications.filter((app) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      app.applicationNo.toLowerCase().includes(q) ||
      (app.applicantName ?? "").toLowerCase().includes(q) ||
      app.claimTypeName.toLowerCase().includes(q)
    );
  });
  const sorted = sortApplications(filtered, sortKey, sortDir);

  return (
    <div className="p-6 flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <ClipboardListIcon className="h-5 w-5 text-muted-foreground" />
          All Claims
        </h1>
        <p className="text-sm text-muted-foreground">
          Every claim submitted across the organisation, regardless of status.
        </p>
      </div>

      <div className="relative max-w-sm">
        <SearchIcon className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by ref no., applicant, or claim type…"
          className="w-full h-8 pl-8 pr-2 border border-input rounded-md text-sm bg-background outline-none focus:ring-1 focus:ring-ring"
        />
      </div>

      {sorted.length === 0 ? (
        <div className="rounded-lg border border-border py-14 flex items-center justify-center text-sm text-muted-foreground">
          No claims found.
        </div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40">
                <TableHead className="w-32">Ref No.</TableHead>
                <SortableHeader label="Applicant" sortKey="applicant" activeKey={sortKey} dir={sortDir} onSort={handleSort}/>
                <TableHead>Claim Type</TableHead>
                <SortableHeader label="Period / Date" sortKey="period" activeKey={sortKey} dir={sortDir} onSort={handleSort} className="w-32"/>
                <SortableHeader label="Submitted" sortKey="submitted" activeKey={sortKey} dir={sortDir} onSort={handleSort} className="w-28"/>
                <TableHead className="w-28 text-right">Amount</TableHead>
                <TableHead className="w-24">Status</TableHead>
                <TableHead className="w-16 text-right">PDF</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((app) => {
                const ft = getFormType(app);
                return (
                  <TableRow key={app.id}>
                    <TableCell className="font-mono text-xs text-muted-foreground">{app.applicationNo}</TableCell>
                    <TableCell className="text-sm">{app.applicantName ?? "—"}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-sm font-medium">{app.claimTypeName}</span>
                        {ft && <Badge variant="outline" className="text-xs px-1.5 py-0 h-5">{FORM_LABELS[ft] ?? ft}</Badge>}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{fmtClaimDate(app.claimDate, ft)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{fmtSubmittedDate(app.createdAt)}</TableCell>
                    <TableCell className="text-right text-sm font-semibold">{fmtAmount(app.amount)}</TableCell>
                    <TableCell><StatusBadge status={app.status} /></TableCell>
                    <TableCell className="text-right">
                      {app.status !== "DRAFT" && (
                        <Button
                          variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                          title={downloadingPdfId === app.id ? "Generating PDF…" : "Download PDF"}
                          disabled={downloadingPdfId === app.id}
                          onClick={() => handleDownloadPdf(app.id, app.applicationNo)}
                        >
                          {downloadingPdfId === app.id ? (
                            <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin"/>
                          ) : (
                            <PrinterIcon className="h-3.5 w-3.5"/>
                          )}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
