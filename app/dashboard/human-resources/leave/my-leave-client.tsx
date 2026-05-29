"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
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
import type { MyLeaveBalance, LeaveApplicationWithDetails } from "@/server/leave";
import { cancelLeave } from "@/server/leave";
import { PlusIcon, FileDownIcon, XIcon } from "lucide-react";

/* =========================
   HELPERS
========================= */

function formatDays(days: string | number): string {
  const n = parseFloat(String(days));
  return n % 1 === 0 ? String(Math.round(n)) : n.toFixed(1);
}

function statusBadge(status: string) {
  switch (status) {
    case "PENDING":
      return (
        <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100 border-amber-200">
          Pending
        </Badge>
      );
    case "APPROVED":
      return (
        <Badge className="bg-green-100 text-green-800 hover:bg-green-100 border-green-200">
          Approved
        </Badge>
      );
    case "REJECTED":
      return (
        <Badge className="bg-red-100 text-red-800 hover:bg-red-100 border-red-200">
          Rejected
        </Badge>
      );
    case "CANCELLED":
      return (
        <Badge className="bg-gray-100 text-gray-600 hover:bg-gray-100 border-gray-200">
          Cancelled
        </Badge>
      );
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

/* =========================
   BALANCE CARD
========================= */

function BalanceCard({ balance }: { balance: MyLeaveBalance }) {
  const entitled = parseFloat(balance.entitledDays);
  const carry = parseFloat(balance.carryForwardDays);
  const used = parseFloat(balance.usedDays);
  const pending = parseFloat(balance.pendingDays);
  const remaining = parseFloat(balance.remainingDays);
  const total = entitled + carry;
  const progressVal = total > 0 ? Math.min(100, ((used + pending) / total) * 100) : 0;

  const remainingPct = total > 0 ? remaining / total : 0;
  let cardColor = "border-green-200 bg-green-50/30";
  let remainingColor = "text-green-700";
  if (remaining <= 0) {
    cardColor = "border-red-200 bg-red-50/30";
    remainingColor = "text-red-700";
  } else if (remainingPct < 0.2) {
    cardColor = "border-amber-200 bg-amber-50/30";
    remainingColor = "text-amber-700";
  }

  return (
    <Card className={`border ${cardColor}`}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold text-gray-700">
            {balance.leaveTypeName}
          </CardTitle>
          <div className="flex gap-1">
            <Badge variant="outline" className="text-xs font-mono">
              {balance.leaveTypeCode}
            </Badge>
            <Badge
              variant="outline"
              className={`text-xs ${balance.isPaid ? "text-blue-700 border-blue-200 bg-blue-50" : "text-gray-500"}`}
            >
              {balance.isPaid ? "Paid" : "Unpaid"}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className={`text-3xl font-bold ${remainingColor}`}>
          {formatDays(balance.remainingDays)}
          <span className="text-sm font-normal text-gray-500 ml-1">days left</span>
        </div>
        <Progress value={progressVal} className="h-2" />
        <div className="text-xs text-gray-500 space-y-0.5">
          <div className="flex justify-between">
            <span>Entitled</span>
            <span className="font-medium">{formatDays(entitled)} days</span>
          </div>
          {carry > 0 && (
            <div className="flex justify-between">
              <span>Carried forward</span>
              <span className="font-medium text-blue-600">+{formatDays(carry)} days</span>
            </div>
          )}
          <div className="flex justify-between">
            <span>Used</span>
            <span className="font-medium text-gray-700">{formatDays(used)} days</span>
          </div>
          {pending > 0 && (
            <div className="flex justify-between">
              <span>Pending</span>
              <span className="font-medium text-amber-600">{formatDays(pending)} days</span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/* =========================
   MAIN CLIENT COMPONENT
========================= */

interface Props {
  balances: MyLeaveBalance[];
  applications: LeaveApplicationWithDetails[];
  permissions: string[];
}

export function MyLeaveClient({ balances, applications, permissions }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [cancelTarget, setCancelTarget] = useState<LeaveApplicationWithDetails | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const canApply = permissions.includes("leave:apply") || permissions.includes("*");

  async function handleCancel() {
    if (!cancelTarget) return;
    setCancelling(true);
    try {
      await cancelLeave(cancelTarget.id);
      toast.success("Leave application cancelled");
      setCancelTarget(null);
      startTransition(() => router.refresh());
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to cancel");
    } finally {
      setCancelling(false);
    }
  }

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">My Leave</h1>
          <p className="text-sm text-gray-500 mt-1">
            View your leave balances and application history
          </p>
        </div>
        {canApply && (
          <Link href="/dashboard/human-resources/leave/apply">
            <Button className="gap-2">
              <PlusIcon className="h-4 w-4" />
              Apply Leave
            </Button>
          </Link>
        )}
      </div>

      {/* Balance Cards */}
      {balances.length > 0 ? (
        <div>
          <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-3">
            Leave Balances — {new Date().getFullYear()}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {balances.map((b) => (
              <BalanceCard key={b.id} balance={b} />
            ))}
          </div>
        </div>
      ) : (
        <Card>
          <CardContent className="py-8 text-center text-gray-500">
            No leave types configured. Contact your HR administrator.
          </CardContent>
        </Card>
      )}

      {/* Applications Table */}
      <div>
        <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-3">
          Leave History
        </h2>
        {applications.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-gray-500">
              No leave applications yet.{" "}
              {canApply && (
                <Link
                  href="/dashboard/human-resources/leave/apply"
                  className="text-blue-600 hover:underline"
                >
                  Apply for leave
                </Link>
              )}
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Application No</TableHead>
                    <TableHead>Leave Type</TableHead>
                    <TableHead>From</TableHead>
                    <TableHead>To</TableHead>
                    <TableHead>Days</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {applications.map((app) => (
                    <TableRow key={app.id}>
                      <TableCell className="font-mono text-xs">{app.applicationNo}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium">{app.leaveTypeName}</span>
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
                      <TableCell>{statusBadge(app.status)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          {app.documents.length > 0 && (
                            <a
                              href={`/api/leave/download/${app.documents[0].fileKey}`}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <Button variant="ghost" size="sm" className="gap-1 text-xs">
                                <FileDownIcon className="h-3 w-3" />
                                Doc
                              </Button>
                            </a>
                          )}
                          {app.status === "PENDING" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="gap-1 text-xs text-red-600 hover:text-red-700 hover:bg-red-50"
                              onClick={() => setCancelTarget(app)}
                            >
                              <XIcon className="h-3 w-3" />
                              Cancel
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Cancel Confirmation Dialog */}
      <Dialog open={!!cancelTarget} onOpenChange={(open) => !open && setCancelTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel Leave Application</DialogTitle>
            <DialogDescription>
              Are you sure you want to cancel{" "}
              <strong>
                {cancelTarget?.leaveTypeName} ({cancelTarget?.applicationNo})
              </strong>{" "}
              from <strong>{cancelTarget?.startDate}</strong> to{" "}
              <strong>{cancelTarget?.endDate}</strong>? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCancelTarget(null)}
              disabled={cancelling}
            >
              Keep Application
            </Button>
            <Button
              variant="destructive"
              onClick={handleCancel}
              disabled={cancelling}
            >
              {cancelling ? "Cancelling..." : "Yes, Cancel"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
