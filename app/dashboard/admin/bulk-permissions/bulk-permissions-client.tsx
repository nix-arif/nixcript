"use client";

import React from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { bulkGrantPermissions, bulkRevokePermissions } from "@/server/permissions";
import { PERMISSION_BUNDLES } from "@/lib/permissions/constants";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ChevronDownIcon } from "lucide-react";

type Member = {
  memberId: string;
  userId: string;
  role: string;
  name: string;
  email: string;
  image: string | null | undefined;
  permissions: { key: string; allowed: boolean }[];
};

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

export function BulkPermissionsClient({
  members,
  organizationId,
}: {
  members: Member[];
  organizationId: string;
}) {
  const [selectedMember, setSelectedMember] = React.useState<Member | null>(null);
  const [expandedBundle, setExpandedBundle] = React.useState<string | null>(null);
  const [overrides, setOverrides] = React.useState<Map<string, boolean>>(new Map());
  const [pendingAction, setPendingAction] = React.useState<
    { id: string; type: "grant" | "revoke" } | null
  >(null);

  const handleSelectMember = (m: Member) => {
    setSelectedMember(m);
    setOverrides(new Map(m.permissions.map((p) => [p.key, p.allowed])));
  };

  const allowedKeys = React.useMemo(
    () => new Set([...overrides].filter(([, allowed]) => allowed).map(([key]) => key)),
    [overrides],
  );
  const deniedKeys = React.useMemo(
    () => new Set([...overrides].filter(([, allowed]) => !allowed).map(([key]) => key)),
    [overrides],
  );

  const handleGrantBundle = async (bundleId: string, permissionKeys: string[]) => {
    if (!selectedMember) return;
    setPendingAction({ id: bundleId, type: "grant" });
    const res = await bulkGrantPermissions(selectedMember.userId, organizationId, permissionKeys);
    if (res.success) {
      setOverrides((prev) => {
        const next = new Map(prev);
        for (const key of permissionKeys) next.set(key, true);
        return next;
      });
      toast.success(`Bundle granted to ${selectedMember.name}.`);
    } else {
      toast.error("Failed to grant bundle.");
    }
    setPendingAction(null);
  };

  const handleRevokeBundle = async (bundleId: string, permissionKeys: string[]) => {
    if (!selectedMember) return;
    setPendingAction({ id: bundleId, type: "revoke" });
    const res = await bulkRevokePermissions(selectedMember.userId, organizationId, permissionKeys);
    if (res.success) {
      setOverrides((prev) => {
        const next = new Map(prev);
        for (const key of permissionKeys) next.set(key, false);
        return next;
      });
      toast.success(`Bundle revoked from ${selectedMember.name}.`);
    } else {
      toast.error("Failed to revoke bundle.");
    }
    setPendingAction(null);
  };

  return (
    <div className="p-6">
      <PageHeader
        title="Bulk permission presets"
        description="Apply a preset bundle to grant a member all the permissions they need for a given workflow in one click."
      />

      <div className="grid gap-4" style={{ gridTemplateColumns: "220px 1fr" }}>
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
                  className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium shrink-0"
                  style={{ background: av.bg, color: av.color }}
                >
                  {m.name.slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-foreground truncate">{m.name}</div>
                  <div className="text-xs text-muted-foreground capitalize">{m.role}</div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Bundle list */}
        <div className="rounded-lg border border-border overflow-hidden">
          {!selectedMember ? (
            <div className="flex flex-col items-center justify-center h-48 gap-2 text-muted-foreground">
              <p className="text-sm">Select a member to apply a preset</p>
              <p className="text-xs text-center max-w-xs">
                Each preset grants all permissions required for a specific workflow,
                including dependencies like customer:read for quotation creators.
              </p>
            </div>
          ) : (
            <>
              {/* Member header */}
              {(() => {
                const av = getAvatarColor(
                  members.findIndex((m) => m.userId === selectedMember.userId),
                );
                return (
                  <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-muted/30">
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium shrink-0"
                      style={{ background: av.bg, color: av.color }}
                    >
                      {selectedMember.name.slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <div className="text-sm font-medium">{selectedMember.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {selectedMember.email} ·{" "}
                        <span className="capitalize">{selectedMember.role}</span>
                      </div>
                    </div>
                    <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-green-500" /> already allowed
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-red-500" /> explicitly denied
                      </span>
                      <span>Granting always sets to allowed</span>
                    </div>
                  </div>
                );
              })()}

              {/* Bundles */}
              <div className="divide-y divide-border">
                {PERMISSION_BUNDLES.map((bundle) => {
                  const isExpanded = expandedBundle === bundle.id;
                  const grantedCount = bundle.permissions.filter((k) =>
                    allowedKeys.has(k),
                  ).length;
                  const deniedCount = bundle.permissions.filter((k) =>
                    deniedKeys.has(k),
                  ).length;
                  const fullyGranted = grantedCount === bundle.permissions.length;
                  const fullyDenied = deniedCount === bundle.permissions.length;
                  const isGranting =
                    pendingAction?.id === bundle.id && pendingAction.type === "grant";
                  const isRevoking =
                    pendingAction?.id === bundle.id && pendingAction.type === "revoke";
                  const radioValue = fullyGranted ? "allow" : fullyDenied ? "deny" : undefined;

                  return (
                    <div key={bundle.id} className="px-4 py-3">
                      <div className="flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">{bundle.label}</span>
                            <Badge variant="secondary" className="text-xs font-mono">
                              {bundle.permissions.length} permissions
                            </Badge>
                            {grantedCount > 0 && (
                              <Badge
                                variant="outline"
                                className={`text-xs ${
                                  fullyGranted
                                    ? "border-green-300 text-green-700 dark:text-green-400 dark:border-green-800"
                                    : "border-amber-300 text-amber-700 dark:text-amber-400 dark:border-amber-800"
                                }`}
                              >
                                {grantedCount}/{bundle.permissions.length} already on
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {bundle.description}
                          </p>

                          {/* Expandable permission list */}
                          <button
                            onClick={() =>
                              setExpandedBundle(isExpanded ? null : bundle.id)
                            }
                            className="flex items-center gap-1 mt-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                          >
                            <ChevronDownIcon
                              className={`w-3 h-3 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                            />
                            {isExpanded ? "Hide" : "Show"} permissions
                          </button>

                          {isExpanded && (
                            <div className="mt-2 flex flex-wrap gap-1">
                              {bundle.permissions.map((key) => {
                                const allowed = allowedKeys.has(key);
                                const denied = deniedKeys.has(key);
                                return (
                                  <span
                                    key={key}
                                    title={
                                      allowed
                                        ? "Already allowed via override"
                                        : denied
                                          ? "Explicitly denied via override"
                                          : "No override — inherits role default"
                                    }
                                    className={`font-mono text-xs px-1.5 py-0.5 rounded border ${
                                      allowed
                                        ? "bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800"
                                        : denied
                                          ? "bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800"
                                          : "bg-muted border-border/50"
                                    }`}
                                  >
                                    {allowed ? "✓ " : denied ? "✗ " : ""}
                                    {key}
                                  </span>
                                );
                              })}
                            </div>
                          )}
                        </div>

                        <RadioGroup
                          value={radioValue}
                          onValueChange={(v) => {
                            if (v === "allow") {
                              handleGrantBundle(bundle.id, bundle.permissions as string[]);
                            } else {
                              handleRevokeBundle(bundle.id, bundle.permissions as string[]);
                            }
                          }}
                          disabled={isGranting || isRevoking}
                          className="flex items-center gap-3 shrink-0"
                        >
                          <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                            <RadioGroupItem value="allow" />
                            {isGranting ? "Granting…" : "Allow"}
                          </label>
                          <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                            <RadioGroupItem value="deny" />
                            {isRevoking ? "Revoking…" : "Deny"}
                          </label>
                        </RadioGroup>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
