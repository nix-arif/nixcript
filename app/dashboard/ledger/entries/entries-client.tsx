"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  type LedgerEntryListRow,
  postLedgerEntry,
  voidLedgerEntry,
} from "@/server/ledger";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  PlusIcon,
  SearchIcon,
  BookOpenIcon,
  CheckCircle2Icon,
  XCircleIcon,
  EyeIcon,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────

type Props = {
  entries: LedgerEntryListRow[];
  permissions: string[];
  initialSearch?: string;
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

const fmtDate = (d: string | null | undefined) =>
  d
    ? new Date(d).toLocaleDateString("en-MY", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "—";

const fmtMoney = (v: string | null | undefined) =>
  v
    ? parseFloat(v).toLocaleString("en-MY", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    : "0.00";

function StatusBadge({ status }: { status: string }) {
  if (status === "POSTED") {
    return (
      <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border-0 text-xs">
        Posted
      </Badge>
    );
  }
  if (status === "VOID") {
    return (
      <Badge variant="destructive" className="text-xs">
        Void
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-xs">
      Draft
    </Badge>
  );
}

// ── Component ──────────────────────────────────────────────────────────────

export function LedgerEntriesClient({ entries, permissions, initialSearch }: Props) {
  const router = useRouter();
  const canCreate = permissions.includes("*") || permissions.includes("account:create");
  const canUpdate = permissions.includes("*") || permissions.includes("account:update");

  const [search, setSearch] = useState(initialSearch ?? "");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [typeFilter, setTypeFilter] = useState("ALL");

  // Void dialog
  const [voidDialogOpen, setVoidDialogOpen] = useState(false);
  const [voidingId, setVoidingId] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [voidLoading, setVoidLoading] = useState(false);

  // Post loading
  const [postingId, setPostingId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    return entries.filter((e) => {
      const matchSearch =
        !search ||
        e.entryNo.toLowerCase().includes(search.toLowerCase()) ||
        e.description.toLowerCase().includes(search.toLowerCase()) ||
        (e.stakeholderName ?? "").toLowerCase().includes(search.toLowerCase());
      const matchStatus = statusFilter === "ALL" || e.status === statusFilter;
      const matchType = typeFilter === "ALL" || e.transactionType === typeFilter;
      return matchSearch && matchStatus && matchType;
    });
  }, [entries, search, statusFilter, typeFilter]);

  async function handlePost(id: string) {
    setPostingId(id);
    try {
      await postLedgerEntry(id);
      toast.success("Entry posted successfully");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to post entry");
    } finally {
      setPostingId(null);
    }
  }

  async function handleVoidSubmit() {
    if (!voidingId || !voidReason.trim()) {
      toast.error("Please provide a void reason");
      return;
    }
    setVoidLoading(true);
    try {
      await voidLedgerEntry(voidingId, voidReason.trim());
      toast.success("Entry voided");
      setVoidDialogOpen(false);
      setVoidingId(null);
      setVoidReason("");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to void entry");
    } finally {
      setVoidLoading(false);
    }
  }

  const uniqueTypes = [...new Set(entries.map((e) => e.transactionType))];

  return (
    <div className="p-6 flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <BookOpenIcon className="h-5 w-5 text-muted-foreground" />
            Journal Entries
          </h1>
          <p className="text-sm text-muted-foreground">
            View and manage all general ledger journal entries.
          </p>
        </div>
        {canCreate && (
          <Button size="sm" onClick={() => router.push("/dashboard/ledger/entries/new")}>
            <PlusIcon className="h-4 w-4 mr-1" />
            New Entry
          </Button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <SearchIcon className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search entries..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-9 w-[130px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Statuses</SelectItem>
            <SelectItem value="DRAFT">Draft</SelectItem>
            <SelectItem value="POSTED">Posted</SelectItem>
            <SelectItem value="VOID">Void</SelectItem>
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="h-9 w-[180px]">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Types</SelectItem>
            {uniqueTypes.map((t) => (
              <SelectItem key={t} value={t}>
                {TRANSACTION_TYPE_LABELS[t] ?? t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40">
              <TableHead className="w-[130px]">Entry No</TableHead>
              <TableHead className="w-[100px]">Date</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Stakeholder</TableHead>
              <TableHead>Reference</TableHead>
              <TableHead className="text-right">Total (MYR)</TableHead>
              <TableHead className="text-center w-[60px]">Lines</TableHead>
              <TableHead className="text-center w-[60px]">Docs</TableHead>
              <TableHead className="w-[90px]">Status</TableHead>
              <TableHead className="w-[140px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={11} className="text-center text-muted-foreground py-10">
                  No journal entries found.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((entry) => (
                <TableRow
                  key={entry.id}
                  className="cursor-pointer hover:bg-muted/30"
                  onClick={() => router.push(`/dashboard/ledger/entries/${entry.id}`)}
                >
                  <TableCell className="font-mono text-xs font-medium">
                    {entry.entryNo}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {fmtDate(entry.date)}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs font-normal">
                      {TRANSACTION_TYPE_LABELS[entry.transactionType] ?? entry.transactionType}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-[200px] truncate text-sm">
                    {entry.description}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {entry.stakeholderName ?? "—"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground font-mono text-xs">
                    {entry.referenceNo ?? "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {fmtMoney(entry.totalAmount)}
                  </TableCell>
                  <TableCell className="text-center text-sm text-muted-foreground">
                    {entry.lineCount}
                  </TableCell>
                  <TableCell className="text-center text-sm text-muted-foreground">
                    {entry.docCount}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={entry.status} />
                  </TableCell>
                  <TableCell
                    onClick={(e) => e.stopPropagation()}
                    className="flex items-center gap-1"
                  >
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2"
                      onClick={() => router.push(`/dashboard/ledger/entries/${entry.id}`)}
                    >
                      <EyeIcon className="h-3.5 w-3.5" />
                    </Button>
                    {canUpdate && entry.status === "DRAFT" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-green-600 hover:text-green-700"
                        disabled={postingId === entry.id}
                        onClick={() => handlePost(entry.id)}
                      >
                        <CheckCircle2Icon className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    {canUpdate && entry.status !== "VOID" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-destructive hover:text-destructive"
                        onClick={() => {
                          setVoidingId(entry.id);
                          setVoidReason("");
                          setVoidDialogOpen(true);
                        }}
                      >
                        <XCircleIcon className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Void Dialog */}
      <Dialog open={voidDialogOpen} onOpenChange={setVoidDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Void Journal Entry</DialogTitle>
          </DialogHeader>
          <div className="py-2 flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              Please provide a reason for voiding this entry. This action cannot be undone.
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
