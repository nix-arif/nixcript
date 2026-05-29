"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
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
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import type { MyLeaveBalance, LeaveApplicationWithDetails } from "@/server/leave";
import { cancelLeave } from "@/server/leave";
import { PlusIcon, FileDownIcon, XIcon, CalendarDaysIcon, AlertTriangleIcon } from "lucide-react";

// ── Helpers ────────────────────────────────────────────────────────────────

function formatDays(days: string | number): string {
  const n = parseFloat(String(days));
  return n % 1 === 0 ? String(Math.round(n)) : n.toFixed(1);
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    PENDING:
      "bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-100 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-700",
    APPROVED:
      "bg-green-100 text-green-800 border-green-200 hover:bg-green-100 dark:bg-green-900/30 dark:text-green-400 dark:border-green-700",
    REJECTED:
      "bg-red-100 text-red-800 border-red-200 hover:bg-red-100 dark:bg-red-900/30 dark:text-red-400 dark:border-red-700",
    CANCELLED:
      "bg-muted text-muted-foreground border-border hover:bg-muted",
  };
  const labels: Record<string, string> = {
    PENDING: "Pending",
    APPROVED: "Approved",
    REJECTED: "Rejected",
    CANCELLED: "Cancelled",
  };
  return (
    <Badge className={`border text-xs ${map[status] ?? "border-border"}`}>
      {labels[status] ?? status}
    </Badge>
  );
}

// ── Balance Card ───────────────────────────────────────────────────────────

