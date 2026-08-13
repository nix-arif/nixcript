"use client";

import { useState, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { LeaveTypeRow, MyLeaveBalance } from "@/server/leave";
import { applyForLeave, createLeaveDocumentRecord } from "@/server/leave";
import {
  ArrowLeftIcon,
  UploadIcon,
  XIcon,
  InfoIcon,
  AlertTriangleIcon,
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

function formatDays(n: number | string): string {
  const v = typeof n === "string" ? parseFloat(n) : n;
  return v % 1 === 0 ? String(Math.round(v)) : v.toFixed(1);
}

// ── Types ──────────────────────────────────────────────────────────────────

interface QueuedFile {
  file: File;
  id: string;
}

interface Props {
  leaveTypes: LeaveTypeRow[];
  balances: MyLeaveBalance[];
}

// ── Component ──────────────────────────────────────────────────────────────

export function ApplyLeaveClient({ leaveTypes, balances }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [selectedTypeId, setSelectedTypeId] = useState<string>("");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [isHalfDay, setIsHalfDay] = useState(false);
  const [halfDayPeriod, setHalfDayPeriod] = useState<"AM" | "PM">("AM");
  const [reason, setReason] = useState<string>("");
  const [queuedFiles, setQueuedFiles] = useState<QueuedFile[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const selectedType = leaveTypes.find((t) => t.id === selectedTypeId) ?? null;
  const selectedBalance = balances.find((b) => b.leaveTypeId === selectedTypeId) ?? null;

  const effectiveStart = startDate;
  const effectiveEnd = isHalfDay ? startDate : endDate;
  const workingDays = calcWorkingDays(effectiveStart, effectiveEnd, isHalfDay);
  const remaining = selectedBalance ? parseFloat(selectedBalance.remainingDays) : 0;
  const insufficientBalance = selectedType !== null && workingDays > 0 && workingDays > remaining;
  const willBeEmergency =
    selectedType?.emergencyThresholdDays != null &&
    workingDays > 0 &&
    workingDays <= selectedType.emergencyThresholdDays;

  const isFormValid =
    selectedTypeId !== "" &&
    startDate !== "" &&
    (isHalfDay || endDate !== "") &&
    workingDays > 0 &&
    !insufficientBalance;

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    setQueuedFiles((prev) => [
      ...prev,
      ...files.map((f) => ({ file: f, id: Math.random().toString(36).slice(2) })),
    ]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isFormValid || submitting) return;
    setSubmitting(true);
    try {
      const appId = await applyForLeave({
        leaveTypeId: selectedTypeId,
        startDate: effectiveStart,
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

      toast.success("Leave application submitted successfully");
      startTransition(() => router.push("/dashboard/human-resources/leave"));
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to submit application");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="p-6 flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-start gap-3">
        <Link href="/dashboard/human-resources/leave">
          <Button variant="ghost" size="icon" className="mt-0.5 shrink-0">
            <ArrowLeftIcon className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <FilePlusIcon className="h-5 w-5 text-muted-foreground" />
            Apply for Leave
          </h1>
          <p className="text-sm text-muted-foreground">Submit a new leave application.</p>
        </div>
      </div>

      {leaveTypes.length === 0 ? (
        <div className="rounded-lg border border-border py-12 text-center text-sm text-muted-foreground">
          No active leave types are configured. Please contact your HR administrator.
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-5 max-w-2xl">

          {/* ── Leave Type ── */}
          <section className="rounded-lg border border-border overflow-hidden">
            <div className="px-4 py-3 bg-muted/40 border-b border-border">
              <h2 className="text-sm font-semibold">Leave Type</h2>
            </div>
            <div className="p-4 flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="leaveType">Select Leave Type <span className="text-destructive">*</span></Label>
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
                          <span className="font-medium">{t.name}</span>
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
                      {selectedType.name}
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
                      ⚠ Supporting document (MC/certificate) is required for this leave type.
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

                {/* Day count indicator */}
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

                {willBeEmergency && (
                  <div className="flex items-start gap-2 text-sm text-orange-700 dark:text-orange-400 bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-800 rounded-md p-3">
                    <InfoIcon className="h-4 w-4 mt-0.5 shrink-0" />
                    <span>
                      This will be automatically recorded as <strong>Emergency Leave</strong>{" "}
                      (≤{selectedType!.emergencyThresholdDays} days) — it still draws from your{" "}
                      {selectedType!.name} balance.
                    </span>
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
                      A supporting document (e.g. Medical Certificate) is required. Please attach it before submitting.
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
          <div className="flex items-center gap-3 pt-1">
            <Link href="/dashboard/human-resources/leave">
              <Button type="button" variant="outline" disabled={submitting}>
                Cancel
              </Button>
            </Link>
            <Button type="submit" disabled={!isFormValid || submitting}>
              {submitting ? "Submitting…" : "Submit Application"}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
