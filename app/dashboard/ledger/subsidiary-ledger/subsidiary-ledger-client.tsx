"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  type LedgerAccountRow,
  type SubsidiaryLedgerRow,
  type SubsidiaryStakeholderType,
  getSubsidiaryLedger,
} from "@/server/ledger";
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
import { Badge } from "@/components/ui/badge";
import { BookUserIcon } from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────

type Props = {
  accounts: LedgerAccountRow[];
  permissions: string[];
};

// ── Helpers ────────────────────────────────────────────────────────────────

const STAKEHOLDER_OPTIONS: { value: SubsidiaryStakeholderType; label: string; description: string }[] = [
  {
    value: "CUSTOMER",
    label: "Accounts Receivable (Debtors)",
    description: "Who owes the business money, broken down by customer.",
  },
  {
    value: "SUPPLIER",
    label: "Accounts Payable (Creditors)",
    description: "Who the business owes money to, broken down by supplier.",
  },
  {
    value: "MEMBER",
    label: "Member Sub-Ledger",
    description: "Advances, drawings, or dues owed by or to each member (owners included).",
  },
];

const fmtMYR = (n: number) =>
  new Intl.NumberFormat("en-MY", {
    style: "currency",
    currency: "MYR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);

// ── Component ──────────────────────────────────────────────────────────────

export function SubsidiaryLedgerClient({ accounts }: Props) {
  const [stakeholderType, setStakeholderType] = useState<SubsidiaryStakeholderType>("CUSTOMER");
  const [accountId, setAccountId] = useState("");
  const [balances, setBalances] = useState<SubsidiaryLedgerRow[] | null>(null);
  const [isPending, startTransition] = useTransition();

  const current = STAKEHOLDER_OPTIONS.find((o) => o.value === stakeholderType)!;

  function loadBalances(type: SubsidiaryStakeholderType, id: string) {
    startTransition(async () => {
      try {
        const data = await getSubsidiaryLedger(id, type);
        setBalances(data);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to load subsidiary ledger");
      }
    });
  }

  function handleStakeholderTypeChange(value: string) {
    const type = value as SubsidiaryStakeholderType;
    setStakeholderType(type);
    setBalances(null);
    if (accountId) loadBalances(type, accountId);
  }

  function handleAccountChange(id: string) {
    setAccountId(id);
    loadBalances(stakeholderType, id);
  }

  const total = (balances ?? []).reduce((s, b) => s + parseFloat(b.balance), 0);
  const showRole = stakeholderType === "MEMBER";

  return (
    <div className="p-6 flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <BookUserIcon className="h-5 w-5 text-muted-foreground" />
          Subsidiary Ledger
        </h1>
        <p className="text-sm text-muted-foreground">{current.description}</p>
      </div>

      {/* Selectors */}
      <div className="flex flex-wrap gap-3">
        <div className="flex flex-col gap-1.5 max-w-sm flex-1 min-w-[240px]">
          <Select value={stakeholderType} onValueChange={handleStakeholderTypeChange}>
            <SelectTrigger>
              <SelectValue placeholder="Select ledger type..." />
            </SelectTrigger>
            <SelectContent>
              {STAKEHOLDER_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5 max-w-sm flex-1 min-w-[240px]">
          <Select value={accountId} onValueChange={handleAccountChange}>
            <SelectTrigger>
              <SelectValue placeholder="Select a control account..." />
            </SelectTrigger>
            <SelectContent>
              {accounts.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.code} — {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {!accountId ? (
        <div className="text-center text-muted-foreground py-12">
          Select a control account above to see the subsidiary breakdown.
        </div>
      ) : isPending ? (
        <div className="text-center text-muted-foreground py-12">Loading...</div>
      ) : balances && balances.length === 0 ? (
        <div className="text-center text-muted-foreground py-12">
          No tagged posted entries found for this account.
        </div>
      ) : balances ? (
        <div className="rounded-lg border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40">
                <TableHead>{stakeholderType === "CUSTOMER" ? "Customer" : stakeholderType === "SUPPLIER" ? "Supplier" : "Member"}</TableHead>
                {showRole && <TableHead className="w-[120px]">Role</TableHead>}
                <TableHead className="text-right w-[160px]">Balance</TableHead>
                <TableHead className="w-[140px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {balances.map((b) => (
                <TableRow key={b.stakeholderId}>
                  <TableCell className="text-sm font-medium">{b.stakeholderName}</TableCell>
                  {showRole && (
                    <TableCell>
                      <Badge variant="outline" className="text-xs capitalize">
                        {b.role}
                      </Badge>
                    </TableCell>
                  )}
                  <TableCell className="text-right font-mono text-sm">
                    {fmtMYR(parseFloat(b.balance))}
                  </TableCell>
                  <TableCell className="text-right">
                    <Link
                      href={`/dashboard/ledger/entries?q=${encodeURIComponent(b.stakeholderName)}`}
                      className="text-xs text-blue-600 hover:underline"
                    >
                      View transactions
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="bg-muted/30 font-semibold border-t-2 border-border">
                <TableCell colSpan={showRole ? 2 : 1} className="text-sm pr-4 text-right">
                  Total
                </TableCell>
                <TableCell className="text-right font-mono text-sm">
                  {fmtMYR(total)}
                </TableCell>
                <TableCell />
              </TableRow>
            </TableBody>
          </Table>
        </div>
      ) : null}
    </div>
  );
}
