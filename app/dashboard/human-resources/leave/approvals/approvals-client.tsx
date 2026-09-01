"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { LeaveApplicationWithDetails, LeaveCreditRequestWithDetails } from "@/server/leave";
import {
  approveLeave, rejectLeave,
  approveReplacementCredit, rejectReplacementCredit,
} from "@/server/leave";
import {
  CheckIcon,
  XIcon,
  EyeIcon,
  FileDownIcon,
  CheckCircle2Icon,
  ClipboardCheckIcon,
} from "lucide-react";

// ── Helpers ────────────────────────────────────────────────────────────────

function formatDays(n: string | number): string {
  const v = parseFloat(String(n));
  return v % 1 === 0 ? String(Math.round(v)) : v.toFixed(1);
}

// Decimal hours between two "HH:MM" times — mirrors calcHoursWorked in
// server/leave.ts and my-leave-client.tsx, purely for display here (the
// day-credit itself is already computed server-side and stored per line).
function calcHoursWorked(timeFrom: string, timeUntil: string): number {
  const [fh, fm] = timeFrom.split(":").map(Number);
  const [uh, um] = timeUntil.split(":").map(Number);
  return (uh * 60 + um - (fh * 60 + fm)) / 60;
}

// ── Component ──────────────────────────────────────────────────────────────

interface Props {
  applications: LeaveApplicationWithDetails[];
  creditRequests: LeaveCreditRequestWithDetails[];
  permissions: string[];
}

