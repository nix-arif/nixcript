"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  SearchIcon, UserPlusIcon, TrashIcon, PlusIcon, XIcon,
  RotateCcwIcon, AlertTriangleIcon,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  addMemberToDepartment,
  removeMember,
  removeMemberFromDepartment,
  restoreMember,
  permanentlyDeleteMember,
} from "@/server/members";
import type { OrgMember, DeletedMember } from "@/server/members";
import type { Department } from "@/server/departments";
import { setMemberHireDate, setMemberNoticeDate } from "@/server/leave";
import type { NoticePeriodPolicyRow } from "@/server/leave";
import { setMemberEmploymentStatus } from "@/server/profile";
import { hasAccess } from "@/lib/permissions/has-access";
import { memberNoticeRoleBucket, computeLastWorkingDay } from "@/lib/notice-period";
import { BriefcaseIcon } from "lucide-react";

// ── Styles ────────────────────────────────────────────────────────────────

const ROLE_STYLE: Record<string, { bg: string; color: string }> = {
  owner:       { bg: "#FAEEDA", color: "#854F0B" },
  stakeholder: { bg: "#F0EFFE", color: "#5A4FCF" },
  manager:     { bg: "#E6F1FB", color: "#185FA5" },
  member:      { bg: "#F2F2F0", color: "#444"    },
};

function getInitials(name: string) {
  return name.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase();
}
const AVATAR_BG = ["#E6F1FB","#F0EFFE","#EAF3DE","#FAEEDA","#FAECE7"];
const AVATAR_CO = ["#185FA5","#5A4FCF","#3B6D11","#854F0B","#993C1D"];
function avatarColor(s: string) {
  const i = s.charCodeAt(0) % AVATAR_BG.length;
  return { bg: AVATAR_BG[i], color: AVATAR_CO[i] };
}

function fmtDate(d: Date | string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" });
}


const EMPLOYMENT_STATUS_OPTIONS = [
  { value: "", label: "Not set" },
  { value: "probation", label: "Probation" },
  { value: "permanent", label: "Permanent" },
  { value: "resigned", label: "Resigned" },
  { value: "terminated", label: "Terminated" },
];
const EMPLOYMENT_STATUS_LABELS: Record<string, string> = {
  probation: "Probation", permanent: "Permanent", resigned: "Resigned", terminated: "Terminated",
};
const EMPLOYMENT_STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  probation: { bg: "#FAEEDA", color: "#854F0B" },
  permanent: { bg: "#EAF3DE", color: "#3B6D11" },
  resigned:  { bg: "#FAECE7", color: "#993C1D" },
  terminated:{ bg: "#F2F2F0", color: "#444"    },
};

