"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  type LedgerAccountRow,
  type MemberBalanceRow,
  getMemberBalances,
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
import { UsersIcon } from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────

type Props = {
  accounts: LedgerAccountRow[];
  permissions: string[];
};

// ── Helpers ────────────────────────────────────────────────────────────────

const fmtMYR = (n: number) =>
  new Intl.NumberFormat("en-MY", {
    style: "currency",
    currency: "MYR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);

// ── Component ──────────────────────────────────────────────────────────────

export function MemberBalancesClient({ accounts }: Props) {
  const [accountId, setAccountId] = useState("");
  const [balances, setBalances] = useState<MemberBalanceRow[] | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleAccountChange(id: string) {
    setAccountId(id);
    startTransition(async () => {
      try {
        const data = await getMemberBalances(id);
        setBalances(data);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to load member balances");
      }
    });
  }

  const total = (balances ?? []).reduce((s, b) => s + parseFloat(b.balance), 0);

  return (
    <div className="p-6 flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <UsersIcon className="h-5 w-5 text-muted-foreground" />
          Member Balances
        </h1>
        <p className="text-sm text-muted-foreground">
          Breaks down a control account's total by member, so you can see who owes
          how much (or who you owe). Only posted entries tagged to a Member are counted.
        </p>
      </div>

      {/* Account selector */}
      <div className="flex flex-col gap-1.5 max-w-sm">
        <Select value={accountId} onValueChange={handleAccountChange}>
          <SelectTrigger>
            <SelectValue placeholder="Select an account..." />
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

      {!accountId ? (
        <div className="text-center text-muted-foreground py-12">
          Select an account above to see the breakdown by member.
        </div>
      ) : isPending ? (
        <div className="text-center text-muted-foreground py-12">Loading...</div>
      ) : balances && balances.length === 0 ? (
        <div className="text-center text-muted-foreground py-12">
          No member-tagged posted entries found for this account.
        </div>
      ) : balances ? (
        <div className="rounded-lg border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40">
                <TableHead>Member</TableHead>
                <TableHead className="w-[120px]">Role</TableHead>
                <TableHead className="text-right w-[160px]">Balance</TableHead>
                <TableHead className="w-[140px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {balances.map((b) => (
                <TableRow key={b.memberId}>
                  <TableCell className="text-sm font-medium">{b.memberName}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs capitalize">
                      {b.role}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {fmtMYR(parseFloat(b.balance))}
                  </TableCell>
                  <TableCell className="text-right">
                    <Link
                      href={`/dashboard/ledger/entries?q=${encodeURIComponent(b.memberName)}`}
                      className="text-xs text-blue-600 hover:underline"
                    >
                      View transactions
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="bg-muted/30 font-semibold border-t-2 border-border">
                <TableCell colSpan={2} className="text-sm pr-4 text-right">
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
