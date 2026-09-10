"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { WalletIcon, CheckCircle2Icon, CircleIcon } from "lucide-react";
import type { InvoiceAllowanceRow } from "@/server/invoice-allowance";

function fmtAmount(v: string): string {
  return `RM ${parseFloat(v).toFixed(2)}`;
}

function fmtDate(d: Date | string | null): string {
  return d ? new Date(d).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" }) : "—";
}

const ROLE_LABELS: Record<string, string> = { sales_person: "Sales Person", app_specialist: "App. Specialist" };

function StatusBadge({ status }: { status: string }) {
  return status === "paid" ? (
    <Badge className="border text-xs bg-green-100 text-green-800 border-green-200 hover:bg-green-100 dark:bg-green-900/30 dark:text-green-400 dark:border-green-700">
      <CheckCircle2Icon className="h-3 w-3 mr-1" /> Paid
    </Badge>
  ) : (
    <Badge className="border text-xs bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-100 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-700">
      <CircleIcon className="h-3 w-3 mr-1" /> Pending
    </Badge>
  );
}

interface Props {
  rows: InvoiceAllowanceRow[];
}

export function MyAllowancesClient({ rows }: Props) {
  const [statusFilter, setStatusFilter] = useState<"ALL" | "pending" | "paid">("ALL");

  const filtered = rows.filter((r) => statusFilter === "ALL" || r.status === statusFilter);
  const totalPending = rows.filter((r) => r.status === "pending").reduce((s, r) => s + parseFloat(r.amount), 0);
  const totalPaid = rows.filter((r) => r.status === "paid").reduce((s, r) => s + parseFloat(r.amount), 0);

  return (
    <div className="p-6 flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <WalletIcon className="h-5 w-5 text-muted-foreground" />
          My Allowances
        </h1>
        <p className="text-sm text-muted-foreground">
          Allowances earned from case invoices tagged with a rated category, as sales person or application specialist.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="rounded-lg border border-border px-4 py-2.5">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Pending</p>
          <p className="text-lg font-semibold">{fmtAmount(String(totalPending))}</p>
        </div>
        <div className="rounded-lg border border-border px-4 py-2.5">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Paid</p>
          <p className="text-lg font-semibold">{fmtAmount(String(totalPaid))}</p>
        </div>
        <div className="flex items-center gap-1 flex-wrap ml-auto">
          {(["ALL", "pending", "paid"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatusFilter(s)}
              className={`h-7 px-2.5 rounded-md text-xs font-medium border transition-colors capitalize ${
                statusFilter === s
                  ? "bg-foreground text-background border-foreground"
                  : "border-border text-muted-foreground hover:bg-muted"
              }`}
            >
              {s === "ALL" ? "All" : s}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-border py-14 flex items-center justify-center text-sm text-muted-foreground">
          No allowances found.
        </div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40">
                <TableHead className="w-32">Invoice No</TableHead>
                <TableHead className="w-32">Org</TableHead>
                <TableHead className="w-28">Case Date</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="w-32">Role</TableHead>
                <TableHead className="w-20">Day</TableHead>
                <TableHead className="w-24 text-right">Amount</TableHead>
                <TableHead className="w-24">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs text-muted-foreground">{r.invoiceNo}</TableCell>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{r.organizationName ?? "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{fmtDate(r.caseDate)}</TableCell>
                  <TableCell className="text-sm">{r.categoryName}</TableCell>
                  <TableCell className="text-sm">{ROLE_LABELS[r.role] ?? r.role}</TableCell>
                  <TableCell className="text-xs text-muted-foreground capitalize">{r.dayType}</TableCell>
                  <TableCell className="text-right text-sm font-semibold">{fmtAmount(r.amount)}</TableCell>
                  <TableCell><StatusBadge status={r.status} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
