"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ClaimApplicationWithDetails } from "@/server/claim";
import { approveClaim, rejectClaim } from "@/server/claim";
import { CLAIM_FORM, LINE_CATEGORY } from "@/lib/claim/constants";
import {
  CheckIcon, XIcon, FileDownIcon, CheckCircle2Icon, ClipboardCheckIcon,
  ArrowRightIcon, MapPinIcon, EyeIcon, PrinterIcon,
} from "lucide-react";
import { EditBadge, SlashBadge } from "@/components/claim/line-item-annotations";

// ── Helpers ────────────────────────────────────────────────────────────────

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

function getFormType(app: ClaimApplicationWithDetails): string | null {
  if (app.entertainmentDetails && app.entertainmentDetails.length > 0) return CLAIM_FORM.ENTERTAINMENT_FORM;
  if (app.lineItems.length === 0) return null;
  const cat = app.lineItems[0].category;
  if (cat.startsWith("OVERSEAS")) return CLAIM_FORM.OVERSEAS;
  return CLAIM_FORM.LOCAL;
}

const FORM_LABELS: Record<string, string> = {
  LOCAL: "Local Reimbursement",
  OVERSEAS: "Overseas Expenses",
  ENTERTAINMENT_FORM: "Entertainment",
};

const SECTION_LABELS: Record<string, string> = {
  [LINE_CATEGORY.TRAVEL]:                "1.1 Travel Expenses",
  [LINE_CATEGORY.TRAVEL_ACCOMMODATION]:  "1.1.1 Accommodation",
  [LINE_CATEGORY.TRAVEL_DAILY_ALLOWANCE]:"1.1.2 Daily Allowance",
  [LINE_CATEGORY.TRAVEL_ENTERTAINMENT]:  "1.1.3 Travel Entertainment",
  [LINE_CATEGORY.TOLL]:                  "1.2.1 Toll / Touch N Go",
  [LINE_CATEGORY.PARKING]:               "1.2.2 Parking",
  [LINE_CATEGORY.MOBILE]:                "1.2.3 Mobile Phone",
  [LINE_CATEGORY.IN_BASE_ENT]:           "1.3 In-Base Entertainment",
  [LINE_CATEGORY.OTHER_LOCAL]:           "1.4 Other Expenses",
  [LINE_CATEGORY.OVERSEAS_MYR]:          "2.1 Travel (MYR)",
  [LINE_CATEGORY.OVERSEAS_FX]:           "2.2 Travel (Foreign Currency)",
  [LINE_CATEGORY.OVERSEAS_OTHER]:        "2.3 Other Expenses",
};

// ── Line Item Detail ───────────────────────────────────────────────────────

