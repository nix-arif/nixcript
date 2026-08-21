"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import type { MyLeaveBalance, LeaveTypeRow } from "@/server/leave";
import { getMemberLeaveBalances, setOpeningBalance, setOpeningUsedDays, setMemberHireDate } from "@/server/leave";
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

// Matches the existing "Medical/Sick Leave" naming convention — one shared
// trailing "Leave", not "Annual Leave/Emergency Leave".
function withEmergencyLabel(name: string, hasThreshold: boolean): string {
  if (!hasThreshold) return name;
  return `${name.replace(/\s*Leave$/i, "")}/Emergency Leave`;
}

export function LeaveBalancesClient({ members, leaveTypes }: Props) {
  const [search, setSearch] = useState("");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [balances, setBalances] = useState<MyLeaveBalance[] | null>(null);
  const [loading, setLoading] = useState(false);

  const [draftValues, setDraftValues] = useState<Record<string, string>>({});
  const [savingTypeId, setSavingTypeId] = useState<string | null>(null);
  const [draftUsedValues, setDraftUsedValues] = useState<Record<string, string>>({});
  const [savingUsedTypeId, setSavingUsedTypeId] = useState<string | null>(null);
  const [hireDateDraft, setHireDateDraft] = useState("");
  const [savingHireDate, setSavingHireDate] = useState(false);

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
    setDraftUsedValues({});
    setHireDateDraft(members.find((m) => m.userId === userId)?.hireDate ?? "");
    setLoading(true);
    try {
      const rows = await getMemberLeaveBalances(userId);
      setBalances(rows);
      setDraftValues(Object.fromEntries(rows.map((r) => [r.leaveTypeId, r.openingBalance])));
      setDraftUsedValues(Object.fromEntries(rows.map((r) => [r.leaveTypeId, r.openingUsedDays])));
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to load balances");
    } finally {
      setLoading(false);
    }
  }

  async function refreshBalances() {
    if (!selectedUserId) return;
    const rows = await getMemberLeaveBalances(selectedUserId);
    setBalances(rows);
    setDraftValues(Object.fromEntries(rows.map((r) => [r.leaveTypeId, r.openingBalance])));
    setDraftUsedValues(Object.fromEntries(rows.map((r) => [r.leaveTypeId, r.openingUsedDays])));
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
      await refreshBalances();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to save opening balance");
    } finally {
      setSavingTypeId(null);
    }
  }

  async function handleSaveUsed(leaveTypeId: string) {
    if (!selectedUserId) return;
    const raw = draftUsedValues[leaveTypeId] ?? "0";
    const days = parseFloat(raw);
    if (!Number.isFinite(days) || days < 0) {
      toast.error("Enter a valid, non-negative number of days");
      return;
    }
    setSavingUsedTypeId(leaveTypeId);
    try {
      const year = new Date().getFullYear();
      await setOpeningUsedDays(selectedUserId, leaveTypeId, year, days);
      toast.success("Opening days taken saved");
      await refreshBalances();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to save opening days taken");
    } finally {
      setSavingUsedTypeId(null);
    }
  }

  async function handleSaveHireDate() {
    if (!selectedUserId) return;
    setSavingHireDate(true);
    try {
      await setMemberHireDate(selectedUserId, hireDateDraft || null);
      toast.success("Hire date saved");
      await refreshBalances();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to save hire date");
    } finally {
      setSavingHireDate(false);
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
          Set each member&apos;s opening figures carried in from before this system — <strong>Opening Balance</strong> adds extra days (e.g. a carried-in credit), while <strong>Days Taken (opening)</strong> subtracts days already used earlier this year that were tracked outside the system.
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
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div>
                  <h2 className="text-sm font-semibold">{selectedMember.name}</h2>
                  <p className="text-xs text-muted-foreground">{selectedMember.email}</p>
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-xs text-muted-foreground" htmlFor="hire-date-input">Hire date</label>
                  <input
                    id="hire-date-input"
                    type="date"
                    value={hireDateDraft}
                    onChange={(e) => setHireDateDraft(e.target.value)}
                    className="h-8 border border-input rounded px-2 text-sm bg-background outline-none focus:ring-1 focus:ring-ring"
                  />
                  <Button
                    size="sm"
                    variant={hireDateDraft !== (selectedMember.hireDate ?? "") ? "default" : "outline"}
                    className="h-7 text-xs px-2"
                    disabled={savingHireDate}
                    onClick={handleSaveHireDate}
                  >
                    {savingHireDate ? "…" : "Save"}
                  </Button>
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground -mt-2">
                Drives service-years and first-year proration below. Falls back to the date they were added to the org if left blank.
              </p>
              <div className="rounded-lg border border-border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40">
                      <TableHead>Leave Type</TableHead>
                      <TableHead className="text-right">Entitled</TableHead>
                      <TableHead className="text-right">Carry Forward</TableHead>
                      <TableHead className="text-right">Used / Pending</TableHead>
                      <TableHead className="w-40">Opening Balance</TableHead>
                      <TableHead className="w-40">Days Taken (opening)</TableHead>
                      <TableHead className="text-right">Remaining</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(balances ?? []).map((b) => {
                      const setInfo = b.openingBalanceSetAt
                        ? `Set by ${b.openingBalanceSetByName ?? "—"} · ${fmtDate(b.openingBalanceSetAt)}`
                        : null;
                      const dirty = draftValues[b.leaveTypeId] !== undefined && draftValues[b.leaveTypeId] !== b.openingBalance;
                      const usedSetInfo = b.openingUsedDaysSetAt
                        ? `Set by ${b.openingUsedDaysSetByName ?? "—"} · ${fmtDate(b.openingUsedDaysSetAt)}`
                        : null;
                      const usedDirty = draftUsedValues[b.leaveTypeId] !== undefined && draftUsedValues[b.leaveTypeId] !== b.openingUsedDays;
                      return (
                        <TableRow key={b.leaveTypeId}>
                          <TableCell className="text-sm font-medium">
                            {withEmergencyLabel(b.leaveTypeName, b.emergencyThresholdDays != null)}
                          </TableCell>
                          <TableCell className="text-right text-sm text-muted-foreground">{fmtDays(b.entitledDays)}</TableCell>
                          <TableCell className="text-right text-sm text-muted-foreground">{fmtDays(b.carryForwardDays)}</TableCell>
                          <TableCell className="text-right text-sm text-muted-foreground">
                            {fmtDays(b.usedDays)} / {fmtDays(b.pendingDays)}
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col gap-1">
                              <div className="flex items-center gap-1">
                                <input
                                  type="number"
                                  min="0"
                                  step="0.5"
                                  value={draftValues[b.leaveTypeId] ?? b.openingBalance}
                                  onChange={(e) => setDraftValues((prev) => ({ ...prev, [b.leaveTypeId]: e.target.value }))}
                                  className="w-20 h-8 border border-input rounded px-2 text-sm bg-background outline-none focus:ring-1 focus:ring-ring"
                                />
                                <Button
                                  size="sm"
                                  variant={dirty ? "default" : "outline"}
                                  className="h-7 text-xs px-2"
                                  disabled={savingTypeId === b.leaveTypeId}
                                  onClick={() => handleSave(b.leaveTypeId)}
                                >
                                  {savingTypeId === b.leaveTypeId ? "…" : "Save"}
                                </Button>
                              </div>
                              {setInfo && <span className="text-[10px] text-muted-foreground">{setInfo}</span>}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col gap-1">
                              <div className="flex items-center gap-1">
                                <input
                                  type="number"
                                  min="0"
                                  step="0.5"
                                  value={draftUsedValues[b.leaveTypeId] ?? b.openingUsedDays}
                                  onChange={(e) => setDraftUsedValues((prev) => ({ ...prev, [b.leaveTypeId]: e.target.value }))}
                                  className="w-20 h-8 border border-input rounded px-2 text-sm bg-background outline-none focus:ring-1 focus:ring-ring"
                                />
                                <Button
                                  size="sm"
                                  variant={usedDirty ? "default" : "outline"}
                                  className="h-7 text-xs px-2"
                                  disabled={savingUsedTypeId === b.leaveTypeId}
                                  onClick={() => handleSaveUsed(b.leaveTypeId)}
                                >
                                  {savingUsedTypeId === b.leaveTypeId ? "…" : "Save"}
                                </Button>
                              </div>
                              {usedSetInfo && <span className="text-[10px] text-muted-foreground">{usedSetInfo}</span>}
                            </div>
                          </TableCell>
                          <TableCell className="text-right text-sm font-semibold">{fmtDays(b.remainingDays)}</TableCell>
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
