"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { LeaveApplicationWithDetails } from "@/server/leave";
import { approveLeave, rejectLeave } from "@/server/leave";
import { CheckIcon, XIcon, FileDownIcon, CheckCircleIcon } from "lucide-react";

/* =========================
   HELPERS
========================= */

function formatDays(n: string | number): string {
  const v = parseFloat(String(n));
  return v % 1 === 0 ? String(Math.round(v)) : v.toFixed(1);
}

/* =========================
   MAIN COMPONENT
========================= */

interface Props {
  applications: LeaveApplicationWithDetails[];
  permissions: string[];
}

export function ApprovalsClient({ applications, permissions }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Approve dialog
  const [approveTarget, setApproveTarget] = useState<LeaveApplicationWithDetails | null>(null);
  const [approveComment, setApproveComment] = useState("");
  const [approving, setApproving] = useState(false);

  // Reject dialog
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
    if (!rejectReason.trim()) {
      toast.error("Please provide a rejection reason");
      return;
    }
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
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold text-gray-900">Pending Leave Approvals</h1>
        {applications.length > 0 && (
          <Badge className="bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-100">
            {applications.length}
          </Badge>
        )}
      </div>

      {applications.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <CheckCircleIcon className="h-12 w-12 text-green-400 mx-auto mb-3" />
            <h3 className="text-lg font-semibold text-gray-700 mb-1">All caught up!</h3>
            <p className="text-gray-500">No pending leave applications at this time.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Applicant</TableHead>
                  <TableHead>Leave Type</TableHead>
                  <TableHead>From</TableHead>
                  <TableHead>To</TableHead>
                  <TableHead>Days</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Documents</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {applications.map((app) => (
                  <TableRow key={app.id}>
                    <TableCell>
                      <div>
                        <div className="font-medium text-sm">
                          {app.applicantName ?? "Unknown"}
                        </div>
                        <div className="text-xs text-gray-400 font-mono">{app.applicationNo}</div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium text-sm">{app.leaveTypeName}</span>
                        {app.isHalfDay && (
                          <Badge variant="outline" className="text-xs">
                            {app.halfDayPeriod ?? "Half-day"}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">{app.startDate}</TableCell>
                    <TableCell className="text-sm">{app.endDate}</TableCell>
                    <TableCell className="text-sm font-medium">
                      {formatDays(app.totalDays)}
                    </TableCell>
                    <TableCell className="max-w-xs">
                      <p className="text-sm text-gray-600 truncate" title={app.reason ?? ""}>
                        {app.reason || <span className="text-gray-400 italic">No reason given</span>}
                      </p>
                    </TableCell>
                    <TableCell>
                      {app.documents.length > 0 ? (
                        <div className="flex flex-col gap-1">
                          {app.documents.map((doc) => (
                            <a
                              key={doc.id}
                              href={`/api/leave/download/${doc.fileKey}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800"
                            >
                              <FileDownIcon className="h-3 w-3" />
                              <span className="truncate max-w-24">{doc.fileName}</span>
                            </a>
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          size="sm"
                          className="gap-1 bg-green-600 hover:bg-green-700 text-white"
                          onClick={() => {
                            setApproveTarget(app);
                            setApproveComment("");
                          }}
                        >
                          <CheckIcon className="h-3 w-3" />
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          className="gap-1"
                          onClick={() => {
                            setRejectTarget(app);
                            setRejectReason("");
                          }}
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
          </CardContent>
        </Card>
      )}

      {/* Approve Dialog */}
      <Dialog
        open={!!approveTarget}
        onOpenChange={(open) => {
          if (!open) setApproveTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve Leave Application</DialogTitle>
            <DialogDescription>
              Approve{" "}
              <strong>
                {approveTarget?.applicantName ?? "this applicant"}
              </strong>
              &apos;s {approveTarget?.leaveTypeName} from{" "}
              <strong>{approveTarget?.startDate}</strong> to{" "}
              <strong>{approveTarget?.endDate}</strong> (
              {approveTarget ? formatDays(approveTarget.totalDays) : "?"} days).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="approveComment">
              Comment{" "}
              <span className="text-gray-400 font-normal text-xs">(optional)</span>
            </Label>
            <Textarea
              id="approveComment"
              value={approveComment}
              onChange={(e) => setApproveComment(e.target.value)}
              placeholder="Add an optional comment for the employee..."
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setApproveTarget(null)}
              disabled={approving}
            >
              Cancel
            </Button>
            <Button
              className="bg-green-600 hover:bg-green-700 text-white"
              onClick={handleApprove}
              disabled={approving}
            >
              {approving ? "Approving..." : "Approve Leave"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject Dialog */}
      <Dialog
        open={!!rejectTarget}
        onOpenChange={(open) => {
          if (!open) setRejectTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Leave Application</DialogTitle>
            <DialogDescription>
              Reject{" "}
              <strong>
                {rejectTarget?.applicantName ?? "this applicant"}
              </strong>
              &apos;s {rejectTarget?.leaveTypeName} from{" "}
              <strong>{rejectTarget?.startDate}</strong> to{" "}
              <strong>{rejectTarget?.endDate}</strong>.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="rejectReason">
              Rejection Reason <span className="text-red-500">*</span>
            </Label>
            <Textarea
              id="rejectReason"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Provide a reason for rejection (required)..."
              rows={3}
              required
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRejectTarget(null)}
              disabled={rejecting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleReject}
              disabled={rejecting || !rejectReason.trim()}
            >
              {rejecting ? "Rejecting..." : "Reject Leave"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
