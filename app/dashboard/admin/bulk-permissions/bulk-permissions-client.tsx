"use client";

import React from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { bulkGrantPermissions } from "@/server/permissions";
import { PERMISSION_BUNDLES } from "@/lib/permissions/constants";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckIcon, ChevronDownIcon } from "lucide-react";

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
  const [grantingBundle, setGrantingBundle] = React.useState<string | null>(null);
  const [grantedBundles, setGrantedBundles] = React.useState<Set<string>>(new Set());

  const handleSelectMember = (m: Member) => {
    setSelectedMember(m);
    setGrantedBundles(new Set());
  };

  const handleGrantBundle = async (bundleId: string, permissionKeys: string[]) => {
    if (!selectedMember) return;
    setGrantingBundle(bundleId);
    const res = await bulkGrantPermissions(selectedMember.userId, organizationId, permissionKeys);
    if (res.success) {
      setGrantedBundles((prev) => new Set([...prev, bundleId]));
      toast.success(`Bundle granted to ${selectedMember.name}.`);
    } else {
      toast.error("Failed to grant bundle.");
    }
    setGrantingBundle(null);
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
                    <div className="ml-auto text-xs text-muted-foreground">
                      Granting a preset always sets those permissions to allowed
                    </div>
                  </div>
                );
              })()}

              {/* Bundles */}
              <div className="divide-y divide-border">
                {PERMISSION_BUNDLES.map((bundle) => {
                  const isExpanded = expandedBundle === bundle.id;
                  const isGranted = grantedBundles.has(bundle.id);
                  const isGranting = grantingBundle === bundle.id;

                  return (
                    <div key={bundle.id} className="px-4 py-3">
                      <div className="flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">{bundle.label}</span>
                            <Badge variant="secondary" className="text-xs font-mono">
                              {bundle.permissions.length} permissions
                            </Badge>
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
                              {bundle.permissions.map((key) => (
                                <span
                                  key={key}
                                  className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded"
                                >
                                  {key}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>

                        <Button
                          size="sm"
                          variant={isGranted ? "outline" : "default"}
                          disabled={isGranting}
                          onClick={() =>
                            handleGrantBundle(bundle.id, bundle.permissions as string[])
                          }
                          className="shrink-0"
                        >
                          {isGranted ? (
                            <>
                              <CheckIcon className="w-3.5 h-3.5 mr-1.5" />
                              Granted
                            </>
                          ) : isGranting ? (
                            "Granting..."
                          ) : (
                            "Grant"
                          )}
                        </Button>
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
