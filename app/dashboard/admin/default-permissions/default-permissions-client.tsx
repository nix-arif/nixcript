"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { SearchIcon, ChevronDownIcon, InfoIcon, ShieldAlertIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { ALL_PERMISSIONS } from "@/lib/permissions/constants";
import { KEY_GROUP, GROUP_DEFS } from "@/lib/permissions/groups";
import { setDefaultPermission, setSensitivePermissionFlag, enableSensitiveDefaultPermission } from "@/server/default-permissions";

type PermEntry = { key: string; label: string };

const PERM_GROUPS: { id: string; label: string; perms: PermEntry[] }[] = GROUP_DEFS.map((g) => ({
  ...g,
  perms: ALL_PERMISSIONS.filter((p) => KEY_GROUP[p.key] === g.id),
}));

interface Props {
  defaultKeys: string[];
  sensitiveKeys: string[];
}

export function DefaultPermissionsClient({ defaultKeys, sensitiveKeys }: Props) {
  const router = useRouter();
  const [checked, setChecked] = useState<Set<string>>(new Set(defaultKeys));
  const [sensitive, setSensitive] = useState<Set<string>>(new Set(sensitiveKeys));
  const [pending, setPending] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");

  // Password-confirmation dialog for enabling a sensitive permission
  const [confirmTarget, setConfirmTarget] = useState<PermEntry | null>(null);
  const [password, setPassword] = useState("");
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const visibleGroups = useMemo(() => {
    if (!search) return PERM_GROUPS;
    const q = search.toLowerCase();
    return PERM_GROUPS.map((g) => ({
      ...g,
      perms: g.perms.filter((p) => p.key.toLowerCase().includes(q) || p.label.toLowerCase().includes(q)),
    })).filter((g) => g.perms.length > 0);
  }, [search]);

  function toggleCollapse(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function showAppliedToast(appliedToMembers: number) {
    toast.success(
      appliedToMembers > 0
        ? `Applied to ${appliedToMembers} member${appliedToMembers === 1 ? "" : "s"}. New members will get it automatically too.`
        : "Set as default. New members will get it automatically.",
    );
  }

  async function handleToggle(perm: PermEntry, current: boolean) {
    // Turning ON a sensitive permission needs password confirmation first —
    // open the dialog instead of calling the server action directly.
    if (!current && sensitive.has(perm.key)) {
      setConfirmTarget(perm);
      setPassword("");
      setConfirmError(null);
      return;
    }

    setPending(perm.key);
    try {
      const { appliedToMembers } = await setDefaultPermission(perm.key, !current);
      setChecked((prev) => {
        const next = new Set(prev);
        current ? next.delete(perm.key) : next.add(perm.key);
        return next;
      });
      if (!current) {
        showAppliedToast(appliedToMembers);
      } else {
        toast.success("Removed from defaults. Members who already have it keep it — this only affects future members.");
      }
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update");
    } finally {
      setPending(null);
    }
  }

  async function handleConfirmSensitive() {
    if (!confirmTarget) return;
    setConfirming(true);
    setConfirmError(null);
    try {
      const { appliedToMembers } = await enableSensitiveDefaultPermission(confirmTarget.key, password);
      setChecked((prev) => new Set(prev).add(confirmTarget.key));
      showAppliedToast(appliedToMembers);
      router.refresh();
      setConfirmTarget(null);
      setPassword("");
    } catch (err) {
      setConfirmError(err instanceof Error ? err.message : "Failed to confirm");
    } finally {
      setConfirming(false);
    }
  }

  async function handleToggleSensitive(key: string, current: boolean) {
    setSensitive((prev) => {
      const next = new Set(prev);
      current ? next.delete(key) : next.add(key);
      return next;
    });
    try {
      await setSensitivePermissionFlag(key, !current);
    } catch (err) {
      // revert on failure
      setSensitive((prev) => {
        const next = new Set(prev);
        current ? next.add(key) : next.delete(key);
        return next;
      });
      toast.error(err instanceof Error ? err.message : "Failed to update");
    }
  }

  return (
    <div className="p-6">
      <PageHeader
        title="Default Permissions"
        description="Choose the baseline permissions every member should have. Checking a permission grants it to all current members and to everyone who joins later."
      />

      <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-900/20 px-4 py-3 mb-5 flex gap-2.5">
        <InfoIcon className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
        <p className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
          Unchecking a permission only removes it from this default list — it does <strong>not</strong> revoke
          access from members who already have it. To remove a permission from a specific member, use{" "}
          <strong>Access Control</strong> instead. Use the <ShieldAlertIcon className="h-3 w-3 inline -mt-0.5" />{" "}
          icon to flag a permission as sensitive — enabling a flagged permission then requires your account
          password to confirm.
        </p>
      </div>

      <div className="rounded-xl border border-border overflow-hidden">
        <div className="px-5 py-3 border-b border-border">
          <div className="relative">
            <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              placeholder="Filter permissions…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full h-8 pl-8 pr-3 text-xs bg-muted/40 border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary"
            />
          </div>
        </div>

        {visibleGroups.map((group) => {
          const isCollapsed = collapsed.has(group.id);
          const onCount = group.perms.filter((p) => checked.has(p.key)).length;

          return (
            <div key={group.id} className="border-b border-border last:border-0">
              <button
                onClick={() => toggleCollapse(group.id)}
                className="w-full flex items-center gap-2.5 px-5 py-2.5 bg-muted/20 hover:bg-muted/40 transition-colors text-left"
              >
                <ChevronDownIcon
                  className={cn(
                    "w-3.5 h-3.5 text-muted-foreground transition-transform shrink-0",
                    isCollapsed && "-rotate-90",
                  )}
                />
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex-1">
                  {group.label}
                </span>
                {onCount > 0 && (
                  <span className="text-[10px] bg-primary/10 text-primary rounded-full px-2 py-0.5 font-medium">
                    {onCount} default
                  </span>
                )}
                <span className="text-[10px] text-muted-foreground/50 shrink-0">
                  {group.perms.length} permissions
                </span>
              </button>

              {!isCollapsed && (
                <div>
                  {group.perms.map((p, pi) => {
                    const isChecked = checked.has(p.key);
                    const isSensitive = sensitive.has(p.key);
                    const busy = pending === p.key;

                    return (
                      <div
                        key={p.key}
                        className={cn(
                          "flex items-center gap-4 px-5 py-2.5 hover:bg-muted/10 transition-colors",
                          pi > 0 && "border-t border-border/40",
                          isSensitive && "bg-red-50/40 dark:bg-red-950/10",
                        )}
                      >
                        <Switch
                          checked={isChecked}
                          disabled={busy}
                          onCheckedChange={() => handleToggle(p, isChecked)}
                        />
                        <div className="flex-1 min-w-0 flex items-center gap-1.5 flex-wrap">
                          <span className="text-sm">{p.label}</span>
                          {isSensitive && (
                            <span title="Sensitive permission — requires password to enable">
                              <ShieldAlertIcon className="h-3.5 w-3.5 text-red-600 dark:text-red-400 shrink-0" />
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          title={isSensitive ? "Unmark as sensitive" : "Mark as sensitive"}
                          onClick={() => handleToggleSensitive(p.key, isSensitive)}
                          className={cn(
                            "shrink-0 rounded-md p-1 transition-colors",
                            isSensitive
                              ? "text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30"
                              : "text-muted-foreground/40 hover:text-muted-foreground hover:bg-muted",
                          )}
                        >
                          <ShieldAlertIcon className="h-3.5 w-3.5" />
                        </button>
                        <span className="text-[10px] font-mono text-muted-foreground bg-muted border border-border/60 rounded px-1.5 py-0.5 shrink-0">
                          {p.key}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        {visibleGroups.length === 0 && (
          <div className="py-12 text-center text-sm text-muted-foreground">
            No permissions match &ldquo;{search}&rdquo;
          </div>
        )}
      </div>

      <Dialog open={!!confirmTarget} onOpenChange={(open) => !open && setConfirmTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlertIcon className="h-4 w-4 text-red-600 dark:text-red-400" />
              Confirm sensitive permission
            </DialogTitle>
            <DialogDescription>
              <strong className="text-foreground">{confirmTarget?.label}</strong> is flagged as sensitive.
              Enter your account password to grant it to every current member.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="confirm-password">Password</Label>
            <Input
              id="confirm-password"
              type="password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setConfirmError(null); }}
              onKeyDown={(e) => { if (e.key === "Enter" && password) handleConfirmSensitive(); }}
              autoFocus
              placeholder="Your account password"
            />
            {confirmError && <p className="text-xs text-destructive">{confirmError}</p>}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmTarget(null)} disabled={confirming}>
              Cancel
            </Button>
            <Button type="button" onClick={handleConfirmSensitive} disabled={confirming || !password}>
              {confirming ? "Confirming…" : "Confirm & enable"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
