"use client";

import { useState, useRef, Fragment } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  createLedgerEntry,
  createLedgerDocumentRecord,
  type CreateLedgerEntryInput,
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
  PlusIcon,
  TrashIcon,
  CheckCircle2Icon,
  AlertCircleIcon,
  UploadIcon,
  FileIcon,
  XIcon,
  ArrowLeftIcon,
  Globe2Icon,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ──────────────────────────────────────────────────────────────────

type RefAccount = {
  id: string;
  code: string;
  name: string;
  type: string;
  normalBalance: string;
};

type RefCustomer = { id: string; name: string; organizationName: string | null };
type RefSupplier = { id: string; name: string };
type RefInvoice = { id: string; invoiceNo: string };
type RefPO = { id: string; prNo: string | null; poNo: string | null };
type RefMember = { id: string; name: string; role: string };

type RefData = {
  accounts: RefAccount[];
  customers: RefCustomer[];
  suppliers: RefSupplier[];
  invoices: RefInvoice[];
  purchaseOrders: RefPO[];
  members: RefMember[];
};

type LineItem = {
  id: string;
  accountId: string;
  debit: string;
  credit: string;
  description: string;
  currency: string;       // "" = MYR-only line
  amountForeign: string;
  exchangeRate: string;
  showFx: boolean;
};

const FOREIGN_CURRENCIES = ["USD", "SGD", "EUR", "GBP", "CNY", "JPY", "AUD", "HKD", "IDR", "THB", "INR"];

type QueuedFile = {
  id: string;
  file: File;
  status: "pending" | "uploading" | "done" | "error";
  key?: string;
};

const TRANSACTION_TYPES = [
  { value: "CAPITAL_INVESTMENT", label: "Capital Investment" },
  { value: "SUPPLIER_PAYMENT", label: "Supplier Payment" },
  { value: "CUSTOMER_PAYMENT", label: "Customer Payment" },
  { value: "REVENUE_RECOGNITION", label: "Revenue Recognition" },
  { value: "PURCHASE", label: "Purchase" },
  { value: "PAYROLL", label: "Payroll" },
  { value: "GENERAL_EXPENSE", label: "General Expense" },
  { value: "JOURNAL_ADJUSTMENT", label: "Journal Adjustment" },
];

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

function newLine(): LineItem {
  return {
    id: Math.random().toString(36).slice(2),
    accountId: "", debit: "", credit: "", description: "",
    currency: "", amountForeign: "", exchangeRate: "", showFx: false,
  };
}

function fmtFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Component ──────────────────────────────────────────────────────────────

