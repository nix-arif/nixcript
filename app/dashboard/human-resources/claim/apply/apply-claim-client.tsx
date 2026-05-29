"use client";

import { useState, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ClaimTypeRow } from "@/server/claim";
import { submitClaim, createClaimDocumentRecord } from "@/server/claim";
import { ArrowLeftIcon, UploadIcon, XIcon, ReceiptIcon, InfoIcon } from "lucide-react";

// ── Constants ──────────────────────────────────────────────────────────────

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

// ── Types ──────────────────────────────────────────────────────────────────

interface QueuedFile {
  file: File;
  id: string;
}

interface Props {
  claimTypes: ClaimTypeRow[];
}

// ── Helpers ────────────────────────────────────────────────────────────────

function calcAmount(unitType: string, quantity: string, rate: string): string {
  if (unitType === "AMOUNT") return "";
  const q = parseFloat(quantity);
  const r = parseFloat(rate);
  if (isNaN(q) || isNaN(r) || q <= 0 || r <= 0) return "";
  return (q * r).toFixed(2);
}

// ── Component ──────────────────────────────────────────────────────────────

export function ApplyClaimClient({ claimTypes }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [selectedTypeId, setSelectedTypeId] = useState<string>("");
  const [claimDate, setClaimDate] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [quantity, setQuantity] = useState<string>("");   // km or hours
  const [amount, setAmount] = useState<string>("");
  const [queuedFiles, setQueuedFiles] = useState<QueuedFile[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const selectedType = claimTypes.find((t) => t.id === selectedTypeId) ?? null;
  const isKmOrHour = selectedType?.unitType === "KM" || selectedType?.unitType === "HOUR";

  // Auto-calculate amount when quantity/rate changes
  const computedAmount = selectedType && isKmOrHour
    ? calcAmount(selectedType.unitType, quantity, selectedType.ratePerUnit ?? "0")
    : amount;

  const unitLabel = selectedType?.unitType === "KM" ? "km" : selectedType?.unitType === "HOUR" ? "hr" : "";
  const quantityLabel = selectedType?.unitType === "KM" ? "Distance (km)" : "Hours";

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

  async function uploadFile(appId: string, qf: QueuedFile): Promise<void> {
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
    if (!res.ok) throw new Error("Failed to get upload URL");
    const { uploadUrl, key } = await res.json();
    const upload = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": qf.file.type },
      body: qf.file,
    });
    if (!upload.ok) throw new Error("Upload failed");
    await createClaimDocumentRecord({
      applicationId: appId,
      fileName: qf.file.name,
      fileKey: key,
      fileSize: qf.file.size,
      mimeType: qf.file.type,
    });
  }

  async function handleSubmit(e: React.FormEvent) {
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

      // Upload receipts
      for (const qf of queuedFiles) {
        await uploadFile(appId, qf);
      }

      toast.success("Claim submitted successfully");
      startTransition(() => {
        router.push("/dashboard/human-resources/claim");
        router.refresh();
      });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to submit claim");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="p-6 flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/dashboard/human-resources/claim">
          <Button variant="ghost" size="sm" className="gap-1.5">
            <ArrowLeftIcon className="h-4 w-4" />
            Back
          </Button>
        </Link>
        <div className="flex flex-col gap-0.5">
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <ReceiptIcon className="h-5 w-5 text-muted-foreground" />
            Submit Claim
          </h1>
          <p className="text-sm text-muted-foreground">
            Fill in the form below to submit a new expense claim.
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="max-w-2xl flex flex-col gap-5">
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

            {/* Selected type info panel */}
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
            {/* Date */}
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

            {/* Description */}
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

            {/* Quantity (KM / HOUR) or Amount */}
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
                      onClick={() =>
                        setQueuedFiles((prev) => prev.filter((f) => f.id !== qf.id))
                      }
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
        <div className="flex gap-3">
          <Button type="submit" disabled={submitting || !selectedTypeId} className="flex-1 sm:flex-none sm:min-w-40">
            {submitting ? "Submitting…" : "Submit Claim"}
          </Button>
          <Link href="/dashboard/human-resources/claim">
            <Button type="button" variant="outline" disabled={submitting}>
              Cancel
            </Button>
          </Link>
        </div>
      </form>
    </div>
  );
}
