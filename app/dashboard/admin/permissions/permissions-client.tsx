"use client";

import React from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { upsertUserPermission } from "@/server/permissions";
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

type Member = {
  memberId: string;
  userId: string;
  role: string;
  name: string;
  email: string;
  image: string | null | undefined;
  permissions: { key: string; allowed: boolean }[];
};

const groupedPermissions = ALL_PERMISSIONS.reduce(
  (acc, p) => {
    const resource = p.key.split(":")[0];
    if (!acc[resource]) acc[resource] = [];
    acc[resource].push(p);
    return acc;
  },
  {} as Record<string, (typeof ALL_PERMISSIONS)[number][]>,
);

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

export function PermissionOverridesClient({
  members,
  organizationId,
}: {
  members: Member[];
  organizationId: string;
}) {
  const [selectedMember, setSelectedMember] = React.useState<Member | null>(
    null,
  );
  const [overrides, setOverrides] = React.useState<
    { key: string; allowed: boolean }[]
  >([]);
  const [togglingKey, setTogglingKey] = React.useState<string | null>(null);

  const handleSelectMember = (m: Member) => {
    setSelectedMember(m);
    setOverrides(m.permissions);
  };

  const getOverride = (key: string) =>
    overrides.find((p) => p.key === key)?.allowed ?? false;

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
      setOverrides((prev) => {
        const existing = prev.find((p) => p.key === permKey);
        if (existing) {
          return prev.map((p) =>
            p.key === permKey ? { ...p, allowed: newAllowed } : p,
          );
        }
        return [...prev, { key: permKey, allowed: newAllowed }];
      });
    } else {
      toast.error("Failed to update override.");
    }
    setTogglingKey(null);
  };

  return (
    <div className="p-6">
      <PageHeader
        title="Permission overrides"
        description="Grant or revoke individual permissions per member, on top of their department role defaults."
      />

      <div className="grid gap-4" style={{ gridTemplateColumns: "220px 1fr" }}>
        {/* Member list */}
        <div className="flex flex-col gap-1.5">
          {members.map((m, i) => {
            const av = getAvatarColor(i);
            const isSelected = selectedMember?.userId === m.userId;
            const overrideCount = m.permissions.filter((p) => p.allowed).length;
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
                  className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium shrink-0"
                  style={{ background: av.bg, color: av.color }}
                >
                  {m.name.slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-foreground truncate">
                    {m.name}
                  </div>
                  <div className="text-xs text-muted-foreground capitalize">
                    {m.role}
                    {overrideCount > 0 && (
                      <span className="ml-1.5 text-blue-600">
                        · {overrideCount} override{overrideCount !== 1 ? "s" : ""}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Permission toggles */}
        <div className="rounded-lg border border-border overflow-hidden">
          {!selectedMember ? (
            <div className="flex flex-col items-center justify-center h-48 gap-2 text-muted-foreground">
              <p className="text-sm">Select a member to manage overrides</p>
              <p className="text-xs text-center max-w-xs">
                Overrides grant or revoke specific permissions beyond what their
                department role provides.
              </p>
            </div>
          ) : (
            (() => {
              const av = getAvatarColor(
                members.findIndex((m) => m.userId === selectedMember.userId),
              );
              return (
                <>
                  <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-muted/30">
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium shrink-0"
                      style={{ background: av.bg, color: av.color }}
                    >
                      {selectedMember.name.slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <div className="text-sm font-medium">
                        {selectedMember.name}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {selectedMember.email} ·{" "}
                        <span className="capitalize">{selectedMember.role}</span>
                      </div>
                    </div>
                    <div className="ml-auto text-xs text-muted-foreground">
                      Toggles add or remove permissions from their role defaults
                    </div>
                  </div>

                  {Object.entries(groupedPermissions).map(
                    ([resource, perms]) => (
                      <div key={resource}>
                        <div className="px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider bg-muted/20 border-b border-border">
                          {resource}
                        </div>
                        <Table>
                          <TableBody>
                            {perms.map((p) => {
                              const allowed = getOverride(p.key);
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
                                      disabled={togglingKey === p.key}
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
            })()
          )}
        </div>
      </div>
    </div>
  );
}
