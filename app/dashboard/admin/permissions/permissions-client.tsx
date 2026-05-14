// app/dashboard/admin/permissions/permissions-client.tsx
"use client";

import React from "react";
import { toast } from "sonner";
import {
  createPermission,
  deletePermission,
  upsertUserPermission,
} from "@/server/permissions";
import { ALL_PERMISSIONS } from "@/lib/permissions/constants";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Trash2Icon, PlusIcon } from "lucide-react";

type Permission = {
  id: string;
  key: string;
  label: string | null;
};

type Member = {
  memberId: string;
  userId: string;
  role: string;
  name: string;
  email: string;
  image: string | null | undefined;
  permissions: { key: string; allowed: boolean }[];
};

const DEFAULT_PERMISSION_KEYS = new Set<string>(
  ALL_PERMISSIONS.map((p) => p.key),
);

const RESOURCE_COLORS: Record<string, string> = {
  quotation: "bg-blue-50 text-blue-700 border-blue-200",
  "sales-order": "bg-purple-50 text-purple-700 border-purple-200",
  "delivery-order": "bg-amber-50 text-amber-700 border-amber-200",
  invoice: "bg-green-50 text-green-700 border-green-200",
  member: "bg-gray-100 text-gray-700 border-gray-200",
  "organization-role": "bg-pink-50 text-pink-700 border-pink-200",
  permission: "bg-red-50 text-red-700 border-red-200",
};

function getResource(key: string) {
  return key.split(":")[0];
}

function getInitials(name: string) {
  return name.slice(0, 2).toUpperCase();
}

const AVATAR_COLORS = [
  { bg: "#E6F1FB", color: "#185FA5" },
  { bg: "#EAF3DE", color: "#3B6D11" },
  { bg: "#FAEEDA", color: "#854F0B" },
  { bg: "#EEEDFE", color: "#534AB7" },
  { bg: "#FAECE7", color: "#993C1D" },
];

function getAvatarColor(index: number) {
  return AVATAR_COLORS[index % AVATAR_COLORS.length];
}

// Group and sort permissions by resource then by key
function groupAndSort(perms: Permission[]): Record<string, Permission[]> {
  const sorted = [...perms].sort((a, b) => {
    const ra = a.key.split(":")[0];
    const rb = b.key.split(":")[0];
    if (ra !== rb) return ra.localeCompare(rb);
    return a.key.localeCompare(b.key);
  });

  return sorted.reduce(
    (acc, p) => {
      const resource = p.key.split(":")[0];
      if (!acc[resource]) acc[resource] = [];
      acc[resource].push(p);
      return acc;
    },
    {} as Record<string, Permission[]>,
  );
}

// Group ALL_PERMISSIONS by resource (already sorted in constants.ts)
const groupedAllPermissions = ALL_PERMISSIONS.reduce(
  (acc, p) => {
    const resource = getResource(p.key);
    if (!acc[resource]) acc[resource] = [];
    acc[resource].push(p);
    return acc;
  },
  {} as Record<string, (typeof ALL_PERMISSIONS)[number][]>,
);