function LineItemDetail({ items }: { items: ClaimApplicationWithDetails["lineItems"] }) {
  if (items.length === 0) return null;

  const groups: Record<string, typeof items> = {};
  for (const item of items) {
    if (!groups[item.category]) groups[item.category] = [];
    groups[item.category].push(item);
  }
  const grandTotal = items.reduce((s, r) => s + (r.slashed ? 0 : parseFloat(r.amountMyr)), 0);
  const hasSlashed = items.some((r) => r.slashed);

  return (
    <div className="rounded-md border border-border overflow-hidden">
      {Object.entries(groups).map(([cat, rows]) => {
        const subtotal = rows.reduce((s, r) => s + (r.slashed ? 0 : parseFloat(r.amountMyr)), 0);
        return (
          <div key={cat}>
            <div className="px-3 py-2 bg-muted/40 border-b border-border flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground">{SECTION_LABELS[cat] ?? cat}</span>
              <span className="text-xs font-semibold">{fmtAmount(subtotal)}</span>
            </div>
            <div className="divide-y divide-border">
              {rows.map((item, i) => {
                const arCls = item.slashed ? "line-through opacity-50" : "";
                return (
                  <div key={item.id} className="px-3 py-2.5 flex flex-col gap-1 text-xs">
                    <div className="flex items-start gap-2">
                      <span className="text-muted-foreground w-4 shrink-0">{i + 1}.</span>
                      <div className={`flex-1 flex flex-col gap-0.5 min-w-0 ${arCls}`}>
                        {cat === LINE_CATEGORY.TRAVEL ? (
                          <div className="flex items-center gap-1 text-foreground font-medium">
                            <MapPinIcon className="h-3 w-3 text-muted-foreground shrink-0"/>
                            <span className="truncate">{item.fromLocation}</span>
                            <ArrowRightIcon className="h-3 w-3 text-muted-foreground shrink-0"/>
                            <span className="truncate">{item.toLocation}</span>
                          </div>
                        ) : cat === LINE_CATEGORY.OVERSEAS_FX ? (
                          <div className="text-foreground font-medium">
                            {item.destination && <span className="mr-1">{item.destination}</span>}
                            <span className="text-muted-foreground">
                              {item.amountForeign} {item.currency} × {item.exchangeRate}
                            </span>
                          </div>
                        ) : (
                          <span className="text-foreground font-medium truncate">
                            {item.venue
                              ? `${item.venue}${item.description ? ` — ${item.description}` : ""}`
                              : item.destination
                                ? `${item.destination}${item.description ? ` — ${item.description}` : ""}`
                                : item.description}
                          </span>
                        )}
                        <span className="text-muted-foreground">
                          {item.lineDate}
                          {cat === LINE_CATEGORY.TRAVEL && item.distanceKm && ` · ${item.distanceKm} km`}
                        </span>
                      </div>
                      <span className={`text-green-700 dark:text-green-400 font-medium shrink-0 ${arCls}`}>{fmtAmount(item.amountMyr)}</span>
                    </div>
                    {item.slashed && (
                      <div className="pl-6">
                        <SlashBadge slashedByName={item.slashedByName} slashedAt={item.slashedAt} slashReason={item.slashReason}/>
                      </div>
                    )}
                    {item.editedBy && (
                      <div className="pl-6">
                        <EditBadge
                          editedByName={item.editedByName}
                          editedAt={item.editedAt}
                          editReason={item.editReason}
                          amountChange={item.originalAmountMyr ? { from: item.originalAmountMyr, to: item.amountMyr } : null}
                          descriptionChange={item.originalDescription !== null ? { from: item.originalDescription, to: item.description } : null}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
      <div className="px-3 py-2 border-t-2 border-border bg-muted/20 flex items-center justify-between">
        <span className="text-xs font-semibold">
          Items Total{hasSlashed && <span className="text-muted-foreground font-normal"> (excludes slashed)</span>}
        </span>
        <span className="text-sm font-bold text-green-700 dark:text-green-400">{fmtAmount(grandTotal)}</span>
      </div>
    </div>
  );
}

// ── Documents Section ──────────────────────────────────────────────────────

function DocumentsSection({ documents }: { documents: ClaimApplicationWithDetails["documents"] }) {
  if (documents.length === 0) return (
    <p className="text-xs text-muted-foreground italic">No documents attached.</p>
  );
  return (
    <div className="flex flex-col gap-1.5">
      {documents.map((doc) => (
        <a
          key={doc.id}
          href={`/api/claim/download/${doc.fileKey}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-xs hover:bg-muted/50 transition-colors group"
        >
          <FileDownIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0 group-hover:text-primary"/>
          <span className="flex-1 truncate text-foreground font-medium">{doc.fileName}</span>
          <span className="text-muted-foreground shrink-0">
            {doc.fileSize ? `${(doc.fileSize / 1024).toFixed(0)} KB` : ""}
          </span>
          <span className="text-blue-600 dark:text-blue-400 shrink-0 font-medium">Download</span>
        </a>
      ))}
    </div>
  );
}

// ── Claim Detail Content (shared by View + Approve sheets) ─────────────────

function ClaimDetailContent({ app }: { app: ClaimApplicationWithDetails }) {
  const ft = getFormType(app);
  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="rounded-md bg-muted/40 border border-border p-4 space-y-1.5 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Applicant</span>
          <span className="font-medium">{app.applicantName ?? "—"}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Ref No.</span>
          <span className="font-mono text-xs font-medium">{app.applicationNo}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Claim type</span>
          <span className="font-medium">{app.claimTypeName}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Period / Date</span>
          <span className="font-medium">{fmtClaimDate(app.claimDate, ft)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Submitted</span>
          <span className="font-medium">{fmtSubmittedDate(app.createdAt)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Total Amount</span>
          <span className="font-bold text-green-700 dark:text-green-400">{fmtAmount(app.amount)}</span>
        </div>
        {app.description && (
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground shrink-0">Note</span>
            <span className="text-right text-xs">{app.description}</span>
          </div>
        )}
      </div>

      {/* Line items */}
      {app.lineItems.length > 0 && <LineItemDetail items={app.lineItems}/>}

      {/* Entertainment details */}
      {app.entertainmentDetails && app.entertainmentDetails.length > 0 && (
        <div className="rounded-md border border-border overflow-hidden text-sm">
          <div className="px-3 py-2 bg-muted/40 border-b border-border text-xs font-semibold text-muted-foreground">
            Entertainment Details ({app.entertainmentDetails.length})
          </div>
          {app.entertainmentDetails.map((ed, idx) => {
            const arCls = ed.slashed ? "line-through opacity-50" : "";
            return (
              <div key={ed.id} className="divide-y divide-border border-t border-border first:border-t-0">
                {app.entertainmentDetails.length > 1 && (
                  <div className="px-3 py-1.5 bg-muted/20 text-[10px] font-semibold text-muted-foreground uppercase">Entry {idx + 1}</div>
                )}
                {[
                  ["Date", ed.eventDate],
                  ["Restaurant / Venue", ed.restaurantName],
                  ["Customer", ed.customerName],
                  ["Dept & Org", ed.departmentOrganization],
                  ["Purpose", ed.purpose],
                  ["Amount", fmtAmount(ed.amount)],
                ].map(([label, value]) => (
                  <div key={label} className={`px-3 py-2 flex justify-between gap-4 ${arCls}`}>
                    <span className="text-muted-foreground shrink-0 text-xs">{label}</span>
                    <span className="text-right text-xs font-medium">{value}</span>
                  </div>
                ))}
                {ed.slashed && (
                  <div className="px-3 py-2">
                    <SlashBadge slashedByName={ed.slashedByName} slashedAt={ed.slashedAt} slashReason={ed.slashReason}/>
                  </div>
                )}
                {ed.editedBy && (
                  <div className="px-3 py-2">
                    <EditBadge
                      editedByName={ed.editedByName}
                      editedAt={ed.editedAt}
                      editReason={ed.editReason}
                      amountChange={ed.originalAmount ? { from: ed.originalAmount, to: ed.amount } : null}
                      descriptionChange={ed.originalPurpose !== null ? { from: ed.originalPurpose, to: ed.purpose } : null}
                    />
                  </div>
                )}
              </div>
            );
          })}
          {app.entertainmentDetails.length > 1 && (
            <div className="px-3 py-2 border-t-2 border-border bg-muted/20 flex items-center justify-between">
              <span className="text-xs font-semibold">
                Entries Total
                {app.entertainmentDetails.some((ed) => ed.slashed) && <span className="text-muted-foreground font-normal"> (excludes slashed)</span>}
              </span>
              <span className="text-sm font-bold text-green-700 dark:text-green-400">
                {fmtAmount(app.entertainmentDetails.reduce((s, ed) => s + (ed.slashed ? 0 : parseFloat(ed.amount)), 0))}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Documents */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
          Receipts & Documents ({app.documents.length})
        </p>
        <DocumentsSection documents={app.documents}/>
      </div>
    </div>
  );
}

// ── Component ──────────────────────────────────────────────────────────────

interface Props {
  applications: ClaimApplicationWithDetails[];
  permissions: string[];
}

export function ClaimApprovalsClient({ applications, permissions: _permissions }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [viewTarget, setViewTarget] = useState<ClaimApplicationWithDetails | null>(null);
  const [downloadingPdfId, setDownloadingPdfId] = useState<string | null>(null);

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

  const [approveTarget, setApproveTarget] = useState<ClaimApplicationWithDetails | null>(null);
  const [approveComment, setApproveComment] = useState("");
  const [approving, setApproving] = useState(false);

  const [rejectTarget, setRejectTarget] = useState<ClaimApplicationWithDetails | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [rejecting, setRejecting] = useState(false);

  async function handleApprove() {
    if (!approveTarget) return;
    setApproving(true);
    try {
      await approveClaim(approveTarget.id, approveComment.trim() || undefined);
      toast.success(`Claim approved for ${approveTarget.applicantName ?? "applicant"}`);
      setApproveTarget(null); setApproveComment("");
      startTransition(() => router.refresh());
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to approve");
    } finally { setApproving(false); }
  }

  async function handleReject() {
    if (!rejectTarget) return;
    if (!rejectReason.trim()) { toast.error("Please provide a rejection reason"); return; }
    setRejecting(true);
    try {
      await rejectClaim(rejectTarget.id, rejectReason.trim());
      toast.success(`Claim rejected for ${rejectTarget.applicantName ?? "applicant"}`);
      setRejectTarget(null); setRejectReason("");
      startTransition(() => router.refresh());
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to reject");
    } finally { setRejecting(false); }
  }

  return (
    <div className="p-6 flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <ClipboardCheckIcon className="h-5 w-5 text-muted-foreground"/>Claim Approvals
          </h1>
          <p className="text-sm text-muted-foreground">Review and action pending expense claims.</p>
        </div>
        {applications.length > 0 && (
          <Badge className="bg-amber-100 text-amber-800 border border-amber-200 hover:bg-amber-100 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-700">
            {applications.length} pending
          </Badge>
        )}
      </div>

      {applications.length === 0 ? (
        <div className="rounded-lg border border-border py-16 flex flex-col items-center gap-3 text-center">
          <CheckCircle2Icon className="h-10 w-10 text-green-400"/>
          <div>
            <p className="font-semibold text-foreground">All caught up!</p>
            <p className="text-sm text-muted-foreground mt-0.5">No pending claim applications at this time.</p>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40">
                <TableHead className="w-40">Applicant</TableHead>
                <TableHead>Claim Type</TableHead>
                <TableHead className="w-32">Period / Date</TableHead>
                <TableHead className="w-28">Submitted</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="w-28 text-right">Amount</TableHead>
                <TableHead className="w-44 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {applications.map(app => {
                const ft = getFormType(app);
                return (
                  <TableRow key={app.id}>
                    <TableCell>
                      <div className="flex flex-col gap-0.5">
                        <span className="text-sm font-medium leading-snug">{app.applicantName ?? "Unknown"}</span>
                        <span className="font-mono text-xs text-muted-foreground">{app.applicationNo}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-sm font-medium">{app.claimTypeName}</span>
                        {ft && <Badge variant="outline" className="text-xs px-1.5 py-0 h-5">{FORM_LABELS[ft] ?? ft}</Badge>}
                        {app.lineItems.length > 0 && (
                          <Badge variant="outline" className="text-xs px-1.5 py-0 h-5">
                            {app.lineItems.length} items
                          </Badge>
                        )}
                        {app.documents.length > 0 && (
                          <Badge variant="outline" className="text-xs px-1.5 py-0 h-5 text-blue-600 border-blue-200 bg-blue-50 dark:text-blue-400 dark:border-blue-700 gap-1">
                            <FileDownIcon className="h-2.5 w-2.5"/>{app.documents.length} doc{app.documents.length > 1 ? "s" : ""}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                      {fmtClaimDate(app.claimDate, ft)}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                      {fmtSubmittedDate(app.createdAt)}
                    </TableCell>
                    <TableCell className="max-w-xs">
                      <p className="text-sm text-muted-foreground truncate" title={app.description ?? ""}>{app.description}</p>
                    </TableCell>
                    <TableCell className="text-right text-sm font-semibold">{fmtAmount(app.amount)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => setViewTarget(app)}>
                          <EyeIcon className="h-3 w-3"/>View
                        </Button>
                        <Button
                          size="sm" variant="outline" className="h-7 w-7 p-0"
                          title={downloadingPdfId === app.id ? "Generating PDF…" : "Download PDF"}
                          disabled={downloadingPdfId === app.id}
                          onClick={() => handleDownloadPdf(app.id, app.applicationNo)}
                        >
                          {downloadingPdfId === app.id ? (
                            <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin"/>
                          ) : (
                            <PrinterIcon className="h-3 w-3"/>
                          )}
                        </Button>
                        <Button size="sm" className="h-7 gap-1 bg-green-600 hover:bg-green-700 text-white text-xs" onClick={() => { setApproveTarget(app); setApproveComment(""); }}>
                          <CheckIcon className="h-3 w-3"/>Approve
                        </Button>
                        <Button size="sm" variant="destructive" className="h-7 gap-1 text-xs" onClick={() => { setRejectTarget(app); setRejectReason(""); }}>
                          <XIcon className="h-3 w-3"/>Reject
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* View Sheet */}
      <Sheet open={!!viewTarget} onOpenChange={open => !open && setViewTarget(null)}>
        <SheetContent className="w-full sm:max-w-xl max-w-full! overflow-y-auto px-8">
          <SheetHeader className="mb-5"><SheetTitle>Claim Details</SheetTitle></SheetHeader>
          {viewTarget && <ClaimDetailContent app={viewTarget}/>}
          <div className="flex gap-2 pt-6">
            <Button
              className="flex-1 bg-green-600 hover:bg-green-700 text-white"
              onClick={() => { setApproveTarget(viewTarget); setApproveComment(""); setViewTarget(null); }}
            >
              <CheckIcon className="h-3.5 w-3.5 mr-1.5"/>Approve
            </Button>
            <Button
              variant="destructive"
              className="flex-1"
              onClick={() => { setRejectTarget(viewTarget); setRejectReason(""); setViewTarget(null); }}
            >
              <XIcon className="h-3.5 w-3.5 mr-1.5"/>Reject
            </Button>
            <Button variant="outline" onClick={() => setViewTarget(null)}>Close</Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* Approve Sheet */}
      <Sheet open={!!approveTarget} onOpenChange={open => !open && setApproveTarget(null)}>
        <SheetContent className="w-full sm:max-w-xl max-w-full! overflow-y-auto px-8">
          <SheetHeader className="mb-5"><SheetTitle>Approve Claim</SheetTitle></SheetHeader>
          {approveTarget && (
            <div className="space-y-4">
              <ClaimDetailContent app={approveTarget}/>
              <div className="space-y-1.5">
                <Label htmlFor="approveComment">Comment <span className="text-muted-foreground font-normal text-xs">(optional)</span></Label>
                <Textarea id="approveComment" value={approveComment} onChange={e => setApproveComment(e.target.value)} placeholder="Add an optional note for the employee…" rows={3}/>
              </div>
              <div className="flex gap-2 pt-2">
                <Button className="flex-1 bg-green-600 hover:bg-green-700 text-white" onClick={handleApprove} disabled={approving}>
                  {approving ? "Approving…" : "Approve Claim"}
                </Button>
                <Button variant="outline" onClick={() => setApproveTarget(null)} disabled={approving}>Cancel</Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Reject Sheet */}
      <Sheet open={!!rejectTarget} onOpenChange={open => !open && setRejectTarget(null)}>
        <SheetContent className="w-full sm:max-w-md max-w-lg! overflow-y-auto px-10">
          <SheetHeader className="mb-5"><SheetTitle>Reject Claim</SheetTitle></SheetHeader>
          {rejectTarget && (
            <div className="space-y-4">
              <div className="rounded-md bg-muted/40 border border-border p-4 space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Applicant</span>
                  <span className="font-medium">{rejectTarget.applicantName ?? "—"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Claim type</span>
                  <span className="font-medium">{rejectTarget.claimTypeName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Amount</span>
                  <span className="font-medium">{fmtAmount(rejectTarget.amount)}</span>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rejectReason">Rejection Reason <span className="text-destructive">*</span></Label>
                <Textarea id="rejectReason" value={rejectReason} onChange={e => setRejectReason(e.target.value)} placeholder="Provide a reason for rejection (required)…" rows={3} required/>
              </div>
              <div className="flex gap-2 pt-2">
                <Button variant="destructive" className="flex-1" onClick={handleReject} disabled={rejecting || !rejectReason.trim()}>
                  {rejecting ? "Rejecting…" : "Reject Claim"}
                </Button>
                <Button variant="outline" onClick={() => setRejectTarget(null)} disabled={rejecting}>Cancel</Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
