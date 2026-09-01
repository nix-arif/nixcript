"use client";

import { useState, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { MyLeaveBalance, LeaveApplicationWithDetails, LeaveTypeRow, LeaveCreditRequestWithDetails } from "@/server/leave";
import {
  cancelLeave, applyForLeave, createLeaveDocumentRecord,
  applyForReplacementCredit, cancelReplacementCredit,
} from "@/server/leave";
import {
  PlusIcon,
  FileDownIcon,
  XIcon,
  CalendarDaysIcon,
  AlertTriangleIcon,
  UploadIcon,
  InfoIcon,
  FilePlusIcon,
} from "lucide-react";

// ── Helpers ────────────────────────────────────────────────────────────────

function calcWorkingDays(start: string, end: string, isHalfDay: boolean): number {
  if (isHalfDay) return 0.5;
  if (!start || !end) return 0;
  const s = new Date(start + "T00:00:00");
  const e = new Date(end + "T00:00:00");
  if (s > e) return 0;
  let days = 0;
  const cur = new Date(s);
  while (cur <= e) {
    const d = cur.getDay();
    if (d !== 0 && d !== 6) days++;
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}

// "YYYY-MM-DD" in LOCAL time — toISOString() converts to UTC first, which
// silently shifts the date by a day whenever the browser's timezone offset
// is nonzero (e.g. any UTC+ zone, which is most of Asia including Malaysia).
function fmtLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Every calendar date in [from, until] inclusive — weekends included,
// deliberately (mirrors calcDateRange in server/leave.ts): the whole point
// of a replacement-credit claim is a day the person wouldn't normally work.
function calcDateRange(from: string, until: string): string[] {
  if (!from || !until) return [];
  const s = new Date(from + "T00:00:00");
  const e = new Date(until + "T00:00:00");
  if (s > e) return [];
  const dates: string[] = [];
  const cur = new Date(s);
  while (cur <= e) {
    dates.push(fmtLocalDate(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

function fmtDateLabel(d: string): string {
  return new Date(d + "T00:00:00").toLocaleDateString("en-MY", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
}

// Client-side mirrors of the server helpers in server/leave.ts — instant
// per-date feedback while filling the form; the server still recomputes
// and stores the authoritative values on submit.
function calcHoursWorked(timeFrom: string, timeUntil: string): number {
  const [fh, fm] = timeFrom.split(":").map(Number);
  const [uh, um] = timeUntil.split(":").map(Number);
  return (uh * 60 + um - (fh * 60 + fm)) / 60;
}

function getCreditDaysForHours(
  rules: Array<{ minHours: number; maxHours: number | null; days: number }>,
  hours: number,
): number {
  if (rules.length === 0) return 1;
  const rule = rules.find((r) => hours >= r.minHours && (r.maxHours === null || hours < r.maxHours));
  return rule?.days ?? 0;
}

function formatDays(days: string | number): string {
  const n = parseFloat(String(days));
  return n % 1 === 0 ? String(Math.round(n)) : n.toFixed(1);
}

// Matches the existing "Medical/Sick Leave" naming convention — one shared
// trailing "Leave", not "Annual Leave/Emergency Leave".
function withEmergencyLabel(name: string, hasThreshold: boolean): string {
  if (!hasThreshold) return name;
  return `${name.replace(/\s*Leave$/i, "")}/Emergency Leave`;
}

interface QueuedFile {
  file: File;
  id: string;
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
  const earned = parseFloat(balance.earnedDays);
  const used = parseFloat(balance.usedDays);
  const pending = parseFloat(balance.pendingDays);
  const remaining = parseFloat(balance.remainingDays);
  const total = entitled + carry + earned;
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
      <p className="text-sm font-semibold leading-snug">
        {withEmergencyLabel(balance.leaveTypeName, balance.emergencyThresholdDays != null)}
      </p>
      <div className={`text-3xl font-bold leading-none ${numCls}`}>
        {formatDays(remaining)}
        <span className="text-sm font-normal text-muted-foreground ml-1.5">days left</span>
      </div>
      <Progress value={progressVal} className="h-1.5" />
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
        {earned > 0 && (
          <div className="flex justify-between">
            <span>Earned (credit)</span>
            <span className="font-medium text-blue-600 dark:text-blue-400">+{formatDays(earned)}d</span>
          </div>
        )}
        <div className="flex justify-between">
          <span>Used</span>
          <span className="font-medium text-foreground">{formatDays(used)}d</span>
        </div>
        {balance.breakdown.length > 1 && (
          <div className="pl-3 space-y-1 border-l border-border/60 ml-0.5">
            {balance.breakdown.map((b) => (
              <div key={b.code} className="flex justify-between">
                <span>{b.name}</span>
                <span className="font-medium text-foreground">
                  {formatDays(b.usedDays)}d
                  {parseFloat(b.pendingDays) > 0 && (
                    <span className="text-amber-600 dark:text-amber-400"> (+{formatDays(b.pendingDays)}d pending)</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
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
  leaveTypes: LeaveTypeRow[];
  creditRequests: LeaveCreditRequestWithDetails[];
  permissions: string[];
}

export function MyLeaveClient({ balances, applications, leaveTypes, creditRequests, permissions }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Cancel state ──────────────────────────────────────────────────────────
  const [cancelTarget, setCancelTarget] = useState<LeaveApplicationWithDetails | null>(null);
  const [cancelling, setCancelling] = useState(false);

  // ── Apply Leave sheet state ───────────────────────────────────────────────
  const [applyOpen, setApplyOpen] = useState(false);
  const [selectedTypeId, setSelectedTypeId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [isHalfDay, setIsHalfDay] = useState(false);
  const [halfDayPeriod, setHalfDayPeriod] = useState<"AM" | "PM">("AM");
  const [reason, setReason] = useState("");
  const [queuedFiles, setQueuedFiles] = useState<QueuedFile[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // ── Request Replacement Credit sheet state ──────────────────────────────
  const [creditOpen, setCreditOpen] = useState(false);
  const [creditTypeId, setCreditTypeId] = useState("");
  const [creditDateFrom, setCreditDateFrom] = useState("");
  const [creditDateUntil, setCreditDateUntil] = useState("");
  const [creditLines, setCreditLines] = useState<Record<string, { timeFrom: string; timeUntil: string; reason: string }>>({});
  const [creditSubmitting, setCreditSubmitting] = useState(false);
  const [creditCancelTarget, setCreditCancelTarget] = useState<LeaveCreditRequestWithDetails | null>(null);
  const [creditCancelling, setCreditCancelling] = useState(false);

  const canApply = permissions.includes("leave:apply") || permissions.includes("*");
  const today = fmtLocalDate(new Date());
  const creditBasedTypes = leaveTypes.filter((t) => t.isCreditBased);
  const selectedCreditType = creditBasedTypes.find((t) => t.id === creditTypeId) ?? null;
  const creditDates = calcDateRange(creditDateFrom, creditDateUntil);
  const creditHourRules = (selectedCreditType?.creditHourRules ?? []) as Array<{
    minHours: number;
    maxHours: number | null;
    days: number;
  }>;
  function creditDaysFor(date: string): number | null {
    const l = creditLines[date];
    if (!l || !l.timeFrom || !l.timeUntil || l.timeUntil <= l.timeFrom) return null;
    return getCreditDaysForHours(creditHourRules, calcHoursWorked(l.timeFrom, l.timeUntil));
  }
  const creditTotalDays = creditDates.reduce((sum, d) => sum + (creditDaysFor(d) ?? 0), 0);
  const creditExceedsMax =
    selectedCreditType?.maxDaysPerApplication != null && creditTotalDays > selectedCreditType.maxDaysPerApplication;
  const creditFormValid =
    creditTypeId !== "" &&
    creditDates.length > 0 &&
    !creditExceedsMax &&
    creditDates.every((d) => {
      const l = creditLines[d];
      return l && l.timeFrom && l.timeUntil && l.timeUntil > l.timeFrom && l.reason.trim() !== "";
    });

  // ── Derived form state ────────────────────────────────────────────────────
  const selectedType = leaveTypes.find((t) => t.id === selectedTypeId) ?? null;
  const selectedBalance = balances.find((b) => b.leaveTypeId === selectedTypeId) ?? null;
  const effectiveEnd = isHalfDay ? startDate : endDate;
  const workingDays = calcWorkingDays(startDate, effectiveEnd, isHalfDay);
  const remaining = selectedBalance ? parseFloat(selectedBalance.remainingDays) : 0;
  const insufficientBalance = selectedType !== null && workingDays > 0 && workingDays > remaining;
  const isFormValid =
    selectedTypeId !== "" &&
    startDate !== "" &&
    (isHalfDay || endDate !== "") &&
    workingDays > 0 &&
    !insufficientBalance;

  function resetApplyForm() {
    setSelectedTypeId("");
    setStartDate("");
    setEndDate("");
    setIsHalfDay(false);
    setHalfDayPeriod("AM");
    setReason("");
    setQueuedFiles([]);
  }

  function resetCreditForm() {
    setCreditTypeId(creditBasedTypes.length === 1 ? creditBasedTypes[0].id : "");
    setCreditDateFrom("");
    setCreditDateUntil("");
    setCreditLines({});
  }

  function updateCreditLine(date: string, field: "timeFrom" | "timeUntil" | "reason", value: string) {
    setCreditLines((prev) => ({
      ...prev,
      [date]: { ...(prev[date] ?? { timeFrom: "", timeUntil: "", reason: "" }), [field]: value },
    }));
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    setQueuedFiles((prev) => [
      ...prev,
      ...files.map((f) => ({ file: f, id: Math.random().toString(36).slice(2) })),
    ]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  // ── Handlers ──────────────────────────────────────────────────────────────

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

  async function handleApplySubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isFormValid || submitting) return;
    setSubmitting(true);
    try {
      const appId = await applyForLeave({
        leaveTypeId: selectedTypeId,
        startDate,
        endDate: effectiveEnd,
        isHalfDay,
        halfDayPeriod: isHalfDay ? halfDayPeriod : undefined,
        reason: reason.trim() || undefined,
      });

      for (const qf of queuedFiles) {
        const res = await fetch("/api/leave/upload-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            appId,
            fileName: qf.file.name,
            mimeType: qf.file.type || "application/octet-stream",
            fileSize: qf.file.size,
          }),
        });
        if (!res.ok) { toast.error(`Failed to get upload URL for ${qf.file.name}`); continue; }
        const { uploadUrl, key } = await res.json();
        const uploadRes = await fetch(uploadUrl, {
          method: "PUT",
          body: qf.file,
          headers: { "Content-Type": qf.file.type || "application/octet-stream" },
        });
        if (!uploadRes.ok) { toast.error(`Failed to upload ${qf.file.name}`); continue; }
        await createLeaveDocumentRecord({
          applicationId: appId,
          fileName: qf.file.name,
          fileKey: key,
          fileSize: qf.file.size,
          mimeType: qf.file.type || "application/octet-stream",
        });
      }

      toast.success("Leave application submitted");
      setApplyOpen(false);
      resetApplyForm();
      startTransition(() => router.refresh());
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to submit application");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCreditSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!creditFormValid || creditSubmitting) return;
    setCreditSubmitting(true);
    try {
      await applyForReplacementCredit({
        leaveTypeId: creditTypeId,
        dateFrom: creditDateFrom,
        dateUntil: creditDateUntil,
        lines: creditDates.map((d) => ({ date: d, ...(creditLines[d] ?? { timeFrom: "", timeUntil: "", reason: "" }) })),
      });
      toast.success("Replacement credit request submitted");
      setCreditOpen(false);
      resetCreditForm();
      startTransition(() => router.refresh());
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to submit request");
    } finally {
      setCreditSubmitting(false);
    }
  }

  async function handleCreditCancel() {
    if (!creditCancelTarget) return;
    setCreditCancelling(true);
    try {
      await cancelReplacementCredit(creditCancelTarget.id);
      toast.success("Replacement credit request cancelled");
      setCreditCancelTarget(null);
      startTransition(() => router.refresh());
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to cancel");
    } finally {
      setCreditCancelling(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

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
          <div className="flex items-center gap-2">
            {creditBasedTypes.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => { resetCreditForm(); setCreditOpen(true); }}
              >
                <PlusIcon className="h-4 w-4 mr-1" />
                Request Replacement Credit
              </Button>
            )}
            <Button size="sm" onClick={() => setApplyOpen(true)}>
              <PlusIcon className="h-4 w-4 mr-1" />
              Apply Leave
            </Button>
          </div>
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
              <button
                className="text-primary hover:underline"
                onClick={() => setApplyOpen(true)}
              >
                Apply for leave
              </button>
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
                      {app.startDate !== app.endDate && <> &rarr; {app.endDate}</>}
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

      {/* Replacement Credit Requests */}
      {creditBasedTypes.length > 0 && (
        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Replacement Credit Requests
          </h2>
          {creditRequests.length === 0 ? (
            <div className="rounded-lg border border-border py-10 text-center text-sm text-muted-foreground">
              No replacement credit requests yet.{" "}
              <button
                className="text-primary hover:underline"
                onClick={() => { resetCreditForm(); setCreditOpen(true); }}
              >
                Request credit for a worked day
              </button>
            </div>
          ) : (
            <div className="rounded-lg border border-border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead className="w-32.5">Ref No.</TableHead>
                    <TableHead>Leave Type</TableHead>
                    <TableHead className="w-50">Period</TableHead>
                    <TableHead className="w-20 text-right">Days</TableHead>
                    <TableHead className="w-27.5">Status</TableHead>
                    <TableHead className="w-20 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {creditRequests.map((req) => (
                    <TableRow key={req.id}>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {req.requestNo}
                      </TableCell>
                      <TableCell className="text-sm font-medium">{req.leaveTypeName}</TableCell>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                        {req.dateFrom}
                        {req.dateFrom !== req.dateUntil && <> &rarr; {req.dateUntil}</>}
                      </TableCell>
                      <TableCell className="text-right text-sm font-medium">
                        {formatDays(req.totalDays)}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={req.status} />
                      </TableCell>
                      <TableCell className="text-right">
                        {req.status === "PENDING" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                            onClick={() => setCreditCancelTarget(req)}
                            title="Cancel request"
                          >
                            <XIcon className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      )}

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

      {/* Cancel Credit Request Confirmation Sheet */}
      <Sheet open={!!creditCancelTarget} onOpenChange={(open) => !open && setCreditCancelTarget(null)}>
        <SheetContent className="w-full sm:max-w-md max-w-lg! overflow-y-auto px-10">
          <SheetHeader className="mb-5">
            <SheetTitle>Cancel Replacement Credit Request</SheetTitle>
          </SheetHeader>
          <div className="space-y-4">
            <div className="rounded-md bg-destructive/10 border border-destructive/30 p-4 flex items-start gap-3">
              <AlertTriangleIcon className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
              <p className="text-sm text-destructive leading-relaxed">
                Are you sure you want to cancel the claim for{" "}
                <strong>{formatDays(creditCancelTarget?.totalDays ?? "0")} day(s)</strong> worked{" "}
                <strong>
                  {creditCancelTarget?.dateFrom}
                  {creditCancelTarget && creditCancelTarget.dateFrom !== creditCancelTarget.dateUntil && <> &rarr; {creditCancelTarget.dateUntil}</>}
                </strong>{" "}
                ({creditCancelTarget?.requestNo})? This action cannot be undone.
              </p>
            </div>
            <div className="flex gap-2 pt-2">
              <Button variant="destructive" onClick={handleCreditCancel} disabled={creditCancelling} className="flex-1">
                {creditCancelling ? "Cancelling…" : "Yes, Cancel Request"}
              </Button>
              <Button variant="outline" onClick={() => setCreditCancelTarget(null)} disabled={creditCancelling}>
                Keep
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Apply Leave Sheet */}
      <Sheet
        open={applyOpen}
        onOpenChange={(open) => {
          if (submitting) return;
          if (!open) resetApplyForm();
          setApplyOpen(open);
        }}
      >
        <SheetContent className="w-full sm:max-w-xl max-w-full! overflow-y-auto px-6">
          <SheetHeader className="mb-5">
            <SheetTitle className="flex items-center gap-2">
              <FilePlusIcon className="h-5 w-5 text-muted-foreground" />
              Apply for Leave
            </SheetTitle>
          </SheetHeader>

          {leaveTypes.length === 0 ? (
            <div className="rounded-lg border border-border py-12 text-center text-sm text-muted-foreground">
              No active leave types configured. Please contact your HR administrator.
            </div>
          ) : (
            <form onSubmit={handleApplySubmit} className="flex flex-col gap-5 pb-6">

              {/* ── Leave Type ── */}
              <section className="rounded-lg border border-border overflow-hidden">
                <div className="px-4 py-3 bg-muted/40 border-b border-border">
                  <h2 className="text-sm font-semibold">Leave Type</h2>
                </div>
                <div className="p-4 flex flex-col gap-4">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="leaveType">
                      Select Leave Type <span className="text-destructive">*</span>
                    </Label>
                    <Select
                      value={selectedTypeId}
                      onValueChange={(v) => { setSelectedTypeId(v); setIsHalfDay(false); }}
                    >
                      <SelectTrigger id="leaveType">
                        <SelectValue placeholder="Select a leave type…" />
                      </SelectTrigger>
                      <SelectContent>
                        {leaveTypes.map((t) => {
                          const bal = balances.find((b) => b.leaveTypeId === t.id);
                          const rem = bal ? parseFloat(bal.remainingDays) : null;
                          return (
                            <SelectItem key={t.id} value={t.id}>
                              <span className="font-medium">
                                {withEmergencyLabel(t.name, t.emergencyThresholdDays != null)}
                              </span>
                              <span className="text-muted-foreground ml-1.5 text-xs">
                                {rem !== null ? `— ${formatDays(rem)} days left` : ""}
                              </span>
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                  </div>

                  {selectedType && (
                    <div className="rounded-md bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 p-3 flex flex-col gap-2">
                      <div className="flex items-center gap-2">
                        <InfoIcon className="h-4 w-4 text-blue-600 dark:text-blue-400 shrink-0" />
                        <span className="text-sm font-medium text-blue-800 dark:text-blue-300">
                          {withEmergencyLabel(selectedType.name, selectedType.emergencyThresholdDays != null)}
                        </span>
                        <div className="flex gap-1.5 ml-auto flex-wrap justify-end">
                          <Badge
                            variant="outline"
                            className={`text-xs px-1.5 py-0 h-5 ${
                              selectedType.isPaid
                                ? "text-blue-700 border-blue-300 bg-blue-100 dark:text-blue-400 dark:border-blue-700"
                                : "text-muted-foreground"
                            }`}
                          >
                            {selectedType.isPaid ? "Paid" : "Unpaid"}
                          </Badge>
                          {selectedType.allowHalfDay && (
                            <Badge
                              variant="outline"
                              className="text-xs px-1.5 py-0 h-5 text-green-700 border-green-300 bg-green-50 dark:text-green-400 dark:border-green-700"
                            >
                              Half-day OK
                            </Badge>
                          )}
                        </div>
                      </div>
                      {selectedType.description && (
                        <p className="text-xs text-blue-700 dark:text-blue-400 pl-6">
                          {selectedType.description}
                        </p>
                      )}
                      {selectedType.requiresDocument && (
                        <p className="text-xs text-amber-700 dark:text-amber-400 pl-6 font-medium">
                          ⚠ Supporting document (MC/certificate) is required.
                        </p>
                      )}
                      {selectedBalance && (
                        <p className="text-xs text-blue-600 dark:text-blue-400 pl-6">
                          Balance:{" "}
                          <strong>{formatDays(selectedBalance.remainingDays)} days</strong> remaining
                          {parseFloat(selectedBalance.pendingDays) > 0 && (
                            <span className="text-amber-600 dark:text-amber-400 ml-1">
                              ({formatDays(selectedBalance.pendingDays)} pending)
                            </span>
                          )}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </section>

              {/* ── Dates ── */}
              {selectedType && (
                <section className="rounded-lg border border-border overflow-hidden">
                  <div className="px-4 py-3 bg-muted/40 border-b border-border">
                    <h2 className="text-sm font-semibold">Leave Dates</h2>
                  </div>
                  <div className="p-4 flex flex-col gap-4">
                    {selectedType.allowHalfDay && (
                      <label className="flex items-center gap-2.5 cursor-pointer select-none w-fit">
                        <input
                          type="checkbox"
                          checked={isHalfDay}
                          onChange={(e) => setIsHalfDay(e.target.checked)}
                          className="h-4 w-4 rounded border-input accent-primary"
                        />
                        <span className="text-sm font-medium">Half-day leave</span>
                      </label>
                    )}

                    {isHalfDay ? (
                      <div className="grid grid-cols-2 gap-4">
                        <div className="flex flex-col gap-1.5">
                          <Label htmlFor="halfDayDate">Date <span className="text-destructive">*</span></Label>
                          <input
                            type="date"
                            id="halfDayDate"
                            value={startDate}
                            onChange={(e) => setStartDate(e.target.value)}
                            className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                            required
                          />
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <Label htmlFor="halfDayPeriod">Period <span className="text-destructive">*</span></Label>
                          <Select
                            value={halfDayPeriod}
                            onValueChange={(v) => setHalfDayPeriod(v as "AM" | "PM")}
                          >
                            <SelectTrigger id="halfDayPeriod">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="AM">Morning (AM)</SelectItem>
                              <SelectItem value="PM">Afternoon (PM)</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-4">
                        <div className="flex flex-col gap-1.5">
                          <Label htmlFor="startDate">Start Date <span className="text-destructive">*</span></Label>
                          <input
                            type="date"
                            id="startDate"
                            value={startDate}
                            onChange={(e) => {
                              setStartDate(e.target.value);
                              if (endDate && e.target.value > endDate) setEndDate(e.target.value);
                            }}
                            className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                            required
                          />
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <Label htmlFor="endDate">End Date <span className="text-destructive">*</span></Label>
                          <input
                            type="date"
                            id="endDate"
                            value={endDate}
                            min={startDate || undefined}
                            onChange={(e) => setEndDate(e.target.value)}
                            className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                            required
                          />
                        </div>
                      </div>
                    )}

                    {(isHalfDay ? startDate : startDate && endDate) && (
                      <div
                        className={`rounded-md px-4 py-2.5 text-sm font-medium border ${
                          insufficientBalance
                            ? "bg-destructive/10 text-destructive border-destructive/30"
                            : workingDays > 0
                            ? "bg-green-50 text-green-700 border-green-200 dark:bg-green-950/30 dark:text-green-400 dark:border-green-800"
                            : "bg-muted text-muted-foreground border-border"
                        }`}
                      >
                        {workingDays > 0 ? (
                          <>
                            {formatDays(workingDays)} working{" "}
                            {workingDays <= 1 ? "day" : "days"}
                            {isHalfDay && ` — ${halfDayPeriod}`}
                            {insufficientBalance && (
                              <span className="ml-2 font-normal opacity-90">
                                (only {formatDays(remaining)} available)
                              </span>
                            )}
                          </>
                        ) : (
                          "No working days in selected range"
                        )}
                      </div>
                    )}

                    {insufficientBalance && (
                      <div className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-md p-3">
                        <AlertTriangleIcon className="h-4 w-4 mt-0.5 shrink-0" />
                        <span>
                          Only <strong>{formatDays(remaining)}</strong> days remaining for{" "}
                          {selectedType.name}. You requested{" "}
                          <strong>{formatDays(workingDays)}</strong> days.
                        </span>
                      </div>
                    )}
                  </div>
                </section>
              )}

              {/* ── Reason ── */}
              {selectedType && (
                <section className="rounded-lg border border-border overflow-hidden">
                  <div className="px-4 py-3 bg-muted/40 border-b border-border">
                    <h2 className="text-sm font-semibold">Reason</h2>
                  </div>
                  <div className="p-4">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="reason">
                        Reason{" "}
                        <span className="text-muted-foreground font-normal">(optional but recommended)</span>
                      </Label>
                      <Textarea
                        id="reason"
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder="Briefly describe the reason for your leave…"
                        rows={3}
                      />
                    </div>
                  </div>
                </section>
              )}

              {/* ── Supporting Document ── */}
              {selectedType && (
                <section className="rounded-lg border border-border overflow-hidden">
                  <div className="px-4 py-3 bg-muted/40 border-b border-border flex items-center justify-between">
                    <h2 className="text-sm font-semibold">
                      Supporting Document
                      {selectedType.requiresDocument && (
                        <span className="ml-1.5 text-destructive font-normal text-xs">* Required</span>
                      )}
                    </h2>
                  </div>
                  <div className="p-4 flex flex-col gap-3">
                    {selectedType.requiresDocument && queuedFiles.length === 0 && (
                      <div className="flex items-start gap-2 text-sm text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-700 rounded-md p-3">
                        <AlertTriangleIcon className="h-4 w-4 mt-0.5 shrink-0" />
                        <span>
                          A supporting document (e.g. Medical Certificate) is required.
                        </span>
                      </div>
                    )}
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                      onChange={handleFileChange}
                      className="hidden"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="w-fit gap-2"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <UploadIcon className="h-4 w-4" />
                      Attach Files
                    </Button>
                    {queuedFiles.length > 0 && (
                      <div className="flex flex-col gap-1.5">
                        {queuedFiles.map((qf) => (
                          <div
                            key={qf.id}
                            className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2 text-sm"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="truncate font-medium text-foreground">{qf.file.name}</span>
                              <span className="text-muted-foreground text-xs shrink-0">
                                {(qf.file.size / 1024).toFixed(0)} KB
                              </span>
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 text-muted-foreground hover:text-destructive shrink-0"
                              onClick={() => setQueuedFiles((prev) => prev.filter((f) => f.id !== qf.id))}
                            >
                              <XIcon className="h-3 w-3" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground">
                      Accepted: PDF, JPG, PNG, DOC, DOCX — max 10 MB per file.
                    </p>
                  </div>
                </section>
              )}

              {/* ── Actions ── */}
              <div className="flex gap-3 pt-1">
                <Button type="submit" disabled={!isFormValid || submitting} className="flex-1 sm:flex-none sm:min-w-40">
                  {submitting ? "Submitting…" : "Submit Application"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={submitting}
                  onClick={() => { resetApplyForm(); setApplyOpen(false); }}
                >
                  Cancel
                </Button>
              </div>
            </form>
          )}
        </SheetContent>
      </Sheet>

      {/* Request Replacement Credit Sheet */}
      <Sheet
        open={creditOpen}
        onOpenChange={(open) => {
          if (creditSubmitting) return;
          if (!open) resetCreditForm();
          setCreditOpen(open);
        }}
      >
        <SheetContent className="w-full sm:max-w-xl max-w-full! overflow-y-auto px-6">
          <SheetHeader className="mb-5">
            <SheetTitle className="flex items-center gap-2">
              <FilePlusIcon className="h-5 w-5 text-muted-foreground" />
              Request Replacement Credit
            </SheetTitle>
          </SheetHeader>

          <form onSubmit={handleCreditSubmit} className="flex flex-col gap-4 pb-6">
            <p className="text-xs text-muted-foreground -mt-2">
              Worked an off-day or public holiday? Claim it here — once approved, the days are added
              to your balance and you can apply for the leave itself separately.
            </p>

            {creditBasedTypes.length > 1 && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="creditType">Leave Type <span className="text-destructive">*</span></Label>
                <Select value={creditTypeId} onValueChange={setCreditTypeId}>
                  <SelectTrigger id="creditType">
                    <SelectValue placeholder="Select a leave type…" />
                  </SelectTrigger>
                  <SelectContent>
                    {creditBasedTypes.map((t) => (
                      <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="creditDateFrom">Date Worked From <span className="text-destructive">*</span></Label>
                <input
                  type="date"
                  id="creditDateFrom"
                  value={creditDateFrom}
                  max={creditDateUntil || today}
                  onChange={(e) => {
                    setCreditDateFrom(e.target.value);
                    if (creditDateUntil && e.target.value > creditDateUntil) setCreditDateUntil(e.target.value);
                  }}
                  className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="creditDateUntil">Date Worked Until <span className="text-destructive">*</span></Label>
                <input
                  type="date"
                  id="creditDateUntil"
                  value={creditDateUntil}
                  min={creditDateFrom || undefined}
                  max={today}
                  onChange={(e) => setCreditDateUntil(e.target.value)}
                  className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                  required
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground -mt-2">
              Every calendar date in this range (weekends included) will need its own time and reason below.
              {creditHourRules.length > 0 && " Days credited depend on hours worked — see each row below."}
            </p>

            {creditDates.length > 0 && (
              <div
                className={`rounded-md px-4 py-2.5 text-sm font-medium border -mt-1 ${
                  creditExceedsMax
                    ? "bg-destructive/10 text-destructive border-destructive/30"
                    : "bg-green-50 text-green-700 border-green-200 dark:bg-green-950/30 dark:text-green-400 dark:border-green-800"
                }`}
              >
                {creditDates.length} date{creditDates.length !== 1 ? "s" : ""} in range
                {" — "}{formatDays(creditTotalDays)} day{creditTotalDays !== 1 ? "s" : ""} to be credited
                {creditExceedsMax && selectedCreditType?.maxDaysPerApplication != null && (
                  <span className="ml-2 font-normal opacity-90">
                    (maximum {selectedCreditType.maxDaysPerApplication} per request)
                  </span>
                )}
              </div>
            )}

            {creditDates.length > 0 && (
              <div className="flex flex-col gap-3">
                <Label>Time &amp; Reason for Each Date <span className="text-destructive">*</span></Label>
                {creditDates.map((d) => {
                  const line = creditLines[d] ?? { timeFrom: "", timeUntil: "", reason: "" };
                  return (
                    <div key={d} className="rounded-md border border-border p-3 flex flex-col gap-2">
                      <span className="text-xs font-semibold">{fmtDateLabel(d)}</span>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="flex flex-col gap-1">
                          <Label htmlFor={`timeFrom-${d}`} className="text-xs text-muted-foreground">Time From</Label>
                          <input
                            type="time"
                            id={`timeFrom-${d}`}
                            value={line.timeFrom}
                            onChange={(e) => updateCreditLine(d, "timeFrom", e.target.value)}
                            className="w-full border border-input rounded-md px-2 py-1.5 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                            required
                          />
                        </div>
                        <div className="flex flex-col gap-1">
                          <Label htmlFor={`timeUntil-${d}`} className="text-xs text-muted-foreground">Time Until</Label>
                          <input
                            type="time"
                            id={`timeUntil-${d}`}
                            value={line.timeUntil}
                            onChange={(e) => updateCreditLine(d, "timeUntil", e.target.value)}
                            className="w-full border border-input rounded-md px-2 py-1.5 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                            required
                          />
                        </div>
                      </div>
                      {line.timeFrom && line.timeUntil && line.timeUntil <= line.timeFrom && (
                        <p className="text-xs text-destructive">Time until must be after time from.</p>
                      )}
                      {line.timeFrom && line.timeUntil && line.timeUntil > line.timeFrom && (
                        <p className="text-xs text-muted-foreground">
                          {calcHoursWorked(line.timeFrom, line.timeUntil).toFixed(1)} hours &rarr;{" "}
                          <span className="font-medium text-foreground">
                            {formatDays(creditDaysFor(d) ?? 0)} day{(creditDaysFor(d) ?? 0) !== 1 ? "s" : ""}
                          </span>
                        </p>
                      )}
                      <div className="flex flex-col gap-1">
                        <Label htmlFor={`reason-${d}`} className="text-xs text-muted-foreground">
                          Reason <span className="text-destructive">*</span>
                        </Label>
                        <Textarea
                          id={`reason-${d}`}
                          value={line.reason}
                          onChange={(e) => updateCreditLine(d, "reason", e.target.value)}
                          placeholder="What did you work on this day…"
                          rows={2}
                          required
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="flex gap-3 pt-1">
              <Button
                type="submit"
                disabled={!creditFormValid || creditSubmitting}
                className="flex-1 sm:flex-none sm:min-w-40"
              >
                {creditSubmitting ? "Submitting…" : "Submit Request"}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={creditSubmitting}
                onClick={() => { resetCreditForm(); setCreditOpen(false); }}
              >
                Cancel
              </Button>
            </div>
          </form>
        </SheetContent>
      </Sheet>
    </div>
  );
}
