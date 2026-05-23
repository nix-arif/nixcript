"use client";

import React from "react";
import { PageHeader } from "@/components/page-header";
import { toast } from "sonner";
import {
  sendInvitations,
  revokeInvitation,
  resendInvitation,
  getInvitationsAction,
} from "@/server/invitations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import {
  UserIcon,
  MailIcon,
  AlertCircleIcon,
  FileTextIcon,
  PlusIcon,
  SendIcon,
  XIcon,
  FilterIcon,
  SearchIcon,
  RefreshCwIcon,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

type Invitation = {
  id: string;
  email: string;
  role: string | null;
  status: string;
  expiresAt: Date;
  createdAt: Date;
  inviterName: string;
  inviterImage: string | null | undefined;
};

type Role = {
  id: string;
  role: string;
  isSystem: boolean;
};

type InviteRow = {
  id: string;
  email: string;
  role: string;
};

const ROLE_COLORS: Record<string, string> = {
  owner: "#854F0B",
  admin: "#5A4FCF",
  member: "#666460",
};

function getRoleColor(role: string) {
  return ROLE_COLORS[role] ?? "#5A4FCF";
}

function getInitials(str: string) {
  return str.slice(0, 2).toUpperCase();
}

const AVATAR_COLORS = [
  { bg: "#E6F1FB", color: "#185FA5" },
  { bg: "#F0EFFE", color: "#5A4FCF" },
  { bg: "#EAF3DE", color: "#3B6D11" },
  { bg: "#FAEEDA", color: "#854F0B" },
  { bg: "#FAECE7", color: "#993C1D" },
];

function getAvatarColor(str: string) {
  const i = str.charCodeAt(0) % AVATAR_COLORS.length;
  return AVATAR_COLORS[i];
}

function isExpired(inv: Invitation) {
  if (isCancelled(inv)) return false;
  return inv.status === "expired" || new Date(inv.expiresAt) < new Date();
}

function isAccepted(inv: Invitation) {
  return inv.status === "accepted";
}

function getExpiryText(inv: Invitation) {
  if (isAccepted(inv)) return "—";
  if (isExpired(inv)) return "Expired";
  return `in ${formatDistanceToNow(new Date(inv.expiresAt))}`;
}