export function NewEntryClient({ refData }: { refData: RefData }) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const today = new Date().toISOString().split("T")[0];

  const [date, setDate] = useState(today);
  const [description, setDescription] = useState("");
  const [transactionType, setTransactionType] = useState("");
  const [stakeholderType, setStakeholderType] = useState("NONE");
  const [stakeholderId, setStakeholderId] = useState("");
  const [referenceType, setReferenceType] = useState("NONE");
  const [referenceId, setReferenceId] = useState("");
  const [lines, setLines] = useState<LineItem[]>([newLine(), newLine()]);
  const [queuedFiles, setQueuedFiles] = useState<QueuedFile[]>([]);
  const [saving, setSaving] = useState(false);
  const [accountSearch, setAccountSearch] = useState<Record<string, string>>({});

  // Balance calculations
  const totalDebit = lines.reduce((s, l) => s + parseFloat(l.debit || "0"), 0);
  const totalCredit = lines.reduce((s, l) => s + parseFloat(l.credit || "0"), 0);
  const isBalanced = Math.abs(totalDebit - totalCredit) < 0.001 && totalDebit > 0;

  function updateLine(id: string, field: keyof LineItem, value: string) {
    setLines((prev) =>
      prev.map((l) => {
        if (l.id !== id) return l;
        const updated = { ...l, [field]: value };
        // Auto-zero opposite side when filling one side
        if (field === "debit" && value) updated.credit = "";
        if (field === "credit" && value) updated.debit = "";
        return updated;
      })
    );
  }

  function toggleFx(id: string) {
    setLines((prev) =>
      prev.map((l) => {
        if (l.id !== id) return l;
        if (l.showFx) return { ...l, showFx: false, currency: "", amountForeign: "", exchangeRate: "" };
        return { ...l, showFx: true };
      })
    );
  }

  function applyFxConversion(id: string, side: "debit" | "credit") {
    setLines((prev) =>
      prev.map((l) => {
        if (l.id !== id) return l;
        const amt = parseFloat(l.amountForeign || "0");
        const rate = parseFloat(l.exchangeRate || "0");
        if (!amt || !rate) return l;
        const converted = (amt * rate).toFixed(2);
        return side === "debit"
          ? { ...l, debit: converted, credit: "" }
          : { ...l, credit: converted, debit: "" };
      })
    );
  }

  function removeLine(id: string) {
    if (lines.length <= 2) {
      toast.error("Minimum 2 lines required");
      return;
    }
    setLines((prev) => prev.filter((l) => l.id !== id));
  }

  // Stakeholder resolution
  const stakeholderName = (() => {
    if (stakeholderType === "CUSTOMER") {
      const c = refData.customers.find((c) => c.id === stakeholderId);
      return c ? c.organizationName || c.name : "";
    }
    if (stakeholderType === "SUPPLIER") {
      const s = refData.suppliers.find((s) => s.id === stakeholderId);
      return s?.name ?? "";
    }
    if (stakeholderType === "MEMBER") {
      const m = refData.members.find((m) => m.id === stakeholderId);
      return m?.name ?? "";
    }
    return "";
  })();

  // Reference resolution
  const referenceNo = (() => {
    if (referenceType === "INVOICE") {
      return refData.invoices.find((i) => i.id === referenceId)?.invoiceNo ?? "";
    }
    if (referenceType === "PURCHASE_ORDER") {
      const po = refData.purchaseOrders.find((p) => p.id === referenceId);
      return po ? (po.poNo ?? po.prNo ?? "") : "";
    }
    return "";
  })();

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

  function removeQueuedFile(id: string) {
    setQueuedFiles((prev) => prev.filter((f) => f.id !== id));
  }

  async function uploadFile(entryId: string, qf: QueuedFile): Promise<{ key: string; fileName: string; fileSize: number; mimeType: string } | null> {
    try {
      // Get presigned upload URL
      const res = await fetch("/api/ledger/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entryId,
          fileName: qf.file.name,
          mimeType: qf.file.type || "application/octet-stream",
          fileSize: qf.file.size,
        }),
      });
      if (!res.ok) throw new Error("Failed to get upload URL");
      const { uploadUrl, key } = await res.json();

      // Upload to R2
      const uploadRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": qf.file.type || "application/octet-stream" },
        body: qf.file,
      });
      if (!uploadRes.ok) throw new Error("Upload to storage failed");

      return {
        key,
        fileName: qf.file.name,
        fileSize: qf.file.size,
        mimeType: qf.file.type || "application/octet-stream",
      };
    } catch {
      return null;
    }
  }

  async function handleSubmit() {
    if (!date) { toast.error("Date is required"); return; }
    if (!description.trim()) { toast.error("Description is required"); return; }
    if (!transactionType) { toast.error("Transaction type is required"); return; }
    if (!isBalanced) { toast.error("Entry must be balanced (debits = credits)"); return; }

    const validLines = lines.filter((l) => l.accountId && (parseFloat(l.debit || "0") > 0 || parseFloat(l.credit || "0") > 0));
    if (validLines.length < 2) { toast.error("At least 2 lines with amounts required"); return; }

    setSaving(true);
    try {
      const input: CreateLedgerEntryInput = {
        date,
        description: description.trim(),
        transactionType,
        referenceType: referenceType === "NONE" ? undefined : referenceType,
        referenceId: referenceId || undefined,
        referenceNo: referenceNo || undefined,
        stakeholderType: stakeholderType === "NONE" ? undefined : stakeholderType,
        stakeholderId: stakeholderId || undefined,
        stakeholderName: stakeholderName || undefined,
        lines: validLines.map((l) => ({
          accountId: l.accountId,
          debit: l.debit || "0",
          credit: l.credit || "0",
          description: l.description || undefined,
          currency: l.currency || undefined,
          amountForeign: l.amountForeign || undefined,
          exchangeRate: l.exchangeRate || undefined,
        })),
      };

      const entryId = await createLedgerEntry(input);

      // Upload queued files
      if (queuedFiles.length > 0) {
        setQueuedFiles((prev) => prev.map((f) => ({ ...f, status: "uploading" })));
        for (const qf of queuedFiles) {
          const result = await uploadFile(entryId, qf);
          if (result) {
            await createLedgerDocumentRecord({
              entryId,
              fileName: result.fileName,
              fileKey: result.key,
              fileSize: result.fileSize,
              mimeType: result.mimeType,
            });
            setQueuedFiles((prev) =>
              prev.map((f) => f.id === qf.id ? { ...f, status: "done", key: result.key } : f)
            );
          } else {
            setQueuedFiles((prev) =>
              prev.map((f) => f.id === qf.id ? { ...f, status: "error" } : f)
            );
          }
        }
      }

      toast.success("Journal entry created");
      router.push(`/dashboard/ledger/entries/${entryId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create entry");
    } finally {
      setSaving(false);
    }
  }

  // Filtered accounts for each line
  function getFilteredAccounts(lineId: string): RefAccount[] {
    const search = (accountSearch[lineId] ?? "").toLowerCase();
    if (!search) return refData.accounts;
    return refData.accounts.filter(
      (a) =>
        a.code.toLowerCase().includes(search) ||
        a.name.toLowerCase().includes(search)
    );
  }

  return (
    <div className="p-6 flex flex-col gap-6 max-w-5xl">
      {/* Header */}
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
          <h1 className="text-xl font-semibold">New Journal Entry</h1>
          <p className="text-sm text-muted-foreground">Create a new general ledger journal entry.</p>
        </div>
      </div>

      {/* Entry Header Fields */}
      <div className="rounded-lg border border-border p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="date">Date *</Label>
          <Input
            id="date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="transactionType">Transaction Type *</Label>
          <Select value={transactionType} onValueChange={setTransactionType}>
            <SelectTrigger id="transactionType">
              <SelectValue placeholder="Select type..." />
            </SelectTrigger>
            <SelectContent>
              {TRANSACTION_TYPES.map((t) => (
                <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5 md:col-span-2">
          <Label htmlFor="description">Description *</Label>
          <Input
            id="description"
            placeholder="Entry description..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        {/* Stakeholder */}
        <div className="flex flex-col gap-1.5">
          <Label>Stakeholder Type</Label>
          <Select value={stakeholderType} onValueChange={(v) => { setStakeholderType(v); setStakeholderId(""); }}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STAKEHOLDER_TYPES.map((t) => (
                <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {stakeholderType !== "NONE" && (
          <div className="flex flex-col gap-1.5">
            <Label>Stakeholder</Label>
            {stakeholderType === "CUSTOMER" && (
              <Select value={stakeholderId} onValueChange={setStakeholderId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select customer..." />
                </SelectTrigger>
                <SelectContent>
                  {refData.customers.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.organizationName || c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {stakeholderType === "SUPPLIER" && (
              <Select value={stakeholderId} onValueChange={setStakeholderId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select supplier..." />
                </SelectTrigger>
                <SelectContent>
                  {refData.suppliers.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {stakeholderType === "MEMBER" && (
              <Select value={stakeholderId} onValueChange={setStakeholderId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select member..." />
                </SelectTrigger>
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

        {/* Reference */}
        <div className="flex flex-col gap-1.5">
          <Label>Reference Type</Label>
          <Select value={referenceType} onValueChange={(v) => { setReferenceType(v); setReferenceId(""); }}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {REFERENCE_TYPES.map((t) => (
                <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {referenceType !== "NONE" && (
          <div className="flex flex-col gap-1.5">
            <Label>Reference</Label>
            {referenceType === "INVOICE" && (
              <Select value={referenceId} onValueChange={setReferenceId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select invoice..." />
                </SelectTrigger>
                <SelectContent>
                  {refData.invoices.map((inv) => (
                    <SelectItem key={inv.id} value={inv.id}>{inv.invoiceNo}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {referenceType === "PURCHASE_ORDER" && (
              <Select value={referenceId} onValueChange={setReferenceId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select PO..." />
                </SelectTrigger>
                <SelectContent>
                  {refData.purchaseOrders.map((po) => (
                    <SelectItem key={po.id} value={po.id}>{po.poNo ?? po.prNo ?? po.id}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {referenceType === "PAYROLL_PERIOD" && (
              <Input
                placeholder="Payroll period reference..."
                value={referenceId}
                onChange={(e) => setReferenceId(e.target.value)}
              />
            )}
          </div>
        )}
      </div>

      {/* Lines Section */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="font-medium text-sm">Journal Lines</h2>
          <div className={cn(
            "flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full",
            isBalanced
              ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
              : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
          )}>
            {isBalanced ? (
              <CheckCircle2Icon className="h-3.5 w-3.5" />
            ) : (
              <AlertCircleIcon className="h-3.5 w-3.5" />
            )}
            {isBalanced
              ? "Balanced"
              : `Diff: ${Math.abs(totalDebit - totalCredit).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          </div>
        </div>

        <div className="rounded-lg border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40">
                <TableHead>Account</TableHead>
                <TableHead className="w-[140px] text-right">Debit</TableHead>
                <TableHead className="w-[140px] text-right">Credit</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="w-[40px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((line) => (
                <Fragment key={line.id}>
                <TableRow>
                  <TableCell className="p-1.5">
                    <div className="flex flex-col gap-1">
                      <Input
                        placeholder="Search account..."
                        value={accountSearch[line.id] ?? ""}
                        onChange={(e) =>
                          setAccountSearch((prev) => ({ ...prev, [line.id]: e.target.value }))
                        }
                        className="h-7 text-xs mb-1"
                      />
                      <Select
                        value={line.accountId}
                        onValueChange={(v) => {
                          updateLine(line.id, "accountId", v);
                          setAccountSearch((prev) => ({ ...prev, [line.id]: "" }));
                        }}
                      >
                        <SelectTrigger className="h-7 text-xs">
                          <SelectValue placeholder="Select account..." />
                        </SelectTrigger>
                        <SelectContent>
                          {getFilteredAccounts(line.id).map((a) => (
                            <SelectItem key={a.id} value={a.id} className="text-xs">
                              {a.code} — {a.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </TableCell>
                  <TableCell className="p-1.5">
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="0.00"
                      value={line.debit}
                      onChange={(e) => updateLine(line.id, "debit", e.target.value)}
                      className="h-7 text-xs text-right"
                    />
                  </TableCell>
                  <TableCell className="p-1.5">
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="0.00"
                      value={line.credit}
                      onChange={(e) => updateLine(line.id, "credit", e.target.value)}
                      className="h-7 text-xs text-right"
                    />
                  </TableCell>
                  <TableCell className="p-1.5">
                    <div className="flex items-center gap-1">
                      <Input
                        placeholder="Optional note..."
                        value={line.description}
                        onChange={(e) => updateLine(line.id, "description", e.target.value)}
                        className="h-7 text-xs"
                      />
                      <Button
                        type="button"
                        variant={line.showFx ? "secondary" : "ghost"}
                        size="sm"
                        className="h-7 w-7 p-0 shrink-0"
                        title="Record foreign currency amount"
                        onClick={() => toggleFx(line.id)}
                      >
                        <Globe2Icon className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                  <TableCell className="p-1.5">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                      onClick={() => removeLine(line.id)}
                    >
                      <TrashIcon className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
                {line.showFx && (
                  <TableRow className="bg-blue-50/50 dark:bg-blue-950/20">
                    <TableCell colSpan={5} className="p-2">
                      <div className="flex flex-wrap items-end gap-2">
                        <div className="flex flex-col gap-1">
                          <Label className="text-xs text-muted-foreground">Currency</Label>
                          <Select
                            value={line.currency}
                            onValueChange={(v) => updateLine(line.id, "currency", v)}
                          >
                            <SelectTrigger className="h-7 text-xs w-[90px]">
                              <SelectValue placeholder="Currency" />
                            </SelectTrigger>
                            <SelectContent>
                              {FOREIGN_CURRENCIES.map((c) => (
                                <SelectItem key={c} value={c} className="text-xs">{c}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="flex flex-col gap-1">
                          <Label className="text-xs text-muted-foreground">Foreign Amount</Label>
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            placeholder="0.00"
                            value={line.amountForeign}
                            onChange={(e) => updateLine(line.id, "amountForeign", e.target.value)}
                            className="h-7 text-xs w-[110px]"
                          />
                        </div>
                        <div className="flex flex-col gap-1">
                          <Label className="text-xs text-muted-foreground">Exchange Rate</Label>
                          <Input
                            type="number"
                            step="0.0001"
                            min="0"
                            placeholder="0.0000"
                            value={line.exchangeRate}
                            onChange={(e) => updateLine(line.id, "exchangeRate", e.target.value)}
                            className="h-7 text-xs w-[100px]"
                          />
                        </div>
                        {line.amountForeign && line.exchangeRate && (
                          <>
                            <span className="text-xs text-muted-foreground pb-1.5">
                              ≈ RM {(parseFloat(line.amountForeign) * parseFloat(line.exchangeRate)).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-7 text-xs"
                              onClick={() => applyFxConversion(line.id, "debit")}
                            >
                              Use as Debit
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-7 text-xs"
                              onClick={() => applyFxConversion(line.id, "credit")}
                            >
                              Use as Credit
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )}
                </Fragment>
              ))}
              {/* Totals row */}
              <TableRow className="bg-muted/30 font-medium">
                <TableCell className="text-xs text-right pr-4">Totals</TableCell>
                <TableCell className="text-right text-xs font-mono">
                  {totalDebit.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </TableCell>
                <TableCell className="text-right text-xs font-mono">
                  {totalCredit.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </TableCell>
                <TableCell colSpan={2} />
              </TableRow>
            </TableBody>
          </Table>
        </div>

        <Button
          variant="outline"
          size="sm"
          className="w-fit"
          onClick={() => setLines((prev) => [...prev, newLine()])}
        >
          <PlusIcon className="h-3.5 w-3.5 mr-1" />
          Add Line
        </Button>
      </div>

      {/* Documents Section */}
      <div className="flex flex-col gap-3">
        <h2 className="font-medium text-sm">Supporting Documents</h2>
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
            <span className="text-xs text-muted-foreground">
              Files will be uploaded after the entry is saved.
            </span>
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
                      onClick={() => removeQueuedFile(qf.id)}
                    >
                      <XIcon className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center gap-3 pt-2 border-t border-border">
        <Button
          variant="outline"
          onClick={() => router.push("/dashboard/ledger/entries")}
          disabled={saving}
        >
          Cancel
        </Button>
        <Button
          onClick={handleSubmit}
          disabled={saving || !isBalanced || !transactionType || !description.trim()}
        >
          {saving ? "Saving..." : "Save as Draft"}
        </Button>
      </div>
    </div>
  );
}