// ── Employment record dialog — hire date / employment status / notice
// period. HR-only (leave:manage); drives leave-entitlement proration and
// the probation/notice-period leave restrictions in server/leave.ts.
function EmploymentDialog({
  member: m,
  policies,
  open,
  onClose,
  onSaved,
}: {
  member: OrgMember;
  policies: NoticePeriodPolicyRow[];
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [hireDateDraft, setHireDateDraft] = useState(m.hireDate ?? "");
  const [savingHireDate, setSavingHireDate] = useState(false);
  const [employmentStatusDraft, setEmploymentStatusDraft] = useState(m.employmentStatus ?? "");
  const [savingEmploymentStatus, setSavingEmploymentStatus] = useState(false);
  const [noticeDateDraft, setNoticeDateDraft] = useState(m.noticeDate ?? "");
  const [leaveBlockedOnNoticeDraft, setLeaveBlockedOnNoticeDraft] = useState(m.leaveBlockedOnNotice ?? true);
  const [savingNoticeDate, setSavingNoticeDate] = useState(false);

  const bucket = memberNoticeRoleBucket(m);
  const previewStatus = employmentStatusDraft || m.employmentStatus;
  const lastWorkingDayPreview = computeLastWorkingDay(
    { ...m, employmentStatus: previewStatus, noticeDate: noticeDateDraft || null },
    policies,
  );

  async function handleSaveHireDate() {
    setSavingHireDate(true);
    try {
      await setMemberHireDate(m.userId, hireDateDraft || null);
      toast.success("Hire date saved");
      onSaved();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSavingHireDate(false);
    }
  }

  async function handleSaveEmploymentStatus() {
    if (!employmentStatusDraft) return;
    setSavingEmploymentStatus(true);
    try {
      await setMemberEmploymentStatus(
        m.userId,
        employmentStatusDraft as "probation" | "permanent" | "resigned" | "terminated",
      );
      toast.success("Employment status saved");
      onSaved();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSavingEmploymentStatus(false);
    }
  }

  async function handleSaveNoticeDate() {
    setSavingNoticeDate(true);
    try {
      await setMemberNoticeDate(m.userId, noticeDateDraft || null, leaveBlockedOnNoticeDraft);
      toast.success("Notice details saved");
      onSaved();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSavingNoticeDate(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Employment record — {m.name}</DialogTitle>
          <DialogDescription>
            Drives leave entitlement proration and the probation/notice-period leave restrictions.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Hire date</label>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={hireDateDraft}
                onChange={(e) => setHireDateDraft(e.target.value)}
                className="h-9 border border-input rounded-md px-2 text-sm bg-background outline-none focus:ring-1 focus:ring-ring"
              />
              <Button size="sm" disabled={savingHireDate} onClick={handleSaveHireDate}>
                {savingHireDate ? "…" : "Save"}
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Falls back to the date they were added to the org if left blank.
            </p>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Employment status</label>
            <div className="flex items-center gap-2">
              <select
                value={employmentStatusDraft}
                onChange={(e) => setEmploymentStatusDraft(e.target.value)}
                className="h-9 border border-input rounded-md px-2 text-sm bg-background outline-none focus:ring-1 focus:ring-ring"
              >
                {EMPLOYMENT_STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <Button size="sm" disabled={savingEmploymentStatus || !employmentStatusDraft} onClick={handleSaveEmploymentStatus}>
                {savingEmploymentStatus ? "…" : "Save"}
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              While on Probation, leave types marked &quot;not allowed during probation&quot; can&apos;t be applied for.
            </p>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Notice date</label>
            <div className="flex items-center gap-2 flex-wrap">
              <input
                type="date"
                value={noticeDateDraft}
                onChange={(e) => setNoticeDateDraft(e.target.value)}
                className="h-9 border border-input rounded-md px-2 text-sm bg-background outline-none focus:ring-1 focus:ring-ring"
              />
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={leaveBlockedOnNoticeDraft}
                  onChange={(e) => setLeaveBlockedOnNoticeDraft(e.target.checked)}
                  className="rounded border-input"
                />
                Block restricted leave types during notice
              </label>
              <Button size="sm" disabled={savingNoticeDate} onClick={handleSaveNoticeDate}>
                {savingNoticeDate ? "…" : "Save"}
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Set when this member tenders resignation. Only applies to leave types marked
              &quot;blocked during notice&quot; (Annual Leave by default).
            </p>
            {noticeDateDraft && (
              <p className="text-xs">
                <span className="text-muted-foreground">Last working day (auto-calculated): </span>
                {lastWorkingDayPreview ? (
                  <span className="font-medium">{fmtDate(lastWorkingDayPreview)}</span>
                ) : (
                  <span className="text-muted-foreground italic">
                    No notice-period policy set for {previewStatus || "this status"}/{bucket} —
                    set one on the Notice Period Policy page.
                  </span>
                )}
              </p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Dept-role chip ────────────────────────────────────────────────────────

function DeptChip({
  deptName,
  deptRole,
  onRemove,
}: {
  deptName: string;
  deptRole: string;
  onRemove?: () => void;
}) {
  const style = ROLE_STYLE[deptRole] ?? ROLE_STYLE.member;
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold capitalize"
      style={{ background: style.bg, color: style.color }}
    >
      {deptName.replace(/-/g, " ")} · {deptRole}
      {onRemove && (
        <button onClick={onRemove} className="ml-0.5 opacity-60 hover:opacity-100">
          <XIcon className="w-2.5 h-2.5" />
        </button>
      )}
    </span>
  );
}

// ── Add-dept inline form ──────────────────────────────────────────────────

function AddDeptRow({
  memberId,
  departments,
  existingDeptIds,
  onDone,
}: {
  memberId: string;
  departments: Department[];
  existingDeptIds: Set<string>;
  onDone: () => void;
}) {
  const router = useRouter();
  const [deptId, setDeptId]   = useState("");
  const [role, setRole]       = useState<"manager" | "member">("member");
  const [saving, setSaving]   = useState(false);

  const available = departments.filter((d) => !existingDeptIds.has(d.id));

  async function handleAdd() {
    if (!deptId) return;
    setSaving(true);
    try {
      const result = await addMemberToDepartment(memberId, deptId, role);
      toast.success(
        result.pending
          ? "Submitted for owner approval — nothing changes until it's approved."
          : "Department assignment added.",
      );
      router.refresh();
      onDone();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  }

  if (available.length === 0) {
    return <p className="text-xs text-muted-foreground italic">Already in all departments.</p>;
  }

  return (
    <div className="flex items-center gap-1.5 mt-1.5">
      <Select value={deptId} onValueChange={setDeptId}>
        <SelectTrigger className="h-7 text-xs w-36 rounded-md">
          <SelectValue placeholder="Department…" />
        </SelectTrigger>
        <SelectContent>
          {available.map((d) => (
            <SelectItem key={d.id} value={d.id} className="text-xs capitalize">
              {d.name.replace(/-/g, " ")}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={role} onValueChange={(v) => setRole(v as "manager" | "member")}>
        <SelectTrigger className="h-7 text-xs w-24 rounded-md">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="manager" className="text-xs">Manager</SelectItem>
          <SelectItem value="member"  className="text-xs">Member</SelectItem>
        </SelectContent>
      </Select>
      <Button size="sm" className="h-7 px-2 text-xs" disabled={!deptId || saving} onClick={handleAdd}>
        {saving ? "…" : "Add"}
      </Button>
      <button onClick={onDone} className="text-muted-foreground hover:text-foreground">
        <XIcon className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────

type Tab = "active" | "deleted";

export function MembersClient({
  members,
  deletedMembers,
  departments,
  currentUserId,
  permissions,
  noticePolicies,
}: {
  members: OrgMember[];
  deletedMembers: DeletedMember[];
  departments: Department[];
  currentUserId: string;
  permissions: string[];
  noticePolicies: NoticePeriodPolicyRow[];
}) {
  const router = useRouter();
  const canManageEmployment                    = hasAccess(permissions, "leave:manage");
  const [tab, setTab]                           = useState<Tab>("active");
  const [search, setSearch]                     = useState("");
  const [removingId, setRemovingId]             = useState<string | null>(null);
  const [restoringId, setRestoringId]           = useState<string | null>(null);
  const [permDeletingId, setPermDeletingId]     = useState<string | null>(null);
  const [addingDeptFor, setAddingDeptFor]       = useState<string | null>(null);
  const [removingDept, setRemovingDept]         = useState<string | null>(null);

  // Confirmation dialog state
  const [removeTarget, setRemoveTarget]         = useState<OrgMember | null>(null);
  const [permDeleteTarget, setPermDeleteTarget] = useState<DeletedMember | null>(null);
  const [employmentTarget, setEmploymentTarget] = useState<OrgMember | null>(null);

  const filteredActive = members.filter(
    (m) =>
      m.name.toLowerCase().includes(search.toLowerCase()) ||
      m.email.toLowerCase().includes(search.toLowerCase()),
  );

  const filteredDeleted = deletedMembers.filter(
    (m) =>
      m.name.toLowerCase().includes(search.toLowerCase()) ||
      m.email.toLowerCase().includes(search.toLowerCase()),
  );

  // ── Handlers ──────────────────────────────────────────────────────────────

  async function confirmRemoveMember() {
    if (!removeTarget) return;
    const m = removeTarget;
    setRemoveTarget(null);
    setRemovingId(m.memberId);
    try {
      await removeMember(m.memberId);
      toast.success(`${m.name} removed.`);
      router.refresh();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setRemovingId(null);
    }
  }

  async function handleRestoreMember(m: DeletedMember) {
    setRestoringId(m.memberId);
    try {
      await restoreMember(m.memberId);
      toast.success(`${m.name} restored successfully.`);
      router.refresh();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setRestoringId(null);
    }
  }

  async function confirmPermanentDelete() {
    if (!permDeleteTarget) return;
    const m = permDeleteTarget;
    setPermDeleteTarget(null);
    setPermDeletingId(m.memberId);
    try {
      await permanentlyDeleteMember(m.memberId);
      toast.success(`${m.name} permanently deleted.`);
      router.refresh();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setPermDeletingId(null);
    }
  }

  async function handleRemoveDept(memberId: string, departmentId: string, deptName: string) {
    const key = `${memberId}-${departmentId}`;
    setRemovingDept(key);
    try {
      await removeMemberFromDepartment(memberId, departmentId);
      toast.success(`Removed from ${deptName}.`);
      router.refresh();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setRemovingDept(null);
    }
  }

  return (
    <div className="p-6 space-y-6" style={{ background: "var(--color-background-secondary)", minHeight: "100vh" }}>
      <PageHeader
        title="Members"
        description={`${members.length} active · ${deletedMembers.length} deleted`}
        action={
          <Button size="sm" className="gap-1.5" onClick={() => router.push("/dashboard/organization/invite")}>
            <UserPlusIcon className="w-3.5 h-3.5" /> Invite members
          </Button>
        }
      />

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-border">
        {(["active", "deleted"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => { setTab(t); setSearch(""); }}
            className={[
              "px-4 py-2 text-sm font-medium capitalize transition-colors relative",
              tab === t
                ? "text-foreground after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-primary"
                : "text-muted-foreground hover:text-foreground",
            ].join(" ")}
          >
            {t}
            {t === "deleted" && deletedMembers.length > 0 && (
              <span className="ml-1.5 inline-flex items-center justify-center w-4 h-4 rounded-full bg-destructive/15 text-destructive text-[10px] font-semibold">
                {deletedMembers.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative w-72">
        <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/40" />
        <Input
          placeholder={tab === "active" ? "Search active members…" : "Search deleted members…"}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-8 h-9 text-sm"
        />
      </div>

      {/* ── Active tab ── */}
      {tab === "active" && (
        <>
          {/* Stats */}
          <div className="grid grid-cols-4 gap-2.5">
            {[
              { label: "Total",        value: members.length,                                              color: "#185FA5", bg: "#E6F1FB" },
              { label: "Managers",     value: members.filter((m) => m.departments.some((d) => d.deptRole === "manager")).length, color: "#3B6D11", bg: "#EAF3DE" },
              { label: "Members",      value: members.filter((m) => m.role === "member").length,           color: "#444",    bg: "#F2F2F0" },
              { label: "Stakeholders", value: members.filter((m) => m.role === "stakeholder").length,      color: "#5A4FCF", bg: "#F0EFFE" },
            ].map((s) => (
              <div key={s.label} className="bg-background border border-border/50 rounded-xl p-3.5">
                <div className="text-xl font-semibold" style={{ color: s.color }}>{s.value}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{s.label}</div>
              </div>
            ))}
          </div>

          {/* Table */}
          <div className="bg-background border border-border/50 rounded-2xl overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="text-xs font-semibold uppercase tracking-wider">Member</TableHead>
                  <TableHead className="text-xs font-semibold uppercase tracking-wider">Org role</TableHead>
                  <TableHead className="text-xs font-semibold uppercase tracking-wider">Department assignments</TableHead>
                  <TableHead className="text-xs font-semibold uppercase tracking-wider">Joined</TableHead>
                  {canManageEmployment && (
                    <TableHead className="text-xs font-semibold uppercase tracking-wider">Employment</TableHead>
                  )}
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredActive.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={canManageEmployment ? 6 : 5} className="text-center py-12 text-sm text-muted-foreground">
                      No members found.
                    </TableCell>
                  </TableRow>
                )}
                {filteredActive.map((m) => {
                  const av      = avatarColor(m.name);
                  const isOwner = m.role === "owner";
                  const orgStyle = ROLE_STYLE[isOwner ? "owner" : m.role === "stakeholder" ? "stakeholder" : "member"] ?? ROLE_STYLE.member;
                  const existingDeptIds = new Set(m.departments.map((d) => d.departmentId));

                  return (
                    <TableRow key={m.memberId} className="align-top">
                      {/* Name + email */}
                      <TableCell>
                        <div className="flex items-center gap-2.5 pt-0.5">
                          <div
                            className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold shrink-0"
                            style={{ background: av.bg, color: av.color }}
                          >
                            {getInitials(m.name)}
                          </div>
                          <div>
                            <div className="text-sm font-medium lowercase">{m.name}</div>
                            <div className="text-xs text-muted-foreground">{m.email}</div>
                          </div>
                        </div>
                      </TableCell>

                      {/* Org role */}
                      <TableCell className="pt-2">
                        <span
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold capitalize"
                          style={{ background: orgStyle.bg, color: orgStyle.color }}
                        >
                          <span className="w-1.5 h-1.5 rounded-full" style={{ background: "currentColor", opacity: 0.6 }} />
                          {isOwner ? "owner" : m.role === "stakeholder" ? "stakeholder" : "member"}
                        </span>
                      </TableCell>

                      {/* Dept assignments */}
                      <TableCell className="pt-2">
                        {isOwner || m.role === "stakeholder" ? (
                          <span className="text-xs text-muted-foreground italic">
                            {isOwner ? "All access" : "View only"}
                          </span>
                        ) : (
                          <div className="space-y-1">
                            <div className="flex flex-wrap gap-1">
                              {m.departments.map((d) => (
                                <DeptChip
                                  key={d.departmentId}
                                  deptName={d.departmentName}
                                  deptRole={d.deptRole}
                                  onRemove={() => {
                                    const key = `${m.memberId}-${d.departmentId}`;
                                    if (removingDept === key) return;
                                    handleRemoveDept(m.memberId, d.departmentId, d.departmentName);
                                  }}
                                />
                              ))}
                              {m.departments.length === 0 && (
                                <span className="text-xs text-muted-foreground italic">No departments</span>
                              )}
                            </div>
                            {addingDeptFor === m.memberId ? (
                              <AddDeptRow
                                memberId={m.memberId}
                                departments={departments}
                                existingDeptIds={existingDeptIds}
                                onDone={() => setAddingDeptFor(null)}
                              />
                            ) : (
                              <button
                                onClick={() => setAddingDeptFor(m.memberId)}
                                className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                              >
                                <PlusIcon className="w-3 h-3" /> Add dept
                              </button>
                            )}
                          </div>
                        )}
                      </TableCell>

                      {/* Joined */}
                      <TableCell className="text-xs text-muted-foreground pt-2 whitespace-nowrap">
                        {fmtDate(m.joinedAt)}
                      </TableCell>

                      {/* Employment */}
                      {canManageEmployment && (
                        <TableCell className="pt-2">
                          <button
                            onClick={() => setEmploymentTarget(m)}
                            className="flex flex-col items-start gap-0.5 text-xs hover:opacity-80 transition-opacity"
                          >
                            <span className="flex items-center gap-1.5">
                              {m.employmentStatus ? (
                                <span
                                  className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold capitalize"
                                  style={EMPLOYMENT_STATUS_STYLE[m.employmentStatus] ? {
                                    background: EMPLOYMENT_STATUS_STYLE[m.employmentStatus].bg,
                                    color: EMPLOYMENT_STATUS_STYLE[m.employmentStatus].color,
                                  } : undefined}
                                >
                                  {EMPLOYMENT_STATUS_LABELS[m.employmentStatus] ?? m.employmentStatus}
                                </span>
                              ) : (
                                <span className="text-muted-foreground italic">Not set</span>
                              )}
                              <BriefcaseIcon className="w-3.5 h-3.5 text-muted-foreground" />
                            </span>
                            {m.noticeDate && (
                              <span className="text-[10px] text-muted-foreground">
                                Last day:{" "}
                                {computeLastWorkingDay(m, noticePolicies)
                                  ? fmtDate(computeLastWorkingDay(m, noticePolicies))
                                  : "policy not set"}
                              </span>
                            )}
                          </button>
                        </TableCell>
                      )}

                      {/* Remove */}
                      <TableCell className="pt-2">
                        {!isOwner && m.userId !== currentUserId && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs text-destructive hover:bg-destructive/10"
                            disabled={removingId === m.memberId}
                            onClick={() => setRemoveTarget(m)}
                          >
                            <TrashIcon className="w-3.5 h-3.5" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      {/* ── Employment record dialog ── */}
      {employmentTarget && (
        <EmploymentDialog
          member={employmentTarget}
          policies={noticePolicies}
          open={!!employmentTarget}
          onClose={() => setEmploymentTarget(null)}
          onSaved={() => { setEmploymentTarget(null); router.refresh(); }}
        />
      )}

      {/* ── Remove member dialog ── */}
      <Dialog open={!!removeTarget} onOpenChange={(open) => { if (!open) setRemoveTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove member</DialogTitle>
            <DialogDescription>
              Remove <span className="font-medium text-foreground">{removeTarget?.name}</span> from this organization?
              They will be moved to deleted members and their permissions revoked. You can restore them at any time.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setRemoveTarget(null)}>Cancel</Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={!!removingId}
              onClick={confirmRemoveMember}
            >
              {removingId ? "Removing…" : "Remove member"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Permanent delete dialog ── */}
      <Dialog open={!!permDeleteTarget} onOpenChange={(open) => { if (!open) setPermDeleteTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Permanently delete member</DialogTitle>
            <DialogDescription>
              Permanently delete <span className="font-medium text-foreground">{permDeleteTarget?.name}</span>?
              This will remove all their department assignments and cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setPermDeleteTarget(null)}>Cancel</Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={!!permDeletingId}
              onClick={confirmPermanentDelete}
            >
              {permDeletingId ? "Deleting…" : "Delete permanently"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Deleted tab ── */}
      {tab === "deleted" && (
        <>
          {deletedMembers.length > 0 && (
            <div className="flex items-start gap-2.5 px-4 py-3 rounded-xl border border-amber-200 bg-amber-50 text-amber-800 text-sm">
              <AlertTriangleIcon className="w-4 h-4 mt-0.5 shrink-0" />
              <div>
                <span className="font-semibold">Deleted members have no access</span> — their permissions were revoked on removal.
                Restoring a member re-grants permissions based on their saved department assignments.
              </div>
            </div>
          )}

          <div className="bg-background border border-border/50 rounded-2xl overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="text-xs font-semibold uppercase tracking-wider">Member</TableHead>
                  <TableHead className="text-xs font-semibold uppercase tracking-wider">Org role</TableHead>
                  <TableHead className="text-xs font-semibold uppercase tracking-wider">Saved departments</TableHead>
                  <TableHead className="text-xs font-semibold uppercase tracking-wider">Joined</TableHead>
                  <TableHead className="text-xs font-semibold uppercase tracking-wider">Removed</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredDeleted.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-12 text-sm text-muted-foreground">
                      {deletedMembers.length === 0 ? "No deleted members." : "No results match your search."}
                    </TableCell>
                  </TableRow>
                )}
                {filteredDeleted.map((m) => {
                  const av = avatarColor(m.name);
                  const orgStyle = ROLE_STYLE[m.role === "owner" ? "owner" : m.role === "stakeholder" ? "stakeholder" : "member"] ?? ROLE_STYLE.member;
                  return (
                    <TableRow key={m.memberId} className="align-top opacity-70">
                      {/* Name + email */}
                      <TableCell>
                        <div className="flex items-center gap-2.5 pt-0.5">
                          <div
                            className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 grayscale"
                            style={{ background: av.bg, color: av.color }}
                          >
                            {getInitials(m.name)}
                          </div>
                          <div>
                            <div className="text-sm font-medium line-through text-muted-foreground lowercase">{m.name}</div>
                            <div className="text-xs text-muted-foreground">{m.email}</div>
                          </div>
                        </div>
                      </TableCell>

                      {/* Org role */}
                      <TableCell className="pt-2">
                        <span
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold capitalize grayscale opacity-60"
                          style={{ background: orgStyle.bg, color: orgStyle.color }}
                        >
                          {m.role === "owner" ? "owner" : m.role === "stakeholder" ? "stakeholder" : "member"}
                        </span>
                      </TableCell>

                      {/* Saved dept assignments (for restore) */}
                      <TableCell className="pt-2">
                        {m.departments.length === 0 ? (
                          <span className="text-xs text-muted-foreground italic">None</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {m.departments.map((d) => (
                              <DeptChip
                                key={d.departmentId}
                                deptName={d.departmentName}
                                deptRole={d.deptRole}
                              />
                            ))}
                          </div>
                        )}
                      </TableCell>

                      {/* Joined */}
                      <TableCell className="text-xs text-muted-foreground pt-2 whitespace-nowrap">
                        {fmtDate(m.joinedAt)}
                      </TableCell>

                      {/* Removed on + by */}
                      <TableCell className="pt-2">
                        <div className="text-xs text-destructive/70 whitespace-nowrap">{fmtDate(m.deletedAt)}</div>
                        {m.deletedByName && (
                          <div className="text-[10px] text-muted-foreground mt-0.5 lowercase">by {m.deletedByName}</div>
                        )}
                      </TableCell>

                      {/* Actions */}
                      <TableCell className="pt-2">
                        <div className="flex items-center gap-1">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 px-2.5 text-xs gap-1.5 text-emerald-700 border-emerald-200 hover:bg-emerald-50"
                            disabled={restoringId === m.memberId}
                            onClick={() => handleRestoreMember(m)}
                          >
                            <RotateCcwIcon className="w-3 h-3" />
                            {restoringId === m.memberId ? "Restoring…" : "Restore"}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs text-destructive hover:bg-destructive/10"
                            disabled={permDeletingId === m.memberId}
                            onClick={() => setPermDeleteTarget(m)}
                          >
                            <TrashIcon className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}
