"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import { ShieldCheckIcon, ChevronDownIcon, XIcon, PlusIcon, CrownIcon, BuildingIcon } from "lucide-react";
import type { ApprovalMember, CrossOrgApprovalMember } from "@/server/approvals";
import type { ApprovalModule } from "@/lib/approvals/constants";
import { setApprovalPermission, setCrossOrgApprovalPermission } from "@/server/approvals";
import { setSelfActionAllowed } from "@/server/approval-settings";

interface Props {
  members: ApprovalMember[];
  crossOrgMembers: CrossOrgApprovalMember[];
  modules: readonly ApprovalModule[];
  selfActionSettings: Record<string, boolean>;
}

function initials(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function ApprovalsClient({ members, crossOrgMembers, modules, selfActionSettings }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [pending, setPending] = useState<string | null>(null); // "userId:permKey" or "self:permKey" or "userId:orgId:permKey"

  async function handleToggle(userId: string, permKey: string, currentAllowed: boolean) {
    const key = `${userId}:${permKey}`;
    setPending(key);
    try {
      await setApprovalPermission(userId, permKey, !currentAllowed);
      startTransition(() => router.refresh());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update");
    } finally {
      setPending(null);
    }
  }

  async function handleCrossOrgToggle(userId: string, orgId: string, permKey: string, currentAllowed: boolean) {
    const key = `${userId}:${orgId}:${permKey}`;
    setPending(key);
    try {
      await setCrossOrgApprovalPermission(userId, orgId, permKey, !currentAllowed);
      startTransition(() => router.refresh());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update");
    } finally {
      setPending(null);
    }
  }

  async function handleSelfActionToggle(permKey: string, currentAllowed: boolean) {
    const key = `self:${permKey}`;
    setPending(key);
    try {
      await setSelfActionAllowed(permKey, !currentAllowed);
      startTransition(() => router.refresh());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="p-6 flex flex-col gap-6 max-w-3xl">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <ShieldCheckIcon className="h-5 w-5 text-muted-foreground" />
          Approval Management
        </h1>
        <p className="text-sm text-muted-foreground">
          Assign one or more members who can check or approve submissions for each module, and
          control whether a member may act on their own submission. Organization owners always
          have full access — shown below with a <CrownIcon className="inline size-3 -mt-0.5 text-amber-500" aria-hidden="true" /> badge on every module, since it can&apos;t be revoked here.
        </p>
      </div>

      {/* Module sections */}
      {modules.map((mod) => (
        <div key={mod.id} className="rounded-lg border border-border overflow-hidden">
          {/* Module header */}
          <div className="px-5 py-3.5 bg-muted/40 border-b border-border">
            <p className="text-sm font-semibold">{mod.title}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{mod.description}</p>
          </div>

          <div className="divide-y divide-border/60">
            {mod.permissions.map((p) => {
              const owners = members.filter((m) => m.isOwner);
              const assigned = members.filter((m) => !m.isOwner && m.permissions[p.key] === true);
              const isCrossOrgKey = p.key.endsWith(":centralized");
              const crossAssigned = isCrossOrgKey ? crossOrgMembers.filter((m) => m.permissions[p.key] === true) : [];
              const selfAllowed = selfActionSettings[p.key] === true;
              const selfKey = `self:${p.key}`;

              return (
                <div key={p.key} className="px-5 py-3.5 flex flex-col gap-2.5">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm font-medium">{p.label}</span>
                      {isCrossOrgKey && (
                        <span className="text-[11px] text-muted-foreground">
                          Grantees keep this permission while working from their own organization — assign it to members of any organization you own below.
                        </span>
                      )}
                    </div>
                    <label className="flex items-center gap-2 shrink-0">
                      <span className="text-xs text-muted-foreground">Allow self</span>
                      <Switch
                        checked={selfAllowed}
                        disabled={pending === selfKey}
                        onCheckedChange={() => handleSelfActionToggle(p.key, selfAllowed)}
                      />
                    </label>
                  </div>

                  <div className="flex items-center gap-1.5 flex-wrap">
                    {owners.map((m) => (
                      <span
                        key={m.userId}
                        title={`${m.name} — organization owner, always has full access`}
                        className="inline-flex items-center gap-1.5 pl-1 pr-2 py-0.5 rounded-full border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 text-xs text-amber-800 dark:text-amber-300"
                      >
                        <Avatar size="sm" className="size-5">
                          <AvatarFallback className="text-[9px]">{initials(m.name)}</AvatarFallback>
                        </Avatar>
                        {m.name}
                        <CrownIcon className="size-3 shrink-0" aria-label="Organization owner" />
                      </span>
                    ))}

                    {assigned.length === 0 && owners.length === 0 && crossAssigned.length === 0 && (
                      <span className="text-xs text-muted-foreground italic">No one assigned</span>
                    )}

                    {crossAssigned.map((m) => {
                      const key = `${m.userId}:${m.orgId}:${p.key}`;
                      return (
                        <span
                          key={`${m.userId}:${m.orgId}`}
                          title={`${m.name} — member of ${m.orgName}, another organization you own`}
                          className="inline-flex items-center gap-1.5 pl-1 pr-1.5 py-0.5 rounded-full border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30 text-xs text-blue-800 dark:text-blue-300"
                        >
                          <Avatar size="sm" className="size-5">
                            <AvatarFallback className="text-[9px]">{initials(m.name)}</AvatarFallback>
                          </Avatar>
                          {m.name}
                          <span className="flex items-center gap-0.5 text-[10px] opacity-80">
                            <BuildingIcon className="size-2.5" />
                            {m.orgName}
                          </span>
                          <button
                            type="button"
                            aria-label={`Remove ${m.name}`}
                            disabled={pending === key}
                            onClick={() => handleCrossOrgToggle(m.userId, m.orgId, p.key, true)}
                            className="text-blue-700/70 dark:text-blue-300/70 hover:text-destructive transition-colors disabled:opacity-50"
                          >
                            <XIcon className="size-3" />
                          </button>
                        </span>
                      );
                    })}

                    {assigned.map((m) => {
                      const key = `${m.userId}:${p.key}`;
                      return (
                        <span
                          key={m.userId}
                          className="inline-flex items-center gap-1.5 pl-1 pr-1.5 py-0.5 rounded-full border border-border bg-muted/50 text-xs"
                        >
                          <Avatar size="sm" className="size-5">
                            <AvatarFallback className="text-[9px]">{initials(m.name)}</AvatarFallback>
                          </Avatar>
                          {m.name}
                          <button
                            type="button"
                            aria-label={`Remove ${m.name}`}
                            disabled={pending === key}
                            onClick={() => handleToggle(m.userId, p.key, true)}
                            className="text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
                          >
                            <XIcon className="size-3" />
                          </button>
                        </span>
                      );
                    })}

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full border border-dashed border-border text-muted-foreground hover:text-foreground hover:border-foreground/50 transition-colors"
                        >
                          <PlusIcon className="size-3" />
                          Assign
                          <ChevronDownIcon className="size-3" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent className="w-64 max-h-72 overflow-y-auto">
                        <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">
                          Members
                        </DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        {members.filter((m) => !m.isOwner).length === 0 ? (
                          <div className="px-2 py-4 text-xs text-muted-foreground text-center">
                            No other members in this organization.
                          </div>
                        ) : (
                          members.filter((m) => !m.isOwner).map((m) => {
                            const checked = m.permissions[p.key] === true;
                            const key = `${m.userId}:${p.key}`;
                            return (
                              <DropdownMenuCheckboxItem
                                key={m.userId}
                                checked={checked}
                                disabled={pending === key}
                                onSelect={(e) => e.preventDefault()}
                                onCheckedChange={() => handleToggle(m.userId, p.key, checked)}
                              >
                                <div className="flex flex-col min-w-0">
                                  <span className="truncate">{m.name}</span>
                                  <span className="text-[10px] text-muted-foreground truncate">
                                    {m.email}
                                  </span>
                                </div>
                              </DropdownMenuCheckboxItem>
                            );
                          })
                        )}

                        {isCrossOrgKey && crossOrgMembers.length > 0 && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">
                              Other organizations you own
                            </DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            {crossOrgMembers.map((m) => {
                              const checked = m.permissions[p.key] === true;
                              const key = `${m.userId}:${m.orgId}:${p.key}`;
                              return (
                                <DropdownMenuCheckboxItem
                                  key={`${m.userId}:${m.orgId}`}
                                  checked={checked}
                                  disabled={pending === key}
                                  onSelect={(e) => e.preventDefault()}
                                  onCheckedChange={() => handleCrossOrgToggle(m.userId, m.orgId, p.key, checked)}
                                >
                                  <div className="flex flex-col min-w-0">
                                    <span className="truncate">{m.name}</span>
                                    <span className="flex items-center gap-1 text-[10px] text-muted-foreground truncate">
                                      <BuildingIcon className="size-2.5 shrink-0" />
                                      {m.orgName}
                                    </span>
                                  </div>
                                </DropdownMenuCheckboxItem>
                              );
                            })}
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
