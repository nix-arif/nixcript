"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  type LedgerEntryWithDetails,
  postLedgerEntry,
  voidLedgerEntry,
  createLedgerDocumentRecord,
  deleteLedgerDocument,
  updateLedgerEntryMetadata,
} from "@/server/ledger";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ArrowLeftIcon,
  CheckCircle2Icon,
  XCircleIcon,
  DownloadIcon,
  UploadIcon,
  FileIcon,
  XIcon,
  TrashIcon,
  PencilIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ──────────────────────────────────────────────────────────────────

type RefCustomer = { id: string; name: string; organizationName: string | null };
type RefSupplier = { id: string; name: string };
type RefInvoice = { id: string; invoiceNo: string };
type RefPO = { id: string; prNo: string | null; poNo: string | null };
type RefMember = { id: string; name: string; role: string };

type RefData = {
  customers: RefCustomer[];
  suppliers: RefSupplier[];
  invoices: RefInvoice[];
  purchaseOrders: RefPO[];
  members: RefMember[];
};

type Props = {
  entry: LedgerEntryWithDetails;
  refData: RefData;
  permissions: string[];
};

const STAKEHOLDER_TYPES = [
  { value: "NONE", label: "None" },
  { value: "CUSTOMER", label: "Customer" },
  { value: "SUPPLIER", label: "Supplier" },
  { value: "MEMBER", label: "Member" },
];

const REFERENCE_TYPES = [
  { value: "NONE", label: "None" },
  { value: "INVOICE", label: "Invoice" },
  { value: "PURCHASE_ORDER", label: "Purchase Order" },
  { value: "PAYROLL_PERIOD", label: "Payroll Period" },
];

type QueuedFile = {
  id: string;
  file: File;
  status: "pending" | "uploading" | "done" | "error";
  key?: string;
};

// ── Helpers ────────────────────────────────────────────────────────────────

const TRANSACTION_TYPE_LABELS: Record<string, string> = {
  CAPITAL_INVESTMENT: "Capital Investment",
  SUPPLIER_PAYMENT: "Supplier Payment",
  CUSTOMER_PAYMENT: "Customer Payment",
  REVENUE_RECOGNITION: "Revenue Recognition",
  PURCHASE: "Purchase",
  PAYROLL: "Payroll",
  GENERAL_EXPENSE: "General Expense",
  JOURNAL_ADJUSTMENT: "Journal Adjustment",
};

