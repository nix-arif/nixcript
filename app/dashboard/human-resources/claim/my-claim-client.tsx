"use client";

import { useState, useRef, useTransition } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ClaimApplicationWithDetails, ClaimTypeRow } from "@/server/claim";
import { cancelClaim, submitClaim, createClaimDocumentRecord } from "@/server/claim";
import {
  PlusIcon,
  FileDownIcon,
  XIcon,
  ReceiptIcon,
  AlertTriangleIcon,
  UploadIcon,
  InfoIcon,
} from "lucide-react";

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtAmount(v: string | number): string {
  return `RM ${parseFloat(String(v)).toFixed(2)}`;
}

function calcAmount(unitType: string, quantity: string, rate: string): string {
  if (unitType === "AMOUNT") return "";
  const q = parseFloat(quantity);
  const r = parseFloat(rate);
  if (isNaN(q) || isNaN(r) || q <= 0 || r <= 0) return "";
  return (q * r).toFixed(2);
}

interface QueuedFile {
  file: File;
  id: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  MILEAGE: "Mileage",
  MEDICAL: "Medical",
  MEAL: "Meal",
  TRANSPORT: "Transport",
  OVERTIME: "Overtime",
  ENTERTAINMENT: "Entertainment",
  OTHER: "Other",
};

const CATEGORY_COLORS: Record<string, string> = {
  MILEAGE: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-700",
  MEDICAL: "bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-700",
  MEAL: "bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-900/20 dark:text-orange-400 dark:border-orange-700",
  TRANSPORT: "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-900/20 dark:text-purple-400 dark:border-purple-700",
  OVERTIME: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-700",
  ENTERTAINMENT: "bg-pink-50 text-pink-700 border-pink-200 dark:bg-pink-900/20 dark:text-pink-400 dark:border-pink-700",
  OTHER: "bg-muted text-muted-foreground border-border",
};

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    PENDING: "bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-100 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-700",
    APPROVED: "bg-green-100 text-green-800 border-green-200 hover:bg-green-100 dark:bg-green-900/30 dark:text-green-400 dark:border-green-700",
    REJECTED: "bg-red-100 text-red-800 border-red-200 hover:bg-red-100 dark:bg-red-900/30 dark:text-red-400 dark:border-red-700",
    CANCELLED: "bg-muted text-muted-foreground border-border hover:bg-muted",
  };
  const labels: Record<string, string> = {
    PENDING: "Pending", APPROVED: "Approved", REJECTED: "Rejected", CANCELLED: "Cancelled",
  };
  return (
    <Badge className={`border text-xs ${map[status] ?? "border-border"}`}>
      {labels[status] ?? status}
    </Badge>
  );
}

// ── Summary Cards ──────────────────────────────────────────────────────────

