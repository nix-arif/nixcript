"use client";

import React from "react";
import { toast } from "sonner";
import { createRole, updateRole, deleteRole } from "@/server/roles";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { PlusIcon, Pencil1Icon, TrashIcon } from "@radix-ui/react-icons";

type Role = {
  id: string;
  organizationId: string;
  role: string;
  permissions: string[];
  isSystem: boolean;
};

type Permission = {
  id: string;
  key: string;
  label: string | null;
};

const AVATAR_COLORS = [
  { bg: "#F1EFE8", color: "#5F5E5A" },
  { bg: "#E6F1FB", color: "#185FA5" },
  { bg: "#EEEDFE", color: "#534AB7" },
  { bg: "#EAF3DE", color: "#3B6D11" },
  { bg: "#FAEEDA", color: "#854F0B" },
];

function getAvatarColor(index: number) {
  return AVATAR_COLORS[index % AVATAR_COLORS.length];
}

// Group ALL_PERMISSIONS by resource
const groupedPermissions = ALL_PERMISSIONS.reduce(
  (acc, p) => {
    const resource = p.key.split(":")[0];
    if (!acc[resource]) acc[resource] = [];
    acc[resource].push(p);
    return acc;
  },
  {} as Record<string, (typeof ALL_PERMISSIONS)[number][]>,
);

