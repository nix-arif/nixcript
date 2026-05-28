"use client";

import { useState, useMemo, useTransition } from "react";
import { toast } from "sonner";
import { type AccountBalance, getTrialBalance } from "@/server/ledger";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AlertCircleIcon, ScaleIcon, RefreshCwIcon } from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────

type Props = {
  initialBalances: AccountBalance[];
  permissions: string[];
};

// ── Helpers ────────────────────────────────────────────────────────────────

const TYPE_ORDER = ["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"];

const TYPE_LABELS: Record<string, string> = {
  ASSET: "Assets",
  LIABILITY: "Liabilities",
  EQUITY: "Equity",
  REVENUE: "Revenue",
  EXPENSE: "Expenses",
};

const fmtMYR = (n: number) =>
  new Intl.NumberFormat("en-MY", {
    style: "currency",
    currency: "MYR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);

// ── Component ──────────────────────────────────────────────────────────────

export function TrialBalanceClient({ initialBalances }: Props) {
  const [balances, setBalances] = useState<AccountBalance[]>(initialBalances);
  const [asOfDate, setAsOfDate] = useState("");
  const [isPending, startTransition] = useTransition();

  function handleFetch() {
    startTransition(async () => {
      try {
        const data = await getTrialBalance(asOfDate || undefined);
        setBalances(data);
        toast.success("Trial balance updated");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to load trial balance");
      }
    });
  }

  // Group by type
  const grouped = useMemo(() => {
    const map: Record<string, AccountBalance[]> = {};
    for (const acc of balances) {
      if (!map[acc.type]) map[acc.type] = [];
      map[acc.type].push(acc);
    }
    return map;
  }, [balances]);

  // Grand totals (sum of all debit and credit columns)
  const grandTotalDebit = balances.reduce((s, a) => s + parseFloat(a.totalDebit || "0"), 0);
  const grandTotalCredit = balances.reduce((s, a) => s + parseFloat(a.totalCredit || "0"), 0);
  const isBalanced = Math.abs(grandTotalDebit - grandTotalCredit) < 0.01;

  return (
    <div className="p-6 flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <ScaleIcon className="h-5 w-5 text-muted-foreground" />
            Trial Balance
          </h1>
          <p className="text-sm text-muted-foreground">
            Summary of all ledger account balances from posted entries.
          </p>
        </div>
      </div>

      {/* Unbalanced warning */}
      {!isBalanced && balances.length > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertCircleIcon className="h-4 w-4 shrink-0" />
          <span>
            Warning: Trial balance is not in balance. Total debits (
            {fmtMYR(grandTotalDebit)}) ≠ total credits ({fmtMYR(grandTotalCredit)}).
            Difference: {fmtMYR(Math.abs(grandTotalDebit - grandTotalCredit))}
          </span>
        </div>
      )}

      {/* Date filter */}
      <div className="flex items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="asOfDate">As of Date</Label>
          <Input
            id="asOfDate"
            type="date"
            value={asOfDate}
            onChange={(e) => setAsOfDate(e.target.value)}
            className="w-[180px]"
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleFetch}
          disabled={isPending}
          className="h-9"
        >
          <RefreshCwIcon className={`h-3.5 w-3.5 mr-1 ${isPending ? "animate-spin" : ""}`} />
          {isPending ? "Loading..." : "Refresh"}
        </Button>
      </div>

      {/* Tables by type */}
      {balances.length === 0 ? (
        <div className="text-center text-muted-foreground py-12">
          No posted entries found. Post journal entries to see balances.
        </div>
      ) : (
        <>
          {TYPE_ORDER.filter((t) => grouped[t]?.some((a) => parseFloat(a.totalDebit) > 0 || parseFloat(a.totalCredit) > 0 || parseFloat(a.balance) !== 0)).map((type) => {
            const typeAccounts = (grouped[type] ?? []).filter(
              (a) => parseFloat(a.totalDebit) > 0 || parseFloat(a.totalCredit) > 0 || parseFloat(a.balance) !== 0
            );
            if (typeAccounts.length === 0) return null;

            const subtotalDebit = typeAccounts.reduce((s, a) => s + parseFloat(a.totalDebit || "0"), 0);
            const subtotalCredit = typeAccounts.reduce((s, a) => s + parseFloat(a.totalCredit || "0"), 0);
            const subtotalBalance = typeAccounts.reduce((s, a) => s + parseFloat(a.balance || "0"), 0);

            return (
              <div key={type} className="flex flex-col gap-2">
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                  {TYPE_LABELS[type] ?? type}
                </h2>
                <div className="rounded-lg border border-border overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/40">
                        <TableHead className="w-[100px]">Code</TableHead>
                        <TableHead>Account Name</TableHead>
                        <TableHead className="text-right w-[160px]">Debit</TableHead>
                        <TableHead className="text-right w-[160px]">Credit</TableHead>
                        <TableHead className="text-right w-[160px]">Balance</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {typeAccounts.map((acc) => (
                        <TableRow key={acc.id}>
                          <TableCell className="font-mono text-xs font-medium">
                            {acc.code}
                          </TableCell>
                          <TableCell className="text-sm">
                            {acc.name}
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm">
                            {parseFloat(acc.totalDebit) > 0 ? fmtMYR(parseFloat(acc.totalDebit)) : "—"}
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm">
                            {parseFloat(acc.totalCredit) > 0 ? fmtMYR(parseFloat(acc.totalCredit)) : "—"}
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm font-medium">
                            {fmtMYR(parseFloat(acc.balance))}
                          </TableCell>
                        </TableRow>
                      ))}
                      {/* Subtotal row */}
                      <TableRow className="bg-muted/30 font-semibold border-t-2 border-border">
                        <TableCell colSpan={2} className="text-sm pr-4 text-right">
                          {TYPE_LABELS[type] ?? type} Total
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {fmtMYR(subtotalDebit)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {fmtMYR(subtotalCredit)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {fmtMYR(subtotalBalance)}
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              </div>
            );
          })}

          {/* Grand Totals */}
          <div className="rounded-lg border border-border overflow-hidden">
            <Table>
              <TableBody>
                <TableRow className="bg-muted/50 font-bold">
                  <TableCell colSpan={2} className="text-sm font-bold pr-4 text-right">
                    Grand Total
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm font-bold w-[160px]">
                    {fmtMYR(grandTotalDebit)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm font-bold w-[160px]">
                    {fmtMYR(grandTotalCredit)}
                  </TableCell>
                  <TableCell className="w-[160px]">
                    <div className={`text-right font-mono text-sm font-bold ${isBalanced ? "text-green-600 dark:text-green-400" : "text-destructive"}`}>
                      {isBalanced ? "Balanced" : `Off by ${fmtMYR(Math.abs(grandTotalDebit - grandTotalCredit))}`}
                    </div>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}