const fmtDate = (d: string | Date | null | undefined) =>
  d
    ? new Date(d).toLocaleDateString("en-MY", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "—";

const fmtDateTime = (d: Date | string | null | undefined) =>
  d
    ? new Date(d).toLocaleString("en-MY", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

const fmtMoney = (v: string | null | undefined) =>
  v
    ? parseFloat(v).toLocaleString("en-MY", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    : "0.00";

function fmtFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function StatusBadge({ status }: { status: string }) {
  if (status === "POSTED") {
    return (
      <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border-0">
        Posted
      </Badge>
    );
  }
  if (status === "VOID") {
    return <Badge variant="destructive">Void</Badge>;
  }
  return <Badge variant="outline">Draft</Badge>;
}

// ── Component ──────────────────────────────────────────────────────────────

export function EntryDetailClient({ entry, refData, permissions }: Props) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canUpdate = permissions.includes("*") || permissions.includes("account:update");
  const canCreate = permissions.includes("*") || permissions.includes("account:create");
  const canDelete = permissions.includes("*") || permissions.includes("account:delete");

  const [voidDialogOpen, setVoidDialogOpen] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const [voidLoading, setVoidLoading] = useState(false);
  const [postLoading, setPostLoading] = useState(false);
  const [queuedFiles, setQueuedFiles] = useState<QueuedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [deletingDocId, setDeletingDocId] = useState<string | null>(null);

  // Edit metadata dialog
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editDescription, setEditDescription] = useState(entry.description);
  const [editStakeholderType, setEditStakeholderType] = useState(entry.stakeholderType);
  const [editStakeholderId, setEditStakeholderId] = useState(entry.stakeholderId ?? "");
  const [editReferenceType, setEditReferenceType] = useState(entry.referenceType);
  const [editReferenceIds, setEditReferenceIds] = useState<string[]>(
    entry.linkedInvoices.length > 0
      ? entry.linkedInvoices.map((i) => i.invoiceId)
      : entry.referenceType === "INVOICE" && entry.referenceId ? [entry.referenceId] : [],
  );
  const [editInvoiceSearch, setEditInvoiceSearch] = useState("");
  const [editPayrollRef, setEditPayrollRef] = useState(
    entry.referenceType === "PAYROLL_PERIOD" ? entry.referenceNo ?? "" : ""
  );
  const [editLoading, setEditLoading] = useState(false);

  function openEditDialog() {
    setEditDescription(entry.description);
    setEditStakeholderType(entry.stakeholderType);
    setEditStakeholderId(entry.stakeholderId ?? "");
    setEditReferenceType(entry.referenceType);
    setEditReferenceIds(
      entry.linkedInvoices.length > 0
        ? entry.linkedInvoices.map((i) => i.invoiceId)
        : entry.referenceType === "INVOICE" && entry.referenceId ? [entry.referenceId] : [],
    );
    setEditInvoiceSearch("");
    setEditPayrollRef(entry.referenceType === "PAYROLL_PERIOD" ? entry.referenceNo ?? "" : "");
    setEditDialogOpen(true);
  }

  const editStakeholderName = (() => {
    if (editStakeholderType === "CUSTOMER") {
      const c = refData.customers.find((c) => c.id === editStakeholderId);
      return c ? c.organizationName || c.name : "";
    }
    if (editStakeholderType === "SUPPLIER") {
      return refData.suppliers.find((s) => s.id === editStakeholderId)?.name ?? "";
    }
    if (editStakeholderType === "MEMBER") {
      return refData.members.find((m) => m.id === editStakeholderId)?.name ?? "";
    }
    return "";
  })();

  const editReferenceNo = (() => {
    if (editReferenceType === "INVOICE") {
      return refData.invoices.find((i) => i.id === editReferenceIds[0])?.invoiceNo ?? "";
    }
    if (editReferenceType === "PURCHASE_ORDER") {
      const po = refData.purchaseOrders.find((p) => p.id === editReferenceIds[0]);
      return po ? (po.poNo ?? po.prNo ?? "") : "";
    }
    if (editReferenceType === "PAYROLL_PERIOD") return editPayrollRef;
    return "";
  })();

  async function handleEditSave() {
    if (!editDescription.trim()) {
      toast.error("Description is required");
      return;
    }
    setEditLoading(true);
    try {
      await updateLedgerEntryMetadata(entry.id, {
        description: editDescription.trim(),
        stakeholderType: editStakeholderType === "NONE" ? undefined : editStakeholderType,
        stakeholderId: editStakeholderId || undefined,
        stakeholderName: editStakeholderName || undefined,
        referenceType: editReferenceType === "NONE" ? undefined : editReferenceType,
        referenceId: editReferenceType === "PAYROLL_PERIOD" ? undefined : (editReferenceIds[0] || undefined),
        referenceNo: editReferenceNo || undefined,
        invoiceIds: editReferenceType === "INVOICE" ? editReferenceIds : undefined,
      });
      toast.success("Entry details updated");
      setEditDialogOpen(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update entry details");
    } finally {
      setEditLoading(false);
    }
  }

  // Line totals
  const totalDebit = entry.lines.reduce((s, l) => s + parseFloat(l.debit || "0"), 0);
  const totalCredit = entry.lines.reduce((s, l) => s + parseFloat(l.credit || "0"), 0);
  const hasFx = entry.lines.some((l) => l.currency);

  async function handlePost() {
    setPostLoading(true);
    try {
      await postLedgerEntry(entry.id);
      toast.success("Entry posted successfully");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to post entry");
    } finally {
      setPostLoading(false);
    }
  }

  async function handleVoidSubmit() {
    if (!voidReason.trim()) {
      toast.error("Please provide a void reason");
      return;
    }
    setVoidLoading(true);
    try {
      await voidLedgerEntry(entry.id, voidReason.trim());
      toast.success("Entry voided");
      setVoidDialogOpen(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to void entry");
    } finally {
      setVoidLoading(false);
    }
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    const newFiles: QueuedFile[] = files.map((f) => ({
      id: Math.random().toString(36).slice(2),
      file: f,
      status: "pending",
    }));
    setQueuedFiles((prev) => [...prev, ...newFiles]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleUploadAll() {
    if (queuedFiles.length === 0) return;
    setUploading(true);
    try {
      for (const qf of queuedFiles.filter((f) => f.status === "pending")) {
        setQueuedFiles((prev) =>
          prev.map((f) => f.id === qf.id ? { ...f, status: "uploading" } : f)
        );
        try {
          const res = await fetch("/api/ledger/upload-url", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              entryId: entry.id,
              fileName: qf.file.name,
              mimeType: qf.file.type || "application/octet-stream",
              fileSize: qf.file.size,
            }),
          });
          if (!res.ok) throw new Error("Failed to get upload URL");
          const { uploadUrl, key } = await res.json();

          const uploadRes = await fetch(uploadUrl, {
            method: "PUT",
            headers: { "Content-Type": qf.file.type || "application/octet-stream" },
            body: qf.file,
          });
          if (!uploadRes.ok) throw new Error("Upload failed");

          await createLedgerDocumentRecord({
            entryId: entry.id,
            fileName: qf.file.name,
            fileKey: key,
            fileSize: qf.file.size,
            mimeType: qf.file.type || "application/octet-stream",
          });
          setQueuedFiles((prev) =>
            prev.map((f) => f.id === qf.id ? { ...f, status: "done", key } : f)
          );
        } catch {
          setQueuedFiles((prev) =>
            prev.map((f) => f.id === qf.id ? { ...f, status: "error" } : f)
          );
        }
      }
      toast.success("Documents uploaded");
      router.refresh();
    } finally {
      setUploading(false);
    }
  }

  async function handleDeleteDoc(docId: string) {
    setDeletingDocId(docId);
    try {
      await deleteLedgerDocument(docId);
      toast.success("Document removed");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete document");
    } finally {
      setDeletingDocId(null);
    }
  }

  return (
    <div className="p-6 flex flex-col gap-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push("/dashboard/ledger/entries")}
            className="h-8 w-8 p-0"
          >
            <ArrowLeftIcon className="h-4 w-4" />
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold font-mono">{entry.entryNo}</h1>
              <StatusBadge status={entry.status} />
            </div>
            <p className="text-sm text-muted-foreground">
              {fmtDate(entry.date)} &middot; {TRANSACTION_TYPE_LABELS[entry.transactionType] ?? entry.transactionType}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {canUpdate && (
            <Button variant="outline" size="sm" onClick={openEditDialog}>
              <PencilIcon className="h-4 w-4 mr-1" />
              Edit Details
            </Button>
          )}
          {canUpdate && entry.status === "DRAFT" && (
            <Button
              size="sm"
              className="bg-green-600 hover:bg-green-700 text-white"
              disabled={postLoading}
              onClick={handlePost}
            >
              <CheckCircle2Icon className="h-4 w-4 mr-1" />
              {postLoading ? "Posting..." : "Post Entry"}
            </Button>
          )}
          {canUpdate && entry.status !== "VOID" && (
            <Button
              variant="outline"
              size="sm"
              className="border-destructive text-destructive hover:bg-destructive/10"
              onClick={() => { setVoidReason(""); setVoidDialogOpen(true); }}
            >
              <XCircleIcon className="h-4 w-4 mr-1" />
              Void
            </Button>
          )}
        </div>
      </div>

      {/* Entry Info Card */}
      <div className="rounded-lg border border-border p-4 grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
        <div className="flex flex-col gap-0.5">
          <span className="text-xs text-muted-foreground uppercase tracking-wide">Description</span>
          <span>{entry.description}</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-xs text-muted-foreground uppercase tracking-wide">Stakeholder</span>
          <span>
            {entry.stakeholderName
              ? `${entry.stakeholderName} (${entry.stakeholderType})`
              : "—"}
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-xs text-muted-foreground uppercase tracking-wide">Reference</span>
          {entry.referenceType === "INVOICE" && (entry.linkedInvoices.length > 0 || entry.referenceNo) ? (
            <div className="flex flex-wrap gap-1 mt-0.5">
              {(entry.linkedInvoices.length > 0
                ? entry.linkedInvoices.map((i) => i.invoiceNo)
                : [entry.referenceNo!]
              ).map((no) => (
                <Badge key={no} variant="secondary" className="text-[10px]">{no}</Badge>
              ))}
            </div>
          ) : (
            <span>
              {entry.referenceNo ? `${entry.referenceNo} (${entry.referenceType})` : "—"}
            </span>
          )}
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-xs text-muted-foreground uppercase tracking-wide">Created By</span>
          <span>{entry.createdByName ?? "—"}</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-xs text-muted-foreground uppercase tracking-wide">Created At</span>
          <span>{fmtDateTime(entry.createdAt)}</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-xs text-muted-foreground uppercase tracking-wide">Posted At</span>
          <span>{entry.postedAt ? fmtDateTime(entry.postedAt) : "—"}</span>
        </div>
        {entry.status === "VOID" && entry.voidReason && (
          <div className="flex flex-col gap-0.5 col-span-2 md:col-span-3">
            <span className="text-xs text-muted-foreground uppercase tracking-wide">Void Reason</span>
            <span className="text-destructive">{entry.voidReason}</span>
          </div>
        )}
      </div>

      {/* Lines Table */}
      <div className="flex flex-col gap-2">
        <h2 className="font-medium text-sm">Journal Lines</h2>
        <div className="rounded-lg border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40">
                <TableHead className="w-[100px]">Code</TableHead>
                <TableHead>Account Name</TableHead>
                <TableHead>Description</TableHead>
                {hasFx && <TableHead>Foreign Amount</TableHead>}
                <TableHead className="text-right w-[140px]">Debit (MYR)</TableHead>
                <TableHead className="text-right w-[140px]">Credit (MYR)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entry.lines.map((line) => (
                <TableRow key={line.id}>
                  <TableCell className="font-mono text-xs">{line.accountCode}</TableCell>
                  <TableCell className="text-sm">{line.accountName}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {line.description ?? "—"}
                  </TableCell>
                  {hasFx && (
                    <TableCell className="text-xs text-muted-foreground">
                      {line.currency && line.amountForeign
                        ? `${line.currency} ${parseFloat(line.amountForeign).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} @ ${line.exchangeRate ?? "—"}`
                        : "—"}
                    </TableCell>
                  )}
                  <TableCell className="text-right font-mono text-sm">
                    {parseFloat(line.debit || "0") > 0 ? fmtMoney(line.debit) : "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {parseFloat(line.credit || "0") > 0 ? fmtMoney(line.credit) : "—"}
                  </TableCell>
                </TableRow>
              ))}
              {/* Totals */}
              <TableRow className="bg-muted/30 font-semibold">
                <TableCell colSpan={hasFx ? 4 : 3} className="text-right text-sm pr-4">
                  Totals
                </TableCell>
                <TableCell className="text-right font-mono text-sm">
                  {fmtMoney(totalDebit.toFixed(2))}
                </TableCell>
                <TableCell className="text-right font-mono text-sm">
                  {fmtMoney(totalCredit.toFixed(2))}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Documents Section */}
      <div className="flex flex-col gap-3">
        <h2 className="font-medium text-sm">Supporting Documents</h2>

        {/* Existing documents */}
        {entry.documents.length > 0 ? (
          <div className="rounded-lg border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead>File Name</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Uploaded</TableHead>
                  <TableHead className="w-[100px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entry.documents.map((doc) => (
                  <TableRow key={doc.id}>
                    <TableCell className="flex items-center gap-2 text-sm">
                      <FileIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                      {doc.fileName}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {fmtFileSize(doc.fileSize)}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {fmtDateTime(doc.uploadedAt)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2"
                          onClick={() =>
                            window.open(`/api/ledger/download/${doc.fileKey}`, "_blank")
                          }
                        >
                          <DownloadIcon className="h-3.5 w-3.5" />
                        </Button>
                        {canDelete && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-destructive hover:text-destructive"
                            disabled={deletingDocId === doc.id}
                            onClick={() => handleDeleteDoc(doc.id)}
                          >
                            <TrashIcon className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No documents attached.</p>
        )}

        {/* Upload new documents */}
        {canCreate && (
          <div className="rounded-lg border border-dashed border-border p-4 flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                type="button"
              >
                <UploadIcon className="h-3.5 w-3.5 mr-1" />
                Attach Files
              </Button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={handleFileSelect}
            />
            {queuedFiles.length > 0 && (
              <div className="flex flex-col gap-1.5">
                {queuedFiles.map((qf) => (
                  <div
                    key={qf.id}
                    className="flex items-center gap-2 text-sm p-2 rounded-md bg-muted/40"
                  >
                    <FileIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="flex-1 truncate text-xs">{qf.file.name}</span>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {fmtFileSize(qf.file.size)}
                    </span>
                    {qf.status === "uploading" && (
                      <span className="text-xs text-blue-500 shrink-0">Uploading...</span>
                    )}
                    {qf.status === "done" && (
                      <CheckCircle2Icon className="h-3.5 w-3.5 text-green-500 shrink-0" />
                    )}
                    {qf.status === "error" && (
                      <span className="text-xs text-destructive shrink-0">Failed</span>
                    )}
                    {qf.status === "pending" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0"
                        onClick={() => setQueuedFiles((prev) => prev.filter((f) => f.id !== qf.id))}
                      >
                        <XIcon className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                ))}
                <Button
                  size="sm"
                  className="w-fit mt-1"
                  onClick={handleUploadAll}
                  disabled={uploading || queuedFiles.every((f) => f.status !== "pending")}
                >
                  {uploading ? "Uploading..." : "Upload All"}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Edit Details Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Edit Entry Details</DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto py-2 flex flex-col gap-5 pr-1">
            <p className="text-xs text-muted-foreground">
              Only descriptive details can be changed here — journal lines, amounts, and status are never touched.
            </p>

            {/* Description */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="editDescription">Description</Label>
              <Input
                id="editDescription"
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
              />
            </div>

            {/* Stakeholder */}
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label>Stakeholder Type</Label>
                <Select
                  value={editStakeholderType}
                  onValueChange={(v) => { setEditStakeholderType(v); setEditStakeholderId(""); }}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STAKEHOLDER_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {editStakeholderType !== "NONE" && (
                <div className="flex flex-col gap-1.5">
                  <Label>Stakeholder</Label>
                  {editStakeholderType === "CUSTOMER" && (
                    <Select value={editStakeholderId} onValueChange={setEditStakeholderId}>
                      <SelectTrigger><SelectValue placeholder="Select customer..." /></SelectTrigger>
                      <SelectContent>
                        {refData.customers.map((c) => (
                          <SelectItem key={c.id} value={c.id}>{c.organizationName || c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  {editStakeholderType === "SUPPLIER" && (
                    <Select value={editStakeholderId} onValueChange={setEditStakeholderId}>
                      <SelectTrigger><SelectValue placeholder="Select supplier..." /></SelectTrigger>
                      <SelectContent>
                        {refData.suppliers.map((s) => (
                          <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  {editStakeholderType === "MEMBER" && (
                    <Select value={editStakeholderId} onValueChange={setEditStakeholderId}>
                      <SelectTrigger><SelectValue placeholder="Select member..." /></SelectTrigger>
                      <SelectContent>
                        {refData.members.map((m) => (
                          <SelectItem key={m.id} value={m.id}>
                            {m.name}{m.role === "owner" ? " (Owner)" : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              )}
            </div>

            {/* Reference */}
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label>Reference Type</Label>
                <Select
                  value={editReferenceType}
                  onValueChange={(v) => { setEditReferenceType(v); setEditReferenceIds([]); setEditInvoiceSearch(""); setEditPayrollRef(""); }}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {REFERENCE_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {editReferenceType !== "NONE" && (
                <div className="flex flex-col gap-1.5">
                  <Label>Reference</Label>
                  {editReferenceType === "INVOICE" && (
                    <div className="border border-border rounded-md p-2 flex flex-col gap-2">
                      <Input
                        placeholder="Search invoices..."
                        value={editInvoiceSearch}
                        onChange={(e) => setEditInvoiceSearch(e.target.value)}
                        className="h-7 text-xs"
                      />
                      {editReferenceIds.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {editReferenceIds.map((id) => {
                            const inv = refData.invoices.find((i) => i.id === id);
                            return (
                              <Badge key={id} variant="secondary" className="text-[10px] gap-1 pr-1">
                                {inv?.invoiceNo ?? id}
                                <button
                                  type="button"
                                  className="hover:text-destructive"
                                  onClick={() => setEditReferenceIds((prev) => prev.filter((x) => x !== id))}
                                >
                                  <XIcon className="w-2.5 h-2.5" />
                                </button>
                              </Badge>
                            );
                          })}
                        </div>
                      )}
                      <div className="max-h-44 overflow-y-auto flex flex-col gap-0.5">
                        {refData.invoices
                          .filter((inv) =>
                            !editInvoiceSearch || inv.invoiceNo.toLowerCase().includes(editInvoiceSearch.toLowerCase())
                          )
                          .map((inv) => (
                            <label
                              key={inv.id}
                              className="flex items-center gap-2 px-1 py-1 rounded hover:bg-muted cursor-pointer text-xs"
                            >
                              <Checkbox
                                checked={editReferenceIds.includes(inv.id)}
                                onCheckedChange={(checked) =>
                                  setEditReferenceIds((prev) =>
                                    checked ? [...prev, inv.id] : prev.filter((x) => x !== inv.id)
                                  )
                                }
                              />
                              {inv.invoiceNo}
                            </label>
                          ))}
                      </div>
                    </div>
                  )}
                  {editReferenceType === "PURCHASE_ORDER" && (
                    <Select value={editReferenceIds[0] ?? ""} onValueChange={(v) => setEditReferenceIds([v])}>
                      <SelectTrigger><SelectValue placeholder="Select PO..." /></SelectTrigger>
                      <SelectContent>
                        {refData.purchaseOrders.map((po) => (
                          <SelectItem key={po.id} value={po.id}>{po.poNo ?? po.prNo ?? po.id}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  {editReferenceType === "PAYROLL_PERIOD" && (
                    <Input
                      placeholder="Payroll period reference..."
                      value={editPayrollRef}
                      onChange={(e) => setEditPayrollRef(e.target.value)}
                    />
                  )}
                </div>
              )}
            </div>

            {/* Attach Documents */}
            {canCreate && (
              <div className="flex flex-col gap-3 border-t border-border pt-4">
                <div className="flex items-center justify-between">
                  <Label>Attach Documents</Label>
                  <Button
                    variant="outline"
                    size="sm"
                    type="button"
                    className="h-7 text-xs gap-1.5"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <UploadIcon className="h-3 w-3" />
                    Add Files
                  </Button>
                </div>
                {queuedFiles.length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    {queuedFiles.map((qf) => (
                      <div key={qf.id} className="flex items-center gap-2 text-xs p-2 rounded-md bg-muted/40">
                        <FileIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="flex-1 truncate">{qf.file.name}</span>
                        <span className="text-muted-foreground shrink-0">{fmtFileSize(qf.file.size)}</span>
                        {qf.status === "uploading" && <span className="text-blue-500 shrink-0">Uploading...</span>}
                        {qf.status === "done" && <CheckCircle2Icon className="h-3.5 w-3.5 text-green-500 shrink-0" />}
                        {qf.status === "error" && <span className="text-destructive shrink-0">Failed</span>}
                        {qf.status === "pending" && (
                          <button
                            type="button"
                            className="text-muted-foreground hover:text-destructive"
                            onClick={() => setQueuedFiles((prev) => prev.filter((f) => f.id !== qf.id))}
                          >
                            <XIcon className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <DialogFooter className="pt-3 border-t border-border">
            <Button variant="outline" onClick={() => setEditDialogOpen(false)} disabled={editLoading || uploading}>
              Cancel
            </Button>
            {queuedFiles.some((f) => f.status === "pending") && (
              <Button
                variant="outline"
                onClick={handleUploadAll}
                disabled={uploading}
              >
                {uploading ? "Uploading..." : `Upload ${queuedFiles.filter((f) => f.status === "pending").length} file(s)`}
              </Button>
            )}
            <Button onClick={handleEditSave} disabled={editLoading || !editDescription.trim()}>
              {editLoading ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Void Dialog */}
      <Dialog open={voidDialogOpen} onOpenChange={setVoidDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Void Journal Entry</DialogTitle>
          </DialogHeader>
          <div className="py-2 flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              Please provide a reason for voiding entry <span className="font-mono font-medium">{entry.entryNo}</span>. This action cannot be undone.
            </p>
            <Input
              placeholder="Void reason..."
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setVoidDialogOpen(false)}
              disabled={voidLoading}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleVoidSubmit}
              disabled={voidLoading || !voidReason.trim()}
            >
              {voidLoading ? "Voiding..." : "Void Entry"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