export function RolesClient({
  roles: initialRoles,
  memberCounts,
  permissions,
  organizationId,
}: {
  roles: Role[];
  memberCounts: Record<string, number>;
  permissions: Permission[];
  organizationId: string;
}) {
  const [roles, setRoles] = React.useState<Role[]>(initialRoles);
  const [selectedRole, setSelectedRole] = React.useState<Role>(initialRoles[0]);
  const [modalOpen, setModalOpen] = React.useState(false);
  const [editingRole, setEditingRole] = React.useState<Role | null>(null);
  const [roleName, setRoleName] = React.useState("");
  const [draftPermissions, setDraftPermissions] = React.useState<string[]>([]);
  const [saving, setSaving] = React.useState(false);
  const [deletingId, setDeletingId] = React.useState<string | null>(null);

  const openCreate = () => {
    setEditingRole(null);
    setRoleName("");
    setDraftPermissions([]);
    setModalOpen(true);
  };

  const openEdit = (role: Role) => {
    setEditingRole(role);
    setRoleName(role.role);
    setDraftPermissions(role.permissions);
    setModalOpen(true);
  };

  const toggleDraftPermission = (key: string) => {
    setDraftPermissions((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  };

  const handleSave = async () => {
    if (!roleName.trim()) return;
    setSaving(true);

    if (editingRole) {
      const res = await updateRole(
        organizationId,
        editingRole.id,
        draftPermissions,
      );
      if (res.success) {
        setRoles((prev) =>
          prev.map((r) =>
            r.id === editingRole.id
              ? { ...r, permissions: draftPermissions }
              : r,
          ),
        );
        if (selectedRole.id === editingRole.id) {
          setSelectedRole((prev) => ({
            ...prev,
            permissions: draftPermissions,
          }));
        }
        toast.success("Role updated.");
        setModalOpen(false);
      } else {
        toast.error(res.message);
      }
    } else {
      const res = await createRole(organizationId, roleName, draftPermissions);
      if (res.success) {
        const newRole: Role = {
          id: crypto.randomUUID(),
          organizationId,
          role: roleName.toLowerCase().trim(),
          permissions: draftPermissions,
          isSystem: false,
        };
        setRoles((prev) => [...prev, newRole]);
        toast.success("Role created.");
        setModalOpen(false);
      } else {
        toast.error(res.message);
      }
    }

    setSaving(false);
  };

  const handleDelete = async (role: Role) => {
    setDeletingId(role.id);
    const res = await deleteRole(organizationId, role.id, role.role);
    if (res.success) {
      setRoles((prev) => prev.filter((r) => r.id !== role.id));
      if (selectedRole.id === role.id) setSelectedRole(roles[0]);
      toast.success(res.message);
    } else {
      toast.error(res.message);
    }
    setDeletingId(null);
  };

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-medium">Organization roles</h1>
        <Button size="sm" onClick={openCreate}>
          <PlusIcon className="w-3.5 h-3.5 mr-1" />
          Create role
        </Button>
      </div>

      {/* Role cards */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {roles.map((role, i) => {
          const av = getAvatarColor(i);
          const count = memberCounts[role.role] ?? 0;
          const isSelected = selectedRole.id === role.id;
          return (
            <div
              key={role.id}
              onClick={() => setSelectedRole(role)}
              className={`rounded-lg border p-4 cursor-pointer transition-colors ${
                isSelected
                  ? "border-foreground/40 bg-muted/30"
                  : "border-border/50 bg-background hover:bg-muted/20"
              }`}
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div
                    className="w-7 h-7 rounded-md flex items-center justify-center text-xs font-medium flex-shrink-0"
                    style={{ background: av.bg, color: av.color }}
                  >
                    {role.role.slice(0, 2).toUpperCase()}
                  </div>
                  <span className="text-sm font-medium capitalize">
                    {role.role}
                  </span>
                </div>
                <span
                  className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    role.isSystem
                      ? "bg-gray-100 text-gray-600"
                      : "bg-purple-50 text-purple-700"
                  }`}
                >
                  {role.isSystem ? "system" : "custom"}
                </span>
              </div>
              <div className="text-xs text-muted-foreground mb-3">
                {role.permissions.length} permissions · {count} member
                {count !== 1 ? "s" : ""}
              </div>
              {role.role !== "owner" && (
                <div className="flex gap-1.5">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      openEdit(role);
                    }}
                    className="text-xs px-2.5 py-1 rounded border border-blue-200 text-blue-700 hover:bg-blue-50 transition-colors"
                  >
                    Edit permissions
                  </button>
                  {!role.isSystem && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(role);
                      }}
                      disabled={deletingId === role.id}
                      className="text-xs px-2.5 py-1 rounded border border-red-200 text-red-700 hover:bg-red-50 transition-colors"
                    >
                      {deletingId === role.id ? "Deleting..." : "Delete"}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Permission matrix */}
      <div className="text-sm font-medium mb-3 capitalize">
        Permission matrix — {selectedRole.role}
      </div>
      <div className="rounded-lg border border-border overflow-hidden">
        <div
          className="grid bg-muted/40 border-b border-border"
          style={{ gridTemplateColumns: `200px repeat(${roles.length}, 1fr)` }}
        >
          <div className="px-3 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wider border-r border-border">
            Permission
          </div>
          {roles.map((role, i) => {
            const av = getAvatarColor(i);
            return (
              <div
                key={role.id}
                className={`px-3 py-2.5 text-xs font-medium text-center uppercase tracking-wider border-r border-border last:border-r-0 ${
                  selectedRole.id === role.id ? "bg-muted/60" : ""
                }`}
                style={selectedRole.id === role.id ? { color: av.color } : {}}
              >
                {role.role}
              </div>
            );
          })}
        </div>

        {Object.entries(groupedPermissions).map(([resource, perms]) => (
          <React.Fragment key={resource}>
            <div
              className="grid bg-muted/20 border-b border-border"
              style={{
                gridTemplateColumns: `200px repeat(${roles.length}, 1fr)`,
              }}
            >
              <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider col-span-full border-b border-border/50">
                {resource}
              </div>
            </div>
            {perms.map((p) => (
              <div
                key={p.key}
                className="grid border-b border-border last:border-b-0 hover:bg-muted/20"
                style={{
                  gridTemplateColumns: `200px repeat(${roles.length}, 1fr)`,
                }}
              >
                <div className="px-3 py-2.5 font-mono text-xs text-muted-foreground border-r border-border">
                  {p.key}
                </div>
                {roles.map((role) => (
                  <div
                    key={role.id}
                    className={`flex items-center justify-center border-r border-border last:border-r-0 ${
                      selectedRole.id === role.id ? "bg-muted/30" : ""
                    }`}
                  >
                    {role.permissions.includes(p.key) ? (
                      <div className="w-4 h-4 rounded bg-green-600 flex items-center justify-center">
                        <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                          <path
                            d="M1 4L3 6L7 2"
                            stroke="white"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </div>
                    ) : (
                      <div className="w-4 h-4 rounded border-2 border-border" />
                    )}
                  </div>
                ))}
              </div>
            ))}
          </React.Fragment>
        ))}
      </div>

      {/* Create / Edit modal */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingRole
                ? `Edit permissions — ${editingRole.role}`
                : "Create role"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {!editingRole && (
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                  Role name
                </label>
                <Input
                  placeholder="e.g. Finance Manager"
                  value={roleName}
                  onChange={(e) => setRoleName(e.target.value)}
                />
              </div>
            )}

            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                Permissions
              </label>
              <div className="space-y-3">
                {Object.entries(groupedPermissions).map(([resource, perms]) => (
                  <div key={resource}>
                    <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5 px-1">
                      {resource}
                    </div>
                    <div className="space-y-1">
                      {perms.map((p) => (
                        <div
                          key={p.key}
                          className="flex items-center justify-between px-3 py-2 rounded-md border border-border/50 hover:bg-muted/30"
                        >
                          <div>
                            <span className="font-mono text-xs">{p.key}</span>
                            {p.label && (
                              <span className="text-xs text-muted-foreground ml-2">
                                {p.label}
                              </span>
                            )}
                          </div>
                          <Switch
                            checked={draftPermissions.includes(p.key)}
                            onCheckedChange={() => toggleDraftPermission(p.key)}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving || (!editingRole && !roleName.trim())}
            >
              {saving
                ? "Saving..."
                : editingRole
                  ? "Save changes"
                  : "Create role"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
