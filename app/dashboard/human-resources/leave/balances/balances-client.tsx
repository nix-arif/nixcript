"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import type { MyLeaveBalance, LeaveTypeRow } from "@/server/leave";
import { getMemberLeaveBalances, setOpeningBalance } from "@/server/leave";
import type { OrgMember } from "@/server/members";
import { WalletIcon, SearchIcon } from "lucide-react";

interface Props {
  members: OrgMember[];
  leaveTypes: LeaveTypeRow[];
}

function fmtDays(v: string | number): string {
  return `${parseFloat(String(v)).toFixed(1)} days`;
}

function fmtDate(v: string | Date | null): string | null {
  if (!v) return null;
  return new Date(v).toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" });
}

export function LeaveBalancesClient({ members, leaveTypes }: Props) {
  const [search, setSearch] = useState("");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [balances, setBalances] = useState<MyLeaveBalance[] | null>(null);
  const [loading, setLoading] = useState(false);

  const [draftValues, setDraftValues] = useState<Record<string, string>>({});
  const [savingTypeId, setSavingTypeId] = useState<string | null>(null);

  const filteredMembers = members.filter((m) =>
    !search.trim() ||
    m.name.toLowerCase().includes(search.toLowerCase()) ||
    m.email.toLowerCase().includes(search.toLowerCase()),
  );
  const selectedMember = members.find((m) => m.userId === selectedUserId) ?? null;

  async function selectMember(userId: string) {
    setSelectedUserId(userId);
    setBalances(null);
    setDraftValues({});
    setLoading(true);
    try {
      const rows = await getMemberLeaveBalances(userId);
      setBalances(rows);
      setDraftValues(Object.fromEntries(rows.map((r) => [r.leaveTypeId, r.openingBalance])));
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to load balances");
    } finally {
      setLoading(false);
    }
  }

  async function handleSave(leaveTypeId: string) {
    if (!selectedUserId) return;
    const raw = draftValues[leaveTypeId] ?? "0";
    const days = parseFloat(raw);
    if (!Number.isFinite(days) || days < 0) {
      toast.error("Enter a valid, non-negative number of days");
      return;
    }
    setSavingTypeId(leaveTypeId);
    try {
      const year = new Date().getFullYear();
      await setOpeningBalance(selectedUserId, leaveTypeId, year, days);
      toast.success("Opening balance saved");
      const rows = await getMemberLeaveBalances(selectedUserId);
      setBalances(rows);
      setDraftValues(Object.fromEntries(rows.map((r) => [r.leaveTypeId, r.openingBalance])));
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to save opening balance");
    } finally {
      setSavingTypeId(null);
    }
  }

  return (
    <div className="p-6 flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <WalletIcon className="h-5 w-5 text-muted-foreground" />
          Leave Balances
        </h1>
        <p className="text-sm text-muted-foreground">
          Set each member&apos;s opening leave balance carried in from before this system — useful when onboarding an already-running company.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-6">
        {/* Member picker */}
        <div className="flex flex-col gap-2">
          <div className="relative">
            <SearchIcon className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search members…"
              className="w-full h-8 pl-8 pr-2 border border-input rounded-md text-sm bg-background outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div className="rounded-lg border border-border overflow-hidden max-h-[60vh] overflow-y-auto">
            {filteredMembers.length === 0 ? (
              <p className="text-xs text-muted-foreground p-3">No members found.</p>
            ) : (
              filteredMembers.map((m) => (
                <button
                  key={m.userId}
                  type="button"
                  onClick={() => selectMember(m.userId)}
                  className={`w-full text-left px-3 py-2 text-sm border-b border-border/60 last:border-0 hover:bg-muted/50 transition-colors ${
                    m.userId === selectedUserId ? "bg-muted" : ""
                  }`}
                >
                  <div className="font-medium truncate">{m.name}</div>
                  <div className="text-xs text-muted-foreground truncate">{m.email}</div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Balances for selected member */}
        <div>
          {!selectedMember ? (
            <div className="rounded-lg border border-border py-16 flex items-center justify-center text-sm text-muted-foreground">
              Select a member to view and set their leave balances.
            </div>
          ) : loading ? (
            <div className="rounded-lg border border-border py-16 flex items-center justify-center text-sm text-muted-foreground">
              Loading…
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <div>
                <h2 className="text-sm font-semibold">{selectedMember.name}</h2>
                <p className="text-xs text-muted-foreground">{selectedMember.email}</p>
              </div>
              <div className="rounded-lg border border-border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40">
                      <TableHead>Leave Type</TableHead>
                      <TableHead className="text-right">Entitled</TableHead>
                      <TableHead className="text-right">Carry Forward</TableHead>
                      <TableHead className="text-right">Used / Pending</TableHead>
                      <TableHead className="w-40">Opening Balance</TableHead>
                      <TableHead className="text-right">Remaining</TableHead>
                      <TableHead className="w-24" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(balances ?? []).map((b) => {
                      const setInfo = b.openingBalanceSetAt
                        ? `Set by ${b.openingBalanceSetByName ?? "—"} · ${fmtDate(b.openingBalanceSetAt)}`
                        : null;
                      const dirty = draftValues[b.leaveTypeId] !== undefined && draftValues[b.leaveTypeId] !== b.openingBalance;
                      return (
                        <TableRow key={b.leaveTypeId}>
                          <TableCell className="text-sm font-medium">{b.leaveTypeName}</TableCell>
                          <TableCell className="text-right text-sm text-muted-foreground">{fmtDays(b.entitledDays)}</TableCell>
                          <TableCell className="text-right text-sm text-muted-foreground">{fmtDays(b.carryForwardDays)}</TableCell>
                          <TableCell className="text-right text-sm text-muted-foreground">
                            {fmtDays(b.usedDays)} / {fmtDays(b.pendingDays)}
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col gap-1">
                              <input
                                type="number"
                                min="0"
                                step="0.5"
                                value={draftValues[b.leaveTypeId] ?? b.openingBalance}
                                onChange={(e) => setDraftValues((prev) => ({ ...prev, [b.leaveTypeId]: e.target.value }))}
                                className="w-24 h-8 border border-input rounded px-2 text-sm bg-background outline-none focus:ring-1 focus:ring-ring"
                              />
                              {setInfo && <span className="text-[10px] text-muted-foreground">{setInfo}</span>}
                            </div>
                          </TableCell>
                          <TableCell className="text-right text-sm font-semibold">{fmtDays(b.remainingDays)}</TableCell>
                          <TableCell className="text-right">
                            <Button
                              size="sm"
                              variant={dirty ? "default" : "outline"}
                              className="h-7 text-xs"
                              disabled={savingTypeId === b.leaveTypeId}
                              onClick={() => handleSave(b.leaveTypeId)}
                            >
                              {savingTypeId === b.leaveTypeId ? "Saving…" : "Save"}
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              {leaveTypes.length === 0 && (
                <p className="text-xs text-muted-foreground">No active leave types configured yet.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
