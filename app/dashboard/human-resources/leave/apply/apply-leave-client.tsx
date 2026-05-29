"use client";

import { useState, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { LeaveTypeRow, MyLeaveBalance } from "@/server/leave";
import { applyForLeave, createLeaveDocumentRecord } from "@/server/leave";
import { ArrowLeftIcon, UploadIcon, XIcon, InfoIcon, AlertTriangleIcon } from "lucide-react";

/* =========================
   CLIENT-SIDE WORKING DAYS
========================= */

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

/* =========================
   QUEUED FILE
========================= */

interface QueuedFile {
  file: File;
  id: string;
}

/* =========================
   MAIN COMPONENT
========================= */

interface Props {
  leaveTypes: LeaveTypeRow[];
  balances: MyLeaveBalance[];
}

export function ApplyLeaveClient({ leaveTypes, balances }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Form state
  const [selectedTypeId, setSelectedTypeId] = useState<string>("");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [isHalfDay, setIsHalfDay] = useState(false);
  const [halfDayPeriod, setHalfDayPeriod] = useState<"AM" | "PM">("AM");
  const [reason, setReason] = useState<string>("");
  const [queuedFiles, setQueuedFiles] = useState<QueuedFile[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // Derived state
  const selectedType = leaveTypes.find((t) => t.id === selectedTypeId) ?? null;
  const selectedBalance = balances.find((b) => b.leaveTypeId === selectedTypeId) ?? null;

  const effectiveStart = isHalfDay ? startDate : startDate;
  const effectiveEnd = isHalfDay ? startDate : endDate;
  const workingDays = calcWorkingDays(effectiveStart, effectiveEnd, isHalfDay);

  const remaining = selectedBalance ? parseFloat(selectedBalance.remainingDays) : 0;
  const insufficientBalance = selectedType !== null && workingDays > 0 && workingDays > remaining;

  const isFormValid =
    selectedTypeId !== "" &&
    startDate !== "" &&
    (isHalfDay || endDate !== "") &&
    workingDays > 0 &&
    !insufficientBalance;

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    const newFiles: QueuedFile[] = files.map((f) => ({
      file: f,
      id: Math.random().toString(36).slice(2),
    }));
    setQueuedFiles((prev) => [...prev, ...newFiles]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removeFile(id: string) {
    setQueuedFiles((prev) => prev.filter((f) => f.id !== id));
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

      // Upload documents if any
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
        if (!res.ok) {
          toast.error(`Failed to get upload URL for ${qf.file.name}`);
          continue;
        }
        const { uploadUrl, key } = await res.json();
        const uploadRes = await fetch(uploadUrl, {
          method: "PUT",
          body: qf.file,
          headers: { "Content-Type": qf.file.type || "application/octet-stream" },
        });
        if (!uploadRes.ok) {
          toast.error(`Failed to upload ${qf.file.name}`);
          continue;
        }
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
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/dashboard/human-resources/leave">
          <Button variant="ghost" size="icon">
            <ArrowLeftIcon className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Apply for Leave</h1>
          <p className="text-sm text-gray-500">Submit a new leave application</p>
        </div>
      </div>

      {leaveTypes.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-gray-500">
            No active leave types are configured. Please contact your HR administrator.
          </CardContent>
        </Card>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Leave Type */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Leave Type</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="leaveType">Select Leave Type *</Label>
                <select
                  id="leaveType"
                  value={selectedTypeId}
                  onChange={(e) => {
                    setSelectedTypeId(e.target.value);
                    setIsHalfDay(false);
                  }}
                  className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                  required
                >
                  <option value="">-- Select leave type --</option>
                  {leaveTypes.map((t) => {
                    const bal = balances.find((b) => b.leaveTypeId === t.id);
                    const rem = bal ? parseFloat(bal.remainingDays) : null;
                    return (
                      <option key={t.id} value={t.id}>
                        {t.name} ({rem !== null ? `${formatDays(rem)} days remaining` : "no balance info"})
                      </option>
                    );
                  })}
                </select>
              </div>

              {selectedType && (
                <div className="rounded-lg bg-blue-50 border border-blue-100 p-3 space-y-1.5">
                  <div className="flex items-center gap-2 text-sm text-blue-700">
                    <InfoIcon className="h-4 w-4 flex-shrink-0" />
                    <span className="font-medium">{selectedType.name}</span>
                    <div className="flex gap-1 ml-auto">
                      <Badge
                        variant="outline"
                        className={`text-xs ${selectedType.isPaid ? "text-blue-700 border-blue-300 bg-blue-100" : "text-gray-600"}`}
                      >
                        {selectedType.isPaid ? "Paid" : "Unpaid"}
                      </Badge>
                      {selectedType.allowHalfDay && (
                        <Badge variant="outline" className="text-xs text-green-700 border-green-200 bg-green-50">
                          Half-day OK
                        </Badge>
                      )}
                    </div>
                  </div>
                  {selectedType.description && (
                    <p className="text-xs text-blue-600 pl-6">{selectedType.description}</p>
                  )}
                  {selectedType.requiresDocument && (
                    <p className="text-xs text-amber-700 pl-6 font-medium">
                      Supporting document (MC/certificate) is required for this leave type.
                    </p>
                  )}
                  {selectedBalance && (
                    <div className="text-xs text-blue-600 pl-6 mt-1">
                      Balance: {formatDays(selectedBalance.remainingDays)} days remaining
                      {parseFloat(selectedBalance.pendingDays) > 0 && (
                        <span className="text-amber-600 ml-1">
                          ({formatDays(selectedBalance.pendingDays)} pending)
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Dates */}
          {selectedType && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Leave Dates</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Half-day toggle */}
                {selectedType.allowHalfDay && (
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      id="halfDay"
                      checked={isHalfDay}
                      onChange={(e) => setIsHalfDay(e.target.checked)}
                      className="h-4 w-4 rounded border-gray-300"
                    />
                    <Label htmlFor="halfDay" className="cursor-pointer">
                      Half-day leave
                    </Label>
                  </div>
                )}

                {isHalfDay ? (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="halfDayDate">Date *</Label>
                      <input
                        type="date"
                        id="halfDayDate"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="halfDayPeriod">Period *</Label>
                      <select
                        id="halfDayPeriod"
                        value={halfDayPeriod}
                        onChange={(e) => setHalfDayPeriod(e.target.value as "AM" | "PM")}
                        className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                      >
                        <option value="AM">Morning (AM)</option>
                        <option value="PM">Afternoon (PM)</option>
                      </select>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="startDate">Start Date *</Label>
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
                    <div className="space-y-2">
                      <Label htmlFor="endDate">End Date *</Label>
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

                {/* Working days display */}
                {(isHalfDay ? startDate : startDate && endDate) && (
                  <div
                    className={`rounded-md px-4 py-2 text-sm font-medium ${
                      insufficientBalance
                        ? "bg-red-50 text-red-700 border border-red-200"
                        : workingDays > 0
                        ? "bg-green-50 text-green-700 border border-green-200"
                        : "bg-gray-50 text-gray-500 border border-gray-200"
                    }`}
                  >
                    {workingDays > 0 ? (
                      <>
                        {formatDays(workingDays)} working{" "}
                        {workingDays === 1 || workingDays === 0.5 ? "day" : "days"}
                        {isHalfDay && ` (${halfDayPeriod})`}
                        {insufficientBalance && (
                          <span className="ml-2 font-normal">
                            — Insufficient balance ({formatDays(remaining)} days available)
                          </span>
                        )}
                      </>
                    ) : (
                      "No working days in selected range"
                    )}
                  </div>
                )}

                {insufficientBalance && (
                  <div className="flex items-start gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-md p-3">
                    <AlertTriangleIcon className="h-4 w-4 mt-0.5 flex-shrink-0" />
                    <span>
                      You only have <strong>{formatDays(remaining)}</strong> days remaining for{" "}
                      {selectedType.name}. Requested: <strong>{formatDays(workingDays)}</strong> days.
                    </span>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Reason */}
          {selectedType && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Reason</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <Label htmlFor="reason">
                    Reason{" "}
                    <span className="text-gray-400 font-normal">(optional but recommended)</span>
                  </Label>
                  <Textarea
                    id="reason"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Briefly describe the reason for your leave..."
                    rows={3}
                  />
                </div>
              </CardContent>
            </Card>
          )}

          {/* Documents */}
          {selectedType && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">
                  Supporting Document
                  {selectedType.requiresDocument && (
                    <span className="ml-2 text-red-500 font-normal text-sm">* Required</span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {selectedType.requiresDocument && queuedFiles.length === 0 && (
                  <div className="flex items-start gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-3">
                    <AlertTriangleIcon className="h-4 w-4 mt-0.5 flex-shrink-0" />
                    <span>
                      This leave type requires a supporting document (e.g. Medical Certificate).
                      Please attach the document before submitting.
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
                  className="gap-2"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <UploadIcon className="h-4 w-4" />
                  Attach Files
                </Button>

                {queuedFiles.length > 0 && (
                  <div className="space-y-2">
                    {queuedFiles.map((qf) => (
                      <div
                        key={qf.id}
                        className="flex items-center justify-between bg-gray-50 border border-gray-200 rounded-md px-3 py-2 text-sm"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="truncate text-gray-700">{qf.file.name}</span>
                          <span className="text-gray-400 text-xs flex-shrink-0">
                            ({(qf.file.size / 1024).toFixed(0)} KB)
                          </span>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-gray-400 hover:text-red-500 flex-shrink-0"
                          onClick={() => removeFile(qf.id)}
                        >
                          <XIcon className="h-3 w-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}

                <p className="text-xs text-gray-400">
                  Accepted: PDF, JPG, PNG, DOC, DOCX. Max recommended: 10 MB per file.
                </p>
              </CardContent>
            </Card>
          )}

          {/* Submit */}
          <div className="flex gap-3">
            <Link href="/dashboard/human-resources/leave" className="flex-1">
              <Button type="button" variant="outline" className="w-full" disabled={submitting}>
                Cancel
              </Button>
            </Link>
            <Button
              type="submit"
              className="flex-1"
              disabled={!isFormValid || submitting}
            >
              {submitting ? "Submitting..." : "Submit Application"}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
