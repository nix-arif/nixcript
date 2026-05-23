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
import { SearchIcon, UserPlusIcon, TrashIcon, PlusIcon, XIcon } from "lucide-react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  addMemberToDepartment,
  removeMember,
  removeMemberFromDepartment,
} from "@/server/members";
import type { OrgMember } from "@/server/members";
import type { Department } from "@/server/departments";

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
      await addMemberToDepartment(memberId, deptId, role);
      toast.success("Department assignment added.");
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

export function MembersClient({
  members,
  departments,
}: {
  members: OrgMember[];
  departments: Department[];
}) {
  const router = useRouter();
  const [search, setSearch]           = useState("");
  const [removingId, setRemovingId]   = useState<string | null>(null);
  const [addingDeptFor, setAddingDeptFor] = useState<string | null>(null);
  const [removingDept, setRemovingDept]   = useState<string | null>(null);

  const filtered = members.filter(
    (m) =>
      m.name.toLowerCase().includes(search.toLowerCase()) ||
      m.email.toLowerCase().includes(search.toLowerCase()),
  );

  async function handleRemoveMember(m: OrgMember) {
    if (!confirm(`Remove ${m.name} from this organization?`)) return;
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
        description={`${members.length} member${members.length !== 1 ? "s" : ""} in this organization`}
        action={
          <Button size="sm" className="gap-1.5" onClick={() => router.push("/dashboard/organization/invite")}>
            <UserPlusIcon className="w-3.5 h-3.5" /> Invite members
          </Button>
        }
      />

      {/* Search */}
      <div className="relative w-72">
        <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/40" />
        <Input
          placeholder="Search by name or email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-8 h-9 text-sm"
        />
      </div>

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
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-12 text-sm text-muted-foreground">
                  No members found.
                </TableCell>
              </TableRow>
            )}
            {filtered.map((m) => {
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
                        <div className="text-sm font-medium">{m.name}</div>
                        <div className="text-xs text-muted-foreground">{m.email}</div>
                      </div>
                    </div>
                  </TableCell>

                  {/* Org role (owner / stakeholder / member) */}
                  <TableCell className="pt-2">
                    <span
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold capitalize"
                      style={{ background: orgStyle.bg, color: orgStyle.color }}
                    >
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: "currentColor", opacity: 0.6 }} />
                      {isOwner ? "owner" : m.role === "stakeholder" ? "stakeholder" : "member"}
                    </span>
                  </TableCell>

                  {/* Dept assignments (multi) */}
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
                    {new Date(m.joinedAt).toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" })}
                  </TableCell>

                  {/* Remove */}
                  <TableCell className="pt-2">
                    {!isOwner && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs text-destructive hover:bg-destructive/10"
                        disabled={removingId === m.memberId}
                        onClick={() => handleRemoveMember(m)}
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
    </div>
  );
}
