"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { WalletIcon, SearchIcon, CheckCircle2Icon, CircleIcon } from "lucide-react";
import { setAllowancePaid, type InvoiceAllowanceRow, type OwnerOrgMember } from "@/server/invoice-allowance";

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
  members: OwnerOrgMember[];
}

export function AllAllowancesClient({ rows: initialRows, members }: Props) {
  const [rows, setRows] = useState(initialRows);
  const [search, setSearch] = useState("");
  const [userFilter, setUserFilter] = useState("ALL");
  const [orgFilter, setOrgFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "pending" | "paid">("pending");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const memberNameById = new Map(members.map((m) => [m.userId, m.name]));
  const orgOptions = [...new Set(rows.map((r) => r.organizationName).filter((n): n is string => !!n))].sort();

  const filtered = rows.filter((r) => {
    if (userFilter !== "ALL" && r.userId !== userFilter) return false;
    if (orgFilter !== "ALL" && r.organizationName !== orgFilter) return false;
    if (statusFilter !== "ALL" && r.status !== statusFilter) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return r.invoiceNo.toLowerCase().includes(q) || r.userName.toLowerCase().includes(q) || r.categoryName.toLowerCase().includes(q);
  });

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected((prev) => (prev.size === filtered.length ? new Set() : new Set(filtered.map((r) => r.id))));
  }

  async function handleMarkPaid(paid: boolean) {
    if (selected.size === 0) return;
    setSaving(true);
    try {
      const ids = [...selected];
      await setAllowancePaid(ids, paid);
      setRows((prev) => prev.map((r) => ids.includes(r.id)
        ? { ...r, status: paid ? "paid" : "pending", paidAt: paid ? new Date() : null }
        : r));
      setSelected(new Set());
      toast.success(paid ? `Marked ${ids.length} row(s) as paid` : `Marked ${ids.length} row(s) as pending`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update");
    } finally {
      setSaving(false);
    }
  }

  const totalSelected = [...selected].reduce((s, id) => s + parseFloat(rows.find((r) => r.id === id)?.amount ?? "0"), 0);

  return (
    <div className="p-6 flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <WalletIcon className="h-5 w-5 text-muted-foreground" />
          Allowance Statement
        </h1>
        <p className="text-sm text-muted-foreground">
          Every employee&apos;s category allowance, generated from case invoices. Select rows to mark as paid.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative max-w-sm flex-1 min-w-50">
          <SearchIcon className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by invoice no., name, or category…"
            className="w-full h-8 pl-8 pr-2 border border-input rounded-md text-sm bg-background outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <select
          value={userFilter}
          onChange={(e) => setUserFilter(e.target.value)}
          className="h-8 px-2 border border-input rounded-md text-sm bg-background outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="ALL">All employees</option>
          {members.map((m) => <option key={m.userId} value={m.userId}>{m.name}{m.organizationName ? ` (${m.organizationName})` : ""}</option>)}
        </select>
        <select
          value={orgFilter}
          onChange={(e) => setOrgFilter(e.target.value)}
          className="h-8 px-2 border border-input rounded-md text-sm bg-background outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="ALL">All organizations</option>
          {orgOptions.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
        <div className="flex items-center gap-1 flex-wrap">
          {(["pending", "paid", "ALL"] as const).map((s) => (
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
        {selected.size > 0 && (
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-xs text-muted-foreground">{selected.size} selected · {fmtAmount(String(totalSelected))}</span>
            <Button size="sm" variant="outline" disabled={saving} onClick={() => handleMarkPaid(true)}>Mark Paid</Button>
            <Button size="sm" variant="outline" disabled={saving} onClick={() => handleMarkPaid(false)}>Mark Pending</Button>
          </div>
        )}
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
                <TableHead className="w-8">
                  <input type="checkbox" checked={selected.size === filtered.length && filtered.length > 0} onChange={toggleSelectAll} />
                </TableHead>
                <TableHead className="w-32">Invoice No</TableHead>
                <TableHead className="w-32">Org</TableHead>
                <TableHead>Employee</TableHead>
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
                  <TableCell><input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleSelect(r.id)} /></TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{r.invoiceNo}</TableCell>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{r.organizationName ?? "—"}</TableCell>
                  <TableCell className="text-sm">{memberNameById.get(r.userId) ?? r.userName}</TableCell>
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
