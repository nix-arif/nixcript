"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MailIcon, UsersIcon, CheckIcon, XIcon } from "lucide-react";
import {
  approvePendingInvitation, rejectPendingInvitation,
  approvePendingDepartmentAssignment, rejectPendingDepartmentAssignment,
} from "@/server/member-approvals";

type PendingInvitation = {
  id: string;
  email: string;
  role: string;
  departmentId: string | null;
  departmentName: string | null;
  requestedByName: string;
  requestedByEmail: string;
  status: string;
  createdAt: Date;
};

type PendingDepartmentAssignment = {
  id: string;
  memberName: string;
  memberEmail: string;
  departmentId: string;
  departmentName: string;
  departmentRole: string;
  requestedByName: string;
  status: string;
  createdAt: Date;
};

interface Props {
  pendingInvitations: PendingInvitation[];
  pendingDepartmentAssignments: PendingDepartmentAssignment[];
}

export function MemberApprovalsClient({ pendingInvitations, pendingDepartmentAssignments }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  async function handleApproveInvitation(id: string) {
    setBusy(id);
    try {
      await approvePendingInvitation(id);
      toast.success("Invitation approved and sent.");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to approve");
    } finally {
      setBusy(null);
    }
  }

  async function handleRejectInvitation(id: string) {
    setBusy(id);
    try {
      await rejectPendingInvitation(id, reason || undefined);
      toast.success("Invitation rejected.");
      setRejectingId(null);
      setReason("");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to reject");
    } finally {
      setBusy(null);
    }
  }

  async function handleApproveDept(id: string) {
    setBusy(id);
    try {
      await approvePendingDepartmentAssignment(id);
      toast.success("Department assignment approved.");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to approve");
    } finally {
      setBusy(null);
    }
  }

  async function handleRejectDept(id: string) {
    setBusy(id);
    try {
      await rejectPendingDepartmentAssignment(id, reason || undefined);
      toast.success("Department assignment rejected.");
      setRejectingId(null);
      setReason("");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to reject");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="p-6 flex flex-col gap-6 max-w-3xl">
      <PageHeader
        title="Member Approvals"
        description="Requests to invite new members or assign existing members to a department — these can hand out significant access, so only you as the organization owner can approve them."
      />

      {/* Pending invitations */}
      <div className="rounded-xl border border-border overflow-hidden">
        <div className="px-5 py-3.5 bg-muted/40 border-b border-border flex items-center gap-2">
          <MailIcon className="h-4 w-4 text-muted-foreground" />
          <p className="text-sm font-semibold">Pending Invitations</p>
          {pendingInvitations.length > 0 && (
            <Badge variant="outline" className="ml-auto text-xs">{pendingInvitations.length}</Badge>
          )}
        </div>
        {pendingInvitations.length === 0 ? (
          <div className="px-5 py-8 text-sm text-muted-foreground text-center">No pending invitations.</div>
        ) : (
          <div className="divide-y divide-border/60">
            {pendingInvitations.map((inv) => (
              <div key={inv.id} className="px-5 py-3.5 flex flex-col gap-2.5">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium">{inv.email}</span>
                    <span className="text-xs text-muted-foreground">
                      Role: <span className="capitalize">{inv.role}</span>
                      {inv.departmentName && <> · Department: {inv.departmentName}</>}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      Requested by {inv.requestedByName} ({inv.requestedByEmail})
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button size="sm" variant="outline" className="gap-1.5" disabled={busy === inv.id} onClick={() => handleApproveInvitation(inv.id)}>
                      <CheckIcon className="h-3.5 w-3.5" /> Approve
                    </Button>
                    <Button size="sm" variant="destructive" className="gap-1.5" disabled={busy === inv.id} onClick={() => setRejectingId(rejectingId === inv.id ? null : inv.id)}>
                      <XIcon className="h-3.5 w-3.5" /> Reject
                    </Button>
                  </div>
                </div>
                {rejectingId === inv.id && (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      placeholder="Reason (optional)"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      className="flex-1 h-8 px-2.5 text-xs border border-input rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                    <Button size="sm" variant="destructive" disabled={busy === inv.id} onClick={() => handleRejectInvitation(inv.id)}>
                      Confirm reject
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Pending department assignments */}
      <div className="rounded-xl border border-border overflow-hidden">
        <div className="px-5 py-3.5 bg-muted/40 border-b border-border flex items-center gap-2">
          <UsersIcon className="h-4 w-4 text-muted-foreground" />
          <p className="text-sm font-semibold">Pending Department Assignments</p>
          {pendingDepartmentAssignments.length > 0 && (
            <Badge variant="outline" className="ml-auto text-xs">{pendingDepartmentAssignments.length}</Badge>
          )}
        </div>
        {pendingDepartmentAssignments.length === 0 ? (
          <div className="px-5 py-8 text-sm text-muted-foreground text-center">No pending department assignments.</div>
        ) : (
          <div className="divide-y divide-border/60">
            {pendingDepartmentAssignments.map((req) => (
              <div key={req.id} className="px-5 py-3.5 flex flex-col gap-2.5">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium">{req.memberName}</span>
                    <span className="text-xs text-muted-foreground">{req.memberEmail}</span>
                    <span className="text-xs text-muted-foreground">
                      {req.departmentName} · <span className="capitalize">{req.departmentRole}</span>
                    </span>
                    <span className="text-xs text-muted-foreground">Requested by {req.requestedByName}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button size="sm" variant="outline" className="gap-1.5" disabled={busy === req.id} onClick={() => handleApproveDept(req.id)}>
                      <CheckIcon className="h-3.5 w-3.5" /> Approve
                    </Button>
                    <Button size="sm" variant="destructive" className="gap-1.5" disabled={busy === req.id} onClick={() => setRejectingId(rejectingId === req.id ? null : req.id)}>
                      <XIcon className="h-3.5 w-3.5" /> Reject
                    </Button>
                  </div>
                </div>
                {rejectingId === req.id && (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      placeholder="Reason (optional)"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      className="flex-1 h-8 px-2.5 text-xs border border-input rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                    <Button size="sm" variant="destructive" disabled={busy === req.id} onClick={() => handleRejectDept(req.id)}>
                      Confirm reject
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