function SummaryCards({
  applications,
  claimTypes,
}: {
  applications: ClaimApplicationWithDetails[];
  claimTypes: ClaimTypeRow[];
}) {
  const year = new Date().getFullYear();
  const thisYear = applications.filter(
    (a) => new Date(a.createdAt).getFullYear() === year,
  );

  const byType: Record<string, { type: ClaimTypeRow; approved: number; pending: number }> = {};
  for (const ct of claimTypes) {
    byType[ct.id] = { type: ct, approved: 0, pending: 0 };
  }
  for (const app of thisYear) {
    if (!byType[app.claimTypeId]) continue;
    const amt = parseFloat(app.amount);
    if (app.status === "APPROVED") byType[app.claimTypeId].approved += amt;
    if (app.status === "PENDING") byType[app.claimTypeId].pending += amt;
  }

  const cards = Object.values(byType).filter((e) => e.approved > 0 || e.pending > 0);
  if (cards.length === 0) return null;

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
      {cards.map(({ type, approved, pending }) => {
        const catColor = CATEGORY_COLORS[type.category] ?? CATEGORY_COLORS.OTHER;
        return (
          <div key={type.id} className="rounded-lg border border-border bg-card p-4 flex flex-col gap-2">
            <div className="flex items-center gap-1.5 flex-wrap">
              <Badge variant="outline" className="font-mono text-xs px-1.5 py-0 h-5">
                {type.code}
              </Badge>
              <Badge variant="outline" className={`text-xs px-1.5 py-0 h-5 ${catColor}`}>
                {CATEGORY_LABELS[type.category] ?? type.category}
              </Badge>
            </div>
            <p className="text-sm font-semibold leading-snug">{type.name}</p>
            <div className="text-2xl font-bold leading-none text-green-700 dark:text-green-400">
              {fmtAmount(approved)}
              <span className="text-xs font-normal text-muted-foreground ml-1">approved</span>
            </div>
            {pending > 0 && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                + {fmtAmount(pending)} pending
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────

interface Props {
  applications: ClaimApplicationWithDetails[];
  claimTypes: ClaimTypeRow[];
  permissions: string[];
}

export function MyClaimClient({ applications, claimTypes, permissions }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Cancel state ──────────────────────────────────────────────────────────
  const [cancelTarget, setCancelTarget] = useState<ClaimApplicationWithDetails | null>(null);
  const [cancelling, setCancelling] = useState(false);

  // ── Submit Claim sheet state ──────────────────────────────────────────────
  const [submitOpen, setSubmitOpen] = useState(false);
  const [selectedTypeId, setSelectedTypeId] = useState("");
  const [claimDate, setClaimDate] = useState("");
  const [description, setDescription] = useState("");
  const [quantity, setQuantity] = useState("");
  const [amount, setAmount] = useState("");
  const [queuedFiles, setQueuedFiles] = useState<QueuedFile[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const canApply = permissions.includes("claim:apply") || permissions.includes("*");

  // ── Derived claim form state ───────────────────────────────────────────────
  const selectedType = claimTypes.find((t) => t.id === selectedTypeId) ?? null;
  const isKmOrHour = selectedType?.unitType === "KM" || selectedType?.unitType === "HOUR";
  const computedAmount = selectedType && isKmOrHour
    ? calcAmount(selectedType.unitType, quantity, selectedType.ratePerUnit ?? "0")
    : amount;
  const unitLabel = selectedType?.unitType === "KM" ? "km" : selectedType?.unitType === "HOUR" ? "hr" : "";
  const quantityLabel = selectedType?.unitType === "KM" ? "Distance (km)" : "Hours";

  function resetSubmitForm() {
    setSelectedTypeId("");
    setClaimDate("");
    setDescription("");
    setQuantity("");
    setAmount("");
    setQueuedFiles([]);
  }

  function handleTypeChange(id: string) {
    setSelectedTypeId(id);
    setQuantity("");
    setAmount("");
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    const allowed = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
    const MAX = 5 * 1024 * 1024;
    for (const f of files) {
      if (!allowed.includes(f.type)) {
        toast.error(`${f.name}: only JPG, PNG, WebP, PDF allowed`);
        continue;
      }
      if (f.size > MAX) {
        toast.error(`${f.name}: file must be < 5 MB`);
        continue;
      }
      setQueuedFiles((prev) => [...prev, { file: f, id: crypto.randomUUID() }]);
    }
    e.target.value = "";
  }

  // ── Handlers ──────────────────────────────────────────────────────────────

  async function handleCancel() {
    if (!cancelTarget) return;
    setCancelling(true);
    try {
      await cancelClaim(cancelTarget.id);
      toast.success("Claim cancelled");
      setCancelTarget(null);
      startTransition(() => router.refresh());
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to cancel");
    } finally {
      setCancelling(false);
    }
  }

  async function handleSubmitClaim(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedType) { toast.error("Select a claim type"); return; }
    if (!claimDate) { toast.error("Enter the claim date"); return; }
    if (!description.trim()) { toast.error("Enter a description"); return; }
    const finalAmount = isKmOrHour ? computedAmount : amount;
    if (!finalAmount || parseFloat(finalAmount) <= 0) {
      toast.error("Amount must be greater than 0");
      return;
    }
    if (selectedType.requiresReceipt && queuedFiles.length === 0) {
      toast.error("A receipt is required for this claim type");
      return;
    }

    setSubmitting(true);
    try {
      const appId = await submitClaim({
        claimTypeId: selectedType.id,
        claimDate,
        description,
        quantity: isKmOrHour && quantity ? parseFloat(quantity) : undefined,
        amount: finalAmount,
      });

      for (const qf of queuedFiles) {
        const res = await fetch("/api/claim/upload-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            appId,
            fileName: qf.file.name,
            mimeType: qf.file.type,
            fileSize: qf.file.size,
          }),
        });
        if (!res.ok) { toast.error(`Failed to get upload URL for ${qf.file.name}`); continue; }
        const { uploadUrl, key } = await res.json();
        const upload = await fetch(uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": qf.file.type },
          body: qf.file,
        });
        if (!upload.ok) { toast.error(`Failed to upload ${qf.file.name}`); continue; }
        await createClaimDocumentRecord({
          applicationId: appId,
          fileName: qf.file.name,
          fileKey: key,
          fileSize: qf.file.size,
          mimeType: qf.file.type,
        });
      }

      toast.success("Claim submitted successfully");
      setSubmitOpen(false);
      resetSubmitForm();
      startTransition(() => router.refresh());
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to submit claim");
    } finally {
      setSubmitting(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <ReceiptIcon className="h-5 w-5 text-muted-foreground" />
            My Claims
          </h1>
          <p className="text-sm text-muted-foreground">
            View your claim history and submission status.
          </p>
        </div>
        {canApply && (
          <Button size="sm" onClick={() => setSubmitOpen(true)}>
            <PlusIcon className="h-4 w-4 mr-1" />
            New Claim
          </Button>
        )}
      </div>

      {/* Summary Cards */}
      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Claims Summary — {new Date().getFullYear()}
        </h2>
        <SummaryCards applications={applications} claimTypes={claimTypes} />
        {applications.filter((a) => new Date(a.createdAt).getFullYear() === new Date().getFullYear() && (a.status === "APPROVED" || a.status === "PENDING")).length === 0 && (
          <div className="rounded-lg border border-border py-8 text-center text-sm text-muted-foreground">
            No claims submitted this year yet.
          </div>
        )}
      </div>

      {/* History Table */}
      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Claim History
        </h2>
        {applications.length === 0 ? (
          <div className="rounded-lg border border-border py-10 text-center text-sm text-muted-foreground">
            No claims submitted yet.{" "}
            {canApply && (
              <button
                className="text-primary hover:underline"
                onClick={() => setSubmitOpen(true)}
              >
                Submit a claim
              </button>
            )}
          </div>
        ) : (
          <div className="rounded-lg border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="w-32.5">Ref No.</TableHead>
                  <TableHead>Claim Type</TableHead>
                  <TableHead className="w-28">Date</TableHead>
                  <TableHead className="max-w-xs">Description</TableHead>
                  <TableHead className="w-28 text-right">Amount</TableHead>
                  <TableHead className="w-27.5">Status</TableHead>
                  <TableHead className="w-20 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {applications.map((app) => {
                  const ct = claimTypes.find((t) => t.id === app.claimTypeId);
                  const catColor = CATEGORY_COLORS[ct?.category ?? "OTHER"];
                  return (
                    <TableRow key={app.id}>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {app.applicationNo}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-sm font-medium">{app.claimTypeName}</span>
                          {ct && (
                            <Badge variant="outline" className={`text-xs px-1.5 py-0 h-5 ${catColor}`}>
                              {CATEGORY_LABELS[ct.category] ?? ct.category}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                        {app.claimDate}
                      </TableCell>
                      <TableCell className="max-w-xs">
                        <p className="text-sm text-muted-foreground truncate" title={app.description}>
                          {app.description}
                        </p>
                      </TableCell>
                      <TableCell className="text-right text-sm font-semibold">
                        {fmtAmount(app.amount)}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={app.status} />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          {app.documents.length > 0 && (
                            <a
                              href={`/api/claim/download/${app.documents[0].fileKey}`}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0"
                                title="Download receipt"
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
                              title="Cancel claim"
                            >
                              <XIcon className="h-3.5 w-3.5" />
                            </Button>
                          )}
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

      {/* Cancel Sheet */}
      <Sheet open={!!cancelTarget} onOpenChange={(open) => !open && setCancelTarget(null)}>
        <SheetContent className="w-full sm:max-w-md max-w-lg! overflow-y-auto px-10">
          <SheetHeader className="mb-5">
            <SheetTitle>Cancel Claim</SheetTitle>
          </SheetHeader>
          <div className="space-y-4">
            <div className="rounded-md bg-destructive/10 border border-destructive/30 p-4 flex items-start gap-3">
              <AlertTriangleIcon className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
              <p className="text-sm text-destructive leading-relaxed">
                Are you sure you want to cancel{" "}
                <strong>
                  {cancelTarget?.claimTypeName} ({cancelTarget?.applicationNo})
                </strong>{" "}
                for <strong>{fmtAmount(cancelTarget?.amount ?? "0")}</strong>? This action cannot be undone.
              </p>
            </div>
            <div className="flex gap-2 pt-2">
              <Button variant="destructive" onClick={handleCancel} disabled={cancelling} className="flex-1">
                {cancelling ? "Cancelling…" : "Yes, Cancel Claim"}
              </Button>
              <Button variant="outline" onClick={() => setCancelTarget(null)} disabled={cancelling}>
                Keep
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Submit Claim Sheet */}
      <Sheet
        open={submitOpen}
        onOpenChange={(open) => {
          if (submitting) return;
          if (!open) resetSubmitForm();
          setSubmitOpen(open);
        }}
      >
        <SheetContent className="w-full sm:max-w-xl max-w-full! overflow-y-auto px-6">
          <SheetHeader className="mb-5">
            <SheetTitle className="flex items-center gap-2">
              <ReceiptIcon className="h-5 w-5 text-muted-foreground" />
              Submit Claim
            </SheetTitle>
          </SheetHeader>

          <form onSubmit={handleSubmitClaim} className="flex flex-col gap-5 pb-6">
            {/* Claim Type */}
            <section className="rounded-lg border border-border overflow-hidden">
              <div className="px-4 py-3 bg-muted/40 border-b border-border">
                <h2 className="text-sm font-semibold">Claim Type</h2>
              </div>
              <div className="p-4 flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="claimType">Type <span className="text-destructive">*</span></Label>
                  <Select value={selectedTypeId} onValueChange={handleTypeChange}>
                    <SelectTrigger id="claimType">
                      <SelectValue placeholder="Select claim type…" />
                    </SelectTrigger>
                    <SelectContent>
                      {claimTypes.map((ct) => (
                        <SelectItem key={ct.id} value={ct.id}>
                          {ct.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {selectedType && (
                  <div className="rounded-md bg-muted/40 border border-border p-3 space-y-2 text-sm">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Badge variant="outline" className="font-mono text-xs px-1.5 py-0 h-5">
                        {selectedType.code}
                      </Badge>
                      <Badge
                        variant="outline"
                        className={`text-xs px-1.5 py-0 h-5 ${CATEGORY_COLORS[selectedType.category] ?? CATEGORY_COLORS.OTHER}`}
                      >
                        {CATEGORY_LABELS[selectedType.category] ?? selectedType.category}
                      </Badge>
                      {selectedType.requiresReceipt && (
                        <Badge variant="outline" className="text-xs px-1.5 py-0 h-5 text-blue-700 border-blue-200 bg-blue-50 dark:text-blue-400 dark:border-blue-700">
                          Receipt required
                        </Badge>
                      )}
                    </div>
                    {selectedType.unitType !== "AMOUNT" && selectedType.ratePerUnit && (
                      <p className="text-muted-foreground">
                        Rate: <span className="font-medium text-foreground">RM {parseFloat(selectedType.ratePerUnit).toFixed(2)}/{unitLabel}</span>
                      </p>
                    )}
                    {selectedType.maxAmountPerClaim && (
                      <p className="text-muted-foreground">
                        Max per claim: <span className="font-medium text-foreground">RM {parseFloat(selectedType.maxAmountPerClaim).toFixed(2)}</span>
                      </p>
                    )}
                    {selectedType.maxAmountPerYear && (
                      <p className="text-muted-foreground">
                        Annual cap: <span className="font-medium text-foreground">RM {parseFloat(selectedType.maxAmountPerYear).toFixed(2)}</span>
                      </p>
                    )}
                    {selectedType.description && (
                      <p className="text-muted-foreground italic">{selectedType.description}</p>
                    )}
                  </div>
                )}
              </div>
            </section>

            {/* Claim Details */}
            <section className="rounded-lg border border-border overflow-hidden">
              <div className="px-4 py-3 bg-muted/40 border-b border-border">
                <h2 className="text-sm font-semibold">Claim Details</h2>
              </div>
              <div className="p-4 flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="claimDate">
                    Claim Date <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="claimDate"
                    type="date"
                    value={claimDate}
                    onChange={(e) => setClaimDate(e.target.value)}
                    max={new Date().toISOString().split("T")[0]}
                    required
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="description">
                    Description / Purpose <span className="text-destructive">*</span>
                  </Label>
                  <Textarea
                    id="description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder={
                      selectedType?.category === "MILEAGE"
                        ? "e.g. Client visit — Office to Hospital Selayang and back"
                        : selectedType?.category === "MEAL"
                        ? "e.g. Team lunch during client meeting, 29 May 2026"
                        : selectedType?.category === "OVERTIME"
                        ? "e.g. System deployment, Saturday 24 May 2026, 3 hours"
                        : "Describe what this claim is for…"
                    }
                    rows={2}
                    required
                  />
                </div>

                {isKmOrHour ? (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="quantity">
                        {quantityLabel} <span className="text-destructive">*</span>
                      </Label>
                      <Input
                        id="quantity"
                        type="number"
                        min="0.1"
                        step="0.1"
                        value={quantity}
                        onChange={(e) => setQuantity(e.target.value)}
                        placeholder={`Enter ${unitLabel}…`}
                        required
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label>Calculated Amount</Label>
                      <div className="h-9 flex items-center rounded-md border border-border bg-muted/40 px-3 text-sm font-semibold text-green-700 dark:text-green-400">
                        {computedAmount ? `RM ${computedAmount}` : "—"}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="amount">
                      Amount (RM) <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="amount"
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="0.00"
                      required
                    />
                  </div>
                )}
              </div>
            </section>

            {/* Receipt / Supporting Documents */}
            <section className="rounded-lg border border-border overflow-hidden">
              <div className="px-4 py-3 bg-muted/40 border-b border-border flex items-center justify-between">
                <h2 className="text-sm font-semibold">
                  Receipt / Supporting Document
                  {selectedType?.requiresReceipt && (
                    <span className="text-destructive ml-1">*</span>
                  )}
                </h2>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <UploadIcon className="h-3.5 w-3.5" />
                  Add File
                </Button>
              </div>
              <div className="p-4">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".jpg,.jpeg,.png,.webp,.pdf"
                  multiple
                  className="hidden"
                  onChange={handleFileSelect}
                />
                {queuedFiles.length === 0 ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                    <InfoIcon className="h-4 w-4 shrink-0" />
                    <span>
                      {selectedType?.requiresReceipt
                        ? "Receipt required — attach JPG, PNG, WebP or PDF (max 5 MB each)."
                        : "No receipt required, but you may attach one for reference."}
                    </span>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {queuedFiles.map((qf) => (
                      <div
                        key={qf.id}
                        className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2"
                      >
                        <div className="flex flex-col gap-0.5 min-w-0">
                          <p className="text-sm font-medium truncate">{qf.file.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {(qf.file.size / 1024).toFixed(0)} KB
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 shrink-0"
                          onClick={() => setQueuedFiles((prev) => prev.filter((f) => f.id !== qf.id))}
                        >
                          <XIcon className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>

            {/* Actions */}
            <div className="flex gap-3 pt-1">
              <Button
                type="submit"
                disabled={submitting || !selectedTypeId}
                className="flex-1 sm:flex-none sm:min-w-40"
              >
                {submitting ? "Submitting…" : "Submit Claim"}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={submitting}
                onClick={() => { resetSubmitForm(); setSubmitOpen(false); }}
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
