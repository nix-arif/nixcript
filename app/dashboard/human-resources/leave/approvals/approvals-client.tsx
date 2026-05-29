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
import type { LeaveApplicationWithDetails } from "@/server/leave";
import { approveLeave, rejectLeave } from "@/server/leave";
import {
  CheckIcon,
  XIcon,
  FileDownIcon,
  CheckCircle2Icon,
  ClipboardCheckIcon,
} from "lucide-react";

// ── Helpers ────────────────────────────────────────────────────────────────

function formatDays(n: string | number): string {
  const v = parseFloat(String(n));
  return v % 1 === 0 ? String(Math.round(v)) : v.toFixed(1);
}

// ── Component ──────────────────────────────────────────────────────────────

interface Props {
  applications: LeaveApplicationWithDetails[];
  permissions: string[];
}

export function ApprovalsClient({ applications, permissions: _permissions }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [approveTarget, setApproveTarget] = useState<LeaveApplicationWithDetails | null>(null);
  const [approveComment, setApproveComment] = useState("");
  const [approving, setApproving] = useState(false);

  const [rejectTarget, setRejectTarget] = useState<LeaveApplicationWithDetails | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [rejecting, setRejecting] = useState(false);

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
    </div>
  );
}