export function AllPermissions({
  permissions,
  members,
  organizationId,
}: {
  permissions: Permission[];
  members: Member[];
  organizationId: string;
}) {
  const [tab, setTab] = React.useState<"permissions" | "users">("permissions");

  // ── Permissions tab ──
  const [permList, setPermList] = React.useState<Permission[]>(permissions);
  const [newKey, setNewKey] = React.useState("");
  const [newLabel, setNewLabel] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const [deletingId, setDeletingId] = React.useState<string | null>(null);

  // ── Users tab ──
  const [selectedMember, setSelectedMember] = React.useState<Member | null>(
    null,
  );
  const [userPerms, setUserPerms] = React.useState<
    { key: string; allowed: boolean }[]
  >([]);
  const [togglingKey, setTogglingKey] = React.useState<string | null>(null);

  // Grouped permissions for table — recomputed when permList changes
  const groupedPermList = React.useMemo(
    () => groupAndSort(permList),
    [permList],
  );

  const handleSelectMember = (m: Member) => {
    setSelectedMember(m);
    setUserPerms(m.permissions);
  };

  const handleCreatePermission = async () => {
    if (!newKey.trim()) return;
    setCreating(true);
    const res = await createPermission(newKey.trim(), newLabel.trim());
    if (res.success) {
      setPermList((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          key: newKey.trim(),
          label: newLabel.trim() || null,
        },
      ]);
      setNewKey("");
      setNewLabel("");
      toast.success("Permission created.");
    } else {
      toast.error(res.message);
    }
    setCreating(false);
  };

  const handleDeletePermission = async (id: string) => {
    setDeletingId(id);
    const res = await deletePermission(id);
    if (res.success) {
      setPermList((prev) => prev.filter((p) => p.id !== id));
      toast.success("Permission deleted.");
    } else {
      toast.error(res.message);
    }
    setDeletingId(null);
  };

  const handleToggle = async (permKey: string, currentAllowed: boolean) => {
    if (!selectedMember) return;
    setTogglingKey(permKey);
    const newAllowed = !currentAllowed;
    const res = await upsertUserPermission(
      selectedMember.userId,
      organizationId,
      permKey,
      newAllowed,
    );
    if (res.success) {
      setUserPerms((prev) => {
        const existing = prev.find((p) => p.key === permKey);
        if (existing) {
          return prev.map((p) =>
            p.key === permKey ? { ...p, allowed: newAllowed } : p,
          );
        }
        return [...prev, { key: permKey, allowed: newAllowed }];
      });
    } else {
      toast.error("Failed to update permission.");
    }
    setTogglingKey(null);
  };

  const getPermAllowed = (key: string) => {
    return userPerms.find((p) => p.key === key)?.allowed ?? false;
  };

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-medium">Permissions</h1>
        {tab === "permissions" && (
          <div className="flex gap-2">
            <Input
              placeholder="permission:key"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              className="w-44 h-8 text-sm"
              onKeyDown={(e) => e.key === "Enter" && handleCreatePermission()}
            />
            <Input
              placeholder="Label"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              className="w-36 h-8 text-sm"
              onKeyDown={(e) => e.key === "Enter" && handleCreatePermission()}
            />
            <Button
              size="sm"
              onClick={handleCreatePermission}
              disabled={creating || !newKey.trim()}
            >
              <PlusIcon className="w-3.5 h-3.5 mr-1" />
              {creating ? "Adding..." : "Add"}
            </Button>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border mb-6">
        {(["permissions", "users"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm border-b-2 -mb-px transition-colors ${
              tab === t
                ? "border-foreground font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t === "permissions" ? "Permissions" : "User permissions"}
          </button>
        ))}
      </div>

      {/* Permissions Tab */}
      {tab === "permissions" && (
        <div className="rounded-lg border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[35%]">Key</TableHead>
                <TableHead className="w-[35%]">Label</TableHead>
                <TableHead className="w-[20%]">Resource</TableHead>
                <TableHead className="w-[10%] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Object.keys(groupedPermList).length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={4}
                    className="text-center text-muted-foreground py-8 text-sm"
                  >
                    No permissions yet.
                  </TableCell>
                </TableRow>
              )}
              {Object.entries(groupedPermList).map(([resource, perms]) => (
                <React.Fragment key={resource}>
                  {/* Group header */}
                  <TableRow className="bg-muted/30 hover:bg-muted/30">
                    <TableCell
                      colSpan={4}
                      className="py-2 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${
                            RESOURCE_COLORS[resource] ??
                            "bg-gray-100 text-gray-700 border-gray-200"
                          }`}
                        >
                          {resource}
                        </span>
                        <span className="text-muted-foreground/50">
                          {perms.length} permission
                          {perms.length !== 1 ? "s" : ""}
                        </span>
                      </div>
                    </TableCell>
                  </TableRow>
                  {/* Permission rows */}
                  {perms.map((p) => {
                    const isDefault = DEFAULT_PERMISSION_KEYS.has(p.key);
                    return (
                      <TableRow key={p.id}>
                        <TableCell>
                          <span className="font-mono text-xs">{p.key}</span>
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {p.label ?? "—"}
                        </TableCell>
                        <TableCell>
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${
                              RESOURCE_COLORS[resource] ??
                              "bg-gray-100 text-gray-700 border-gray-200"
                            }`}
                          >
                            {resource}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          {isDefault ? (
                            <span className="text-xs text-muted-foreground px-2">
                              Default
                            </span>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:text-destructive h-7 px-2"
                              disabled={deletingId === p.id}
                              onClick={() => handleDeletePermission(p.id)}
                            >
                              <Trash2Icon className="w-3.5 h-3.5" />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </React.Fragment>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* User Permissions Tab */}
      {tab === "users" && (
        <div
          className="grid gap-4"
          style={{ gridTemplateColumns: "220px 1fr" }}
        >
          {/* Member list */}
          <div className="flex flex-col gap-1.5">
            {members.map((m, i) => {
              const av = getAvatarColor(i);
              const isSelected = selectedMember?.userId === m.userId;
              return (
                <button
                  key={m.userId}
                  onClick={() => handleSelectMember(m)}
                  className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg border text-left transition-colors ${
                    isSelected
                      ? "border-border bg-muted"
                      : "border-border/50 bg-background hover:bg-muted/50"
                  }`}
                >
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium flex-shrink-0"
                    style={{ background: av.bg, color: av.color }}
                  >
                    {getInitials(m.name)}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-foreground truncate">
                      {m.name}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {m.role}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Permission toggles */}
          <div className="rounded-lg border border-border overflow-hidden">
            {!selectedMember && (
              <div className="flex items-center justify-center h-48 text-sm text-muted-foreground">
                Select a member to manage their permissions.
              </div>
            )}

            {selectedMember &&
              (() => {
                const av = getAvatarColor(
                  members.findIndex((m) => m.userId === selectedMember.userId),
                );
                return (
                  <>
                    {/* Member header */}
                    <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-muted/30">
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium flex-shrink-0"
                        style={{ background: av.bg, color: av.color }}
                      >
                        {getInitials(selectedMember.name)}
                      </div>
                      <div>
                        <div className="text-sm font-medium">
                          {selectedMember.name}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {selectedMember.email} · {selectedMember.role}
                        </div>
                      </div>
                    </div>

                    {/* Permission groups — sorted by resource */}
                    {Object.entries(groupedAllPermissions).map(
                      ([resource, perms]) => (
                        <div key={resource}>
                          <div className="px-4 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider bg-muted/20 border-b border-border flex items-center gap-2">
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${
                                RESOURCE_COLORS[resource] ??
                                "bg-gray-100 text-gray-700 border-gray-200"
                              }`}
                            >
                              {resource}
                            </span>
                          </div>
                          <Table>
                            <TableBody>
                              {perms.map((p) => {
                                const allowed = getPermAllowed(p.key);
                                const isToggling = togglingKey === p.key;
                                return (
                                  <TableRow key={p.key}>
                                    <TableCell className="w-[45%]">
                                      <span className="font-mono text-xs">
                                        {p.key}
                                      </span>
                                    </TableCell>
                                    <TableCell className="text-muted-foreground text-xs">
                                      {p.label}
                                    </TableCell>
                                    <TableCell className="text-right w-16">
                                      <Switch
                                        checked={allowed}
                                        disabled={isToggling}
                                        onCheckedChange={() =>
                                          handleToggle(p.key, allowed)
                                        }
                                      />
                                    </TableCell>
                                  </TableRow>
                                );
                              })}
                            </TableBody>
                          </Table>
                        </div>
                      ),
                    )}
                  </>
                );
              })()}
          </div>
        </div>
      )}
    </div>
  );
}
