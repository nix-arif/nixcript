"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { setNoticePeriodPolicy, updateLeaveType } from "@/server/leave";
import type { NoticePeriodPolicyRow, LeaveTypeRow } from "@/server/leave";
import { CalendarClockIcon } from "lucide-react";

const STATUSES = [
  { value: "probation" as const, label: "Probation" },
  { value: "permanent" as const, label: "Permanent" },
];
const ROLES = [
  { value: "member" as const, label: "Member" },
  { value: "manager" as const, label: "Manager" },
];

interface Props {
  noticePolicies: NoticePeriodPolicyRow[];
  leaveTypes: LeaveTypeRow[];
}

export function LeavePolicyClient({ noticePolicies, leaveTypes }: Props) {
  const router = useRouter();

  // ── Notice period matrix ──────────────────────────────────────────────
  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      noticePolicies.map((p) => [`${p.employmentStatus}:${p.departmentRole}`, String(p.noticePeriodDays)]),
    ),
  );
  const [savingKey, setSavingKey] = useState<string | null>(null);

  function keyFor(status: string, role: string) {
    return `${status}:${role}`;
  }

  async function handleSaveNoticePeriod(status: "probation" | "permanent", role: "member" | "manager") {
    const key = keyFor(status, role);
    const raw = drafts[key] ?? "";
    const days = parseInt(raw, 10);
    if (!Number.isFinite(days) || days < 0) {
      toast.error("Enter a valid, non-negative number of days");
      return;
    }
    setSavingKey(key);
    try {
      await setNoticePeriodPolicy(status, role, days);
      toast.success("Notice period saved");
      router.refresh();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSavingKey(null);
    }
  }

  // ── Per-leave-type probation/notice restrictions ──────────────────────
  const [togglingKey, setTogglingKey] = useState<string | null>(null);

  async function handleToggleRestriction(
    lt: LeaveTypeRow,
    field: "allowDuringProbation" | "blockedDuringNotice",
    value: boolean,
  ) {
    const key = `${lt.id}:${field}`;
    setTogglingKey(key);
    try {
      await updateLeaveType(lt.id, { [field]: value });
      toast.success(`${lt.name} updated`);
      router.refresh();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setTogglingKey(null);
    }
  }

  return (
    <div className="p-6 flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <CalendarClockIcon className="h-5 w-5 text-muted-foreground" />
          Leave Policy
        </h1>
        <p className="text-sm text-muted-foreground">
          Org-wide rules that apply automatically during leave applications — how much notice a resigning
          member owes, and which leave types are restricted during probation or a notice period.
        </p>
      </div>

      {/* Notice period matrix */}
      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">Notice Period</h2>
        <p className="text-xs text-muted-foreground max-w-2xl">
          How many days&apos; notice each type of member owes when resigning. A resigning member&apos;s
          last working day is auto-calculated as notice date + this many days, based on their current
          employment status and whether they hold a Manager role in any department.
        </p>
        <div className="rounded-lg border border-border overflow-hidden max-w-xl">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40">
                <TableHead>Employment status</TableHead>
                <TableHead>Department role</TableHead>
                <TableHead className="w-40">Notice period (days)</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {STATUSES.map((s) =>
                ROLES.map((r) => {
                  const key = keyFor(s.value, r.value);
                  const existing = noticePolicies.find(
                    (p) => p.employmentStatus === s.value && p.departmentRole === r.value,
                  );
                  const draft = drafts[key] ?? "";
                  const dirty = draft !== String(existing?.noticePeriodDays ?? "");
                  return (
                    <TableRow key={key}>
                      <TableCell className="text-sm">{s.label}</TableCell>
                      <TableCell className="text-sm">{r.label}</TableCell>
                      <TableCell>
                        <input
                          type="number"
                          min={0}
                          value={draft}
                          onChange={(e) => setDrafts((d) => ({ ...d, [key]: e.target.value }))}
                          placeholder="Not set"
                          className="h-8 w-24 border border-input rounded px-2 text-sm bg-background outline-none focus:ring-1 focus:ring-ring"
                        />
                      </TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          variant={dirty ? "default" : "outline"}
                          className="h-7 text-xs px-2"
                          disabled={savingKey === key || !draft}
                          onClick={() => handleSaveNoticePeriod(s.value, r.value)}
                        >
                          {savingKey === key ? "…" : "Save"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                }),
              )}
            </TableBody>
          </Table>
        </div>
        <p className="text-[11px] text-muted-foreground max-w-xl">
          A combination left &quot;Not set&quot; won&apos;t auto-calculate a last working day for members in
          that bucket — their notice date will still show, just without the computed date.
        </p>
      </div>

      {/* Per-leave-type restrictions */}
      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">Probation &amp; Notice Restrictions</h2>
        <p className="text-xs text-muted-foreground max-w-2xl">
          Per leave type: whether probationary staff can apply for it, and whether HR can block it for a
          specific member during their resignation notice period (set per member on the Organization
          Members page).
        </p>
        <div className="rounded-lg border border-border overflow-hidden max-w-2xl">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40">
                <TableHead>Leave type</TableHead>
                <TableHead className="w-52">Allow during probation</TableHead>
                <TableHead className="w-52">Blockable during notice</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {leaveTypes.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="text-center py-8 text-sm text-muted-foreground">
                    No leave types yet.
                  </TableCell>
                </TableRow>
              )}
              {leaveTypes.map((lt) => (
                <TableRow key={lt.id}>
                  <TableCell className="text-sm">
                    {lt.name}
                    {!lt.isActive && <span className="text-muted-foreground italic ml-1">(inactive)</span>}
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={lt.allowDuringProbation}
                      disabled={togglingKey === `${lt.id}:allowDuringProbation`}
                      onCheckedChange={(v) => handleToggleRestriction(lt, "allowDuringProbation", v)}
                    />
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={lt.blockedDuringNotice}
                      disabled={togglingKey === `${lt.id}:blockedDuringNotice`}
                      onCheckedChange={(v) => handleToggleRestriction(lt, "blockedDuringNotice", v)}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