export function ApprovalsClient({ applications, creditRequests, permissions: _permissions }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [approveTarget, setApproveTarget] = useState<LeaveApplicationWithDetails | null>(null);
  const [approveComment, setApproveComment] = useState("");
  const [approving, setApproving] = useState(false);

  const [rejectTarget, setRejectTarget] = useState<LeaveApplicationWithDetails | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [rejecting, setRejecting] = useState(false);

  const [approveCreditTarget, setApproveCreditTarget] = useState<LeaveCreditRequestWithDetails | null>(null);
  const [approveCreditComment, setApproveCreditComment] = useState("");
  const [approvingCredit, setApprovingCredit] = useState(false);

  const [rejectCreditTarget, setRejectCreditTarget] = useState<LeaveCreditRequestWithDetails | null>(null);
  const [rejectCreditReason, setRejectCreditReason] = useState("");
  const [rejectingCredit, setRejectingCredit] = useState(false);

  const [viewCreditTarget, setViewCreditTarget] = useState<LeaveCreditRequestWithDetails | null>(null);

  async function handleApproveCredit() {
    if (!approveCreditTarget) return;
    setApprovingCredit(true);
    try {
      await approveReplacementCredit(approveCreditTarget.id, approveCreditComment.trim() || undefined);
      toast.success(`Replacement credit approved for ${approveCreditTarget.applicantName ?? "applicant"}`);
      setApproveCreditTarget(null);
      setApproveCreditComment("");
      startTransition(() => router.refresh());
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to approve");
    } finally {
      setApprovingCredit(false);
    }
  }

  async function handleRejectCredit() {
    if (!rejectCreditTarget) return;
    if (!rejectCreditReason.trim()) { toast.error("Please provide a rejection reason"); return; }
    setRejectingCredit(true);
    try {
      await rejectReplacementCredit(rejectCreditTarget.id, rejectCreditReason.trim());
      toast.success(`Replacement credit rejected for ${rejectCreditTarget.applicantName ?? "applicant"}`);
      setRejectCreditTarget(null);
      setRejectCreditReason("");
      startTransition(() => router.refresh());
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to reject");
    } finally {
      setRejectingCredit(false);
    }
  }

  async function handleApprove() {
    if (!approveTarget) return;
    setApproving(true);
    try {
      await approveLeave(approveTarget.id, approveComment.trim() || undefined);
      toast.success(`Leave approved for ${approveTarget.applicantName ?? "applicant"}`);
      setApproveTarget(null);
      setApproveComment("");
      startTransition(() => router.refresh());
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to approve");
    } finally {
      setApproving(false);
    }
  }

  async function handleReject() {
    if (!rejectTarget) return;
    if (!rejectReason.trim()) { toast.error("Please provide a rejection reason"); return; }
    setRejecting(true);
    try {
      await rejectLeave(rejectTarget.id, rejectReason.trim());
      toast.success(`Leave rejected for ${rejectTarget.applicantName ?? "applicant"}`);
      setRejectTarget(null);
      setRejectReason("");
      startTransition(() => router.refresh());
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to reject");
    } finally {
      setRejecting(false);
    }
  }

  return (
    <div className="p-6 flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <ClipboardCheckIcon className="h-5 w-5 text-muted-foreground" />
            Leave Approvals
          </h1>
          <p className="text-sm text-muted-foreground">
            Review and action pending leave applications.
          </p>
        </div>
        {applications.length > 0 && (
          <Badge className="bg-amber-100 text-amber-800 border border-amber-200 hover:bg-amber-100 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-700">
            {applications.length} pending
          </Badge>
        )}
      </div>

      {applications.length === 0 ? (
        <div className="rounded-lg border border-border py-16 flex flex-col items-center gap-3 text-center">
          <CheckCircle2Icon className="h-10 w-10 text-green-400" />
          <div>
            <p className="font-semibold text-foreground">All caught up!</p>
            <p className="text-sm text-muted-foreground mt-0.5">
              No pending leave applications at this time.
            </p>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40">
                <TableHead className="w-44">Applicant</TableHead>
                <TableHead>Leave Type</TableHead>
                <TableHead className="w-44">Period</TableHead>
                <TableHead className="w-14 text-right">Days</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead className="w-36 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {applications.map((app) => (
                <TableRow key={app.id}>
                  {/* Applicant */}
                  <TableCell>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm font-medium leading-snug">
                        {app.applicantName ?? "Unknown"}
                      </span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {app.applicationNo}
                      </span>
                    </div>
                  </TableCell>

                  {/* Leave Type */}
                  <TableCell>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-sm font-medium">{app.leaveTypeName}</span>
                      {app.isHalfDay && (
                        <Badge variant="outline" className="text-xs px-1.5 py-0 h-5">
                          {app.halfDayPeriod ?? "Half-day"}
                        </Badge>
                      )}
                      {app.documents.length > 0 && (
                        <a
                          href={`/api/leave/download/${app.documents[0].fileKey}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={`Download: ${app.documents[0].fileName}`}
                        >
                          <Badge
                            variant="outline"
                            className="text-xs px-1.5 py-0 h-5 text-blue-600 border-blue-200 bg-blue-50 hover:bg-blue-100 dark:text-blue-400 dark:border-blue-700 cursor-pointer gap-1"
                          >
                            <FileDownIcon className="h-2.5 w-2.5" />
                            Doc
                          </Badge>
                        </a>
                      )}
                    </div>
                  </TableCell>

                  {/* Period */}
                  <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                    {app.startDate}
                    {app.startDate !== app.endDate && <> &rarr; {app.endDate}</>}
                  </TableCell>

                  {/* Days */}
                  <TableCell className="text-right text-sm font-medium">
                    {formatDays(app.totalDays)}
                  </TableCell>

                  {/* Reason */}
                  <TableCell className="max-w-xs">
                    {app.reason ? (
                      <p
                        className="text-sm text-muted-foreground truncate"
                        title={app.reason}
                      >
                        {app.reason}
                      </p>
                    ) : (
                      <span className="text-xs text-muted-foreground italic">No reason given</span>
                    )}
                  </TableCell>

                  {/* Actions */}
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <Button
                        size="sm"
                        className="h-7 gap-1 bg-green-600 hover:bg-green-700 text-white text-xs"
                        onClick={() => { setApproveTarget(app); setApproveComment(""); }}
                      >
                        <CheckIcon className="h-3 w-3" />
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        className="h-7 gap-1 text-xs"
                        onClick={() => { setRejectTarget(app); setRejectReason(""); }}
                      >
                        <XIcon className="h-3 w-3" />
                        Reject
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Replacement Credit Requests */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">Replacement Credit Requests</h2>
          {creditRequests.length > 0 && (
            <Badge className="bg-amber-100 text-amber-800 border border-amber-200 hover:bg-amber-100 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-700">
              {creditRequests.length} pending
            </Badge>
          )}
        </div>
        {creditRequests.length === 0 ? (
          <p className="text-sm text-muted-foreground">No pending replacement credit requests.</p>
        ) : (
          <div className="rounded-lg border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="w-44">Applicant</TableHead>
                  <TableHead>Leave Type</TableHead>
                  <TableHead className="w-40">Period</TableHead>
                  <TableHead className="w-16 text-right">Days</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead className="w-48 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {creditRequests.map((req) => {
                  const reasonPreview = req.workLines.length > 1
                    ? `${req.workLines[0].reason} (+${req.workLines.length - 1} more)`
                    : req.workLines[0]?.reason ?? "";
                  const reasonTooltip = req.workLines
                    .map((l) => `${l.date}: ${l.reason}`)
                    .join("\n");
                  return (
                  <TableRow key={req.id}>
                    <TableCell>
                      <div className="flex flex-col gap-0.5">
                        <span className="text-sm font-medium leading-snug">
                          {req.applicantName ?? "Unknown"}
                        </span>
                        <span className="font-mono text-xs text-muted-foreground">{req.requestNo}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm font-medium">{req.leaveTypeName}</TableCell>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                      {req.dateFrom}
                      {req.dateFrom !== req.dateUntil && <> &rarr; {req.dateUntil}</>}
                    </TableCell>
                    <TableCell className="text-right text-sm font-medium">
                      {formatDays(req.totalDays)}
                    </TableCell>
                    <TableCell className="max-w-xs">
                      {reasonPreview ? (
                        <button
                          type="button"
                          className="text-sm text-muted-foreground truncate hover:text-foreground hover:underline text-left block w-full"
                          title={reasonTooltip}
                          onClick={() => setViewCreditTarget(req)}
                        >
                          {reasonPreview}
                        </button>
                      ) : (
                        <span className="text-xs text-muted-foreground italic">No reason given</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 gap-1 text-xs"
                          onClick={() => setViewCreditTarget(req)}
                          title="View full details"
                        >
                          <EyeIcon className="h-3 w-3" />
                        </Button>
                        <Button
                          size="sm"
                          className="h-7 gap-1 bg-green-600 hover:bg-green-700 text-white text-xs"
                          onClick={() => { setApproveCreditTarget(req); setApproveCreditComment(""); }}
                        >
                          <CheckIcon className="h-3 w-3" />
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          className="h-7 gap-1 text-xs"
                          onClick={() => { setRejectCreditTarget(req); setRejectCreditReason(""); }}
                        >
                          <XIcon className="h-3 w-3" />
                          Reject
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
      </div>

      {/* Approve Sheet */}
      <Sheet open={!!approveTarget} onOpenChange={(open) => !open && setApproveTarget(null)}>
        <SheetContent className="w-full sm:max-w-md max-w-lg! overflow-y-auto px-10">
          <SheetHeader className="mb-5">
            <SheetTitle>Approve Leave Application</SheetTitle>
          </SheetHeader>

          <div className="space-y-4">
            {/* Summary */}
            <div className="rounded-md bg-muted/40 border border-border p-4 space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Applicant</span>
                <span className="font-medium">{approveTarget?.applicantName ?? "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Leave type</span>
                <span className="font-medium">{approveTarget?.leaveTypeName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Period</span>
                <span className="font-medium">
                  {approveTarget?.startDate}
                  {approveTarget?.startDate !== approveTarget?.endDate && (
                    <> &rarr; {approveTarget?.endDate}</>
                  )}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Days</span>
                <span className="font-medium">
                  {approveTarget ? formatDays(approveTarget.totalDays) : "—"}
                </span>
              </div>
              {approveTarget?.reason && (
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground shrink-0">Reason</span>
                  <span className="text-right">{approveTarget.reason}</span>
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="approveComment">
                Comment{" "}
                <span className="text-muted-foreground font-normal text-xs">(optional)</span>
              </Label>
              <Textarea
                id="approveComment"
                value={approveComment}
                onChange={(e) => setApproveComment(e.target.value)}
                placeholder="Add an optional comment for the employee…"
                rows={3}
              />
            </div>

            <div className="flex gap-2 pt-2">
              <Button
                className="flex-1 bg-green-600 hover:bg-green-700 text-white"
                onClick={handleApprove}
                disabled={approving}
              >
                {approving ? "Approving…" : "Approve Leave"}
              </Button>
              <Button variant="outline" onClick={() => setApproveTarget(null)} disabled={approving}>
                Cancel
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Reject Sheet */}
      <Sheet open={!!rejectTarget} onOpenChange={(open) => !open && setRejectTarget(null)}>
        <SheetContent className="w-full sm:max-w-md max-w-lg! overflow-y-auto px-10">
          <SheetHeader className="mb-5">
            <SheetTitle>Reject Leave Application</SheetTitle>
          </SheetHeader>

          <div className="space-y-4">
            {/* Summary */}
            <div className="rounded-md bg-muted/40 border border-border p-4 space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Applicant</span>
                <span className="font-medium">{rejectTarget?.applicantName ?? "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Leave type</span>
                <span className="font-medium">{rejectTarget?.leaveTypeName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Period</span>
                <span className="font-medium">
                  {rejectTarget?.startDate}
                  {rejectTarget?.startDate !== rejectTarget?.endDate && (
                    <> &rarr; {rejectTarget?.endDate}</>
                  )}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Days</span>
                <span className="font-medium">
                  {rejectTarget ? formatDays(rejectTarget.totalDays) : "—"}
                </span>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="rejectReason">
                Rejection Reason <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="rejectReason"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Provide a reason for rejection (required)…"
                rows={3}
                required
              />
            </div>

            <div className="flex gap-2 pt-2">
              <Button
                variant="destructive"
                className="flex-1"
                onClick={handleReject}
                disabled={rejecting || !rejectReason.trim()}
              >
                {rejecting ? "Rejecting…" : "Reject Leave"}
              </Button>
              <Button variant="outline" onClick={() => setRejectTarget(null)} disabled={rejecting}>
                Cancel
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Approve Credit Sheet */}
      <Sheet open={!!approveCreditTarget} onOpenChange={(open) => !open && setApproveCreditTarget(null)}>
        <SheetContent className="w-full sm:max-w-xl max-w-full! overflow-y-auto px-10">
          <SheetHeader className="mb-5">
            <SheetTitle>Approve Replacement Credit</SheetTitle>
          </SheetHeader>

          <div className="space-y-4">
            <div className="rounded-md bg-muted/40 border border-border p-4 space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Applicant</span>
                <span className="font-medium">{approveCreditTarget?.applicantName ?? "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Leave type</span>
                <span className="font-medium">{approveCreditTarget?.leaveTypeName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Period</span>
                <span className="font-medium">
                  {approveCreditTarget?.dateFrom}
                  {approveCreditTarget && approveCreditTarget.dateFrom !== approveCreditTarget.dateUntil && (
                    <> &rarr; {approveCreditTarget.dateUntil}</>
                  )}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Days claimed</span>
                <span className="font-medium">
                  {approveCreditTarget ? formatDays(approveCreditTarget.totalDays) : "—"}
                </span>
              </div>
            </div>

            {approveCreditTarget && approveCreditTarget.workLines.length > 0 && (
              <div className="rounded-lg border border-border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40">
                      <TableHead className="w-32">Date</TableHead>
                      <TableHead className="w-32">Time</TableHead>
                      <TableHead className="w-16 text-right">Hours</TableHead>
                      <TableHead className="w-16 text-right">Days</TableHead>
                      <TableHead>Reason</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {approveCreditTarget.workLines.map((line) => (
                      <TableRow key={line.date}>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{line.date}</TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {line.timeFrom}–{line.timeUntil}
                        </TableCell>
                        <TableCell className="text-xs text-right text-muted-foreground">
                          {calcHoursWorked(line.timeFrom, line.timeUntil).toFixed(1)}
                        </TableCell>
                        <TableCell className="text-xs text-right font-medium">{formatDays(line.days)}</TableCell>
                        <TableCell className="text-xs">{line.reason}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              Approving adds {approveCreditTarget ? formatDays(approveCreditTarget.totalDays) : "—"} day(s)
              to the applicant&apos;s {approveCreditTarget?.leaveTypeName} balance.
            </p>

            <div className="space-y-1.5">
              <Label htmlFor="approveCreditComment">
                Comment{" "}
                <span className="text-muted-foreground font-normal text-xs">(optional)</span>
              </Label>
              <Textarea
                id="approveCreditComment"
                value={approveCreditComment}
                onChange={(e) => setApproveCreditComment(e.target.value)}
                placeholder="Add an optional comment for the employee…"
                rows={3}
              />
            </div>

            <div className="flex gap-2 pt-2">
              <Button
                className="flex-1 bg-green-600 hover:bg-green-700 text-white"
                onClick={handleApproveCredit}
                disabled={approvingCredit}
              >
                {approvingCredit ? "Approving…" : "Approve Credit"}
              </Button>
              <Button variant="outline" onClick={() => setApproveCreditTarget(null)} disabled={approvingCredit}>
                Cancel
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Reject Credit Sheet */}
      <Sheet open={!!rejectCreditTarget} onOpenChange={(open) => !open && setRejectCreditTarget(null)}>
        <SheetContent className="w-full sm:max-w-xl max-w-full! overflow-y-auto px-10">
          <SheetHeader className="mb-5">
            <SheetTitle>Reject Replacement Credit</SheetTitle>
          </SheetHeader>

          <div className="space-y-4">
            <div className="rounded-md bg-muted/40 border border-border p-4 space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Applicant</span>
                <span className="font-medium">{rejectCreditTarget?.applicantName ?? "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Leave type</span>
                <span className="font-medium">{rejectCreditTarget?.leaveTypeName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Period</span>
                <span className="font-medium">
                  {rejectCreditTarget?.dateFrom}
                  {rejectCreditTarget && rejectCreditTarget.dateFrom !== rejectCreditTarget.dateUntil && (
                    <> &rarr; {rejectCreditTarget.dateUntil}</>
                  )}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Days claimed</span>
                <span className="font-medium">
                  {rejectCreditTarget ? formatDays(rejectCreditTarget.totalDays) : "—"}
                </span>
              </div>
            </div>

            {rejectCreditTarget && rejectCreditTarget.workLines.length > 0 && (
              <div className="rounded-lg border border-border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40">
                      <TableHead className="w-32">Date</TableHead>
                      <TableHead className="w-32">Time</TableHead>
                      <TableHead className="w-16 text-right">Hours</TableHead>
                      <TableHead className="w-16 text-right">Days</TableHead>
                      <TableHead>Reason</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rejectCreditTarget.workLines.map((line) => (
                      <TableRow key={line.date}>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{line.date}</TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {line.timeFrom}–{line.timeUntil}
                        </TableCell>
                        <TableCell className="text-xs text-right text-muted-foreground">
                          {calcHoursWorked(line.timeFrom, line.timeUntil).toFixed(1)}
                        </TableCell>
                        <TableCell className="text-xs text-right font-medium">{formatDays(line.days)}</TableCell>
                        <TableCell className="text-xs">{line.reason}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="rejectCreditReason">
                Rejection Reason <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="rejectCreditReason"
                value={rejectCreditReason}
                onChange={(e) => setRejectCreditReason(e.target.value)}
                placeholder="Provide a reason for rejection (required)…"
                rows={3}
                required
              />
            </div>

            <div className="flex gap-2 pt-2">
              <Button
                variant="destructive"
                className="flex-1"
                onClick={handleRejectCredit}
                disabled={rejectingCredit || !rejectCreditReason.trim()}
              >
                {rejectingCredit ? "Rejecting…" : "Reject Credit"}
              </Button>
              <Button variant="outline" onClick={() => setRejectCreditTarget(null)} disabled={rejectingCredit}>
                Cancel
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* View Credit Details Sheet — read-only, no action taken by opening it */}
      <Sheet open={!!viewCreditTarget} onOpenChange={(open) => !open && setViewCreditTarget(null)}>
        <SheetContent className="w-full sm:max-w-xl max-w-full! overflow-y-auto px-10">
          <SheetHeader className="mb-5">
            <SheetTitle>Replacement Credit Details</SheetTitle>
          </SheetHeader>

          <div className="space-y-4">
            <div className="rounded-md bg-muted/40 border border-border p-4 space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Applicant</span>
                <span className="font-medium">{viewCreditTarget?.applicantName ?? "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Leave type</span>
                <span className="font-medium">{viewCreditTarget?.leaveTypeName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Period</span>
                <span className="font-medium">
                  {viewCreditTarget?.dateFrom}
                  {viewCreditTarget && viewCreditTarget.dateFrom !== viewCreditTarget.dateUntil && (
                    <> &rarr; {viewCreditTarget.dateUntil}</>
                  )}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Days claimed</span>
                <span className="font-medium">
                  {viewCreditTarget ? formatDays(viewCreditTarget.totalDays) : "—"}
                </span>
              </div>
            </div>

            {viewCreditTarget && viewCreditTarget.workLines.length > 0 && (
              <div className="rounded-lg border border-border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40">
                      <TableHead className="w-32">Date</TableHead>
                      <TableHead className="w-32">Time</TableHead>
                      <TableHead className="w-16 text-right">Hours</TableHead>
                      <TableHead className="w-16 text-right">Days</TableHead>
                      <TableHead>Reason</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {viewCreditTarget.workLines.map((line) => (
                      <TableRow key={line.date}>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{line.date}</TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {line.timeFrom}–{line.timeUntil}
                        </TableCell>
                        <TableCell className="text-xs text-right text-muted-foreground">
                          {calcHoursWorked(line.timeFrom, line.timeUntil).toFixed(1)}
                        </TableCell>
                        <TableCell className="text-xs text-right font-medium">{formatDays(line.days)}</TableCell>
                        <TableCell className="text-xs">{line.reason}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <Button
                className="flex-1 bg-green-600 hover:bg-green-700 text-white"
                onClick={() => {
                  const target = viewCreditTarget;
                  setViewCreditTarget(null);
                  setApproveCreditTarget(target);
                  setApproveCreditComment("");
                }}
              >
                <CheckIcon className="h-3.5 w-3.5" />
                Approve
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  const target = viewCreditTarget;
                  setViewCreditTarget(null);
                  setRejectCreditTarget(target);
                  setRejectCreditReason("");
                }}
              >
                <XIcon className="h-3.5 w-3.5" />
                Reject
              </Button>
              <Button variant="outline" onClick={() => setViewCreditTarget(null)}>
                Close
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