function BalanceCard({ balance }: { balance: MyLeaveBalance }) {
  const entitled = parseFloat(balance.entitledDays);
  const carry = parseFloat(balance.carryForwardDays);
  const used = parseFloat(balance.usedDays);
  const pending = parseFloat(balance.pendingDays);
  const remaining = parseFloat(balance.remainingDays);
  const total = entitled + carry;
  const progressVal = total > 0 ? Math.min(100, ((used + pending) / total) * 100) : 0;

  const pct = total > 0 ? remaining / total : 1;
  const [borderCls, numCls] =
    remaining <= 0
      ? ["border-red-200 dark:border-red-800", "text-red-600 dark:text-red-400"]
      : pct < 0.2
      ? ["border-amber-200 dark:border-amber-700", "text-amber-600 dark:text-amber-400"]
      : ["border-green-200 dark:border-green-800", "text-green-700 dark:text-green-400"];

  return (
    <div className={`rounded-lg border ${borderCls} bg-card p-4 flex flex-col gap-2.5`}>
      {/* Badges — own row, wraps freely */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <Badge variant="outline" className="font-mono text-xs px-1.5 py-0 h-5">
          {balance.leaveTypeCode}
        </Badge>
        <Badge
          variant="outline"
          className={`text-xs px-1.5 py-0 h-5 ${
            balance.isPaid
              ? "text-blue-700 border-blue-200 bg-blue-50 dark:text-blue-400 dark:border-blue-700 dark:bg-blue-900/20"
              : "text-muted-foreground"
          }`}
        >
          {balance.isPaid ? "Paid" : "Unpaid"}
        </Badge>
      </div>

      {/* Leave type name — full width, no competition */}
      <p className="text-sm font-semibold leading-snug">{balance.leaveTypeName}</p>

      {/* Remaining days — big number */}
      <div className={`text-3xl font-bold leading-none ${numCls}`}>
        {formatDays(remaining)}
        <span className="text-sm font-normal text-muted-foreground ml-1.5">days left</span>
      </div>

      {/* Progress */}
      <Progress value={progressVal} className="h-1.5" />

      {/* Breakdown */}
      <div className="text-xs text-muted-foreground space-y-1">
        <div className="flex justify-between">
          <span>Entitled</span>
          <span className="font-medium text-foreground">{formatDays(entitled)}d</span>
        </div>
        {carry > 0 && (
          <div className="flex justify-between">
            <span>Carried fwd</span>
            <span className="font-medium text-blue-600 dark:text-blue-400">+{formatDays(carry)}d</span>
          </div>
        )}
        <div className="flex justify-between">
          <span>Used</span>
          <span className="font-medium text-foreground">{formatDays(used)}d</span>
        </div>
        {pending > 0 && (
          <div className="flex justify-between">
            <span>Pending</span>
            <span className="font-medium text-amber-600 dark:text-amber-400">{formatDays(pending)}d</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────

interface Props {
  balances: MyLeaveBalance[];
  applications: LeaveApplicationWithDetails[];
  permissions: string[];
}

export function MyLeaveClient({ balances, applications, permissions }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
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
    <div className="p-6 flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <CalendarDaysIcon className="h-5 w-5 text-muted-foreground" />
            My Leave
          </h1>
          <p className="text-sm text-muted-foreground">
            View your leave balances and application history.
          </p>
        </div>
        {canApply && (
          <Link href="/dashboard/human-resources/leave/apply">
            <Button size="sm">
              <PlusIcon className="h-4 w-4 mr-1" />
              Apply Leave
            </Button>
          </Link>
        )}
      </div>

      {/* Balance Cards */}
      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Leave Balances — {new Date().getFullYear()}
        </h2>
        {balances.length > 0 ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {balances.map((b) => (
              <BalanceCard key={b.id} balance={b} />
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-border py-10 text-center text-sm text-muted-foreground">
            No leave types configured. Contact your HR administrator.
          </div>
        )}
      </div>

      {/* Applications Table */}
      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Leave History
        </h2>
        {applications.length === 0 ? (
          <div className="rounded-lg border border-border py-10 text-center text-sm text-muted-foreground">
            No leave applications yet.{" "}
            {canApply && (
              <Link
                href="/dashboard/human-resources/leave/apply"
                className="text-primary hover:underline"
              >
                Apply for leave
              </Link>
            )}
          </div>
        ) : (
          <div className="rounded-lg border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="w-32.5">Ref No.</TableHead>
                  <TableHead>Leave Type</TableHead>
                  <TableHead className="w-50">Period</TableHead>
                  <TableHead className="w-15 text-right">Days</TableHead>
                  <TableHead className="w-27.5">Status</TableHead>
                  <TableHead className="w-20 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {applications.map((app) => (
                  <TableRow key={app.id}>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {app.applicationNo}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-sm font-medium">{app.leaveTypeName}</span>
                        {app.isHalfDay && (
                          <Badge variant="outline" className="text-xs px-1.5 py-0 h-5">
                            {app.halfDayPeriod ?? "Half-day"}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                      {app.startDate}
                      {app.startDate !== app.endDate && (
                        <> &rarr; {app.endDate}</>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-sm font-medium">
                      {formatDays(app.totalDays)}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={app.status} />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {app.documents.length > 0 && (
                          <a
                            href={`/api/leave/download/${app.documents[0].fileKey}`}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0"
                              title="Download document"
                            >
                              <FileDownIcon className="h-3.5 w-3.5" />
                            </Button>
                          </a>
                        )}
                        {app.status === "PENDING" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                            onClick={() => setCancelTarget(app)}
                            title="Cancel application"
                          >
                            <XIcon className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* Cancel Confirmation Sheet */}
      <Sheet open={!!cancelTarget} onOpenChange={(open) => !open && setCancelTarget(null)}>
        <SheetContent className="w-full sm:max-w-md max-w-lg! overflow-y-auto px-10">
          <SheetHeader className="mb-5">
            <SheetTitle>Cancel Leave Application</SheetTitle>
          </SheetHeader>

          <div className="space-y-4">
            <div className="rounded-md bg-destructive/10 border border-destructive/30 p-4 flex items-start gap-3">
              <AlertTriangleIcon className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
              <p className="text-sm text-destructive leading-relaxed">
                Are you sure you want to cancel{" "}
                <strong>
                  {cancelTarget?.leaveTypeName} ({cancelTarget?.applicationNo})
                </strong>{" "}
                from <strong>{cancelTarget?.startDate}</strong> to{" "}
                <strong>{cancelTarget?.endDate}</strong>? This action cannot be undone.
              </p>
            </div>

            <div className="flex gap-2 pt-2">
              <Button variant="destructive" onClick={handleCancel} disabled={cancelling} className="flex-1">
                {cancelling ? "Cancelling…" : "Yes, Cancel Leave"}
              </Button>
              <Button variant="outline" onClick={() => setCancelTarget(null)} disabled={cancelling}>
                Keep
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