function getExpiryColor(inv: Invitation) {
  if (isExpired(inv)) return "#C0392B";
  const daysLeft =
    (new Date(inv.expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
  if (daysLeft <= 2) return "#B35C00";
  return undefined;
}

function getStatusStyle(inv: Invitation) {
  if (isAccepted(inv))
    return { bg: "#EAF3DE", color: "#3B6D11", label: "accepted" };
  if (isCancelled(inv))
    return { bg: "#F2F2F0", color: "#666460", label: "cancelled" };
  if (isExpired(inv))
    return { bg: "#FEE9E9", color: "#C0392B", label: "expired" };
  return { bg: "#FEF3E2", color: "#B35C00", label: "pending" };
}

function isCancelled(inv: Invitation) {
  return inv.status === "cancelled" || inv.status === "canceled";
}

export function InviteClient({
  invitations: initialInvitations,
  roles,
  organizationId,
  memberCount,
  pendingCount: initialPendingCount,
  expiredCount: initialExpiredCount,
}: {
  invitations: Invitation[];
  roles: Role[];
  organizationId: string;
  memberCount: number;
  pendingCount: number;
  expiredCount: number;
}) {
  const customRoleCount = roles.filter((r) => !r.isSystem).length;

  const [rows, setRows] = React.useState<InviteRow[]>([
    { id: crypto.randomUUID(), email: "", role: "" },
  ]);
  const [sending, setSending] = React.useState(false);
  const [invitations, setInvitations] =
    React.useState<Invitation[]>(initialInvitations);
  const [refreshing, setRefreshing] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [revokingId, setRevokingId] = React.useState<string | null>(null);
  const [resendingId, setResendingId] = React.useState<string | null>(null);

  // Derived counts from live state
  const pendingCount = invitations.filter(
    (i) => i.status === "pending" && !isExpired(i) && !isCancelled(i),
  ).length;

  const expiredCount = invitations.filter(
    (i) => isExpired(i) && !isCancelled(i),
  ).length;

  // Refresh invitations from server
  const refreshInvitations = React.useCallback(async () => {
    setRefreshing(true);
    try {
      const fresh = await getInvitationsAction(organizationId);
      console.log("fresh invitations", fresh);
      setInvitations(fresh);
    } catch {
      toast.error("Failed to refresh invitations.");
    } finally {
      setRefreshing(false);
    }
  }, [organizationId]);

  const validRows = rows.filter(
    (r) => r.email.trim() && r.email.includes("@") && r.role,
  );

  const addRow = () => {
    setRows((prev) => [
      ...prev,
      { id: crypto.randomUUID(), email: "", role: "" },
    ]);
  };

  const removeRow = (id: string) => {
    if (rows.length === 1) {
      setRows([{ id: crypto.randomUUID(), email: "", role: "" }]);
      return;
    }
    setRows((prev) => prev.filter((r) => r.id !== id));
  };

  const updateRow = (id: string, field: "email" | "role", value: string) => {
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)),
    );
  };

  const handleSend = async () => {
    if (validRows.length === 0) return;
    setSending(true);
    const results = await sendInvitations(organizationId, validRows);
    const succeeded = results.filter((r) => r.success);
    const failed = results.filter((r) => !r.success);

    if (succeeded.length > 0) {
      toast.success(
        `${succeeded.length} invitation${succeeded.length > 1 ? "s" : ""} sent.`,
      );
      setRows([{ id: crypto.randomUUID(), email: "", role: "" }]);
      // Refresh table to show new invitations
      await refreshInvitations();
    }
    if (failed.length > 0) {
      failed.forEach((f) => toast.error(`${f.email}: ${f.message}`));
    }
    setSending(false);
  };

  const handleRevoke = async (inv: Invitation) => {
    setRevokingId(inv.id);
    const res = await revokeInvitation(inv.id);
    if (res.success) {
      // Refresh to get accurate status from server
      await refreshInvitations();
      toast.success("Invitation revoked.");
    } else {
      toast.error(res.message);
    }
    setRevokingId(null);
  };

  const handleResend = async (inv: Invitation) => {
    setResendingId(inv.id);
    const res = await resendInvitation(
      organizationId,
      inv.email,
      inv.role ?? "member",
      inv.id,
    );
    if (res.success) {
      toast.success("Invitation resent.");
      // Refresh to get new invitation row with correct expiry
      await refreshInvitations();
    } else {
      toast.error(res.message);
    }
    setResendingId(null);
  };

  const filteredInvitations = invitations.filter((i) =>
    i.email.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div
      className="p-6"
      style={{
        background: "var(--color-background-secondary)",
        minHeight: "100vh",
      }}
    >
      <PageHeader
        title="Invite members"
        description="Grow your team — invitations are sent via email and expire after 7 days"
      />

      {/* Stats */}
      <div className="grid grid-cols-4 gap-2.5 mb-6">
        {[
          {
            icon: <UserIcon className="w-4 h-4" />,
            value: memberCount,
            label: "Total members",
            iconBg: "#EAF3DE",
            iconColor: "#3B6D11",
          },
          {
            icon: <MailIcon className="w-4 h-4" />,
            value: pendingCount,
            label: "Pending invites",
            iconBg: "#FEF3E2",
            iconColor: "#B35C00",
            valueColor: pendingCount > 0 ? "#B35C00" : undefined,
          },
          {
            icon: <AlertCircleIcon className="w-4 h-4" />,
            value: expiredCount,
            label: "Expired invites",
            iconBg: "#FEE9E9",
            iconColor: "#C0392B",
            valueColor: expiredCount > 0 ? "#C0392B" : undefined,
          },
          {
            icon: <FileTextIcon className="w-4 h-4" />,
            value: customRoleCount,
            label: "Custom roles",
            iconBg: "#F0EFFE",
            iconColor: "#5A4FCF",
          },
        ].map((s, i) => (
          <div
            key={i}
            className="bg-background border border-border/50 rounded-xl p-3.5 flex items-center gap-3"
          >
            <div
              className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: s.iconBg, color: s.iconColor }}
            >
              {s.icon}
            </div>
            <div>
              <div
                className="text-xl font-semibold tracking-tight"
                style={{ color: s.valueColor }}
              >
                {s.value}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {s.label}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Invite card */}
      <div className="rounded-2xl overflow-hidden border border-border/50 mb-6 shadow-sm">
        <div
          className="px-5 py-4 flex items-center justify-between"
          style={{
            background: "linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%)",
          }}
        >
          <div>
            <div className="text-sm font-semibold text-white">
              Send invitations
            </div>
            <div
              className="text-xs mt-0.5"
              style={{ color: "rgba(255,255,255,0.5)" }}
            >
              Add one or more email addresses below
            </div>
          </div>
          <div
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs"
            style={{
              background: "rgba(255,255,255,0.1)",
              border: "0.5px solid rgba(255,255,255,0.15)",
              color: "rgba(255,255,255,0.65)",
            }}
          >
            <div className="w-1.5 h-1.5 rounded-full bg-amber-400" />
            Expires in 7 days
          </div>
        </div>

        <div className="bg-background p-5">
          <div
            className="grid gap-2 mb-2 px-0.5"
            style={{ gridTemplateColumns: "1fr 160px 34px" }}
          >
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Email address
            </div>
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Role
            </div>
            <div />
          </div>

          <div className="space-y-2">
            {rows.map((row) => (
              <div
                key={row.id}
                className="grid gap-2 items-center"
                style={{ gridTemplateColumns: "1fr 160px 34px" }}
              >
                <div className="relative">
                  <MailIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/40" />
                  <Input
                    type="email"
                    placeholder="Enter email address..."
                    value={row.email}
                    onChange={(e) => updateRow(row.id, "email", e.target.value)}
                    className="pl-8 h-9 text-sm rounded-lg"
                  />
                </div>
                <Select
                  value={row.role}
                  onValueChange={(v) => updateRow(row.id, "role", v)}
                >
                  <SelectTrigger className="h-9 text-sm rounded-lg">
                    <SelectValue placeholder="Select role" />
                  </SelectTrigger>
                  <SelectContent>
                    {roles
                      .filter((r) => r.role !== "owner")
                      .map((r) => (
                        <SelectItem key={r.id} value={r.role}>
                          <div className="flex items-center gap-2">
                            <div
                              className="w-1.5 h-1.5 rounded-full"
                              style={{ background: getRoleColor(r.role) }}
                            />
                            <span className="capitalize">{r.role}</span>
                          </div>
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                <button
                  onClick={() => removeRow(row.id)}
                  className="w-[34px] h-[34px] rounded-lg border border-border/50 flex items-center justify-center text-muted-foreground/50 hover:text-destructive hover:border-destructive/30 hover:bg-destructive/5 transition-colors"
                >
                  <XIcon className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>

          <button
            onClick={addRow}
            className="mt-3 flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-sm text-muted-foreground hover:bg-muted/50 transition-colors"
          >
            <div className="w-5 h-5 rounded-md border border-dashed border-border flex items-center justify-center">
              <PlusIcon className="w-3 h-3" />
            </div>
            Add another person
          </button>
        </div>

        <div className="px-5 py-3.5 border-t border-border bg-muted/20 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            {validRows.length > 0 ? (
              <>
                <div className="w-1.5 h-1.5 rounded-full bg-green-600" />
                {validRows.length} valid invitation
                {validRows.length > 1 ? "s" : ""} ready to send
              </>
            ) : (
              <>
                <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/30" />
                Enter at least one email and role to continue
              </>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setRows([{ id: crypto.randomUUID(), email: "", role: "" }])
              }
            >
              Clear all
            </Button>
            <Button
              size="sm"
              disabled={validRows.length === 0 || sending}
              onClick={handleSend}
              className="gap-1.5 font-semibold"
              style={{ background: "#1a1a1a", color: "#fff" }}
            >
              <SendIcon className="w-3.5 h-3.5" />
              {sending
                ? "Sending..."
                : `Send ${validRows.length > 0 ? validRows.length : ""} invitation${validRows.length !== 1 ? "s" : ""}`}
            </Button>
          </div>
        </div>
      </div>

      {/* Pending invitations */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold">Invitations</h2>
        <div className="flex gap-2">
          <div className="relative">
            <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/40" />
            <Input
              placeholder="Search by email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-8 text-xs w-48 rounded-lg"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs rounded-lg"
            onClick={refreshInvitations}
            disabled={refreshing}
          >
            <RefreshCwIcon
              className={`w-3 h-3 ${refreshing ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>
        </div>
      </div>

      <div className="rounded-2xl border border-border/50 overflow-hidden shadow-sm bg-background">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40">
              <TableHead className="text-xs font-semibold uppercase tracking-wider">
                Invitee
              </TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wider">
                Role
              </TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wider">
                Invited by
              </TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wider">
                Expires
              </TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wider">
                Status
              </TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wider text-right">
                Actions
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredInvitations.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="text-center py-12 text-sm text-muted-foreground"
                >
                  No invitations found.
                </TableCell>
              </TableRow>
            )}
            {filteredInvitations.map((inv) => {
              const av = getAvatarColor(inv.email);
              const expired = isExpired(inv);
              const accepted = isAccepted(inv);
              const expiryColor = getExpiryColor(inv);
              const statusStyle = getStatusStyle(inv);

              return (
                <TableRow key={inv.id}>
                  <TableCell>
                    <div className="flex items-center gap-2.5">
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0"
                        style={{ background: av.bg, color: av.color }}
                      >
                        {getInitials(inv.email)}
                      </div>
                      <div>
                        <div className="text-sm font-medium">
                          {inv.email.split("@")[0]}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {inv.email}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <span
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold"
                      style={{
                        background:
                          inv.role &&
                          !["owner", "admin", "member"].includes(inv.role)
                            ? "#F0EFFE"
                            : "#F2F2F0",
                        color:
                          inv.role &&
                          !["owner", "admin", "member"].includes(inv.role)
                            ? "#5A4FCF"
                            : "#666460",
                      }}
                    >
                      <span
                        className="w-1.5 h-1.5 rounded-full"
                        style={{ background: "currentColor", opacity: 0.6 }}
                      />
                      {inv.role ?? "member"}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-xs font-semibold flex items-center justify-center">
                        {getInitials(inv.inviterName)}
                      </div>
                      <span className="text-sm">{inv.inviterName}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <span
                      className="text-xs font-medium"
                      style={{ color: expiryColor }}
                    >
                      {getExpiryText(inv)}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold"
                      style={{
                        background: statusStyle.bg,
                        color: statusStyle.color,
                      }}
                    >
                      <span
                        className="w-1.5 h-1.5 rounded-full"
                        style={{ background: "currentColor", opacity: 0.6 }}
                      />
                      {statusStyle.label}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1.5 justify-end">
                      {expired && !accepted && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 px-3 text-xs font-semibold border-blue-200 text-blue-700 hover:bg-blue-50"
                          disabled={resendingId === inv.id}
                          onClick={() => handleResend(inv)}
                        >
                          {resendingId === inv.id ? "Resending..." : "Resend"}
                        </Button>
                      )}
                      {!accepted && !isCancelled(inv) && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 px-3 text-xs font-semibold border-red-200 text-red-700 hover:bg-red-50"
                          disabled={revokingId === inv.id}
                          onClick={() => handleRevoke(inv)}
                        >
                          {revokingId === inv.id ? "Revoking..." : "Revoke"}
                        </Button>
                      )}
                      {accepted && (
                        <span className="text-xs text-muted-foreground px-2">
                          Joined
                        </span>
                      )}
                    </div>
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
